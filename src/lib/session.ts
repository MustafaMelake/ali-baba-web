import { headers } from "next/headers";
import { cache } from "react";
import { auth } from "./auth";

/**
 * Server-side session reader for Server Components, Route Handlers and
 * Server Actions.
 *
 * Wrapped in React's `cache()` so multiple calls within the same request
 * (e.g. a layout AND a page both needing the user) hit Better Auth only once.
 *
 * Returns `{ user, session } | null`. `user.role` is "USER" | "ADMIN".
 */
export const getServerSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

/**
 * Guard for Server Actions / Route Handlers that must be admin-only.
 *
 * Throws on anonymous or non-admin callers (the UI never lets this happen, so a
 * thrown error here means someone is hitting the action directly). Returns the
 * session so callers can use `session.user.id` etc.
 */
export async function requireAdmin() {
  const session = await getServerSession();
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Unauthorized: admin access required.");
  }
  return session;
}
