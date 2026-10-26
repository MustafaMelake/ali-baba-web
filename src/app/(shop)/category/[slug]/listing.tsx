import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import CategoryPageTemplate from "@/components/CategoryPageTemplate";
import Pagination from "@/components/Pagination";
import CollectionCard from "@/components/CollectionCard";
import { LISTABLE_PRODUCT } from "@/lib/catalog";
import { getCategoryCollectionCards } from "@/lib/collections";
import { productCardInclude, toProductCard } from "@/lib/product-cards";
import { getShopFacets } from "@/lib/shop-catalog";
import { DEFAULT_SHOP_FILTERS } from "@/lib/shop-filters";
import {
  isPageOutOfRange,
  pageHref,
  pageInfo,
  pageSlice,
  STOREFRONT_PAGE_SIZE,
} from "@/lib/pagination";

// ─────────────────────────────────────────────────────────────────────────────
// The category listing, shared by /category/[slug] (page 1) and
// /category/[slug]/page/[n] (page 2+). Pagination is by PATH segment so both
// routes stay on the shared ISR cache — `searchParams` would make them dynamic.
// Category mutations revalidate the base path; deeper pages age out on their
// own 60s window (the same accepted bound as product edits on this route).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Request-deduped category lookup. `generateMetadata` and the page component each
 * need the row; wrapping the query in React's `cache()` collapses them into a
 * single Postgres round-trip per request instead of two.
 */
export const getCategoryBySlug = cache((slug: string) =>
  prisma.category.findUnique({ where: { slug } }),
);

const basePath = (slug: string) => `/category/${slug}`;

export async function categoryMetadata(slug: string, page: number): Promise<Metadata> {
  const category = await getCategoryBySlug(slug);
  if (!category) return { title: "Category Not Found | Ali Baba" };

  const description =
    category.subtitle ??
    `Explore our ${category.name} — handcrafted in the Ali Baba kitchen.`;
  const title = page > 1 ? `${category.name} — Page ${page} | Ali Baba` : `${category.name} | Ali Baba`;

  return {
    title,
    description,
    // Each page is its own canonical URL; page 1 is the bare category path.
    alternates: { canonical: pageHref({ kind: "path", base: basePath(category.slug) }, page) },
    openGraph: {
      title,
      description,
      images: category.image ? [{ url: category.image }] : undefined,
    },
  };
}

export async function CategoryListing({ slug, page }: { slug: string; page: number }) {
  const category = await getCategoryBySlug(slug);
  if (!category) notFound();

  // One instant for the DB promotion filter and the card prices alike.
  const now = new Date();
  // LISTABLE before paginating, so the page count is exact.
  const where = { ...LISTABLE_PRODUCT, categoryId: category.id };

  const [total, rows, collectionCards, facets] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: productCardInclude(now),
      // `id` tie-break: products sharing a createdAt keep a stable page order.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...pageSlice(page, STOREFRONT_PAGE_SIZE),
    }),
    // The category's collections ride on page 1 only.
    page === 1 ? getCategoryCollectionCards(category.id) : Promise.resolve([]),
    // The Filter & sort sheet's lists (it filters on /shop, preset to this category).
    getShopFacets(),
  ]);

  const info = pageInfo(page, STOREFRONT_PAGE_SIZE, total);
  if (isPageOutOfRange(info)) notFound();

  return (
    <CategoryPageTemplate
      title={category.name}
      description={
        category.subtitle ??
        `Discover our ${category.name} — each piece handcrafted with care.`
      }
      eyebrow="Category"
      crumbs={[{ label: "Shop", href: "/shop" }]}
      cards={rows.map((p) => toProductCard(p, now))}
      total={total}
      // Collection cards first, then EVERY product of the category — no
      // product is only reachable through a collection.
      gridHeading={collectionCards.length > 0 ? `All ${category.name}` : undefined}
      beforeGrid={
        collectionCards.length > 0 ? (
          <section
            aria-label={`${category.name} collections`}
            className="mx-auto max-w-screen-xl px-6 pt-14 md:px-10 md:pt-20 lg:px-14"
          >
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {collectionCards.map((c) => (
                <CollectionCard key={c.slug} collection={c} />
              ))}
            </div>
          </section>
        ) : undefined
      }
      pagination={
        <Pagination info={info} mode={{ kind: "path", base: basePath(category.slug) }} />
      }
      filter={{ facets, preset: { ...DEFAULT_SHOP_FILTERS, category: [category.slug] } }}
    />
  );
}
