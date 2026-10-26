import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import CategoryPageTemplate from "@/components/CategoryPageTemplate";
import Pagination from "@/components/Pagination";
import { LISTABLE_PRODUCT } from "@/lib/catalog";
import { ACTIVE_COLLECTION } from "@/lib/collections";
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
// One collection's page, shared by /collections/[slug] (page 1) and
// /collections/[slug]/page/[n]. The canonical home of a collection — never
// nested under a category, so there is exactly one URL per collection page.
// Listable products in the admin's curated order (no sort param — it would make
// this ISR route dynamic). An inactive (draft) or missing collection is a 404.
// ─────────────────────────────────────────────────────────────────────────────

/** Request-deduped lookup shared by generateMetadata and the page. */
const getActiveCollectionBySlug = cache((slug: string) =>
  prisma.collection.findFirst({
    where: { slug, ...ACTIVE_COLLECTION },
    select: { id: true, slug: true, name: true, description: true, image: true },
  }),
);

const basePath = (slug: string) => `/collections/${slug}`;

export async function collectionMetadata(slug: string, page: number): Promise<Metadata> {
  const collection = await getActiveCollectionBySlug(slug);
  if (!collection) return { title: "Collection Not Found | Ali Baba" };

  const description =
    collection.description ?? `The ${collection.name} collection — handcrafted in the Ali Baba kitchen.`;
  const title = page > 1 ? `${collection.name} — Page ${page} | Ali Baba` : `${collection.name} | Ali Baba`;

  return {
    title,
    description,
    alternates: { canonical: pageHref({ kind: "path", base: basePath(collection.slug) }, page) },
    openGraph: {
      title,
      description,
      images: collection.image ? [{ url: collection.image }] : undefined,
    },
  };
}

export async function CollectionListing({ slug, page }: { slug: string; page: number }) {
  const collection = await getActiveCollectionBySlug(slug);
  if (!collection) notFound();

  // One instant for the DB promotion filter and the card prices alike.
  const now = new Date();
  // LISTABLE before paginating, so the page count is exact.
  const where = { collectionId: collection.id, product: LISTABLE_PRODUCT };

  const [total, rows, facets] = await Promise.all([
    prisma.collectionProduct.count({ where }),
    prisma.collectionProduct.findMany({
      where,
      // The admin's curated order; productId breaks ties deterministically.
      orderBy: [{ order: "asc" }, { productId: "asc" }],
      ...pageSlice(page, STOREFRONT_PAGE_SIZE),
      select: { product: { include: productCardInclude(now) } },
    }),
    // The Filter & sort sheet's lists (it filters on /shop, preset to this collection).
    getShopFacets(),
  ]);

  const info = pageInfo(page, STOREFRONT_PAGE_SIZE, total);
  if (isPageOutOfRange(info)) notFound();

  return (
    <CategoryPageTemplate
      title={collection.name}
      description={collection.description ?? `A curated selection from the Ali Baba kitchen.`}
      eyebrow="Collection"
      crumbs={[{ label: "Collections", href: "/collections" }]}
      cards={rows.map(({ product }) => toProductCard(product, now))}
      total={total}
      pagination={
        <Pagination info={info} mode={{ kind: "path", base: basePath(collection.slug) }} />
      }
      filter={{ facets, preset: { ...DEFAULT_SHOP_FILTERS, collection: collection.slug } }}
    />
  );
}
