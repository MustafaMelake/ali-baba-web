// ─────────────────────────────────────────────────────────────────────────────
// Discount Engine — unit suite (the financial core).
//
// `src/lib/discounts.ts` is the single pure resolver shared by all seven price
// surfaces AND `placeOrder`'s billing. Its whole purpose is to guarantee the
// shown price equals the billed price, so it is the highest-blast-radius module
// in the platform. These tests pin every domain invariant from
// `.claude/rules/business-logic.md`:
//
//   • roundMoney is the 2-dp money authority (survives IEEE-754 quirks).
//   • "Cheapest Wins" — overlapping live promotions never stack; exactly one
//     applies: the lowest final price. Ties break first-found (strict `<`).
//   • Liveness is strict & inclusive: isActive AND startDate <= now <= endDate.
//   • A single `now` per request governs both the DB filter and the in-memory
//     re-check, so a promotion can't be live for one line and dead for the next.
//   • Discounts floor at 0; compareAtPrice is never an input to this math.
//
// Every expected numeric value was computed against the real formulas, not
// eyeballed — see the float-sensitive cases in `roundMoney` and `resolvePrice`.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { DiscountType } from "@/generated/prisma/enums";
import {
  toNumber,
  roundMoney,
  isPromotionLive,
  applyPromotion,
  gatherPromotions,
  resolvePrice,
  livePromotionWhere,
  PROMOTION_SELECT_FIELDS,
  type PromotionLike,
} from "@/lib/discounts";

// ── Fixtures ────────────────────────────────────────────────────────────────

/** A fixed clock so every liveness assertion is deterministic. */
const NOW = new Date("2025-06-15T12:00:00.000Z");

/** A Prisma-`Decimal`-like stand-in: number-like via `.toNumber()` only. */
const decimalLike = (n: number): { toNumber(): number } => ({ toNumber: () => n });

/** Build a live PromotionLike; override any field per test. */
function makePromo(overrides: Partial<PromotionLike> = {}): PromotionLike {
  return {
    id: "promo-1",
    name: "Test Promo",
    type: DiscountType.PERCENTAGE,
    value: 10,
    startDate: new Date("2025-06-01T00:00:00.000Z"),
    endDate: new Date("2025-06-30T23:59:59.999Z"),
    isActive: true,
    ...overrides,
  };
}

// ── toNumber ──────────────────────────────────────────────────────────────────

describe("toNumber", () => {
  it("passes a plain number through unchanged", () => {
    expect(toNumber(42.5)).toBe(42.5);
    expect(toNumber(0)).toBe(0);
  });

  it("coerces a Prisma-Decimal-like object via .toNumber()", () => {
    expect(toNumber(decimalLike(19.99))).toBe(19.99);
  });
});

// ── roundMoney — the 2-dp money authority ─────────────────────────────────────

describe("roundMoney", () => {
  it("tames the canonical binary-float quirk (0.1 + 0.2)", () => {
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE-754.
    expect(0.1 + 0.2).not.toBe(0.3); // sanity: the quirk is real
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });

  it("rounds half-up where a naive Math.round would round DOWN (the EPSILON fix)", () => {
    // Naive `Math.round(1.005 * 100) / 100` yields 1 — a silently dropped
    // piastre. The `+ Number.EPSILON` nudge is exactly what makes this 1.01.
    expect(Math.round(1.005 * 100) / 100).toBe(1); // the bug the engine avoids
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(5.005)).toBe(5.01);
    expect(roundMoney(0.615)).toBe(0.62);
    expect(roundMoney(1.255)).toBe(1.26);
  });

  it("rounds a truly-exact half up (0.125 → 0.13)", () => {
    // 0.125 is exactly representable, so 0.125 * 100 === 12.5 exactly.
    expect(roundMoney(0.125)).toBe(0.13);
  });

  it("rounds down below the .xx5 midpoint and up at/above it", () => {
    expect(roundMoney(10.994)).toBe(10.99);
    expect(roundMoney(10.995)).toBe(11);
    expect(roundMoney(10.999)).toBe(11);
  });

  it("leaves an already-2dp value untouched", () => {
    expect(roundMoney(19.99)).toBe(19.99);
    expect(roundMoney(0)).toBe(0);
    expect(roundMoney(1000)).toBe(1000);
  });

  it("accepts a Decimal-like input (money columns arrive as Decimal objects)", () => {
    expect(roundMoney(decimalLike(2.675))).toBe(2.68);
  });
});

// ── isPromotionLive — strict, inclusive boundaries ────────────────────────────

describe("isPromotionLive", () => {
  const start = new Date("2025-06-01T00:00:00.000Z");
  const end = new Date("2025-06-30T23:59:59.999Z");
  const windowed = makePromo({ startDate: start, endDate: end });

  it("is live exactly ON the startDate (inclusive lower bound)", () => {
    expect(isPromotionLive(windowed, new Date(start.getTime()))).toBe(true);
  });

  it("is live exactly ON the endDate (inclusive upper bound)", () => {
    expect(isPromotionLive(windowed, new Date(end.getTime()))).toBe(true);
  });

  it("is NOT live 1ms before the startDate", () => {
    expect(isPromotionLive(windowed, new Date(start.getTime() - 1))).toBe(false);
  });

  it("is NOT live 1ms after the endDate", () => {
    expect(isPromotionLive(windowed, new Date(end.getTime() + 1))).toBe(false);
  });

  it("is live strictly inside the window", () => {
    expect(isPromotionLive(windowed, NOW)).toBe(true);
  });

  it("is NEVER live when isActive is false, even mid-window", () => {
    expect(isPromotionLive(makePromo({ isActive: false }), NOW)).toBe(false);
  });

  it("accepts ISO string dates (Prisma may hand back strings)", () => {
    const stringDated = makePromo({
      startDate: "2025-06-01T00:00:00.000Z",
      endDate: "2025-06-30T23:59:59.999Z",
    });
    expect(isPromotionLive(stringDated, NOW)).toBe(true);
  });

  it("treats an unparseable date as not-live rather than throwing", () => {
    expect(isPromotionLive(makePromo({ startDate: "not-a-date" }), NOW)).toBe(false);
    expect(isPromotionLive(makePromo({ endDate: "" }), NOW)).toBe(false);
  });
});

// ── applyPromotion — single-promo math (liveness-agnostic) ────────────────────

describe("applyPromotion", () => {
  it("applies a PERCENTAGE discount", () => {
    expect(applyPromotion(100, makePromo({ type: DiscountType.PERCENTAGE, value: 20 }))).toBe(80);
  });

  it("applies a FIXED_AMOUNT discount", () => {
    expect(applyPromotion(100, makePromo({ type: DiscountType.FIXED_AMOUNT, value: 15 }))).toBe(85);
  });

  it("floors at 0 when a fixed amount exceeds the base price (never negative)", () => {
    expect(applyPromotion(50, makePromo({ type: DiscountType.FIXED_AMOUNT, value: 80 }))).toBe(0);
  });

  it("short-circuits a non-positive base to 0", () => {
    expect(applyPromotion(0, makePromo({ type: DiscountType.PERCENTAGE, value: 20 }))).toBe(0);
  });

  it("coerces Decimal-like base and value", () => {
    expect(
      applyPromotion(decimalLike(200), makePromo({ type: DiscountType.PERCENTAGE, value: decimalLike(25) })),
    ).toBe(150);
  });
});

// ── gatherPromotions — merge + de-dupe the three targeting levels ─────────────

describe("gatherPromotions", () => {
  it("merges variant + product + category lists", () => {
    const result = gatherPromotions(
      [makePromo({ id: "v" })],
      [makePromo({ id: "p" })],
      [makePromo({ id: "c" })],
    );
    expect(result.map((p) => p.id).sort()).toEqual(["c", "p", "v"]);
  });

  it("de-dupes by id (a promo targeting two levels appears once)", () => {
    const shared = makePromo({ id: "shared" });
    const result = gatherPromotions([shared], [shared], [makePromo({ id: "other" })]);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.id).sort()).toEqual(["other", "shared"]);
  });

  it("ignores null / undefined / empty lists", () => {
    expect(gatherPromotions(null, undefined, [])).toEqual([]);
    expect(gatherPromotions(null, [makePromo({ id: "a" })], undefined)).toHaveLength(1);
  });
});

// ── resolvePrice — the shown-equals-billed guarantee ──────────────────────────

describe("resolvePrice — no promotions", () => {
  it("falls back to the base price for an empty list", () => {
    const r = resolvePrice(120, [], NOW);
    expect(r).toEqual({
      basePrice: 120,
      finalPrice: 120,
      discountAmount: 0,
      hasDiscount: false,
      appliedPromotion: null,
    });
  });

  it("falls back gracefully for null and undefined (no throw)", () => {
    expect(resolvePrice(120, null, NOW).finalPrice).toBe(120);
    expect(resolvePrice(120, undefined, NOW).finalPrice).toBe(120);
    expect(resolvePrice(120, null, NOW).hasDiscount).toBe(false);
  });

  it("rounds the base price to 2dp even with nothing applied", () => {
    expect(resolvePrice(decimalLike(19.999), [], NOW).finalPrice).toBe(20);
  });
});

describe("resolvePrice — single promotion", () => {
  it("applies a single PERCENTAGE promo and reports the applied promotion", () => {
    const promo = makePromo({ id: "pct", type: DiscountType.PERCENTAGE, value: 20 });
    const r = resolvePrice(100, [promo], NOW);
    expect(r.finalPrice).toBe(80);
    expect(r.discountAmount).toBe(20);
    expect(r.hasDiscount).toBe(true);
    expect(r.appliedPromotion).toEqual({ id: "pct", name: "Test Promo", type: "PERCENTAGE", value: 20 });
  });

  it("applies a single FIXED_AMOUNT promo", () => {
    const promo = makePromo({ id: "fix", type: DiscountType.FIXED_AMOUNT, value: 15 });
    const r = resolvePrice(100, [promo], NOW);
    expect(r.finalPrice).toBe(85);
    expect(r.discountAmount).toBe(15);
    expect(r.appliedPromotion?.id).toBe("fix");
  });

  it("keeps the breakdown reconciled on a float-sensitive price (99.99 @ 10%)", () => {
    const r = resolvePrice(99.99, [makePromo({ type: DiscountType.PERCENTAGE, value: 10 })], NOW);
    expect(r.finalPrice).toBe(89.99);
    expect(r.discountAmount).toBe(10); // basePrice − finalPrice, both 2dp
    expect(roundMoney(r.finalPrice + r.discountAmount)).toBe(r.basePrice);
  });
});

describe("resolvePrice — Cheapest Wins (the overlap rule)", () => {
  it("picks the promo yielding the LOWEST price (fixed beats percentage here)", () => {
    // base 100: 20% → 80, but 30 fixed → 70. Cheapest is 70.
    const pct = makePromo({ id: "pct", type: DiscountType.PERCENTAGE, value: 20 });
    const fixed = makePromo({ id: "fixed", type: DiscountType.FIXED_AMOUNT, value: 30 });
    expect(resolvePrice(100, [pct, fixed], NOW).finalPrice).toBe(70);
    expect(resolvePrice(100, [pct, fixed], NOW).appliedPromotion?.id).toBe("fixed");
  });

  it("is order-independent — same winner regardless of array position", () => {
    const pct = makePromo({ id: "pct", type: DiscountType.PERCENTAGE, value: 20 });
    const fixed = makePromo({ id: "fixed", type: DiscountType.FIXED_AMOUNT, value: 30 });
    expect(resolvePrice(100, [fixed, pct], NOW).appliedPromotion?.id).toBe("fixed");
  });

  it("picks the percentage when IT is the cheaper of the two", () => {
    // base 100: 50% → 50 beats 30 fixed → 70.
    const pct = makePromo({ id: "pct", type: DiscountType.PERCENTAGE, value: 50 });
    const fixed = makePromo({ id: "fixed", type: DiscountType.FIXED_AMOUNT, value: 30 });
    expect(resolvePrice(100, [pct, fixed], NOW).finalPrice).toBe(50);
    expect(resolvePrice(100, [pct, fixed], NOW).appliedPromotion?.id).toBe("pct");
  });

  it("NEVER stacks — two 20-off promos discount by 20, not 40", () => {
    const a = makePromo({ id: "a", type: DiscountType.FIXED_AMOUNT, value: 20 });
    const b = makePromo({ id: "b", type: DiscountType.PERCENTAGE, value: 20 });
    const r = resolvePrice(100, [a, b], NOW);
    expect(r.finalPrice).toBe(80); // one applied, not 60
    expect(r.discountAmount).toBe(20);
  });

  it("breaks a tie deterministically by first-found (strict `<`)", () => {
    // Both resolve to 80; the first in the list is kept.
    const a = makePromo({ id: "a", type: DiscountType.PERCENTAGE, value: 20 });
    const b = makePromo({ id: "b", type: DiscountType.FIXED_AMOUNT, value: 20 });
    expect(resolvePrice(100, [a, b], NOW).appliedPromotion?.id).toBe("a");
    expect(resolvePrice(100, [b, a], NOW).appliedPromotion?.id).toBe("b");
  });
});

describe("resolvePrice — liveness gates the candidate set", () => {
  it("ignores an expired promo even when it would be far cheaper", () => {
    // The expired 90-off (→ 10) must NOT win over the live 10% (→ 90).
    const live = makePromo({ id: "live", type: DiscountType.PERCENTAGE, value: 10 });
    const expired = makePromo({
      id: "expired",
      type: DiscountType.FIXED_AMOUNT,
      value: 90,
      startDate: "2025-01-01T00:00:00.000Z",
      endDate: "2025-02-01T00:00:00.000Z", // ended before NOW
    });
    const r = resolvePrice(100, [live, expired], NOW);
    expect(r.finalPrice).toBe(90);
    expect(r.appliedPromotion?.id).toBe("live");
  });

  it("ignores a not-yet-started promo", () => {
    const future = makePromo({
      startDate: "2025-12-01T00:00:00.000Z",
      endDate: "2025-12-31T00:00:00.000Z",
    });
    expect(resolvePrice(100, [future], NOW).hasDiscount).toBe(false);
  });

  it("ignores an inactive promo", () => {
    expect(resolvePrice(100, [makePromo({ isActive: false, value: 50 })], NOW).finalPrice).toBe(100);
  });

  it("returns the base when NO promo is live", () => {
    const r = resolvePrice(100, [makePromo({ isActive: false }), makePromo({ isActive: false })], NOW);
    expect(r.finalPrice).toBe(100);
    expect(r.appliedPromotion).toBeNull();
  });
});

describe("resolvePrice — single `now` per request governs liveness", () => {
  const promo = makePromo({
    type: DiscountType.PERCENTAGE,
    value: 20,
    startDate: "2025-06-01T00:00:00.000Z",
    endDate: "2025-06-30T23:59:59.999Z",
  });

  it("applies the promo when `now` is inside the window", () => {
    expect(resolvePrice(100, [promo], new Date("2025-06-15T12:00:00.000Z")).finalPrice).toBe(80);
  });

  it("skips the SAME promo when `now` is outside the window", () => {
    // Same inputs, later instant — proves the passed `now`, not wall-clock,
    // decides liveness (this is what keeps two order lines on one instant).
    expect(resolvePrice(100, [promo], new Date("2025-07-15T12:00:00.000Z")).finalPrice).toBe(100);
  });
});

describe("resolvePrice — edge cases", () => {
  it("floors the final price at 0 when a fixed discount exceeds the base", () => {
    const r = resolvePrice(50, [makePromo({ type: DiscountType.FIXED_AMOUNT, value: 80 })], NOW);
    expect(r.finalPrice).toBe(0);
    expect(r.discountAmount).toBe(50);
    expect(r.hasDiscount).toBe(true);
  });

  it("does NOT register a discount for a live 0%-effective promo (candidate == base)", () => {
    const r = resolvePrice(100, [makePromo({ type: DiscountType.PERCENTAGE, value: 0 })], NOW);
    expect(r.finalPrice).toBe(100);
    expect(r.hasDiscount).toBe(false);
    expect(r.appliedPromotion).toBeNull();
  });

  it("coerces a Decimal-like base price and promo value end-to-end", () => {
    const r = resolvePrice(
      decimalLike(100),
      [makePromo({ type: DiscountType.PERCENTAGE, value: decimalLike(25) })],
      NOW,
    );
    expect(r.finalPrice).toBe(75);
    expect(r.discountAmount).toBe(25);
    expect(r.appliedPromotion?.value).toBe(25); // reported as a plain number
  });
});

// ── Prisma-facing helpers (shape contracts) ───────────────────────────────────

describe("livePromotionWhere", () => {
  it("builds a `where` filtering active promos around the passed `now`", () => {
    expect(livePromotionWhere(NOW)).toEqual({
      isActive: true,
      startDate: { lte: NOW },
      endDate: { gte: NOW },
    });
  });
});

describe("PROMOTION_SELECT_FIELDS", () => {
  it("selects exactly the fields the resolver consumes", () => {
    expect(PROMOTION_SELECT_FIELDS).toEqual({
      id: true,
      name: true,
      type: true,
      value: true,
      startDate: true,
      endDate: true,
      isActive: true,
    });
  });
});
