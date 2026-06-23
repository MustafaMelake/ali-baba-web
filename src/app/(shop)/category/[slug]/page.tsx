import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import CategoryPageTemplate from "@/components/CategoryPageTemplate";

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

  // Filter by the resolved FK (indexed) rather than re-deriving from identifier;
  // works identically for core (identifier set) and standard categories.
  const products = await prisma.product.findMany({
    where: { isAvailable: true, categoryId: category.id },
    include: {
      category: true,
      variants: { orderBy: { price: "asc" } }, // [0] = starting (lowest) price
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
