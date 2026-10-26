import { notFound } from "next/navigation";
import Pagination from "@/components/Pagination";
import {
  isPageOutOfRange,
  pageInfo,
  parsePageParam,
  STOREFRONT_PAGE_SIZE,
} from "@/lib/pagination";
import { getShopFacets, getShopListing } from "@/lib/shop-catalog";
import { parseShopFilters, resolveShopFilters, toShopQuery } from "@/lib/shop-filters";
import ShopClient, { type ShopHeading } from "./ShopClient";

// No per-user data here (wishlist hearts hydrate client-side from the shared
// store), but this route renders per-request BY DESIGN: filters & sort read
// `searchParams`, which is request-time data — an ISR `revalidate` would be
// inert. It is the ONE filtered surface: the ISR listings (category,
// collection, new arrivals) link here with their context preset instead of
// reading the query string themselves.

export default async function ShopPage({
  searchParams,
}: {
  // Next 15+ streams searchParams as a Promise. Repeated keys arrive as arrays.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // One instant drives every promotion filter + evaluation this request.
  const now = new Date();
  const params = await searchParams;

  // ?page= stays strict: a bad page → 404, never a silent clamp. Every other
  // param is soft — junk is ignored, never a 500.
  const page = parsePageParam(params.page);
  if (page === null) notFound();

  // Unknown categories and missing/draft collections are dropped, so a stale
  // link widens the result instead of emptying it.
  const facets = await getShopFacets();
  const filters = resolveShopFilters(parseShopFilters(params), facets);

  // Priced through the one card chain (product-cards.ts); sale / price bounds
  // and the price sorts run on the FINAL discounted price (shop-catalog.ts).
  const { cards, total } = await getShopListing(filters, page, now);

  const info = pageInfo(page, STOREFRONT_PAGE_SIZE, total);
  if (isPageOutOfRange(info)) notFound();

  // Exactly one category, or exactly one collection → it names the page.
  const onlyCategory =
    filters.category.length === 1 && !filters.collection
      ? facets.categories.find((c) => c.slug === filters.category[0])
      : undefined;
  const onlyCollection =
    filters.collection && filters.category.length === 0
      ? facets.collections.find((c) => c.slug === filters.collection)
      : undefined;
  const heading: ShopHeading | null = onlyCategory
    ? { kind: "Category", name: onlyCategory.name, href: `/category/${onlyCategory.slug}` }
    : onlyCollection
      ? { kind: "Collection", name: onlyCollection.name, href: `/collections/${onlyCollection.slug}` }
      : null;

  return (
    <ShopClient
      facets={facets}
      filters={filters}
      products={cards}
      total={total}
      heading={heading}
      pagination={
        <Pagination info={info} mode={{ kind: "query", base: "/shop", params: toShopQuery(filters) }} />
      }
    />
  );
}
