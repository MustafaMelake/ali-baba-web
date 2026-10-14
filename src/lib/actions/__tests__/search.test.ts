// ─────────────────────────────────────────────────────────────────────────────
// Storefront search — unit/integration suite (src/lib/actions/search.ts).
//
// The search palette's two PUBLIC reads. These tests pin:
//
//   • VALIDATION — the shared searchQuerySchema gate: short, blank, over-long
//     and wildcard-only queries never reach Prisma; LIKE metacharacters are
//     stripped so matching stays literal.
//   • QUERY SHAPE — every word must match (one ILIKE per word), only listable
//     products/categories are searched, and the secondary query excludes the
//     primary name matches so the two sets never overlap.
//   • RELEVANCE — name prefix > word prefix > mid-word name match > secondary
//     (description / category) match, capped per group.
//   • PRICING — hits run through the REAL Discount Engine against ONE `now`,
//     with the standard strikethrough fallback; Decimals leave as numbers.
//   • FAILURE — a Prisma error becomes the generic envelope, never a throw.
//
// MOCKING — same strategy as faqs.test.ts / orders.test.ts: only @/lib/prisma
// is mocked (deep); validators and the Discount Engine run for real. Every
// assertion targets the EXACT payload sent to Prisma or the exact envelope.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));

import { getSearchSuggestions, searchCatalog } from "@/lib/actions/search";
import { normalizeSearchQuery, searchTokens } from "@/lib/validators";
import { DiscountType } from "@/generated/prisma/enums";
import type { PromotionLike } from "@/lib/discounts";

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>;

// Failures are logged via console.error — silence it.
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** A Prisma-`Decimal`-like stand-in: money columns come back as objects. */
const decimalLike = (n: number) => ({ toNumber: () => n });

/** Always-live window so promos are live against the real `new Date()`. */
const LIVE_WINDOW = {
  startDate: new Date("2000-01-01T00:00:00.000Z"),
  endDate: new Date("2999-12-31T23:59:59.999Z"),
};

function livePromo(overrides: Partial<PromotionLike> & Pick<PromotionLike, "value">): PromotionLike {
  return {
    id: "promo-1",
    name: "Promo",
    type: DiscountType.PERCENTAGE,
    isActive: true,
    ...LIVE_WINDOW,
    ...overrides,
  };
}

const LISTABLE = { isAvailable: true, variants: { some: { isAvailable: true } } };

/** One product row in the shape `hitSelect` returns. */
function productRow(o: {
  name: string;
  price?: number;
  compareAtPrice?: number | null;
  category?: string;
  images?: string[];
  variantPromos?: PromotionLike[];
  productPromos?: PromotionLike[];
  categoryPromos?: PromotionLike[];
}) {
  const id = o.name.toLowerCase().replace(/\s+/g, "-");
  return {
    id,
    name: o.name,
    slug: id,
    images: o.images ?? [`https://utfs.io/f/${id}.jpg`],
    category: { name: o.category ?? "Cakes", promotions: o.categoryPromos ?? [] },
    promotions: o.productPromos ?? [],
    variants: [
      {
        price: decimalLike(o.price ?? 100),
        compareAtPrice: o.compareAtPrice == null ? null : decimalLike(o.compareAtPrice),
        promotions: o.variantPromos ?? [],
      },
    ],
  };
}

/** One category row in the shape CATEGORY_HIT_SELECT (+ slider fields) returns. */
function categoryRow(o: {
  name: string;
  count?: number;
  image?: string | null;
  isFeatured?: boolean;
  sliderOrder?: number;
}) {
  const id = o.name.toLowerCase().replace(/\s+/g, "-");
  return {
    id,
    name: o.name,
    slug: id,
    image: o.image ?? null,
    isFeatured: o.isFeatured ?? false,
    sliderOrder: o.sliderOrder ?? 0,
    _count: { products: o.count ?? 1 },
  };
}

/**
 * Seed both product reads + the category read. The secondary product query is
 * the one carrying `NOT` (it excludes the name matches), so route on that.
 */
function stubSearch(rows: {
  nameRows?: ReturnType<typeof productRow>[];
  otherRows?: ReturnType<typeof productRow>[];
  categoryRows?: ReturnType<typeof categoryRow>[];
}) {
  mockPrisma.product.findMany.mockImplementation(((args: { where?: { NOT?: unknown } }) =>
    Promise.resolve(args.where?.NOT ? (rows.otherRows ?? []) : (rows.nameRows ?? []))) as never);
  mockPrisma.category.findMany.mockResolvedValue((rows.categoryRows ?? []) as never);
}

/** The args of every product.findMany call, in call order (primary first). */
const productCalls = () => mockPrisma.product.findMany.mock.calls.map(([args]) => args as any);

beforeEach(() => {
  mockReset(mockPrisma);
  consoleError.mockClear();
  stubSearch({});
});

afterAll(() => {
  vi.restoreAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════════
// Shared query normalization (validators.ts) — the client gates on the same fn
// ═════════════════════════════════════════════════════════════════════════════

describe("normalizeSearchQuery / searchTokens", () => {
  it("trims and collapses internal whitespace", () => {
    expect(normalizeSearchQuery("  choc   cake \n")).toBe("choc cake");
  });

  it("strips the LIKE metacharacters % _ and \\ so matching stays literal", () => {
    expect(normalizeSearchQuery("50%_off\\")).toBe("50off");
    expect(normalizeSearchQuery("%%__")).toBe("");
  });

  it("splits into words and caps the word count", () => {
    expect(searchTokens("a b c d e f g")).toEqual(["a", "b", "c", "d", "e"]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// searchCatalog — validation (nothing invalid reaches Prisma)
// ═════════════════════════════════════════════════════════════════════════════

describe("searchCatalog — validation", () => {
  it.each(["", "a", "   ", "%_", " c "])("rejects %j without querying", async (query) => {
    const result = await searchCatalog(query);

    expect(result).toEqual({
      success: false,
      error: "Type at least 2 characters to search.",
    });
    expect(mockPrisma.product.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.category.findMany).not.toHaveBeenCalled();
  });

  it("rejects an over-long query", async () => {
    const result = await searchCatalog("x".repeat(65));

    expect(result).toEqual({ success: false, error: "That search is too long." });
    expect(mockPrisma.product.findMany).not.toHaveBeenCalled();
  });

  it("rejects a non-string payload (the client is never trusted)", async () => {
    const result = await searchCatalog(42 as never);

    expect(result.success).toBe(false);
    expect(mockPrisma.product.findMany).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// searchCatalog — query shape
// ═════════════════════════════════════════════════════════════════════════════

describe("searchCatalog — query shape", () => {
  it("primary query: every word in the NAME, listable products only", async () => {
    await searchCatalog("  Choc   Cake ");

    const [primary] = productCalls();
    expect(primary.where).toEqual({
      ...LISTABLE,
      AND: [
        { name: { contains: "Choc", mode: "insensitive" } },
        { name: { contains: "Cake", mode: "insensitive" } },
      ],
    });
    expect(primary.orderBy).toEqual({ name: "asc" });
  });

  it("secondary query: every word in name/description/category, minus the name matches", async () => {
    await searchCatalog("choc cake");

    const [, secondary] = productCalls();
    const perWord = (token: string) => ({
      OR: [
        { name: { contains: token, mode: "insensitive" } },
        { description: { contains: token, mode: "insensitive" } },
        { category: { name: { contains: token, mode: "insensitive" } } },
      ],
    });
    expect(secondary.where).toEqual({
      ...LISTABLE,
      AND: [perWord("choc"), perWord("cake")],
      NOT: {
        AND: [
          { name: { contains: "choc", mode: "insensitive" } },
          { name: { contains: "cake", mode: "insensitive" } },
        ],
      },
    });
    expect(secondary.take).toBe(6);
  });

  it("prices from the starting AVAILABLE variant only", async () => {
    await searchCatalog("cake");

    for (const call of productCalls()) {
      expect(call.select.variants).toEqual(
        expect.objectContaining({
          where: { isAvailable: true },
          orderBy: { price: "asc" },
          take: 1,
        }),
      );
      // The hit never ships the description.
      expect(call.select.description).toBeUndefined();
    }
  });

  it("filters every promotion level against ONE `now` per call", async () => {
    await searchCatalog("cake");

    const instants = productCalls().flatMap((call) => [
      call.select.promotions.where.startDate.lte,
      call.select.promotions.where.endDate.gte,
      call.select.category.select.promotions.where.startDate.lte,
      call.select.variants.select.promotions.where.endDate.gte,
    ]);
    expect(instants).toHaveLength(8);
    expect(new Set(instants).size).toBe(1); // the very same Date instance
  });

  it("category query: every word in the name, categories with listable products only", async () => {
    await searchCatalog("birthday cakes");

    const [args] = mockPrisma.category.findMany.mock.calls[0] as any[];
    expect(args.where).toEqual({
      AND: [
        { name: { contains: "birthday", mode: "insensitive" } },
        { name: { contains: "cakes", mode: "insensitive" } },
      ],
      products: { some: LISTABLE },
    });
    // The count shown on the hit is of LISTABLE products, not all rows.
    expect(args.select._count).toEqual({ select: { products: { where: LISTABLE } } });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// searchCatalog — relevance
// ═════════════════════════════════════════════════════════════════════════════

describe("searchCatalog — relevance", () => {
  it("ranks name prefix > word prefix > mid-word, then secondary matches, capped at 6", async () => {
    stubSearch({
      // Postgres hands name matches back alphabetically…
      nameRows: [
        productRow({ name: "Almond Cake" }),
        productRow({ name: "Cake Pops" }),
        productRow({ name: "Carrot Cake" }),
        productRow({ name: "Cupcakes" }),
      ],
      otherRows: [
        productRow({ name: "Black Forest" }),
        productRow({ name: "Chocolate Box" }),
        productRow({ name: "Date Bites" }),
      ],
    });

    const result = await searchCatalog("cake");

    if (!result.success) throw new Error(result.error);
    expect(result.data.products.map((p) => p.name)).toEqual([
      "Cake Pops", // name starts with the query
      "Almond Cake", // a word starts with it
      "Carrot Cake",
      "Cupcakes", // mid-word
      "Black Forest", // secondary (description / category)
      "Chocolate Box",
    ]);
  });

  it("ranks categories the same way, capped at 3, with listable counts", async () => {
    stubSearch({
      categoryRows: [
        categoryRow({ name: "Birthday Cakes", count: 4 }),
        categoryRow({ name: "Cakes", count: 12, image: "https://utfs.io/f/cakes.jpg" }),
        categoryRow({ name: "Cheesecakes", count: 2 }),
        categoryRow({ name: "Wedding Cakes", count: 3 }),
      ],
    });

    const result = await searchCatalog("cake");

    if (!result.success) throw new Error(result.error);
    expect(result.data.categories).toEqual([
      { id: "cakes", name: "Cakes", slug: "cakes", image: "https://utfs.io/f/cakes.jpg", productCount: 12 },
      { id: "birthday-cakes", name: "Birthday Cakes", slug: "birthday-cakes", image: null, productCount: 4 },
      { id: "wedding-cakes", name: "Wedding Cakes", slug: "wedding-cakes", image: null, productCount: 3 },
    ]);
  });

  it("echoes the NORMALIZED query the hits answer", async () => {
    const result = await searchCatalog("   Cake    Pops ");

    expect(result).toEqual({
      success: true,
      data: { query: "Cake Pops", products: [], categories: [] },
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// searchCatalog — pricing (the REAL Discount Engine runs)
// ═════════════════════════════════════════════════════════════════════════════

describe("searchCatalog — pricing", () => {
  async function priceOf(row: ReturnType<typeof productRow>) {
    stubSearch({ nameRows: [row] });
    const result = await searchCatalog("cake");
    if (!result.success) throw new Error(result.error);
    return result.data.products[0];
  }

  it("a live promotion discounts the price and strikes through the base", async () => {
    const hit = await priceOf(
      productRow({ name: "Cake", price: 200, categoryPromos: [livePromo({ value: 10 })] }),
    );

    expect(hit.price).toBe(180);
    expect(hit.compareAtPrice).toBe(200);
  });

  it("overlapping promotions never stack — the cheapest wins", async () => {
    const hit = await priceOf(
      productRow({
        name: "Cake",
        price: 200,
        variantPromos: [livePromo({ id: "pct", value: 10 })], // → 180
        productPromos: [livePromo({ id: "fixed", type: DiscountType.FIXED_AMOUNT, value: 50 })], // → 150
      }),
    );

    expect(hit.price).toBe(150);
    expect(hit.compareAtPrice).toBe(200);
  });

  it("without a live promotion, the manual Compare-At is the strikethrough (as a plain number)", async () => {
    const hit = await priceOf(productRow({ name: "Cake", price: 120, compareAtPrice: 150 }));

    expect(hit.price).toBe(120);
    expect(hit.compareAtPrice).toBe(150);
    expect(typeof hit.compareAtPrice).toBe("number");
  });

  it("re-checks liveness: an expired promotion that slipped through doesn't apply", async () => {
    const expired = livePromo({ value: 50, endDate: new Date("2001-01-01T00:00:00.000Z") });
    const hit = await priceOf(productRow({ name: "Cake", price: 100, productPromos: [expired] }));

    expect(hit.price).toBe(100);
    expect(hit.compareAtPrice).toBeNull();
  });

  it("prices against the SAME instant the promotions were filtered with", async () => {
    // A promo ending exactly at the request instant is live for the whole
    // call — even when the clock ticks while Postgres answers. Pricing with a
    // fresh `new Date()` instead of the call's `now` would drop the discount.
    const T = new Date("2026-10-14T12:00:00.000Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T);
    try {
      const row = productRow({
        name: "Cake",
        price: 100,
        productPromos: [livePromo({ value: 20, endDate: T })],
      });
      mockPrisma.product.findMany.mockImplementation((async (args: { where?: { NOT?: unknown } }) => {
        vi.setSystemTime(T.getTime() + 1); // the clock moves on mid-query
        return args.where?.NOT ? [] : [row];
      }) as never);

      const result = await searchCatalog("cake");

      if (!result.success) throw new Error(result.error);
      expect(result.data.products[0].price).toBe(80);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops a row whose starting variant vanished between filter and read", async () => {
    const orphan = { ...productRow({ name: "Cake Pops" }), variants: [] };
    stubSearch({ nameRows: [orphan as never, productRow({ name: "Cake Roll" })] });

    const result = await searchCatalog("cake");

    if (!result.success) throw new Error(result.error);
    expect(result.data.products.map((p) => p.name)).toEqual(["Cake Roll"]);
  });

  it("maps the card fields, falling back to the placeholder image", async () => {
    const hit = await priceOf(productRow({ name: "Cake Pops", category: "Petits Fours", images: [] }));

    expect(hit).toEqual({
      id: "cake-pops",
      name: "Cake Pops",
      slug: "cake-pops",
      image: "/placeholder.jpg",
      category: "Petits Fours",
      price: 100,
      compareAtPrice: null,
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// searchCatalog — failure
// ═════════════════════════════════════════════════════════════════════════════

describe("searchCatalog — failure", () => {
  it("a database error becomes the generic envelope (and is logged), never a throw", async () => {
    mockPrisma.product.findMany.mockRejectedValue(new Error("connection reset"));

    const result = await searchCatalog("cake");

    expect(result).toEqual({
      success: false,
      error: "Search is unavailable right now. Please try again.",
    });
    expect(consoleError).toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// getSearchSuggestions — the idle palette
// ═════════════════════════════════════════════════════════════════════════════

describe("getSearchSuggestions", () => {
  it("featured categories lead in slider order, the rest follow alphabetically, capped at 8", async () => {
    // Postgres hands them back alphabetically.
    stubSearch({
      categoryRows: [
        categoryRow({ name: "Baklava" }),
        categoryRow({ name: "Breads", isFeatured: true, sliderOrder: 2 }),
        categoryRow({ name: "Cakes" }),
        categoryRow({ name: "Cookies", isFeatured: true, sliderOrder: 1 }),
        categoryRow({ name: "Croissants" }),
        categoryRow({ name: "Eclairs" }),
        categoryRow({ name: "Gateaux" }),
        categoryRow({ name: "Ice Cream" }),
        categoryRow({ name: "Kunafa" }),
        categoryRow({ name: "Macarons" }),
      ],
    });

    const result = await getSearchSuggestions();

    if (!result.success) throw new Error(result.error);
    expect(result.data.categories.map((c) => c.name)).toEqual([
      "Cookies",
      "Breads",
      "Baklava",
      "Cakes",
      "Croissants",
      "Eclairs",
      "Gateaux",
      "Ice Cream",
    ]);
    const [args] = mockPrisma.category.findMany.mock.calls[0] as any[];
    expect(args.where).toEqual({ products: { some: LISTABLE } });
  });

  it("returns the newest listable products, priced through the Discount Engine", async () => {
    stubSearch({
      nameRows: [productRow({ name: "New Tart", price: 80, productPromos: [livePromo({ value: 25 })] })],
    });

    const result = await getSearchSuggestions();

    if (!result.success) throw new Error(result.error);
    expect(result.data.products).toEqual([
      expect.objectContaining({ name: "New Tart", price: 60, compareAtPrice: 80 }),
    ]);
    const [args] = productCalls();
    expect(args.where).toEqual(LISTABLE);
    expect(args.orderBy).toEqual({ createdAt: "desc" });
    expect(args.take).toBe(4);
  });

  it("a database error becomes the envelope, never a throw", async () => {
    mockPrisma.category.findMany.mockRejectedValue(new Error("connection reset"));

    const result = await getSearchSuggestions();

    expect(result).toEqual({ success: false, error: "Couldn't load suggestions." });
    expect(consoleError).toHaveBeenCalled();
  });
});
