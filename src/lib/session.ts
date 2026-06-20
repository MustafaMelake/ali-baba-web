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
