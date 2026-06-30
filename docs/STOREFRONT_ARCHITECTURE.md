# Storefront UX & Client-Side Architecture

**Stack:** Next.js 16.2 (App Router) · React 19.2 · Tailwind CSS v4 · Prisma 7 · PostgreSQL (Neon) · Better Auth 1.6 · Zustand 5

**Audience:** front-end engineers building or extending the customer-facing storefront (`src/app/(shop)/**`).
**Scope:** this is the client-side companion to [`ARCHITECTURE.md`](./ARCHITECTURE.md) (admin internals + the shared edge-proxy/auth infrastructure) and [`HOW_IT_WORKS.md`](./HOW_IT_WORKS.md) (full-platform walkthrough). It owns the ground those two only summarize: **homepage catalog structure, dynamic category routing, the product detail page's variant islands, storefront discount rendering, the café menu renderer, the authenticated login/redirect flow, navbar RBAC, the DB-synced cart, and the branch-driven checkout.** Every contract below is read directly from `prisma/schema.prisma` and the current `(shop)` route group — nothing here is aspirational unless explicitly tagged `GAP`.

**Status tags used throughout:**

| Tag | Meaning |
|---|---|
| `BUILT` | Implemented and working as described — treat as the contract to preserve. |
| `GAP` | Does not exist yet. This section *is* the spec to build against. |
| `HARDENING` | Works, but a concrete improvement is recommended before scaling. |

> **Refactor note.** The four items this document previously tracked as blocking work — the PDP variant selector, the `variantId`-keyed cart, centralized route protection, and collapsing the five static category routes into one — have all shipped. They are documented below as `BUILT`, and the old `GAP`/`BUG` write-ups are preserved only as historical context where it explains *why* the current shape is what it is.
>
> **Latest wave (this revision).** Three large changes have since landed and are the focus of this update: (1) the **Discount Engine** is wired into every storefront price node — product cards, the PDP variant islands, the cart preview, and `placeOrder` all price through one shared resolver ([`src/lib/discounts.ts`](../src/lib/discounts.ts)); (2) the cart is **no longer local-only** — a logged-in customer gets a DB-backed, cross-device cart (`CartItem`) bridged by [`CartSyncProvider`](../src/components/providers/CartSyncProvider.tsx); and (3) the checkout's delivery/pickup selector is **driven by the live `Branch` table**, replacing the legacy static `DeliveryLocation` enum. The previously-documented "promotions are schema-ready but not shipped" and "the cart never writes to `CartItem`" statements were the most out-of-date claims in this file and have been rewritten below.

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

A standard category (`identifier === null`, `type: "SHOP"`) doesn't get its own slider slot, but it **does** get a landing page through the same dynamic route as the core categories (§1.3). It also surfaces in the **`/shop` catalog directory** ([`page.tsx`](../src/app/(shop)/shop/page.tsx) + [`ShopClient.tsx`](../src/app/(shop)/shop/ShopClient.tsx)), which uses **Server-Side Filtering driven by `searchParams`** (`BUILT` — was a client-side `HARDENING` note; now shipped):

```ts
export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>; // ?category=slug from the URL
}) {
  const now = new Date();   // one instant drives every promotion filter this request
  const { category: categoryParam } = await searchParams;

  const [categories, products, wishlistedIds] = await Promise.all([
    prisma.category.findMany({ where: { type: "SHOP" }, orderBy: { name: "asc" }, select: { name: true, slug: true } }),
    prisma.product.findMany({
      where: {
        isAvailable: true,
        // Narrow by slug when ?category= is present; the SHOP type guard always holds.
        category: categoryParam ? { type: "SHOP", slug: categoryParam } : { type: "SHOP" },
      },
      include: {
        category: { select: { name: true, promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS } } },
        promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
        variants: { orderBy: { price: "asc" }, include: { promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS } } },
      },
      orderBy: { createdAt: "desc" },
    }),
    getWishlistedProductIds(),
  ]);
  // ...
}
```

This fetches **every** SHOP category name (for the filter pills) and **only the products matching the active filter**, in two queries, once, server-side. Each product's **starting (lowest-base-price) variant is priced through the Discount Engine** before it reaches the client — see §2.5 — so the card already carries its discounted `price` and a struck-through `compareAtPrice`.

There is **no client-side `.filter()` over a fully-loaded product array.** `/shop` (no query) and `/shop?category=bakery` are two genuinely different Postgres reads, so the grid only ever ships the rows it renders. This scales correctly as the catalog grows — it replaces the earlier approach of shipping the full SHOP catalog once and filtering it in memory client-side.

**The animated, app-like UX is preserved without a client-side filter** — [`ShopClient.tsx`](../src/app/(shop)/shop/ShopClient.tsx) wraps the navigation in `useTransition` and pushes the new URL with `scroll: false`:

```ts
const [isPending, startTransition] = useTransition();

function selectCategory(slug: string | null) {
  const params = new URLSearchParams(searchParams.toString());
  if (slug) params.set("category", slug);
  else params.delete("category");
  const query = params.toString();
  startTransition(() => {
    router.push(query ? `/shop?${query}` : "/shop", { scroll: false });
  });
}
```

- **`useTransition`** marks the navigation as non-blocking — clicking a pill doesn't freeze the UI while the server re-renders `ShopPage` with the new `searchParams`; `isPending` dims the grid (`opacity: 0.6`) for visual feedback during the round-trip instead of showing a hard loading state.
- **`router.push(..., { scroll: false })`** stops Next.js from jumping the viewport back to the top of the page on every filter click, so the sticky filter bar stays exactly where the customer clicked it.
- **`framer-motion`'s `layout` + `AnimatePresence mode="popLayout"`** still own the actual grid reflow and card enter/exit animation — `useTransition` only governs *when* the new server-rendered list lands; once it does, Framer Motion animates the diff exactly as it did under the old client-filtered version. The result is a server-driven filter that still *feels* like an instant client-side one.

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

  const now = new Date();
  const products = await prisma.product.findMany({
    where: { isAvailable: true, categoryId: category.id },   // resolved, indexed FK
    include: {
      category: { select: { name: true, promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS } } },
      promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
      variants: { orderBy: { price: "asc" }, include: { promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS } } },
    },
    orderBy: { createdAt: "desc" },
  });

  return <CategoryPageTemplate title={category.name} description={...} products={products} />;
}
```

Three properties to preserve:

1. **React `cache()` deduplicates the category lookup.** `generateMetadata` (for SEO) and `CategoryPage` both call `getCategoryBySlug(slug)`. Without `cache()` that's two identical `findUnique` round-trips per request; with it, the second call is served from React's per-request memo — **one** Postgres round-trip. This is the same discipline `getServerSession()` uses in [`src/lib/session.ts`](../src/lib/session.ts). Any future code path that needs the category row again in the same request should reuse `getCategoryBySlug`, not issue a fresh query.
2. **Filtering by `categoryId`, not `identifier`.** Once the row is resolved, products are filtered by the indexed FK. This is why the same route works for standard categories (which have no `identifier`) exactly as it does for core ones — there's no enum branch.
3. **`force-dynamic` is mandatory.** `CategoryPageTemplate` seeds per-user wishlist hearts (§4.4) and prices each card through the Discount Engine against a per-request `now`; rendering from a shared ISR cache would leak one user's hearts to the next visitor and could serve a stale promotion window.

**Footer navigation — `BUILT` (was a `HARDENING` recommendation; now shipped).** [`Footer.tsx`](../src/components/layout/Footer.tsx) is no longer a hardcoded constant array — the main nav columns are a fully dynamic, DB-backed system driven by the `FooterLink` model:

```prisma
model FooterLink {
  id       String  @id @default(cuid())
  label    String                    // display text, e.g. "Our Story" or "Instagram"
  url      String                    // internal path or absolute URL
  group    String  @default("Explore") // column heading — links sharing a group form one nav column
  order    Int     @default(0)         // ascending sort, both within a column and across columns
  isActive Boolean @default(true)      // hidden from the storefront when false, row not deleted

  @@index([isActive, order])
}
```

Each row is just `label → url`, so an admin can point a link at a `Category`, a specific `Product`, an internal page, or an external/social URL with no schema coupling — there's no slug-rename-404 hazard anymore, because the URL is whatever the admin typed, not derived from a category's current `name`. Rows are grouped by `group` into nav columns (preserving first-appearance order for columns, `order` ascending within each), edited from `/admin/settings → Footer Navigation`.

The read path ([`getActiveFooterLinks`](../src/components/layout/Footer.tsx)) is `unstable_cache`-wrapped and tagged `"footer-links"`, so the footer is served from cache and only re-queries Postgres when the settings Server Action invalidates the tag. If no managed links exist yet (or the DB read throws), the footer falls back to the original category-driven "Collection" column plus the static `Heritage`/`Boutiques`/`Client Care` groups, so the layout is never empty mid-migration.

| Entry point | Source | Shows |
|---|---|---|
| Homepage slider | `Category.findMany({ identifier: { not: null } })`, enum order | The configured core categories (0–5 cards) |
| `/shop` | `Category` (type SHOP, all) + `Product` (type SHOP, available, narrowed by `?category=slug`) | Discount-priced catalog, **server-filtered** per request — `?category=` selects the Postgres query, not an in-memory filter |
| `/category/[slug]` | `getCategoryBySlug(slug)` → products by `categoryId` | **Any** category's landing page (core or standard), one route |

---

## 2. Product Detail Page (PDP) & Dynamic Variants — `BUILT`

The PDP previously locked onto the cheapest variant and never let a customer choose another. It now fully supports multi-variant selection through a pair of client islands, and every variant is **priced through the Discount Engine** before it reaches the client (§2.5). This was the storefront's highest-leverage gap; it is closed.

### 2.1 Server shell — [`(shop)/product/[slug]/page.tsx`](../src/app/(shop)/product/[slug]/page.tsx)

The page is a `force-dynamic` Server Component (the review panel and wishlist heart are personalized to the session). It fetches everything it needs in one `Promise.all` — including **live promotions at all three targeting levels** (variant / product / category) — and projects a **discount-resolved** view-model into the client island:

```ts
const now = new Date();   // one instant filters AND evaluates every promotion this request

const [product, session, wishlistedIds] = await Promise.all([
  prisma.product.findUnique({
    where: { slug },
    include: {
      category: {
        select: {
          name: true, slug: true,
          promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
        },
      },
      promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
      variants: {
        orderBy: { price: "asc" },                                   // [0] = lowest price
        include: { promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS } },
      },
      reviews: { where: { isApproved: true }, orderBy: { createdAt: "desc" } },
    },
  }),
  getServerSession(),
  getWishlistedProductIds(),
]);
if (!product) notFound();

// Each variant is priced through the Discount Engine. When a live promo applies,
// `price` becomes the discounted amount and the original base price is surfaced as
// `compareAtPrice` (struck-through). With no promo, the MANUAL compareAtPrice column
// is preserved as the fallback strikethrough.
const variants = product.variants.map((v) => {
  const priced = resolvePrice(
    v.price,
    gatherPromotions(v.promotions, product.promotions, product.category.promotions),
    now,
  );
  return {
    id: v.id,
    name: v.name,
    price: priced.finalPrice,
    isAvailable: v.isAvailable,
    compareAtPrice: priced.hasDiscount ? priced.basePrice : v.compareAtPrice,
  };
});
```

It passes `variants` (plus minimal product identity and `initialIsFavorited`) to [`ProductPurchasePanel`](../src/components/products/ProductPurchasePanel.tsx). **The price is intentionally not rendered in the Server Component** — it reflects the *selected* variant, so it lives in the client island. A static server-rendered price would silently disagree with the pills the moment a customer chooses a non-default variant.

### 2.2 The data contract

```prisma
model ProductVariant {
  id             String  @id @default(cuid())
  productId      String
  name           String           // free text, e.g. "Half Kilo", "1 Piece / 250g"
  sku            String? @unique
  price          Float            // the catalogue base price (the Discount Engine reads from this)
  compareAtPrice Float?           // optional MANUAL strikethrough "was" price (admin-set)
  isAvailable    Boolean @default(true)
  sortOrder      Int     @default(0)
  promotions     Promotion[]      // variant-level Discount Engine targets
}
```

Three shape facts the islands honor:

1. **Variants are a flat list, not a size × color matrix.** `name` is one free-text string per row — there's no `size`/`color`/`flavor` column. The selector is therefore a **single-axis** pill list over `variants[]`, each pill labeled with the full `name`. True independent axes would be a schema change (a `VariantOption` join model); the UI does not simulate it by parsing `name` strings.
2. **Images live on `Product`, not `ProductVariant`.** Switching the selected variant updates **price, availability, and the Add-to-Cart payload** — it does *not* swap the photo gallery, because there's nothing per-variant to swap to.
3. **There are now TWO independent sources of a strikethrough price.** A live `Promotion` (the Discount Engine, §2.5) discounts the live `price` and surfaces the catalogue base price as the "was" figure. Separately, `compareAtPrice` is a **manual** per-variant column that the admin product forms *do* now expose ([`NewProductForm`](../src/components/admin/NewProductForm.tsx) / [`EditProductForm`](../src/components/admin/EditProductForm.tsx), "Compare-At Price"). On the PDP the engine wins when a promo is live; the manual `compareAtPrice` is only the fallback when no promotion applies. (The earlier note here — "`compareAtPrice` exists but is `null` today; neither product form exposes it" — is obsolete on both counts.)

### 2.3 [`ProductPurchasePanel.tsx`](../src/components/products/ProductPurchasePanel.tsx) — the client island

This is the `"use client"` island that groups **price + variant selector + quantity stepper + CTA + wishlist** into one coherent purchase surface. Its defining property is a **single source of truth**:

```ts
// Default to the cheapest AVAILABLE variant (variants arrive price-asc, already discounted).
const defaultVariant = variants.find((v) => v.isAvailable) ?? variants[0];
const [selectedVariantId, setSelectedVariantId] = useState(defaultVariant?.id ?? "");

// Everything is DERIVED from the selected id — never stored in parallel state.
const activeVariant = variants.find((v) => v.id === selectedVariantId) ?? defaultVariant;
const canPurchase   = !!activeVariant?.isAvailable;
const unitPrice     = activeVariant?.price ?? 0;                       // already the discounted price
const showCompareAt = activeVariant?.compareAtPrice != null && activeVariant.compareAtPrice > unitPrice;
```

- **The panel renders the price; it does not compute the discount.** Discount math is done server-side in the page shell (§2.1) and arrives as the variant's `price` (discounted) + `compareAtPrice` (the "was"). The island stays purely presentational — `PurchaseVariant.compareAtPrice` is now *fed by the Discount Engine or the manual column*, no longer a `null` placeholder waiting on a future feature.
- **No drift by construction.** Price, sold-out state, line total, and the cart payload are all computed from `activeVariant`. There is no second `useState` holding "the current price" that a fast double-click could desync from the selected pill — the bug class that parallel state invites simply can't occur here.
- **`tabular-nums` on every numeric node — a free CLS win.** The hero price (`font-serif … tabular-nums`), the `compareAtPrice` strikethrough, the quantity readout, and the CTA's line total all use fixed-width digits, so changing variant from `60` to `450`, or a discount appearing/disappearing, never reflows the surrounding layout.
- **Accessible compare-at pricing.** When `compareAtPrice > price`, the original is shown struck-through beside the sale price with `aria-label={`Original price ${…} EGP`}`, so a screen reader announces it as a former price rather than a bare number. The CTA likewise carries a dynamic `aria-label` describing the quantity and line total (or "Selected option is sold out").
- **Add-to-Cart sends the *selected* variant — and the price the customer saw.** `handleAdd` calls `addItem({ id: product.id, variantId: activeVariant.id, price: activeVariant.price, … }, isLoggedIn)` — `activeVariant.id`, never `variants[0].id`, and `activeVariant.price` is the **discounted** unit price. This lands in lockstep with the cart's `variantId` keying (§5.2). When the customer is logged in, the same add is mirrored to the DB cart (§5.4). A sold-out active variant disables the stepper and CTA outright.

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
| Per-pill price | Each pill shows **that variant's own (discounted) price** (`font-mono tabular-nums`), since variants aren't uniformly priced — price lives on the pill, not floating above the list |
| Out-of-stock variant | `isAvailable: false` → pill is **disabled but kept in the DOM** (strikethrough price, muted text), so the option stays visible/indexable rather than vanishing |
| A11y | `role="radiogroup"` wrapper, `role="radio"` + `aria-checked` per pill, keyboard-focusable, visible `focus-visible` ring |

### 2.5 Storefront Discount Integration (Product Cards + PDP) — `BUILT`

Active promotions are surfaced on every storefront price node by one shared, pure resolver — [`src/lib/discounts.ts`](../src/lib/discounts.ts). Nothing in the UI implements discount math itself; cards, the PDP, the cart preview, and `placeOrder` all call the same functions, so they can never disagree on what a variant costs. (The resolver internals — liveness rules, lowest-price-wins, rounding — are documented in [`HOW_IT_WORKS.md` §6](./HOW_IT_WORKS.md); this section is the storefront-rendering contract.)

**The three helpers a storefront surface uses:**

| Helper | Role |
|---|---|
| `livePromotionWhere(now)` | A Prisma `where` matching only **live** promotions (`isActive && startDate <= now <= endDate`). Spread it into every `promotions: { where: … , select: PROMOTION_SELECT_FIELDS }` include so the DB returns only currently-running promos. |
| `gatherPromotions(variantPromos, productPromos, categoryPromos)` | Merges + de-dupes (by id) the promotions targeting a variant **directly**, its **parent product**, or that product's **category** — the full target hierarchy in one list. |
| `resolvePrice(basePrice, promotions, now)` | Returns `{ basePrice, finalPrice, discountAmount, hasDiscount, appliedPromotion }`. When several live promos apply, the one yielding the **lowest** `finalPrice` wins (best for the customer). |

**Always pass a single `now` per request** (every page above declares `const now = new Date()` once) so the DB filter and the in-memory evaluation agree on the same instant — a promo can't be "live" for the query but "expired" for the math.

**Product cards** ([`ProductCard.tsx`](../src/components/ProductCard.tsx), fed by [`CategoryPageTemplate`](../src/components/CategoryPageTemplate.tsx), `/shop`, the category route, and the wishlist page) price the **starting (lowest-base-price) variant** — the representative figure the card shows and the variant quick-add adds:

```ts
const starting = product.variants[0];
const priced = resolvePrice(
  starting?.price ?? 0,
  gatherPromotions(starting?.promotions, product.promotions, product.category.promotions),
  now,
);
const card = {
  ...,
  price: priced.finalPrice, // discounted starting price
  // Live promo → struck-through base price; otherwise fall back to the
  // variant's manual Compare-At so admin-set "was" prices show on the card too.
  compareAtPrice: priced.hasDiscount ? priced.basePrice : starting?.compareAtPrice ?? null,
};
```

The card then renders, only while `compareAtPrice > price`:
- a struck-through original price beside the live price (`aria-label="Original price … EGP"`), and
- a `-{percentOff}%` **sale badge** over the image, where `percentOff = Math.round((1 - price / compareAtPrice) * 100)`.

**PDP variant islands** (§2.1–§2.4) price **every** variant — not just the cheapest — so the strikethrough and percentage follow the selected pill, using the same `priced.hasDiscount ? priced.basePrice : v.compareAtPrice` fallback.

**The manual fallback is now mirrored everywhere a product card renders — `BUILT` (was a `HARDENING` asymmetry; now closed).** [`ShopClient`](../src/app/(shop)/shop/page.tsx) / `ShopPage`, [`CategoryPageTemplate`](../src/components/CategoryPageTemplate.tsx), and the [wishlist page](../src/app/(shop)/wishlist/page.tsx) (via [`getWishlistItems`](../src/lib/actions/wishlist.ts)) all use the identical `priced.hasDiscount ? priced.basePrice : starting?.compareAtPrice ?? null` expression. A variant with a manual "was" price but no active promotion now shows the same strikethrough and sale styling on the **PDP**, every **grid card** (`/shop`, `/category/[slug]`), and the **wishlist** — there is no longer a surface where the manual compare-at silently fails to render. If a new card-rendering surface is added, copy this exact fallback rather than re-deriving discount logic in the component (the math itself still only ever lives in `src/lib/discounts.ts`).

---

## 3. The Café Menu Page (`/menu`) — `BUILT`

The café menu is **structurally isolated** from the shop catalog — `MenuCategory`/`MenuItem` carry no foreign key to `Category`, `Product`, or `ProductVariant`, and (deliberately) no relation to `Promotion`:

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

This separation is deliberate: the café menu is a **read-only, dine-in/pickup price list**, not something that flows into the cart, checkout, or the Discount Engine. Don't wire an "Add to Cart" button onto a `MenuItem`, and don't expect a `Promotion` to discount one — there's no `CartItem`/`OrderItem`/`Promotion` relation to support it.

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
enum UserRole { USER  ADMIN  MANAGER }
model User { ... role UserRole @default(USER) ... branchId String? ... }
```

Better Auth provides the session; `role` is layered on as an `additionalFields` entry with `input: false` ([`src/lib/auth.ts`](../src/lib/auth.ts)) — a client **cannot set its own role at signup**, only a direct DB write (or admin action) can promote a user. `MANAGER` is a branch-scoped staff role (see [`ARCHITECTURE.md`](./ARCHITECTURE.md)); on the storefront it behaves like any authenticated user.

| Context | Access pattern | File |
|---|---|---|
| Server Component / Server Action | `getServerSession()` (React `cache()`-wrapped), or `requireAdmin()` / `requireDashboardAccess()` for staff gates | [`src/lib/session.ts`](../src/lib/session.ts) |
| Client Component | `useSession()` — Better Auth's React client, with `inferAdditionalFields<typeof auth>()` so `session.user.role` is typed | [`src/lib/auth-client.ts`](../src/lib/auth-client.ts) |

### 4.2 Navbar visibility — `BUILT`

[`Navbar.tsx`](../src/components/Navbar.tsx) / [`UserMenu.tsx`](../src/components/UserMenu.tsx) gate the **Admin Dashboard** link behind a role check, while **My Orders** and **Wishlist** render unconditionally inside the "is logged in" branch:

| Session state | My Orders | Wishlist | Dashboard |
|---|---|---|---|
| Guest (no session) | — | — | — |
| `USER` | ✓ | ✓ | — |
| `ADMIN` / `MANAGER` | ✓ | ✓ | ✓ |

The takeaway for any future navbar change: **My Orders / Wishlist are an "is authenticated" check, not a role check** — every signed-in user sees them; only the Dashboard link is role-gated. The auth block also renders a pulse skeleton (not "Sign In") while `useSession()` is `isPending`, preventing a logged-in user from seeing a "Sign In" flash before their account menu resolves. Apply the same `isPending` guard to any new auth-aware UI.

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
- **`/checkout` is deliberately NOT in the matcher.** Checkout supports **guest orders** (`placeOrder` accepts a null `userId`), so gating it behind the proxy would break the guest flow. Keep it out.
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

**Open-redirect hardening — `sanitizeRedirect`.** The `redirect` value is attacker-controllable (anyone can craft `/login?redirect=https://evil.com` directly; it never had to pass through our proxy to arrive). The guard is now a **shared export in [`@/lib/utils`](../src/lib/utils.ts)** (was previously a private function inside `LoginClient.tsx`), making the protection isomorphic — usable from both Server and Client Components/Actions, not just the one client island that happened to define it first:

```ts
// src/lib/utils.ts
export function sanitizeRedirect(path: string | null): string {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return "/"
  return path
}
```

`LoginClient.tsx` imports it: `const redirectTo = sanitizeRedirect(searchParams.get("redirect"));`. Only a single-slash, same-origin relative path survives. Absolute URLs and the protocol-relative `//host` trick (which browsers resolve to a *different* origin) both collapse to `"/"`. On a successful `signIn.email`, navigation is **`router.push(redirectTo)` followed by `router.refresh()`** — Better Auth's vanilla email sign-in does not auto-navigate (its `callbackURL` is only honored by redirect-based flows like OAuth/verification, and is forwarded only for completeness), so the explicit `router.push` is what actually returns the user to the page the proxy bounced them from. The `router.refresh()` also matters for the cart: it lets [`CartSyncProvider`](../src/components/providers/CartSyncProvider.tsx) observe the new session and fold the guest cart into the account (§5.4).

**Extending it.** Because `sanitizeRedirect` now lives in `@/lib/utils`, any new redirect-consuming surface — a signup flow honoring `?redirect=`, a password-reset return path, a future Server Action — imports the same guard rather than redefining it. There is now exactly one open-redirect policy for the whole app, enforced isomorphically (the same function runs unchanged on the server or in the browser).

### 4.5 Wishlist flow — `BUILT`

Persisted to Postgres, not local state: `WishlistItem { userId, productId }` with `@@unique([userId, productId])`. The client-side contract:

- Toggling, listing, and existence-checking are all Server Actions ([`src/lib/actions/wishlist.ts`](../src/lib/actions/wishlist.ts)) — there's no `/api/wishlist` REST route.
- Every page that renders product cards seeds `initialIsFavorited` from `getWishlistedProductIds()` **on the server**, so the heart's first paint is already correct for the signed-in user — no flash-then-pop-in. [`CategoryPageTemplate`](../src/components/CategoryPageTemplate.tsx) builds a `Set` from it for O(1) per-card lookups; [`WishlistButton.tsx`](../src/components/products/WishlistButton.tsx) takes over interactivity (optimistic flip, `useTransition`, rollback + toast on failure).
- Because that per-user seeding can't be cached and served to the next visitor, every page doing it (`/shop`, the dynamic `/category/[slug]` route, the PDP) runs `export const dynamic = "force-dynamic"` rather than ISR. (This dovetails with the per-request discount window, §2.5 — both reasons point to `force-dynamic`.) Carry this forward on any new product-listing surface.

### 4.6 My Orders dashboard — `BUILT`

[`/my-orders`](../src/app/(shop)/my-orders/page.tsx) mirrors the admin orders board's URL-driven filter pattern, scoped to `session.user.id`, and is protected by the proxy (§4.3) plus an in-page session check:

```ts
where: { userId: session.user.id, ...(status !== "ALL" ? { status } : {}) }
```

`OrderItem` stores a **snapshot** (`productName`, `variantName`, `unitPrice`, `quantity`) captured at purchase time — and the `unitPrice` is the **already-discounted** price the customer was billed (the Discount Engine ran at `placeOrder`, §5.5). It does not re-read the live `Product`/`ProductVariant`. A customer's order from six months ago still shows the exact name and price they paid, even if that variant was since renamed, repriced, or its promotion ended. Never join back to the live catalog to render order history — the snapshot *is* the source of truth for a placed order.

---

## 5. Cart & Checkout Pipeline

### 5.1 Implementation — `BUILT`, variant-keyed, client-first with optional DB persistence

The cart's **client source of truth** is Zustand + `persist`, `localStorage` key `"ali-baba-cart"` ([`src/lib/cart-store.ts`](../src/lib/cart-store.ts)). A **guest** cart is purely local. A **logged-in** customer additionally gets a **DB-backed, cross-device cart** (`CartItem`): the local store stays the optimistic front end, and each mutation is mirrored to Postgres in the background. (This replaces the earlier "the cart is client-only; nothing but `placeOrder` ever touches the DB" claim — that is no longer true.)

```ts
export interface CartItem {
  id: string;         // parent product id — display / grouping / PDP links ONLY, never the merge key
  variantId: string;  // the purchasable unit, and the canonical identity of a cart line
  name: string;
  price: number;      // local display currency (EGP) — the DISCOUNTED unit price the customer saw;
                      // still display-only, the server re-resolves the real price at checkout
  quantity: number;
  image: string;
  category?: string;
}
```

Every mutating action takes an optional `isLoggedIn` flag (the caller reads it from `useSession()`), and when it's true the action mirrors the change to the DB via a fire-and-forget `syncCartItemAction` (§5.4). The optimistic local update always lands first, so the UI never waits on the round-trip:

```ts
addItem:        (item, isLoggedIn?)            // local merge by variantId, then fireSync(SET)
removeItem:     (variantId, isLoggedIn?)       // local filter, then fireSync(DELETE)
updateQuantity: (variantId, qty, isLoggedIn?)  // local map (<1 → remove), then fireSync(SET)
clearCart:      ()                             // local-only empty (checkout / "Clear cart" button)
clearLocalCart: ()                             // LOGOUT-only wipe: local + persisted, DB untouched
mergeAndSyncCart: () => Promise<void>          // guest → auth bridge (§5.4)
```

`partialize` persists only `items`, never `isOpen` or any session-derived data — so SSR renders `items: []`, the client rehydrates from `localStorage` after mount, and there's no hydration mismatch and no stale auth bleeding across users on a shared device.

### 5.2 Every operation keys on `variantId` — `BUILT` (was a `BUG`; now fixed and live)

`addItem`, `removeItem`, and `updateQuantity` all identify a line by `variantId`:

```ts
addItem: (newItem, isLoggedIn) => set((s) => {
  const existing = s.items.find((i) => i.variantId === newItem.variantId);
  if (existing) {
    return { items: s.items.map((i) =>
      i.variantId === newItem.variantId ? { ...i, quantity: i.quantity + 1 } : i) };
  }
  return { items: [...s.items, { ...newItem, quantity: 1 }] };
  // …then fireSync(newItem.variantId, newQuantity, "SET") when logged in
});
removeItem:     (variantId) => /* filter i.variantId !== variantId */
updateQuantity: (variantId, quantity) => /* map by i.variantId === variantId; <1 removes */
```

**Why this is correct (and why it had to ship with §2's selector).** The store previously merged on the product `id`. The instant the PDP gained a real variant selector, that became a money bug: adding "Cake — Small" (`variantId: A`, 80) then "Cake — Large" (`variantId: B`, 150) would match the existing line by product id and merely bump quantity — keeping the Small's `variantId` and price, so checkout charged 2× Small. Keying every operation on `variantId` makes each chosen variant a distinct, correctly-priced line.

**Why `variantId` alone — not a composite `productId_variantId`.** `ProductVariant.id` is already a globally unique `cuid`, and every variant belongs to exactly one product. The database asserts the same modeling choice — the `CartItem` table's uniqueness is `@@unique([userId, variantId])`, not `([userId, productId, variantId])`:

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

The client store's merge key matches the database's own key. Keep `id` (product id) on the line item for display grouping and PDP links — just never use it to dedup. **All React keys in the cart drawer and the checkout summary map over `variantId`**, consistent with this identity model.

**Migration safety.** The persisted shape is unchanged — `variantId` was always stored on `CartItem` — so previously-saved carts in `localStorage` remain valid with no migration.

### 5.3 Cart discount integrity — `BUILT`

The cart never does discount math itself, yet it always shows discounted prices, because the discounted figure is computed upstream and threaded through:

- **Local adds** carry the price the customer saw. Quick-add from a card (`ProductCard`) and Add-to-Cart from the PDP (`ProductPurchasePanel`) both pass `price: <discounted unit price>` — the value the Discount Engine produced when the listing rendered (§2.5). So the drawer line total, the `/checkout` summary, and the navbar count are all already discount-aware with zero extra work.
- **DB reads re-resolve, never store.** `CartItem` persists only `{ userId, variantId, quantity }` — **no price column.** When a logged-in cart is read back ([`getDbCartAction`](../src/lib/actions/cart.ts)), each line is joined to its variant + product + category live promotions and run through `resolvePrice(variant.price, gatherPromotions(...), now)`, so the hydrated price is the *current* discount, not whatever was true when the row was written. A promotion that started or ended since the item was added is reflected the moment the cart hydrates.
- **The server is still the only pricing authority.** The local `price` remains display-only. `placeOrder` re-resolves every line server-side (§5.5); a stale or tampered client price can never reach the order. This is the same discipline the catalogue read paths use — the client renders a price, the server decides the price.

### 5.4 Guest → authenticated bridge & `CartSyncProvider` — `BUILT`

[`CartSyncProvider`](../src/components/providers/CartSyncProvider.tsx) is a client-only wrapper (renders children untouched, no SSR mismatch) that reconciles the local cart with the DB cart across the auth lifecycle. Its hard problem is that `useSession()` reports "logged in" in two situations that must be handled differently:

| Situation | Detected via | Action |
|---|---|---|
| **Already logged in on mount** (refresh / new device) | `firstResolve` ref, first non-pending session reading | **HYDRATE** — `getDbCartAction()` and overwrite local. Never merge (would double-count an overlapping local + DB cart). |
| **Guest → logged in** (a real sign-in this session) | `knownUserId` ref transitions `null → id` | **MERGE** — `mergeAndSyncCart()`: push the guest's local lines up (server **SUMs** onto existing rows via upsert + `increment`), then adopt the freshly-merged DB cart wholesale. |
| **Logged in → guest** (logout) | transition `id → null` | `clearLocalCart()` — wipe local + persisted storage so the next person on the device starts clean; **DB cart left intact** for the user's next sign-in. |
| **Account switch A → B** | transition `idA → idB` | `clearLocalCart()` then HYDRATE B's DB cart. |

The two refs (`firstResolve`, `knownUserId`) make each transition fire **exactly once** — no loops, no redundant network calls — and the provider deliberately never subscribes to `items`, so a cart edit doesn't re-run the effect.

Per-line persistence is **fire-and-forget and idempotent**: `syncCartItemAction(variantId, quantity, "SET" | "DELETE")` upserts to the *absolute* quantity (a late-arriving `SET` simply overwrites, sidestepping increment races), and a `DELETE` uses `deleteMany` so removing an already-gone row is silent rather than a `P2025` throw. A sync failure only logs — the optimistic local state already applied, and the next hydrate/merge reconciles.

> **Why this is safe with the price model.** None of these paths trust a client price: `mergeCartAction` and `syncCartItemAction` write only `{ variantId, quantity }`, and `getDbCartAction` re-prices on read (§5.3). Cross-device consistency is about **identity and intent**, never money.

### 5.5 Server-side price integrity — preserve this — `BUILT`

[`placeOrder`](../src/lib/actions/orders.ts) accepts only `{ variantId, quantity }` pairs and re-resolves price, **the best live discount**, availability, and parent-product availability **server-side**, inside a transaction — the client never sends a price. For each line it re-reads the variant plus its variant/product/category live promotions (`livePromotionWhere(now)`), applies `resolvePrice`, and **snapshots the discounted `finalPrice`** onto the `OrderItem`. When touching the cart, don't start threading the client's `price` into the order payload "for convenience" — the checkout flow's entire price-integrity guarantee rests on the server being the only source of truth for what a variant costs. The full transaction design, the discount-before-VAT ordering, VAT/delivery-fee math, and guest-checkout handling are in [`HOW_IT_WORKS.md` §6–§7](./HOW_IT_WORKS.md).

### 5.6 Checkout delivery & pickup — dynamic Branch fetching — `BUILT` (replaces the legacy `DeliveryLocation` enum)

The checkout form's location selector ([`src/app/(shop)/checkout/page.tsx`](../src/app/(shop)/checkout/page.tsx)) is **driven by the live `Branch` table**, not a hardcoded enum. The old static `DeliveryLocation` enum (`MENOUF | SADAT | SARS | …`) and its fixed-options `CitySelect` dropdown are **gone from the checkout flow** — adding or renaming a delivery area is now an admin Branch edit, not a schema migration.

On mount the page loads active branches **once** via [`getActiveBranches()`](../src/lib/actions/branches.ts) — a public Server Action returning `{ id, slug, name }` for `isActive` branches, `name`-ordered — and renders them through a single `BranchSelect`. Because each option carries a **real `branchId`**, whatever the customer picks resolves directly to the value stamped onto the order (the unit of Branch-Manager RBAC):

- **Delivery** — the "Delivery Area" selector is the branch list **plus** a synthetic **"Other Areas"** option (`id: "__other__"`). A chosen branch sends its id; "Other Areas" sends `branchId = null`, which leaves the order **unassigned** so it surfaces to the **Super Admin** (`ADMIN`) only.
- **Pickup** — the customer chooses a branch directly; its id becomes `branchId`, and `pickupBranch` additionally carries the human-readable branch **label** for the receipt.
- **Arabic sub-labels** in the dropdown (`BRANCH_SUBLABELS`, keyed by branch `slug`) are **presentational only** — not stored on the `Branch` model. A branch without a known sub-label simply shows its `name`.

`placeOrder` then does a **defensive re-resolution**: a supplied `branchId` is stamped only if it still matches a real, `isActive` branch (`findFirst({ where: { id, isActive: true } })`); a stale/invalid/deactivated id silently falls back to `null` (→ Super Admin) so the order never hard-fails on a race.

> **Legacy compatibility.** `Order.deliveryCity` (a `DeliveryLocation?`) and the enum itself **remain in the schema**, but the checkout flow no longer writes them — they exist purely so historical orders placed under the old model still render. The order detail drawers show the legacy `deliveryCity` defensively as "City" for those rows, and the assigned branch as the "Area" for new ones (see [`HOW_IT_WORKS.md` §7.5](./HOW_IT_WORKS.md)). Don't reintroduce the enum into checkout.

A note on cart-hydration UX at checkout: the page tracks Zustand's `persist` hydration with `useSyncExternalStore(useCartStore.persist.onFinishHydration, …)` and holds a neutral background until the cart has rehydrated from `localStorage`, so a customer who actually has items never flashes the "Your Cart is Empty" state on a hard load. On success it `clearCart()` locally and, when logged in, `clearDbCartAction()` so the placed cart doesn't re-hydrate from the server.

### 5.7 `/cart` route — `GAP` (drawer-only today)

`src/app/(shop)/cart/` is an empty directory — there's no full-page cart view, only the slide-out [`CartSidebar.tsx`](../src/components/CartSidebar.tsx) drawer (opened from the navbar cart icon, or automatically on `addItem`). Worth a dedicated full page if a deep-linkable, shareable cart view is ever needed — noted only so the empty directory isn't mistaken for an oversight.

---

## 6. Performance & Core Web Vitals Checklist

| Metric | Lever in use | Where |
|---|---|---|
| **LCP** | Server Components fetch with Prisma at render time — hero image, cards, **and resolved discount prices** arrive in the initial HTML, no client-fetch waterfall and no client-side discount computation | `(shop)/page.tsx`, `/category/[slug]`, `/shop` |
| **LCP** | `next/image` with per-breakpoint `sizes`, `remotePatterns` scoped to the UploadThing CDN (`utfs.io`, `*.ufs.sh`) | [`next.config.ts`](../next.config.ts), `CategorySlider.tsx` |
| **CLS** | `tabular-nums` on **every** price node that can change at runtime — the PDP hero price, `compareAtPrice` strikethrough, variant-pill prices, quantity stepper, CTA line total, menu prices — so switching a variant or a discount toggling never reflows neighbouring text | `ProductPurchasePanel`, `VariantSelector`, `MenuRow` |
| **CLS** | Pulse-skeleton for the navbar auth state while `useSession()` is `isPending`; matching `animate-pulse` skeleton as the `/login` Suspense fallback; checkout holds its background until the cart `persist` store rehydrates | `Navbar.tsx`, `LoginFallback`, `checkout/page.tsx` |
| **INP** | `IntersectionObserver` for the menu scroll-spy instead of a `scroll` handler | `MenuClient.tsx` |
| **INP** | Every mutation (wishlist toggle, status change, add-to-cart) runs with optimistic local state — UI responds before the round-trip; cart DB sync is fire-and-forget, never blocking | wishlist, orders, `ProductPurchasePanel`, `cart-store.ts` |
| **INP** | `/shop` category filtering is server-side (`?category=` narrows the Prisma query); `useTransition` + `router.push(..., { scroll: false })` keep the pill click non-blocking and scroll-stable while the server re-renders, so it still feels instant without shipping the full catalog up front | `ShopClient.tsx` |
| **TTFB** | React `cache()` dedupes the per-request category lookup across `generateMetadata` + page — one Postgres round-trip, not two | `/category/[slug]` |
| **Bundle size** | Embla Carousel (~6 KB) instead of a heavier carousel; Zustand (~1 KB) instead of Redux/Context for cart state; the discount resolver is pure TS with no runtime deps | `CategorySlider.tsx`, `cart-store.ts`, `discounts.ts` |
| **Hydration correctness** | Wishlist heart state, the PDP's default variant, and discount prices are computed/derived deterministically server-side (server-seeded prop / cheapest-available / `resolvePrice`) — never from a client-only `useEffect` fetch that reintroduces a flash-of-wrong-state | `getWishlistedProductIds()`, `ProductPurchasePanel`, `discounts.ts` |

---

## 7. Open Items for Engineering

The blocking storefront work this document used to track is shipped. What remains is low-severity hardening:

| # | Item | Section | Severity | Status |
|---|---|---|---|---|
| 1 | PDP variant selector (chip list over `variants[]`, drives price / availability / Add-to-Cart) | §2 | — | ✅ Shipped (`ProductPurchasePanel` + `VariantSelector`) |
| 2 | Cart store merges on `variantId`, not product `id` | §5.2 | — | ✅ Shipped (atomic with #1) |
| 3 | Centralized authenticated-route protection | §4.3 | — | ✅ Shipped (`src/proxy.ts`) |
| 4 | Collapse the five static `/category/<slug>` routes into one dynamic route | §1.3 | — | ✅ Shipped (`category/[slug]/page.tsx`) |
| 5 | Wire promotions into every storefront price node (cards, PDP, cart, checkout) | §2.5, §5.3, §5.5 | — | ✅ Shipped (`src/lib/discounts.ts` — one resolver everywhere) |
| 6 | Expose the manual `compareAtPrice` in the admin product forms | §2.2 | — | ✅ Shipped (`New`/`EditProductForm` "Compare-At Price"; PDP uses it as the no-promo fallback) |
| 7 | DB-backed, cross-device cart for logged-in users | §5.1, §5.4 | — | ✅ Shipped (`CartItem` + `CartSyncProvider` + `cart.ts` actions) |
| 8 | Branch-driven checkout delivery (retire the `DeliveryLocation` enum) | §5.6 | — | ✅ Shipped (`getActiveBranches` + `BranchSelect`; enum kept only for legacy orders) |
| 9 | Drive footer category/nav links from the DB (or accept the rename→404 coupling) | §1.3 | Low | ✅ Shipped — `FooterLink` model, admin-managed columns via `group` + `order`, category-driven fallback retained |
| 10 | Promote `sanitizeRedirect` to `@/lib/utils` if a second redirect surface appears | §4.4 | Low | ✅ Shipped — now a shared, isomorphic export in `@/lib/utils`, imported by `LoginClient.tsx` |
| 11 | Surface the manual `compareAtPrice` on grid cards (currently PDP-only fallback) | §2.5 | Low | ✅ Shipped — manual fallback mirrored to `ShopClient`/`ShopPage`, `CategoryPageTemplate`, and the wishlist; PDP, cards, and wishlist now agree |
| 12 | Build a full-page `/cart` view if a deep-linkable cart is needed | §5.7 | Low | Empty directory; drawer-only today |
| 13 | Revisit client-side `/shop` filtering once the catalog grows materially | §1.2 | — | ✅ Shipped — filtering moved server-side (`?category=` + Prisma `where`), `useTransition`/`router.push({ scroll: false })` preserve the zero-latency feel |
