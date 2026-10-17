// ─────────────────────────────────────────────────────────────────────────────
// Promotions — free-product guard (src/lib/actions/promotions.ts).
//
// The Discount Engine floors every price at 0, so a promotion big enough to
// reach 0 silently makes products free. These specs pin the guard that stops
// that at the source:
//   • a FIXED_AMOUNT discount must stay below the cheapest AVAILABLE variant it
//     targets (directly, through its product, or through its category) — on
//     create, on update, and when an inactive promotion is switched back on;
//   • a PERCENTAGE discount must stay below 100%.
// …plus the field rules every save runs first (validatePromotion): the gate,
// name, type, a positive value, a Cairo-day window that ends on or after it
// starts, and at least one target.
// placeOrder's own 0 EGP refusal (orders.test.ts) is the backstop for prices
// edited after a promotion was saved.
//
// MOCKING — same strategy as marketing-events.test.ts: @/lib/prisma
// deep-mocked, @/lib/session and next/cache stubbed, the real gate runs.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));
vi.mock("@/lib/session", () => ({ getServerSession: vi.fn(), requireAdmin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  createPromotion,
  togglePromotionActive,
  updatePromotion,
  type PromotionInput,
} from "@/lib/actions/promotions";
import { requireAdmin } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { DiscountType } from "@/generated/prisma/enums";

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>;
const mockedRequireAdmin = vi.mocked(requireAdmin);
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

/** A Prisma Decimal as the action sees it. */
const money = (n: number) => ({ toNumber: () => n });

/** The cheapest available targeted variant the lookup returns. */
function cheapest(price: number) {
  return { price: money(price), name: "Small", product: { name: "Kunafa" } } as never;
}

function input(overrides: Partial<PromotionInput> = {}): PromotionInput {
  return {
    name: "Eid offer",
    type: DiscountType.FIXED_AMOUNT,
    value: 50,
    startDate: "2026-10-20",
    endDate: "2026-10-27",
    isActive: true,
    categoryIds: ["cat_oriental"],
    productIds: ["prod_kunafa"],
    variantIds: ["var_small"],
    ...overrides,
  };
}

beforeEach(() => {
  mockReset(mockPrisma);
  vi.mocked(revalidatePath).mockClear();
  mockedRequireAdmin.mockReset();
  mockedRequireAdmin.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } } as never);
  mockPrisma.promotion.create.mockResolvedValue({ id: "promo_1" } as never);
  mockPrisma.promotion.update.mockResolvedValue({ id: "promo_1" } as never);
  consoleError.mockClear();
});

afterAll(() => {
  consoleError.mockRestore();
});

describe("createPromotion — fixed-amount ceiling", () => {
  it("refuses a fixed discount equal to the cheapest targeted variant (it would be free)", async () => {
    mockPrisma.productVariant.findFirst.mockResolvedValue(cheapest(50));

    const res = await createPromotion(input({ value: 50 }));

    expect(res).toEqual({ success: false, error: expect.stringContaining("Kunafa — Small") });
    expect(mockPrisma.promotion.create).not.toHaveBeenCalled();
  });

  it("refuses a fixed discount above the cheapest targeted variant", async () => {
    mockPrisma.productVariant.findFirst.mockResolvedValue(cheapest(45));

    const res = await createPromotion(input({ value: 500 }));

    expect(res.success).toBe(false);
    expect(mockPrisma.promotion.create).not.toHaveBeenCalled();
  });

  it("saves a fixed discount below every targeted price", async () => {
    mockPrisma.productVariant.findFirst.mockResolvedValue(cheapest(50.01));

    const res = await createPromotion(input({ value: 50 }));

    expect(res).toEqual({ success: true, id: "promo_1" });
  });

  it("looks for the cheapest AVAILABLE variant across variant, product and category targets", async () => {
    mockPrisma.productVariant.findFirst.mockResolvedValue(null);

    await createPromotion(input());

    expect(mockPrisma.productVariant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isAvailable: true,
          OR: [
            { id: { in: ["var_small"] } },
            { productId: { in: ["prod_kunafa"] } },
            { product: { categoryId: { in: ["cat_oriental"] } } },
          ],
        },
        orderBy: { price: "asc" },
      }),
    );
  });

  it("never looks up prices for a percentage discount", async () => {
    await createPromotion(input({ type: DiscountType.PERCENTAGE, value: 30 }));

    expect(mockPrisma.productVariant.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.promotion.create).toHaveBeenCalled();
  });
});

describe("createPromotion — percentage ceiling", () => {
  it("refuses 100% off", async () => {
    const res = await createPromotion(input({ type: DiscountType.PERCENTAGE, value: 100 }));

    expect(res.success).toBe(false);
    expect(mockPrisma.promotion.create).not.toHaveBeenCalled();
  });

  it("accepts 99.5% off", async () => {
    const res = await createPromotion(input({ type: DiscountType.PERCENTAGE, value: 99.5 }));

    expect(res.success).toBe(true);
  });
});

describe("updatePromotion — fixed-amount ceiling", () => {
  it("refuses an edit that would make a targeted product free", async () => {
    mockPrisma.productVariant.findFirst.mockResolvedValue(cheapest(40));

    const res = await updatePromotion("promo_1", input({ value: 40 }));

    expect(res.success).toBe(false);
    expect(mockPrisma.promotion.update).not.toHaveBeenCalled();
  });
});

describe("togglePromotionActive — re-checks prices when switching on", () => {
  function storedPromotion(value: number) {
    return {
      type: DiscountType.FIXED_AMOUNT,
      value: money(value),
      categories: [{ id: "cat_oriental" }],
      products: [],
      variants: [],
    } as never;
  }

  it("refuses to activate a fixed discount a price cut has since overtaken", async () => {
    mockPrisma.promotion.findUnique.mockResolvedValue(storedPromotion(60));
    mockPrisma.productVariant.findFirst.mockResolvedValue(cheapest(55));

    const res = await togglePromotionActive("promo_1", true);

    expect(res.success).toBe(false);
    expect(mockPrisma.promotion.update).not.toHaveBeenCalled();
  });

  it("activates a fixed discount that is still below every targeted price", async () => {
    mockPrisma.promotion.findUnique.mockResolvedValue(storedPromotion(20));
    mockPrisma.productVariant.findFirst.mockResolvedValue(cheapest(55));

    const res = await togglePromotionActive("promo_1", true);

    expect(res).toEqual({ success: true });
  });

  it("always allows switching a promotion off", async () => {
    const res = await togglePromotionActive("promo_1", false);

    expect(res).toEqual({ success: true });
    expect(mockPrisma.productVariant.findFirst).not.toHaveBeenCalled();
  });
});

describe("createPromotion — field rules", () => {
  it("answers a non-admin with an error envelope and writes nothing", async () => {
    mockedRequireAdmin.mockRejectedValue(new Error("nope"));

    const res = await createPromotion(input());

    expect(res).toEqual({ success: false, error: "Unauthorized: admin access required." });
    expect(mockPrisma.promotion.create).not.toHaveBeenCalled();
  });

  it.each([
    ["a one-letter name", { name: " E " }, "Name must be at least 2 characters."],
    ["an unknown type", { type: "BOGO" as DiscountType }, "Choose a valid discount type."],
    ["a zero value", { value: 0 }, "Discount value must be a positive number."],
    ["a negative value", { value: -10 }, "Discount value must be a positive number."],
    ["a non-numeric value", { value: Number.NaN }, "Discount value must be a positive number."],
    ["a blank start date", { startDate: "" }, "Start date is invalid."],
    ["an unparseable end date", { endDate: "next week" }, "End date is invalid."],
    ["an end before the start", { startDate: "2026-10-27", endDate: "2026-10-20" }, "End date must be on or after the start date."],
    ["no targets at all", { categoryIds: [], productIds: [""], variantIds: [] }, "Link the promotion to at least one category, product or variant."],
  ])("refuses %s", async (_label, overrides, error) => {
    const res = await createPromotion(input(overrides));

    expect(res).toEqual({ success: false, error });
    expect(mockPrisma.promotion.create).not.toHaveBeenCalled();
  });

  it("runs a date-only window from Cairo midnight to the last millisecond of its final Cairo day", async () => {
    // 27 Oct is still summer time (UTC+3); Egypt's clocks go back on 29 Oct,
    // so 3 Nov ends at UTC+2 — the window's edges must follow the wall clock.
    await createPromotion(input({ startDate: "2026-10-27", endDate: "2026-11-03" }));

    expect(mockPrisma.promotion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          startDate: new Date("2026-10-26T21:00:00.000Z"),
          endDate: new Date("2026-11-03T21:59:59.999Z"),
        }),
      }),
    );
  });

  it("allows a one-day promotion (start and end on the same day)", async () => {
    const res = await createPromotion(input({ startDate: "2026-10-20", endDate: "2026-10-20" }));

    expect(res).toEqual({ success: true, id: "promo_1" });
  });

  it("drops blank and repeated targets before linking them", async () => {
    await createPromotion(
      input({ categoryIds: ["cat_oriental", "", "cat_oriental"], productIds: [], variantIds: ["var_small", "var_small"] }),
    );

    expect(mockPrisma.promotion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          categories: { connect: [{ id: "cat_oriental" }] },
          products: { connect: [] },
          variants: { connect: [{ id: "var_small" }] },
        }),
      }),
    );
  });

  it("refreshes the whole storefront tree on save", async () => {
    await createPromotion(input({ type: DiscountType.PERCENTAGE, value: 10 }));

    expect(revalidatePath).toHaveBeenCalledWith("/admin/promotions");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("translates a target deleted mid-edit (P2025)", async () => {
    mockPrisma.promotion.create.mockRejectedValue(Object.assign(new Error("gone"), { code: "P2025" }));

    const res = await createPromotion(input({ type: DiscountType.PERCENTAGE, value: 10 }));

    expect(res).toEqual({
      success: false,
      error: "One of the selected items no longer exists. Refresh and try again.",
    });
  });
});
