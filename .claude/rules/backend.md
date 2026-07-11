# Backend Rules — Server Actions, Auth & Routing

Scope: `src/lib/actions/**`, `src/app/admin/products/actions.ts`, `src/lib/session.ts`,
`src/proxy.ts`, `src/app/api/**`. The platform has **no REST/GraphQL data API** — all
writes are Server Actions; the only route handlers are the vendored pass-throughs
(`src/app/api/auth/[...all]/route.ts` and `src/app/api/uploadthing/route.ts`).

## The Server Action contract

- **Return a discriminated union, never throw to the client:**
  ```ts
  type Result = { success: true; /* … */ } | { success: false; error: string };
  ```
  The body is uniformly `try { … } catch (err) { return { success: false, error: "…" } }`.
- **Translate Prisma error codes, don't leak them.** Read the code with `prismaErrorCode(err)` from `@/lib/action-utils` and map: `P2002` → "already exists / already reviewed" (inspect `meta.target` when a message must distinguish fields), `P2003` → foreign-key ("appears in existing orders — mark Out of Stock instead"), `P2025` → "no longer exists". Anything unrecognized → a generic message **plus** `console.error` for server diagnosis.
- **Re-validate every payload server-side** with the shared Zod schema from `@/lib/validators` — the *same* schema the client form uses, re-parsed because the client is never trusted.

## `"use server"` files may ONLY export async functions

This is a hard framework constraint — **do not** put a `type`, `interface`, `const`, or `export type { … }` re-export in a `"use server"` module. Under Turbopack an `export type { X }` in a `"use server"` file is miscompiled into a runtime reference and **crashes the app at runtime** (this caused the checkout "no branches" bug). Put shared types/constants/helpers in a **plain module** (e.g. `@/lib/validators`, `@/lib/action-utils`) and `import type` them where needed. `src/lib/action-utils.ts` is deliberately *not* `"use server"` for exactly this reason — it exports plain utilities imported *by* action files.

## Don't re-copy the shared helpers

`@/lib/action-utils` is the single home for the consolidated idioms — import, never duplicate:

- `ensureAdmin()` → `{ error } | null` (ADMIN gate that returns an envelope so the UI toasts instead of crashing).
- `ensureAdminSession()` → same gate but returns the session (for actions needing the caller's id, e.g. the self-demotion guard).
- `prismaErrorCode(err)` → uniform `P2002/P2003/P2025` reading.
- `slugify(value)` → the canonical slug (non-latin input → `""`; supply your own fallback if you need a guaranteed non-empty slug, as `menu.ts` does).

## Authentication & session — one door only

Read sessions **only** through `@/lib/session` (server) or `@/lib/auth-client` (client). **Never import session helpers from `better-auth` directly** — the sole exception is the edge proxy's `getSessionCookie`. This keeps the `cache()` dedupe and the typed `role` field consistent.

| Guard (`src/lib/session.ts`) | On failure | Reads role from |
|---|---|---|
| `getServerSession()` | returns `null` | Better Auth (wrapped in React `cache()` — one hit per request) |
| `requireAdmin()` | **throws** | session payload — gate on every ADMIN-only Server Action |
| `requireAdminPage()` | **redirects** (`/login` or `/admin`) | session — bounces a MANAGER off ADMIN-only pages |
| `requireDashboardAccess()` | **throws** | **live DB** (`role` + `branchId`) — for dashboard/orders loaders |
| `resolveBranchScope(scope, requested?)` | throws on foreign branch | — collapses caller × requested into one `branchId \| undefined` |

- `role` is `input: false` in `src/lib/auth.ts` — a client cannot self-assign a role at signup; promotion is `updateUserRole` or a direct DB write only. `nextCookies()` must stay the **last** Better Auth plugin.
- **RBAC is structural, not cosmetic.** Sidebar link-hiding is decoration; every page and every action re-enforces. A `MANAGER` is pinned to their branch: spread `branchWhere = branchId ? { branchId } : {}` at the **top level** of every order-reading `where`. Any new order/revenue query MUST spread it or it's a cross-branch data leak. Row-level writes (`updateOrderStatus`) additionally verify the order's `branchId` matches the manager's.

## The Edge Proxy (`src/proxy.ts`)

- The file is `src/proxy.ts`, exports `proxy(request)` + `config.matcher`. **Never rename it to `middleware.ts`** on Next 16.
- **Edge-safe imports only** — `next/server` and `better-auth/cookies`. **Never** import `@/lib/prisma`, `@/lib/auth`, or any Node module here; it breaks the Edge build.
- **Optimistic, not authoritative.** `getSessionCookie` checks cookie *presence* only (no DB on the Edge). The real check is the in-page `getServerSession()` + `redirect("/login")`, which correctly rejects a present-but-expired cookie. The proxy just turns a forgotten guard into a cheap redirect.
- **Matcher lists each protected root bare *and* wildcarded** (`"/wishlist"`, `"/wishlist/:path*"`). Adding a protected route = add both entries **and** the in-page session guard. `/checkout` is **deliberately not matched** — checkout supports guest orders (`placeOrder` accepts `userId: null`).

## Data access

- Use the singleton from `@/lib/prisma` (never `new PrismaClient()` in an action). The generated client is imported from `@/generated/prisma/client` and `@/generated/prisma/enums`.
- **Transaction discipline (Neon-aware): keep transactions short and bounded.** `placeOrder` is exactly two statements (one batched `findMany({ id: { in: […] } })` carrying the full three-level promotion hierarchy, then a pure in-memory loop) — never an N+1 `findUnique`-per-line that holds the transaction open in proportion to cart size. `mergeCartAction` is bounded to ≤ 52 statements.
- Read-only server-only loaders that never take a POST (`dashboard.ts`, `analytics.ts`, the `store-settings.ts` reader) are deliberately **not** `"use server"` — they're server modules imported by RSC pages.

## Revalidation is manual — keep the fan-out lists current

There is no automatic cache discovery. When you add a surface that renders a mutated entity, add its path to that mutation's `revalidatePath` list or it serves stale ISR HTML. Reference fan-outs: product mutations revalidate `/admin/products`, `/shop`, `/`, and both `/product/[oldSlug]` + `/product/[newSlug]` on rename; promotion mutations bust the whole storefront tree with `revalidatePath("/", "layout")`; `placeOrder` revalidates `/admin`, `/admin/orders`, and `/my-orders`. Tag-based reads (`footer-links`) invalidate via `updateTag`.

## Uploads

The real gate is `requireAdminUploader` in `src/app/api/uploadthing/core.ts` (server session read, `role !== "ADMIN"` → `UploadThingError`) — MANAGERs cannot upload. The DB stores only URL strings; orphaned bucket files are purged **best-effort, post-commit** via `deleteUploadedFiles` in `src/lib/uploadthing-server.ts` — a failed purge only logs, it never rolls back or fails the DB write.
