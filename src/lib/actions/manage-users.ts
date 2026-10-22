"use server";

// ─────────────────────────────────────────────────────────────────────────────
// User role management — ADMIN-only (Super Admin).
//
// `updateUserRole` is the single authority for promoting/demoting users and for
// linking a MANAGER to the branch they oversee:
//   - MANAGER       → a valid `branchId` is REQUIRED (the schema can't enforce
//     "MANAGER ⇒ branchId", so this action is the enforcement point).
//   - USER / ADMIN  → `branchId` is always cleared to null.
// ─────────────────────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { ensureAdminSession, prismaErrorCode } from "@/lib/action-utils";
import { UserRole } from "@/generated/prisma/enums";
import { randomInt } from "node:crypto";
import { auth } from "@/lib/auth";
import { whatsappHref } from "@/lib/utils";

export type UpdateUserRoleInput = {
  userId: string;
  role: UserRole;
  /** Required when role === MANAGER; ignored (forced null) for USER/ADMIN. */
  branchId?: string | null;
};

export type UpdateUserRoleResult =
  | { success: true }
  | { success: false; error: string };

const VALID_ROLES = new Set<string>(Object.values(UserRole));

export async function updateUserRole(
  input: UpdateUserRoleInput,
): Promise<UpdateUserRoleResult> {
  // The session-returning gate variant — the self-demotion guard below needs
  // the caller's own user id, not just an allowed/denied answer.
  const gate = await ensureAdminSession();
  if ("error" in gate) return { success: false, error: gate.error };

  const { userId, role } = input;
  if (!userId) return { success: false, error: "Missing user id." };
  if (!VALID_ROLES.has(role)) {
    return { success: false, error: "Invalid role." };
  }

  // Guard against self-lockout: a Super Admin can't strip their own admin role.
  if (gate.session.user.id === userId && role !== UserRole.ADMIN) {
    return { success: false, error: "You can't change your own admin role." };
  }

  // Resolve the branch link strictly from the target role.
  let branchId: string | null = null;
  if (role === UserRole.MANAGER) {
    if (!input.branchId) {
      return {
        success: false,
        error: "Select a branch — a manager must be assigned to one.",
      };
    }
    const branch = await prisma.branch.findUnique({
      where: { id: input.branchId },
      select: { id: true },
    });
    if (!branch) {
      return { success: false, error: "That branch no longer exists." };
    }
    branchId = branch.id;
  }
  // USER / ADMIN fall through with branchId = null (assignment cleared).

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { role, branchId },
      select: { id: true },
    });

    revalidatePath("/admin/users");
    revalidatePath("/admin"); // the user's dashboard/orders scope may now differ
    return { success: true };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return { success: false, error: "That user no longer exists." };
    }
    console.error("updateUserRole failed:", err);
    return { success: false, error: "Could not update the user. Please try again." };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Password reset — the WhatsApp "forgot password" flow's admin half.
//
// There is no email provider: a customer messages the store on WhatsApp
// (/forgot-password), staff verify them there, and an ADMIN resets the
// password here. The server mints a strong temporary password, stores it ONLY
// through Better Auth's own hashing path (never a hand-rolled hash), revokes
// every session the user has, and flags `mustChangePassword` so their next
// sign-in is held on /account/change-password until they pick a new one.
//
// The temporary password is returned to the admin exactly once and is never
// logged, persisted in plain text, or put in a URL (the WhatsApp link only
// opens the chat — the admin pastes the password from the copy button).
// ─────────────────────────────────────────────────────────────────────────────

export type ResetUserPasswordResult =
  | {
      success: true;
      /** Shown to the admin ONCE — send it on WhatsApp, then it's gone. */
      tempPassword: string;
      /** wa.me chat with the customer's last order phone, or null when unknown. */
      whatsappHref: string | null;
    }
  | { success: false; error: string };

/** No look-alikes (0/O, 1/l/I) — it will be read off a phone screen and retyped. */
const TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/** 16 CSPRNG characters as "xxxx-xxxx-xxxx-xxxx" (~92 bits of entropy). */
function generateTempPassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let group = "";
    for (let i = 0; i < 4; i++) {
      group += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
    }
    groups.push(group);
  }
  return groups.join("-");
}

export async function resetUserPassword(userId: unknown): Promise<ResetUserPasswordResult> {
  // Session-returning gate: the self-guard below needs the caller's id.
  const gate = await ensureAdminSession();
  if ("error" in gate) return { success: false, error: gate.error };

  const id = typeof userId === "string" ? userId.trim() : "";
  if (!id) return { success: false, error: "Missing user id." };
  if (gate.session.user.id === id) {
    return {
      success: false,
      error: "You can't reset your own password here — sign out and use your account's change-password page.",
    };
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        // Only an email+password ("credential") account has a password to reset.
        accounts: { where: { providerId: "credential" }, select: { id: true } },
        // The customer's phone, if they've ordered — for the WhatsApp hand-back.
        orders: { orderBy: { createdAt: "desc" }, take: 1, select: { customerPhone: true } },
      },
    });
    if (!user) return { success: false, error: "That user no longer exists." };
    if (user.accounts.length === 0) {
      return { success: false, error: "This account doesn't sign in with a password, so there's nothing to reset." };
    }

    const tempPassword = generateTempPassword();

    // Order matters: flag FIRST, so a failure part-way leaves the user forced
    // to change their password — never signed in on a temporary one unflagged.
    await prisma.user.update({
      where: { id },
      data: { mustChangePassword: true },
      select: { id: true },
    });
    const ctx = await auth.$context;
    await ctx.internalAdapter.updatePassword(id, await ctx.password.hash(tempPassword));
    // Every device signed in as this user is signed out.
    await ctx.internalAdapter.deleteUserSessions(id);

    revalidatePath("/admin/users");

    const phone = user.orders[0]?.customerPhone;
    return {
      success: true,
      tempPassword,
      whatsappHref: phone ? whatsappHref(phone) : null,
    };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return { success: false, error: "That user no longer exists." };
    }
    // `err` never carries the temporary password — safe to log.
    console.error("resetUserPassword failed:", err);
    return { success: false, error: "Could not reset the password. Please try again." };
  }
}
