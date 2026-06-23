# Ali Baba — System Management & Architecture Report

**Audience:** new developers onboarding onto the codebase, and stakeholders who want an accurate, current picture of what's been built.
**Scope:** this is the operational reference for the whole platform — storefront, authentication, checkout, and the admin operational engine. It describes what happens, in what order, why it's built that way, and which file owns each behavior. Everything below is read directly from the current `src/` tree; there are no aspirational sections.

---

## 1. Executive Summary & Core Stack

Ali Baba is a server-rendered, server-validated e-commerce platform for a patisserie business: a public storefront (catalog, product detail with multi-variant purchasing, wishlist, checkout, order history) and an authenticated, role-gated admin console (`/admin`) for running the business day to day.

| Layer | Choice | Why it's here |
|---|---|---|
| Framework | **Next.js 16.2** (App Router) | Server Components as the default data layer; Server Actions replace a separate REST/GraphQL API; the request interceptor is `src/proxy.ts` (Next 16's renamed middleware — see §2). |
| UI runtime | **React 19.2** | `useTransition` for every mutation; `cache()` for request-level dedupe; no legacy `useEffect`-driven loading state. |
| Styling | **Tailwind CSS v4** | Utility-first, design-token driven (serif headings, `stone-*` neutral palette, a single turquoise `primary` accent, rounded-full pills). |
| Database | **PostgreSQL (Neon)** via **Prisma 7** (`@prisma/adapter-pg` driver adapter) | Serverless-friendly connection handling; typed queries; raw SQL escape hatch when the typed query builder can't express something (see §3.2). |
| Auth | **Better Auth 1.6** | Session-based; a `role` field on `User` (`USER` \| `ADMIN`) gates `/admin`. Always read through the project's `@/lib/session` wrapper (`getServerSession` / `requireAdmin`) on the server, or `@/lib/auth-client` on the client — never import session helpers from `better-auth` directly. |
| Client state | **Zustand 5** (`persist` middleware) | Used narrowly, for the cart only ([`src/lib/cart-store.ts`](../src/lib/cart-store.ts)). The cart is keyed by **`variantId`** — the purchasable unit — not the parent product id (see §4). Everything else — admin tables, filters, wishlist counts — is server state, re-fetched through Server Components rather than cached on the client. |
| Motion / feedback | `framer-motion`, `sonner` | Inline transitions, sliding tab/pill indicators, slide-over drawers, and toast feedback for every mutation. |

**Design philosophy:** every page — storefront or admin — renders fully populated on first load. There is no spinner-then-fetch pattern anywhere in the app, because data comes from Prisma queries running directly inside Server Components. Every mutation (place an order, toggle a wishlist heart, change an order's status, edit a product, moderate a review) happens through a Server Action invoked from a small Client Component, wrapped in `useTransition` so the UI never blocks or full-page-reloads. The result feels like a single-page app while staying server-rendered, server-validated, and credential-free on the client: prices, statuses, and permissions are never trusted from the browser.

---

## 2. Authentication, the Edge Proxy & Routing

Auth and route protection are platform infrastructure shared by storefront and admin. This section is the canonical description; the admin-security lens is mirrored in [`ARCHITECTURE.md` §7](./ARCHITECTURE.md) and the customer-facing login UX is in [`STOREFRONT_ARCHITECTURE.md` §4`](./STOREFRONT_ARCHITECTURE.md).

### 2.1 The auth stack

- **Server config** — [`src/lib/auth.ts`](../src/lib/auth.ts): `betterAuth` with the Prisma adapter, email+password (`autoSignIn`, `minPasswordLength: 8`), 7-day sessions refreshed daily, and `nextCookies()` as the **last** plugin so it can set cookies on action/route responses. The `role` field is declared as an `additionalFields` entry with `input: false` and `defaultValue: "USER"` — **a client cannot assign itself a role at signup**; an admin is promoted by a direct database write only.
- **Server reads** — [`src/lib/session.ts`](../src/lib/session.ts): `getServerSession()` is wrapped in React `cache()`, so a layout and a page that both need the user in one request hit Better Auth once. `requireAdmin()` throws on anonymous/non-admin callers and is the gate on every admin Server Action.
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
- **Defense in depth.** The protected pages still run `getServerSession()` + `redirect("/login")` themselves ([`/wishlist`](../src/app/(shop)/wishlist/page.tsx), [`/my-orders`](../src/app/(shop)/my-orders/page.tsx)). The proxy is the first cheap gate; `getServerSession()` stays the source of truth and correctly rejects a present-but-expired cookie that slipped past the Edge.

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

**Open-redirect hardening.** The `redirect` value is attacker-controllable (anyone can hand-craft `/login?redirect=https://evil.com` — it never had to pass through our proxy to arrive). `LoginClient` runs it through a strict guard before navigating:

```ts
function sanitizeRedirect(path: string | null): string {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return "/";
  return path;
}
```

Only a single-slash, same-origin relative path survives; absolute URLs and the protocol-relative `//host` trick (which browsers resolve to a different origin) both fall back to `"/"`. On a successful `signIn.email`, navigation is driven by `router.push(redirectTo)` followed by `router.refresh()` — Better Auth's vanilla email sign-in does not auto-navigate (its `callbackURL` is only acted on by redirect-based flows like OAuth), so the explicit `router.push` is what completes the round-trip back to the originally-requested page.

> **Friction note (non-blocking):** `sanitizeRedirect` is currently a private function inside `LoginClient.tsx`, not a shared export in `@/lib/utils`. It is correct and well-tested-by-construction, but if a second redirect-consuming surface is ever added (e.g. a signup flow that honors `?redirect=`), promote it to `@/lib/utils` rather than copy-pasting it.

### 2.4 Routing topology

Two App Router route groups, two dynamic segment routes:

| Route | Resolved by | Notes |
|---|---|---|
| `src/app/(shop)/**` | — | Public storefront; account routes gated by the proxy + in-page check |
| `src/app/admin/**` | — | Staff console; every page server-reads the session, mutations call `requireAdmin()` |
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

Both `generateMetadata` and `CategoryPage` call `getCategoryBySlug(slug)`; the second call within a request is served from React's memo — **one** round-trip per request. A miss renders `notFound()` (HTTP 404) and a `"Category Not Found"` title. Products are filtered by the resolved, indexed `categoryId` FK (not re-derived from `identifier`), and the page is `export const dynamic = "force-dynamic"` because [`CategoryPageTemplate`](../src/components/CategoryPageTemplate.tsx) seeds per-user wishlist hearts — it must never render from a shared ISR cache that would leak one user's state to the next.

**Footer links — partial sync, with a coupling caveat.** [`Footer.tsx`](../src/components/Footer.tsx) links into this route with hrefs that use real database-derived slugs (`/category/oriental-sweets`, `/category/western-sweets`, `/category/eid-sweets`, `/category/bakery`). Two things to know when maintaining it: the link **labels** are editorial marketing copy (e.g. "Modern Pastry" → `western-sweets`, "Luxury Beverages" → `bakery`) and deliberately don't mirror the category names; and the set is a **hardcoded constant array**, not a live query — `moulid-sweets` is intentionally omitted, and because slugs are derived from the category `name`, renaming a core category in the admin would change its slug and silently 404 the corresponding footer link. If the footer ever needs to be authoritative, drive it from `prisma.category.findMany`.

### 3.2 Homepage slider & `/shop` directory

The homepage ([`(shop)/page.tsx`](../src/app/(shop)/page.tsx)) projects up to five `Category` rows where `identifier` is non-null, ordered by the enum's declaration order, into the Embla [`CategorySlider`](../src/components/CategorySlider.tsx). The `/shop` catalog directory fetches every available SHOP product once and filters by category pill **client-side** for zero-latency switching — a deliberate trade-off documented for revisiting once the catalog grows past a few hundred products. Full detail (the `CategoryIdentifier` mechanism, slot-transfer semantics, the client-filter trade-off) is in [`STOREFRONT_ARCHITECTURE.md` §1](./STOREFRONT_ARCHITECTURE.md).

### 3.3 Product Detail Page — multi-variant client islands

The PDP ([`(shop)/product/[slug]/page.tsx`](../src/app/(shop)/product/[slug]/page.tsx)) is a Server Component that fetches the product, its variants (`orderBy: { price: "asc" }`), its approved reviews, the session, and the wishlist state in a single `Promise.all`. It hands the **full variant set** to a client island — multi-variant products are now fully selectable by customers, which was previously a gap.

- [`ProductPurchasePanel.tsx`](../src/components/products/ProductPurchasePanel.tsx) (client) groups price, variant selection, quantity stepper, and the Add-to-Cart CTA into one island. It holds a single `useState<string>` source of truth — `selectedVariantId` — and **derives** the displayed price, sold-out state, and the cart payload from the active variant. Nothing is stored in parallel state, so the price node can never drift from the selected pill. It defaults to the cheapest *available* variant (`variants.find(v => v.isAvailable) ?? variants[0]`), preserving the "from {price}" promise shown on product cards.
- [`VariantSelector.tsx`](../src/components/products/VariantSelector.tsx) (client, stateless/presentational) renders a **single-axis** row of pills — one per `variant.name`, each showing that variant's own price — matching the flat `ProductVariant` shape (a free-text `name`, not a size×color matrix). It returns `null` for single-variant products, exposes `role="radiogroup"`/`role="radio"` semantics, and keeps sold-out variants **in the DOM but disabled** (strikethrough price) so the option stays indexable rather than vanishing.
- **CLS & a11y:** every price node uses `tabular-nums` so switching from `60` to `450` never reflows the row; `compareAtPrice` (schema-ready, `null` until promotions ship) renders defensively as a struck-through "was" price with an `aria-label="Original price … EGP"`, and the CTA carries a dynamic `aria-label` describing the quantity and line total.

This replaced the old single-component `ProductAddToCart`, which only ever surfaced the cheapest variant. Crucially, the variant selector and the cart's `variantId` keying (§4) shipped together — a selector that lets a customer add two variants of one product would have been money-incorrect against a product-id-keyed cart.

---

## 4. The Cart — variant-keyed integrity

The cart is **client-only**: Zustand + `persist` to `localStorage` under the key `"ali-baba-cart"` ([`src/lib/cart-store.ts`](../src/lib/cart-store.ts)). There is no server-side cart sync for guests or logged-in users; only the final `placeOrder` touches the database.

**The canonical identity of a cart line is `variantId`, not the product id.** A `CartItem` still carries `id` (the parent product id) for display, grouping, and PDP back-links — but every merge/lookup operation keys on `variantId`:

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

**Why this matters.** The previous store merged on the product `id`. Once the PDP gained a real variant selector, that became a billing bug: adding "Cake — Small" (`variantId: A`, 80) then "Cake — Large" (`variantId: B`, 150) would match the existing line by product id and merely increment its quantity — keeping the Small's `variantId` and price. Checkout would charge 2× Small. Keying every operation on `variantId` makes each chosen variant a distinct, correctly-priced line. This isn't an arbitrary choice — it mirrors the database's own modeling: the `CartItem` table declares `@@unique([userId, variantId])`, not `([userId, productId])`. (The `CartItem` table itself remains a reserved extension point for future cross-device cart sync; the live cart never writes to it.) The persisted shape is unchanged by the fix — `variantId` was always stored — so previously-saved carts remain valid with no migration.

All React keys in the cart drawer and the checkout summary map over `variantId`, consistent with the store's identity model.

---

## 5. Admin Operational Engine

### 5.1 Dashboard Overview & Analytics

The landing page at `/admin` ([`src/app/admin/page.tsx`](../src/app/admin/page.tsx)) is marked `export const dynamic = "force-dynamic"` — it opts out of route caching, because a stale revenue number or order count would actively mislead whoever's looking at it.

**How the four headline metrics are produced:**

| Metric | Source |
|---|---|
| Total Revenue | Sum of `totalAmount` across all non-cancelled orders (`prisma.order.aggregate`) |
| Orders Today | Count of orders created since local midnight |
| Active Products | Count of products flagged `isAvailable: true` |
| Customers | Count of `User` rows with `role: "USER"` |

Each metric is paired with a trend badge. Revenue and Orders compare the current period against the prior one of equal length (last 30 days vs. the 30 before that; today vs. yesterday) and render a percentage delta. Products and Customers instead show a simple "+N new" count, since a percentage comparison is less meaningful for slower-moving totals.

All of this — the four metrics, their comparison-period counterparts, the recent-orders list, and the revenue chart's raw data — is fetched in **one parallel `Promise.all` batch**, not a sequence of awaited queries: the page issues its full set of reads to Postgres at once and waits for the slowest one.

The **revenue chart** (Recharts, via [`RevenueChart.tsx`](../src/components/admin/RevenueChart.tsx)) is fed by pulling every non-cancelled order from the last 30 days and bucketing its `totalAmount` into the calendar day it was created, in application code — a true day-by-day series, not a sampled or estimated one.

Both `placeOrder` and `updateOrderStatus` (§5.2) call `revalidatePath("/admin")` alongside their own route, which is what keeps this dashboard's revenue and counters instantly in sync with order activity happening elsewhere in the app — no polling, no manual refresh.

### 5.2 Orders Command Center

`/admin/orders` ([`src/app/admin/orders/page.tsx`](../src/app/admin/orders/page.tsx)) is the highest-traffic admin screen — it's where staff spend most of their time triaging incoming orders — so it's built around an **"inbox-zero" UX philosophy**: get from "see an order" to "act on it" to "it's off the list" in as few interactions as possible, with zero full-page reloads.

#### URL-driven filtering & search

The page is a Server Component that accepts `searchParams: Promise<{ status?: string; query?: string }>` — filter and search state lives **in the URL**, not in client component state. This means a filtered/searched view is bookmarkable, shareable, and survives a refresh, and the server can run exactly one targeted Prisma query per request instead of fetching everything and filtering client-side.

- `status` is validated against the `OrderStatus` enum before use (`parseStatus()` in the page) — an invalid or missing value always falls back to the synthetic `"ALL"` tab. The raw URL string is never trusted directly in a `where` clause.
- `query` searches `customerName` (case-insensitive `contains`) and `customerPhone` (`contains`), OR'd together with the order-number match described below.

[`AdminOrderFilters.tsx`](../src/components/admin/AdminOrderFilters.tsx) is the client-side control surface that *drives* those params: it pushes `router.push(pathname + "?" + params, { scroll: false })` inside a `useTransition`, so navigating between tabs or typing a search term never triggers a hard reload or loses scroll position. The search box is **debounced 400ms** before it touches the URL, so fast typing doesn't fire a query per keystroke. Both the status filter and the search query coexist in the same `URLSearchParams` object — switching tabs while a search is active narrows within those results, rather than clearing it.

#### Live, search-aware counters + sliding tabs

The tab bar is `ALL` plus the five `OrderStatus` values, each annotated with a live count (e.g. `Preparing 4`). Counts come from a single `prisma.order.groupBy({ by: ["status"], where: searchWhere, _count: { _all: true } })` query run in parallel with the main list fetch — and critically, it's filtered by the **search clause only**, not the status clause. That means the counters always answer "how many orders match my current search, broken down by status" — so typing a customer's name updates every tab's number, letting staff see at a glance which statuses that customer's orders fall into before clicking any tab.

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

The resulting ids are folded into the same `OR` clause as the name/phone search (`{ id: { in: numericOrderIds } }`). Two things make this safe:

1. **Parameterization, not string concatenation.** `$queryRaw` is a tagged template — the `${...}` interpolation is bound as a query parameter by Prisma's query engine, not spliced into the SQL string. This is not vulnerable to SQL injection the way manual string-building would be.
2. **It only ever produces an id allow-list.** The raw query's *only* output is a list of `Order.id` values fed back into a normal, fully-typed Prisma `where` clause — the raw SQL never touches the actual data returned to the client.

#### Status control & `revalidatePath` propagation

[`updateOrderStatus(orderId, status)`](../src/lib/actions/orders.ts) is the single server action behind every status change in the admin. It:

1. Calls `requireAdmin()` first — independent of any UI gating, since a Server Action is a public, directly-callable HTTP endpoint regardless of which page links to it.
2. Validates `status` against `Object.values(OrderStatus)` — a non-enum string is rejected, never silently coerced.
3. Runs the update, then calls **both** `revalidatePath("/admin/orders")` *and* `revalidatePath("/admin")` — a single status change invalidates the orders board and the dashboard's revenue/counters in the same request, so an order moving to `DELIVERED` is reflected in both places the instant the action resolves, with no manual cache-busting.

[`AdminOrderDetailDrawer.tsx`](../src/components/admin/AdminOrderDetailDrawer.tsx) wraps this in a `StatusControl` chip group: clicking a status sets local optimistic state immediately, calls the action inside `startTransition`, and on success calls `router.refresh()` to re-pull the Server Component tree (re-running the page's Prisma queries) — on failure, it rolls the optimistic chip back and surfaces a `sonner.toast.error`.

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

---

## 6. Checkout & Canonical Pricing

Checkout ([`src/app/(shop)/checkout/page.tsx`](../src/app/(shop)/checkout/page.tsx)) collects fulfillment details client-side, but **every price in the order is resolved server-side** inside [`placeOrder`](../src/lib/actions/orders.ts) — the client never sends a price, only `variantId` + `quantity` pairs (the exact identity the cart store keys on, §4).

**The transaction.** `placeOrder` wraps the whole order in `prisma.$transaction`: for each cart line, it re-reads the `ProductVariant` row (price, availability, parent product availability) directly from the database — never trusting anything the browser sent — and rejects the whole order if any item has gone unavailable since it was added to the cart. A line-item snapshot (`productName`, `variantName`, `unitPrice`, `quantity` at the moment of purchase) is stored on the `OrderItem`, so a later catalog price change never rewrites history on an already-placed order. Either every line and the order header are created together, or none of it is.

**Canonical pricing constants**, enforced only here — never on the client:

```ts
const DELIVERY_FEE = 35;   // EGP, flat, DELIVERY fulfillment only
const VAT_RATE = 0.14;     // 14%
```

```
subtotal     = Σ (unitPrice × quantity)   — read from ProductVariant, not the client
deliveryFee  = 35 if fulfillment === DELIVERY, else 0
vat          = round(subtotal × 0.14)
totalAmount  = subtotal + deliveryFee + vat
```

The checkout UI's visual order summary mirrors this exact formula, so what the customer sees before placing the order matches what the server actually charges — but the enforcement boundary is the server action, not the UI's arithmetic.

**`DeliveryLocation` enum validation.** The city field is a `<select>` ([`CitySelect`](../src/app/(shop)/checkout/page.tsx)) populated from `Object.values(DeliveryLocation)` and rendered through `prettyLabel()` for display — there is no free-text city input. This makes an invalid or misspelled city structurally impossible from the UI, and `placeOrder` only ever receives a value that is already a member of the `DeliveryLocation` enum, which Prisma will reject at the type level if it weren't.

**The "Residual VAT" fallback.** VAT is deliberately **not** stored as its own database column — only `subtotal`, `deliveryFee`, and `totalAmount` are persisted. Every place that displays a receipt (the storefront `/my-orders` detail drawer and the admin order drawer) derives VAT the same way:

```ts
vat = Math.max(0, totalAmount - subtotal - deliveryFee)
```

This is a deliberate design choice, not an oversight: deriving VAT as a residual guarantees the displayed breakdown **always reconciles exactly** to `totalAmount` — there's no possibility of a stored VAT figure drifting out of sync with the total it's supposed to be part of. It also means the same rendering code safely handles **legacy orders** placed before the 35-EGP/14%-VAT pricing model existed (an earlier version of `placeOrder` used a flat 50-EGP delivery fee with no VAT line at all): for those historical rows, the residual formula evaluates to `0`, so old orders simply render with a `VAT 0` line rather than throwing, showing `NaN`, or requiring a backfill migration. New orders, going forward, show the real 14% figure.

---

## 7. Wishlist & Order History

### 7.1 Wishlist System

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

### 7.2 Order History (`/my-orders`)

[`src/app/(shop)/my-orders/page.tsx`](../src/app/(shop)/my-orders/page.tsx) follows the same `searchParams`-driven filtering pattern as the admin orders board (§5.2): `searchParams: Promise<{ status?: string }>`, validated against `OrderStatus`, defaulting to an `"ALL"` tab — scoped to `session.user.id`. It is protected by the edge proxy (§2.2) and an in-page `getServerSession()` guard. [`OrderStatusTabs.tsx`](../src/components/orders/OrderStatusTabs.tsx) renders the same Framer Motion sliding-pill indicator (`layoutId="order-status-pill"`) used in the admin filter bar — the two surfaces share the same interaction language by design, just scoped to one customer's own orders instead of the whole store.

Each [`OrderCard`](../src/components/orders/OrderCard.tsx) is a clickable summary that opens [`OrderDetailModal`](../src/components/orders/OrderDetailModal.tsx) — a slide-over drawer with the full itemized invoice (customer profile, fulfillment logistics, and the Subtotal / VAT / Delivery / Total breakdown described above). Both `OrderView`/`OrderItemView` (storefront) and `AdminOrderView` (admin, `OrderView` extended with `userEmail`) are defined once in [`src/components/orders/types.ts`](../src/components/orders/types.ts) and reused across both surfaces, along with one shared [`StatusPill.tsx`](../src/components/orders/StatusPill.tsx) — so a status's color and label can't drift between what a customer sees and what staff see.

---

## 8. UX, State & Performance Principles

There is deliberately **no client-side global data-fetching cache** anywhere in the app (no Redux, no React Query/SWR). Zustand is used narrowly for the cart, which is genuinely client-only, ephemeral state (and now keyed by `variantId`, §4); everything else — order lists, wishlist counts, product catalogs, admin tables — is server state, re-derived from Prisma on every navigation rather than cached and synchronized on the client. Coordinated techniques produce the "instant" feel instead:

1. **Server Components as the default data layer.** Every page fetches its own data directly from Prisma at render time; the HTML reaching the browser is already complete.
2. **Request-level `cache()` dedupe.** `getServerSession()` and per-route lookups like `getCategoryBySlug()` are wrapped in React `cache()`, so two parts of one render tree that need the same row issue one Postgres read, not two.
3. **`useTransition` for every mutation, everywhere — replacing traditional loading state.** Placing an order, toggling a wishlist heart, changing an order's status, approving a review, saving a product edit — each one calls its Server Action inside `startTransition(async () => { ... })` instead of a hand-rolled `useState(false)` loading flag. The page stays fully interactive while it's in flight, a single `isPending` flag drives the relevant spinner/disabled state, and `router.refresh()` after success re-runs the current route's Server Components — pulling fresh data — without a full page reload or lost scroll position. Optimistic UI (an instantly-flipped wishlist heart, an instantly-highlighted status chip, an instantly-selected variant pill) is layered on top with local `useState` that's rolled back if the action's result comes back `{ success: false }`.
4. **Predictable action results, never thrown exceptions across the server/client boundary.** Every Server Action returns a consistent `{ success: true, ... } | { success: false, error: string }` shape. The calling component never needs its own try/catch for the *expected* failure path — it checks `result.success` and shows a `sonner.toast.success(...)` or `.error(result.error)` with a message the action already translated from a raw database error (`P2002`, `P2003`, `P2025`) into plain language.

**SSR-safe portal rendering for modals & drawers (React 19, no state-in-effect).** Both [`OrderDetailModal.tsx`](../src/components/orders/OrderDetailModal.tsx) (storefront) and [`AdminOrderDetailDrawer.tsx`](../src/components/admin/AdminOrderDetailDrawer.tsx) (admin) render via `createPortal(..., document.body)`, which requires guarding against `document` not existing during server rendering. The naive fix is a `mounted` flag set in a bare `useEffect(() => setMounted(true), [])` — but that pattern is exactly what React's `react-hooks/set-state-in-effect` lint rule flags. Both drawers instead guard with a plain runtime check and no extra state at all:

```ts
if (typeof document === "undefined") return null;
```

This is safe specifically because both drawers are *closed* on first client paint (`open` starts `false`) — there's nothing visible to mismatch between server and client markup, so the guard can be a pure expression evaluated during render rather than state that has to be "corrected" after mount. The same render-time-adjustment idea is used in [`AdminOrderFilters.tsx`](../src/components/admin/AdminOrderFilters.tsx) to keep its search-input draft in sync with the committed URL query (`if (query !== committedQuery) { setCommittedQuery(query); setTerm(query); }`), React's documented "adjust state during render" pattern.

---

### In one sentence

The platform is server-rendered and server-validated end to end — Prisma queries and Server Actions do all the real work, auth is gated first at the Edge (`src/proxy.ts`) and then authoritatively in-page (`getServerSession()`), pricing and stock are always re-resolved from the database rather than trusted from the client, the cart and orders are keyed by `variantId` to keep each purchasable unit distinct and correctly priced, the database's own constraints (`P2003`, `P2002`, `P2025`) are treated as the source of truth rather than re-implemented in application code, and the client side exists only to make those server-side results — and the staff/customer actions that produce them — feel instant.
