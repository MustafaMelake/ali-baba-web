# Storefront UX & Client-Side Architecture

**Stack:** Next.js 16 (App Router) · React 19 · Tailwind CSS v4 · Prisma 7 · PostgreSQL (Neon) · Better Auth · Zustand

**Audience:** front-end engineers building or extending the customer-facing storefront (`src/app/(shop)/**`).
**Scope:** this is the client-side companion to [`ARCHITECTURE.md`](./ARCHITECTURE.md) (admin internals) and [`HOW_IT_WORKS.md`](./HOW_IT_WORKS.md) (full-platform walkthrough — including the wishlist server actions, the checkout pricing transaction, and order history in real depth). Rather than re-explain what those two already cover well, this document focuses on the ground they don't: **homepage catalog structure, the product detail page's variant system, the café menu renderer, navbar RBAC, and cart integrity.** Every contract below is read directly from `prisma/schema.prisma` and the current `(shop)` route group — nothing here is aspirational unless explicitly tagged `GAP`.

**Status tags used throughout:**

| Tag | Meaning |
|---|---|
| `BUILT` | Already implemented and working as described — treat as the contract to preserve. |
| `GAP` | Does not exist yet. This section *is* the spec to build against. |
| `BUG` | Exists today, but produces an incorrect result in a reachable scenario. |
| `HARDENING` | Works, but a concrete improvement is recommended before scaling. |

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

This is intentional — do not change it to show a placeholder. An empty/disabled tile in a luxury-patisserie hero section reads as "we're unfinished," which is worse UX than a slightly shorter, fully-polished carousel. The amber "Not set up" badge is an **admin-only** affordance, rendered at [`/admin/categories`](../src/app/admin/categories/page.tsx) so staff can see which of the 5 slots still need a category — it must never leak into the public bundle.

**Cache strategy.** The page sets `export const revalidate = 3600` (hourly ISR) as a floor, but every category mutation in [`src/lib/actions/categories.ts`](../src/lib/actions/categories.ts) also calls `revalidatePath("/")` on create/update/delete. In practice a newly-assigned core category appears on the homepage on the *next request*, not after an hour-long wait — the hourly revalidate is a safety net, not the primary invalidation path. Keep calling `revalidatePath("/")` from any new category-mutating code.

**Slot reassignment ("transfer") semantics.** Because `identifier` is `@unique`, assigning `BAKERY` to a category that doesn't hold it while another category does doesn't throw a constraint error — [`transferIdentifier`](../src/lib/actions/categories.ts) clears the previous holder's `identifier` to `null` first, inside the same transaction, and the admin UI reports *"Core position moved here from 'X'."* From the storefront's side this is invisible (just a normal `revalidatePath("/")`), but it's worth knowing a core slot is a single mutable pointer, not a fixed assignment, when reasoning about invalidation timing.

### 1.2 Standard Categories & the Catalog Directory — `BUILT`

A standard category (`identifier === null`, `type: "SHOP"`) never gets its own slider slot or a dedicated landing route. It surfaces in exactly one place: the **`/shop` catalog directory** ([`page.tsx`](../src/app/(shop)/shop/page.tsx) + [`ShopClient.tsx`](../src/app/(shop)/shop/ShopClient.tsx)).

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

This fetches **every** SHOP category name — core and standard alike — and **every** available SHOP product, in two queries, once, server-side. Filtering by category afterward (`"All Collection"` pill + one pill per category name) happens **entirely client-side**:

```ts
const filtered = active === ALL ? products : products.filter((p) => p.category === active);
```

This is a deliberate trade-off: at the current catalog size, shipping the full product set once and filtering in memory means clicking a category pill is a zero-latency `setState` — no spinner, no re-fetch, just an animated grid reflow via `framer-motion`'s `layout` prop. **Revisit this once the SHOP catalog grows past roughly a few hundred products** — at that point the larger initial payload starts costing more (TTFB/LCP) than the filter-latency win is worth, and filtering should move to a server-read `?category=` param, the same pattern already used for `/admin/orders` and `/my-orders` (§4.5).

**Core categories also get a dedicated landing page** — `/category/oriental-sweets`, `/category/western-sweets`, `/category/moulid-sweets`, `/category/eid-sweets`, `/category/bakery` — five separate static route files, each hardcoding its own `CategoryIdentifier` and sharing one render component, [`CategoryPageTemplate.tsx`](../src/components/CategoryPageTemplate.tsx):

```ts
// src/app/(shop)/category/oriental-sweets/page.tsx
const products = await prisma.product.findMany({
  where: { isAvailable: true, category: { identifier: CategoryIdentifier.ORIENTAL_SWEETS } },
  include: { category: true, variants: { orderBy: { price: "asc" } } },
});
```

**Engineering note (`HARDENING`, not blocking):** these five files are ~30 lines of duplicated query/metadata boilerplate apiece, differing only in the hardcoded enum value, title, and SEO copy. A single dynamic route — `src/app/(shop)/category/[slug]/page.tsx`, looking up `prisma.category.findUnique({ where: { slug } })` and rendering `notFound()` on a miss — would collapse all five into one file, remove the need to hand-write a sixth if a `CategoryIdentifier` is ever added, and could naturally extend to give **standard categories** their own landing page too (today they only exist as a filter pill inside `/shop`). Not required to ship the rest of this document's scope, but flagged because this kind of duplication quietly drifts — one page gets an SEO update, the other four don't.

| Entry point | Source | Shows |
|---|---|---|
| Homepage slider | `Category.findMany({ identifier: { not: null } })`, enum order | Exactly the configured core categories (0–5 cards) |
| `/shop` | `Category` (type SHOP, all) + `Product` (type SHOP, available) | Full catalog, client-filtered by category pill |
| `/category/<core-slug>` ×5 | One static route per `CategoryIdentifier` | Single core category landing page |

---

## 2. Product Detail Page (PDP) & Dynamic Variants

This is the highest-leverage gap in the storefront today: **the admin already fully supports multi-variant products; the PDP does not yet let a customer choose between them.**

### 2.1 Current state — `BUG` / `GAP`

[`src/app/(shop)/product/[slug]/page.tsx`](../src/app/(shop)/product/[slug]/page.tsx) fetches every variant, then silently locks onto the cheapest one and never looks at the rest:

```ts
const product = await prisma.product.findUnique({
  where: { slug },
  include: {
    variants: { orderBy: { price: "asc" } },
    reviews: { where: { isApproved: true }, orderBy: { createdAt: "desc" } },
  },
});

const price = product.variants[0]?.price ?? 0;
const variantId = product.variants[0]?.id ?? "";
```

[`ProductAddToCart.tsx`](../src/components/ProductAddToCart.tsx) receives only that one flattened `{ id, variantId, name, price, images, category }` — there's no UI anywhere on the PDP that knows a second variant exists. A product configured in the admin with three variants ("1 Piece / 60g," "Half Kilo," "1 Kilo" at three different prices) is, from a customer's perspective, a single-priced product showing only the cheapest option.

### 2.2 The data contract you're building against

```prisma
model ProductVariant {
  id             String  @id @default(cuid())
  productId      String
  name           String           // free text, e.g. "Half Kilo", "1 Piece / 250g"
  sku            String? @unique
  price          Float
  compareAtPrice Float?           // strikethrough "was" price — schema-ready, not yet wired in admin
  isAvailable    Boolean @default(true)
  sortOrder      Int     @default(0)
}
```

Three things about this shape directly constrain the selector design — get these wrong and the spec fights the schema:

1. **Variants are a flat list, not a size × color matrix.** `name` is one free-text string per row ([`NewProductForm.tsx`](../src/components/admin/NewProductForm.tsx)'s `VariantRow = { name, price, sku }` — there's no separate `size`/`color`/`flavor` column). Build the selector as a **single-axis chip/segmented list over `variants[]`**, each chip labeled with the full `name` — not a two-dimensional "pick a size, then pick a color" picker. If the catalog ever needs true independent axes, that's a schema change (a `VariantOption` join model) — don't simulate it client-side by parsing `name` strings.
2. **Images live on `Product`, not `ProductVariant`.** `images: String[]` has no per-variant counterpart. Switching the selected variant must update **price, SKU/availability, and the Add-to-Cart payload** — it must *not* attempt to swap the photo gallery, because there's nothing to swap to. If per-variant imagery becomes a real requirement later, that's a migration (add an optional `images: String[]` to `ProductVariant`, fall back to the parent product's gallery when empty) — don't fake it in the UI against the current schema.
3. **`compareAtPrice` exists but isn't wired up yet.** Neither `NewProductForm` nor `EditProductForm` currently exposes it, so today it's always `null`. Render it defensively on the PDP (`compareAtPrice != null && compareAtPrice > price` → strikethrough old price beside the new one) so the storefront doesn't need a second pass the day admin support for promotions ships.

### 2.3 Variant selector — UX spec (`GAP`)

| Element | Behavior |
|---|---|
| Default selection | Cheapest **available** variant: `variants.find(v => v.isAvailable) ?? variants[0]` — preserves the "from {price}" promise already shown on every product card in `/shop` and the category pages |
| Rendering | Reuse the existing rounded-pill chip pattern (`ShopClient`'s category filter, `MenuClient`'s sub-nav) for visual consistency — one chip per `variant.name`, each chip showing *that variant's own price* (variants aren't uniformly priced, so price must live on the chip, not float separately above the list) |
| Out-of-stock variant | `isAvailable: false` → render the chip **disabled, not hidden** (strikethrough price, muted text). Hiding it would make a customer think the size/flavor never existed; a disabled chip honestly communicates "temporarily out" and keeps indexed content stable |
| Selection state | A single `useState<string>(defaultVariantId)`. Derive everything else — `activeVariant = variants.find(v => v.id === selectedId)!`, the displayed price, the Add-to-Cart payload — from that one source. Don't keep price/SKU in parallel state slices; that's how a selector and its price display drift out of sync on a fast double-click |
| Price update | Re-render the price node from `activeVariant.price` on every selection change. Use `tabular-nums` (already the convention in [`MenuClient.tsx`](../src/app/(shop)/menu/MenuClient.tsx)'s `MenuRow`) so a price changing from `60` to `450` doesn't shift surrounding layout — a direct, free CLS win |
| Add to Cart payload | Must send `activeVariant.id`, never `variants[0].id` — this is the exact value the cart fix in §5.3 needs to land in lockstep with |

### 2.4 Why this matters beyond UX

The PDP's single-variant assumption is also *why* the cart bug in §5.2 has stayed latent: today it's structurally impossible to add two different variants of the same product to the cart, because there's no UI path to select a second one. **The moment this selector ships, that bug goes live** — ship the cart key fix (§5.3) in the same change, not as a follow-up.

---

## 3. The Café Menu Page (`/menu`)

### 3.1 Status — `BUILT`

Unlike the PDP, the café menu already correctly implements everything asked of it here, including the fixed-price/itemized split. It's also **structurally isolated** from the shop catalog — `MenuCategory`/`MenuItem` carry no foreign key to `Category`, `Product`, or `ProductVariant`:

```prisma
model MenuCategory {
  id           String  @id @default(cuid())
  title        String
  slug         String  @unique
  order        Int     @default(0)
  isFixedPrice Boolean @default(false)
  items        MenuItem[]
}

model MenuItem {
  id         String @id @default(cuid())
  name       String   // typically Arabic, rendered RTL
  price      Float
  order      Int    @default(0)
  categoryId String
}
```

This separation is deliberate, per the schema's own comment: the café menu is a **read-only, dine-in/pickup price list**, not something that flows into the cart or checkout. Don't wire an "Add to Cart" button onto a `MenuItem` — there's no `CartItem`/`OrderItem` relation to support it, and the page's own disclaimer banner is explicit that the menu is *"served exclusively for dine-in & branch pickup experience."*

### 3.2 Fixed-price rendering — [`MenuClient.tsx`](../src/app/(shop)/menu/MenuClient.tsx)

```tsx
if (category.isFixedPrice) {
  const unitPrice = category.items[0]?.price;
  return (
    <MenuSection ...>
      {/* one shared price badge, rendered once per category */}
      {unitPrice != null && <PriceBadge value={unitPrice} label="All flavours at a fixed price" />}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4">
        {category.items.map((item) => (
          <div key={item.id} dir="rtl" lang="ar">{item.name}</div>
        ))}
      </div>
    </MenuSection>
  );
}
```

A fixed-price category ("Smoothies") renders **one header price badge**, then a dense responsive grid (2 columns on mobile, 3 on ≥small) of item *names only* — the price is never repeated 12 times for 12 flavors that all cost the same.

**Important nuance for whoever maintains this:** "all items share one price" is a **soft, admin-workflow convention — not a database constraint.** `MenuItem.price` is an independent column on every row; nothing stops two items in the same `isFixedPrice` category from drifting apart. The admin enforces the convention two ways, not the schema:

- New items added to a fixed-price category default their price input to `items[0]?.price` ([`MenuItemsEditor.tsx`](../src/components/admin/menu/MenuItemsEditor.tsx)) — a UI nudge, not a hard rule.
- The **"Prices" bulk action** ([`BulkPriceModal.tsx`](../src/components/admin/menu/BulkPriceModal.tsx) → [`bulkAdjustCategoryPrices`](../src/lib/actions/menu.ts)) is the real mechanism for moving a fixed-price category's price: one atomic `prisma.menuItem.updateMany({ where: { categoryId }, data: { price: { multiply: factor } } })` scales every item in the category by the same factor in a single statement, which is what keeps them in sync over time.

The storefront reads `items[0]?.price` and trusts it as *the* category price — accurate as long as the admin convention holds. **If a fixed-price category ever renders a price that looks wrong, check for divergent `MenuItem.price` rows before assuming a rendering bug.**

### 3.3 Standard (itemized) rendering

```tsx
return (
  <MenuSection ...>
    {category.items.map((item) => <MenuRow key={item.id} name={item.name} price={item.price} />)}
  </MenuSection>
);
```

Each `MenuRow` is a leader-line row: price (left, `tabular-nums`, EGP suffix `ج.م`) — dotted leader (pure CSS `repeating-linear-gradient`, no SVG/image asset) — Arabic item name (right, `dir="rtl" lang="ar"`).

### 3.4 Strict ordering — enforced at the query, not in the component

```ts
const categories = await prisma.menuCategory.findMany({
  orderBy: { order: "asc" },
  include: { items: { orderBy: { order: "asc" } } },
});
```

Both `MenuCategory.order` and `MenuItem.order` are plain `Int @default(0)` columns, each backed by its own `@@index([order])`. The contract for any future change to this page: **always sort via `orderBy: { order: "asc" }` in the Prisma query — never re-sort the array client-side** (alphabetically, by price, etc.). The `order` column is the admin's deliberate sequencing of the menu; a client-side re-sort would silently override it.

### 3.5 Supporting UX already in place

- **Sticky scroll-spy nav** — an `IntersectionObserver` (not a `scroll` event listener) tracks which section is in view and highlights the matching nav pill; `rootMargin: "-22% 0px -65% 0px"` biases activation toward a section once it's meaningfully in frame, not the instant its top pixel appears. Observer-based tracking avoids the jank and main-thread cost of a listener firing on every scroll frame.
- **Empty state** — zero categories renders "Our menu is being prepared" rather than a blank page.
- **Currency & locale** — Arabic item names are RTL-scoped per element (`dir="rtl" lang="ar"`) inside an otherwise LTR page shell, so mixed Arabic/English/numeral content lays out correctly without flipping the whole page direction.

---

## 4. Customer Auth Space & RBAC

### 4.1 Roles & session — `BUILT`

```prisma
enum UserRole { USER  ADMIN }
model User { ... role UserRole @default(USER) ... }
```

Better Auth provides the session; `role` is layered on as an `additionalFields` entry with `input: false` ([`src/lib/auth.ts`](../src/lib/auth.ts)) — a client **cannot set their own role at signup**, only the server/database can promote a user to `ADMIN`.

| Context | Access pattern | File |
|---|---|---|
| Server Component / Server Action | `getServerSession()`, or `requireAdmin()` to throw on non-admin | [`src/lib/session.ts`](../src/lib/session.ts) |
| Client Component | `useSession()` — Better Auth's React client, with `inferAdditionalFields<typeof auth>()` so `session.user.role` is typed without manual augmentation | [`src/lib/auth-client.ts`](../src/lib/auth-client.ts) |

### 4.2 Navbar visibility — `BUILT`, RBAC fix confirmed

The relevant fix (commit `184de99`) did not add a role *branch* — [`Navbar.tsx`](../src/components/Navbar.tsx) and [`UserMenu.tsx`](../src/components/UserMenu.tsx) already had `const isAdmin = user?.role === "ADMIN"` gating the admin link. The bug was that **My Orders and Wishlist links were missing from the markup entirely, for every role.** The fix added them unconditionally inside the "is logged in" branch, alongside — not inside — the admin-only block:

```tsx
// src/components/Navbar.tsx — mobile drawer, inside the `user ? (...) : (...)` branch
<Link href="/my-orders">
  <Package className="h-4 w-4" />
  My Orders
</Link>

<Link href="/wishlist">
  <Heart className="h-4 w-4" />
  Wishlist
</Link>

{isAdmin && (
  <Link href="/admin">
    <LayoutDashboard className="h-4 w-4" />
    Admin Dashboard
  </Link>
)}
```

`UserMenu.tsx` mirrors this exact pattern in the desktop dropdown.

| Session state | My Orders | Wishlist | Admin Dashboard |
|---|---|---|---|
| Guest (no session) | — | — | — |
| `USER` | ✓ | ✓ | — |
| `ADMIN` | ✓ | ✓ | ✓ |

The takeaway for any future navbar change: **My Orders / Wishlist are an "is authenticated" check, not a role check** — both roles see them. Only the Admin Dashboard link is actually role-gated. Keep it that way; a staff member with the `ADMIN` role who also shops should still see their own orders and wishlist exactly like any other customer.

One more detail worth carrying forward: the auth block renders a pulse skeleton, not "Sign In," while `useSession()` is `isPending` —

```tsx
// Avoid a flash of "Sign In" before the session resolves.
{isPending ? <div className="h-9 w-9 animate-pulse rounded-full bg-stone-100" /> : user ? (...) : (...)}
```

— which prevents a logged-in user from seeing a "Sign In" button flash for one frame before flipping to their account menu. Apply the same `isPending` guard to any new auth-aware UI (e.g., a "Login to review" CTA) rather than defaulting to the logged-out view while session state resolves.

### 4.3 Route protection — `HARDENING`

There is currently **no `middleware.ts`** in the project — `/wishlist`, `/my-orders`, and similar pages each guard themselves inline:

```ts
// src/app/(shop)/wishlist/page.tsx
const session = await getServerSession();
if (!session) redirect("/login");
```

This works, but it's a per-page opt-in, not a structural guarantee — a new authenticated-only page is only protected if its author remembers to add the check. **Recommendation:** add `src/middleware.ts` with a `matcher` covering known authenticated routes (`/my-orders/:path*`, `/wishlist/:path*`) that redirects unauthenticated requests to `/login` before the page renders. Keep the in-page checks too as defense in depth — they remain the *only* gate for any Server Action invoked directly — but middleware closes the "forgot to add the guard" failure mode at the routing layer instead of relying on every page author remembering it.

### 4.4 Wishlist flow — `BUILT` (full server-action design in [`HOW_IT_WORKS.md` §3.1](./HOW_IT_WORKS.md))

Persisted to Postgres, not local/client state: `WishlistItem { userId, productId }` with `@@unique([userId, productId])`. What's relevant to the client-side contract here:

- Toggling, listing, and existence-checking are all Server Actions ([`src/lib/actions/wishlist.ts`](../src/lib/actions/wishlist.ts)) — there's no `/api/wishlist` REST route.
- Every page that renders product cards seeds `initialIsFavorited` from `getWishlistedProductIds()` **on the server**, so the heart icon's first paint is already correct for the signed-in user — no flash-then-pop-in once a client fetch resolves.
- Because that per-user seeding can't be cached and served to the next visitor, every page doing it (`/shop`, the five category pages, the PDP) runs `export const dynamic = "force-dynamic"` rather than ISR. Carry this forward on any new product-listing surface — caching a page that embeds one user's wishlist state into a shared ISR cache leaks it to (or stales it for) whoever else hits that cache entry next.

### 4.5 My Orders dashboard — `BUILT` (full design in [`HOW_IT_WORKS.md` §3.3](./HOW_IT_WORKS.md))

[`/my-orders`](../src/app/(shop)/my-orders/page.tsx) mirrors the admin orders board's URL-driven filter pattern, scoped to `session.user.id`:

```ts
where: { userId: session.user.id, ...(status !== "ALL" ? { status } : {}) }
```

| `OrderStatus` | Suggested customer-facing tone |
|---|---|
| `PENDING` | "Order received" — neutral, awaiting confirmation |
| `PREPARING` | "Being prepared" — active/in-progress accent |
| `SHIPPED` | "On its way" — in-transit accent |
| `DELIVERED` | "Delivered" — success/green |
| `CANCELLED` | "Cancelled" — muted/grey, not red (avoid implying customer fault) |

One invariant worth stating explicitly because it's easy to assume otherwise: `OrderItem` stores a **snapshot** (`productName`, `variantName`, `unitPrice`, `quantity`) captured at the moment of purchase — it does not re-read the live `Product`/`ProductVariant` on every page view. A customer's order from six months ago still shows the exact name and price they paid, even if that variant has since been renamed, repriced, or archived. Never "helpfully" join back to the live catalog to render order history — the snapshot *is* the source of truth for a placed order.

---

## 5. Cart & Checkout Pipeline

### 5.1 Current implementation — `BUILT`, but see the bug in §5.2

The cart is **client-only** — Zustand + `persist` middleware, `localStorage` key `"ali-baba-cart"` ([`src/lib/cart-store.ts`](../src/lib/cart-store.ts)). There is no server-side cart sync today, for guests or logged-in users alike:

```ts
export interface CartItem {
  id: string;         // product id — currently the merge key
  variantId: string;  // carried along for pricing, but not used for merging
  name: string;
  price: number;
  quantity: number;
  image: string;
  category?: string;
}
```

### 5.2 The bug — `BUG`, will activate the moment §2's selector ships

`addItem` merges on **product id**, not variant id:

```ts
const existing = s.items.find((i) => i.id === newItem.id);
```

Trace what happens once a variant selector exists: a customer adds "Cake — Small" (`variantId: A`, price 80), then switches the PDP selector to "Cake — Large" (`variantId: B`, price 150) and adds again. `newItem.id` is the same product id both times, so the second `addItem` call hits the `existing` branch — and that branch **only increments `quantity`**, leaving the line's stored `variantId` and `price` exactly as they were from the first add. The cart now shows "Cake × 2" at the Small price, while the customer believes they ordered one Small and one Large. Checkout would then charge for 2× Small — a real, money-incorrect outcome, not a cosmetic one.

This is dormant today only because the PDP has no way to add a second variant of the same product (§2.1). It isn't a hypothetical edge case — it's the **default outcome** of shipping a variant selector without this fix.

### 5.3 The fix — key every cart operation by `variantId`

```ts
const existing = s.items.find((i) => i.variantId === newItem.variantId);
// the same change applies to removeItem / updateQuantity, which should take variantId, not id
```

**Why `variantId` alone — not a composite `productId_variantId` string:** `ProductVariant.id` is already a globally unique `cuid`, and every variant belongs to exactly one product (`productId` is a required FK). A composite key would encode information `variantId` already implies. This isn't just an opinion — it's what the schema itself asserts. The (currently unused, see below) `CartItem` Prisma model defines its uniqueness as:

```prisma
model CartItem {
  userId    String
  variantId String
  @@unique([userId, variantId])   // not @@unique([userId, productId, variantId])
}
```

Match the client store's merge key to the database's own modeling choice. Keep `id` (product id) on the line item — it's still useful for display grouping and linking back to the PDP — just stop using it as the dedup key.

**Note on the `CartItem` table:** it exists in the schema, but the live cart flow doesn't write to it — the cart is local-state-only, and only the final `placeOrder` call touches the database (creating `Order`/`OrderItem`, never `CartItem`). Treat `CartItem` as a reserved extension point for a possible future "sync my cart across devices" feature, not something to wire up as part of this fix — its only relevance here is confirming `variantId` as the correct dedup key.

### 5.4 What's already correct — preserve this when refactoring

[`placeOrder`](../src/lib/actions/orders.ts) accepts only `{ variantId, quantity }` pairs and re-resolves price, availability, and parent-product availability **server-side**, inside a transaction — the client never sends a price, and `placeOrder` never trusts the cart store's `price` field. When fixing §5.3, don't accidentally start threading the client's `price` into the order payload "for convenience" — the checkout flow's entire price-integrity guarantee rests on the server being the only source of truth for what a variant costs. The full transaction design, the VAT/delivery-fee math, and guest-checkout handling are already documented in [`HOW_IT_WORKS.md` §3.2](./HOW_IT_WORKS.md) — this document only concerns the cart object feeding into it.

### 5.5 `/cart` route — currently drawer-only

`src/app/(shop)/cart/` exists as an empty directory — there's no full-page cart view today, only the slide-out [`CartSidebar.tsx`](../src/components/CartSidebar.tsx) drawer (opened from the navbar cart icon, or automatically on `addItem`). Worth a dedicated full page if a deep-linkable, shareable cart view is ever needed (e.g., a "review your cart" link in a marketing email) — out of scope for this document's five sections, noted only so it isn't mistaken for an oversight.

---

## 6. Performance & Core Web Vitals Checklist

The patterns already in this codebase map onto specific Core Web Vitals — worth preserving deliberately as the PDP variant selector and cart fix above get built, not by accident:

| Metric | Lever already in use | Where |
|---|---|---|
| **LCP** | Server Components fetch with Prisma at render time — the hero image and category cards arrive in the initial HTML, no client-fetch waterfall before first paint | `(shop)/page.tsx`, all category pages |
| **LCP** | `next/image` with per-breakpoint `sizes`, `remotePatterns` scoped to the UploadThing CDN only (`utfs.io`, `*.ufs.sh`) | [`next.config.ts`](../next.config.ts), `CategorySlider.tsx` |
| **CLS** | `tabular-nums` on every price node that can change at runtime (quantity stepper, menu prices) — carry this onto the new variant price display (§2.3) so a price change never reflows neighboring text | `MenuRow` |
| **CLS** | Pulse-skeleton for the navbar's auth state while `useSession()` is `isPending`, instead of popping in "Sign In" then replacing it | `Navbar.tsx` (§4.2) |
| **INP** | `IntersectionObserver` for the menu's scroll-spy nav instead of a `scroll` event handler — no main-thread work on every scroll frame | `MenuClient.tsx` |
| **INP** | Every mutation (wishlist toggle, status change) runs inside React 19 `useTransition` with optimistic local state — the UI responds before the Server Action round-trip resolves | wishlist, orders (see `HOW_IT_WORKS.md` §4) |
| **INP** | Client-side category filtering on `/shop` (§1.2) trades a larger initial payload for zero-latency filter clicks — re-evaluate as the catalog grows | `ShopClient.tsx` |
| **Bundle size** | Embla Carousel (~6 KB) instead of a heavier carousel library for the slider; Zustand (~1 KB) instead of Redux/Context-with-providers for cart state | `CategorySlider.tsx`, `cart-store.ts` |
| **Hydration correctness** | Wishlist heart state is computed server-side and passed as a prop — never derived from a client-only `useEffect` fetch, which reintroduces a flash-of-wrong-state. Apply the identical shape to the variant selector's default selection in §2.3 | `getWishlistedProductIds()` pattern |

---

## Open Items for Engineering

A scannable punch list of everything above that isn't already shipped, in priority order:

| # | Item | Section | Severity |
|---|---|---|---|
| 1 | Build the PDP variant selector (chip list over `variants[]`, drives price / SKU / Add-to-Cart) | §2.3 | Blocking — multi-variant products are invisible to customers today |
| 2 | Fix the cart store to merge on `variantId`, not product `id` | §5.3 | Blocking — must ship atomically with #1, or #1 introduces a billing-incorrect bug |
| 3 | Add defensive `compareAtPrice` rendering on the PDP | §2.2 | Low — schema-ready, no urgency until admin support exists |
| 4 | Centralize authenticated-route protection in `middleware.ts` | §4.3 | Medium — current per-page guards work but rely on developer discipline |
| 5 | Consider collapsing the five hardcoded `/category/<slug>` routes into one dynamic route | §1.2 | Low — works today, just duplicated |
| 6 | Revisit client-side category filtering on `/shop` once catalog size grows materially | §1.2 | Low — not a problem yet |
