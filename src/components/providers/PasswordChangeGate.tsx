"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";

/** Mirrors CHANGE_PASSWORD_PATH in src/lib/session.ts (a server-only module). */
const CHANGE_PASSWORD_PATH = "/account/change-password";

/**
 * Holds a signed-in user whose password an admin reset on the change-password
 * page, on EVERY route — including the ISR-cached storefront pages, which
 * never read the session server-side (frontend.md: no per-user state in a
 * shared-cache page). The session is client state here, so the cached HTML is
 * untouched. The server-side half is `requirePasswordCurrent` (per-user pages,
 * admin layout) plus the gates in requireAdmin / requireDashboardAccess.
 *
 * Guests have no session, so this never fires for guest checkout. Renders
 * nothing.
 */
export default function PasswordChangeGate() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const mustChange = session?.user.mustChangePassword === true;

  useEffect(() => {
    if (mustChange && pathname !== CHANGE_PASSWORD_PATH) {
      router.replace(CHANGE_PASSWORD_PATH);
    }
  }, [mustChange, pathname, router]);

  return null;
}
