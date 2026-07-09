# Ali Baba — System Management & Architecture Report

**Audience:** new developers onboarding onto the codebase, and stakeholders who want an accurate, current picture of what's been built.
**Scope:** this is the operational reference for the whole platform — storefront, authentication, multi-branch fulfillment, the discount engine, checkout, and the admin operational engine. It describes what happens, in what order, why it's built that way, and which file owns each behavior. Everything below is read directly from the current `src/` tree; there are no aspirational sections.

---

## 1. Executive Summary & Core Stack

Ali Baba is a server-rendered, server-validated e-commerce platform for a patisserie business: a public storefront (catalog, product detail with multi-variant purchasing, wishlist, checkout, order history) and an authenticated, role-gated admin console (`/admin`) for running the business day to day — now across **multiple physical branches**, with a server-side **Discount Engine** and a Super-Admin **Advanced Analytics** suite.

| Layer | Choice | Why it's here |
|---|---|---|
| Framework | **Next.js 16.2** (App Router) | Server Components as the default data layer; Server Actions replace a separate REST/GraphQL API; the request interceptor is `src/proxy.ts` (Next 16's renamed middleware — see §2). |
| UI runtime | **React 19.2** | `useTransition` for every mutation; `cache()` for request-level dedupe; no legacy `useEffect`-driven loading state. |
| Styling | **Tailwind CSS v4** | Utility-first, design-token driven (serif headings, `stone-*` neutral palette, a single turquoise `primary` accent, rounded-full pills). |
| Database | **PostgreSQL (Neon)** via **Prisma 7** (`@prisma/adapter-pg` driver adapter) | Serverless-friendly connection handling; typed queries; raw SQL escape hatch when the typed query builder can't express something (see §3.2 and §5.7). |
| Auth & RBAC | **Better Auth 1.6** | Session-based; a `role` field on `User` (`USER` \| `ADMIN` \| `MANAGER`) gates the admin console. `ADMIN` is the Super Admin (sees everything); `MANAGER` is scoped to a single `Branch` via `User.branchId`. Always read through the project's `@/lib/session` wrapper (`getServerSession` / `requireAdmin` / `requireAdminPage` / `requireDashboardAccess`) on the server, or `@/lib/auth-client` on the client — never import session helpers from `better-auth` directly. See §5.5. |
| Client state | **Zustand 5** (`persist` middleware) | Used narrowly, for the cart only ([`src/lib/cart-store.ts`](../src/lib/cart-store.ts)). The cart is keyed by **`variantId`** — the purchasable unit — not the parent product id (see §4). Everything else — admin tables, filters, wishlist counts — is server state, re-fetched through Server Components rather than cached on the client. |
| Pricing | **Discount Engine** ([`src/lib/discounts.ts`](../src/lib/discounts.ts)) | A pure, dependency-free price resolver. The same math runs on the storefront, the cart, the checkout summary **and** inside `placeOrder`, so a customer is always billed exactly the price they were shown (see §6). |
| Motion / feedback | `framer-motion`, `sonner` | Inline transitions, sliding tab/pill indicators, slide-over drawers, and toast feedback for every mutation. |

**Design philosophy:** every page — storefront or admin — renders fully populated on first load. There is no spinner-then-fetch pattern anywhere in the app, because data comes from Prisma queries running directly inside Server Components. Every mutation (place an order, toggle a wishlist heart, change an order's status, edit a product, moderate a review, run a promotion) happens through a Server Action invoked from a small Client Component, wrapped in `useTransition` so the UI never blocks or full-page-reloads. The result feels like a single-page app while staying server-rendered, server-validated, and credential-free on the client: prices, statuses, branch scope, and permissions are never trusted from the browser. The platform is **multi-branch** — every order is routed to a fulfilling `Branch`, branch managers see only their own branch's data, and every promotional price is resolved server-side by the Discount Engine before VAT and delivery are ever added.

---

## 2. Authentication, the Edge Proxy & Routing

Auth and route protection are platform infrastructure shared by storefront and admin. This section is the canonical description; the admin-security lens is mirrored in [`ARCHITECTURE.md` §7](./ARCHITECTURE.md) and the customer-facing login UX is in [`STOREFRONT_ARCHITECTURE.md` §4`](./STOREFRONT_ARCHITECTURE.md).

### 2.1 The auth stack

- **Server config** — [`src/lib/auth.ts`](../src/lib/auth.ts): `betterAuth` with the Prisma adapter, email+password (`autoSignIn`, `minPasswordLength: 8`), 7-day sessions refreshed daily, and `nextCookies()` as the **last** plugin so it can set cookies on action/route responses. The `role` field is declared as an `additionalFields` entry with `input: false` and `defaultValue: "USER"` — **a client cannot assign itself a role at signup**; an admin or manager is promoted by a privileged action (`updateUserRole`, §5.5) or a direct database write only.
- **Server reads** — [`src/lib/session.ts`](../src/lib/session.ts): `getServerSession()` is wrapped in React `cache()`, so a layout and a page that both need the user in one request hit Better Auth once.
- **Three roles, two staff tiers.** `UserRole` is `USER` \| `ADMIN` \| `MANAGER`, and [`src/lib/session.ts`](../src/lib/session.ts) exposes the matching guards:
  - `requireAdmin()` — throws on anyone who isn't the Super Admin; the gate on every Super-Admin-only Server Action (products, branches, users, promotions).
  - `requireAdminPage()` — page-level guard that **redirects** a signed-in MANAGER back to `/admin` (used on ADMIN-only pages like promotions and analytics).
  - `requireDashboardAccess()` — admits **ADMIN or MANAGER** and resolves the caller's branch scope. Critically, `role` **and** `branchId` are read **live from the database**, not from the session token (the token only carries `role`, never `branchId`), so a demoted or re-assigned user loses access on their very next request, not whenever the 7-day token happens to refresh. A `MANAGER` with no `branchId` is rejected here at the access boundary (the schema can't enforce "MANAGER ⇒ branchId"). See §5.5.
- **Client reads** — [`src/lib/auth-client.ts`](../src/lib/auth-client.ts): `createAuthClient` + `inferAdditionalFields<typeof auth>()`, so `session.user.role` is typed on the client. Exports `signIn` / `signUp` / `signOut` / `useSession` / `getSession`.

### 2.2 The Edge Proxy (`src/proxy.ts`)

Next.js 16 renames the root request interceptor from `middleware` to **`proxy`** — the framework resolves `PROXY_FILENAME = "proxy"` at `(?:src/)?proxy`. The project follows this strictly: the file is [`src/proxy.ts`](../src/proxy.ts), **not** `middleware.ts`. It is an **optimistic, edge-safe** guard:

```ts
export function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);   // better-auth/cookies — presence check only
  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/my-orders", "/my-orders/:path*", "/wishlist", "/wishlist/:path*"],
};
```

- **Optimistic by design.** `getSessionCookie` confirms a Better Auth cookie is *present*; it does not validate it against Postgres (Prisma can't run on the Edge). The proxy converts "a new protected page shipped without a guard" into a cheap redirect — it is not the security boundary.
- **Edge-safe.** It imports only `next/server` and `better-auth/cookies`. Never import `@/lib/prisma` or `@/lib/auth` here.
- **Defense in depth.** The protected pages still run `getServerSession()` + `redirect("/login")` themselves ([`/wishlist`](../src/app/(shop)/wishlist/page.tsx), [`/my-orders`](../src/app/(shop)/my-orders/page.tsx)). The admin surface is gated separately in its layout (§5) and re-checked in every loader/action. The proxy is the first cheap gate; `getServerSession()` stays the source of truth and correctly rejects a present-but-expired cookie that slipped past the Edge.

### 2.3 The login flow — Server Component Suspense boundary

[`/login/page.tsx`](../src/app/(shop)/login/page.tsx) is a Server Component whose only responsibility is to wrap the interactive form in a `<Suspense>` boundary:

```tsx
export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginClient />
    </Suspense>
  );
}
```

The boundary is **required**, not cosmetic: [`LoginClient.tsx`](../src/app/(shop)/login/LoginClient.tsx) reads `useSearchParams()` to recover the proxy's `?redirect=` intent, and Next.js forces any search-params reader under a Suspense boundary or the entire route opts out to client-side rendering at build time. The `LoginFallback` is an `animate-pulse` skeleton sized to the real two-column layout, reusing the same skeleton convention as the navbar's auth state — so there's no blank flash on a client-side navigation into `/login`.

**Open-redirect hardening — a globally shared guard.** The `redirect` value is attacker-controllable (anyone can hand-craft `/login?redirect=https://evil.com` — it never had to pass through our proxy to arrive). The application is protected by `sanitizeRedirect`, a single function exported from [`@/lib/utils`](../src/lib/utils.ts) — **not** a private helper duplicated inside `LoginClient.tsx` — so the same protection is isomorphic and importable from any Server Component, Client Component, or Server Action that ever needs to honor a `?redirect=` value:

```ts
// src/lib/utils.ts
export function sanitizeRedirect(path: string | null): string {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return "/"
  return path
}
```

`LoginClient` imports it and runs the proxy's `?redirect=` value through it before navigating: `const redirectTo = sanitizeRedirect(searchParams.get("redirect"))`. Only a single-slash, same-origin relative path survives; absolute URLs and the protocol-relative `//host` trick (which browsers resolve to a different origin) both fall back to `"/"`. On a successful `signIn.email`, navigation is driven by `router.push(redirectTo)` followed by `router.refresh()` — Better Auth's vanilla email sign-in does not auto-navigate (its `callbackURL` is only acted on by redirect-based flows like OAuth), so the explicit `router.push` is what completes the round-trip back to the originally-requested page.

Because the guard lives in `@/lib/utils` rather than one client island, any future redirect-consuming surface — a signup flow honoring `?redirect=`, a password-reset return path, a Server Action that needs to validate a callback target — imports the same function instead of re-implementing (and potentially drifting from) the open-redirect policy. There is exactly one definition of "what counts as a safe redirect" for the whole app.

### 2.4 Routing topology

Two App Router route groups, two dynamic segment routes:

| Route | Resolved by | Notes |
|---|---|---|
| `src/app/(shop)/**` | — | Public storefront; account routes gated by the proxy + in-page check |
| `src/app/admin/**` | — | Staff console for **ADMIN + branch-scoped MANAGER**; the layout admits both roles, and the per-page/per-action guards (`requireAdminPage` / `requireDashboardAccess`) enforce the finer scope (§5.5) |
| `(shop)/product/[slug]/page.tsx` | `Product.slug` (`@unique`) | Product detail page |
| `(shop)/category/[slug]/page.tsx` | `Category.slug` (`@unique`) | **The single** category landing route — one file serves every core and standard category (§3.1) |

---

## 3. Storefront & Catalog Architecture

### 3.1 Dynamic category routing + `cache()` dedupe

There is exactly **one** category route, [`src/app/(shop)/category/[slug]/page.tsx`](../src/app/(shop)/category/[slug]/page.tsx) — the previous five hand-written `category/<core-slug>/page.tsx` files (one per `CategoryIdentifier`) have been removed entirely. The dynamic route resolves any category by its unique `slug`, so it serves both core categories (those carrying a `CategoryIdentifier`) and standard ones with a single render path.

The route is the platform's reference example of **request-level query deduplication**. Both `generateMetadata` (for SEO `<title>`/canonical/OpenGraph tags) and the page component need the same `Category` row. Wrapping the lookup in React's `cache()` collapses what would be two identical Postgres reads into one:

```ts
const getCategoryBySlug = cache((slug: string) =>
  prisma.category.findUnique({ where: { slug } }),
);
```

Both `generateMetadata` and `CategoryPage` call `getCategoryBySlug(slug)`; the second call within a request is served from React's memo — **one** round-trip per request. A miss renders `notFound()` (HTTP 404) and a `"Category Not Found"` title. Products are filtered by the resolved, indexed `categoryId` FK (not re-derived from `identifier`), their variants and live promotions are included so the grid can price each card through the Discount Engine (§6), and the page is `export const dynamic = "force-dynamic"` because [`CategoryPageTemplate`](../src/components/CategoryPageTemplate.tsx) seeds per-user wishlist hearts — it must never render from a shared ISR cache that would leak one user's state to the next.

**Footer links — now DB-backed, not a coupling caveat.** [`Footer.tsx`](../src/components/layout/Footer.tsx) no longer links into this route via a hardcoded constant array. The main nav columns are now driven by the `FooterLink` model (see §5.8), so an admin-authored link's `url` is whatever the admin typed — not derived from a category's current `name`/`slug` — and a category rename in the admin can no longer silently 404 a footer link. (If no managed links exist yet, the footer falls back to a live `prisma.category.findMany` read for its "Collection" column, not the old static array.)

### 3.2 Homepage slider & `/shop` directory

The homepage ([`(shop)/page.tsx`](../src/app/(shop)/page.tsx)) projects up to five `Category` rows where `identifier` is non-null, ordered by the enum's declaration order, into the Embla [`CategorySlider`](../src/components/CategorySlider.tsx). The `/shop` catalog directory relies on high-performance **Server-Side filtering via URL `searchParams`**: `ShopPage` reads `?category=slug` and narrows the `Product` query in Postgres (`...(categoryParam ? { category: { slug: categoryParam } } : {})`) — there is no in-memory `.filter()` over a fully-loaded product array. This keeps the data layer clean and prevents a client-side bottleneck as the catalog scales: `/shop` and `/shop?category=bakery` are two genuinely different, narrowly-scoped reads, so the grid only ever ships the rows it renders, no matter how large the catalog grows. [`ShopClient.tsx`](../src/app/(shop)/shop/ShopClient.tsx) keeps the pill-click UX instant despite the server round-trip by wrapping the URL navigation in `useTransition` and pushing with `router.push(..., { scroll: false })`, so the sticky filter bar and Framer Motion's grid animation are never disrupted by a hard reload. Full detail (the `CategoryIdentifier` mechanism, slot-transfer semantics, the `useTransition`/`searchParams` filtering pattern) is in [`STOREFRONT_ARCHITECTURE.md` §1](./STOREFRONT_ARCHITECTURE.md).

### 3.3 Product Detail Page — multi-variant client islands

The PDP ([`(shop)/product/[slug]/page.tsx`](../src/app/(shop)/product/[slug]/page.tsx)) is a Server Component that fetches the product, its variants (`orderBy: { price: "asc" }`), the live promotions targeting the variant / product / category levels, its approved reviews, the session, and the wishlist state in a single `Promise.all`. It prices **each** variant through the Discount Engine server-side (§6) before handing the **full variant set** to a client island — multi-variant products are now fully selectable by customers, which was previously a gap.

- [`ProductPurchasePanel.tsx`](../src/components/products/ProductPurchasePanel.tsx) (client) groups price, variant selection, quantity stepper, and the Add-to-Cart CTA into one island. It holds a single `useState<string>` source of truth — `selectedVariantId` — and **derives** the displayed price, sold-out state, and the cart payload from the active variant. Nothing is stored in parallel state, so the price node can never drift from the selected pill. It defaults to the cheapest *available* variant (`variants.find(v => v.isAvailable) ?? variants[0]`), preserving the "from {price}" promise shown on product cards.
- [`VariantSelector.tsx`](../src/components/products/VariantSelector.tsx) (client, stateless/presentational) renders a **single-axis** row of pills — one per `variant.name`, each showing that variant's own price — matching the flat `ProductVariant` shape (a free-text `name`, not a size×color matrix). It returns `null` for single-variant products, exposes `role="radiogroup"`/`role="radio"` semantics, and keeps sold-out variants **in the DOM but disabled** (strikethrough price) so the option stays indexable rather than vanishing.
- **CLS & a11y:** every price node uses `tabular-nums` so switching from `60` to `450` never reflows the row. `compareAtPrice` is now **driven by the Discount Engine** (§6): when a live promotion lowers a variant's catalogue price, the page passes the discounted amount as `price` and the original as `compareAtPrice`, which renders as a struck-through "was" price with an `aria-label="Original price … EGP"`; when no live promotion applies, the variant's own manual `compareAtPrice` column is preserved as-is. The CTA carries a dynamic `aria-label` describing the quantity and line total.

This replaced the old single-component `ProductAddToCart`, which only ever surfaced the cheapest variant. Crucially, the variant selector and the cart's `variantId` keying (§4) shipped together — a selector that lets a customer add two variants of one product would have been money-incorrect against a product-id-keyed cart.

---

## 4. The Cart — variant-keyed integrity, dual-mode persistence

The cart runs in **two modes** depending on auth state. A guest's cart is **client-only**: Zustand + `persist` to `localStorage` under the key `"ali-baba-cart"` ([`src/lib/cart-store.ts`](../src/lib/cart-store.ts)). A **logged-in** customer gets the same local store, but it is now also **synced to the database** (`CartItem`) in the background, giving them a cross-device cart. (Earlier revisions of this document described the cart as client-only with no server sync for any user — that is no longer accurate; only the *guest* path is still client-only.)

### 4.1 Zustand as the optimistic frontend

Regardless of auth state, **Zustand is always the thing the UI reads from** — every mutation applies to the local store first and renders instantly, with zero latency. When the user is logged in, that same mutation is also fired off to a Server Action to persist it, but the UI never waits on that round-trip:

```ts
// src/lib/cart-store.ts
addItem: (newItem, isLoggedIn) => {
  const existing = get().items.find((i) => i.variantId === newItem.variantId);
  const newQuantity = existing ? existing.quantity + 1 : 1;

  set((s) => ({
    items: existing
      ? s.items.map((i) => i.variantId === newItem.variantId ? { ...i, quantity: newQuantity } : i)
      : [...s.items, { ...newItem, quantity: 1 }],
    isOpen: true,
  }));

  // Fire-and-forget DB mirror — only when authenticated. The optimistic local
  // state above has already applied; this just keeps Postgres in step.
  if (isLoggedIn) fireSync(newItem.variantId, newQuantity, "SET");
},
// removeItem(variantId, isLoggedIn) and updateQuantity(variantId, qty, isLoggedIn) follow the same pattern.
```

`fireSync` calls [`syncCartItemAction`](../src/lib/actions/cart.ts) (`"use server"`) and only logs on failure — it never rolls back the optimistic UI, since the next hydrate/merge cycle (§4.3) reconciles any divergence. `SET` upserts the line to an **absolute** quantity (idempotent — a late-arriving `SET` simply overwrites, sidestepping increment races), and `DELETE` uses `deleteMany` so removing an already-gone row is silent rather than throwing.

Critically, **`CartItem` stores only identity and intent** — `{ userId, variantId, quantity }`, no price column. Reading it back ([`getDbCartAction`](../src/lib/actions/cart.ts)) joins each line to its live variant/product/category and re-resolves price (including any active discount, §6) at read time, so a hydrated cart always reflects the *current* catalogue, never a stale snapshot.

### 4.2 The canonical identity of a cart line is `variantId`, not the product id

A `CartItem` still carries `id` (the parent product id) for display, grouping, and PDP back-links — but every merge/lookup operation, local or remote, keys on `variantId`:

```ts
addItem: (newItem) => set((s) => {
  const existing = s.items.find((i) => i.variantId === newItem.variantId);
  if (existing) {
    return { items: s.items.map((i) =>
      i.variantId === newItem.variantId ? { ...i, quantity: i.quantity + 1 } : i) };
  }
  return { items: [...s.items, { ...newItem, quantity: 1 }] };
});
// removeItem(variantId) and updateQuantity(variantId, qty) take variantId too.
```

**Why this matters.** The previous store merged on the product `id`. Once the PDP gained a real variant selector, that became a billing bug: adding "Cake — Small" (`variantId: A`, 80) then "Cake — Large" (`variantId: B`, 150) would match the existing line by product id and merely increment its quantity — keeping the Small's `variantId` and price. Checkout would charge 2× Small. Keying every operation on `variantId` makes each chosen variant a distinct, correctly-priced line. This isn't an arbitrary choice — it mirrors the database's own modeling: the `CartItem` table declares `@@unique([userId, variantId])`, not `([userId, productId])`. The persisted shape is unchanged — `variantId` was always stored — so previously-saved carts remain valid with no migration.

```prisma
model CartItem {
  userId    String
  variantId String
  quantity  Int      @default(1)
  @@unique([userId, variantId])
  @@index([userId])
  @@index([variantId])
}
```

All React keys in the cart drawer and the checkout summary map over `variantId`, consistent with the store's identity model — on both the local and DB-synced paths.

### 4.3 `CartSyncProvider` — bridging guest and authenticated state

[`CartSyncProvider`](../src/components/providers/CartSyncProvider.tsx) is a client-only wrapper mounted near the app root. It renders its children untouched — all of its behavior lives in a `useEffect` reacting to `useSession()` — so it introduces no SSR hydration mismatch. Its job is to tell apart two situations that both superficially look like "the user is logged in," using two refs (`firstResolve`, `knownUserId`) so each transition fires **exactly once**:

| Transition | Detected as | Action |
|---|---|---|
| Already logged in on mount (refresh / new device) | First non-pending session reading, `userId` already set | **Hydrate**: pull the DB cart and overwrite local. *Never* merge here — the local and DB carts may already overlap, and summing them would double-count. |
| Guest → logged in (a real sign-in this session) | `null → id` transition | **Merge**: push local lines up via [`mergeCartAction`](../src/lib/actions/cart.ts) (server **sums** onto any existing DB rows via upsert + `increment`), then adopt the merged DB cart wholesale as the new local state. |
| Logged in → guest (logout) | `id → null` transition | `clearLocalCart()` — wipe local + `localStorage` so the next person on this device starts clean. The DB cart is **left intact** for the user's next sign-in or another device. |
| Account switch A → B | `idA → idB` transition | `clearLocalCart()`, then hydrate B's cart fresh from the DB. |

The provider deliberately never subscribes to `items`, so editing the cart doesn't re-trigger the effect — only an actual auth-state change does.

> **Price note, unchanged in spirit.** Neither mode ever trusts a client-supplied price for billing: `mergeCartAction` and `syncCartItemAction` persist only `{ variantId, quantity }`, `getDbCartAction` re-resolves price (and discount) on every read, and `placeOrder` re-reads each variant and re-resolves its discount server-side at checkout (§6, §7). So even a stale cart price — or a promotion that started/ended after the item was added, or after the DB row was written — is corrected before the customer is ever billed.

---

## 5. Admin Operational Engine

The entire `/admin/*` surface is gated in [`src/app/admin/layout.tsx`](../src/app/admin/layout.tsx): a signed-out visitor is sent to `/login`, and anyone who is neither `ADMIN` nor `MANAGER` is sent to `/`. This is the **coarse** role gate only — a MANAGER is admitted here so they can reach the dashboard and orders, but each loader/action re-checks the role and resolves the branch scope from the database (§5.5), so a manager only ever sees their own branch, and Super-Admin-only pages bounce them with `requireAdminPage()`.

### 5.1 Dashboard Overview (branch-scoped)

The landing page at `/admin` ([`src/app/admin/page.tsx`](../src/app/admin/page.tsx)) is marked `export const dynamic = "force-dynamic"` — it opts out of route caching, because a stale revenue number or order count would actively mislead whoever's looking at it. All of its data comes from a single server-only loader, `getDashboardStats()` in [`src/lib/actions/dashboard.ts`](../src/lib/actions/dashboard.ts), which authorizes the caller (`requireDashboardAccess`) and **scopes every order query to their branch** before running them.

**How the four headline metrics are produced (within the caller's scope):**

| Metric | Source |
|---|---|
| Total Revenue | Sum of `totalAmount` across all non-cancelled orders **in scope** (`prisma.order.aggregate`) |
| Orders Today | Count of in-scope orders created since local midnight |
| Active Products | Count of products flagged `isAvailable: true` (store-wide) |
| Customers | Count of `User` rows with `role: "USER"` (store-wide) |

**Branch scoping.** Orders and revenue carry a `branchId`, so they are filtered:
- **ADMIN** → unrestricted (all branches), or one branch if a `branchId` param is supplied.
- **MANAGER** → hard-pinned to their own branch; every order query is `AND`-ed with `{ branchId }`, and asking for any other branch throws `Unauthorized` (`resolveBranchScope`).

Products and customers have **no** `branchId` in this schema, so those two metrics deliberately stay store-wide for everyone. The dashboard greeting and copy reflect the scope ("Here's what's happening at {branchName}…" for a manager). If a manager account has no branch assigned, the loader throws and the page renders a graceful "Dashboard unavailable — ask an administrator to assign you to a branch" state rather than crashing.

Each metric is paired with a trend badge. Revenue and Orders compare the current period against the prior one of equal length (last 30 days vs. the 30 before that; today vs. yesterday) and render a percentage delta. Products and Customers instead show a simple "+N new" count, since a percentage comparison is less meaningful for slower-moving totals.

All of this — the four metrics, their comparison-period counterparts, the recent-orders list, the revenue chart's raw data, and the branch-name label — is fetched in **one parallel `Promise.all` batch**, not a sequence of awaited queries: the loader issues its full set of reads to Postgres at once and waits for the slowest one.

The **revenue chart** (Recharts, via [`RevenueChart.tsx`](../src/components/admin/RevenueChart.tsx)) is fed by pulling every in-scope non-cancelled order from the last 30 days and bucketing its `totalAmount` into the calendar day it was created, in application code — a true day-by-day series, not a sampled or estimated one.

Both `placeOrder` and `updateOrderStatus` (§5.2) call `revalidatePath("/admin")` alongside their own route, which is what keeps this dashboard's revenue and counters instantly in sync with order activity happening elsewhere in the app — no polling, no manual refresh.

### 5.2 Orders Command Center

`/admin/orders` ([`src/app/admin/orders/page.tsx`](../src/app/admin/orders/page.tsx)) is the highest-traffic admin screen — it's where staff spend most of their time triaging incoming orders — so it's built around an **"inbox-zero" UX philosophy**: get from "see an order" to "act on it" to "it's off the list" in as few interactions as possible, with zero full-page reloads. Its data also comes from a branch-scoped loader, `getOrders()` in [`src/lib/actions/dashboard.ts`](../src/lib/actions/dashboard.ts).

#### URL-driven filtering & search

The page is a Server Component that accepts `searchParams: Promise<{ status?: string; query?: string }>` — filter and search state lives **in the URL**, not in client component state. This means a filtered/searched view is bookmarkable, shareable, and survives a refresh, and the server can run exactly one targeted Prisma query per request instead of fetching everything and filtering client-side.

- `status` is validated against the `OrderStatus` enum before use (`parseStatus()` in the page) — an invalid or missing value always falls back to the synthetic `"ALL"` tab. The raw URL string is never trusted directly in a `where` clause.
- `query` searches `customerName` (case-insensitive `contains`) and `customerPhone` (`contains`), OR'd together with the order-number match described below.

[`AdminOrderFilters.tsx`](../src/components/admin/AdminOrderFilters.tsx) is the client-side control surface that *drives* those params: it pushes `router.push(pathname + "?" + params, { scroll: false })` inside a `useTransition`, so navigating between tabs or typing a search term never triggers a hard reload or loses scroll position. The search box is **debounced 400ms** before it touches the URL, so fast typing doesn't fire a query per keystroke. Both the status filter and the search query coexist in the same `URLSearchParams` object — switching tabs while a search is active narrows within those results, rather than clearing it.

#### Branch RBAC, live counters & sliding tabs

`getOrders()` resolves the caller's branch scope (`requireDashboardAccess` + `resolveBranchScope`) and **`AND`s that branch into every query** — the list, the per-status counters, *and* the numeric order-number search — so a MANAGER physically cannot surface another branch's orders no matter what they type or filter. An ADMIN sees every branch.

The tab bar is `ALL` plus the five `OrderStatus` values, each annotated with a live count (e.g. `Preparing 4`). Counts come from a single `prisma.order.groupBy({ by: ["status"], where: scopedSearch, _count: { _all: true } })` query run in parallel with the main list fetch — and critically, the `where` is the **branch scope + search clause only**, not the status clause. That means the counters always answer "how many of *my branch's* orders match my current search, broken down by status" — so typing a customer's name updates every tab's number, letting staff see at a glance which statuses that customer's orders fall into before clicking any tab.

The active tab is highlighted with a Framer Motion `layoutId="admin-status-pill"` `<motion.span>` — a single shared element animates (spring physics, not a linear tween) between whichever tab is active, rather than each tab independently fading in and out.

#### Partial numeric order-number search (raw SQL `::text` cast)

`orderNumber` is a Postgres `Int` column (auto-incrementing, human-friendly). Prisma's typed query builder can do `equals` on an `Int`, but **not** `contains` — there's no SQL operator for "string-contains" on an integer type. Searching for `"100"` and expecting it to match order `#10024` requires comparing against the integer's *text representation*, which Prisma's typed API can't express.

The fix is a small raw query that runs only when the search term contains at least one digit:

```ts
const numericOrderIds =
  q && /\d/.test(q)
    ? (
        await prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Order" WHERE "orderNumber"::text ILIKE ${`%${q}%`}
        `
      ).map((row) => row.id)
    : [];
```

The resulting ids are folded into the same `OR` clause as the name/phone search (`{ id: { in: numericOrderIds } }`). Three things make this safe:

1. **Parameterization, not string concatenation.** `$queryRaw` is a tagged template — the `${...}` interpolation is bound as a query parameter by Prisma's query engine, not spliced into the SQL string. This is not vulnerable to SQL injection the way manual string-building would be.
2. **It only ever produces an id allow-list.** The raw query's *only* output is a list of `Order.id` values fed back into a normal, fully-typed Prisma `where` clause — the raw SQL never touches the actual data returned to the client.
3. **Branch scope still wins.** The candidate ids may span branches, but `getOrders` `AND`s the caller's `branchWhere` at the top level, so a manager can never reach another branch's order through the numeric search.

#### Status control & branch-aware authorization

[`updateOrderStatus(orderId, status)`](../src/lib/actions/orders.ts) is the single server action behind every status change in the admin. It:

1. Calls **`requireDashboardAccess()`** first (not `requireAdmin()`) — independent of any UI gating, since a Server Action is a public, directly-callable HTTP endpoint regardless of which page links to it. ADMIN and MANAGER are both admitted; everyone else is rejected.
2. Validates `status` against `Object.values(OrderStatus)` — a non-enum string is rejected, never silently coerced.
3. **Enforces branch ownership for managers:** an `ADMIN` may move any order, but a `MANAGER` may only touch an order whose `branchId` matches their own — any other branch, *or an unassigned order*, is `Unauthorized`. (The check loads only the order's `branchId` before the update.)
4. Runs the update, then calls **both** `revalidatePath("/admin/orders")` *and* `revalidatePath("/admin")` — a single status change invalidates the orders board and the dashboard's revenue/counters in the same request, so an order moving to `DELIVERED` is reflected in both places the instant the action resolves, with no manual cache-busting.

[`AdminOrderDetailDrawer.tsx`](../src/components/admin/AdminOrderDetailDrawer.tsx) wraps this in a `StatusControl` chip group: clicking a status sets local optimistic state immediately, calls the action inside `startTransition`, and on success calls `router.refresh()` to re-pull the Server Component tree (re-running the loader's Prisma queries) — on failure, it rolls the optimistic chip back and surfaces a `sonner.toast.error`.

**The inbox-zero auto-close behavior:** [`AdminOrdersTable.tsx`](../src/components/admin/AdminOrdersTable.tsx) derives the drawer's open order **from the live `orders` prop array by id**, not from a frozen snapshot taken when the row was clicked (`orders.find((o) => o.id === selectedId)`). Combined with `router.refresh()` inside `StatusControl`, this means: if staff are viewing the `Pending` tab and mark an order `Preparing`, the refreshed query no longer includes that order in the `Pending` filter — it drops out of `orders`, `selected` becomes `null`, and the drawer closes itself. The net effect is a rapid, repeatable loop: open an order → resolve it → drawer closes → next order is already at the top of the list. On the `All` tab, the order never leaves the list, so the drawer stays open with its pill updated in place — useful when staff are walking one order through several stages in sequence.

### 5.3 Product Management Lifecycle (CRUD)

#### Listing

`/admin/products` ([`src/app/admin/products/page.tsx`](../src/app/admin/products/page.tsx)) fetches every product newest-first, joined with its category name and the price of each of its variants. Because **price lives on the variant, not the product** (a product can be sold in multiple sizes/formats at different prices), the list shows a derived "from ₴X" price — the minimum across that product's variants.

#### Creation & updating

Creating a product ([`createProduct`](../src/app/admin/products/actions.ts)) re-validates the form payload server-side against the same Zod schema the client uses, then creates the product and its first variant together in one nested Prisma write.

**Updating is more delicate**, because an edit can simultaneously keep some variants unchanged, edit others, add new ones, and remove others in one submission. [`updateProduct`](../src/app/admin/products/actions.ts) handles this in two phases:

1. **Inside a database transaction:** the product's own fields are updated, and each submitted variant is either updated in place (if its id already belongs to this product) or created fresh. If anything fails, the whole update rolls back.
2. **After the transaction commits:** any variant that existed before but is missing from the new submission is treated as removed, and the system attempts to delete it — which leads directly into safe-deletion below.

#### Safe deletion

A `ProductVariant` that has ever appeared in a placed order **cannot be deleted** — the `OrderItem → Variant` relationship is configured with referential-integrity protection (`onDelete: Restrict`), so Postgres refuses the delete rather than risk an order referencing a missing item. Both flows catch that refusal specifically:

- **Removing a variant during an edit:** falls back to *archiving* it (marks unavailable, frees its SKU) instead of hard-deleting, with a toast: *"N variant(s) couldn't be deleted (part of existing orders) and were hidden instead."*
- **Deleting an entire product:** rejected the same way, with: *"This product appears in existing orders and can't be deleted. Mark it Out of Stock instead."*

The underlying Prisma/Postgres error code is `P2003` (foreign-key constraint violation) — the action layer recognizes that code and translates it into a precise instruction instead of a generic 500.

### 5.4 Review Moderation System

Customers submit reviews from the product detail page via [`ReviewForm.tsx`](../src/components/ReviewForm.tsx), posting to [`submitProductReview`](../src/lib/actions/reviews.ts). The action checks for an active session first and rejects outright if there isn't one — **there is no anonymous review path** — and the reviewer's identity (`userId`, display name) is pulled from the session server-side, never from form input. Every new review is created with `isApproved: false`; nothing is visible to other shoppers until an admin acts.

**Anti-spam:** a unique constraint on `(userId, productId)` means Postgres itself refuses a second review from the same customer on the same product — a hard data-layer guarantee, not a soft check a race condition could bypass. The resulting `P2002` is caught and turned into *"You've already reviewed this product."*

`/admin/reviews` lists pending reviews first, newest-first within each group, with a live pending-count badge. **Approve** flips `isApproved`; **Reject/Delete** permanently removes the review (the same action serves both "reject a pending submission" and "take down a published one," with the button label changing accordingly). Both actions call `revalidatePath` on the moderation queue and — only when relevant — the public product page, so an approval becomes visible to customers within the same request cycle.

### 5.5 Branch Management & Branch-Manager RBAC

Branches are the unit of physical fulfillment **and** the unit of staff authorization. The `Branch` model ([`prisma/schema.prisma`](../prisma/schema.prisma)) carries a unique `name`, a unique URL-safe `slug` (mirroring `Category.slug`), optional `address`/`phone`, and an `isActive` soft on/off switch. It has two relations: `managers` (the `User` rows assigned to it, typically `role == MANAGER`) and `orders` (every order fulfilled by it).

**The RBAC model.** A `User`'s `branchId` is optional at the schema level *by necessity* — `USER` and `ADMIN` have no branch — so the rule "a `MANAGER` must have a `branchId`" cannot be expressed in Prisma. It is enforced in application logic at two points:

- **Read path** — `requireDashboardAccess()` (§2.1) rejects a `MANAGER` with no `branchId` as a misconfigured account, and `resolveBranchScope(scope, requestedBranchId?)` collapses the caller's scope plus any requested branch into the single `branchId` a query must filter by: a `MANAGER` is pinned to their own branch (requesting another throws `Unauthorized`); an `ADMIN` may target one branch or pass `undefined` for "all branches." This one helper is what every dashboard/orders loader uses, so scoping can't drift between screens.
- **Write path** — `updateUserRole()` ([`src/lib/actions/manage-users.ts`](../src/lib/actions/manage-users.ts)) is the single authority for promoting/demoting users and for linking a manager to the branch they oversee. Promoting someone to `MANAGER` **requires** a valid `branchId` (the branch's existence is verified); demoting to `USER`/`ADMIN` always clears `branchId` to `null`. It also guards against self-lockout — a Super Admin can't strip their own admin role — and is `ADMIN`-only.

**Admin CRUD** (`ADMIN`-only) lives in [`src/lib/actions/manage-branches.ts`](../src/lib/actions/manage-branches.ts): `createBranch`, `updateBranch`, `deleteBranch`. Each gates on `requireAdmin()` but translates a rejected caller into a clean `{ success: false, error }` rather than throwing. Names/slugs are normalized (slugified) and unique-constraint violations (`P2002`) are mapped to friendly messages. Deletion is guarded by the schema's relation policies:

- `User.branch` → `onDelete: Restrict` — a branch with assigned staff/managers cannot be deleted. `deleteBranch` pre-counts assigned users and refuses with a helpful "reassign them first, or deactivate the branch instead" message; the `P2003` catch is a safety net for the race where a user is assigned between the check and the delete.
- `Order.branch` → `onDelete: SetNull` — historical orders survive a branch delete and simply become **unassigned** (visible to the Super Admin only), so order history is never destroyed.

Prefer `updateBranch(id, { …, isActive: false })` to retire a branch while keeping its assignments and history intact. A public, no-auth read — `getActiveBranches()` ([`src/lib/actions/branches.ts`](../src/lib/actions/branches.ts)) — exposes only `{ id, slug, name }` for active branches, and is what powers the storefront checkout's branch/area selector (§7).

### 5.6 Promotions Management (the Discount Engine's admin surface)

`/admin/promotions` ([`src/app/admin/promotions/page.tsx`](../src/app/admin/promotions/page.tsx)) is **ADMIN-only** — it calls `requireAdminPage()`, which bounces a manager back to `/admin`. It's the merchandising console for creating time-boxed discounts and targeting them at specific categories, products, or variants. The runtime pricing math is documented in §6; this section covers the management surface.

CRUD lives in [`src/lib/actions/promotions.ts`](../src/lib/actions/promotions.ts) — `createPromotion`, `updatePromotion`, `togglePromotionActive`, `deletePromotion` — each `ADMIN`-gated and returning the standard `{ success }` result shape. Because the promotion targets are **implicit many-to-many** relations (`Category` / `Product` / `ProductVariant`), the actions speak Prisma's relation verbs directly:

- **create** → `connect` the chosen ids.
- **update** → `set` the chosen ids — this **replaces** the whole selection, mirroring the multi-select's "this is the complete desired target list" semantics (not a delta).
- **delete** → Prisma removes the implicit join rows automatically; **no catalog rows are ever touched**.

`validatePromotion()` enforces the invariants server-side before any write: a name of at least 2 characters, a valid `DiscountType`, a strictly positive `value` (and `≤ 100` for `PERCENTAGE`), parseable `startDate`/`endDate` with `endDate ≥ startDate`, and **at least one** target across the three categories. The list view derives a human schedule badge from the date window at render time — **Scheduled** (now < start), **Live** (within window), **Expired** (now > end) — and shows an **Inactive** pill when `isActive` is false, plus per-target counts.

### 5.7 Advanced Analytics (Super-Admin only)

`/admin/analytics` ([`src/app/admin/analytics/page.tsx`](../src/app/admin/analytics/page.tsx)) is a cross-branch performance suite reserved for the Super Admin — the page calls `requireAdminPage()` and the loader (`getAnalytics()` in [`src/lib/actions/analytics.ts`](../src/lib/actions/analytics.ts)) calls `requireAdmin()`, so a manager is bounced before any query runs (managers get their own branch dashboard, not the cross-branch comparison).

The defining characteristic is that **every metric is computed in the database** — Prisma `groupBy` aggregations plus a couple of grouped `$queryRaw` rollups — so the loader never pulls raw order rows into Node. Cancelled orders are excluded from every figure (mirroring the dashboard's `notCancelled` rule), and only orders actually attached to a branch are counted. Four datasets are returned and fetched in one `Promise.all`:

1. **Branch sales comparison** — all-time revenue (`_sum.totalAmount`) and order count per active branch, via `prisma.order.groupBy({ by: ["branchId"] })`, sorted high-to-low.
2. **Peak hours** — orders bucketed by branch × hour-of-day, computed in the store's local wall clock (`Africa/Cairo`). A raw query does the timezone math in SQL — `EXTRACT(HOUR FROM "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo')` — and casts `COUNT(*)` to `int` to avoid `BigInt` serialization; the rows are then pivoted in JS into one point per hour carrying a column per branch, with the x-axis trimmed to the active trading window.
3. **Top selling products per branch** — units sold and revenue per branch × product, via a raw query joining `OrderItem → Order` to reach `branchId` and rolling up `SUM(quantity)` / `SUM(quantity * unitPrice)`; the top 3 per branch are sliced in JS.
4. **Star of the month** — the highest-revenue branch for the current calendar month, plus its share of the month's total.

A stable colour is assigned per branch (by name-sorted order, via `branchColor`) so every chart in the suite agrees on which colour means which branch. The page renders these into a "Star of the Month" hero card, a branch-sales bar chart, a multi-series peak-hours line chart, and per-branch best-seller cards with share bars.

### 5.8 Store Settings — Dynamic Footer Navigation CMS

`/admin/settings` ([`src/app/admin/settings/page.tsx`](../src/app/admin/settings/page.tsx)) gives the Super Admin full editorial control over the storefront footer's navigation — what used to be a hardcoded constant array in [`Footer.tsx`](../src/components/layout/Footer.tsx) is now a DB-backed CMS built on a single model:

```prisma
model FooterLink {
  id       String  @id @default(cuid())
  label    String                      // display text, e.g. "Our Story" or "Instagram"
  url      String                      // internal path ("/category/bakery"), "#anchor", or absolute http(s) URL
  group    String  @default("Explore") // column heading — links sharing a group form one nav column
  order    Int     @default(0)         // ascending sort, both within a column and across columns
  isActive Boolean @default(true)      // hidden from the storefront when false, row not deleted

  @@index([isActive, order])
}
```

Each row is an independent `label → url` pair — an admin can point a link at a `Category`, a specific `Product`, an internal page, or an external/social profile, with **no foreign key back to the catalog**. This is the deliberate fix for the old hardcoded-array problem: a footer link is no longer derived from a category's current `name`/`slug`, so renaming a category in the admin can never silently 404 a footer link.

**The `group` field drives column layout without touching the grid CSS.** [`Footer.tsx`](../src/components/layout/Footer.tsx) renders the nav as `<nav className="... grid grid-cols-2 md:grid-cols-4 gap-10">`, mapping one `<div>` per distinct `group` value, in first-appearance order (the list is already sorted by `order`, so a group's position follows its earliest-ordered link). Because this is a CSS grid with a fixed `md:grid-cols-4` track count, **the layout never breaks regardless of how many groups an admin creates**: 4 or fewer groups fill a single row cleanly, and a 5th+ group simply wraps onto a new row under the same 4-column template — there's no hardcoded column count in the React tree to keep in sync with the data.

**The admin surface** ([`FooterLinksManager.tsx`](../src/components/admin/FooterLinksManager.tsx)) lists links grouped into the same columns the storefront will render, with inline **▲▼ reorder** (swaps a link with its neighbour *within* the same group, then persists the full flattened order — so a same-group reorder can never reshuffle which links land in which column), an **active toggle** (soft-hide without deleting), and a modal to add/edit a link's label, URL, and group. Every mutation — `createFooterLink`, `updateFooterLink`, `deleteFooterLink`, `reorderFooterLinks` ([`src/lib/actions/settings.ts`](../src/lib/actions/settings.ts)) — gates on `requireAdmin()` and validates the URL shape server-side (must start with `/`, `#`, or `http(s)://`, rejecting a pasted `javascript:` href before it can ever reach the public footer).

**Cache & read-your-own-writes.** The public footer reads links through an `unstable_cache` tagged `"footer-links"`; every settings mutation calls `updateTag("footer-links")`, so an admin's edit is reflected on the storefront the very next render — no manual revalidation, no stale footer. If no managed links exist yet (a fresh install, or before this migration), the footer falls back to the original category-driven "Collection" column plus static `Heritage`/`Boutiques`/`Client Care` groups, so the layout is never empty mid-rollout.

---

## 6. The Discount Engine

The Discount Engine is a server-side pricing layer that turns a catalogue price into the price a customer actually pays. Its model lives in the schema; its math lives in one pure module, [`src/lib/discounts.ts`](../src/lib/discounts.ts); and it is consumed identically everywhere a price is shown or charged.

### 6.1 The `Promotion` schema

```prisma
enum DiscountType {
  PERCENTAGE     // `value` is a percent off (e.g. 15 → 15% off)
  FIXED_AMOUNT   // `value` is an absolute amount off (store currency, EGP)
}

model Promotion {
  id        String       @id @default(cuid())
  name      String
  type      DiscountType
  value     Float
  startDate DateTime
  endDate   DateTime
  isActive  Boolean      @default(true)

  // Targets — a promotion may link to any combination of the three.
  categories Category[]
  products   Product[]
  variants   ProductVariant[]

  @@index([isActive])
}
```

A promotion applies a discount of a given `type` and `value` over the window `[startDate, endDate]`, and can target **any mix** of whole `Category` rows, individual `Product` rows, and specific `ProductVariant` rows. These are **implicit many-to-many** relations, so Prisma manages the `_CategoryToPromotion`, `_ProductToPromotion`, and `_ProductVariantToPromotion` join tables automatically — the schema only stores the targets; all discount math and precedence rules live in app logic.

**A promotion applies to a variant** when it targets that variant directly, **or** its parent product, **or** that product's category. `gatherPromotions(...lists)` merges the variant-, product-, and category-level lists and de-dupes them by id, so a promotion linked at two levels is only considered once.

### 6.2 "Live" is strict, and checked in two layers

A promotion is **live** only when `isActive === true` **and** `startDate <= now <= endDate`. The engine enforces this at two levels so it can never leak an out-of-window discount:

- **At the query** — `livePromotionWhere(now)` returns a Prisma `where` (`{ isActive: true, startDate: { lte: now }, endDate: { gte: now } }`) that callers spread into the `promotions` relation include, so the database only ever returns currently-live rows. `PROMOTION_SELECT_FIELDS` keeps every such query selecting the same uniform shape.
- **In the resolver** — `isPromotionLive(promo, now)` re-checks the same condition defensively, even though the query already filtered, and tolerates invalid dates by treating them as not-live.

Critically, callers pass **a single `now` per request** to both the filter and the resolver, so a promotion can't expire mid-render (or mid-loop, across the lines of one order) and price two items against different instants.

### 6.3 Resolving the final price

```ts
applyPromotion(base, promo)
  = PERCENTAGE   → round(base * (1 - value / 100))
  = FIXED_AMOUNT → round(base - value)
  // never returns below 0; round = 2-dp money rounding (with Number.EPSILON)

resolvePrice(base, promotions, now) → {
  basePrice, finalPrice, discountAmount, hasDiscount, appliedPromotion
}
```

`resolvePrice` considers only **live** promotions and, when several apply, the one yielding the **lowest** final price wins — always the best deal for the customer. It returns the original `basePrice`, the `finalPrice`, the `discountAmount`, a `hasDiscount` flag, and the `appliedPromotion` that produced the price (or `null`). All money is rounded to two decimals with identical rounding everywhere, so the shown price and the billed price stay in lock-step.

### 6.4 One resolver, every surface

The module is intentionally **pure and dependency-free** — no Prisma, no React — so the exact same function runs on:

- **product cards** (the storefront grid, `/shop`, and the dynamic category route via [`CategoryPageTemplate`](../src/components/CategoryPageTemplate.tsx)) — pricing the starting (lowest-base-price) variant, and surfacing the original as a struck-through `compareAtPrice` plus a `-N%` sale badge when `hasDiscount`;
- the **product detail page** (§3.3) — pricing every variant so the selector and price node reflect live discounts;
- the **checkout summary**; and
- **`placeOrder`** (§7) — re-resolving each line authoritatively at purchase time.

Because the storefront, the cart preview, and the server-side order all call `resolvePrice`, they can never disagree: the customer is billed exactly the price they were shown.

---

## 7. Checkout & Canonical Pricing

Checkout ([`src/app/(shop)/checkout/page.tsx`](../src/app/(shop)/checkout/page.tsx)) collects fulfillment details client-side, but **every price in the order is resolved server-side** inside [`placeOrder`](../src/lib/actions/orders.ts) — the client never sends a price, only `variantId` + `quantity` pairs (the exact identity the cart store keys on, §4) plus the chosen fulfillment and branch.

### 7.1 Dynamic branch routing (no more `DeliveryLocation` enum)

Delivery areas and pickup locations are now **strictly driven by the live `Branch` table** — the legacy static `DeliveryLocation` enum and its `CitySelect` dropdown are gone from the checkout flow. The page loads active branches once via `getActiveBranches()` (§5.5) and renders them through a single `BranchSelect`, so whatever the customer picks resolves to a **real `branchId`** ready to stamp onto the order:

- **Delivery** — the "Delivery Area" selector is the branch list **plus** a synthetic **"Other Areas"** option. Choosing a branch sends that branch's id; choosing "Other Areas" sends `branchId = null`. A `null` leaves the order **unassigned**, which means it surfaces to the **Super Admin** (`ADMIN`) only — no branch manager owns it (§5.1, §5.2).
- **Pickup** — the customer chooses a branch directly; its id is stamped as `branchId`, and `pickupBranch` additionally keeps the human-readable branch **label** for the receipt.

Arabic sub-labels in the dropdown are presentational only (keyed by branch `slug` in the client), not stored on the `Branch` model — a branch without a known sub-label simply shows its name.

### 7.2 The transaction

`placeOrder` wraps the whole order in `prisma.$transaction`. First it does a **defensive branch resolution**: a supplied `branchId` is only stamped if it matches a **real, active** branch (`findFirst({ where: { id, isActive: true } })`); a stale, invalid, or deactivated id silently falls back to `null` so the order never fails — it just routes to the Super Admin. Then, for each cart line, it re-reads the `ProductVariant` row (price, availability, parent product availability) **and that variant's live promotions at the variant / product / category levels** (filtered by `livePromotionWhere(now)`) directly from the database — never trusting anything the browser sent — and rejects the whole order if any item has gone unavailable since it was added to the cart.

The best live discount is then applied per line via `resolvePrice` (§6), and **the discounted `finalPrice` is what gets snapshotted** onto the `OrderItem` (`productName`, `variantName`, `unitPrice`, `quantity` at the moment of purchase), so a later catalogue price change *or a promotion ending* never rewrites history on an already-placed order. Either every line and the order header are created together, or none of it is.

### 7.3 Canonical pricing — discount first, then VAT & delivery

**Canonical pricing constants**, enforced only here — never on the client:

```ts
const DELIVERY_FEE = 35;   // EGP, flat, DELIVERY fulfillment only
const VAT_RATE = 0.14;     // 14%
```

The order of operations matters: **the per-line discount is applied before anything else**, the subtotal is the sum of the *discounted* lines, and VAT is computed on that discounted subtotal — VAT and delivery never apply to the pre-discount price.

```
lineFinal    = resolvePrice(variant.price, livePromotions, now).finalPrice  — per line, server-side
subtotal     = Σ (lineFinal × quantity)        — discounted lines, read from the DB, not the client
deliveryFee  = 35 if fulfillment === DELIVERY, else 0
vat          = round(subtotal × 0.14)          — on the DISCOUNTED subtotal
totalAmount  = subtotal + deliveryFee + vat
```

The checkout UI's visual order summary mirrors this exact formula (and prices its lines through the same engine), so what the customer sees before placing the order matches what the server actually charges — but the enforcement boundary is the server action, not the UI's arithmetic. On success, `placeOrder` revalidates `/admin`, `/admin/orders`, and (for signed-in customers) `/my-orders`, so the dashboard, the staff board, and the customer's own history all reflect the new order immediately.

### 7.4 The "Residual VAT" fallback

VAT is deliberately **not** stored as its own database column — only `subtotal`, `deliveryFee`, and `totalAmount` are persisted. Every place that displays a receipt (the storefront `/my-orders` detail drawer and the admin order drawer) derives VAT the same way:

```ts
vat = Math.max(0, totalAmount - subtotal - deliveryFee)
```

This is a deliberate design choice, not an oversight: deriving VAT as a residual guarantees the displayed breakdown **always reconciles exactly** to `totalAmount` — there's no possibility of a stored VAT figure drifting out of sync with the total it's supposed to be part of. It also means the same rendering code safely handles **legacy orders** placed before the current pricing model existed (an earlier `placeOrder` used a flat 50-EGP delivery fee with no VAT line, and routed delivery by the old `DeliveryLocation` enum rather than a branch): for those historical rows, the residual formula evaluates to `0`, so old orders simply render with a `VAT 0` line rather than throwing, showing `NaN`, or requiring a backfill migration.

### 7.5 What the receipt shows

The order view-model ([`src/components/orders/types.ts`](../src/components/orders/types.ts)) now carries `branchName` — the assigned branch's name — alongside the legacy `deliveryCity`. The detail drawers render the branch as the delivery **"Area"** for new orders; the legacy `deliveryCity` (a `DeliveryLocation` value) is still rendered defensively as **"City"** for historical orders that have one, but new checkouts no longer set it. `branchName` is `null` for unassigned ("Other Areas" / Super-Admin) orders. The `Order.deliveryCity` column and the `DeliveryLocation` enum therefore remain in the schema purely for historical compatibility — they are no longer written by the checkout flow.

---

## 8. Wishlist & Order History

### 8.1 Wishlist System

The wishlist lets a signed-in customer heart a product from any card ([`ProductCard.tsx`](../src/components/ProductCard.tsx)) or the detail page (via [`WishlistButton.tsx`](../src/components/products/WishlistButton.tsx) inside `ProductPurchasePanel`), backed by a `WishlistItem` model (`@@unique([userId, productId])`, cascade-deleted with the user or product) and two server actions in [`src/lib/actions/wishlist.ts`](../src/lib/actions/wishlist.ts): `toggleWishlist(productId)` and `getWishlistItems()`.

**O(1) membership lookup.** Every list-rendering page (`/shop`, the dynamic `/category/[slug]` route, the PDP) fetches `getWishlistedProductIds(): Promise<string[]>` once per request and converts it to a `Set`:

```ts
// CategoryPageTemplate.tsx
const favorited = new Set(await getWishlistedProductIds());
...
<ProductCard initialIsFavorited={favorited.has(product.id)} ... />
```

Without the `Set`, seeding N product cards' heart state would mean N `Array.includes` scans (O(N²) overall for a page of N products). The `Set` makes each card's lookup O(1), so the cost of wiring wishlist state into a grid scales linearly with the number of products, not quadratically.

**Deterministic Server Component hydration.** The heart's *initial* state is computed entirely on the server — `getWishlistedProductIds()` runs in the same Server Component that fetches the product list, and the boolean it produces (`initialIsFavorited`) is passed down as a prop, not derived from a client-side fetch after mount. `WishlistButton.tsx` then takes over interactivity client-side (optimistic flip on click, `useTransition` calling `toggleWishlist`, rollback + `sonner.toast.error` on failure) — but the *first paint* the browser renders already shows the correct heart state for that user. There is no flash of an unfilled heart followed by a pop-in once a client fetch resolves.

**Why `force-dynamic` instead of ISR.** Wishlist state is **per-user**, and ISR's whole point is serving one cached HTML response to every visitor — caching a page that embeds one specific user's heart states would leak them to (or stale them for) the next visitor who happens to hit the same cached entry. Every product-listing page (`/shop`, the dynamic category route, the PDP) is therefore `export const dynamic = "force-dynamic"`, trading the cache for a guarantee that the rendered hearts always belong to the request's actual session. The alternative — client-side hydration of wishlist state after mount — was deliberately rejected, since it reintroduces the flash-then-pop-in problem the deterministic-hydration approach above exists to avoid.

### 8.2 Order History (`/my-orders`)

[`src/app/(shop)/my-orders/page.tsx`](../src/app/(shop)/my-orders/page.tsx) follows the same `searchParams`-driven filtering pattern as the admin orders board (§5.2): `searchParams: Promise<{ status?: string }>`, validated against `OrderStatus`, defaulting to an `"ALL"` tab — scoped to `session.user.id`. It is protected by the edge proxy (§2.2) and an in-page `getServerSession()` guard. [`OrderStatusTabs.tsx`](../src/components/orders/OrderStatusTabs.tsx) renders the same Framer Motion sliding-pill indicator (`layoutId="order-status-pill"`) used in the admin filter bar — the two surfaces share the same interaction language by design, just scoped to one customer's own orders instead of the whole store.

Each [`OrderCard`](../src/components/orders/OrderCard.tsx) is a clickable summary that opens [`OrderDetailModal`](../src/components/orders/OrderDetailModal.tsx) — a slide-over drawer with the full itemized invoice (customer profile, fulfillment logistics including the branch/area, and the Subtotal / VAT / Delivery / Total breakdown described in §7). Both `OrderView`/`OrderItemView` (storefront) and `AdminOrderView` (admin, `OrderView` extended with `userEmail`) are defined once in [`src/components/orders/types.ts`](../src/components/orders/types.ts) and reused across both surfaces, along with one shared [`StatusPill.tsx`](../src/components/orders/StatusPill.tsx) — so a status's color and label can't drift between what a customer sees and what staff see.

---

## 9. UX, State & Performance Principles

There is deliberately **no client-side global data-fetching cache** anywhere in the app (no Redux, no React Query/SWR). Zustand is used narrowly for the cart, which is genuinely client-only, ephemeral state (and now keyed by `variantId`, §4); everything else — order lists, wishlist counts, product catalogs, admin tables, analytics — is server state, re-derived from Prisma on every navigation rather than cached and synchronized on the client. Coordinated techniques produce the "instant" feel instead:

1. **Server Components as the default data layer.** Every page fetches its own data directly from Prisma at render time; the HTML reaching the browser is already complete.
2. **Request-level `cache()` dedupe.** `getServerSession()` and per-route lookups like `getCategoryBySlug()` are wrapped in React `cache()`, so two parts of one render tree that need the same row issue one Postgres read, not two.
3. **`useTransition` for every mutation, everywhere — replacing traditional loading state.** Placing an order, toggling a wishlist heart, changing an order's status, approving a review, saving a product edit, toggling a promotion — each one calls its Server Action inside `startTransition(async () => { ... })` instead of a hand-rolled `useState(false)` loading flag. The page stays fully interactive while it's in flight, a single `isPending` flag drives the relevant spinner/disabled state, and `router.refresh()` after success re-runs the current route's Server Components — pulling fresh data — without a full page reload or lost scroll position. Optimistic UI (an instantly-flipped wishlist heart, an instantly-highlighted status chip, an instantly-selected variant pill) is layered on top with local `useState` that's rolled back if the action's result comes back `{ success: false }`.
4. **Predictable action results, never thrown exceptions across the server/client boundary.** Every Server Action returns a consistent `{ success: true, ... } | { success: false, error: string }` shape. The calling component never needs its own try/catch for the *expected* failure path — it checks `result.success` and shows a `sonner.toast.success(...)` or `.error(result.error)` with a message the action already translated from a raw database error (`P2002`, `P2003`, `P2025`) into plain language.

**SSR-safe portal rendering for modals & drawers (React 19, no state-in-effect).** Both [`OrderDetailModal.tsx`](../src/components/orders/OrderDetailModal.tsx) (storefront) and [`AdminOrderDetailDrawer.tsx`](../src/components/admin/AdminOrderDetailDrawer.tsx) (admin) render via `createPortal(..., document.body)`, which requires guarding against `document` not existing during server rendering. The naive fix is a `mounted` flag set in a bare `useEffect(() => setMounted(true), [])` — but that pattern is exactly what React's `react-hooks/set-state-in-effect` lint rule flags. Both drawers instead guard with a plain runtime check and no extra state at all:

```ts
if (typeof document === "undefined") return null;
```

This is safe specifically because both drawers are *closed* on first client paint (`open` starts `false`) — there's nothing visible to mismatch between server and client markup, so the guard can be a pure expression evaluated during render rather than state that has to be "corrected" after mount. The same render-time-adjustment idea is used in [`AdminOrderFilters.tsx`](../src/components/admin/AdminOrderFilters.tsx) to keep its search-input draft in sync with the committed URL query (`if (query !== committedQuery) { setCommittedQuery(query); setTerm(query); }`), React's documented "adjust state during render" pattern.

---

### In one sentence

The platform is server-rendered and server-validated end to end — Prisma queries and Server Actions do all the real work, auth is gated first at the Edge (`src/proxy.ts`) and then authoritatively in-page (`getServerSession()`), staff access is branch-scoped (`ADMIN` sees everything, `MANAGER` sees only their own branch, resolved live from the DB), pricing and stock are always re-resolved from the database — including the best live promotion via the pure Discount Engine, applied before VAT and delivery — rather than trusted from the client, orders are routed to a real `Branch` (or to the Super Admin when unassigned) and, like the cart, are keyed by `variantId` to keep each purchasable unit distinct and correctly priced, the database's own constraints (`P2003`, `P2002`, `P2025`) are treated as the source of truth rather than re-implemented in application code, and the client side exists only to make those server-side results — and the staff/customer actions that produce them — feel instant.

---

### Current Status: Operational Integrity & Technical Debt

All critical architectural "Hardening" tasks tracked by this document and its storefront companion are officially resolved: the footer is a fully dynamic, DB-backed CMS (`FooterLink`, §5.8) instead of a hardcoded array that could silently 404; the open-redirect guard (`sanitizeRedirect`) is a single, globally shared utility in `@/lib/utils` rather than logic duplicated per surface; the `/shop` catalog filters server-side through `searchParams` instead of shipping the full product set to the client; and the PDP variant selector, the `variantId`-keyed cart, centralized Edge route protection, the single dynamic category route, the storefront-wide Discount Engine, the DB-backed cross-device cart, and the branch-driven checkout — every item this document and `STOREFRONT_ARCHITECTURE.md` once tracked as open work — have shipped and are documented above as `BUILT`. The platform is highly optimized for performance (server-side filtering and rendering, request-level query dedupe, zero client-side data-fetching caches), security (server-validated pricing and stock, branch-scoped RBAC resolved live from the database, a single shared open-redirect policy), and operational flexibility (admin-editable footer navigation, branch-driven fulfillment, a merchandising console for time-boxed promotions). The system state is now fully synchronized with this documentation.
