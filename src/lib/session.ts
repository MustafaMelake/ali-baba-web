import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "./auth";
import { prisma } from "./prisma";

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

/**
 * Page-level guard for ADMIN-only /admin/* routes. The shared admin layout now
 * admits MANAGERs (so they can reach the dashboard + orders), so every OTHER
 * admin page must call this to bounce a manager back to their own dashboard.
 */
export async function requireAdminPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/admin");
  return session;
}

/**
 * The data scope a dashboard caller is allowed to see.
 *   - ADMIN   → every branch (no constraint).
 *   - MANAGER → exactly one branch, identified by `branchId`.
 */
export type DashboardScope =
  | { userId: string; role: "ADMIN" }
  | { userId: string; role: "MANAGER"; branchId: string };

/**
 * Authorize a caller for the ADMIN/MANAGER dashboard and resolve their scope.
 *
 * Role + branchId are read LIVE from the database, NOT from the session token:
 *   - the Better Auth token only carries `role`, never `branchId`;
 *   - reading fresh means a demoted or re-assigned user loses access on their
 *     very next request, not whenever the 7-day token happens to refresh.
 *
 * Throws (rather than returning null) on every unauthorized case, so callers can
 * treat a successful return as a proven, branch-scoped identity:
 *   - anonymous / USER                 → not staff
 *   - MANAGER with no branchId         → misconfigured account (the schema can't
 *     enforce MANAGER⇒branchId, so we reject it here at the access boundary).
 */
export async function requireDashboardAccess(): Promise<DashboardScope> {
  const session = await getServerSession();
  if (!session) throw new Error("Unauthorized: authentication required.");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, branchId: true },
  });
  if (!user) throw new Error("Unauthorized: account not found.");

  if (user.role === "ADMIN") {
    return { userId: session.user.id, role: "ADMIN" };
  }
  if (user.role === "MANAGER") {
    if (!user.branchId) {
      throw new Error("Forbidden: this manager has no branch assigned.");
    }
    return { userId: session.user.id, role: "MANAGER", branchId: user.branchId };
  }
  throw new Error("Forbidden: dashboard access requires ADMIN or MANAGER.");
}

/**
 * Collapse a caller's scope + an optionally-requested branch into the single
 * branchId a query must be filtered by — enforcing that a MANAGER can NEVER read
 * another branch.
 *
 *   - MANAGER: pinned to their own branch. Asking for a different branchId is a
 *     hard Unauthorized; asking for their own (or nothing) returns their branch.
 *   - ADMIN:   may target one branch, or get `undefined` meaning "all branches".
 *
 * The returned value is meant to drive a Prisma filter:
 *   const where = branchId ? { branchId } : {};   // {} = unrestricted (ADMIN)
 */
export function resolveBranchScope(
  scope: DashboardScope,
  requestedBranchId?: string,
): string | undefined {
  if (scope.role === "MANAGER") {
    if (requestedBranchId && requestedBranchId !== scope.branchId) {
      throw new Error(
        "Unauthorized: managers can only access their own branch.",
      );
    }
    return scope.branchId;
  }
  // ADMIN: honour an explicit branch filter, otherwise see everything.
  return requestedBranchId;
}
