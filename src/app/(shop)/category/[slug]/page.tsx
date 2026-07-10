import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import CategoryPageTemplate from "@/components/CategoryPageTemplate";
import { livePromotionWhere, PROMOTION_SELECT_FIELDS } from "@/lib/discounts";

// Shared ISR cache: this page is identical for every visitor (wishlist hearts
// hydrate client-side from the shared store), so it regenerates at most once a
// minute. 60s bounds promotion-window staleness; category mutations revalidate
// this path directly, and promotion mutations bust the whole storefront tree
// via revalidatePath("/", "layout").
export const revalidate = 60;

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

  // Filter by the resolved category FK (indexed) — works identically for
  // featured and standard categories. Live promotions are joined at category /
  // product / variant level for the Discount Engine (see CategoryPageTemplate).
  const rawProducts = await prisma.product.findMany({
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

  // Serialize the Decimal money columns on each variant to plain numbers before
  // handing the rows to CategoryPageTemplate (which prices them and forwards
  // numeric cards to the client ProductCard). Promotion `value` stays as-is —
  // the Discount Engine accepts a Decimal there.
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
        `Discover our ${category.name} collection — each piece handcrafted with care.`
      }
      products={products}
    />
  );
}
