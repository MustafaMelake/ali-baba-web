import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Edge proxy — Next.js 16's renamed `middleware` (PROXY_FILENAME = "proxy").
 *
 * Centralises auth gating for customer account routes so a newly-added protected
 * page can't silently ship without a guard. This replaces the per-page
 * `if (!session) redirect("/login")` pattern as the *first* line of defence.
 *
 * OPTIMISTIC by design: `getSessionCookie` only confirms a Better Auth session
 * cookie is present — it does NOT validate the session against the database
 * (that needs Node + Prisma and cannot run on the Edge). Real validation still
 * happens inside each page via `getServerSession()`, which stays the source of
 * truth. The proxy's job is to turn "developer forgot the guard" from a leaked
 * render into a cheap redirect.
 *
 * EDGE-SAFE: imports only `next/server` and `better-auth/cookies` (cookie-string
 * parsing). Never import `@/lib/prisma`, `@/lib/auth`, or other Node-only code
 * here — it would break the Edge runtime build.
 */
export function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);

  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    // Preserve the intended destination so login can return the user here.
    // (Wire the login form to read `?redirect=` to complete the round-trip.)
    loginUrl.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Protect each route AND its sub-paths. The bare paths are listed explicitly
  // alongside `:path*` so the base URL (e.g. exactly "/my-orders") is always
  // covered, independent of path-to-regexp's zero-segment edge cases.
  matcher: [
    "/my-orders",
    "/my-orders/:path*",
    "/wishlist",
    "/wishlist/:path*",
  ],
};
