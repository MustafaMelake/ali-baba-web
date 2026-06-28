// ─────────────────────────────────────────────────────────────────────────────
// Discount Engine — pricing resolver (Phase 3).
//
// Pure, dependency-free helpers (no Prisma, no React) so the SAME math runs on
// the storefront, in the cart, on the checkout summary AND inside `placeOrder`.
// That shared logic is what guarantees the customer is billed exactly the price
// they were shown.
//
// A promotion applies to a variant when it targets the variant directly, its
// parent product, OR that product's category. When several live promotions
// apply, the one yielding the LOWEST price wins (best for the customer).
//
// "Live" is strict: `isActive === true` AND `startDate <= now <= endDate`.
// ─────────────────────────────────────────────────────────────────────────────

import { DiscountType } from "@/generated/prisma/enums";

/** The minimal promotion shape the resolver needs (subset of the Prisma row). */
export type PromotionLike = {
  id: string;
  name: string;
  /** A DiscountType value — "PERCENTAGE" | "FIXED_AMOUNT". */
  type: string;
  value: number;
  startDate: Date | string;
  endDate: Date | string;
  isActive: boolean;
};

export type AppliedPromotion = {
  id: string;
  name: string;
  type: string;
  value: number;
};

export type PricedResult = {
  /** The undiscounted catalogue price. */
  basePrice: number;
  /** What the customer actually pays (>= 0, rounded to 2dp). */
  finalPrice: number;
  /** basePrice − finalPrice (0 when nothing applied). */
  discountAmount: number;
  hasDiscount: boolean;
  /** The promotion that produced `finalPrice`, or null. */
  appliedPromotion: AppliedPromotion | null;
};

/** Fields every promotions query selects — keeps the resolver's input uniform. */
export const PROMOTION_SELECT_FIELDS = {
  id: true,
  name: true,
  type: true,
  value: true,
  startDate: true,
  endDate: true,
  isActive: true,
};

/** Round to 2 decimals (money). Identical rounding everywhere keeps the shown
 *  price and the billed price in lock-step. */
function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * A Prisma `where` matching only currently-live promotions. Spread it into a
 * relation include, e.g. `promotions: { where: livePromotionWhere(now), … }`.
 * Pass a single `now` per request so every level (variant/product/category)
 * is filtered against the same instant.
 */
export function livePromotionWhere(now: Date = new Date()) {
  return {
    isActive: true,
    startDate: { lte: now },
    endDate: { gte: now },
  };
}

/** Strict liveness check: active AND `now` within [startDate, endDate]. */
export function isPromotionLive(promo: PromotionLike, now: Date = new Date()): boolean {
  if (!promo.isActive) return false;
  const start = new Date(promo.startDate).getTime();
  const end = new Date(promo.endDate).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  const t = now.getTime();
  return t >= start && t <= end;
}

/** Apply ONE promotion to a base price. Never returns below 0. */
export function applyPromotion(basePrice: number, promo: PromotionLike): number {
  if (basePrice <= 0) return Math.max(0, roundMoney(basePrice));
  const raw =
    promo.type === DiscountType.PERCENTAGE
      ? basePrice * (1 - promo.value / 100)
      : basePrice - promo.value;
  return roundMoney(Math.max(0, raw));
}

/** Merge + de-dupe promotion lists (variant + product + category) by id. */
export function gatherPromotions(
  ...lists: (PromotionLike[] | null | undefined)[]
): PromotionLike[] {
  const byId = new Map<string, PromotionLike>();
  for (const list of lists) {
    for (const promo of list ?? []) byId.set(promo.id, promo);
  }
  return [...byId.values()];
}

/**
 * Resolve the final price for `basePrice` given a set of promotions. Only LIVE
 * promotions are considered; when several apply, the cheapest result wins.
 * Deterministic and pure — the storefront, cart, checkout and `placeOrder` all
 * call this so they can never disagree.
 */
export function resolvePrice(
  basePrice: number,
  promotions: PromotionLike[] | null | undefined,
  now: Date = new Date(),
): PricedResult {
  let best: PricedResult = {
    basePrice,
    finalPrice: roundMoney(basePrice),
    discountAmount: 0,
    hasDiscount: false,
    appliedPromotion: null,
  };

  for (const promo of promotions ?? []) {
    if (!isPromotionLive(promo, now)) continue;
    const candidate = applyPromotion(basePrice, promo);
    if (candidate < best.finalPrice) {
      best = {
        basePrice,
        finalPrice: candidate,
        discountAmount: roundMoney(basePrice - candidate),
        hasDiscount: candidate < basePrice,
        appliedPromotion: {
          id: promo.id,
          name: promo.name,
          type: promo.type,
          value: promo.value,
        },
      };
    }
  }

  return best;
}
