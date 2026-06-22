# Ali Baba — System Management & Architecture Report

**Audience:** new developers onboarding onto the codebase, and stakeholders who want an accurate, current picture of what's been built.
**Scope:** this is the operational reference for the whole platform — storefront, checkout, and the admin operational engine. It describes what happens, in what order, why it's built that way, and which file owns each behavior.

---

## 1. Executive Summary & Core Stack

Ali Baba is a server-rendered, server-validated e-commerce platform for a patisserie business: a public storefront (catalog, wishlist, checkout, order history) and an authenticated, role-gated admin console (`/admin`) for running the business day to day.

| Layer | Choice | Why it's here |
|---|---|---|
| Framework | **Next.js 16** (App Router) | Server Components as the default data layer; Server Actions replace a separate REST/GraphQL API. |
| UI runtime | **React 19** | `useTransition` for every mutation; no legacy `useEffect`-driven loading state. |
| Styling | **Tailwind CSS v4** | Utility-first, design-token driven (serif headings, `stone-*` neutral palette, a single `primary` accent, rounded-full pills). |
| Database | **PostgreSQL (Neon)** via **Prisma 7** (`@prisma/adapter-pg` driver adapter) | Serverless-friendly connection handling; typed queries; raw SQL escape hatch when the typed query builder can't express something (see §2.2). |
| Auth | **Better Auth** | Session-based; a `role` field on `User` (`USER` \| `ADMIN`) gates `/admin`. Always read through the project's `@/lib/session` wrapper (`getServerSession` / `requireAdmin`) — never import session helpers from `better-auth` directly. |
| Client state | **Zustand** (`persist` middleware) | Used narrowly, for the cart only (`src/lib/cart-store.ts`). Everything else — admin tables, filters, wishlist counts — is server state, re-fetched through Server Components rather than cached on the client. |
| Motion / feedback | `framer-motion`, `sonner` | Inline transitions, sliding tab/pill indicators, slide-over drawers, and toast feedback for every mutation. |

**Design philosophy:** every page — storefront or admin — renders fully populated on first load. There is no spinner-then-fetch pattern anywhere in the app, because data comes from Prisma queries running directly inside Server Components. Every mutation (place an order, toggle a wishlist heart, change an order's status, edit a product, moderate a review) happens through a Server Action invoked from a small Client Component, wrapped in `useTransition` so the UI never blocks or full-page-reloads. The result feels like a single-page app while staying server-rendered, server-validated, and credential-free on the client: prices, statuses, and permissions are never trusted from the browser.

---

## 2. Admin Operational Engine

### 2.1 Dashboard Overview & Analytics

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

Both `placeOrder` and `updateOrderStatus` (§2.2) call `revalidatePath("/admin")` alongside their own route, which is what keeps this dashboard's revenue and counters instantly in sync with order activity happening elsewhere in the app — no polling, no manual refresh.

### 2.2 Orders Command Center

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

### 2.3 Product Management Lifecycle (CRUD)

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

### 2.4 Review Moderation System

Customers submit reviews from the product detail page via [`ReviewForm.tsx`](../src/components/ReviewForm.tsx), posting to [`submitProductReview`](../src/lib/actions/reviews.ts). The action checks for an active session first and rejects outright if there isn't one — **there is no anonymous review path** — and the reviewer's identity (`userId`, display name) is pulled from the session server-side, never from form input. Every new review is created with `isApproved: false`; nothing is visible to other shoppers until an admin acts.

**Anti-spam:** a unique constraint on `(userId, productId)` means Postgres itself refuses a second review from the same customer on the same product — a hard data-layer guarantee, not a soft check a race condition could bypass. The resulting `P2002` is caught and turned into *"You've already reviewed this product."*

`/admin/reviews` lists pending reviews first, newest-first within each group, with a live pending-count badge. **Approve** flips `isApproved`; **Reject/Delete** permanently removes the review (the same action serves both "reject a pending submission" and "take down a published one," with the button label changing accordingly). Both actions call `revalidatePath` on the moderation queue and — only when relevant — the public product page, so an approval becomes visible to customers within the same request cycle.

---

## 3. Storefront & Checkout Architecture

### 3.1 Wishlist System

The wishlist lets a signed-in customer heart a product from any card (`ProductCard.tsx`) or the detail page (`ProductAddToCart.tsx`), backed by a `WishlistItem` model (`@@unique([userId, productId])`, cascade-deleted with the user or product) and two server actions in [`src/lib/actions/wishlist.ts`](../src/lib/actions/wishlist.ts): `toggleWishlist(productId)` and `getWishlistItems()`.

**O(1) membership lookup.** Every list-rendering page (`/shop`, the five category pages) fetches `getWishlistedProductIds(): Promise<string[]>` once per request and converts it to a `Set`:

```ts
// ShopClient.tsx
const favorited = new Set(wishlistedIds);
...
<ProductCard initialIsFavorited={favorited.has(product.id)} ... />
```

Without the `Set`, seeding N product cards' heart state would mean N `Array.includes` scans (O(N²) overall for a page of N products). The `Set` makes each card's lookup O(1), so the cost of wiring wishlist state into a grid scales linearly with the number of products, not quadratically.

**Deterministic Server Component hydration.** The heart's *initial* state is computed entirely on the server — `getWishlistedProductIds()` runs in the same Server Component that fetches the product list, and the boolean it produces (`initialIsFavorited`) is passed down as a prop, not derived from a client-side fetch after mount. `WishlistButton.tsx` then takes over interactivity client-side (optimistic flip on click, `useTransition` calling `toggleWishlist`, rollback + `sonner.toast.error` on failure) — but the *first paint* the browser renders already shows the correct heart state for that user. There is no flash of an unfilled heart followed by a pop-in once a client fetch resolves.

**Why `force-dynamic` instead of ISR.** The shop page and all five category pages were originally `export const revalidate = 3600` (hourly ISR) before the wishlist existed. Wishlist state is **per-user**, and ISR's whole point is serving one cached HTML response to every visitor — caching a page that embeds one specific user's heart states would leak them to (or stale them for) the next visitor who happens to hit the same cached entry. Every one of these pages was switched to `export const dynamic = "force-dynamic"`, trading the hourly cache for a guarantee that the rendered hearts always belong to the request's actual session. The alternative — client-side hydration of wishlist state after mount — was deliberately rejected, since it reintroduces the flash-then-pop-in problem the deterministic-hydration approach above exists to avoid.

### 3.2 Checkout & Canonical Pricing

Checkout ([`src/app/(shop)/checkout/page.tsx`](../src/app/(shop)/checkout/page.tsx)) collects fulfillment details client-side, but **every price in the order is resolved server-side** inside [`placeOrder`](../src/lib/actions/orders.ts) — the client never sends a price, only `variantId` + `quantity` pairs.

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

### 3.3 Order History (`/my-orders`)

[`src/app/(shop)/my-orders/page.tsx`](../src/app/(shop)/my-orders/page.tsx) follows the same `searchParams`-driven filtering pattern as the admin orders board (§2.2): `searchParams: Promise<{ status?: string }>`, validated against `OrderStatus`, defaulting to an `"ALL"` tab. [`OrderStatusTabs.tsx`](../src/components/orders/OrderStatusTabs.tsx) renders the same Framer Motion sliding-pill indicator (`layoutId="order-status-pill"`) used in the admin filter bar — the two surfaces share the same interaction language by design, just scoped to one customer's own orders instead of the whole store.

Each [`OrderCard`](../src/components/orders/OrderCard.tsx) is a clickable summary that opens [`OrderDetailModal`](../src/components/orders/OrderDetailModal.tsx) — a slide-over drawer with the full itemized invoice (customer profile, fulfillment logistics, and the Subtotal / VAT / Delivery / Total breakdown described above). Both `OrderView`/`OrderItemView` (storefront) and `AdminOrderView` (admin, `OrderView` extended with `userEmail`) are defined once in [`src/components/orders/types.ts`](../src/components/orders/types.ts) and reused across both surfaces, along with one shared [`StatusPill.tsx`](../src/components/orders/StatusPill.tsx) — so a status's color and label can't drift between what a customer sees and what staff see.

---

## 4. UX, State & Performance Principles

There is deliberately **no client-side global data-fetching cache** anywhere in the app (no Redux, no React Query/SWR). Zustand is used narrowly for the cart, which is genuinely client-only, ephemeral state; everything else — order lists, wishlist counts, product catalogs, admin tables — is server state, re-derived from Prisma on every navigation rather than cached and synchronized on the client. Three coordinated techniques produce the "instant" feel instead:

1. **Server Components as the default data layer.** Every page fetches its own data directly from Prisma at render time; the HTML reaching the browser is already complete.
2. **`useTransition` for every mutation, everywhere — replacing traditional loading state.** Placing an order, toggling a wishlist heart, changing an order's status, approving a review, saving a product edit — each one calls its Server Action inside `startTransition(async () => { ... })` instead of a hand-rolled `const [loading, setLoading] = useState(false)`. This marks the call as non-urgent: the page stays fully interactive while it's in flight, a single `isPending` flag drives the relevant spinner/disabled state, and `router.refresh()` after success re-runs the current route's Server Components — pulling fresh data — without a full page reload or lost scroll position. Optimistic UI (an instantly-flipped wishlist heart, an instantly-highlighted status chip) is layered on top with a local `useState` that's rolled back if the action's result comes back `{ success: false }`.
3. **Predictable action results, never thrown exceptions across the server/client boundary.** Every Server Action returns a consistent `{ success: true, ... } | { success: false, error: string }` shape. The calling component never needs its own try/catch for the *expected* failure path — it checks `result.success` and shows a `sonner.toast.success(...)` or `.error(result.error)` with a message the action already translated from a raw database error (`P2002`, `P2003`, `P2025`) into plain language.

**SSR-safe portal rendering for modals & drawers (React 19, no state-in-effect).** Both [`OrderDetailModal.tsx`](../src/components/orders/OrderDetailModal.tsx) (storefront) and [`AdminOrderDetailDrawer.tsx`](../src/components/admin/AdminOrderDetailDrawer.tsx) (admin) render via `createPortal(..., document.body)`, which requires guarding against `document` not existing during server rendering. The naive fix is a `mounted` flag set in a bare `useEffect(() => setMounted(true), [])` — but that pattern is exactly what React's `react-hooks/set-state-in-effect` lint rule flags, because synchronously calling `setState` inside an effect on mount is a one-tick-late render in disguise. Both drawers instead guard with a plain runtime check and no extra state at all:

```ts
if (typeof document === "undefined") return null;
```

This is safe specifically because both drawers are *closed* on first client paint (`open` starts `false`) — there's nothing visible to mismatch between server and client markup, so the guard can be a pure expression evaluated during render rather than state that has to be "corrected" after mount. The same render-time-adjustment idea (rather than an effect) is used in [`AdminOrderFilters.tsx`](../src/components/admin/AdminOrderFilters.tsx) to keep its search-input draft in sync with the committed URL query: a `committedQuery` state is compared against the incoming `query` prop directly in the render body (`if (query !== committedQuery) { setCommittedQuery(query); setTerm(query); }`), which is React's documented "adjust state during render" pattern — functionally a sync, but without a single tick where the effect hasn't fired yet.

---

### In one sentence

The platform is server-rendered and server-validated end to end — Prisma queries and Server Actions do all the real work, pricing and stock are always re-resolved from the database rather than trusted from the client, the database's own constraints (`P2003`, `P2002`, `P2025`) are treated as the source of truth rather than re-implemented in application code, and the client side exists only to make those server-side results — and the staff/customer actions that produce them — feel instant.
