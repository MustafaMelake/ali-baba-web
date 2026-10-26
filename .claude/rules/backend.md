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

## `"use server"` files may only export async functions and inline types

The framework constraint is about **runtime values**, and the precise boundary matters
because the safe half is used in every action file we have:

- ✅ **Inline type declarations are safe and are the house pattern.** `export type PlaceOrderResult = …` / `export interface CheckoutPayload { … }` are erased by the compiler, leave no runtime binding, and appear throughout the `"use server"` modules (all but one declare at least one). Declaring an action's result union at the top of its own file is correct — don't relocate these.
- ❌ **`export type { X }` re-exports crash the app.** Under Turbopack a re-export in a `"use server"` file is miscompiled into a runtime reference (this caused the checkout "no branches" bug). If you need to surface a type that lives elsewhere, let consumers `import type` it from its real home instead of forwarding it.
- ❌ **Exported runtime values** — `export const`, `let`, `var`, `class`, `enum` — are genuinely illegal here. Put shared constants/helpers in a **plain module** (`@/lib/validators`, `@/lib/action-utils`, `@/lib/utils`).

`src/lib/action-utils.ts` is deliberately *not* `"use server"` for exactly this reason — it exports plain utilities imported *by* action files.

## Don't re-copy the shared helpers

`@/lib/action-utils` is the single home for the consolidated idioms — import, never duplicate:

- `ensureAdmin()` → `{ error } | null` (ADMIN gate that returns an envelope so the UI toasts instead of crashing).
- `ensureAdminSession()` → same gate but returns the session (for actions needing the caller's id, e.g. the self-demotion guard).
- `prismaErrorCode(err)` → uniform `P2002/P2003/P2025` reading.
- `slugify(value)` → the canonical slug (non-latin input → `""`; supply your own fallback if you need a guaranteed non-empty slug, as `menu.ts` does). **Defined in `@/lib/utils` and re-exported here**, because admin forms preview the slug as you type and must call the *same* function the server mints with. `action-utils` is server-only by dependency (its gates import the session reader, which reads request headers), so a `"use client"` component must import `slugify` from `@/lib/utils` — importing it from `action-utils` pulls `next/headers` into the client bundle.

## Authentication & session — one door only

Read sessions **only** through `@/lib/session` (server) or `@/lib/auth-client` (client). **Never import session helpers from `better-auth` directly** — the sole exception is the edge proxy's `getSessionCookie`. This keeps the `cache()` dedupe and the typed `role` field consistent.

| Guard (`src/lib/session.ts`) | On failure | Reads role from |
|---|---|---|
| `getServerSession()` | returns `null` | Better Auth (wrapped in React `cache()` — one hit per request) |
| `requirePasswordCurrent(session)` | **redirects** to `CHANGE_PASSWORD_PATH` | session — holds a user with `mustChangePassword` (admin reset) on `/account/change-password`; called by `/my-orders`, `/wishlist`, the admin layout and `requireAdminPage`. Cached storefront pages never read the session, so the client `PasswordChangeGate` (root layout) holds them there instead |
| `requireAdmin()` | **throws** (also for a `mustChangePassword` caller) | session payload — ADMIN-only **read loaders** (`getAnalytics`, `getAdminFaqs`, …) behind `requireAdminPage` pages. **Mutations never call it directly** — they gate through `ensureAdmin()`/`ensureAdminSession()` (which wrap it) so an expired session becomes a toast, not a crashed page; the product actions were the last direct callers |
| `requireAdminPage()` | **redirects** (`/login` or `/admin`) | session — bounces a MANAGER off ADMIN-only pages |
| `requireDashboardAccess()` | **throws** (also for a `mustChangePassword` user) | **live DB** (`role` + `branchId` + `mustChangePassword`) — for dashboard/orders loaders |
| `resolveBranchScope(scope, requested?)` | throws on foreign branch | — collapses caller × requested into one `branchId \| undefined` |

- `role` and `mustChangePassword` are `input: false` in `src/lib/auth.ts` — a client cannot self-assign a role at signup; promotion is `updateUserRole` or a direct DB write only.
- **Password reset is admin-driven — there is no email provider.** `/forgot-password` only opens a `wa.me` chat to the store's WhatsApp (no account lookup, no request to our server — nothing to enumerate). `resetUserPassword` (ADMIN, never on self) orders its writes **flag → hash → revoke**: set `mustChangePassword`, store a one-time CSPRNG password through Better Auth's own `password.hash` + `internalAdapter.updatePassword` (never hand-rolled hashing), delete every session — so a mid-way failure leaves the user forced to change, never signed in unflagged. The temporary password is returned once: never logged, stored in plain text, or put in a URL. `changeTemporaryPassword` clears the flag **only after** `auth.api.changePassword` succeeds. `nextCookies()` must stay the **last** Better Auth plugin.
- **RBAC is structural, not cosmetic.** Sidebar link-hiding is decoration; every page and every action re-enforces. A `MANAGER` is pinned to their branch: spread `branchWhere = branchId ? { branchId } : {}` at the **top level** of every order-reading `where`. Any new order/revenue query MUST spread it or it's a cross-branch data leak. Row-level writes (`updateOrderStatus`) additionally verify the order's `branchId` matches the manager's.

## The Edge Proxy (`src/proxy.ts`)

- The file is `src/proxy.ts`, exports `proxy(request)` + `config.matcher`. **Never rename it to `middleware.ts`** on Next 16.
- **Edge-safe imports only** — `next/server` and `better-auth/cookies`. **Never** import `@/lib/prisma`, `@/lib/auth`, or any Node module here; it breaks the Edge build.
- **Optimistic, not authoritative.** `getSessionCookie` checks cookie *presence* only (no DB on the Edge). The real check is the in-page `getServerSession()` + `redirect("/login")`, which correctly rejects a present-but-expired cookie. The proxy just turns a forgotten guard into a cheap redirect.
- **Matcher lists each protected root bare *and* wildcarded** (`"/wishlist"`, `"/wishlist/:path*"`; today `/my-orders`, `/wishlist`, `/account`). Adding a protected route = add both entries **and** the in-page session guard. `/checkout` is **deliberately not matched** — checkout supports guest orders (`placeOrder` accepts `userId: null`).

## Data access

- Use the singleton from `@/lib/prisma` (never `new PrismaClient()` in an action). The generated client is imported from `@/generated/prisma/client` and `@/generated/prisma/enums`.
- **Transaction discipline (Neon-aware): keep transactions short and bounded.** `placeOrder` is at most three statements (one batched `findMany({ id: { in: […] } })` carrying the full four-level promotion hierarchy, a pure in-memory loop, the nested order create, and — for a signed-in buyer — one `cartItem.deleteMany` of the ordered lines) — never an N+1 `findUnique`-per-line that holds the transaction open in proportion to cart size. `mergeCartAction` is bounded to ≤ 52 statements.
- Read-only server-only loaders that never take a POST (`dashboard.ts`, `analytics.ts`, the `store-settings.ts` reader) are deliberately **not** `"use server"` — they're server modules imported by RSC pages. The converse also holds: a read a **client island** triggers at interaction time (`getWishlistedProductIds`, `rePriceGuestCart`, `searchCatalog` / `getSearchSuggestions`) **is** a `"use server"` action — that is the only door from the browser to the database. Such a read is public only when it says so: search and guest re-pricing are; the wishlist reads gate on the session.
- **Every export of a `"use server"` file is a public POST endpoint — so every read exported there MUST gate itself on its first line** (`await requireAdmin()` for staff data, a `getServerSession()` check for per-user data), whoever its intended caller is. A read with no gate is allowed only when it is **public by design and says so** in its docblock or module header (today: `getStorefrontFaqs`, `getStorefrontLocations`, `getActiveBranches`, `getBranchStockIssues`, `getPublicPricingSettings`, `rePriceGuestCart`, `searchCatalog`, `getSearchSuggestions`, `countShopProducts` — public catalogue/checkout content only).
- **Documented exception — ADMIN list reads in action files.** By the loader rule above these would be plain modules, but the admin content screens keep their list read next to their mutations: `getAdminFaqs`, `getAdminLocations`, `getFooterLinks`, `getAdminHeroSlides`, `getHeroProductOptions`, `getAdminCollections`, `getAdminCollection` — each opens with `await requireAdmin()` (verified) and is called from a `requireAdminPage` page. A new one is fine **only** with that first-line gate; don't "tidy" these into plain modules without moving every member.

## Revalidation is manual — keep the fan-out lists current

There is no automatic cache discovery. When you add a surface that renders a mutated entity, add its path to that mutation's `revalidatePath` list or it serves stale ISR HTML. Reference fan-outs: product mutations revalidate `/admin/products`, `/shop`, `/new-arrivals`, `/`, and their own `/product/[slug]` — on create (a visit before the slug existed cached a 404), on delete, and both `/product/[oldSlug]` + `/product/[newSlug]` on rename; category create/update/delete revalidate their own `/category/[slug]` for the same reason; promotion mutations bust the whole storefront tree with `revalidatePath("/", "layout")`; pricing-settings and branch mutations revalidate `/cart` (its VAT + delivery-fee preview); `placeOrder` revalidates `/admin`, `/admin/orders`, and `/my-orders` (the last only for a signed-in buyer — a guest order has no such page); hero-slide mutations revalidate `/` and `/admin/hero`; the store-WhatsApp setting revalidates `/admin/settings` and `/forgot-password`; `resetUserPassword` revalidates `/admin/users`. Collection mutations go through one helper, `revalidateCollectionSurfaces` (`src/lib/actions/collections.ts`): `/collections`, `/admin/collections`, each affected `/collections/[slug]`, and every linked `/category/[slug]` read **before and after** the write (so a removed link or a deleted collection still busts the page that showed it). Tag-based reads (`footer-links`, `footer-collections`) invalidate via `updateTag`.

**Collection price freshness — the second tree-wide bust.** A collection can carry promotions, so a mutation that changes *what a promoted collection prices* also calls `revalidatePath("/", "layout")` — exactly what a promotion mutation would. Trigger: any live **or scheduled** promotion (`isActive && endDate ≥ now`) targets an affected collection **and** the write changes membership or existence while it is active, or flips `isActive` either way (`collectionsArePromoted`). An unpromoted collection gets only the targeted fan-out above. Counting scheduled promotions is deliberately conservative (an approved decision) — don't narrow it to "live now" without revisiting that trade.

**The one deliberate exception: listing pages are NOT in the product fan-out.** `/category/[slug]` and `/collections/[slug]` (and every `/page/[n]`) render live variant prices but are left to age out on their own `export const revalidate = 60`. A product price or availability edit can therefore show up to 60s stale on their cards, and **that bound is accepted, not an oversight.** The cart and checkout re-price live, and `placeOrder` bills fresh, so a stale card never changes what is billed. The same 60s window is what already bounds promotion-window staleness on those routes, so they never guarantee better than minute-freshness anyway; paying a targeted bust per product edit would buy nothing a shopper can perceive. Promotion mutations (and priced collection changes) *do* reach them, via the tree-wide `revalidatePath("/", "layout")`. Don't "fix" this by threading category or collection slugs into product mutations — and if you ever tighten these routes' `revalidate`, revisit this trade rather than assuming it still holds.

## Uploads

The real gate is `requireAdminUploader` in `src/app/api/uploadthing/core.ts` (server session read, `role !== "ADMIN"` → `UploadThingError`) — MANAGERs cannot upload. The DB stores only URL strings; orphaned bucket files are purged **best-effort, post-commit** via `deleteUploadedFiles` in `src/lib/uploadthing-server.ts` — a failed purge only logs, it never rolls back or fails the DB write.

**Every image URL an action persists must pass `isHostedImageUrl`** (`@/lib/validators`): https on an UploadThing host (`utfs.io` or one `*.ufs.sh` label — mirroring `next.config` `remotePatterns`) or a `/public` path (no `//`, `/\` or query string). A foreign host makes `next/image` throw at render and takes down the **whole ISR page** showing it (a location card → the homepage), not just the card. Enforced today in the product schemas, the category actions, `validateLocation`, `heroSlideSchema` and `collectionSchema`; a new image column follows suit.
