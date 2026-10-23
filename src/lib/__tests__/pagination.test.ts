// ─────────────────────────────────────────────────────────────────────────────
// Pagination — unit suite (src/lib/pagination.ts), the one paginator every
// list on the site shares. Pins the URL contract: one canonical URL per page,
// strict page parsing (bad input → notFound, never a silent clamp), and the
// path-vs-query split that keeps ISR routes cacheable.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  isPageOutOfRange,
  pageHref,
  pageInfo,
  pageSlice,
  pageWindow,
  parsePageParam,
  STOREFRONT_PAGE_SIZE,
} from "@/lib/pagination";

describe("parsePageParam", () => {
  it("defaults an absent page to 1", () => {
    expect(parsePageParam(undefined)).toBe(1);
    expect(parsePageParam(null)).toBe(1);
  });

  it.each([["1", 1], ["2", 2], ["40", 40]])("parses %s", (raw, n) => {
    expect(parsePageParam(raw)).toBe(n);
  });

  it.each(["0", "-1", "1.5", "01", "abc", "", "2a", "9999999"])("rejects %s", (raw) => {
    expect(parsePageParam(raw)).toBeNull();
  });

  it("rejects a repeated param (?page=2&page=3)", () => {
    expect(parsePageParam(["2", "3"])).toBeNull();
  });
});

describe("pageInfo / isPageOutOfRange / pageSlice", () => {
  it("counts pages, with one (empty) page for an empty list", () => {
    expect(pageInfo(1, 24, 0).totalPages).toBe(1);
    expect(pageInfo(1, 24, 24).totalPages).toBe(1);
    expect(pageInfo(1, 24, 25).totalPages).toBe(2);
  });

  it("flags a page past the end", () => {
    expect(isPageOutOfRange(pageInfo(3, 24, 48))).toBe(true);
    expect(isPageOutOfRange(pageInfo(2, 24, 48))).toBe(false);
    expect(isPageOutOfRange(pageInfo(1, 24, 0))).toBe(false); // empty page 1 is fine
  });

  it("windows the query", () => {
    expect(pageSlice(1, STOREFRONT_PAGE_SIZE)).toEqual({ skip: 0, take: 24 });
    expect(pageSlice(3, 25)).toEqual({ skip: 50, take: 25 });
  });
});

describe("pageHref", () => {
  const path = { kind: "path", base: "/category/cakes" } as const;

  it("path mode: page 1 is the bare base, others a /page/n segment", () => {
    expect(pageHref(path, 1)).toBe("/category/cakes");
    expect(pageHref(path, 2)).toBe("/category/cakes/page/2");
  });

  it("query mode: keeps other params, omits page=1 and empty params", () => {
    const mode = { kind: "query", base: "/shop", params: { category: "cakes", q: undefined } } as const;
    expect(pageHref(mode, 1)).toBe("/shop?category=cakes");
    expect(pageHref(mode, 3)).toBe("/shop?category=cakes&page=3");
    expect(pageHref({ kind: "query", base: "/wishlist" }, 1)).toBe("/wishlist");
  });
});

describe("pageWindow", () => {
  it("shows every page when there are few", () => {
    expect(pageWindow(2, 4)).toEqual([1, 2, 3, 4]);
  });

  it("elides the gaps around the current page", () => {
    expect(pageWindow(6, 12)).toEqual([1, null, 5, 6, 7, null, 12]);
    expect(pageWindow(1, 12)).toEqual([1, 2, null, 12]);
    expect(pageWindow(12, 12)).toEqual([1, null, 11, 12]);
  });
});
