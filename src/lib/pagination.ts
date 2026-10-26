// ─────────────────────────────────────────────────────────────────────────────
// Pagination — the one shared paginator for every list on the site.
//
// Pure (no Prisma, no React): parse the page from the URL, turn it into a
// `skip`/`take`, decide out-of-range, and build page hrefs. Two URL shapes:
//
//   • "path"  — /category/cakes, /category/cakes/page/2. ISR routes (category,
//     collection, new arrivals) MUST paginate by path segment: reading
//     `searchParams` would make them dynamic (frontend.md caching table).
//     Page 1 lives at the bare base path only; /page/1 redirects there.
//   • "query" — ?page=2 next to other params. For routes that are already
//     dynamic (/shop, /wishlist, /my-orders, the admin lists).
//
// Offset pagination (skip/take) is deliberate here: these lists are numbered
// pages a shopper can jump between, and the catalog is small. The admin orders
// board keeps its cursor pagination (it's the one list that grows unbounded).
// ─────────────────────────────────────────────────────────────────────────────

/** Products per storefront page — divisible by 2, 3 and 4 (every grid width). */
export const STOREFRONT_PAGE_SIZE = 24;
/** Rows per admin list page. */
export const ADMIN_PAGE_SIZE = 25;

/**
 * The page a URL asks for. Absent → 1. A canonical positive integer ("2") →
 * that number. Anything else ("0", "-1", "1.5", "01", "abc", ["2","3"]) → null,
 * which callers answer with notFound() — no silent clamping, no duplicate URLs.
 */
export function parsePageParam(raw: string | string[] | null | undefined): number | null {
  if (raw === undefined || raw === null) return 1;
  if (typeof raw !== "string" || !/^[1-9]\d{0,5}$/.test(raw)) return null;
  return Number(raw);
}

export type PageInfo = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

/** Page metadata for `total` rows. An empty list still has one (empty) page. */
export function pageInfo(page: number, pageSize: number, total: number): PageInfo {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** True when `page` is past the last page — the caller's cue for notFound(). */
export function isPageOutOfRange(info: PageInfo): boolean {
  return info.page > info.totalPages;
}

/** The Prisma window for a page. */
export function pageSlice(page: number, pageSize: number): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export type PageHrefMode =
  | { kind: "path"; base: string }
  | { kind: "query"; base: string; params?: Record<string, string | string[] | undefined> };

/** The URL of page `page`. Page 1 is always the bare base (one canonical URL). */
export function pageHref(mode: PageHrefMode, page: number): string {
  if (mode.kind === "path") return page <= 1 ? mode.base : `${mode.base}/page/${page}`;

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(mode.params ?? {})) {
    // An array repeats the key (/shop?category=a&category=b).
    for (const v of Array.isArray(value) ? value : [value]) if (v) search.append(key, v);
  }
  if (page > 1) search.set("page", String(page));
  const qs = search.toString();
  return qs ? `${mode.base}?${qs}` : mode.base;
}

/**
 * The page numbers to show: always the first and last, the current page and
 * its neighbours, with `null` where a gap is elided ("1 … 4 5 6 … 12").
 */
export function pageWindow(page: number, totalPages: number): (number | null)[] {
  const keep = new Set([1, totalPages, page - 1, page, page + 1]);
  const out: (number | null)[] = [];
  for (let n = 1; n <= totalPages; n++) {
    if (!keep.has(n)) continue;
    const prev = out[out.length - 1];
    if (typeof prev === "number" && n - prev > 1) out.push(null);
    out.push(n);
  }
  return out;
}
