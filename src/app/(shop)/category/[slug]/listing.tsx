import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import CategoryPageTemplate from "@/components/CategoryPageTemplate";
import Pagination from "@/components/Pagination";
import { livePromotionWhere, PROMOTION_SELECT_FIELDS } from "@/lib/discounts";
import { LISTABLE_PRODUCT } from "@/lib/catalog";
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
  const where = { ...LISTABLE_PRODUCT, categoryId: category.id };

  const [total, rawProducts] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: {
        category: {
          select: {
            name: true,
            promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
          },
        },
        promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
        variants: {
          where: { isAvailable: true },
          orderBy: { price: "asc" }, // [0] = starting (lowest) available price
          include: {
            promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
          },
        },
      },
      // `id` tie-break: products sharing a createdAt keep a stable page order.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...pageSlice(page, STOREFRONT_PAGE_SIZE),
    }),
  ]);

  const info = pageInfo(page, STOREFRONT_PAGE_SIZE, total);
  if (isPageOutOfRange(info)) notFound();

  const products = rawProducts.map((p) => ({
    ...p,
    variants: p.variants.map((v) => ({
      ...v,
      price: v.price.toNumber(),
      compareAtPrice: v.compareAtPrice?.toNumber() ?? null,
    })),
  }));

  return (
    <CategoryPageTemplate
      title={category.name}
      description={
        category.subtitle ??
        `Discover our ${category.name} — each piece handcrafted with care.`
      }
      products={products}
      now={now}
      pagination={
        <Pagination info={info} mode={{ kind: "path", base: basePath(category.slug) }} />
      }
    />
  );
}
