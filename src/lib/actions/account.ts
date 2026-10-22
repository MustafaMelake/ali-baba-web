"use server";

// ─────────────────────────────────────────────────────────────────────────────
// Self-service account actions for a signed-in customer or staff member.
//
// `changeTemporaryPassword` is the exit from an ADMIN password reset
// (resetUserPassword sets `mustChangePassword` and every guard holds the user
// on /account/change-password). It also serves any signed-in user changing
// their password voluntarily. The password itself changes through Better
// Auth's own endpoint (auth.api.changePassword — it verifies the current
// password, hashes, and with `revokeOtherSessions` re-issues this device's
// session cookie via the nextCookies plugin); the flag is cleared ONLY after
// that succeeds, so it can never be cleared without a real change.
//
// NOTE: "use server" — async exports + inline types only.
// ─────────────────────────────────────────────────────────────────────────────

import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getServerSession } from "@/lib/session";
import { changePasswordSchema } from "@/lib/validators";

export type ChangePasswordResult =
  | { success: true }
  | { success: false; error: string };

/** Better Auth's error body code (duck-typed — no direct better-auth import, per backend.md). */
function betterAuthErrorCode(err: unknown): string | undefined {
  const body = (err as { body?: { code?: unknown } } | null)?.body;
  return typeof body?.code === "string" ? body.code : undefined;
}

export async function changeTemporaryPassword(input: unknown): Promise<ChangePasswordResult> {
  const session = await getServerSession();
  if (!session) return { success: false, error: "Please sign in again." };

  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Check your new password." };
  }
  const { currentPassword, newPassword } = parsed.data;

  try {
    await auth.api.changePassword({
      body: { currentPassword, newPassword, revokeOtherSessions: true },
      headers: await headers(),
    });
  } catch (err) {
    const code = betterAuthErrorCode(err);
    if (code === "INVALID_PASSWORD") {
      return { success: false, error: "Your current password is incorrect." };
    }
    if (code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_TOO_LONG") {
      return { success: false, error: "Choose a password between 8 and 128 characters." };
    }
    if (code === "CREDENTIAL_ACCOUNT_NOT_FOUND") {
      return { success: false, error: "This account doesn't sign in with a password." };
    }
    console.error("changeTemporaryPassword failed:", err);
    return { success: false, error: "Could not change your password. Please try again." };
  }

  try {
    // Only now — the password really changed.
    await prisma.user.update({
      where: { id: session.user.id },
      data: { mustChangePassword: false },
      select: { id: true },
    });
  } catch (err) {
    // The password DID change; a stuck flag only re-asks on the next visit.
    console.error("changeTemporaryPassword: password changed but the flag didn't clear:", err);
    return { success: false, error: "Your password changed, but please try once more to finish." };
  }

  return { success: true };
}
