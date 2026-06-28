import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import CategoryPageTemplate from "@/components/CategoryPageTemplate";
import { livePromotionWhere, PROMOTION_SELECT_FIELDS } from "@/lib/discounts";

// CategoryPageTemplate seeds per-user wishlist state, so this page must render
// per-request (never from a shared ISR cache that would leak one user's hearts).
export const dynamic = "force-dynamic";

/**
 * Request-deduped category lookup. `generateMetadata` and the page component each
 * need the row; wrapping the query in React's `cache()` collapses them into a
 * single Postgres round-trip per request instead of two.
 */
const getCategoryBySlug = cache((slug: string) =>
  prisma.category.findUnique({ where: { slug } }),
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);

  if (!category) {
    return { title: "Category Not Found | Ali Baba" };
  }

  const description =
    category.subtitle ??
    `Explore our ${category.name} collection — handcrafted in the Ali Baba kitchen.`;

  return {
    title: `${category.name} | Ali Baba`,
    description,
    alternates: { canonical: `/category/${category.slug}` },
    openGraph: {
      title: `${category.name} | Ali Baba`,
      description,
      images: category.image ? [{ url: category.image }] : undefined,
    },
  };
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);

  // Unknown slug → render the nearest not-found UI (HTTP 404).
  if (!category) notFound();

  // One instant drives every promotion filter this request.
  const now = new Date();

  // Filter by the resolved FK (indexed) rather than re-deriving from identifier;
  // works identically for core (identifier set) and standard categories. Live
  // promotions are joined at category / product / variant level for the Discount
  // Engine (see CategoryPageTemplate).
  const products = await prisma.product.findMany({
    where: { isAvailable: true, categoryId: category.id },
    include: {
      category: {
        select: {
          name: true,
          promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
        },
      },
      promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
      variants: {
        orderBy: { price: "asc" }, // [0] = starting (lowest) price
        include: {
          promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <CategoryPageTemplate
      title={category.name}
      description={
        category.subtitle ??
        `Discover our ${category.name} collection — each piece handcrafted with care.`
      }
      products={products}
    />
  );
}
