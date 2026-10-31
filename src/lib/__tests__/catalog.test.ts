// ─────────────────────────────────────────────────────────────────────────────
// Branch-stock rule — src/lib/catalog.ts.
//
// One rule, two forms: the Prisma `where` helpers (DB-side) and
// `isAvailableAtBranch` (in-memory, used by placeOrder). Both must say:
//
//   available at X  ⇔  product.isAvailable && variant.isAvailable
//                       && override(X)?.isAvailable !== false
//                       && !(override(X)?.soldOutUntil > now)
//
// with a MISSING override meaning available, and `soldOutUntil` compared to a
// single request `now` (the sold-out-today mark expires on its own).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  branchOutOfStockMessage,
  branchSoldOutTodayMessage,
  isAvailableAtBranch,
  isSoldOutToday,
  listableProductAtBranch,
  variantAvailableAtBranch,
  variantLabel,
} from "@/lib/catalog";

const NOW = new Date("2026-11-01T10:00:00.000Z");
const FUTURE = new Date("2026-11-01T22:00:00.000Z"); // next Cairo midnight, still ahead of NOW
const PAST = new Date("2026-10-31T22:00:00.000Z"); // an expired mark

describe("isAvailableAtBranch — the truth table", () => {
  it.each([
    // product, variant, branchAvailable, soldOutUntil → available?
    [true, true, undefined, undefined, true], // no override row → in stock
    [true, true, null, null, true],
    [true, true, true, null, true],
    [true, true, false, null, false], // switched off long-term at this branch
    [false, true, true, null, false], // admin's product kill-switch wins over the branch
    [true, false, true, null, false], // admin's variant kill-switch wins over the branch
    [false, false, undefined, undefined, false],
    [true, true, undefined, FUTURE, false], // sold out today → out until the mark expires
    [true, true, undefined, PAST, true], // an expired mark counts as available again
    [true, true, false, PAST, false], // long-term off still wins over an expired mark
    [true, true, false, FUTURE, false], // both reasons apply → out
  ])(
    "product=%s variant=%s branch=%s soldOutUntil=%s → %s",
    (productAvailable, variantAvailable, branchAvailable, soldOutUntil, expected) => {
      expect(
        isAvailableAtBranch(
          { productAvailable, variantAvailable, branchAvailable, soldOutUntil },
          NOW,
        ),
      ).toBe(expected);
    },
  );
});

describe("isSoldOutToday — today-only, not head-office off", () => {
  it("true only when live AND soldOutUntil is still ahead of now", () => {
    expect(isSoldOutToday({ isAvailable: true, soldOutUntil: FUTURE }, NOW)).toBe(true);
    expect(isSoldOutToday({ soldOutUntil: FUTURE }, NOW)).toBe(true); // isAvailable omitted = not off
  });
  it("false for an expired, missing, or head-office-off row", () => {
    expect(isSoldOutToday({ soldOutUntil: PAST }, NOW)).toBe(false);
    expect(isSoldOutToday({ soldOutUntil: null }, NOW)).toBe(false);
    expect(isSoldOutToday(null, NOW)).toBe(false);
    expect(isSoldOutToday(undefined, NOW)).toBe(false);
    // Off long-term is a stock-out, not a sold-out-today, even with a live mark.
    expect(isSoldOutToday({ isAvailable: false, soldOutUntil: FUTURE }, NOW)).toBe(false);
  });
});

describe("Prisma where helpers", () => {
  it("variantAvailableAtBranch: globally on AND no 'off' or 'sold out today' row at that branch", () => {
    expect(variantAvailableAtBranch("branch_menouf", NOW)).toEqual({
      isAvailable: true,
      branchAvailability: {
        none: {
          branchId: "branch_menouf",
          OR: [{ isAvailable: false }, { soldOutUntil: { gt: NOW } }],
        },
      },
    });
  });

  it("listableProductAtBranch: the product is on and has a variant in stock at that branch", () => {
    expect(listableProductAtBranch("branch_menouf", NOW)).toEqual({
      isAvailable: true,
      variants: {
        some: {
          isAvailable: true,
          branchAvailability: {
            none: {
              branchId: "branch_menouf",
              OR: [{ isAvailable: false }, { soldOutUntil: { gt: NOW } }],
            },
          },
        },
      },
    });
  });
});

describe("customer-facing wording", () => {
  it("names the exact variant, since one size can be out while another isn't", () => {
    expect(variantLabel("Kunafa", "Small")).toBe("Kunafa (Small)");
    expect(variantLabel("Kunafa", "")).toBe("Kunafa");
  });

  it("branchOutOfStockMessage matches the agreed copy", () => {
    expect(branchOutOfStockMessage("Kunafa", "Small", "Menouf")).toBe(
      "Kunafa (Small) is currently out of stock at the Menouf branch.",
    );
  });

  it("branchSoldOutTodayMessage says it's today and comes back", () => {
    expect(branchSoldOutTodayMessage("Kunafa", "Small", "Menouf")).toBe(
      "Kunafa (Small) is sold out at the Menouf branch today.",
    );
  });
});
