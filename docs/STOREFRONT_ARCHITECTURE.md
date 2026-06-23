# Storefront UX & Client-Side Architecture

**Stack:** Next.js 16.2 (App Router) · React 19.2 · Tailwind CSS v4 · Prisma 7 · PostgreSQL (Neon) · Better Auth 1.6 · Zustand 5

**Audience:** front-end engineers building or extending the customer-facing storefront (`src/app/(shop)/**`).
**Scope:** this is the client-side companion to [`ARCHITECTURE.md`](./ARCHITECTURE.md) (admin internals + the shared edge-proxy/auth infrastructure) and [`HOW_IT_WORKS.md`](./HOW_IT_WORKS.md) (full-platform walkthrough). It owns the ground those two only summarize: **homepage catalog structure, dynamic category routing, the product detail page's variant islands, the café menu renderer, the authenticated login/redirect flow, navbar RBAC, and cart integrity.** Every contract below is read directly from `prisma/schema.prisma` and the current `(shop)` route group — nothing here is aspirational unless explicitly tagged `GAP`.

**Status tags used throughout:**

| Tag | Meaning |
|---|---|
| `BUILT` | Implemented and working as described — treat as the contract to preserve. |
| `GAP` | Does not exist yet. This section *is* the spec to build against. |
| `HARDENING` | Works, but a concrete improvement is recommended before scaling. |

> **Refactor note.** The four items this document previously tracked as blocking work — the PDP variant selector, the `variantId`-keyed cart, centralized route protection, and collapsing the five static category routes into one — have all shipped. They are documented below as `BUILT`, and the old `GAP`/`BUG` write-ups are preserved only as historical context where it explains *why* the current shape is what it is.

---

## 1. The Homepage & Catalog Structure

### 1.1 The Core Categories Slider — `BUILT`

The homepage slider isn't a curated/manual list — it's a direct projection of up to five `Category` rows, selected by a dedicated enum:

```prisma
// prisma/schema.prisma
enum CategoryIdentifier {
  ORIENTAL_SWEETS
  WESTERN_SWEETS
  MOULID_SWEETS
  EID_SWEETS
  BAKERY
}

model Category {
  ...
  slug       String              @unique  // drives /category/[slug]
  subtitle   String?              // marketing tagline under the title in the slider card
  image      String?              // slider hero image
  identifier CategoryIdentifier? @unique   // NULL = standard category
}
```

`identifier` is nullable **and** `@unique` — at most one `Category` row can hold each enum value, and a row with `identifier: null` is, by definition, a standard (non-core) category. This single column is the entire mechanism: there's no separate "is featured" flag and no manually-curated homepage table to keep in sync.

**The query** — [`src/app/(shop)/page.tsx`](../src/app/(shop)/page.tsx):

```ts
const categories = await prisma.category.findMany({
  where: { identifier: { not: null } },
  orderBy: { identifier: "asc" },
});
```

`orderBy: { identifier: "asc" }` sorts by the enum's **declaration order** in the schema, not alphabetically or by `createdAt` — the slider always renders `ORIENTAL_SWEETS → WESTERN_SWEETS → MOULID_SWEETS → EID_SWEETS → BAKERY`. Reordering the slider means reordering the enum in the schema (a migration), not an admin action — a deliberate constraint, since these five slots are a fixed brand decision, not a frequently-reshuffled merchandising list.

**Handling an unconfigured slot — graceful hide, not a placeholder.** Because the query filters `identifier: { not: null }`, a slot nobody has claimed yet simply **isn't in the result set**. If only 3 of the 5 identifiers are currently assigned, [`CategorySlider`](../src/components/CategorySlider.tsx) (an Embla carousel — `loop: false`, `dragFree: true`, `containScroll: "trimSnaps"`) receives 3 cards and renders 3 cards. There is no "Coming Soon" tile, no empty skeleton, no layout gap on the customer-facing side.

This is intentional — do not change it to show a placeholder. The amber "Not set up" badge is an **admin-only** affordance, rendered at [`/admin/categories`](../src/app/admin/categories/page.tsx) so staff can see which of the 5 slots still need a category — it must never leak into the public bundle.

Each slider card links to `/category/${category.slug}` — i.e. straight into the single dynamic category route (§1.3). The slug is the live database value, so the link is always correct even after a rename within the same request cycle (`revalidatePath("/")` fires on every category mutation).

**Slot reassignment ("transfer") semantics.** Because `identifier` is `@unique`, assigning `BAKERY` to a category that doesn't hold it while another category does doesn't throw a constraint error — [`transferIdentifier`](../src/lib/actions/categories.ts) clears the previous holder's `identifier` to `null` first, inside the same transaction, and the admin UI reports *"Core position moved here from 'X'."* From the storefront's side this is invisible (just a normal `revalidatePath("/")`), but it's worth knowing a core slot is a single mutable pointer, not a fixed assignment.

### 1.2 Standard Categories & the Catalog Directory — `BUILT`

A standard category (`identifier === null`, `type: "SHOP"`) doesn't get its own slider slot, but it **does** get a landing page through the same dynamic route as the core categories (§1.3). It also surfaces in the **`/shop` catalog directory** ([`page.tsx`](../src/app/(shop)/shop/page.tsx) + [`ShopClient.tsx`](../src/app/(shop)/shop/ShopClient.tsx)):

```ts
const [categories, products] = await Promise.all([
  prisma.category.findMany({ where: { type: "SHOP" }, orderBy: { name: "asc" }, select: { name: true } }),
  prisma.product.findMany({
    where: { isAvailable: true, category: { type: "SHOP" } },
    include: { category: true, variants: { orderBy: { price: "asc" } } },
    orderBy: { createdAt: "desc" },
  }),
]);
```

This fetches **every** SHOP category name and **every** available SHOP product, in two queries, once, server-side. Filtering by category afterward (`"All Collection"` pill + one pill per category name) happens **entirely client-side**:

```ts
const filtered = active === ALL ? products : products.filter((p) => p.category === active);
```

This is a deliberate trade-off: at the current catalog size, shipping the full product set once and filtering in memory means clicking a category pill is a zero-latency `setState` — no spinner, no re-fetch, just an animated grid reflow via `framer-motion`'s `layout` prop. **Revisit this once the SHOP catalog grows past roughly a few hundred products** — at that point the larger initial payload starts costing more (TTFB/LCP) than the filter-latency win is worth, and filtering should move to a server-read `?category=` param, the same pattern already used for `/admin/orders` and `/my-orders`.

### 1.3 The single dynamic category route — `BUILT` (was a `HARDENING` recommendation; now shipped)

There is exactly **one** category landing route — [`src/app/(shop)/category/[slug]/page.tsx`](../src/app/(shop)/category/[slug]/page.tsx). The five hand-written `category/<core-slug>/page.tsx` files (one per `CategoryIdentifier`, ~30 lines of duplicated query/metadata boilerplate each) have been **deleted**. One file now serves every category — core and standard alike — resolved by `Category.slug`.

```ts
// src/app/(shop)/category/[slug]/page.tsx
export const dynamic = "force-dynamic"; // CategoryPageTemplate seeds per-user wishlist hearts

// Request-deduped lookup: generateMetadata AND the page each need the row.
const getCategoryBySlug = cache((slug: string) =>
  prisma.category.findUnique({ where: { slug } }),
);

export async function generateMetadata({ params }): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) return { title: "Category Not Found | Ali Baba" };
  // ...title / description / alternates.canonical / openGraph from the row
}

export default async function CategoryPage({ params }) {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) notFound();                       // unknown slug → HTTP 404

  const products = await prisma.product.findMany({
    where: { isAvailable: true, categoryId: category.id },   // resolved, indexed FK
    include: { category: true, variants: { orderBy: { price: "asc" } } },
    orderBy: { createdAt: "desc" },
  });

  return <CategoryPageTemplate title={category.name} description={...} products={products} />;
}
```

Three properties to preserve:

1. **React `cache()` deduplicates the category lookup.** `generateMetadata` (for SEO) and `CategoryPage` both call `getCategoryBySlug(slug)`. Without `cache()` that's two identical `findUnique` round-trips per request; with it, the second call is served from React's per-request memo — **one** Postgres round-trip. This is the same discipline `getServerSession()` uses in [`src/lib/session.ts`](../src/lib/session.ts). Any future code path that needs the category row again in the same request should reuse `getCategoryBySlug`, not issue a fresh query.
2. **Filtering by `categoryId`, not `identifier`.** Once the row is resolved, products are filtered by the indexed FK. This is why the same route works for standard categories (which have no `identifier`) exactly as it does for core ones — there's no enum branch.
3. **`force-dynamic` is mandatory.** `CategoryPageTemplate` seeds per-user wishlist hearts (§4.4); rendering from a shared ISR cache would leak one user's hearts to the next visitor.

**Footer coupling caveat — `HARDENING`.** [`Footer.tsx`](../src/components/Footer.tsx) links into this route with hrefs that use real database slugs (`/category/oriental-sweets`, `/category/western-sweets`, `/category/eid-sweets`, `/category/bakery`). But it is a **hardcoded constant array**, with two consequences worth knowing:

- The link **labels** are editorial marketing copy that don't mirror the category names — "Modern Pastry" → `western-sweets`, "Bespoke Cakes" → `eid-sweets`, "Luxury Beverages" → `bakery`. And `moulid-sweets` is intentionally not linked.
- Because slugs are derived from the category `name` ([`slugify`](../src/lib/actions/categories.ts)), **renaming a core category in the admin changes its slug and silently 404s the matching footer link.** The links are correct today; they are not self-healing. If the footer ever needs to be authoritative, drive it from `prisma.category.findMany({ where: { identifier: { not: null } } })` the way the homepage slider does.

| Entry point | Source | Shows |
|---|---|---|
| Homepage slider | `Category.findMany({ identifier: { not: null } })`, enum order | The configured core categories (0–5 cards) |
| `/shop` | `Category` (type SHOP, all) + `Product` (type SHOP, available) | Full catalog, client-filtered by category pill |
| `/category/[slug]` | `getCategoryBySlug(slug)` → products by `categoryId` | **Any** category's landing page (core or standard), one route |

---

## 2. Product Detail Page (PDP) & Dynamic Variants — `BUILT`

The PDP previously locked onto the cheapest variant and never let a customer choose another. It now fully supports multi-variant selection through a pair of client islands. This was the storefront's highest-leverage gap; it is closed.

### 2.1 Server shell — [`(shop)/product/[slug]/page.tsx`](../src/app/(shop)/product/[slug]/page.tsx)

The page is a `force-dynamic` Server Component (the review panel and wishlist heart are personalized to the session). It fetches everything it needs in one `Promise.all` and projects the **full** variant set into a client view-model:

```ts
const [product, session, wishlistedIds] = await Promise.all([
  prisma.product.findUnique({
    where: { slug },
    include: {
      category: true,
      variants: { orderBy: { price: "asc" } },                 // [0] = lowest price
      reviews: { where: { isApproved: true }, orderBy: { createdAt: "desc" } },
    },
  }),
  getServerSession(),
  getWishlistedProductIds(),
]);
if (!product) notFound();

const variants = product.variants.map((v) => ({
  id: v.id, name: v.name, price: v.price,
  isAvailable: v.isAvailable, compareAtPrice: v.compareAtPrice,
}));
```

It passes `variants` (plus minimal product identity and `initialIsFavorited`) to [`ProductPurchasePanel`](../src/components/products/ProductPurchasePanel.tsx). **The price is intentionally not rendered in the Server Component** — it reflects the *selected* variant, so it lives in the client island. A static server-rendered price would silently disagree with the pills the moment a customer chooses a non-default variant.

### 2.2 The data contract

```prisma
model ProductVariant {
  id             String  @id @default(cuid())
  productId      String
  name           String           // free text, e.g. "Half Kilo", "1 Piece / 250g"
  sku            String? @unique
  price          Float
  compareAtPrice Float?           // strikethrough "was" price — schema-ready, null until promos ship
  isAvailable    Boolean @default(true)
  sortOrder      Int     @default(0)
}
```

Three shape facts the islands honor:

1. **Variants are a flat list, not a size × color matrix.** `name` is one free-text string per row — there's no `size`/`color`/`flavor` column. The selector is therefore a **single-axis** pill list over `variants[]`, each pill labeled with the full `name`. True independent axes would be a schema change (a `VariantOption` join model); the UI does not simulate it by parsing `name` strings.
2. **Images live on `Product`, not `ProductVariant`.** Switching the selected variant updates **price, availability, and the Add-to-Cart payload** — it does *not* swap the photo gallery, because there's nothing per-variant to swap to.
3. **`compareAtPrice` exists but is `null` today** (neither product form exposes it yet). It is rendered **defensively** on the PDP so the storefront needs no second pass the day admin promotion support ships.

### 2.3 [`ProductPurchasePanel.tsx`](../src/components/products/ProductPurchasePanel.tsx) — the client island

This is the `"use client"` island that groups **price + variant selector + quantity stepper + CTA + wishlist** into one coherent purchase surface. Its defining property is a **single source of truth**:

```ts
// Default to the cheapest AVAILABLE variant (variants arrive price-asc).
const defaultVariant = variants.find((v) => v.isAvailable) ?? variants[0];
const [selectedVariantId, setSelectedVariantId] = useState(defaultVariant?.id ?? "");

// Everything is DERIVED from the selected id — never stored in parallel state.
const activeVariant = variants.find((v) => v.id === selectedVariantId) ?? defaultVariant;
const canPurchase   = !!activeVariant?.isAvailable;
const unitPrice     = activeVariant?.price ?? 0;
const showCompareAt = activeVariant?.compareAtPrice != null && activeVariant.compareAtPrice > unitPrice;
```

- **No drift by construction.** Price, sold-out state, line total, and the cart payload are all computed from `activeVariant`. There is no second `useState` holding "the current price" that a fast double-click could desync from the selected pill — the bug class that parallel state invites simply can't occur here.
- **`tabular-nums` on every numeric node — a free CLS win.** The hero price (`font-serif … tabular-nums`), the `compareAtPrice` strikethrough, the quantity readout, and the CTA's line total all use fixed-width digits, so changing variant from `60` to `450`, or a discount appearing/disappearing, never reflows the surrounding layout.
- **Accessible compare-at pricing.** When `compareAtPrice > price`, the original is shown struck-through beside the sale price with `aria-label={`Original price ${…} EGP`}`, so a screen reader announces it as a former price rather than a bare number. The CTA likewise carries a dynamic `aria-label` describing the quantity and line total (or "Selected option is sold out").
- **Add-to-Cart sends the *selected* variant.** `handleAdd` calls `addItem({ id: product.id, variantId: activeVariant.id, … })` — `activeVariant.id`, never `variants[0].id`. This is the value that lands in lockstep with the cart's `variantId` keying (§5). A sold-out active variant disables the stepper and CTA outright.

### 2.4 [`VariantSelector.tsx`](../src/components/products/VariantSelector.tsx) — stateless, single-axis pills

The selector owns **no state of its own**. The parent holds `selectedVariantId` and passes it down with an `onSelect` callback, so the pills can never drift from the price/payload derived in the panel:

```tsx
export default function VariantSelector({ variants, selectedVariantId, onSelect }) {
  if (variants.length <= 1) return null;          // a lone variant isn't a choice — render nothing
  return (
    <div role="radiogroup" aria-label="Product options" className="flex flex-wrap gap-2.5">
      {variants.map((variant) => {
        const isSelected = variant.id === selectedVariantId;
        const soldOut    = !variant.isAvailable;
        return (
          <button role="radio" aria-checked={isSelected} disabled={soldOut} key={variant.id}
                  onClick={() => onSelect(variant.id)} /* selected | sold-out | default styling */>
            <span>{variant.name}</span>
            <span className="font-mono tabular-nums /* struck through when sold out */">
              {variant.price.toLocaleString("en-EG")}
            </span>
          </button>
        );
      })}
    </div>
  );
}
```

| Behavior | Implementation |
|---|---|
| Single variant | Returns `null` — no dead single pill |
| Per-pill price | Each pill shows **that variant's own price** (`font-mono tabular-nums`), since variants aren't uniformly priced — price lives on the pill, not floating above the list |
| Out-of-stock variant | `isAvailable: false` → pill is **disabled but kept in the DOM** (strikethrough price, muted text), so the option stays visible/indexable rather than vanishing |
| A11y | `role="radiogroup"` wrapper, `role="radio"` + `aria-checked` per pill, keyboard-focusable, visible `focus-visible` ring |

---

## 3. The Café Menu Page (`/menu`) — `BUILT`

The café menu is **structurally isolated** from the shop catalog — `MenuCategory`/`MenuItem` carry no foreign key to `Category`, `Product`, or `ProductVariant`:

```prisma
model MenuCategory {
  id           String  @id @default(cuid())
  title        String
  slug         String  @unique
  order        Int     @default(0)
  isFixedPrice Boolean @default(false)
  items        MenuItem[]
}
model MenuItem { id String @id @default(cuid()); name String; price Float; order Int @default(0); categoryId String }
```

This separation is deliberate: the café menu is a **read-only, dine-in/pickup price list**, not something that flows into the cart or checkout. Don't wire an "Add to Cart" button onto a `MenuItem` — there's no `CartItem`/`OrderItem` relation to support it.

### 3.1 Fixed-price rendering — [`MenuClient.tsx`](../src/app/(shop)/menu/MenuClient.tsx)

A fixed-price category ("Smoothies") renders **one header price badge** (`items[0]?.price`), then a dense responsive grid of item *names only* — the price is never repeated for every flavor that costs the same.

**Important nuance:** "all items share one price" is a **soft, admin-workflow convention — not a database constraint.** `MenuItem.price` is an independent column on every row. The admin enforces the convention via the **"Prices" bulk action** ([`BulkPriceModal.tsx`](../src/components/admin/menu/BulkPriceModal.tsx) → [`bulkAdjustCategoryPrices`](../src/lib/actions/menu.ts)), one atomic `prisma.menuItem.updateMany({ where: { categoryId }, data: { price: { multiply: factor } } })`. The storefront reads `items[0]?.price` and trusts it. **If a fixed-price category ever renders a price that looks wrong, check for divergent `MenuItem.price` rows before assuming a rendering bug.**

### 3.2 Standard (itemized) rendering & strict ordering

Each `MenuRow` is a leader-line row: price (left, `tabular-nums`, EGP suffix `ج.م`) — dotted leader (pure CSS `repeating-linear-gradient`) — Arabic item name (right, `dir="rtl" lang="ar"`). Ordering is enforced **at the query**, never re-sorted client-side:

```ts
const categories = await prisma.menuCategory.findMany({
  orderBy: { order: "asc" },
  include: { items: { orderBy: { order: "asc" } } },
});
```

Both `order` columns are `Int @default(0)` with their own `@@index([order])`. The contract for any future change: **always sort via `orderBy: { order: "asc" }` in the Prisma query** — a client-side re-sort would silently override the admin's deliberate sequencing.

### 3.3 Supporting UX

- **Sticky scroll-spy nav** — an `IntersectionObserver` (not a `scroll` listener) tracks the in-view section; `rootMargin: "-22% 0px -65% 0px"` biases activation toward a section once it's meaningfully in frame. Observer-based tracking avoids per-frame main-thread work.
- **Empty state** — zero categories renders "Our menu is being prepared" rather than a blank page.
- **Currency & locale** — Arabic item names are RTL-scoped per element (`dir="rtl" lang="ar"`) inside an otherwise LTR page shell.

---

## 4. Customer Auth Space & RBAC

### 4.1 Roles & session — `BUILT`

```prisma
enum UserRole { USER  ADMIN }
model User { ... role UserRole @default(USER) ... }
```

Better Auth provides the session; `role` is layered on as an `additionalFields` entry with `input: false` ([`src/lib/auth.ts`](../src/lib/auth.ts)) — a client **cannot set its own role at signup**, only a direct DB write can promote a user to `ADMIN`.

| Context | Access pattern | File |
|---|---|---|
| Server Component / Server Action | `getServerSession()` (React `cache()`-wrapped), or `requireAdmin()` to throw on non-admin | [`src/lib/session.ts`](../src/lib/session.ts) |
| Client Component | `useSession()` — Better Auth's React client, with `inferAdditionalFields<typeof auth>()` so `session.user.role` is typed | [`src/lib/auth-client.ts`](../src/lib/auth-client.ts) |

### 4.2 Navbar visibility — `BUILT`

[`Navbar.tsx`](../src/components/Navbar.tsx) / [`UserMenu.tsx`](../src/components/UserMenu.tsx) gate the **Admin Dashboard** link behind `const isAdmin = user?.role === "ADMIN"`, while **My Orders** and **Wishlist** render unconditionally inside the "is logged in" branch:

| Session state | My Orders | Wishlist | Admin Dashboard |
|---|---|---|---|
| Guest (no session) | — | — | — |
| `USER` | ✓ | ✓ | — |
| `ADMIN` | ✓ | ✓ | ✓ |

The takeaway for any future navbar change: **My Orders / Wishlist are an "is authenticated" check, not a role check** — both roles see them; only the Admin Dashboard link is role-gated. The auth block also renders a pulse skeleton (not "Sign In") while `useSession()` is `isPending`, preventing a logged-in user from seeing a "Sign In" flash before their account menu resolves. Apply the same `isPending` guard to any new auth-aware UI.

### 4.3 Route protection via the Edge Proxy — `BUILT` (was a "no middleware" `HARDENING`; now shipped)

Authenticated routes are now gated structurally at the Edge, not only by per-page opt-in. The project ships [`src/proxy.ts`](../src/proxy.ts) — **Next.js 16's renamed middleware** (the framework resolves `PROXY_FILENAME = "proxy"` at `(?:src/)?proxy`; on this version the file must be `proxy.ts`, never `middleware.ts`):

```ts
import { getSessionCookie } from "better-auth/cookies";

export function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);     // presence check, NOT DB validation
  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", request.nextUrl.pathname);   // preserve destination
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/my-orders", "/my-orders/:path*", "/wishlist", "/wishlist/:path*"],
};
```

- **Optimistic & edge-safe.** `getSessionCookie` only confirms a Better Auth cookie is present — it can't validate against Postgres (Prisma doesn't run on the Edge). The proxy imports only `next/server` and `better-auth/cookies`; never add `@/lib/prisma` or `@/lib/auth` here.
- **Defense in depth, not a replacement.** The pages still self-guard: [`/wishlist`](../src/app/(shop)/wishlist/page.tsx) and [`/my-orders`](../src/app/(shop)/my-orders/page.tsx) both run `const session = await getServerSession(); if (!session) redirect("/login");`. The proxy is the cheap first gate that catches "developer forgot the guard"; `getServerSession()` stays the source of truth and rejects a present-but-expired cookie that slips past the Edge. (The in-page guard redirects to a bare `/login` without `?redirect=`; the destination round-trip is a property of the proxy path.)
- **Extending it.** A new authenticated route is protected by adding its bare path **and** `:path*` wildcard to `config.matcher` — and still adding the in-page `getServerSession()` check, which remains the only gate for any Server Action invoked directly.

### 4.4 The login & redirect flow — `BUILT`

[`/login/page.tsx`](../src/app/(shop)/login/page.tsx) is a **Server Component** whose only job is to be a `<Suspense>` boundary:

```tsx
export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginClient />
    </Suspense>
  );
}
```

The boundary is **required**: [`LoginClient.tsx`](../src/app/(shop)/login/LoginClient.tsx) reads `useSearchParams()` to recover the proxy's `?redirect=` intent, and Next.js forces any search-params reader under Suspense or the whole route opts out to client-side rendering at build time. `LoginFallback` is an `animate-pulse` skeleton sized to the real two-column layout — same skeleton convention as the navbar's auth state — so there's no blank flash on a client-side navigation into `/login`.

**Open-redirect hardening — `sanitizeRedirect`.** The `redirect` value is attacker-controllable (anyone can craft `/login?redirect=https://evil.com` directly; it never had to pass through our proxy to arrive). `LoginClient` runs it through a strict guard:

```ts
function sanitizeRedirect(path: string | null): string {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return "/";
  return path;
}
const redirectTo = sanitizeRedirect(searchParams.get("redirect"));
```

Only a single-slash, same-origin relative path survives. Absolute URLs and the protocol-relative `//host` trick (which browsers resolve to a *different* origin) both collapse to `"/"`. On a successful `signIn.email`, navigation is **`router.push(redirectTo)` followed by `router.refresh()`** — Better Auth's vanilla email sign-in does not auto-navigate (its `callbackURL` is only honored by redirect-based flows like OAuth/verification, and is forwarded only for completeness), so the explicit `router.push` is what actually returns the user to the page the proxy bounced them from.

> **`HARDENING`:** `sanitizeRedirect` currently lives as a private function inside `LoginClient.tsx`, not as a shared export in `@/lib/utils`. It's correct as-is; if a second redirect-consuming surface appears (e.g. a signup flow honoring `?redirect=`), promote it to `@/lib/utils` rather than duplicating it.

### 4.5 Wishlist flow — `BUILT`

Persisted to Postgres, not local state: `WishlistItem { userId, productId }` with `@@unique([userId, productId])`. The client-side contract:

- Toggling, listing, and existence-checking are all Server Actions ([`src/lib/actions/wishlist.ts`](../src/lib/actions/wishlist.ts)) — there's no `/api/wishlist` REST route.
- Every page that renders product cards seeds `initialIsFavorited` from `getWishlistedProductIds()` **on the server**, so the heart's first paint is already correct for the signed-in user — no flash-then-pop-in. [`CategoryPageTemplate`](../src/components/CategoryPageTemplate.tsx) builds a `Set` from it for O(1) per-card lookups; [`WishlistButton.tsx`](../src/components/products/WishlistButton.tsx) takes over interactivity (optimistic flip, `useTransition`, rollback + toast on failure).
- Because that per-user seeding can't be cached and served to the next visitor, every page doing it (`/shop`, the dynamic `/category/[slug]` route, the PDP) runs `export const dynamic = "force-dynamic"` rather than ISR. Carry this forward on any new product-listing surface.

### 4.6 My Orders dashboard — `BUILT`

[`/my-orders`](../src/app/(shop)/my-orders/page.tsx) mirrors the admin orders board's URL-driven filter pattern, scoped to `session.user.id`, and is protected by the proxy (§4.3) plus an in-page session check:

```ts
where: { userId: session.user.id, ...(status !== "ALL" ? { status } : {}) }
```

`OrderItem` stores a **snapshot** (`productName`, `variantName`, `unitPrice`, `quantity`) captured at purchase time — it does not re-read the live `Product`/`ProductVariant`. A customer's order from six months ago still shows the exact name and price they paid, even if that variant was since renamed, repriced, or archived. Never join back to the live catalog to render order history — the snapshot *is* the source of truth for a placed order.

---

## 5. Cart & Checkout Pipeline

### 5.1 Implementation — `BUILT`, variant-keyed

The cart is **client-only** — Zustand + `persist`, `localStorage` key `"ali-baba-cart"` ([`src/lib/cart-store.ts`](../src/lib/cart-store.ts)). There is no server-side cart sync for guests or logged-in users; only the final `placeOrder` touches the database.

```ts
export interface CartItem {
  id: string;         // parent product id — display / grouping / PDP links ONLY, never the merge key
  variantId: string;  // the purchasable unit, and the canonical identity of a cart line
  name: string;
  price: number;      // local display currency (EGP); server re-resolves the real price at checkout
  quantity: number;
  image: string;
  category?: string;
}
```

### 5.2 Every operation keys on `variantId` — `BUILT` (was a `BUG`; now fixed and live)

`addItem`, `removeItem`, and `updateQuantity` all identify a line by `variantId`:

```ts
addItem: (newItem) => set((s) => {
  const existing = s.items.find((i) => i.variantId === newItem.variantId);
  if (existing) {
    return { items: s.items.map((i) =>
      i.variantId === newItem.variantId ? { ...i, quantity: i.quantity + 1 } : i) };
  }
  return { items: [...s.items, { ...newItem, quantity: 1 }] };
});
removeItem:     (variantId) => /* filter i.variantId !== variantId */
updateQuantity: (variantId, quantity) => /* map by i.variantId === variantId; <1 removes */
```

**Why this is correct (and why it had to ship with §2's selector).** The store previously merged on the product `id`. The instant the PDP gained a real variant selector, that became a money bug: adding "Cake — Small" (`variantId: A`, 80) then "Cake — Large" (`variantId: B`, 150) would match the existing line by product id and merely bump quantity — keeping the Small's `variantId` and price, so checkout charged 2× Small. Keying every operation on `variantId` makes each chosen variant a distinct, correctly-priced line. The selector (§2) and this keying landed in the same change, never as a follow-up.

**Why `variantId` alone — not a composite `productId_variantId`.** `ProductVariant.id` is already a globally unique `cuid`, and every variant belongs to exactly one product. The database asserts the same modeling choice — the `CartItem` table's uniqueness is `@@unique([userId, variantId])`, not `([userId, productId, variantId])`:

```prisma
model CartItem {
  userId    String
  variantId String
  @@unique([userId, variantId])
  @@index([userId])
  @@index([variantId])
}
```

The client store's merge key matches the database's own key. Keep `id` (product id) on the line item for display grouping and PDP links — just never use it to dedup. **All React keys in the cart drawer and the checkout summary map over `variantId`**, consistent with this identity model.

**Migration safety.** The persisted shape is unchanged by the fix — `variantId` was always stored on `CartItem` — so previously-saved carts in `localStorage` remain valid with no migration. `partialize` persists only `items`, not the drawer `isOpen` flag.

**The `CartItem` table** exists in the schema but the live cart never writes to it (the cart is local-only; `placeOrder` creates `Order`/`OrderItem`, never `CartItem`). Treat it as a reserved extension point for a future "sync my cart across devices" feature — its only relevance here is confirming `variantId` as the correct dedup key.

### 5.3 Server-side price integrity — preserve this — `BUILT`

[`placeOrder`](../src/lib/actions/orders.ts) accepts only `{ variantId, quantity }` pairs and re-resolves price, availability, and parent-product availability **server-side**, inside a transaction — the client never sends a price, and `placeOrder` never trusts the cart store's `price` field (which is display-only). When touching the cart, don't start threading the client's `price` into the order payload "for convenience" — the checkout flow's entire price-integrity guarantee rests on the server being the only source of truth for what a variant costs. The full transaction design, VAT/delivery-fee math, and guest-checkout handling are in [`HOW_IT_WORKS.md` §6](./HOW_IT_WORKS.md).

### 5.4 `/cart` route — `GAP` (drawer-only today)

`src/app/(shop)/cart/` is an empty directory — there's no full-page cart view, only the slide-out [`CartSidebar.tsx`](../src/components/CartSidebar.tsx) drawer (opened from the navbar cart icon, or automatically on `addItem`). Worth a dedicated full page if a deep-linkable, shareable cart view is ever needed — noted only so the empty directory isn't mistaken for an oversight.

---

## 6. Performance & Core Web Vitals Checklist

| Metric | Lever in use | Where |
|---|---|---|
| **LCP** | Server Components fetch with Prisma at render time — hero image and cards arrive in the initial HTML, no client-fetch waterfall | `(shop)/page.tsx`, `/category/[slug]` |
| **LCP** | `next/image` with per-breakpoint `sizes`, `remotePatterns` scoped to the UploadThing CDN (`utfs.io`, `*.ufs.sh`) | [`next.config.ts`](../next.config.ts), `CategorySlider.tsx` |
| **CLS** | `tabular-nums` on **every** price node that can change at runtime — the PDP hero price, `compareAtPrice` strikethrough, variant-pill prices, quantity stepper, CTA line total, menu prices — so switching a variant or a discount toggling never reflows neighbouring text | `ProductPurchasePanel`, `VariantSelector`, `MenuRow` |
| **CLS** | Pulse-skeleton for the navbar auth state while `useSession()` is `isPending`; matching `animate-pulse` skeleton as the `/login` Suspense fallback | `Navbar.tsx`, `LoginFallback` |
| **INP** | `IntersectionObserver` for the menu scroll-spy instead of a `scroll` handler | `MenuClient.tsx` |
| **INP** | Every mutation (wishlist toggle, status change, add-to-cart) runs with optimistic local state — UI responds before the round-trip | wishlist, orders, `ProductPurchasePanel` |
| **INP** | Client-side category filtering on `/shop` trades a larger initial payload for zero-latency filter clicks — re-evaluate as the catalog grows | `ShopClient.tsx` |
| **TTFB** | React `cache()` dedupes the per-request category lookup across `generateMetadata` + page — one Postgres round-trip, not two | `/category/[slug]` |
| **Bundle size** | Embla Carousel (~6 KB) instead of a heavier carousel; Zustand (~1 KB) instead of Redux/Context for cart state | `CategorySlider.tsx`, `cart-store.ts` |
| **Hydration correctness** | Wishlist heart state and the PDP's default variant are computed/derived deterministically (server-seeded prop / cheapest-available) — never from a client-only `useEffect` fetch that reintroduces a flash-of-wrong-state | `getWishlistedProductIds()`, `ProductPurchasePanel` |

---

## 7. Open Items for Engineering

The blocking storefront work this document used to track is shipped. What remains is low-severity hardening:

| # | Item | Section | Severity | Status |
|---|---|---|---|---|
| 1 | PDP variant selector (chip list over `variants[]`, drives price / availability / Add-to-Cart) | §2 | — | ✅ Shipped (`ProductPurchasePanel` + `VariantSelector`) |
| 2 | Cart store merges on `variantId`, not product `id` | §5.2 | — | ✅ Shipped (atomic with #1) |
| 3 | Centralized authenticated-route protection | §4.3 | — | ✅ Shipped (`src/proxy.ts`) |
| 4 | Collapse the five static `/category/<slug>` routes into one dynamic route | §1.3 | — | ✅ Shipped (`category/[slug]/page.tsx`) |
| 5 | Wire `compareAtPrice` into the admin product forms (PDP already renders it defensively) | §2.2 | Low | Schema-ready; `null` until admin support ships |
| 6 | Drive footer category links from the DB (or accept the rename→404 coupling) | §1.3 | Low | Hardcoded array; labels are marketing copy, `moulid-sweets` omitted |
| 7 | Promote `sanitizeRedirect` to `@/lib/utils` if a second redirect surface appears | §4.4 | Low | Currently private to `LoginClient.tsx` |
| 8 | Build a full-page `/cart` view if a deep-linkable cart is needed | §5.4 | Low | Empty directory; drawer-only today |
| 9 | Revisit client-side `/shop` filtering once the catalog grows materially | §1.2 | Low | Not a problem yet |
