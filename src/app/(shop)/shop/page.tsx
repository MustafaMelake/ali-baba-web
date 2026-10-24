import { prisma } from "@/lib/prisma";
import type { ShopProduct } from "@/components/ProductCard";
import { LISTABLE_PRODUCT } from "@/lib/catalog";
import { productCardInclude, toProductCard } from "@/lib/product-cards";
import { notFound } from "next/navigation";
import Pagination from "@/components/Pagination";
import {
  isPageOutOfRange,
  pageInfo,
  pageSlice,
  parsePageParam,
  STOREFRONT_PAGE_SIZE,
} from "@/lib/pagination";
import ShopClient from "./ShopClient";

// No per-user data here anymore (wishlist hearts hydrate client-side from the
// shared store), but this route still renders per-request BY DESIGN: the
// server-side category filter reads `searchParams`, which is request-time
// data — an ISR `revalidate` would be inert. The win over the old version is
// the dropped session + wishlist queries on every anonymous hit.

export default async function ShopPage({
  searchParams,
}: {
  // Next 15 streams searchParams as a Promise — the active filter is the slug.
  searchParams: Promise<{ category?: string; page?: string | string[] }>;
}) {
  // One instant drives every promotion filter + evaluation this request.
  const now = new Date();

  // Active category slug from the URL (?category=slug). Absent ⇒ "All Products".
  const { category: categoryParam, page: pageParam } = await searchParams;
  // ?page= — /shop is already dynamic (it reads searchParams), so query-string
  // pagination costs nothing here. A bad page → 404, never a silent clamp.
  const page = parsePageParam(pageParam);
  if (page === null) notFound();

  // Server-side category filtering: narrow by slug when one is present, so
  // the grid only ever ships the products it renders (LCP scales with the
  // page size, not the whole catalog).
  const productWhere = {
    ...LISTABLE_PRODUCT,
    ...(categoryParam ? { category: { slug: categoryParam } } : {}),
  };

  // Run all queries concurrently.
  const [categories, total, products] = await Promise.all([
    prisma.category.findMany({
      orderBy: { name: "asc" },
      select: { name: true, slug: true },
    }),
    prisma.product.count({ where: productWhere }),
    prisma.product.findMany({
      where: productWhere,
      // The shared card include: category name + the four-level live
      // promotion hierarchy; [0] = the starting (lowest) available variant.
      include: productCardInclude(now),
      // `id` tie-break: products sharing a createdAt keep a stable page order.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...pageSlice(page, STOREFRONT_PAGE_SIZE),
    }),
  ]);

  const info = pageInfo(page, STOREFRONT_PAGE_SIZE, total);
  if (isPageOutOfRange(info)) notFound();

  // Priced through the one card chain (product-cards.ts) — the math lives
  // only in discounts.ts.
  const mappedProducts: ShopProduct[] = products.map((product) => toProductCard(product, now));

  return (
    <ShopClient
      categories={categories}
      products={mappedProducts}
      total={total}
      pagination={
        <Pagination
          info={info}
          mode={{ kind: "query", base: "/shop", params: { category: categoryParam } }}
        />
      }
    />
  );
}
