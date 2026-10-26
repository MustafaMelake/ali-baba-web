// ─────────────────────────────────────────────────────────────────────────────
// /shop catalog reads — src/lib/shop-catalog.ts + the countShopProducts action.
//
// Pins the Prisma half of the filter engine:
//   • WHERE — listable only; category slugs `in`; a collection matches only
//     while ACTIVE.
//   • FAST PATH — price-free filters let Postgres order, count and paginate.
//   • PRICED PATH — every match is priced through the REAL card chain
//     (`toProductCard`: promotions from the category level included, ONE
//     `now`), filtered and sorted on the FINAL price, THEN paginated.
//   • COUNT — the sheet's live count resolves slugs like the page and fails
//     to the envelope, never a throw.
//
// MOCKING — only @/lib/prisma (deep); validators, the Discount Engine and the
// card mapper run for real.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));

import { countShopListing, getShopListing, shopProductWhere } from "@/lib/shop-catalog";
import { countShopProducts } from "@/lib/actions/shop";
import { DEFAULT_SHOP_FILTERS } from "@/lib/shop-filters";
import { LISTABLE_PRODUCT } from "@/lib/catalog";
import { STOREFRONT_PAGE_SIZE } from "@/lib/pagination";
import { DiscountType } from "@/generated/prisma/enums";

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>;
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

const NOW = new Date("2026-10-26T10:00:00.000Z");
const dec = (n: number) => ({ toNumber: () => n });
const twentyOff = {
  id: "promo-20",
  name: "Twenty off",
  type: DiscountType.PERCENTAGE,
  value: dec(20),
  startDate: new Date("2026-10-01T00:00:00.000Z"),
  endDate: new Date("2026-10-31T00:00:00.000Z"),
  isActive: true,
};

/** A row shaped like `productCardInclude(now)` returns it. */
function row(
  id: string,
  price: number,
  opts: { day?: number; featured?: boolean; categoryPromo?: boolean } = {},
) {
  return {
    id,
    name: id,
    slug: id,
    description: null,
    images: [`/${id}.jpg`],
    isAvailable: true,
    isFeatured: opts.featured ?? false,
    categoryId: "cat",
    createdAt: new Date(Date.UTC(2026, 9, opts.day ?? 1)),
    updatedAt: new Date(Date.UTC(2026, 9, 1)),
    category: { name: "Cakes", promotions: opts.categoryPromo ? [twentyOff] : [] },
    promotions: [],
    collections: [],
    variants: [{ id: `v-${id}`, price: dec(price), compareAtPrice: null, promotions: [] }],
  };
}

const findMany = () => mockPrisma.product.findMany as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockReset(mockPrisma);
  consoleError.mockClear();
});

describe("shopProductWhere", () => {
  it("is listable-only and narrows by category slugs and an ACTIVE collection", () => {
    expect(shopProductWhere(DEFAULT_SHOP_FILTERS)).toEqual(LISTABLE_PRODUCT);
    expect(
      shopProductWhere({ ...DEFAULT_SHOP_FILTERS, category: ["cakes", "sweets"], collection: "eid" }),
    ).toEqual({
      ...LISTABLE_PRODUCT,
      category: { slug: { in: ["cakes", "sweets"] } },
      collections: { some: { collection: { slug: "eid", isActive: true } } },
    });
  });
});

describe("getShopListing — fast path (no price needed)", () => {
  it("lets Postgres order featured-first, count and paginate", async () => {
    mockPrisma.product.count.mockResolvedValue(30);
    findMany().mockResolvedValue([row("a", 100)]);

    const { cards, total } = await getShopListing(DEFAULT_SHOP_FILTERS, 2, NOW);

    expect(total).toBe(30);
    expect(cards.map((c) => c.id)).toEqual(["a"]);
    const args = findMany().mock.calls[0][0];
    expect(args.orderBy).toEqual([{ isFeatured: "desc" }, { createdAt: "desc" }, { id: "desc" }]);
    expect(args).toMatchObject({ skip: STOREFRONT_PAGE_SIZE, take: STOREFRONT_PAGE_SIZE });
  });

  it("orders newest without the featured key", async () => {
    mockPrisma.product.count.mockResolvedValue(0);
    findMany().mockResolvedValue([]);
    await getShopListing({ ...DEFAULT_SHOP_FILTERS, sort: "newest" }, 1, NOW);
    expect(findMany().mock.calls[0][0].orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });
});

describe("getShopListing — priced path", () => {
  it("sorts a 20%-off product by its FINAL price (base 120 → 96 sorts under 100)", async () => {
    findMany().mockResolvedValue([
      row("plain-100", 100),
      row("promo-120", 120, { categoryPromo: true }),
      row("plain-110", 110),
    ]);

    const { cards, total } = await getShopListing({ ...DEFAULT_SHOP_FILTERS, sort: "price-asc" }, 1, NOW);

    expect(cards.map((c) => [c.id, c.price])).toEqual([
      ["promo-120", 96],
      ["plain-100", 100],
      ["plain-110", 110],
    ]);
    expect(total).toBe(3);
    // Everything matching is priced first: no skip/take reaches Postgres.
    const args = findMany().mock.calls[0][0];
    expect(args.skip).toBeUndefined();
    expect(args.take).toBeUndefined();
    expect(mockPrisma.product.count).not.toHaveBeenCalled();
  });

  it("prices with the caller's ONE instant", async () => {
    findMany().mockResolvedValue([]);
    await getShopListing({ ...DEFAULT_SHOP_FILTERS, sale: true }, 1, NOW);
    const include = findMany().mock.calls[0][0].include;
    expect(include.promotions.where.startDate).toEqual({ lte: NOW });
    expect(include.category.select.promotions.where.endDate).toEqual({ gte: NOW });
  });

  it("filters on the final price, THEN paginates (total counts the filtered set)", async () => {
    // 40 products 10..49 EGP; 20% off every odd one. "max 30" keeps the 21
    // under 30 at full price (10..30) plus the odd ones from 31..37 (→ 24.8..29.6).
    const rows = Array.from({ length: 40 }, (_, i) =>
      row(`p${String(i).padStart(2, "0")}`, 10 + i, { day: 1 + (i % 20), categoryPromo: i % 2 === 1 }),
    );
    findMany().mockResolvedValue(rows);
    const filters = { ...DEFAULT_SHOP_FILTERS, max: 30, sort: "price-asc" as const };

    const page1 = await getShopListing(filters, 1, NOW);
    const page2 = await getShopListing(filters, 2, NOW);

    const expected = rows
      .map((r, i) => (i % 2 === 1 ? Math.round((10 + i) * 0.8 * 100) / 100 : 10 + i))
      .filter((p) => p <= 30);
    expect(page1.total).toBe(expected.length);
    expect(page2.total).toBe(expected.length);
    expect(page1.cards).toHaveLength(STOREFRONT_PAGE_SIZE);
    expect(page2.cards).toHaveLength(expected.length - STOREFRONT_PAGE_SIZE);
    const prices = [...page1.cards, ...page2.cards].map((c) => c.price);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(Math.max(...prices)).toBeLessThanOrEqual(30);
  });

  it("keeps only cards with a strikethrough for sale=1", async () => {
    findMany().mockResolvedValue([row("plain", 100), row("promo", 120, { categoryPromo: true })]);
    const { cards } = await getShopListing({ ...DEFAULT_SHOP_FILTERS, sale: true }, 1, NOW);
    expect(cards.map((c) => [c.id, c.price, c.compareAtPrice])).toEqual([["promo", 96, 120]]);
  });
});

describe("countShopListing", () => {
  it("counts in Postgres when no price is needed, after pricing otherwise", async () => {
    mockPrisma.product.count.mockResolvedValue(12);
    expect(await countShopListing({ ...DEFAULT_SHOP_FILTERS, category: ["cakes"] }, NOW)).toBe(12);

    findMany().mockResolvedValue([row("a", 50), row("b", 150)]);
    expect(await countShopListing({ ...DEFAULT_SHOP_FILTERS, min: 100 }, NOW)).toBe(1);
  });
});

describe("countShopProducts (public action)", () => {
  beforeEach(() => {
    (mockPrisma.category.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: "Cakes", slug: "cakes" },
    ]);
    (mockPrisma.collection.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it("parses the sheet's query like the page and drops unknown slugs", async () => {
    mockPrisma.product.count.mockResolvedValue(7);
    const result = await countShopProducts({ category: ["cakes", "ghost"], collection: "draft", sort: "bogus" });
    expect(result).toEqual({ success: true, count: 7 });
    expect(mockPrisma.product.count).toHaveBeenCalledWith({
      where: { ...LISTABLE_PRODUCT, category: { slug: { in: ["cakes"] } } },
    });
  });

  it("returns the envelope on a database failure", async () => {
    mockPrisma.product.count.mockRejectedValue(new Error("ETIMEDOUT"));
    expect(await countShopProducts({})).toEqual({ success: false, error: "Couldn't count products right now." });
    expect(consoleError).toHaveBeenCalled();
  });
});
