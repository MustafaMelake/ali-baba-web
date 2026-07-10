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
