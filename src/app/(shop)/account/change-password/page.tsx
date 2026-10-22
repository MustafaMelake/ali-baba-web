import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CHANGE_PASSWORD_PATH, getServerSession } from "@/lib/session";
import ChangePasswordForm from "./ChangePasswordForm";

// Per-user — reads the session (frontend.md: per-user pages are force-dynamic).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Change Password | Ali Baba",
  robots: { index: false },
};

/**
 * Change your password. Where a user whose password an admin reset is held
 * (every guard redirects here while `mustChangePassword` is set) — and open to
 * any signed-in user. The proxy matcher covers /account; this in-page check is
 * the authoritative one (a present-but-expired cookie fails here).
 */
export default async function ChangePasswordPage() {
  const session = await getServerSession();
  if (!session) redirect(`/login?redirect=${encodeURIComponent(CHANGE_PASSWORD_PATH)}`);

  return (
    <ChangePasswordForm
      temporary={session.user.mustChangePassword === true}
      isStaff={session.user.role === "ADMIN" || session.user.role === "MANAGER"}
    />
  );
}
