# Storefront UX & Client-Side Architecture

**Stack:** Next.js 16.2 (App Router) · React 19.2 · Tailwind CSS v4 · Prisma 7 · PostgreSQL (Neon) · Better Auth 1.6 · Zustand 5

**Audience:** front-end engineers building or extending the customer-facing storefront (`src/app/(shop)/**`).
**Scope:** this is the client-side companion to [`ARCHITECTURE.md`](./ARCHITECTURE.md) (admin internals + the shared edge-proxy/auth infrastructure) and [`HOW_IT_WORKS.md`](./HOW_IT_WORKS.md) (full-platform walkthrough). It owns the ground those two only summarize: **the admin-curated homepage slider, dynamic category routing, the product detail page's variant islands, storefront discount rendering, the café menu renderer, the authenticated login/redirect flow, navbar RBAC, the DB-synced cart, and the branch-driven checkout with DB-backed pricing settings.** Every contract below is read directly from `prisma/schema.prisma` and the current `(shop)` route group — nothing here is aspirational unless explicitly tagged `GAP`.

**Status tags used throughout:**

| Tag | Meaning |
|---|---|
| `BUILT` | Implemented and working as described — treat as the contract to preserve. |
| `GAP` | Does not exist yet. This section *is* the spec to build against. |
| `HARDENING` | Works, but a concrete improvement is recommended before scaling. |

> **Refactor history.** Earlier revisions of this document tracked (and then closed) the PDP variant selector, the `variantId`-keyed cart, centralized route protection, the single dynamic category route, the Discount Engine wiring, the DB-backed cross-device cart, and the branch-driven checkout. All remain `BUILT` and are documented below.
>
> **Latest wave (this revision).** Three changes landed since the last update and are the focus of this rewrite:
>
> 1. **The homepage slider is now a fully dynamic CMS.** The `CategoryIdentifier` enum (the old five fixed slots: `ORIENTAL_SWEETS … BAKERY`) has been **deleted from the schema**. Featuring a category is now an admin toggle — `Category.isFeatured` + `Category.sliderOrder` — with **no cap on the number of featured categories** and no migration needed to reorder. The slider cards also gained an **animated live-promotion badge** ("20% OFF" / "SALE") resolved from the Discount Engine at render time. The old §1.1 (enum ordering, `transferIdentifier`, "at most one row per slot") is obsolete in its entirety and has been rewritten.
> 2. **All pricing constants moved from code to the database.** The hardcoded VAT rate and flat delivery fee are gone. A singleton `StoreSettings` row (`vatRate`, `isVatEnabled`, `defaultDeliveryFee`) plus a per-branch `Branch.deliveryFee` column now drive both the checkout **preview** and `placeOrder`'s **authoritative billing**, edited live from `/admin/settings → Pricing` (§5.6–§5.7).
> 3. **Per-branch delivery fees** are editable from two admin surfaces (the Branch modal and the Settings fee sheet) and are re-read server-side per order — the fee shipped to the client is display-only.
>
> **Hardening wave (July 2026).** A platform-wide hardening pass landed after the wave above: every money column migrated from `Float` to **`Decimal`** (server code coerces with `.toNumber()` before values cross to the client); the orphaned `MenuPage` model and the unread `ProductVariant.sortOrder` column were **deleted**; the homepage moved from fully-dynamic to **ISR (`revalidate = 60`)**; the cart gained a **50-distinct-line DB cap** with optimistic rollback and a persisted pending-ops ledger; guest carts **re-price at checkout mount** (`rePriceGuestCart`); `placeOrder` validates through the shared `checkoutSchema` (DELIVERY now requires an address) and batches its variant reads; signup honors `?redirect=`; shared action infrastructure was consolidated into [`src/lib/action-utils.ts`](../src/lib/action-utils.ts); and replaced/orphaned UploadThing files are purged post-commit via [`src/lib/uploadthing-server.ts`](../src/lib/uploadthing-server.ts). The affected sections below have been updated in place.

---

## 1. The Homepage & Catalog Structure

### 1.1 The Featured-Categories Slider — `BUILT` (fully admin-curated; the `CategoryIdentifier` enum is gone)

The homepage slider is a direct projection of every `Category` row an admin has toggled into it:

```prisma
// prisma/schema.prisma (current)
model Category {
  ...
  slug        String  @unique   // drives /category/[slug]
  subtitle    String?           // marketing tagline under the title in the slider card
  image       String?           // slider hero image (UploadThing URL or /public path)
  /// When true, this category is surfaced in the homepage CategorySlider.
  /// Any number of categories may be featured (no longer capped at five).
  isFeatured  Boolean @default(false)
  /// Ascending display position within the slider (lower = earlier).
  sliderOrder Int     @default(0)

  @@index([isFeatured, sliderOrder])   // matches the storefront slider read
}
```

There is **no enum, no fixed slot count, and no single-slot "transfer" semantics anymore.** `transferIdentifier` no longer exists in [`src/lib/actions/categories.ts`](../src/lib/actions/categories.ts); featuring a second category never displaces a first. The admin "Not set up" slot badge is gone with it — `/admin/categories` now renders two plain sections, **Featured in Slider** (ordered by `sliderOrder`, each card showing a `Slide #n` badge) and **Standard Categories**.

**The query** — [`src/app/(shop)/page.tsx`](../src/app/(shop)/page.tsx), `getSliderCategories()`:

```ts
const now = new Date();
const categories = await prisma.category.findMany({
  where: { isFeatured: true },
  // Secondary createdAt tie-break keeps categories sharing a sliderOrder stable.
  orderBy: [{ sliderOrder: "asc" }, { createdAt: "desc" }],
  include: {
    promotions: { where: livePromotionWhere(now), select: { type: true, value: true } },
  },
});
```

`Promotion.value` is a `Decimal` column, so the badge math coerces it first (`p.value.toNumber()`).

Each row is mapped to the `CategorySlider` card shape: a presentational two-digit watermark id (`"01"`, `"02"`, …), `title`/`subtitle`, `href: /category/${slug}`, `image ?? "/placeholder.jpg"`, and a **`discountLabel`**.

**The discount badge — `discountLabelFor(promotions)`.** The slider surfaces the category's currently-live *category-level* promotions as a marketing badge:

- If any live `PERCENTAGE` promotion targets the category, the badge is the **strongest percentage**: `"${Math.round(maxValue)}% OFF"`.
- Otherwise, any other live promotion (e.g. `FIXED_AMOUNT`) yields a generic `"SALE"`.
- No live promotion → `undefined` → no badge rendered.

[`CategorySlider.tsx`](../src/components/CategorySlider.tsx) renders it as a glassmorphic pill (Sparkles icon, top-right of the card) that slides in on scroll and then **pulses gently on an infinite loop** (`animate={{ scale: [1, 1.06, 1] }}`). Note the badge is *advisory*, not the pricing contract — actual prices are still resolved per-variant by `resolvePrice` (§2.5), where a fixed-amount promo can legitimately beat the advertised percentage.

**The promo banner — [`PromoWidget.tsx`](../src/components/PromoWidget.tsx).** Between the Hero and the slider, a self-contained Server Component surfaces the single strongest live promotion store-wide: `prisma.promotion.findMany({ where: livePromotionWhere(now) })`, prefer the highest `PERCENTAGE` (fixed-amount-only falls back to a generic "Flash Sale"), coerce the `Decimal` `value` with `.toNumber()`, and hand plain props to the display-only client leaf [`PromoWidgetBanner.tsx`](../src/components/PromoWidgetBanner.tsx) (spring slide-in on scroll + the same gentle infinite pulse as the slider badge). The CTA deep-links to `/category/[slug]` when the promotion targets exactly one category, otherwise `/shop`; an "Ends {date}" line (Cairo-local via `STORE_TZ`) appears only when the end is ≤ 30 days out. No live promotion → `null` — the section disappears entirely. Same advisory-not-contract caveat as the slider badge, and the same freshness model as the rest of the page (below).

**Rendering freshness.** The page declares `export const revalidate = 60` — a shared 60-second ISR cache, matching the PDP and category pages. This is safe because every admin action that can change the page busts the cache directly: category mutations call `revalidatePath("/")` and promotion mutations bust the whole storefront tree via `revalidatePath("/", "layout")`, so edits appear on the next request, not after the window. The 60s window only bounds pure time-based promotion liveness (a promo whose start/end date passes with no admin action can lag up to a minute). The previous `revalidate = 0` paid a Neon round-trip per visit on the hottest route for no correctness win.

**Handling zero featured categories — graceful hide, not a placeholder.** The query filters `isFeatured: true`, so an unfeatured catalog simply produces an empty (or shorter) card list. The Embla carousel (`loop: false`, `dragFree: true`, `containScroll: "trimSnaps"`) renders exactly the cards it receives — no "Coming Soon" tile, no skeleton, no layout gap on the customer side. Keep it that way.

**Admin CRUD contract** ([`src/lib/actions/categories.ts`](../src/lib/actions/categories.ts) + [`NewCategoryModal`](../src/components/admin/NewCategoryModal.tsx) / [`EditCategoryModal`](../src/components/admin/EditCategoryModal.tsx)):

- `createCategory({ name, subtitle, isFeatured, sliderOrder, image })` — the slug is **derived** (`slugify(name)`) and made unique by suffixing `-2`, `-3`, … inside a transaction (`ensureUniqueSlug`). The image is uploaded through an UploadThing dropzone in the modal.
- `updateCategory({ id, name, subtitle, isFeatured, sliderOrder, image })` — **renames do not regenerate the slug.** The slug is minted once at creation and stays stable, so existing `/category/[slug]` links never 404 after a rename (the trade-off: the slug can drift from the display name).
- `deleteCategory(id)` — pre-checks `product.count` and refuses deletion while products reference the category (`Product.category` is `onDelete: Restrict`); the P2003 catch covers the race.
- `sliderOrder` is sanitized server-side (`sanitizeSliderOrder`: non-finite → 0, floored, clamped ≥ 0).
- Every mutation revalidates `/`, `/admin/categories`, and fires `updateTag("categories")` so the footer's cached category column updates read-your-own-writes (§1.3). `updateCategory` also revalidates `/category/${slug}`.
- Like every admin action module, the category actions gate and translate errors through the centralized [`src/lib/action-utils.ts`](../src/lib/action-utils.ts) helpers (`ensureAdmin` RBAC gate, `prismaErrorCode`, `slugify`) — the previously copy-pasted per-file versions are gone.
- **Bucket hygiene:** replacing or deleting a category image purges the old UploadThing file via `deleteUploadedFiles` ([`src/lib/uploadthing-server.ts`](../src/lib/uploadthing-server.ts), a `UTApi` wrapper). Purges run strictly **post-commit and best-effort** — a failed bucket delete never rolls back or fails the DB write, it only logs. Product image mutations do the same.

### 1.2 Standard Categories & the Catalog Directory — `BUILT`

A standard category (`isFeatured === false`) doesn't get a slider slot, but it **does** get a landing page through the same dynamic route as featured ones (§1.3). It also surfaces in the **`/shop` catalog directory** ([`page.tsx`](../src/app/(shop)/shop/page.tsx) + [`ShopClient.tsx`](../src/app/(shop)/shop/ShopClient.tsx)), which uses **Server-Side Filtering driven by `searchParams`**:

```ts
export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>; // ?category=slug from the URL
}) {
  const now = new Date();   // one instant drives every promotion filter this request
  const { category: categoryParam } = await searchParams;

  const [categories, products, wishlistedIds] = await Promise.all([
    prisma.category.findMany({ orderBy: { name: "asc" }, select: { name: true, slug: true } }),
    prisma.product.findMany({
      where: {
        isAvailable: true,
        // Narrow by slug only when ?category= is present.
        ...(categoryParam ? { category: { slug: categoryParam } } : {}),
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

There is **no client-side `.filter()` over a fully-loaded product array.** `/shop` (no query) and `/shop?category=bakery` are two genuinely different Postgres reads, so the grid only ever ships the rows it renders.

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

- **`useTransition`** marks the navigation as non-blocking — clicking a pill doesn't freeze the UI while the server re-renders `ShopPage` with the new `searchParams`; `isPending` dims the grid for visual feedback during the round-trip instead of a hard loading state.
- **`router.push(..., { scroll: false })`** stops Next.js from jumping the viewport back to the top on every filter click, so the sticky filter bar stays where the customer clicked it.
- **`framer-motion`'s `layout` + `AnimatePresence mode="popLayout"`** still own the grid reflow and card enter/exit animation — `useTransition` only governs *when* the new server-rendered list lands.

> **Removed (July 2026):** `Category.type` / `MenuPage.type` and the `CategoryType` (`SHOP | CAFE`) enum have been purged. The admin UI never exposed a "CAFE" type — every category was `SHOP` and no code path ever wrote `CAFE` — so the `type: "SHOP"` filters were dead no-op guards. Categories are now uniform; storefront queries carry no `type` predicate. See migration `20260709000001_drop_vestigial_category_type`.

### 1.3 The single dynamic category route — `BUILT`

There is exactly **one** category landing route — [`src/app/(shop)/category/[slug]/page.tsx`](../src/app/(shop)/category/[slug]/page.tsx). One file serves every category — featured and standard alike — resolved by `Category.slug`.

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
    include: { /* category + product + variant live promotions, variants price-asc */ },
    orderBy: { createdAt: "desc" },
  });

  return <CategoryPageTemplate title={category.name} description={...} products={products} />;
}
```

Three properties to preserve:

1. **React `cache()` deduplicates the category lookup.** `generateMetadata` (for SEO) and `CategoryPage` both call `getCategoryBySlug(slug)`; with `cache()` that's **one** Postgres round-trip per request, not two. This is the same discipline `getServerSession()` uses in [`src/lib/session.ts`](../src/lib/session.ts). Any future code path that needs the category row again in the same request should reuse `getCategoryBySlug`, not issue a fresh query.
2. **Filtering by `categoryId`, not by featured status.** Once the row is resolved, products are filtered by the indexed FK — the route has no featured/standard branch at all.
3. **`force-dynamic` is mandatory.** `CategoryPageTemplate` seeds per-user wishlist hearts (§4.4) and prices each card through the Discount Engine against a per-request `now`; rendering from a shared ISR cache would leak one user's hearts to the next visitor and could serve a stale promotion window.

**Footer navigation — `BUILT`, DB-backed with two cache tags.** [`Footer.tsx`](../src/components/layout/Footer.tsx) renders its main nav columns from the `FooterLink` model:

```prisma
model FooterLink {
  id       String  @id @default(cuid())
  label    String                    // display text, e.g. "Our Story" or "Instagram"
  url      String                    // internal path ("/…", "#…") or absolute http(s) URL
  group    String  @default("Explore") // column heading — links sharing a group form one nav column
  order    Int     @default(0)         // ascending sort, both within a column and across columns
  isActive Boolean @default(true)      // hidden from the storefront when false, row not deleted

  @@index([isActive, order])
}
```

Each row is just `label → url`, so an admin can point a link at a `Category`, a specific `Product`, an internal page, or an external/social URL with no schema coupling. Rows are grouped by `group` into nav columns (first-appearance order for columns, `order` ascending within each), edited from `/admin/settings → Footer Navigation`. The settings actions validate the URL shape server-side (must start with `/`, `#`, or `http(s)://` — blocking `javascript:` hrefs).

The footer has **two** `unstable_cache`-wrapped reads, each with its own tag:

| Cached read | Tag | Invalidated by |
|---|---|---|
| `getActiveFooterLinks` (managed links) | `"footer-links"` | every FooterLink mutation in [`settings.ts`](../src/lib/actions/settings.ts) (`updateTag("footer-links")`) |
| `getShopCategories` (fallback "Collection" column) | `"categories"` | every category mutation in [`categories.ts`](../src/lib/actions/categories.ts) (`updateTag("categories")`) |

Both have a 1-hour safety TTL. If no managed links exist yet (or the DB read throws), the footer falls back to the category-driven "Collection" column (capped at 6) plus the static `Heritage`/`Boutiques`/`Client Care` groups, so the layout is never empty pre-curation. External (`http(s)://`) links render with `target="_blank" rel="noopener noreferrer"`.

| Entry point | Source | Shows |
|---|---|---|
| Homepage slider | `Category.findMany({ isFeatured: true })`, `sliderOrder` asc | Every featured category, with a live category-promo badge |
| `/shop` | `Category` (all) + `Product` (available, narrowed by `?category=slug`) | Discount-priced catalog, **server-filtered** per request |
| `/category/[slug]` | `getCategoryBySlug(slug)` → products by `categoryId` | **Any** category's landing page (featured or standard), one route |

**Also on the homepage:** `Hero`, `OurStory`, `FeaturesBar`, and [`BranchSelector`](../src/components/BranchSelector.tsx) — an "Our Locations" editorial section with Schema.org `Bakery`/`CafeOrCoffeeShop` JSON-LD. Note `BranchSelector` is **hardcoded editorial content** (Menouf Boutique + Beba Café, static copy, static images) — it is *not* driven by the `Branch` table. The dead `/branches/[slug]` links it used to carry were **purged** in the July 2026 dead-link sweep; it links nowhere today.

---

## 2. Product Detail Page (PDP) & Dynamic Variants — `BUILT`

The PDP fully supports multi-variant selection through a pair of client islands, and every variant is **priced through the Discount Engine** before it reaches the client (§2.5).

### 2.1 Server shell — [`(shop)/product/[slug]/page.tsx`](../src/app/(shop)/product/[slug]/page.tsx)

The page is a `force-dynamic` Server Component (the review panel and wishlist heart are personalized to the session). It fetches everything in one `Promise.all` — including **live promotions at all three targeting levels** (variant / product / category) and the approved reviews — then projects a **discount-resolved** view-model into the client island:

```ts
const now = new Date();   // one instant filters AND evaluates every promotion this request

const [product, session, wishlistedIds] = await Promise.all([
  prisma.product.findUnique({
    where: { slug },
    include: {
      category: { select: { name: true, slug: true, promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS } } },
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
    id: v.id, name: v.name,
    price: priced.finalPrice,
    isAvailable: v.isAvailable,
    compareAtPrice: priced.hasDiscount ? priced.basePrice : v.compareAtPrice,
  };
});
```

It passes `variants` (plus minimal product identity and `initialIsFavorited`) to [`ProductPurchasePanel`](../src/components/products/ProductPurchasePanel.tsx). **The price is intentionally not rendered in the Server Component** — it reflects the *selected* variant, so it lives in the client island. The page also computes review aggregates (`averageRating`, `reviewCount`) server-side and pre-checks `hasUserReviewedProduct` for signed-in users so the `ReviewForm` knows a resubmission would be rejected.

### 2.2 The data contract

```prisma
model ProductVariant {
  id             String   @id @default(cuid())
  productId      String
  name           String            // free text, e.g. "Half Kilo", "1 Piece / 250g"
  sku            String?  @unique
  price          Decimal           // catalogue base price — Decimal, so currency never drifts on binary rounding
  compareAtPrice Decimal?          // optional MANUAL strikethrough "was" price (admin-set)
  isAvailable    Boolean  @default(true)
  promotions     Promotion[]       // variant-level Discount Engine targets
}
```

Shape facts the islands honor:

1. **Variants are a flat list, not a size × color matrix.** `name` is one free-text string per row. The selector is a **single-axis** pill list over `variants[]`. True independent axes would be a schema change; the UI does not simulate it by parsing `name` strings.
2. **Images live on `Product`, not `ProductVariant`.** Switching the selected variant updates **price, availability, and the Add-to-Cart payload** — it does *not* swap the photo gallery.
3. **There are TWO independent sources of a strikethrough price.** A live `Promotion` (the Discount Engine, §2.5) discounts the live `price` and surfaces the catalogue base price as the "was" figure. Separately, `compareAtPrice` is a **manual** per-variant column exposed in both admin product forms ([`NewProductForm`](../src/components/admin/NewProductForm.tsx) / [`EditProductForm`](../src/components/admin/EditProductForm.tsx), "Compare-At Price"), validated by the shared Zod schema ([`validators.ts`](../src/lib/validators.ts)): it must be **strictly greater than the selling price** or the form rejects it. On the PDP the engine wins when a promo is live; the manual `compareAtPrice` is only the fallback when no promotion applies.
4. **Money is `Decimal` end-to-end in the database; the client sees plain numbers.** `price` and `compareAtPrice` are Prisma `Decimal` columns, so every Server Component / action that hands a price to a client island coerces first (`.toNumber()`, and the Discount Engine's `resolvePrice` returns plain 2-dp numbers). Never pass a raw `Decimal` across the RSC boundary — it doesn't serialize. (`sortOrder` no longer exists: the column was written by the old admin forms but never read on the storefront — every storefront query orders variants by `price` asc — so it was deleted.)

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

- **The panel renders the price; it does not compute the discount.** Discount math is done server-side in the page shell (§2.1) and arrives as the variant's `price` (discounted) + `compareAtPrice` (the "was"). The island stays purely presentational.
- **No drift by construction.** Price, sold-out state, line total, and the cart payload are all computed from `activeVariant`. There is no second `useState` holding "the current price" that a fast double-click could desync from the selected pill.
- **`tabular-nums` on every numeric node — a free CLS win.** The hero price, the `compareAtPrice` strikethrough, the quantity readout, and the CTA's line total all use fixed-width digits, so changing variant or a discount toggling never reflows the surrounding layout.
- **Accessible compare-at pricing.** When `compareAtPrice > price`, the original is struck-through with `aria-label="Original price … EGP"`. The CTA carries a dynamic `aria-label` describing quantity and line total (or "Selected option is sold out").
- **Add-to-Cart sends the *selected* variant — and the price the customer saw.** `handleAdd` calls `addItem({ id: product.id, variantId: activeVariant.id, price: activeVariant.price, quantity, … }, isLoggedIn)` — `activeVariant.id`, never `variants[0].id`. A sold-out active variant disables the stepper and CTA outright. The chosen quantity is passed **in one call**: one store update and one background DB sync however large the quantity (the old per-unit loop that fired `qty` racing syncs is gone), with the resulting line clamped to `CHECKOUT_MAX_QUANTITY`.

### 2.4 [`VariantSelector.tsx`](../src/components/products/VariantSelector.tsx) — stateless, single-axis pills

The selector owns **no state of its own**. The parent holds `selectedVariantId` and passes it down with an `onSelect` callback, so the pills can never drift from the price/payload derived in the panel.

| Behavior | Implementation |
|---|---|
| Single variant | Returns `null` — no dead single pill |
| Per-pill price | Each pill shows **that variant's own (discounted) price** (`font-mono tabular-nums`) |
| Out-of-stock variant | `isAvailable: false` → pill is **disabled but kept in the DOM** (strikethrough price, muted text) |
| A11y | `role="radiogroup"` wrapper, `role="radio"` + `aria-checked` per pill, keyboard-focusable, visible `focus-visible` ring |

### 2.5 Storefront Discount Integration (Product Cards + PDP) — `BUILT`

Active promotions are surfaced on every storefront price node by one shared, pure resolver — [`src/lib/discounts.ts`](../src/lib/discounts.ts). Nothing in the UI implements discount math itself; cards, the PDP, the cart, and `placeOrder` all call the same functions, so they can never disagree on what a variant costs.

**The three helpers a storefront surface uses:**

| Helper | Role |
|---|---|
| `livePromotionWhere(now)` | A Prisma `where` matching only **live** promotions (`isActive && startDate <= now <= endDate`). Spread it into every `promotions: { where: …, select: PROMOTION_SELECT_FIELDS }` include. |
| `gatherPromotions(variantPromos, productPromos, categoryPromos)` | Merges + de-dupes (by id) the promotions targeting a variant **directly**, its **parent product**, or that product's **category**. |
| `resolvePrice(basePrice, promotions, now)` | Returns `{ basePrice, finalPrice, discountAmount, hasDiscount, appliedPromotion }`. When several live promos apply, the one yielding the **lowest** `finalPrice` wins (best for the customer). Money is rounded to 2dp (`roundMoney`), never below 0. |

**Always pass a single `now` per request** (every page above declares `const now = new Date()` once) so the DB filter and the in-memory evaluation agree on the same instant — a promo can't be "live" for the query but "expired" for the math.

**Product cards** ([`ProductCard.tsx`](../src/components/ProductCard.tsx), fed by [`CategoryPageTemplate`](../src/components/CategoryPageTemplate.tsx), `/shop`, the category route, and the wishlist page) price the **starting (lowest-base-price) variant**:

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

The card then renders, only while `compareAtPrice > price`: a struck-through original price beside the live price (`aria-label="Original price … EGP"`), and a `-{percentOff}%` **sale badge** over the image, where `percentOff = Math.round((1 - price / compareAtPrice) * 100)`.

**PDP variant islands** (§2.1–§2.4) price **every** variant — not just the cheapest — so the strikethrough follows the selected pill, using the same `priced.hasDiscount ? priced.basePrice : v.compareAtPrice` fallback.

**The manual fallback is mirrored everywhere a product card renders.** `ShopPage`, `CategoryPageTemplate`, and the [wishlist page](../src/app/(shop)/wishlist/page.tsx) (via [`getWishlistItems`](../src/lib/actions/wishlist.ts)) all use the identical fallback expression. If a new card-rendering surface is added, copy this exact fallback rather than re-deriving discount logic in the component (the math itself still only ever lives in `src/lib/discounts.ts`).

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
model MenuItem { id String @id @default(cuid()); name String; price Decimal; order Int @default(0); categoryId String }
```

This separation is deliberate: the café menu is a **read-only, dine-in/pickup price list**, not something that flows into the cart, checkout, or the Discount Engine. Don't wire an "Add to Cart" button onto a `MenuItem`, and don't expect a `Promotion` to discount one. (`MenuItem.price` is a `Decimal` money column like every other price in the schema. The old orphaned `MenuPage` model — a shop-catalog grouping no route ever rendered — has been **deleted entirely**; `MenuCategory`/`MenuItem` are the only menu models.)

**Caching:** the route uses ISR — `export const revalidate = 3600` — and every admin menu mutation ([`src/lib/actions/menu.ts`](../src/lib/actions/menu.ts)) calls `revalidatePath("/menu")`, so edits appear immediately while anonymous traffic is served from cache. This works because `/menu` renders nothing personalized (unlike the product surfaces, which are `force-dynamic` for wishlist seeding).

### 3.1 Fixed-price rendering — [`MenuClient.tsx`](../src/app/(shop)/menu/MenuClient.tsx)

A fixed-price category ("Smoothies") renders **one header price badge** (`items[0]?.price`), then a dense responsive grid of item *names only*.

**Important nuance:** "all items share one price" is a **soft, admin-workflow convention — not a database constraint.** `MenuItem.price` is an independent column on every row. The admin enforces the convention via the **"Prices" bulk action** ([`BulkPriceModal.tsx`](../src/components/admin/menu/BulkPriceModal.tsx) → [`bulkAdjustCategoryPrices`](../src/lib/actions/menu.ts)), one atomic `updateMany` multiply. The storefront reads `items[0]?.price` and trusts it. **If a fixed-price category ever renders a price that looks wrong, check for divergent `MenuItem.price` rows before assuming a rendering bug.**

### 3.2 Standard (itemized) rendering & strict ordering

Each `MenuRow` is a leader-line row: price (left, `tabular-nums`, EGP suffix `ج.م`) — dotted leader (pure CSS) — Arabic item name (right, `dir="rtl" lang="ar"`). Ordering is enforced **at the query**, never re-sorted client-side:

```ts
const categories = await prisma.menuCategory.findMany({
  orderBy: { order: "asc" },
  include: { items: { orderBy: { order: "asc" } } },
});
```

The contract for any future change: **always sort via `orderBy: { order: "asc" }` in the Prisma query** — a client-side re-sort would silently override the admin's deliberate sequencing.

### 3.3 Supporting UX

- **Sticky scroll-spy nav** — an `IntersectionObserver` (not a `scroll` listener) tracks the in-view section; `rootMargin: "-22% 0px -65% 0px"` biases activation toward a section once it's meaningfully in frame.
- **Empty state** — zero categories renders "Our menu is being prepared" rather than a blank page.
- **Currency & locale** — Arabic item names are RTL-scoped per element (`dir="rtl" lang="ar"`) inside an otherwise LTR page shell.

---

## 4. Customer Auth Space & RBAC

### 4.1 Roles & session — `BUILT`

```prisma
enum UserRole { USER  ADMIN  MANAGER }
model User { ... role UserRole @default(USER) ... branchId String? ... }
```

Better Auth provides the session; `role` is layered on as an `additionalFields` entry with `input: false` ([`src/lib/auth.ts`](../src/lib/auth.ts)) — a client **cannot set its own role at signup**. `MANAGER` is a branch-scoped staff role; on the storefront it behaves like any authenticated user.

| Context | Access pattern | File |
|---|---|---|
| Server Component / Server Action | `getServerSession()` (React `cache()`-wrapped); staff gates: `requireAdmin()` (actions), `requireAdminPage()` (ADMIN-only pages — bounces a MANAGER back to `/admin`), `requireDashboardAccess()` (ADMIN or MANAGER, resolves the branch scope **live from the DB**, not the token) | [`src/lib/session.ts`](../src/lib/session.ts) |
| Client Component | `useSession()` — Better Auth's React client, with `inferAdditionalFields<typeof auth>()` so `session.user.role` is typed | [`src/lib/auth-client.ts`](../src/lib/auth-client.ts) |

### 4.2 Navbar visibility — `BUILT`

[`Navbar.tsx`](../src/components/Navbar.tsx) / [`UserMenu.tsx`](../src/components/UserMenu.tsx) gate the **Admin Dashboard** link behind a role check, while **My Orders** and **Wishlist** render unconditionally inside the "is logged in" branch:

| Session state | My Orders | Wishlist | Dashboard |
|---|---|---|---|
| Guest (no session) | — | — | — |
| `USER` | ✓ | ✓ | — |
| `ADMIN` / `MANAGER` | ✓ | ✓ | ✓ |

**My Orders / Wishlist are an "is authenticated" check, not a role check.** The auth block renders a pulse skeleton (not "Sign In") while `useSession()` is `isPending`, preventing a logged-in user from seeing a "Sign In" flash. Apply the same `isPending` guard to any new auth-aware UI.

### 4.3 Route protection via the Edge Proxy — `BUILT`

Authenticated routes are gated structurally at the Edge. The project ships [`src/proxy.ts`](../src/proxy.ts) — **Next.js 16's renamed middleware** (on this version the file must be `proxy.ts`, never `middleware.ts`):

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
- **Defense in depth, not a replacement.** The pages still self-guard: [`/wishlist`](../src/app/(shop)/wishlist/page.tsx) and [`/my-orders`](../src/app/(shop)/my-orders/page.tsx) both run `getServerSession()` and redirect to `/login` when absent. `getServerSession()` stays the source of truth and rejects a present-but-expired cookie that slips past the Edge.
- **`/checkout` is deliberately NOT in the matcher.** Checkout supports **guest orders** (`placeOrder` accepts a null `userId`), so gating it would break the guest flow. Keep it out.
- **Extending it.** A new authenticated route is protected by adding its bare path **and** `:path*` wildcard to `config.matcher` — and still adding the in-page `getServerSession()` check.

### 4.4 The login & redirect flow — `BUILT`

[`/login/page.tsx`](../src/app/(shop)/login/page.tsx) is a Server Component whose only job is to be a `<Suspense>` boundary around [`LoginClient.tsx`](../src/app/(shop)/login/LoginClient.tsx) (which reads `useSearchParams()`, so the boundary is required). `LoginFallback` is an `animate-pulse` skeleton sized to the real layout.

**Open-redirect hardening — `sanitizeRedirect`.** The `redirect` value is attacker-controllable. The guard is a **shared export in [`@/lib/utils`](../src/lib/utils.ts)**, usable isomorphically from Server and Client code:

```ts
// src/lib/utils.ts
export function sanitizeRedirect(path: string | null): string {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return "/"
  return path
}
```

Only a single-slash, same-origin relative path survives; absolute URLs and the protocol-relative `//host` trick collapse to `"/"`. On a successful `signIn.email`, navigation is **`router.push(redirectTo)` followed by `router.refresh()`** — Better Auth's vanilla email sign-in does not auto-navigate (its `callbackURL` is only honored by redirect-based flows), so the explicit push is what returns the user to the page the proxy bounced them from. The refresh lets [`CartSyncProvider`](../src/components/providers/CartSyncProvider.tsx) observe the new session and fold the guest cart into the account (§5.4).

> **Signup symmetry — `BUILT`.** [`/signup`](../src/app/(shop)/signup/page.tsx) now mirrors the login flow: `SignupClient` reads `?redirect=` through the same shared `sanitizeRedirect` guard and pushes the sanitized destination after `signUp.email`. A guest bounced off `/wishlist` who chooses "create an account" lands back where they intended, and the cart merge still fires (the session transition is what triggers it, §5.4).

### 4.5 Wishlist flow — `BUILT`

Persisted to Postgres, not local state: `WishlistItem { userId, productId }` with `@@unique([userId, productId])`. The client-side contract:

- Toggling, listing, and existence-checking are all Server Actions ([`src/lib/actions/wishlist.ts`](../src/lib/actions/wishlist.ts)) — there's no `/api/wishlist` REST route.
- Every page that renders product cards seeds `initialIsFavorited` from `getWishlistedProductIds()` **on the server**, so the heart's first paint is already correct — no flash-then-pop-in. [`WishlistButton.tsx`](../src/components/products/WishlistButton.tsx) takes over interactivity (optimistic flip, `useTransition`, rollback + toast on failure).
- Because per-user seeding can't be cached and served to the next visitor, every page doing it (`/shop`, `/category/[slug]`, the PDP) runs `export const dynamic = "force-dynamic"`. Carry this forward on any new product-listing surface.
- `getWishlistItems` returns card-ready rows priced through the Discount Engine, with the same manual compare-at fallback as every other card surface (§2.5). It only considers `isAvailable` variants for the starting price.

### 4.6 My Orders dashboard — `BUILT`

[`/my-orders`](../src/app/(shop)/my-orders/page.tsx) mirrors the admin orders board's URL-driven filter pattern, scoped to `session.user.id`, protected by the proxy (§4.3) plus an in-page session check. The `?status=` param is validated against the `OrderStatus` enum (`parseStatus`) — never trusted raw.

`OrderItem` stores a **snapshot** (`productName`, `variantName`, `unitPrice`, `quantity`) captured at purchase time — the `unitPrice` is the **already-discounted** price the customer was billed (§5.5). VAT is not stored in its own column; receipts derive it as the **residual** (`totalAmount − subtotal − deliveryFee`), so historical orders stay internally consistent even after the admin changes the VAT rate or disables VAT. Never join back to the live catalog to render order history — the snapshot *is* the source of truth for a placed order.

---

## 5. Cart & Checkout Pipeline

### 5.1 Implementation — `BUILT`, variant-keyed, client-first with optional DB persistence

The cart's **client source of truth** is Zustand + `persist`, `localStorage` key `"ali-baba-cart"` ([`src/lib/cart-store.ts`](../src/lib/cart-store.ts)). A **guest** cart is purely local. A **logged-in** customer additionally gets a **DB-backed, cross-device cart** (`CartItem`): the local store stays the optimistic front end, and each mutation is mirrored to Postgres in the background.

```ts
export interface CartItem {
  id: string;         // parent product id — display / grouping / PDP links ONLY, never the merge key
  variantId: string;  // the purchasable unit, and the canonical identity of a cart line
  name: string;
  price: number;      // display-only EGP — the DISCOUNTED unit price the customer saw;
                      // the server re-resolves the real price at checkout
  quantity: number;
  image: string;
  category?: string;
}
```

Every mutating action takes an optional `isLoggedIn` flag (the caller reads it from `useSession()`); when true the action mirrors the change to the DB via a background `syncCartItemAction` (§5.4). The optimistic local update always lands first:

```ts
addItem:        (item, isLoggedIn?)            // adds item.quantity units (default 1) in ONE update + ONE sync; line clamped to CHECKOUT_MAX_QUANTITY
removeItem:     (variantId, isLoggedIn?)       // local filter, then fireSync(DELETE)
updateQuantity: (variantId, qty, isLoggedIn?)  // local map (<1 → removeItem), then fireSync(SET)
clearCart:      ()                             // local-only empty (drops pendingOps) — callers pair it with clearDbCartAction()
clearLocalCart: ()                             // LOGOUT-only wipe: local + persisted + pendingOps, DB untouched
mergeAndSyncCart: () => Promise<void>          // guest → auth bridge (§5.4)
adoptDbCart:    (dbItems)                      // adopt a fetched DB cart, REPLAYING any unsynced pendingOps over it
refreshPrices:  () => Promise<{ updated }>     // GUEST re-price from the live catalogue (rePriceGuestCart)
```

**Record-then-confirm sync (`pendingOps`).** The store keeps an **unsynced-intent ledger** — `pendingOps: Record<variantId, { quantity, action }>` — written *before* each logged-in sync leaves and cleared only when the server confirms that exact op. A sync that fails (offline, timeout, tab closed mid-flight) leaves its op behind, and the next `adoptDbCart` (login hydrate / post-merge) **replays** it over the server payload instead of letting a blind overwrite silently drop the change. One rejection is terminal by design: when `syncCartItemAction` refuses a new line because the DB cart is at its **50-distinct-line cap**, the store matches the shared `CART_LIMIT_ERROR` string, **rolls the optimistic line back, drops its pending op, and toasts** — no replay can ever satisfy that rejection (§5.4).

**SSR-safe persistence.** The `persist` middleware uses a custom storage resolver: real `localStorage` in the browser, a **no-op storage** on the server (`SERVER_NOOP_STORAGE`). This matters because the default storage *throws* server-side, which would strip the `.persist` API off the store — and the checkout page reads `useCartStore.persist.onFinishHydration` during render. `partialize` persists `items` **and `pendingOps`** (so intent from a page-life that died mid-sync survives the reload) — never `isOpen` or session-derived data. SSR renders `items: []`, the client rehydrates after mount, no hydration mismatch.

### 5.2 Every operation keys on `variantId` — `BUILT`

`addItem`, `removeItem`, and `updateQuantity` all identify a line by `variantId`. The store previously merged on the product `id` — a money bug once the PDP gained a variant selector (adding "Cake — Large" after "Cake — Small" would bump the Small line's quantity and charge 2× Small). Keying on `variantId` makes each chosen variant a distinct, correctly-priced line.

**Why `variantId` alone — not a composite `productId_variantId`.** `ProductVariant.id` is already a globally unique cuid, and every variant belongs to exactly one product. The database asserts the same modeling choice:

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

Keep `id` (product id) on the line item for display grouping and PDP links — just never use it to dedup. **All React keys in the cart drawer and the checkout summary map over `variantId`.**

### 5.3 Cart discount integrity — `BUILT`

The cart never does discount math itself, yet it always shows discounted prices:

- **Local adds** carry the price the customer saw — quick-add from a card and Add-to-Cart from the PDP both pass the Discount-Engine output as `price` (§2.5).
- **DB reads re-resolve, never store.** `CartItem` persists only `{ userId, variantId, quantity }` — **no price column.** [`getDbCartAction`](../src/lib/actions/cart.ts) joins each line to its variant + product + category live promotions and runs `resolvePrice`, so the hydrated price is the *current* discount. A promotion that started or ended since the item was added is reflected the moment the cart hydrates. **Guest carts are covered too:** they have no hydrate step, so the checkout page calls the store's `refreshPrices()` on mount, which hits the public [`rePriceGuestCart`](../src/lib/actions/cart.ts) action (input de-duped and capped at 100 ids, read-only) and updates only the lines whose price changed — the total a guest sees *is* the total `placeOrder` will bill.
- **The server is still the only pricing authority.** `placeOrder` re-resolves every line server-side (§5.5); a stale or tampered client price can never reach the order.

### 5.4 Guest → authenticated bridge & `CartSyncProvider` — `BUILT`

[`CartSyncProvider`](../src/components/providers/CartSyncProvider.tsx) is a client-only wrapper (renders children untouched) that reconciles the local cart with the DB cart across the auth lifecycle:

| Situation | Detected via | Action |
|---|---|---|
| **Already logged in on mount** (refresh / new device) | `firstResolve` ref, first non-pending session reading | **HYDRATE** — `getDbCartAction()` then `adoptDbCart` (any unsynced `pendingOps` are replayed over the payload, §5.1). Never merge (would double-count an overlapping local + DB cart). |
| **Guest → logged in** (a real sign-in this session) | `knownUserId` ref transitions `null → id` | **MERGE** — `mergeAndSyncCart()`: push the guest's local lines up (server **SUMs** onto existing rows, clamped to the shared ceilings), then adopt the freshly-merged DB cart through `adoptDbCart`. |
| **Logged in → guest** (logout) | transition `id → null` | `clearLocalCart()` — wipe local + persisted storage; **DB cart left intact** for the next sign-in. |
| **Account switch A → B** | transition `idA → idB` | `clearLocalCart()` then HYDRATE B's DB cart. |

The two refs make each transition fire **exactly once**, and the provider deliberately never subscribes to `items`, so a cart edit doesn't re-run the effect.

Server-side hygiene in [`cart.ts`](../src/lib/actions/cart.ts): `mergeCartAction` sanitizes the payload (`sanitizeLocalLines`: drops blanks, clamps each quantity to **1–99** = `CHECKOUT_MAX_QUANTITY`, de-dupes by variant summing, and caps the merge at **50 distinct lines** = `CHECKOUT_MAX_ITEMS` — the same shared limits `checkoutSchema` enforces at checkout), pre-validates all variant ids in one query so stale ids are skipped instead of aborting the transaction, sums DB + local quantities **clamped to the ceiling** inside one transaction, and treats an empty guest cart as success. `syncCartItemAction` upserts to the *absolute* quantity (`SET` is idempotent — a late-arriving SET simply overwrites) and uses `deleteMany` for removals so a no-op delete is silent. It also enforces the **50-distinct-line DB cap**: a `SET` that would introduce a *new* line beyond `CHECKOUT_MAX_ITEMS` is rejected with the shared `CART_LIMIT_ERROR` (updating an existing line's quantity is always allowed, so a full cart can still be re-quantified or emptied) — the client store rolls the optimistic line back and toasts on that specific rejection (§5.1). Transient sync failures keep their `pendingOps` entry and surface a toast; the next hydrate/merge replays and reconciles them.

> **Why this is safe with the price model.** None of these paths trust a client price: the write actions store only `{ variantId, quantity }`, and `getDbCartAction` re-prices on read. Cross-device consistency is about **identity and intent**, never money.

### 5.5 Server-side price integrity — preserve this — `BUILT`

[`placeOrder`](../src/lib/actions/orders.ts) accepts only `{ variantId, quantity }` pairs and re-resolves price, **the best live discount**, availability, and parent-product availability **server-side**, inside a transaction — the client never sends a price. The payload is first validated by the **same shared `checkoutSchema`** the form runs (empty cart, 1–50 items, quantity 1–99, name/phone, and the conditional rule a tampered client could bypass: **a DELIVERY order must carry a non-empty `addressLine`**). A per-phone throttle then caps simultaneously-`PENDING` orders (3) before any pricing work. Inside the transaction the variant reads are **batched into one `findMany` (`id IN …`)** — two statements total regardless of cart size — each line's live variant/product/category promotions go through `resolvePrice`, and the **discounted `finalPrice` is snapshotted** onto the `OrderItem`.

The money math is **fully DB-driven** (no hardcoded constants) and rounded with the Discount Engine's shared `roundMoney` (2-dp) at every accumulation point before it reaches the `Decimal` money columns:

```ts
const settings = await getStoreSettings();          // vatRate, isVatEnabled, defaultDeliveryFee

subtotal = roundMoney(subtotal);                    // Σ discounted lines, rounded once after summing
const deliveryFee =
  payload.fulfillment === "DELIVERY"
    ? roundMoney(branch?.deliveryFee ?? settings.defaultDeliveryFee) // branch fee, or the "Other Areas" default
    : 0;                                                             // PICKUP is always free
const vat = settings.isVatEnabled ? roundMoney(subtotal * settings.vatRate) : 0; // 2-dp, keeps its piastres
const totalAmount = roundMoney(subtotal + deliveryFee + vat);
```

VAT is **not stored in its own column** — it's folded into `totalAmount` and derived as the residual at display time, so a later settings change can't retroactively skew old receipts. When touching the cart or checkout, don't start threading the client's `price` into the order payload "for convenience" — the flow's entire price-integrity guarantee rests on the server being the only pricing source. On success, `placeOrder` revalidates `/admin`, `/admin/orders`, and (for signed-in users) `/my-orders`.

### 5.6 Checkout delivery & pickup — dynamic Branch fetching — `BUILT`

The checkout form's location selector ([`src/app/(shop)/checkout/page.tsx`](../src/app/(shop)/checkout/page.tsx)) is **driven by the live `Branch` table**. The old static `DeliveryLocation` enum and its fixed `CitySelect` dropdown are **gone from the checkout flow** — adding or renaming a delivery area is an admin Branch edit, not a schema migration.

On mount the page loads, in one `Promise.all`: **active branches** via [`getActiveBranches()`](../src/lib/actions/branches.ts) — a public Server Action returning `{ id, slug, name, deliveryFee }` for `isActive` branches, `name`-ordered — and the **global pricing settings** via [`getPublicPricingSettings()`](../src/lib/actions/store-settings.ts) (§5.7). Both feed a single `BranchSelect`:

- **Delivery** — the "Delivery Area" selector is the branch list **plus** a synthetic **"Other Areas"** option (`id: "__other__"`). A chosen branch sends its id; "Other Areas" sends `branchId = null`, which leaves the order **unassigned** so it surfaces to the **Super Admin** (`ADMIN`) only.
- **Pickup** — the customer chooses a branch directly; its id becomes `branchId`, and `pickupBranch` additionally carries the human-readable branch **label** for the receipt. Pickup is always fee-free.
- **The previewed delivery fee mirrors the server exactly**: pickup → 0; delivery → the chosen branch's `deliveryFee`; "Other Areas" (or an unknown id) → `settings.defaultDeliveryFee`. A 0-fee branch renders as "Free".
- **Arabic sub-labels** in the dropdown (`BRANCH_SUBLABELS`, keyed by branch `slug` — currently only `menouf` and `beba`) are **presentational only** — not stored on the `Branch` model. Any other branch simply shows its `name`.

`placeOrder` then does a **defensive re-resolution**: a supplied `branchId` is stamped only if it still matches a real, `isActive` branch — and the branch's `deliveryFee` is read from that same row, never from the client. A stale/invalid/deactivated id silently falls back to `null` (→ Super Admin, default fee) so the order never hard-fails on a race.

> **Legacy compatibility.** `Order.deliveryCity` (a `DeliveryLocation?`) and the enum itself **remain in the schema**, but the checkout flow no longer writes them — they exist purely so historical orders still render. The admin order drawer shows the legacy `deliveryCity` defensively for those rows, and the assigned branch name for new ones. Don't reintroduce the enum into checkout.

**Hydration UX:** the page tracks Zustand's `persist` hydration with `useSyncExternalStore(useCartStore.persist.onFinishHydration, …)` and holds a neutral background until the cart has rehydrated, the pricing settings have loaded, **and (for guests) the cart lines have been re-priced from the live catalogue** (`refreshPrices()`, §5.3) — a customer with items never flashes "Your Cart is Empty", and a total is never rendered from numbers about to change. If the settings fetch fails, a `FALLBACK_PRICING` constant (mirroring the schema defaults) keeps the *preview* alive — billing is unaffected because `placeOrder` reads the real rows. On success the page runs `clearCart()` locally and, when logged in, `clearDbCartAction()` so the placed cart doesn't re-hydrate. The same local+DB pair backs the drawer's "Clear cart" button ([`CartSidebar.tsx`](../src/components/CartSidebar.tsx)).

### 5.7 Store pricing settings (VAT + delivery fees) — `BUILT` (new since the last revision)

```prisma
model StoreSettings {
  id                 String  @id @default("store")   // fixed singleton id — never create a second row
  vatRate            Float   @default(0.14)          // a FRACTION (0.14 = 14%) — deliberately kept Float: a rate, not currency
  isVatEnabled       Boolean @default(true)          // master switch — false ⇒ no VAT shown or charged anywhere
  defaultDeliveryFee Decimal @default(35)            // fee for branchless ("Other Areas") DELIVERY orders — Decimal money
}

model Branch {
  ...
  deliveryFee Decimal @default(35)  // flat fee (EGP) when this branch fulfils a DELIVERY order — Decimal money
}
```

Note the deliberate type split: **money columns are `Decimal`** (like every price in the schema), while `vatRate` stays `Float` because it is a *rate/fraction*, not a currency amount. `getStoreSettings()` coerces `defaultDeliveryFee` with `.toNumber()` so consumers always receive plain serializable numbers.

**One reader, many consumers — and it is strictly read-only.** [`getStoreSettings()`](../src/lib/store-settings.ts) is the single access path: a primary-key `findUnique` that runs on hot public paths (every checkout mount) and therefore **never writes**. A missing row is answered from the in-memory `DEFAULT_PRICING_SETTINGS` (frozen, mirroring the schema column defaults); the singleton row is created only by the ADMIN-gated mutations in [`store-settings.ts`](../src/lib/actions/store-settings.ts) when an admin first saves the form. `placeOrder`, the admin Settings page, and the public checkout preview all read through it, exactly like every price flows through `resolvePrice`: one reader means the preview and the bill can't disagree about what the settings *are*.

**The action surface** ([`src/lib/actions/store-settings.ts`](../src/lib/actions/store-settings.ts)):

| Action | Auth | Contract |
|---|---|---|
| `getPublicPricingSettings()` | none (storefront) | Returns `{ vatRate, isVatEnabled, defaultDeliveryFee }` — it reveals nothing the order summary doesn't already display. |
| `updateVatSettings({ isVatEnabled, vatRatePercent })` | `requireAdmin` | Accepts the human percentage (14 → 14%), validates `0 < p ≤ 100`, stores a 4dp fraction. The rate is validated even while VAT is disabled, so a bad value can't lie dormant. |
| `updateDeliveryFees({ defaultFee, branchFees[] })` | `requireAdmin` | Persists the whole fee sheet in **one transaction** (StoreSettings default + one `Branch.update` per row) — all-or-nothing. Each fee is validated into `[0, 10 000]` and rounded to 2dp. A deleted branch surfaces as a clean "refresh and try again" error (P2025). |

**Two admin surfaces edit `Branch.deliveryFee`** — the per-branch modal ([`BranchModal`](../src/components/admin/BranchModal.tsx) → [`manage-branches.ts`](../src/lib/actions/manage-branches.ts), which validates `fee ≥ 0` and defaults a missing value to 35) and the Settings fee sheet ([`PricingSettingsManager`](../src/components/admin/PricingSettingsManager.tsx), which lists **active** branches only). Both round to 2dp; note the ceilings differ (see §7).

**Checkout consumption:** the client treats every fetched number as display-only. The `OrderSummary` mirrors `placeOrder`'s math exactly — discounted subtotal → 2-dp `roundMoney(subtotal * vatRate)` when enabled → resolved delivery fee — and renders the VAT row only when `isVatEnabled` (labelled with the trimmed percentage, e.g. "VAT (14%)").

### 5.8 `/cart` route — `GAP` (drawer-only today)

There is no `/cart` route — no full-page cart view, only the slide-out [`CartSidebar.tsx`](../src/components/CartSidebar.tsx) drawer (opened from the navbar cart icon, or automatically on `addItem`). (The stray empty `src/app/(shop)/cart/` directory that used to invite confusion has been removed.) Worth a dedicated full page if a deep-linkable, shareable cart view is ever needed.

---

## 6. Performance & Core Web Vitals Checklist

| Metric | Lever in use | Where |
|---|---|---|
| **LCP** | Server Components fetch with Prisma at render time — hero image, cards, **and resolved discount prices** arrive in the initial HTML, no client-fetch waterfall | `(shop)/page.tsx`, `/category/[slug]`, `/shop` |
| **LCP** | `next/image` with per-breakpoint `sizes`, `remotePatterns` scoped to the UploadThing CDN (`utfs.io`, `*.ufs.sh`) | [`next.config.ts`](../next.config.ts), `CategorySlider.tsx` |
| **CLS** | `tabular-nums` on **every** price node that can change at runtime — PDP hero price, strikethroughs, variant pills, quantity stepper, CTA line total, menu prices | `ProductPurchasePanel`, `VariantSelector`, `MenuRow` |
| **CLS** | Pulse-skeleton for the navbar auth state while `useSession()` is `isPending`; matching skeleton as the `/login` Suspense fallback; checkout holds its background until the cart store rehydrates, pricing settings load, **and** (guests) the cart is re-priced | `Navbar.tsx`, `LoginFallback`, `checkout/page.tsx` |
| **INP** | `IntersectionObserver` for the menu scroll-spy instead of a `scroll` handler | `MenuClient.tsx` |
| **INP** | Every mutation (wishlist toggle, add-to-cart, cart sync) runs with optimistic local state — UI responds before the round-trip; the DB cart sync is backgrounded via a record-then-confirm `pendingOps` ledger (§5.1), not awaited | wishlist, `ProductPurchasePanel`, `cart-store.ts` |
| **INP** | `/shop` category filtering is server-side (`?category=` narrows the Prisma query); `useTransition` + `router.push(..., { scroll: false })` keep the pill click non-blocking and scroll-stable | `ShopClient.tsx` |
| **TTFB** | React `cache()` dedupes the per-request category lookup across `generateMetadata` + page — one Postgres round-trip, not two | `/category/[slug]` |
| **TTFB / caching** | `/menu` is ISR (`revalidate = 3600`) + `revalidatePath("/menu")` on admin edits; the footer's two queries are `unstable_cache`d behind the `"footer-links"` / `"categories"` tags. The homepage is **ISR (`revalidate = 60`)** — admin mutations bust it directly (`revalidatePath("/")`, promotions via `revalidatePath("/", "layout")`), so the 60s window only bounds pure time-based promo liveness | `menu/page.tsx`, `Footer.tsx`, `(shop)/page.tsx` |
| **Bundle size** | Embla Carousel (~6 KB) instead of a heavier carousel; Zustand (~1 KB) for cart state; the discount resolver is pure TS with no runtime deps; the footer ships zero JS (Server Component; the newsletter input is the only client island) | `CategorySlider.tsx`, `cart-store.ts`, `discounts.ts`, `Footer.tsx` |
| **Hydration correctness** | Wishlist heart state, the PDP's default variant, and discount prices are computed/derived deterministically server-side — never from a client-only `useEffect` fetch that reintroduces a flash-of-wrong-state | `getWishlistedProductIds()`, `ProductPurchasePanel`, `discounts.ts` |

---

## 7. Open Items for Engineering

The historical blocking work (variant selector, `variantId` cart, edge proxy, dynamic category route, Discount Engine, DB cart, branch checkout, footer CMS, `sanitizeRedirect`, dynamic slider CMS, DB pricing settings) is **all shipped** — and so is nearly all of the hardening backlog this table used to track. Closed by the July 2026 hardening wave: delivery-address enforcement (shared `checkoutSchema` `superRefine`, §5.5), the discarded checkout email field (input removed), the per-unit `addItem` loop (quantity-based single sync, §2.3), the dead `/branches/[slug]` links (purged, §1.3), the orphaned `MenuPage` model (deleted, §3), the cosmetic newsletter form (removed from the footer), the homepage caching contradiction (ISR 60 + storefront-wide promo revalidation, §1.1), stale guest cart prices (`rePriceGuestCart` at checkout mount, §5.3), `placeOrder` robustness (batched `findMany`, schema ceilings 1–50 items × 1–99 qty, per-phone throttle, §5.5), `ProductVariant.sortOrder` (column deleted, §2.2), signup's ignored `?redirect=` (§4.4), money as `Float` (all money columns migrated to `Decimal`), and the stale-comment/dead-code sweep (mostly done — one remnant below). What remains:

| # | Item | Section | Severity |
|---|---|---|---|
| 1 | **Fee-validation ceilings disagree** — the Settings fee sheet (`parseFee`) caps at 10 000; the Branch modal path (`validateBranchInput` in `manage-branches.ts`) still has no upper bound. Align on one rule (share the `parseFee` helper). | §5.7 | Low |
| 2 | **Pickup with zero active branches still submits** — the selector renders an "unavailable" notice, but `checkoutSchema` doesn't require a branch for `PICKUP`, so submission yields an unassigned order with no pickup label. Disable submit for that state. | §5.6 | Low |
| 3 | Full-page `/cart` view if a deep-linkable cart is ever needed (drawer-only today). | §5.8 | Low |
| 4 | Dead code remnant: `categoryUpdateSchema` in `validators.ts` is exported but referenced nowhere. | — | Low |
