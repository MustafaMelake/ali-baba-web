# Domain-Driven System Map — Ali Baba Platform

> **Status:** Living architecture document · generated from a full-code audit on **2026-07-10**.
> **Verification basis:** every claim below was read from the actual source in `src/` and `prisma/` — not from prior docs. Where behavior was recently changed by the audit-remediation series (commits `7aeadf3`, `a3421a5`, `ce9af23`, `726134d`), this map describes the **current** (post-fix) behavior and records the history in §18.
> **How to use:** each subsystem section is a self-contained audit unit with six lenses: Overview, Schema & Integrity, File Boundaries, Data Flow, Intersections & Blast Radius, and Technical Debt. §16–§19 hold the cross-cutting tables (cache topology, idiom inventory, intersection matrix, debt ledger, audit ordering).

---

## Table of Contents

- [§0 Global Architecture Snapshot](#0--global-architecture-snapshot)
- [§1 Identity & Session (Authentication)](#1--identity--session-authentication)
- [§2 RBAC & Staff Scoping (Authorization)](#2--rbac--staff-scoping-authorization)
- [§3 Catalog (Products, Variants & Taxonomy)](#3--catalog-products-variants--taxonomy)
- [§4 Promotions / Discount Engine](#4--promotions--discount-engine)
- [§5 Cart & Guest⇄Auth State Sync](#5--cart--guestauth-state-sync)
- [§6 Checkout & Order Pipeline](#6--checkout--order-pipeline)
- [§7 Branch & Fulfillment](#7--branch--fulfillment)
- [§8 Global Store Settings (Pricing Knobs)](#8--global-store-settings-pricing-knobs)
- [§9 Café Menu (Dine-in)](#9--café-menu-dine-in)
- [§10 Reviews & Moderation](#10--reviews--moderation)
- [§11 Wishlist](#11--wishlist)
- [§12 Staff Dashboard & Analytics](#12--staff-dashboard--analytics)
- [§13 Content, Merchandising & Site Chrome](#13--content-merchandising--site-chrome)
- [§14 Media Uploads](#14--media-uploads)
- [§15 Data Access & Persistence Infrastructure](#15--data-access--persistence-infrastructure)
- [§16 Cache Topology & Revalidation Matrix](#16--cache-topology--revalidation-matrix)
- [§17 Intersection Matrix (Blast-Radius Overview)](#17--intersection-matrix-blast-radius-overview)
- [§18 Consolidated Technical-Debt Ledger & Remediation History](#18--consolidated-technical-debt-ledger--remediation-history)
- [§19 Recommended Inch-by-Inch Audit Order](#19--recommended-inch-by-inch-audit-order)

---

## 0 · Global Architecture Snapshot

**Runtime topology.** Next.js 16 App Router, RSC-first. There is **no REST/JSON data API**: all writes flow through Server Actions (`"use server"` files under `src/lib/actions/` plus `src/app/admin/products/actions.ts`), and the only route handlers are vendored pass-throughs — Better Auth's catch-all (`src/app/api/auth/[...all]/route.ts`) and UploadThing (`src/app/api/uploadthing/route.ts`). Read-side loaders that never need a POST surface (`dashboard.ts`, `analytics.ts`, `store-settings.ts` reader) are deliberately *not* `"use server"` — they are server-only modules imported by RSC pages.

**Two businesses, one deployment:**

1. **E-commerce patisserie** — Catalog → Cart → Checkout → Orders → Fulfillment/Dashboard.
2. **Dine-in café menu** — `MenuCategory`/`MenuItem`, sealed off from the commerce pipeline (no variants, no promotions, no orders).

**Client-state inventory (exhaustive):**

| Store | File | Persistence | Purpose |
|---|---|---|---|
| `useCartStore` | `src/lib/cart-store.ts` | `localStorage` (`ali-baba-cart`), partialized to `items` + `pendingOps` | Cart lines + unsynced-intent ledger |
| `useWishlistStore` | `src/lib/wishlist-store.ts` | none (per page-life) | Favorited product-id set |
| `useAdminUi` | `src/lib/admin-ui-store.ts` | none (deliberately) | Admin mobile-nav drawer flag |

**Global providers.** `src/app/layout.tsx` wraps the entire tree (storefront *and* admin) in `<CartSyncProvider>` and mounts the `sonner` `<Toaster>`. `src/app/(shop)/layout.tsx` provides the storefront chrome: fixed `Navbar` (which mounts the `CartSidebar` drawer), the single `<main>` landmark with navbar clearance, and the RSC `Footer`.

**Environment contract:** `DATABASE_URL` (hard-required at module load in `src/lib/prisma.ts` — the app throws without it), `NEXT_PUBLIC_APP_URL` (optional; client auth base URL for SSR/preview).

---

## 1 · Identity & Session (Authentication)

### 1.1 System Overview
Answers "who is this request from?". Email/password credentials via **Better Auth**, DB-backed sessions (not JWTs), auto-sign-in on registration, and the guest⇄authenticated boundary that Cart, Wishlist, Reviews, and Checkout all branch on. Includes the Edge route-guard proxy as its first (optimistic) line of defense.

### 1.2 Database Schema & Integrity
- **`User`** — `email @unique`, `role UserRole @default(USER)`, `branchId String?` → `Branch` (`onDelete: Restrict` — a branch with assigned staff cannot be deleted). Business relations: `orders`, `reviews`, `cartItems`, `wishlist`.
- **`Session`** — `token @unique`, `expiresAt`, `userId` → User (`onDelete: Cascade`), `@@index([userId])`. Sessions are rows, so sign-out and user deletion revoke server-side.
- **`Account`** — provider link; **credential password hash lives here** (`Account.password`), never on `User`. `onDelete: Cascade` with the user.
- **`Verification`** — Better Auth token storage, `@@index([identifier])`.

### 1.3 File Boundaries
| Concern | File |
|---|---|
| Server config | `src/lib/auth.ts` — `betterAuth({ prismaAdapter(postgresql), emailAndPassword: { autoSignIn, minPasswordLength: 8 }, session: { expiresIn: 7d, updateAge: 1d }, user.additionalFields.role: { input: false } })`; `nextCookies()` must remain the **last** plugin |
| HTTP surface | `src/app/api/auth/[...all]/route.ts` (`toNextJsHandler`) |
| Server session reader | `src/lib/session.ts` → `getServerSession` (wrapped in React `cache()` — one Better Auth hit per request no matter how many layouts/pages call it) |
| Browser client | `src/lib/auth-client.ts` (`createAuthClient` + `inferAdditionalFields<typeof auth>` so `session.user.role` is typed client-side); exports `signIn/signUp/signOut/useSession/getSession` |
| Edge guard | `src/proxy.ts` (Next 16's renamed middleware) |
| Auth pages | `src/app/(shop)/login/{page,LoginClient}.tsx`, `src/app/(shop)/signup/{page,SignupClient}.tsx` |
| Open-redirect guard | `src/lib/utils.ts` → `sanitizeRedirect` |
| Type augmentation | `src/types/auth.d.ts` |

### 1.4 Step-by-Step Data Flow
1. **Sign-up:** `SignupClient` pre-validates password ≥ 8, calls `signUp.email({ name, email, password })` → Better Auth creates `User` + `Account` (hash) + `Session`, sets the cookie (`autoSignIn`). `role` is `input: false`, so a forged sign-up payload **cannot** set its own role — DB default `USER` always wins.
2. **Sign-in:** `signIn.email` → session row + cookie. `callbackURL` is forwarded but inert for credential flows; the client's `router.push(redirectTo)` + `router.refresh()` performs the actual navigation (the refresh is what lets `CartSyncProvider` observe the transition).
3. **Redirect round-trip:** `proxy.ts` bounces unauthenticated visits to `/login?redirect=<pathname>`; login and signup carry the param between each other; `sanitizeRedirect` accepts only same-origin relative paths (rejects absolute URLs and the protocol-relative `//host` trick) before any `router.push`.
4. **Edge guard semantics:** `proxy.ts` is **optimistic by design** — `getSessionCookie(request)` checks cookie *presence only* (no DB on Edge). Matcher covers exactly `/my-orders(/:path*)` and `/wishlist(/:path*)`. Real validation always re-happens in the page via `getServerSession`. Its job: turn "developer forgot the page guard" into a cheap redirect instead of a leaked render.
5. **Server reads:** every guard and personalized page funnels through `getServerSession()`; with the Prisma adapter each call validates the session row and loads the user (including `role`) fresh from Postgres.
6. **Sign-out:** `signOut` (client) → session row deleted; `CartSyncProvider` sees `userId → null` and wipes local cart state only (see §5.4).

### 1.5 Intersections & Blast Radius
- **RBAC (§2)** consumes `session.user.role` — changing `additionalFields` breaks every gate's typing.
- **Cart sync (§5)** keys its entire lifecycle off `useSession()` transitions; altering session resolution timing (`isPending` semantics) can double-merge or drop guest carts.
- **Checkout (§6)** stamps `session?.user?.id ?? null` (guest-capable). **Wishlist (§11)**, **Reviews (§10)**, **Uploads (§14)** all hard-gate on the session.
- Renaming/moving the auth cookie breaks `proxy.ts` (`getSessionCookie` must match Better Auth's cookie name).
- `nextCookies()` ordering is load-bearing: plugins after it would lose cookie-setting on Server Action responses.

### 1.6 Technical Debt & Vestigial Code
- `emailVerified` exists on the model but no verification flow is wired; accounts function unverified.
- Proxy matcher list is manual — new protected customer routes must be added by hand (the guard does not discover them).

---

## 2 · RBAC & Staff Scoping (Authorization)

### 2.1 System Overview
Answers "what may this identity do?". Three tiers: `USER` (customer), `MANAGER` (branch-pinned staff), `ADMIN` (super-admin). The invariant "MANAGER ⇒ has a branch" cannot be expressed in Prisma, so it is enforced at **two chokepoints**: assignment time (`updateUserRole`) and access time (`requireDashboardAccess`).

### 2.2 Database Schema & Integrity
- `User.role UserRole` (`USER | ADMIN | MANAGER`), `User.branchId String?` → `Branch` (`onDelete: Restrict`).
- `Branch.managers User[]` (back-relation). No composite constraints; conditionality is app-level by documented necessity (see comment block at `prisma/schema.prisma` User model).

### 2.3 File Boundaries
| Guard | File / Function | Behavior on failure | Used by |
|---|---|---|---|
| `requireAdmin()` | `src/lib/session.ts` | **throws** | Every ADMIN Server Action (directly or via `ensureAdmin` wrappers) |
| `requireAdminPage()` | `src/lib/session.ts` | **redirects** (`/login` or `/admin`) | All 11 ADMIN-only admin pages: users, settings, reviews, promotions, categories, products (+new, +edit), menu, branches, analytics |
| `requireDashboardAccess()` | `src/lib/session.ts` | **throws**; reads `role` + `branchId` **live from the DB**, never the token | `getDashboardStats`, `getOrders`, `updateOrderStatus` |
| `resolveBranchScope(scope, requested?)` | `src/lib/session.ts` | throws if a MANAGER requests a foreign branch; returns `branchId \| undefined` (undefined ⇒ ADMIN unrestricted) | All order/dashboard queries |
| Coarse layout gate | `src/app/admin/layout.tsx` | redirect `/login` (anon) or `/` (USER); admits ADMIN ∨ MANAGER | Entire `/admin/*` surface |
| Role mutation authority | `src/lib/actions/manage-users.ts` → `updateUserRole` | result envelope | `UserRoleEditor` on `/admin/users` |
| Role-aware nav (cosmetic) | `src/components/admin/Sidebar.tsx` (receives `role` prop) | hides links only — **pages enforce** | — |

### 2.4 Step-by-Step Data Flow
1. `/admin/*` request → layout reads `getServerSession()`; anon → `/login`; role ∉ {ADMIN, MANAGER} → `/`.
2. ADMIN-only pages call `requireAdminPage()`: anon → `/login`; MANAGER → bounced back to `/admin` (their permitted dashboard). The two MANAGER-accessible pages — `/admin` (dashboard) and `/admin/orders` — instead rely on their loaders' `requireDashboardAccess()`.
3. Dashboard/orders loaders call `requireDashboardAccess()` → fresh `prisma.user.findUnique({ select: { role, branchId } })`. A demoted or re-assigned manager loses access on their **next request**, not at the 7-day token refresh. MANAGER with `branchId = null` → hard throw (both consuming pages render an "ask an administrator to assign you a branch" empty state).
4. `resolveBranchScope` collapses (caller scope × optional requested branch) into a single Prisma filter value. Every downstream query spreads `branchWhere = branchId ? { branchId } : {}` at the **top level** of `where` — the scoping is structural, not per-callsite optional.
5. Row-level check: `updateOrderStatus` additionally verifies the target order's `branchId === scope.branchId` for managers (unassigned orders are ADMIN-only territory).
6. Role changes: `updateUserRole` validates role ∈ enum, blocks **self-demotion** (`gate.session.user.id === userId && role !== ADMIN` → refused: super-admin lockout guard), requires an *existing* branch for MANAGER (FK pre-validated via `findUnique`), and force-nulls `branchId` for USER/ADMIN. Revalidates `/admin/users` + `/admin`.

### 2.5 Intersections & Blast Radius
- Every admin mutation in §3, §4, §7, §8, §9, §10, §13, §14 sits behind `requireAdmin` — changing its throw contract breaks the ~5 `ensureAdmin` wrapper copies that translate throws into `{ success: false }` envelopes.
- `resolveBranchScope` is the **only** thing standing between a MANAGER and other branches' orders/revenue. Any new order-reading query MUST spread the same `branchWhere`.
- The layout gate and `requireAdmin` read the role from the **session payload**; `requireDashboardAccess` reads it from the **DB**. Both are fresh in practice (DB-backed sessions load the user row per request), but the dual pattern is an intentional asymmetry to keep in mind when touching Better Auth config (e.g., enabling `cookieCache` would make the token-role paths stale-able while the DB path stays fresh).

### 2.6 Technical Debt & Vestigial Code
- No DB `CHECK` constraint backing "MANAGER ⇒ branchId" (schema comment explicitly defers to app logic + a described-but-not-present migration note).
- Products/customers metrics are store-wide even for managers (no `branchId` on Product/User-as-customer) — documented as intended in `dashboard.ts` header, but worth confirming as a business rule.
- The `ensureAdmin` wrapper is duplicated ×5 (promotions, manage-users, manage-branches, settings, store-settings) — consolidation candidate (see §16 idiom inventory).

---

## 3 · Catalog (Products, Variants & Taxonomy)

### 3.1 System Overview
The sellable universe. Cardinal rule (schema comment, enforced everywhere): **prices live ONLY on `ProductVariant`** — carts and orders carry a `variantId` and the server resolves price at read/bill time. The client never supplies a price anywhere in the platform.

### 3.2 Database Schema & Integrity
- **`Category`** — `name @unique`, `slug @unique`; slider/merchandising fields `subtitle`, `image`, `isFeatured`, `sliderOrder` (`@@index([isFeatured, sliderOrder])` matches the homepage read).
- **`Product`** — `slug @unique`, `images String[]`, `isAvailable`, `isFeatured`; `categoryId` → Category **`onDelete: Restrict`** (deleting a used category is impossible at the DB level). Indexes: `slug`, `categoryId`.
- **`ProductVariant`** — `price Decimal`, `compareAtPrice Decimal?` (manual strikethrough), `sku String? @unique`, `isAvailable`; `productId` → Product **`onDelete: Cascade`**. Back-relations: `cartItems`, `orderItems`, `promotions`. (Money is `Decimal`, not `Float` — see §6.6.)
- Deletion physics: `OrderItem.variant` is **`onDelete: Restrict`** (§6) ⇒ *any product that has ever been ordered cannot be hard-deleted*, transitively (product delete cascades to variants, which Restrict blocks). `Review` and `WishlistItem` cascade away with the product.

### 3.3 File Boundaries
- **Validation (shared client/server):** `src/lib/validators.ts` — `variantInputSchema` (name 1–80, `price` positive, `compareAtPrice` nullish with cross-field refine `compareAtPrice > price`, sku ≤ 64), `productInputSchema` / `productUpdateSchema` (name 2–120, slug regex `^[a-z0-9]+(?:-[a-z0-9]+)*$`, description ≤ 2000, `variants.min(1)`).
- **Admin actions:** `src/app/admin/products/actions.ts` (`createProduct`, `updateProduct`, `deleteProduct`); `src/lib/actions/categories.ts` (`createCategory`, `updateCategory`, `deleteCategory` + transactional `ensureUniqueSlug`).
- **Admin UI:** `src/app/admin/products/{page,new/page,[id]/edit/page}.tsx`, `NewProductForm`, `EditProductForm`, `ProductRowActions`, `src/app/admin/categories/page.tsx`, `NewCategoryModal`, `EditCategoryModal`, `CategoryEditButton`, `CreateCategoryButton`, `DeleteCategoryButton`, `MultiSelect`.
- **Storefront:** `src/app/(shop)/shop/page.tsx` + `ShopClient.tsx`; `src/app/(shop)/category/[slug]/page.tsx` + `CategoryPageTemplate.tsx`; `src/app/(shop)/product/[slug]/page.tsx`; islands `ProductCard.tsx`, `products/ProductPurchasePanel.tsx`, `products/VariantSelector.tsx`, `ProductGallery.tsx`.

### 3.4 Step-by-Step Data Flow
**Create:** zod re-parse → single nested `product.create` with `variants.create[]` → P2002 sniffed via `meta.target` to distinguish "SKU taken" vs "slug taken" → revalidates `/admin/products`, `/shop`, `/`.

**Update (the delicate variant reconcile):**
1. Fetch existing variant ids; compute `keptIds` = incoming ids **∩ existing** (an incoming id not owned by this product is treated as *new* — ownership can't be spoofed to hijack another product's variant).
2. `removedIds` = existing − kept.
3. Slug-owner pre-check (`findUnique(slug)`, excluding self) for a clean message before the transaction.
4. Transaction: `product.update` + per-variant `update` (kept) / `create` (new); `compareAtPrice ?? null` so *clearing* the field genuinely wipes a legacy discount.
5. **Post-commit, best-effort** removal loop (deliberately outside the transaction so it can never roll back a valid update): `variant.delete` → on `P2003` (ordered variant) → **archive** instead: `{ isAvailable: false, sku: null }` (frees the unique SKU for reuse), `archivedCount` reported to the UI.
6. Revalidation fan-out: `/admin/products`, `/shop`, `/`, `/product/[newSlug]`, and `/product/[oldSlug]` when the slug changed.

**Delete:** `product.delete` → `P2003` → friendly "appears in existing orders — mark Out of Stock instead".

**Storefront reads:** all three catalog surfaces join `variants` ordered `price: asc` (`[0]` = "starting price" shown on cards) with three-level live-promotion includes, then map through the Discount Engine (§4). `/shop` filters server-side by `?category=` slug; PDP resolves by unique slug with reviews page + aggregate in one `Promise.all`; category page dedupes its lookup via React `cache()` (shared by `generateMetadata`).

### 3.5 Intersections & Blast Radius
- **Cart (§5):** `variantId` is the line identity everywhere; renaming/merging variants changes cart lines' meaning.
- **Orders (§6):** snapshot copies `productName`/`variantName`/`unitPrice` at purchase; the `Restrict` chain makes catalog deletion history-safe. Changing that to Cascade would silently destroy order history.
- **Discount Engine (§4):** every catalog read embeds the three-level promotion include — changing include shapes breaks `gatherPromotions` inputs at 7 call sites.
- **Merchandising (§13):** homepage slider reads Category slider fields; `isFeatured` products surface on `/`.
- Revalidation fan-out lists are **manual** — a new catalog surface must be added to the actions' `revalidatePath` calls or it will serve stale ISR HTML for up to 60s.

### 3.6 Technical Debt & Vestigial Code
- The `compareAtPrice` display fallback chain (live promo base → manual column) is duplicated across 5 read sites (§16) — a drift hazard, not a bug.

---

## 4 · Promotions / Discount Engine

### 4.1 System Overview
Time-windowed discounts (`PERCENTAGE` | `FIXED_AMOUNT`) targeting any mix of whole categories, products, and specific variants. One **pure, dependency-free math module** (`src/lib/discounts.ts` — no Prisma, no React) is shared by every surface, which is the mechanism guaranteeing *the shown price is the billed price*.

### 4.2 Database Schema & Integrity
- **`Promotion`** — `type DiscountType`, `value Decimal`, `startDate`/`endDate DateTime`, `isActive @default(true)`, `@@index([isActive])`.
- Targets via **implicit m:n join tables** (Prisma-managed): `_CategoryToPromotion`, `_ProductToPromotion`, `_ProductVariantToPromotion`. Deleting a promotion removes join rows automatically; deleting a target detaches it. No math/precedence lives in the schema — all app-level by documented design.
- Adjacent mechanism: `ProductVariant.compareAtPrice` is the *manual* "was" price; validators enforce `compareAtPrice > price`. It is the display fallback when no live promotion applies — never an input to promo math.

### 4.3 File Boundaries
- **Math core:** `src/lib/discounts.ts` — `PROMOTION_SELECT_FIELDS` (uniform select), `livePromotionWhere(now)` (`isActive && startDate ≤ now ≤ endDate`, spreadable into relation includes), `isPromotionLive` (strict + NaN-safe re-check), `applyPromotion` (pct: `base × (1 − v/100)`; fixed: `base − v`; floored at 0; `roundMoney`d), `gatherPromotions` (merge + de-dupe by id across the three levels), `resolvePrice` (iterate live promos, **lowest final price wins**, strict `<` so first-found retains ties), `roundMoney` (`Math.round((n + Number.EPSILON) × 100) / 100` — the platform-wide 2-dp authority).
- **Admin:** `src/lib/actions/promotions.ts` (create/update/toggle/delete; validation: name ≥ 2, type ∈ enum, value > 0, pct ≤ 100, parseable dates, `endDate ≥ startDate`, ≥ 1 target after id-cleaning); `src/app/admin/promotions/page.tsx`, `PromotionModal`, `PromotionEditButton`, `PromotionActiveToggle`, `DeletePromotionButton`, `CreatePromotionButton`, `MultiSelect`.
- **Consumers (the full set):** `shop/page.tsx`, `category/[slug]/page.tsx`, `product/[slug]/page.tsx`, `(shop)/page.tsx` (badge only), `lib/actions/cart.ts` (×2 paths), `lib/actions/orders.ts` (billing), `lib/actions/wishlist.ts`.

### 4.4 Step-by-Step Data Flow
1. **Authoring:** admin CRUD → `connect` (create) / `set` (update — the multi-select sends the *full desired* target list, not a delta) → every mutation calls `revalidatePromotionSurfaces()` = `revalidatePath("/admin/promotions")` + **`revalidatePath("/", "layout")`** (nukes the whole storefront route tree so ISR pages re-render with new pricing on next request).
2. **Evaluation (identical at every surface):** capture **one `now` per request** → query promotions pre-filtered by `livePromotionWhere(now)` at all three levels (variant, parent product, product's category) → `gatherPromotions` de-dupes → `resolvePrice(basePrice, promos, now)` re-checks liveness defensively and returns `{ basePrice, finalPrice, discountAmount, hasDiscount, appliedPromotion }`.
3. **Display contract:** `finalPrice` renders as the price; when `hasDiscount`, `basePrice` renders struck-through; otherwise the manual `compareAtPrice` column is the strikethrough fallback. Homepage badge derives "N% OFF" from the strongest percentage promo, else generic "SALE".
4. **Billing:** `placeOrder` runs the *same* pipeline inside its transaction (§6.4 step 6) — the promo evaluated at bill time is stamped into `OrderItem.unitPrice` forever.

### 4.5 Intersections & Blast Radius
**Widest blast radius in the platform.** A change to `resolvePrice`/`livePromotionWhere`/`roundMoney` simultaneously alters: shop cards, category cards, PDP, homepage badges, logged-in cart hydration, guest re-pricing, wishlist cards, and **the amount customers are billed**. The single-`now`-per-request discipline is what prevents a promotion expiring mid-request from pricing two lines of one order inconsistently — any new consumer must follow it. Removing the `revalidatePath("/", "layout")` on mutations would leave ISR'd prices stale for up to 60s after an admin edit.

### 4.6 Technical Debt & Vestigial Code
- **Overlap policy — FORMALIZED (no longer implicit):** "Cheapest Wins" is the officially adopted business rule for overlapping promotions — exactly ONE promotion ever applies (the one yielding the lowest price), promotions never stack, and there is deliberately no priority/exclusivity field. It is codified in the block comment above `resolvePrice` in `src/lib/discounts.ts`. `ProductVariant.compareAtPrice` is a purely **visual marketing** "was" price — never an input to the discount math, only a strikethrough fallback when no live promotion applies.
- **Branch `address` / `phone` retained by decision:** these columns are intentionally kept for planned roadmap use (branch detail / contact surfacing), not dead code awaiting removal.
- `PromotionInput.type` travels as `string` and is set-validated rather than enum-typed end-to-end — minor typing looseness.
- No admin-facing preview of "what will this promotion do to price X" — authoring errors surface only on the storefront.

---

## 5 · Cart & Guest⇄Auth State Sync

### 5.1 System Overview
Holds purchase intent as `{ variantId, quantity }` — **never prices, names, or images** in the DB — across guest and authenticated lives. The hard problems it owns: not double-counting on login-hydrate vs. merging exactly once on sign-in, and never losing offline/failed mutations (the `pendingOps` ledger).

### 5.2 Database Schema & Integrity
- **`CartItem`** — `userId` → User (`Cascade`), `variantId` → ProductVariant (`Cascade` — cart lines vanish with their variant, so orphans are impossible), `quantity Int @default(1)`, **`@@unique([userId, variantId])`** (the upsert key), indexes on both FKs.

### 5.3 File Boundaries
- **Zustand store:** `src/lib/cart-store.ts` — `persist` to `localStorage` key `ali-baba-cart`; SSR-safe via `SERVER_NOOP_STORAGE` (keeps `.persist` API attached during server render — the checkout page reads `useCartStore.persist.onFinishHydration` at render time and would crash otherwise); `partialize` persists exactly `{ items, pendingOps }` (never `isOpen`).
- **Auth-lifecycle brain:** `src/components/providers/CartSyncProvider.tsx` (mounted in the **root** layout, so admin routes participate too).
- **Server actions:** `src/lib/actions/cart.ts` — `mergeCartAction`, `syncCartItemAction`, `getDbCartAction`, `rePriceGuestCart`, `clearDbCartAction`.
- **UI:** `CartSidebar.tsx` (drawer; mounted by `Navbar`), cart badge in `Navbar.tsx`; primary consumer `src/app/(shop)/checkout/page.tsx`.
- **Shared limits:** `CHECKOUT_MAX_QUANTITY = 99` and `CHECKOUT_MAX_ITEMS = 50` from `src/lib/validators.ts` — the store clamps to, the cart actions cap/clamp to, and `checkoutSchema` rejects beyond, the *same* numbers.

### 5.4 Step-by-Step Data Flow

**Local mutation (guest or logged-in):** `addItem` computes the resulting quantity first (`existing + amount`, clamped to 99) and applies it as one state update, keyed strictly by `variantId` (keying by product id was a historical bug that charged Small price for Large items — documented in-store). `updateQuantity < 1` delegates to `removeItem`.

**Logged-in persistence — the record-then-confirm ledger (`fireSync`):**
1. The op `{ quantity, action: SET | DELETE }` is written to `pendingOps[variantId]` **before** the request leaves (intent is never unaccounted for, even if the tab closes).
2. `syncCartItemAction` performs an **absolute** upsert-SET or `deleteMany`-DELETE (idempotent — sidesteps increment races; a no-op delete is silent, not a P2025).
3. On confirmation the entry is cleared **only if it still exactly matches** the sent op (a newer op supersedes and keeps waiting for its own confirmation). On failure it simply stays — persisted to `localStorage` — for the next hydrate to replay.

**Session transitions (`CartSyncProvider`):** distinguishes four cases using `firstResolve` / `knownUserId` refs (waits out `isPending`; guards against session refetch re-runs):
- *Already-logged-in on mount* → **hydrate**: `getDbCartAction` → `adoptDbCart` (no quantity summing ⇒ no double-count).
- *Guest → logged-in* → **the one true merge moment**: `mergeAndSyncCart()`.
- *Logged-in → guest (logout)* → `clearLocalCart()` (local + persisted wipe **including pendingOps**; DB cart deliberately survives for the next sign-in).
- *Account switch A→B* → wipe, then hydrate B.

**Merge (`mergeCartAction`)** *(hardened in commit `7aeadf3`)*: `sanitizeLocalLines` trims/clamps/drops invalid lines, de-dupes by summing, and **caps at `MAX_MERGE_LINES = 50` distinct lines**; the transaction is strictly bounded: one `id IN (…)` variant-existence read, one `IN` read of the user's existing rows, then per-line upsert of the **exact SUM-then-clamp-to-99 value** (Prisma's atomic `increment` cannot express a ceiling; the absolute SET accepts the same "beats increment races" trade `syncCartItemAction` makes).

**Adopt (`adoptDbCart`) — reconcile algorithm:** with no pending ops, the server payload simply overwrites. Otherwise: start from the DB lines map; replay each pending op — `DELETE` ⇒ remove (a failed delete stays deleted); `SET` with a DB line ⇒ keep DB display data, local quantity; `SET` without a DB line ⇒ resurrect from the local line's display data; orphaned ops (no DB row, no local data) are retired. Finally every surviving op is re-fired in the background (`fireSync` self-clears on confirmation).

**Guest price freshness:** guest carts are frozen in `localStorage`, so `refreshPrices()` → public `rePriceGuestCart` (no-auth; de-duped, capped at `MAX_REPRICE_IDS = 100`; read-only; returns live `finalPrice` + `compareAtPrice` chain + availability) updates only changed lines. The checkout page blocks its first render on this (§6.4 step 0) so a guest never sees a total that differs from what they'll be charged.

### 5.5 Intersections & Blast Radius
- **Auth (§1):** the provider's transition detection is the single point deciding merge-vs-hydrate — reordering `useSession` semantics or removing `router.refresh()` after login breaks guest-cart folding.
- **Discounts (§4):** both hydrate paths and the guest re-price flow re-price through `resolvePrice`; cart display prices are *advisory* (placeOrder re-prices regardless).
- **Checkout (§6):** consumes `items`, calls `clearCart()` + `clearDbCartAction()` on success. `clearCart` also drops pendingOps — required, otherwise replay would resurrect a purchased cart.
- **Catalog (§3):** variant Cascade means a deleted variant silently removes DB cart lines; local guest lines for it are left for `placeOrder`'s availability guard to report.

### 5.6 Technical Debt & Vestigial Code
- The DB cart's distinct-line count is now **capped at 50 in `syncCartItemAction`** as well: a `SET` that would introduce a NEW line beyond the cap is rejected with the shared `CART_LIMIT_ERROR` (quantity updates to existing lines are always allowed). The client store (`cart-store.ts`) rolls the optimistic line back and toasts on that specific rejection, so the UI never shows a line the DB refused. (`mergeCartAction` remains separately capped at 50.)
- Cross-device concurrent merges can collapse an increment (documented, accepted trade).
- `getDbCartAction` maps `id` to the **product** id for display/links; any future consumer treating it as a variant id will corrupt merges (the field naming is a foot-gun; the store docs warn about it).

---

## 6 · Checkout & Order Pipeline

### 6.1 System Overview
Converts a cart into an immutable, **server-priced** `Order` with per-line snapshots, then walks it through the status lifecycle (`PENDING → PREPARING → SHIPPED → DELIVERED | CANCELLED`). Guest-capable by design. This is the platform's most consequential write path.

### 6.2 Database Schema & Integrity
- **`Order`** — `orderNumber Int @unique @default(autoincrement())` (human-facing sequence); `userId String?` → User (**`SetNull`** — orders outlive account deletion); money columns `subtotal`, `deliveryFee @default(0)`, `totalAmount` (all `Float`; **VAT is folded into `totalAmount`, never stored** — reconstructed as the residual `total − subtotal − fee` at display time, keeping historical receipts consistent when the admin later changes the rate); `status OrderStatus @default(PENDING)`; `fulfillment FulfillmentMethod @default(DELIVERY)`; `deliveryCity DeliveryLocation?` (**vestigial**, §6.6); `addressLine?`, `pickupBranch?` (free-text label); `branchId String?` → Branch (**`SetNull`** — history survives branch deletion); snapshot contact `customerName`, `customerPhone`, `orderNotes?`. Indexes: `userId`, `status`, `createdAt`, `branchId`.
- **`OrderItem`** — `orderId` → Order (`Cascade`); `variantId` → ProductVariant (**`Restrict`** — the constraint that makes ordered catalog rows undeletable); snapshot columns `productName`, `variantName`, `unitPrice`, `quantity`. Indexes on both FKs.

### 6.3 File Boundaries
- **Contract:** `src/lib/validators.ts` → `checkoutSchema` — items 1–50 (`CHECKOUT_MAX_ITEMS`), quantity int 1–99 (`CHECKOUT_MAX_QUANTITY`), `fulfillment` enum, `addressLine` ≤ 500 with `superRefine` (DELIVERY ⇒ non-empty address; issue attached to the `addressLine` path for inline rendering), `pickupBranch` ≤ 120, `branchId` nullish, name 1–120, phone 1–30, notes ≤ 1000. Shared verbatim by the form (courtesy) and the action (the gate).
- **Writer:** `src/lib/actions/orders.ts` — `placeOrder`, `updateOrderStatus`, `MAX_PENDING_ORDERS_PER_PHONE = 3` throttle.
- **Client page:** `src/app/(shop)/checkout/page.tsx` (single client island: hydration gating, pricing preview, branch selectors, inline zod errors, success state).
- **Customer read:** `src/app/(shop)/my-orders/page.tsx` (`force-dynamic`) + `components/orders/{OrderCard,OrderDetailModal,OrderStatusTabs,StatusPill,types}.tsx`.
- **Staff read/mutate:** `src/app/admin/orders/page.tsx` (`force-dynamic`) + `getOrders` in `src/lib/actions/dashboard.ts` + `components/admin/{AdminOrdersTable,AdminOrderFilters,AdminOrdersPagination,AdminOrderDetailDrawer,order-types}.tsx`.
- **Pricing inputs:** `src/lib/discounts.ts`, `src/lib/store-settings.ts`, `src/lib/actions/branches.ts`.

### 6.4 Step-by-Step Data Flow — `placeOrder`
0. **Client preconditions:** the page blocks rendering until (a) Zustand rehydration finished (`useSyncExternalStore` over `persist.onFinishHydration` — prevents the empty-cart flash), (b) pricing settings fetched (`getPublicPricingSettings`; hardcoded fallback used *only* for preview on fetch failure), (c) guests re-priced (§5.4). Preview math mirrors the server exactly: discounted subtotal → `roundMoney(subtotal × vatRate)` → fee by selection.
1. **Payload:** only `{ variantId, quantity }[]` + fulfillment + contact + resolved `branchId` (pickup branch, chosen delivery-area branch, or `null` for "Other Areas"). No prices cross the wire.
2. **Session (optional):** `userId = session?.user?.id ?? null` — guests welcome.
3. **Validation:** `checkoutSchema.safeParse` server-side; first issue message returned on failure.
4. **Throttle** *(commit `ce9af23`)*: `count(Order where customerPhone = exact ∧ status = PENDING)` — `≥ 3` ⇒ refuse with "Too many pending orders…". Runs before any other DB work; a confirmed/cancelled order frees a slot. Count-then-create is non-atomic (accepted for a throttle).
5. **Branch re-validation:** client-sent `branchId` is only honored if `findFirst({ id, isActive: true })` — stale/forged/inactive ids degrade to `null` (order surfaces to super-admin) rather than failing the order. The row's `deliveryFee` is captured here as the authoritative fee.
6. **Settings read:** `getStoreSettings()` fresh per order — the preview's numbers are never trusted.
7. **The transaction (deliberately exactly two statements, Neon-friendly):**
   a. One batched `productVariant.findMany({ id IN deduped ids })` carrying the full three-level live-promotion hierarchy + product availability.
   b. Pure in-memory loop: missing/unavailable variant (or parent product) ⇒ **throw** — the whole order rolls back, partial orders are impossible. Per line: `gatherPromotions` → `resolvePrice(variant.price, …, now)` (one `now` for the whole order) → accumulate subtotal → push snapshot `{ variantId, productName, variantName, unitPrice: finalPrice, quantity }`.
   c. **Money hygiene** *(commit `a3421a5`)*: `subtotal = roundMoney(subtotal)`; `deliveryFee` = DELIVERY ? `roundMoney(branch.fee ?? settings.defaultDeliveryFee)` : 0; `vat = isVatEnabled ? roundMoney(subtotal × vatRate) : 0`; `totalAmount = roundMoney(subtotal + deliveryFee + vat)`. Four rounding points; nothing off-grid reaches the `Decimal` money columns.
   d. Nested `order.create` with `items.create[]`, `status: PENDING`, resolved `branchId`.
8. **Post-commit:** `revalidatePath("/admin")`, `"/admin/orders"`, and `"/my-orders"` (when authenticated); returns `{ orderNumber, orderId }`.
9. **Client success:** `clearCart()` (local, incl. pendingOps) + `clearDbCartAction()` (when logged in), success screen with order number.

**Status lifecycle — `updateOrderStatus`:** `requireDashboardAccess` (ADMIN|MANAGER, DB-fresh) → status validated against the enum (never trusts the wire) → MANAGER path re-reads the order's `branchId` and refuses foreign/unassigned orders → `order.update` → revalidates board + dashboard. `P2025` → "no longer exists".

### 6.5 Intersections & Blast Radius
The convergence point of the platform: **Discounts** (billing math), **Branch** (fee + RBAC stamp), **Settings** (VAT/default fee), **Auth** (optional identity), **Cart** (payload source + post-order clearing), **Dashboard/Analytics** (every revenue figure downstream is `totalAmount` aggregates). The VAT-residual convention couples three read sites (`dashboard.ts`, `my-orders`, admin drawer serialization) to the invariant `total = subtotal + fee + vat` — storing VAT differently requires touching all of them.

### 6.6 Technical Debt & Vestigial Code
- **`DeliveryLocation` enum + `Order.deliveryCity`** — vestigial: checkout no longer sends a city (branch selection replaced it); the column persists for legacy rows and is still mapped into both order views. Migration decision pending.
- **`Order.pickupBranch` free text** vs. the authoritative `branchId` — schema comment marks the migration as deliberately out of scope; the dual encoding remains.
- **Money columns are `Decimal`** *(migrated from `Float`)* — every currency field (variant `price`/`compareAtPrice`, `Promotion.value`, order `subtotal`/`deliveryFee`/`totalAmount`, `OrderItem.unitPrice`, `Branch.deliveryFee`, `StoreSettings.defaultDeliveryFee`, `MenuItem.price`) is now `Decimal`, so no binary-float drift can accumulate at rest. `StoreSettings.vatRate` stays `Float` (a rate, not a currency amount). Prisma hands `Decimal` back as objects, so every read `.toNumber()`s at the client-component serialization boundary (`discounts.ts` accepts `number | Decimal`); writes still pass plain numbers, which Prisma coerces.
- **`placeOrder`'s catch returns `err.message` verbatim** — intentional for the availability-guard messages, but a raw Prisma error would leak internals to the client. Candidate: whitelist known messages.
- **No throttle-supporting index** — `@@index([customerPhone, status])` would future-proof the count as volume grows (today `@@index([status])` suffices because PENDING stays small).
- **Phone is not normalized** — `+20 100…` and `0100…` are distinct throttle keys and distinct search targets.
- **`/my-orders` is unpaginated** (`findMany` unbounded per user) — negligible per-customer today; flag for heavy accounts.

---

## 7 · Branch & Fulfillment

### 7.1 System Overview
Physical locations wearing **four hats simultaneously**: pickup point, delivery area, per-branch delivery-fee source, and the unit of MANAGER RBAC. Retirement is a soft switch (`isActive: false`); deletion is deliberately hard.

### 7.2 Database Schema & Integrity
- **`Branch`** — `name @unique`, `slug @unique`, `address?`, `phone?`, `isActive @default(true)`, `deliveryFee Decimal @default(35)`.
- Referenced by: `User.branchId` (**`Restrict`** — staffed branches cannot be deleted), `Order.branchId` (**`SetNull`** — order history survives deletion, rows become "unassigned" = super-admin-only visibility).

### 7.3 File Boundaries
- **Public read:** `src/lib/actions/branches.ts` → `getActiveBranches()` (no auth; `isActive`, name-asc; `{ id, slug, name, deliveryFee }` — fee is display-only, re-read at billing).
- **Admin CRUD:** `src/lib/actions/manage-branches.ts` (`createBranch`, `updateBranch`, `deleteBranch`; `validateBranchInput`: name ≥ 2, slug slugified to non-empty, fee finite ≥ 0 rounded 2-dp with default 35, zero = free delivery; P2002 `meta.target` sniffing for name-vs-slug messages).
- **UI:** `src/app/admin/branches/page.tsx`, `BranchModal`, `CreateBranchButton`, `BranchEditButton`, `DeleteBranchButton`; checkout's `BranchSelect` + the synthetic `OTHER_AREAS_OPTION` (`id: "__other__"` sentinel → `branchId: null`); homepage `BranchSelector.tsx` (presentational); the per-branch fee sheet inside `updateDeliveryFees` (§8).

### 7.4 Step-by-Step Data Flow
1. Checkout mounts → `getActiveBranches()` fills both selectors (pickup list; delivery-area list + "Other Areas"). Arabic sublabels are a client-side cosmetic map keyed by slug (`menouf`, `beba`) — not stored.
2. Selection → payload `branchId` (or `null`); pickup also carries the human `pickupBranch` name label.
3. `placeOrder` re-validates (§6.4 step 5): real + active, else null; captures the authoritative fee.
4. Fee resolution: routed DELIVERY → branch fee; branchless DELIVERY → `StoreSettings.defaultDeliveryFee`; PICKUP → 0.
5. Delete: pre-count assigned users → refuse with actionable message; `P2003` catch covers the assignment race; success revalidates `/admin/branches`, `/admin`, `/admin/orders`.

### 7.5 Intersections & Blast Radius
- **RBAC (§2):** the branch id *is* the manager scope — deleting/deactivating a branch strands its manager (dashboard renders the "no branch" empty state after `SetNull`? No — `User.branchId` is `Restrict`, so the manager must be reassigned first; the guard is structural).
- **Checkout (§6):** fee source; the `__other__` sentinel must never reach the server (it maps to `null` client-side) — a change there silently mis-routes orders.
- **Analytics (§12):** all four charts key on active branches; deactivating one removes its series while its historical orders remain counted only in branch-attached rollups.
- **Settings (§8):** `updateDeliveryFees` writes `Branch.deliveryFee` rows transactionally.

### 7.6 Technical Debt & Vestigial Code
- Checkout's Arabic `BRANCH_SUBLABELS` are hardcoded client-side for two seeded slugs — new branches show name-only. Candidate: an optional `sublabel` column.
- `Branch.address` / `Branch.phone` exist but no surface writes or renders them today — **retained by decision** for planned roadmap use (branch detail / contact surfacing), not vestigial (see §4.6).

---

## 8 · Global Store Settings (Pricing Knobs)

### 8.1 System Overview
A **single-row** table (`id = "store"`) holding VAT (rate + master switch) and the branchless-delivery default fee. One shared reader guarantees the checkout *preview* and the *bill* can't disagree about what the settings are.

### 8.2 Database Schema & Integrity
- **`StoreSettings`** — `id String @id @default("store")` (fixed singleton; never a second row), `vatRate Float @default(0.14)` (**a fraction**, edited as a percentage — kept `Float` on purpose, it is a rate not currency), `isVatEnabled @default(true)`, `defaultDeliveryFee Decimal @default(35)`.

### 8.3 File Boundaries
- **Reader (server-only, strictly read-only):** `src/lib/store-settings.ts` — `getStoreSettings()` (PK lookup; missing row answered from the frozen `DEFAULT_PRICING_SETTINGS`, which **must mirror schema defaults**; never upserts — this runs on hot public paths).
- **Actions:** `src/lib/actions/store-settings.ts` — `getPublicPricingSettings()` (public preview read; exposes nothing the order summary doesn't render), `updateVatSettings` (percent ∈ (0, 100], stored as fraction rounded to 4-dp so 14.25% → 0.1425 exactly; validated even while VAT is disabled so a bad value can't lie dormant), `updateDeliveryFees` (default + per-branch sheet in **one transaction**; `parseFee` ∈ [0, 10 000] rounded 2-dp; `MAX_FEE` blocks fat-finger typos). The upserts here are the **only** code that creates the row.
- **UI:** `src/app/admin/settings/page.tsx` (ADMIN-gated) + `PricingSettingsManager.tsx`.

### 8.4 Step-by-Step Data Flow
Checkout mount → `getPublicPricingSettings` (preview) ‖ `placeOrder` → `getStoreSettings` (billing) — same reader, same row, same defaults. Admin save → upsert (row born on first save) → `revalidatePath("/admin/settings")`.

### 8.5 Intersections & Blast Radius
Exactly two money consumers: checkout preview and `placeOrder`. The documented failure mode is *"the preview can drift only if this file and orders.ts stop sharing that reader"* — any refactor must preserve the single-reader property. `DEFAULT_PRICING_SETTINGS` drifting from schema defaults would make pre-first-save behavior differ from post-first-save.

### 8.6 Technical Debt & Vestigial Code
- Duplicate of `roundMoney`'s formula inline in `parseFee`/`updateVatSettings` rather than importing it — drift hazard only.
- No history/audit trail of setting changes (VAT changes silently re-contextualize the residual VAT math on *display* of old orders — the residual convention absorbs this by design, but the rate at time-of-sale is not recorded anywhere).

---

## 9 · Café Menu (Dine-in)

### 9.1 System Overview
The physical café's digital menu. **Deliberately sealed** from commerce: items are not purchasable, have no variants, no promotions, no cart/order path. Managed at `/admin/menu`, rendered at `/menu`.

### 9.2 Database Schema & Integrity
- **`MenuCategory`** — `title`, `slug @unique`, `order @default(0)` (`@@index([order])`), `isFixedPrice @default(false)` ("Smoothies mode": every item shares one price; the storefront renders a flavour grid + single price badge, the shared price *read from the items, which are kept equal*).
- **`MenuItem`** — `name` (typically Arabic, rendered RTL), `price Decimal`, `order`, `categoryId` → MenuCategory (**`Cascade`** — items die with their category). Indexes on `categoryId`, `order`.

### 9.3 File Boundaries
`src/lib/actions/menu.ts` (all seven actions, each behind `requireAdmin`); `src/app/(shop)/menu/page.tsx` (ISR 3600) + `MenuClient.tsx` (scroll-spy nav over category slugs); `src/app/admin/menu/page.tsx` + `menu/{MenuCategoryCard,MenuCategoryModal,MenuItemsEditor,BulkPriceModal,CreateMenuCategoryButton}.tsx`.

### 9.4 Step-by-Step Data Flow
1. **Category create/update:** transactional; `slugify` falls back to a random `menu-xxxxxx` token when an Arabic title slugifies to `""` (the scroll-spy always needs a valid DOM anchor); `ensureUniqueSlug` appends `-2, -3, …`; omitted `order` appends to the end (`max + 1` inside the tx).
2. **Item CRUD:** name 1–120, price finite ∈ [0, 1 000 000]; create appends per-category order; FK race (`P2003`) → "category no longer exists".
3. **Bulk price adjust:** percentage ∈ (−100, 1000], ≠ 0 → **one atomic SQL statement**: `UPDATE "MenuItem" SET price = ROUND((price * factor)::numeric, 2), "updatedAt" = NOW() WHERE "categoryId" = …` — in-DB math (no read-modify-write race), `::numeric` cast because Postgres lacks 2-arg `round(double precision)`, explicit `updatedAt` because raw SQL bypasses `@updatedAt`. Uniform scaling keeps fixed-price categories internally equal. Returns affected-row count.
4. Every write → `revalidatePath("/menu")` + `"/admin/menu"` (read-your-own-writes inside the 1-hour ISR window).

### 9.5 Intersections & Blast Radius
Only RBAC (admin gates). No other system reads these models. **Do not** confuse `MenuCategory` (café) with `Category` (catalog) — two different models.

### 9.6 Technical Debt & Vestigial Code
- `isFixedPrice` consistency is *by construction* (bulk scaling + admin discipline), not by constraint — a direct item edit inside a fixed-price category can desync the grid price.
- None otherwise; this is the cleanest sealed subsystem.

---

## 10 · Reviews & Moderation

### 10.1 System Overview
Authenticated, once-per-product customer reviews, hidden until ADMIN approval. Gating is client-hydrated so the PDP stays ISR-cacheable.

### 10.2 Database Schema & Integrity
- **`Review`** — `rating Int` (1–5 app-enforced), `comment String` (required column; `""` stored when omitted), `authorName` (display-name **snapshot** at submission), `isApproved @default(false)`, `userId` → User (`Cascade`), `productId` → Product (`Cascade`), **`@@unique([userId, productId])`** (the P2002 from a duplicate submit *is* the "already reviewed" error path), indexes on `productId`, `isApproved`.

### 10.3 File Boundaries
`src/lib/actions/reviews.ts` (`submitProductReview` — FormData + zod: rating coerced int 1–5, comment preprocessed `"" → undefined` then 3–2000 optional; `hasUserReviewedProduct` — returns `false` for guests *and on error* so the form is never wrongly suppressed; ADMIN `approveReview` / `deleteReview`); `ReviewGate.tsx` (client island: session + already-reviewed resolution post-paint), `ReviewForm.tsx`, `StarRating.tsx`; `src/app/admin/reviews/page.tsx` + `ReviewActions.tsx`; PDP consumption in `product/[slug]/page.tsx`.

### 10.4 Step-by-Step Data Flow
Submit (auth required; identity + `authorName` from session, never the form) → product FK pre-checked for a clean message → created `isApproved: false` → PDP revalidated (for later approvals) → admin approves (revalidates `/admin/reviews` + the PDP) or deletes (revalidates the PDP only if it had been approved — cheap correctness). PDP renders the newest **20** approved reviews (`REVIEWS_PAGE_SIZE`) while count/average come from a full-set DB `aggregate` — the cap bounds the RSC payload, never the numbers; a truthful "showing N of M" caption stands in for the not-yet-built load-more.

### 10.5 Intersections & Blast Radius
Auth (identity), Catalog (PDP render; cascade with product), RBAC (moderation). The client-side gating is what keeps the PDP ISR — moving the session check into the RSC would force the route dynamic.

### 10.6 Technical Debt & Vestigial Code
- "Load more" beyond the newest 20 is a documented future client fetch — not built.
- `authorName` snapshots go stale on rename (by design — snapshot semantics; confirm as intended).

---

## 11 · Wishlist

### 11.1 System Overview
Per-user favorited products with instant hearts on **cached** catalog pages — the store exists precisely so catalog routes could become ISR (per-user state was moved out of the HTML).

### 11.2 Database Schema & Integrity
- **`WishlistItem`** — `userId` → User (`Cascade`), `productId` → Product (`Cascade`), **`@@unique([userId, productId])`**, indexes on both.

### 11.3 File Boundaries
`src/lib/actions/wishlist.ts` (`toggleWishlist`, `getWishlistItems`, `getWishlistedProductIds`); `src/lib/wishlist-store.ts` (id-set store); `products/WishlistButton.tsx` (heart island — calls `ensureLoaded` once its session resolves); `src/app/(shop)/wishlist/page.tsx` (`force-dynamic`); proxy guard on `/wishlist` (§1).

### 11.4 Step-by-Step Data Flow
1. **Hydration:** cached page paints empty hearts → first `WishlistButton` triggers `ensureLoaded(userId)` — idempotent per user; guests resolve to a known-empty set with **zero network** (which also wipes the previous user's hearts on sign-out); a stale fetch racing an account switch is discarded via a `userId` recheck before commit.
2. **Toggle:** optimistic flip → `toggleWishlist` (findUnique → delete | create; concurrent-add `P2002` treated as `{ success, added: true }`; `P2003` → product gone) → reconcile to the server's returned state, rollback on failure. Guests get the sign-in message with no fake flip.
3. **Page:** `getWishlistItems` returns card-ready rows — starting price = lowest *available* variant, priced through the Discount Engine with the standard `compareAtPrice` fallback chain.

### 11.5 Intersections & Blast Radius
Auth, Discounts (§4 display chain), Catalog (cascade), Edge proxy. Every heart on every surface derives from the one shared set — a toggle anywhere updates all instances of that product at once; breaking the store's identity check breaks cross-page consistency.

### 11.6 Technical Debt & Vestigial Code
- `revalidatePath("/wishlist")` fires on every toggle even from catalog pages — harmless but usually wasted work.
- None structural.

---

## 12 · Staff Dashboard & Analytics

### 12.1 System Overview
Two read-only loaders: the branch-scoped operational dashboard + orders board (ADMIN and MANAGER), and the ADMIN-only cross-branch analytics comparison. All heavy math happens **in Postgres** (aggregates, groupBys, two raw-SQL rollups) — raw order rows are never pulled into Node for computation.

### 12.2 Database Schema & Integrity
No models of its own — aggregates over `Order`, `OrderItem`, `User`, `Product`, `Branch`. Governing rules: **REVENUE (money) strictly counts `DELIVERED` orders only** — `status: DELIVERED` on every revenue aggregate, groupBy, and raw rollup (formalized business rule; unconfirmed PENDING/PREPARING/SHIPPED cash is never reported as revenue). **Order-volume counters** may still include active orders (they exclude at most `CANCELLED` — e.g. today/yesterday counts, peak-hours activity). All calendar-day and month boundaries are **Africa/Cairo** wall-clock converted to exact UTC instants (see §12.4).

### 12.3 File Boundaries
`src/lib/actions/dashboard.ts` (`getDashboardStats`, `getOrders`, `ORDERS_PAGE_SIZE = 50`); `src/lib/actions/analytics.ts` (`getAnalytics`); `src/lib/timezone.ts` (`STORE_TZ` + DST-safe Cairo midnight/month → UTC-instant helpers shared by both loaders); pages `src/app/admin/page.tsx`, `src/app/admin/analytics/page.tsx` (both `force-dynamic`); charts `RevenueChart.tsx`, `analytics/{BranchSalesChart,PeakHoursChart}.tsx`; `src/lib/analytics-palette.ts` (stable per-branch colors by name-sorted index).

### 12.4 Step-by-Step Data Flow
**`getDashboardStats`:** scope → `branchWhere` → **12 parallel queries** in one `Promise.all` (all-time / last-30 / prev-30 revenue aggregates, today/yesterday order counts, product + customer counts (store-wide by design — no branchId on those models), 5 recent orders, 30-day chart rows, branch-name lookup) → JS buckets chart rows into 30 **Cairo** calendar days. Every window boundary (today / yesterday / last-30 / prev-30) is a Cairo midnight converted to an exact UTC instant via `storeMidnight` (DST-safe calendar arithmetic in `src/lib/timezone.ts` — never the server's local midnight, matching analytics' SQL `AT TIME ZONE` bucketing). The revenue aggregates and the chart read **`DELIVERED` orders only**; the today/yesterday counters remain volume (status-agnostic).

**`getOrders`** *(cursor-paginated — offset `skip` removed)*: scope → order-number search via raw ``SELECT id FROM "Order" WHERE "orderNumber"::text ILIKE ${%q%}`` (an Int column can't `contains`; candidate ids may span branches but `branchWhere` is ANDed at the top level, so no cross-branch leak) → `findMany` with `take: ±(50 + 1)` + `cursor: { id }` + `skip: 1` (excludes only the cursor row — **no offset skip**) over the deterministic compound order `[{ createdAt: desc }, { id: desc }]` (id tie-break ⇒ unique cursor positions) ‖ `groupBy(status)` for tab counters → the sentinel 51st row yields `hasMore` (direction `next`) / `hasPrevious` (direction `prev`, fetched with a **negative take** that walks backwards from the cursor); `total` = active tab's counter (zero extra queries); the payload carries `startCursor`/`endCursor` (first/last row ids) for the pager → serialized `AdminOrderView[]` with VAT as the residual. Page cost is independent of depth — the offset scale ceiling (D-16) is gone.

**`getAnalytics`** (ADMIN-only): active branches drive every series (zero-order branches still chart) → four parallel datasets: all-time + current-month (Cairo calendar month via `storeMonthStart`) groupBys — both **`DELIVERED`-only** (revenue datasets); peak hours via raw SQL — `EXTRACT(HOUR FROM "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo')::int`, `COUNT(*)::int` (casts avoid BigInt serialization), **30-day window** (parameter-bound) so stale seed data can't skew it — pure volume, so it keeps the broader not-`CANCELLED` filter; top products via `OrderItem ⋈ Order` rollup (**`DELIVERED`-only**, top-3 per branch sliced in JS) → axis trimmed to the active trading window (fallback 8 AM–11 PM) → "Star of the Month" with revenue share.

### 12.5 Intersections & Blast Radius
RBAC (every query is scope-filtered — a new metric that forgets `branchWhere` is a cross-branch data leak), Orders (substrate; the VAT-residual and not-CANCELLED conventions), Branch (series identity/colors). The `AdminOrderFilters`/`AdminOrdersPagination` pair share the URL-param contract (`status`, `query`, `cursor`, `dir`; filter changes delete the cursor pair — a stale cursor id may not exist under the new filter) — changing param names breaks both plus the page's parsers.

### 12.6 Technical Debt & Vestigial Code
- None open — the timezone asymmetry (D-12), PENDING-revenue rule (D-13), and offset-pagination scale ceiling (D-16) were all resolved this cycle; see §18.1.

---

## 13 · Content, Merchandising & Site Chrome

### 13.1 System Overview
The editorial shell: admin-managed footer navigation, the curated homepage (featured-category slider + promo badges), and the fixed chrome (Navbar/CartSidebar/Footer).

### 13.2 Database Schema & Integrity
- **`FooterLink`** — `label`, `url`, `group @default("Explore")` (column heading; links sharing a group form one column), `order @default(0)` (drives in-column order *and* column order via earliest link), `isActive @default(true)`, `@@index([isActive, order])` (matches the storefront read).
- Merchandising fields live on **Catalog** models: `Category.{subtitle,image,isFeatured,sliderOrder}`, `Product.isFeatured`.

### 13.3 File Boundaries
`src/lib/actions/settings.ts` (footer CRUD + transactional `reorderFooterLinks` — full id list rewritten to index positions, no dupes/gaps possible; `validateLink` URL scheme whitelist: `/…`, `#…`, `http(s)://` only — **blocks `javascript:` hrefs an admin might paste**); `src/components/layout/Footer.tsx` (RSC; `unstable_cache` key `footer-managed-links`, tag `footer-links`, TTL 3600; **no hardcoded fallback by design** — empty table or DB failure collapses the nav section rather than rendering dead links; zero client JS); `FooterLinksManager.tsx`, `FooterLinkModal.tsx`; homepage `src/app/(shop)/page.tsx` (**ISR 60** as of `726134d`) + `Hero`, `CategorySlider`, `OurStory`, `FeaturesBar`, `BranchSelector`; `Navbar.tsx` (mounts `CartSidebar`, cart badge), `UserMenu.tsx`; layouts `src/app/layout.tsx` + `src/app/(shop)/layout.tsx`; `src/lib/admin-ui-store.ts`.

### 13.4 Step-by-Step Data Flow
Footer: RSC read through the tagged cache → every settings write calls `updateTag("footer-links")` → next render is fresh (read-your-own-writes) with a 1-hour safety TTL behind it. Homepage: `getSliderCategories` (`isFeatured`, ordered `sliderOrder asc` + `createdAt desc` tie-break for determinism) with live category promos → `discountLabelFor` (strongest percentage → "N% OFF", any other live promo → "SALE") → ISR-60 HTML; category mutations `revalidatePath("/")`, promotion mutations bust the layout tree.

### 13.5 Intersections & Blast Radius
Catalog (slider fields), Promotions (badges), RBAC (settings gate). The footer's URL whitelist is a *security* control (stored-XSS-via-href) — do not relax it. The `(shop)` layout owns the single `<main>` and the navbar clearance padding; pages must not re-add `pt-16/20` (documented double-offset hazard).

### 13.6 Technical Debt & Vestigial Code
- Hero/OurStory/FeaturesBar copy is hardcoded (fine; noting the boundary between managed and static content).

---

## 14 · Media Uploads

### 14.1 System Overview
Admin-only image ingestion into UploadThing's bucket. The database stores only URL strings (`Product.images String[]`, `Category.image String?`); persistence of those strings happens later through the catalog Server Actions, which re-gate independently.

### 14.2 Database Schema & Integrity
No models. Referential integrity between DB URLs and bucket objects is enforced **best-effort at mutation time**: product/category deletes and image-replacing updates purge the old bucket files via `UTApi` (`src/lib/uploadthing-server.ts` → `deleteUploadedFiles`), strictly post-commit so a failed purge can never roll back or fail the DB write (it only logs). There is no background reconciliation sweep.

### 14.3 File Boundaries
`src/app/api/uploadthing/core.ts` — `requireAdminUploader(req)` middleware (server-side session read + `role !== "ADMIN"` ⇒ `UploadThingError`; this is *the real gate*, executed before any upload is admitted); routes `productImage` (≤ 4 MB × 4) and `categoryImage` (≤ 4 MB × 1); `src/app/api/uploadthing/route.ts`; `src/lib/uploadthing.ts` (typed client helpers); `src/lib/uploadthing-server.ts` (`UTApi` admin client + `deleteUploadedFiles` best-effort purge — extracts file keys from stored `…/f/<key>` URLs, silently skips `/public` paths). Consumers: `NewProductForm`, `EditProductForm`, category modals; purge callers: product + category delete/update actions.

### 14.4 Step-by-Step Data Flow
Client widget → UploadThing → middleware authorizes per-request → file lands in bucket → `ufsUrl` returned via `onClientUploadComplete` → the URL enters the form state → persisted by `createProduct`/`updateProduct`/category actions. On the way out: `deleteProduct`/`deleteCategory` capture the stored URLs **before** the row is deleted and purge them after the delete commits; `updateProduct`/`updateCategory` purge whichever images the save removed or replaced (all best-effort — a Restrict-blocked delete purges nothing, since the row keeps its media).

### 14.5 Intersections & Blast Radius
RBAC (§2), Catalog (§3). MANAGERs cannot upload (ADMIN-only middleware) — consistent with catalog being ADMIN-only.

### 14.6 Technical Debt & Vestigial Code
- `@uploadthing/react/styles.css` is deliberately **not** imported (it bundles a Tailwind-v3 reset that collapses the admin sidebar); widgets are styled via `appearance` props — do not "fix" this by importing it (documented in `admin/layout.tsx`).

---

## 15 · Data Access & Persistence Infrastructure

### 15.1 System Overview
The Prisma/Neon substrate plus the platform's shared coding idioms.

### 15.2 Key Files & Configuration
- `src/lib/prisma.ts` — `PrismaClient` with **`@prisma/adapter-pg`** driver adapter; `dns.setDefaultResultOrder("ipv4first")` (Neon's hostname advertises AAAA + A; broken IPv6 routes caused intermittent `ETIMEDOUT` — IPv4-first removes that failure mode); hard-throws without `DATABASE_URL`; dev-mode `globalThis` memo prevents hot-reload connection leaks.
- `prisma/schema.prisma` — generator `prisma-client` emitting to `src/generated/prisma` (checked in; imported as `@/generated/prisma/client` and `/enums`), datasource URL supplied by `prisma.config.ts`.
- `src/lib/validators.ts` — the shared-schema pattern (plain module importable from both client components and `"use server"` files).
- `src/lib/action-utils.ts` — the consolidated Server-Action helpers (`prismaErrorCode`, `ensureAdmin` / session-returning `ensureAdminSession`, `slugify`). A plain module (not `"use server"`) imported by every action file; **server-only** by dependency (the admin gates pull in the session reader).
- Transaction discipline (Neon-aware): `placeOrder` is exactly two statements; `mergeCartAction` is bounded to ≤ 52 statements; menu/category slug loops run inside their transactions but iterate on unique-check misses only.

### 15.3 Recurring Idioms (audit once, then verify consistency)

| Idiom | Copies | Locations |
|---|---|---|
| `prismaErrorCode(err)` | **1 — consolidated** | `src/lib/action-utils.ts`, imported by every action file (was ×11) |
| `ensureAdmin()` throw→envelope gate | **1 — consolidated** | `src/lib/action-utils.ts` (+ session-returning `ensureAdminSession` for manage-users' self-demotion guard) — was ×5 |
| `slugify()` | **1 — consolidated** | `src/lib/action-utils.ts` (was ×3 in actions); menu wraps it in a local `menuSlug` (random-token fallback for Arabic titles); the client-form copies (`NewProductForm`, `EditProductForm`, `BranchModal`) stay local by necessity — action-utils is server-only |
| Transactional `ensureUniqueSlug` suffix loop | 2 | categories, menu (different models — kept per-domain) |
| `{ success: true, … } \| { success: false, error }` envelopes | all actions | uniform except thrown-guard actions (categories, menu, reviews moderation, products) which *throw* on auth instead |
| Single-`now`-per-request promo evaluation | 7 | every Discount Engine consumer |
| `compareAtPrice` fallback chain (promo base → manual column) | 5 | shop, PDP, wishlist, `rePriceGuestCart`, category template |
| P2002 `meta.target` sniffing for field-specific messages | 4 | products (×2), categories, manage-branches |

**The infra-idiom consolidation landed** (D-15 → §18.1): the top three rows now live in `src/lib/action-utils.ts`. The remaining rows are semantic patterns rather than copy-paste helpers and deliberately stay per-domain — treat them as a *consistency checklist*, not individual bugs.

---

## 16 · Cache Topology & Revalidation Matrix

| Surface | Strategy | Staleness bound | Invalidated by (writer → mechanism) |
|---|---|---|---|
| `/` homepage | **ISR 60** | 60 s (promo time-expiry only) | category actions → `revalidatePath("/")`; product actions → `revalidatePath("/")`; promotion actions → `revalidatePath("/", "layout")` |
| `/product/[slug]` | ISR 60 | 60 s | product actions (both slugs on rename); review approve/delete; promotions (layout) |
| `/category/[slug]` | ISR 60 | 60 s | `updateCategory` (own slug); promotions (layout) |
| `/shop` | per-request dynamic (reads `searchParams`) | none | n/a (revalidatePath calls exist but are inert-in-effect) |
| `/menu` | ISR 3600 | 1 h | all menu actions → `revalidatePath("/menu")` |
| Footer link query | `unstable_cache` tag `footer-links`, TTL 3600 | tag-immediate / 1 h safety | settings actions → `updateTag("footer-links")` |
| `/my-orders`, `/wishlist` | `force-dynamic` | live | (also `revalidatePath` from placeOrder / wishlist toggle) |
| `/admin`, `/admin/orders`, `/admin/users` | `force-dynamic` | live | plus explicit `revalidatePath` from mutations |
| `getServerSession` | React `cache()` | per-request | n/a |
| Category page slug lookup | React `cache()` | per-request (dedupe with `generateMetadata`) | n/a |

---

## 17 · Intersection Matrix (Blast-Radius Overview)

Read row → depends on column. ● = hard dependency (breaks), ○ = soft (degrades).

| System ↓ / on → | Auth §1 | RBAC §2 | Catalog §3 | Discounts §4 | Cart §5 | Orders §6 | Branch §7 | Settings §8 | Uploads §14 |
|---|---|---|---|---|---|---|---|---|---|
| **RBAC §2** | ● role field | — | — | — | — | — | ● branch unit | — | — |
| **Catalog §3** | — | ● admin gates | — | ○ price joins | — | ● Restrict chain | — | — | ● image URLs |
| **Discounts §4** | — | ● admin gates | ● targets | — | — | — | — | — | — |
| **Cart §5** | ● transitions | — | ● variant ids | ● re-pricing | — | — | — | — | — |
| **Checkout/Orders §6** | ○ optional id | ● status RBAC | ● variant read | ● billing | ● payload/clear | — | ● fee + stamp | ● VAT/fee | — |
| **Branch §7** | — | ● admin gates | — | — | — | ○ SetNull history | — | ○ fee sheet | — |
| **Menu §9** | — | ● admin gates | — | — | — | — | — | — | — |
| **Reviews §10** | ● identity | ● moderation | ● PDP/cascade | — | — | — | — | — | — |
| **Wishlist §11** | ● identity | — | ● cascade | ○ display price | — | — | — | — | — |
| **Dashboard §12** | — | ● scoping | ○ counts | — | — | ● substrate | ● series | — | — |
| **Merchandising §13** | — | ● settings gate | ● slider fields | ○ badges | — | — | ○ homepage selector | — | ○ category image |

**Highest-blast-radius modules:** `src/lib/discounts.ts` (7 consumers incl. billing), `src/lib/session.ts` (every guard), `src/lib/validators.ts` (client + server contracts), `roundMoney` (all money everywhere).

---

## 18 · Consolidated Technical-Debt Ledger & Remediation History

### 18.1 Remediation already landed (this audit cycle)

| Commit | Finding | Fix |
|---|---|---|
| `7aeadf3` | H-2 unbounded merge payload · M-1 quantity overflow | `mergeCartAction`: 50-line cap + SUM-then-clamp-to-99 upserts |
| `a3421a5` | M-3 float drift | `placeOrder`: 4-point `roundMoney` enforcement (subtotal, fee, VAT, total) |
| `ce9af23` | H-1 guest order spam | ≤ 3 PENDING orders per exact `customerPhone` |
| `726134d` | M-4 homepage `revalidate = 0` · M-2 orders board 50-row cap | Homepage ISR 60; `getOrders` skip/take pagination + `AdminOrdersPagination` |
| _(vestigial-code purge)_ | D-1 `MenuPage` vestigial model · D-8 dead `/forgot-password` link · `ProductVariant.sortOrder` unused | **Purged** the `MenuPage` model + `Product.menuPageId` relation/index, the `ProductVariant.sortOrder` column, all their validator/form/action code, and the dead login link. Variants now sort strictly by `price: asc` everywhere (incl. the admin promotions & edit-product reads). Requires a Prisma migration to drop the DB objects. |
| _(Decimal + cart-cap + i18n + rule)_ | D-5 `Float` money columns · D-11 unbounded DB cart · D-17 hardcoded Arabic sublabels · §4.6 "implicit" overlap policy | Migrated all ten currency columns **`Float → Decimal`** (with `.toNumber()` serialization at every client-component boundary; `discounts.ts` accepts `number \| Decimal`; `vatRate` stays `Float`). Capped distinct DB-cart lines at 50 in `syncCartItemAction` (+ client rollback/toast via `CART_LIMIT_ERROR`). Removed the hardcoded `BRANCH_SUBLABELS` — checkout renders the unified `branch.name`. **Formalized** the "Cheapest Wins" promo rule in `discounts.ts`. The Decimal change requires a Prisma migration to `ALTER` the column types. |
| _(dashboard/analytics remediation)_ | D-12 server-local TZ day-bucketing · D-13 revenue counted PENDING money · D-16 offset-pagination scale ceiling | Added `src/lib/timezone.ts` (DST-safe `Africa/Cairo` midnight/month → exact UTC instants; shared `STORE_TZ`) and rewired every dashboard window + chart bucket to Cairo calendar days, matching analytics' SQL `AT TIME ZONE` (analytics' month window + label are Cairo-pinned too). Revenue now **strictly counts `DELIVERED`** orders across the dashboard aggregates/chart, branch sales, star-of-month, and the top-products raw SQL (volume counters — today/yesterday, peak hours — deliberately unchanged). `getOrders` migrated from `skip/take` offset pagination to **id-cursor pagination**: compound `createdAt desc, id desc` order, sentinel `±(50+1)` take, `startCursor`/`endCursor` + `hasMore`/`hasPrevious`; pager + filters moved to a `cursor`/`dir` URL contract with stale-cursor recovery. |
| _(infra consolidation + storage hygiene)_ | D-15 idiom duplication · D-14 orphaned UploadThing files · D-3 dead `updateTag("categories")` | Extracted `prismaErrorCode` (was ×11), `ensureAdmin` (was ×5; plus the session-returning `ensureAdminSession` variant manage-users needs) and `slugify` (was ×3) into **`src/lib/action-utils.ts`** — every `src/lib/actions/*` file and `app/admin/products/actions.ts` now imports the single copy (menu keeps its random-token slug fallback as a thin `menuSlug` wrapper; client-form slugify copies stay, the util is server-only). Added **`src/lib/uploadthing-server.ts`** (`UTApi` + `deleteUploadedFiles`): product/category deletes capture stored URLs pre-delete and purge post-commit; image-replacing updates purge the removed/replaced files — all best-effort, never failing the DB write. Removed the dead `updateTag("categories")` calls from all three category mutations (tag registered nowhere; the footer's `footer-links` tag is untouched). |

### 18.2 Open ledger

| # | Domain | Item | Class |
|---|---|---|---|
| D-2 | §6 | `DeliveryLocation` enum + `Order.deliveryCity` — checkout no longer writes it; views still map it | Vestigial column |
| D-4 | §6 | `Order.pickupBranch` free text alongside authoritative `branchId` | Pending migration |
| D-6 | §6 | No `@@index([customerPhone, status])` backing the throttle count | Perf (future) |
| D-7 | §6 | Phone numbers not normalized (throttle keys + search) | Correctness edge |
| D-9 | §6 | `placeOrder` catch returns `err.message` verbatim (Prisma leak potential) | Hardening |
| D-10 | §6 | `/my-orders` unpaginated per-user `findMany` | Perf (minor) |
| D-18 | §1 | `emailVerified` present but unused; no verification flow | Feature gap |

---

## 19 · Recommended Inch-by-Inch Audit Order

Money first, then authorization, then state sync; the sealed café menu last:

1. **§6 Checkout & Orders** (most consequential write path)
2. **§4 Discount Engine** (widest blast radius)
3. **§5 Cart & Sync** (most complex state machine — `pendingOps` replay semantics)
4. **§2 RBAC** (every guard, every `branchWhere` spread)
5. **§7 Branch + §8 Settings** (fee/VAT inputs to money)
6. **§3 Catalog** (variant reconcile + deletion physics)
7. **§12 Dashboard & Analytics** (aggregate correctness, TZ, scoping)
8. **§11 Wishlist + §10 Reviews** (smaller auth-gated CRUD)
9. **§13 Merchandising + §14 Uploads + §1 Identity edges** (chrome, caches, dead links)
10. **§9 Café Menu** (sealed unit)

---

*End of map. Keep this document in lock-step with the code: any PR that moves a file boundary, changes a Prisma constraint, or adds a cache surface should update the relevant section and the tables in §16–§18.*
