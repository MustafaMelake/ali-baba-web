// ─────────────────────────────────────────────────────────────────────────────
// Wishlist page loader — getWishlistItems.
//
// The wishlist is the one storefront list that deliberately KEEPS products the
// catalog hides (LISTABLE_PRODUCT): it is the shopper's own saved list, and the
// heart on each card is how they remove an item. But it must never quote a
// price for something placeOrder would reject — a product switched off, or one
// whose every variant is archived, comes back with `price: null` (the card
// reads "Currently unavailable"), never the 0 EGP a missing starting variant
// used to resolve to.
//
// MOCKING — same strategy as cart.test.ts: mock only the true boundaries
// (@/lib/prisma deep-mocked, @/lib/session, next/cache) and run the real
// discount engine.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));
vi.mock("@/lib/session", () => ({ getServerSession: vi.fn(), requireAdmin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getWishlistItems } from "@/lib/actions/wishlist";
import { getServerSession } from "@/lib/session";

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>;
const mockedSession = vi.mocked(getServerSession);

/** A Prisma-`Decimal`-like stand-in: money columns come back as objects. */
const decimalLike = (n: number) => ({ toNumber: () => n });

const livePromo = {
  id: "promo_1",
  name: "Eid 20%",
  type: "PERCENTAGE",
  value: decimalLike(20),
  startDate: new Date("2026-01-01T00:00:00Z"),
  endDate: new Date("2099-01-01T00:00:00Z"),
  isActive: true,
};

/** One wishlist row as the query returns it — variants already filtered to
 *  `isAvailable: true` and sorted cheapest-first by the database. */
function wishlistRow(product: {
  isAvailable?: boolean;
  variants?: { price: number; compareAtPrice?: number }[];
  promotions?: (typeof livePromo)[];
}) {
  return {
    product: {
      id: "prod_1",
      name: "Kunafa Tray",
      slug: "kunafa-tray",
      images: ["https://utfs.io/f/kunafa.jpg"],
      isAvailable: product.isAvailable ?? true,
      category: { name: "Oriental", promotions: [] },
      promotions: product.promotions ?? [],
      variants: (product.variants ?? [{ price: 300 }]).map((v, i) => ({
        id: `var_${i}`,
        price: decimalLike(v.price),
        compareAtPrice: v.compareAtPrice === undefined ? null : decimalLike(v.compareAtPrice),
        promotions: [],
      })),
    },
  };
}

vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  mockReset(mockPrisma);
  mockedSession.mockReset();
  mockedSession.mockResolvedValue({ user: { id: "user_1" } } as never);
  mockPrisma.wishlistItem.count.mockResolvedValue(1 as never);
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe("getWishlistItems — pricing a saved product", () => {
  it("prices an available product from its cheapest variant, live promotion applied", async () => {
    mockPrisma.wishlistItem.findMany.mockResolvedValue([
      wishlistRow({ variants: [{ price: 300 }, { price: 450 }], promotions: [livePromo] }),
    ] as never);

    const result = await getWishlistItems();

    expect(result).toEqual({
      success: true,
      total: 1,
      data: [expect.objectContaining({ id: "prod_1", price: 240, compareAtPrice: 300 })],
    });
  });

  it("quotes no price for a product that has been switched off", async () => {
    mockPrisma.wishlistItem.findMany.mockResolvedValue([
      wishlistRow({ isAvailable: false, variants: [{ price: 300, compareAtPrice: 350 }] }),
    ] as never);

    const result = await getWishlistItems();

    expect(result).toEqual({
      success: true,
      total: 1,
      data: [expect.objectContaining({ id: "prod_1", price: null, compareAtPrice: null })],
    });
  });

  it("quotes no price — not 0 EGP — when every variant is archived", async () => {
    mockPrisma.wishlistItem.findMany.mockResolvedValue([
      wishlistRow({ variants: [], promotions: [livePromo] }),
    ] as never);

    const result = await getWishlistItems();

    expect(result).toEqual({
      success: true,
      total: 1,
      data: [expect.objectContaining({ id: "prod_1", price: null, compareAtPrice: null })],
    });
  });
});

describe("getWishlistItems — pagination", () => {
  it("reads one page (newest first, id tie-break) and reports the full total", async () => {
    mockPrisma.wishlistItem.count.mockResolvedValue(30 as never);
    mockPrisma.wishlistItem.findMany.mockResolvedValue([] as never);

    const result = await getWishlistItems(2);

    expect(result).toEqual({ success: true, data: [], total: 30 });
    expect(mockPrisma.wishlistItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user_1" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: 24,
        take: 24,
      }),
    );
  });

  it.each([0, -1, 1.5, "2", null])("treats a malformed page (%s) as page 1", async (bad) => {
    mockPrisma.wishlistItem.findMany.mockResolvedValue([] as never);
    await getWishlistItems(bad);
    expect(mockPrisma.wishlistItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 24 }),
    );
  });
});
