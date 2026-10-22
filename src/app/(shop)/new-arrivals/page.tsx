import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ChevronRight } from "lucide-react";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import ProductCard, { type ShopProduct } from "@/components/ProductCard";
import {
  gatherPromotions,
  livePromotionWhere,
  PROMOTION_SELECT_FIELDS,
  resolvePrice,
} from "@/lib/discounts";
import { LISTABLE_PRODUCT } from "@/lib/catalog";

// Shared ISR cache (60s), matching the category pages and the PDP: this page is
// identical for every visitor (wishlist hearts hydrate client-side from the
// shared store — never seeded here), so it regenerates at most once a minute.
// Product and category mutations revalidate "/new-arrivals" directly; promotion
// mutations bust the whole storefront tree via revalidatePath("/", "layout").
// The 60s window only bounds pure time-based promotion liveness.
export const revalidate = 60;

/** Newest store-wide products shown in the "Latest Arrivals" showcase. */
const LATEST_ARRIVALS_LIMIT = 8;
/** Products previewed per category section — the "View all" link goes deeper. */
const PER_CATEGORY_LIMIT = 4;

/**
 * The standard card include: category name + the three-level live-promotion
 * hierarchy (category / product / variant) for the Discount Engine, with
 * variants ordered by price so `[0]` is the starting (lowest) price.
 */
function cardInclude(now: Date) {
  return {
    category: {
      select: {
        name: true,
        promotions: {
          where: livePromotionWhere(now),
          select: PROMOTION_SELECT_FIELDS,
        },
      },
    },
    promotions: {
      where: livePromotionWhere(now),
      select: PROMOTION_SELECT_FIELDS,
    },
    variants: {
      where: { isAvailable: true },
      orderBy: { price: "asc" }, // [0] = starting (lowest) price
      include: {
        promotions: {
          where: livePromotionWhere(now),
          select: PROMOTION_SELECT_FIELDS,
        },
      },
    },
  } satisfies Prisma.ProductInclude;
}

type CardRow = Prisma.ProductGetPayload<{
  include: ReturnType<typeof cardInclude>;
}>;

/**
 * Prices a product's starting variant through the Discount Engine and
 * serializes it into the plain-number `ShopProduct` the client card expects.
 * Same mapping as `/shop` and `CategoryPageTemplate` — the math lives only in
 * `discounts.ts`.
 */
function toCard(product: CardRow, now: Date): ShopProduct {
  const starting = product.variants[0];
  const priced = resolvePrice(
    starting?.price ?? 0,
    gatherPromotions(
      starting?.promotions,
      product.promotions,
      product.category.promotions
    ),
    now
  );
  return {
    id: product.id,
    variantId: starting?.id ?? "",
    name: product.name,
    slug: product.slug,
    category: product.category.name,
    price: priced.finalPrice,
    // Live promo → struck-through base price; otherwise fall back to the
    // variant's manual Compare-At (mirrors the PDP). The Decimal column is
    // serialized to a plain number for the client card.
    compareAtPrice: priced.hasDiscount
      ? priced.basePrice
      : starting?.compareAtPrice?.toNumber() ?? null,
    image: product.images[0] ?? "/placeholder.jpg",
    tagline: product.description ?? undefined,
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const description =
    "The newest creations from the Ali Baba kitchen, then a taste of every category — all handcrafted.";

  return {
    title: "New Arrivals | Ali Baba",
    description,
    alternates: { canonical: "/new-arrivals" },
    openGraph: {
      title: "New Arrivals | Ali Baba",
      description,
    },
  };
}

export default async function NewArrivalsPage() {
  // One instant drives every promotion filter + evaluation this request.
  const now = new Date();

  // Both reads are independent — one parallel batch, no waterfall.
  const [latestRows, categoryRows] = await Promise.all([
    prisma.product.findMany({
      where: LISTABLE_PRODUCT,
      include: cardInclude(now),
      orderBy: { createdAt: "desc" },
      take: LATEST_ARRIVALS_LIMIT,
    }),
    // Only categories with something to show; each carries its newest
    // listable products (Prisma applies `take` per category) and the full
    // listable count for the "View all" link.
    prisma.category.findMany({
      where: { products: { some: LISTABLE_PRODUCT } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        subtitle: true,
        isFeatured: true,
        sliderOrder: true,
        products: {
          where: LISTABLE_PRODUCT,
          include: cardInclude(now),
          orderBy: { createdAt: "desc" },
          take: PER_CATEGORY_LIMIT,
        },
        _count: { select: { products: { where: LISTABLE_PRODUCT } } },
      },
    }),
  ]);

  const latestArrivals = latestRows.map((p) => toCard(p, now));

  // Featured categories lead in their curated slider order; the rest follow
  // alphabetically (the query's order — Array.prototype.sort is stable).
  const categorySections = [...categoryRows]
    .sort((a, b) => {
      if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1;
      return a.isFeatured ? a.sliderOrder - b.sliderOrder : 0;
    })
    .map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      subtitle: category.subtitle,
      total: category._count.products,
      products: category.products.map((p) => toCard(p, now)),
    }));

  const isEmpty = latestArrivals.length === 0 && categorySections.length === 0;

  return (
    // Navbar/Footer (and the fixed-navbar clearance) come from the (shop)
    // layout — the header's top padding here is purely editorial spacing.
    <div className="min-h-screen bg-white font-sans" dir="ltr">
      {/* ─── Editorial header ─────────────────────────────── */}
      <header className="relative overflow-hidden border-b border-stone-100 bg-[#FAFAFA]">
        <div className="mx-auto max-w-screen-xl px-6 pb-12 pt-12 text-center md:px-10 md:pb-16 md:pt-16 lg:px-14">
          <nav
            aria-label="Breadcrumb"
            className="mb-7 flex items-center justify-center gap-1.5 font-sans text-[11px] font-medium uppercase tracking-[0.18em] text-stone-400"
          >
            <Link href="/" className="transition-colors hover:text-primary">
              Home
            </Link>
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
            <span className="text-stone-600">New Arrivals</span>
          </nav>

          <p className="mb-5 font-sans text-[11px] font-semibold uppercase tracking-[0.35em] text-primary">
            The Maison
          </p>

          <h1 className="font-serif font-medium leading-[1.03] tracking-tight text-stone-900 text-[clamp(2.5rem,6.5vw,5rem)]">
            New Arrivals
          </h1>

          <p className="mx-auto mt-6 max-w-2xl font-sans text-base leading-relaxed text-stone-500 md:text-lg">
            The newest creations from our kitchen, followed by every category
            we bake — each piece handcrafted with care.
          </p>

          {/* Jump strip — plain anchors to each category section below. */}
          {categorySections.length > 0 && (
            <nav
              aria-label="Jump to a category"
              className="mt-10 flex flex-wrap items-center justify-center gap-2"
            >
              {categorySections.map((c) => (
                <a
                  key={c.id}
                  href={`#${c.slug}`}
                  className="rounded-full border border-stone-200 bg-white px-4 py-2 font-sans text-xs font-medium text-stone-600 transition-colors hover:border-primary hover:text-primary"
                >
                  {c.name}
                </a>
              ))}
            </nav>
          )}
        </div>
      </header>

      {isEmpty ? (
        <div className="mx-auto flex max-w-screen-xl flex-col items-center justify-center px-6 py-24 text-center">
          <p className="font-serif text-2xl font-medium text-stone-700 md:text-3xl">
            Nothing here just yet
          </p>
          <p className="mt-3 max-w-md font-sans text-sm text-stone-400">
            We&apos;re still perfecting our creations. Check back soon.
          </p>
          <Link
            href="/"
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-stone-900 px-7 py-3 font-sans text-xs font-semibold uppercase tracking-[0.18em] text-white transition-colors hover:bg-primary"
          >
            Back to home
          </Link>
        </div>
      ) : (
        <>
          {/* ─── Latest Arrivals ──────────────────────────────── */}
          {latestArrivals.length > 0 && (
            <section
              aria-labelledby="latest-arrivals-heading"
              className="border-b border-stone-100 bg-stone-50/60"
            >
              <div className="mx-auto max-w-screen-xl px-6 py-14 md:px-10 md:py-20 lg:px-14">
                <div className="mb-10 flex flex-col items-center text-center md:mb-14">
                  <h2
                    id="latest-arrivals-heading"
                    className="font-serif text-3xl font-medium tracking-tight text-stone-900 md:text-5xl"
                  >
                    Latest Arrivals
                  </h2>
                  <p className="mt-4 max-w-xl font-sans text-sm leading-relaxed text-stone-500 md:text-base">
                    Fresh from the kitchen — the newest additions to the maison.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
                  {latestArrivals.map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* ─── Category-by-category previews ─────────────────── */}
          {categorySections.map((section) => (
            <section
              key={section.id}
              id={section.slug}
              aria-labelledby={`${section.slug}-heading`}
              className="scroll-mt-24 border-b border-stone-100 last:border-b-0"
            >
              <div className="mx-auto max-w-screen-xl px-6 py-14 md:px-10 md:py-20 lg:px-14">
                <div className="mb-10 flex flex-col gap-4 md:mb-12 md:flex-row md:items-end md:justify-between">
                  <div className="max-w-2xl">
                    <p className="mb-3 font-sans text-[11px] font-semibold uppercase tracking-[0.35em] text-primary">
                      The Category
                    </p>
                    <h2
                      id={`${section.slug}-heading`}
                      className="font-serif text-3xl font-medium tracking-tight text-stone-900 md:text-4xl"
                    >
                      {section.name}
                    </h2>
                    {section.subtitle && (
                      <p className="mt-3 font-sans text-sm leading-relaxed text-stone-500 md:text-base">
                        {section.subtitle}
                      </p>
                    )}
                  </div>

                  <Link
                    href={`/category/${section.slug}`}
                    aria-label={`View all ${section.name}`}
                    className="group/all inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-stone-200 px-5 py-2.5 font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-700 transition-colors hover:border-primary hover:text-primary md:self-auto"
                  >
                    View all
                    <span className="tabular-nums text-stone-400 group-hover/all:text-primary">
                      ({section.total})
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover/all:translate-x-0.5" />
                  </Link>
                </div>

                <div className="grid grid-cols-1 gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
                  {section.products.map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
