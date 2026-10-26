// ─────────────────────────────────────────────────────────────────────────────
// /shop filters & sort — the pure half of the engine (src/lib/shop-filters.ts
// + `shopFiltersSchema` in validators).
//
// The promises pinned here:
//   • JUNK IS IGNORED — every param fails soft; a hand-edited URL never throws
//     and never empties the page by accident (unknown slugs are dropped).
//   • ONE URL PER STATE — `shopHref` omits defaults, never emits `page`, and is
//     the preset link the ISR listings hand off with.
//   • FINAL PRICE — sale / min / max and the price sorts compare the card's
//     discounted price, never the base price.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import type { ShopProduct } from "@/components/ProductCard";
import {
  clearedShopFilters,
  DEFAULT_SHOP_FILTERS,
  filterAndSortShopEntries,
  hasActiveFilters,
  isOnSale,
  needsPricing,
  parseShopFilters,
  resolveShopFilters,
  shopHref,
  toShopQuery,
  type PricedShopEntry,
} from "@/lib/shop-filters";
import { SHOP_MAX_CATEGORIES, SHOP_PRICE_MAX } from "@/lib/validators";

describe("parseShopFilters — the soft schema", () => {
  it("reads every param", () => {
    expect(
      parseShopFilters({
        category: ["cakes", "oriental-sweets"],
        collection: "eid",
        sale: "1",
        min: "50",
        max: "500.5",
        sort: "price-asc",
      }),
    ).toEqual({
      category: ["cakes", "oriental-sweets"],
      collection: "eid",
      sale: true,
      min: 50,
      max: 500.5,
      sort: "price-asc",
    });
  });

  it("defaults an empty query", () => {
    expect(parseShopFilters({})).toEqual(DEFAULT_SHOP_FILTERS);
    expect(parseShopFilters(undefined)).toEqual(DEFAULT_SHOP_FILTERS);
  });

  it("ignores junk field by field — the valid rest still applies", () => {
    expect(
      parseShopFilters({
        category: ["cakes", "Not A Slug", "../etc", "", 42],
        collection: "<script>",
        sale: "yes",
        min: "-5",
        max: "abc",
        sort: "cheapest",
        page: "2",
        utm_source: "x",
      }),
    ).toEqual({ ...DEFAULT_SHOP_FILTERS, category: ["cakes"] });
  });

  it("rejects price formats it can't read as EGP", () => {
    for (const bad of ["1e3", "0x10", "12.345", " ", "Infinity", "NaN", String(SHOP_PRICE_MAX + 1)]) {
      expect(parseShopFilters({ min: bad }).min).toBeUndefined();
    }
    expect(parseShopFilters({ min: "0" }).min).toBe(0);
    expect(parseShopFilters({ max: String(SHOP_PRICE_MAX) }).max).toBe(SHOP_PRICE_MAX);
  });

  it("reads the swapped range when min > max", () => {
    const f = parseShopFilters({ min: "500", max: "100" });
    expect([f.min, f.max]).toEqual([100, 500]);
  });

  it("takes the first value of a repeated scalar, de-dupes and caps categories", () => {
    const many = Array.from({ length: SHOP_MAX_CATEGORIES + 5 }, (_, i) => `c-${i}`);
    const f = parseShopFilters({ sort: ["newest", "price-asc"], sale: ["1", "0"], category: [...many, "c-0"] });
    expect(f.sort).toBe("newest");
    expect(f.sale).toBe(true);
    expect(f.category).toHaveLength(SHOP_MAX_CATEGORIES);
    expect(new Set(f.category).size).toBe(SHOP_MAX_CATEGORIES);
  });

  it("never throws, whatever arrives", () => {
    for (const raw of [null, 7, "category=cakes", [], { category: { nested: true } }, { sort: {} }]) {
      expect(() => parseShopFilters(raw)).not.toThrow();
    }
  });
});

describe("resolveShopFilters", () => {
  const facets = {
    categories: [{ name: "Cakes", slug: "cakes" }],
    collections: [{ name: "Eid", slug: "eid" }],
  };

  it("drops a category or collection that doesn't exist (or is a draft)", () => {
    const f = resolveShopFilters(
      { ...DEFAULT_SHOP_FILTERS, category: ["cakes", "gone"], collection: "draft-one" },
      facets,
    );
    expect(f.category).toEqual(["cakes"]);
    expect(f.collection).toBeUndefined();
  });
});

describe("shopHref — one URL per state, and the ISR preset links", () => {
  it("presets a category page's context", () => {
    expect(shopHref({ ...DEFAULT_SHOP_FILTERS, category: ["oriental-sweets"], sale: true })).toBe(
      "/shop?category=oriental-sweets&sale=1",
    );
  });

  it("presets a collection page and new arrivals", () => {
    expect(shopHref({ ...DEFAULT_SHOP_FILTERS, collection: "eid-specials" })).toBe(
      "/shop?collection=eid-specials",
    );
    expect(shopHref({ ...DEFAULT_SHOP_FILTERS, sort: "newest" })).toBe("/shop?sort=newest");
  });

  it("repeats category for a multi-select and omits every default", () => {
    expect(shopHref(DEFAULT_SHOP_FILTERS)).toBe("/shop");
    expect(
      shopHref({ ...DEFAULT_SHOP_FILTERS, category: ["a", "b"], min: 10, max: 99.5, sort: "price-desc" }),
    ).toBe("/shop?category=a&category=b&min=10&max=99.5&sort=price-desc");
  });

  it("round-trips through the parser", () => {
    const f = { ...DEFAULT_SHOP_FILTERS, category: ["a", "b"], collection: "c", sale: true, min: 5, max: 50 };
    const params = new URL(shopHref(f), "http://x").searchParams;
    expect(parseShopFilters({ ...Object.fromEntries(params), category: params.getAll("category") })).toEqual(f);
    expect(parseShopFilters(toShopQuery(f))).toEqual(f);
  });

  it("never carries a page — a filter change starts on page 1", () => {
    expect(shopHref(parseShopFilters({ category: "cakes", page: "3" }))).toBe("/shop?category=cakes");
  });
});

describe("hasActiveFilters / clearedShopFilters / needsPricing", () => {
  it("treats sort as an ordering, not a filter", () => {
    expect(hasActiveFilters({ ...DEFAULT_SHOP_FILTERS, sort: "price-asc" })).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_SHOP_FILTERS, max: 100 })).toBe(true);
    expect(clearedShopFilters({ ...DEFAULT_SHOP_FILTERS, sale: true, sort: "newest" })).toEqual({
      ...DEFAULT_SHOP_FILTERS,
      sort: "newest",
    });
  });

  it("needs prices only for sale, bounds and the price sorts", () => {
    expect(needsPricing(DEFAULT_SHOP_FILTERS)).toBe(false);
    expect(needsPricing({ ...DEFAULT_SHOP_FILTERS, sort: "newest", category: ["a"], collection: "b" })).toBe(false);
    for (const patch of [{ sale: true }, { min: 1 }, { max: 1 }, { sort: "price-asc" as const }, { sort: "price-desc" as const }]) {
      expect(needsPricing({ ...DEFAULT_SHOP_FILTERS, ...patch })).toBe(true);
    }
  });
});

describe("filterAndSortShopEntries — on the FINAL price", () => {
  const card = (id: string, price: number, compareAtPrice: number | null = null): ShopProduct => ({
    id,
    variantId: `v-${id}`,
    name: id,
    slug: id,
    category: "Cakes",
    price,
    compareAtPrice,
    image: "/x.jpg",
  });
  const entry = (c: ShopProduct, day: number, isFeatured = false): PricedShopEntry => ({
    card: c,
    createdAt: new Date(Date.UTC(2026, 9, day)),
    isFeatured,
  });

  // "promo" is base 120 at 20% off → 96: it sorts and filters as 96, not 120.
  const entries = [
    entry(card("plain-100", 100), 1),
    entry(card("promo", 96, 120), 2),
    entry(card("plain-110", 110), 3, true),
    entry(card("manual-was", 80, 95), 4),
  ];
  const ids = (list: PricedShopEntry[]) => list.map((e) => e.card.id);

  it("sorts a discounted product by what it costs now", () => {
    expect(ids(filterAndSortShopEntries(entries, { ...DEFAULT_SHOP_FILTERS, sort: "price-asc" }))).toEqual([
      "manual-was",
      "promo",
      "plain-100",
      "plain-110",
    ]);
    expect(ids(filterAndSortShopEntries(entries, { ...DEFAULT_SHOP_FILTERS, sort: "price-desc" }))).toEqual([
      "plain-110",
      "plain-100",
      "promo",
      "manual-was",
    ]);
  });

  it("bounds are inclusive and read the final price", () => {
    // 100–120 on base prices would include "promo" (120); on final it's 96.
    expect(ids(filterAndSortShopEntries(entries, { ...DEFAULT_SHOP_FILTERS, min: 100, max: 120 }))).toEqual([
      "plain-110",
      "plain-100",
    ]);
    expect(ids(filterAndSortShopEntries(entries, { ...DEFAULT_SHOP_FILTERS, max: 96, sort: "price-asc" }))).toEqual([
      "manual-was",
      "promo",
    ]);
  });

  it("sale = the card shows a strikethrough (promotion or manual Compare-At)", () => {
    expect(ids(filterAndSortShopEntries(entries, { ...DEFAULT_SHOP_FILTERS, sale: true, sort: "newest" }))).toEqual([
      "manual-was",
      "promo",
    ]);
    expect(isOnSale({ price: 50, compareAtPrice: 50 })).toBe(false);
    expect(isOnSale({ price: 50, compareAtPrice: null })).toBe(false);
  });

  it("featured leads, then newest; ties fall back to newest", () => {
    expect(ids(filterAndSortShopEntries(entries, DEFAULT_SHOP_FILTERS))).toEqual([
      "plain-110",
      "manual-was",
      "promo",
      "plain-100",
    ]);
    const tied = [entry(card("a", 50), 5), entry(card("b", 50), 5), entry(card("c", 50), 6)];
    expect(ids(filterAndSortShopEntries(tied, { ...DEFAULT_SHOP_FILTERS, sort: "price-asc" }))).toEqual(["c", "b", "a"]);
  });

  it("doesn't mutate its input", () => {
    const before = ids(entries);
    filterAndSortShopEntries(entries, { ...DEFAULT_SHOP_FILTERS, sort: "price-asc" });
    expect(ids(entries)).toEqual(before);
  });
});
