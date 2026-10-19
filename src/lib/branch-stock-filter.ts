import { normalizeSearchQuery, searchTokens, SEARCH_MAX_QUERY_LENGTH } from "@/lib/validators";

/**
 * Search + stock filtering for the /admin/inventory list.
 *
 * Pure and dependency-free so it's unit-testable and runs server-side over the
 * branch's active catalog — the page loads that set in full anyway (the tab
 * counters need every variant), so one in-memory pass is the whole query
 * rather than a second, divergent `where`. State arrives from the URL
 * (`?q=` / `?stock=`), never from client state.
 */

export const STOCK_FILTERS = ["all", "in", "out"] as const;
export type StockFilter = (typeof STOCK_FILTERS)[number];

/** Validate `?stock=` against the real values — never trust the raw string. */
export function parseStockFilter(raw: string | undefined): StockFilter {
  return STOCK_FILTERS.includes(raw as StockFilter) ? (raw as StockFilter) : "all";
}

/** `?q=`, in the storefront search's canonical form (same LIKE-safe normalization, same cap). */
export function parseStockQuery(raw: string | undefined): string {
  return normalizeSearchQuery(raw ?? "").slice(0, SEARCH_MAX_QUERY_LENGTH);
}

type StockVariant = { name: string; sku: string | null; inStock: boolean };
type StockProduct = {
  name: string;
  category: { name: string };
  variants: StockVariant[];
};

export type StockCounts = Record<StockFilter, number>;

/**
 * Narrow the catalog to what the manager asked for.
 *
 *   - A VARIANT matches the search when every word appears somewhere in its
 *     product name, category name, variant name or SKU (case-insensitive). So
 *     "kunafa" keeps every size, "kunafa small" or a SKU keeps just that line.
 *   - `counts` are variant counts AFTER the search but BEFORE the stock tab —
 *     each tab shows what clicking it would list.
 *
 * Each surviving product keeps its full `variants` (the whole-product button
 * acts on all of them) and gains `matches`, the variants to render. Products
 * with no matches are dropped.
 */
export function filterBranchStock<P extends StockProduct>(
  products: P[],
  { query, stock }: { query: string; stock: StockFilter },
): { products: (P & { matches: P["variants"] })[]; counts: StockCounts } {
  type V = P["variants"][number];
  const tokens = searchTokens(query.toLowerCase());
  const counts: StockCounts = { all: 0, in: 0, out: 0 };
  const result: (P & { matches: V[] })[] = [];

  for (const product of products) {
    const matches: V[] = [];
    for (const variant of product.variants) {
      if (tokens.length > 0) {
        const haystack = [product.name, product.category.name, variant.name, variant.sku ?? ""]
          .join(" ")
          .toLowerCase();
        if (!tokens.every((token) => haystack.includes(token))) continue;
      }

      counts.all += 1;
      counts[variant.inStock ? "in" : "out"] += 1;

      if (stock === "all" || (stock === "in") === variant.inStock) matches.push(variant);
    }
    if (matches.length > 0) result.push({ ...product, matches });
  }

  return { products: result, counts };
}
