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

/**
 * Money is stored as Prisma `Decimal` (not Float) for currency safety, and
 * Prisma hands Decimal columns back as Decimal OBJECTS, not JS numbers. This
 * module is pure/framework-agnostic (it also runs on the client, e.g. the
 * checkout summary), so instead of importing Prisma's Decimal it accepts
 * anything number-like — a plain `number` or a Decimal (which exposes
 * `.toNumber()`) — and normalizes to a JS number at the boundary. Every value
 * this module RETURNS is a plain rounded `number`.
 */
export type Numeric = number | { toNumber(): number };

/** Coerce a `number` or a Prisma `Decimal` to a plain JS number. */
export function toNumber(value: Numeric): number {
  return typeof value === "number" ? value : value.toNumber();
}

/** The minimal promotion shape the resolver needs (subset of the Prisma row). */
export type PromotionLike = {
  id: string;
  name: string;
  /** A DiscountType value — "PERCENTAGE" | "FIXED_AMOUNT". */
  type: string;
  /** Percentage or fixed amount. Accepts a Prisma Decimal or a plain number. */
  value: Numeric;
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
 *  price and the billed price in lock-step — reused by `placeOrder` (VAT) and the
 *  checkout summary preview so a piastre is never silently dropped. */
export function roundMoney(n: Numeric): number {
  const x = toNumber(n);
  return Math.round((x + Number.EPSILON) * 100) / 100;
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
export function applyPromotion(basePrice: Numeric, promo: PromotionLike): number {
  const base = toNumber(basePrice);
  const value = toNumber(promo.value);
  if (base <= 0) return Math.max(0, roundMoney(base));
  const raw =
    promo.type === DiscountType.PERCENTAGE
      ? base * (1 - value / 100)
      : base - value;
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

// ─────────────────────────────────────────────────────────────────────────────
// BUSINESS RULE — "Cheapest Wins" (formally adopted; not implicit).
//
// When multiple live promotions target the same variant (via the variant, its
// parent product, or that product's category), they DO NOT STACK. Exactly ONE
// promotion is ever applied: the one producing the lowest final price for the
// customer. Ties are broken by first-found (strict `<` below). There is no
// stacking, no additive/compounding discounts, and no priority/exclusivity
// field — this single rule is the whole precedence model, by deliberate design.
//
// `ProductVariant.compareAtPrice` is NOT part of this math. It is a purely
// VISUAL marketing "was" price (a manual strikethrough); it never feeds the
// discount calculation and is only shown as a fallback when no live promotion
// applies. The billed price is always `resolvePrice().finalPrice`.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the final price for `basePrice` given a set of promotions. Only LIVE
 * promotions are considered; when several apply, the cheapest result wins (see
 * the "Cheapest Wins" rule above). Deterministic and pure — the storefront,
 * cart, checkout and `placeOrder` all call this so they can never disagree.
 * Accepts a Prisma `Decimal` or a plain `number` for `basePrice`.
 */
export function resolvePrice(
  basePrice: Numeric,
  promotions: PromotionLike[] | null | undefined,
  now: Date = new Date(),
): PricedResult {
  const base = toNumber(basePrice);
  let best: PricedResult = {
    basePrice: base,
    finalPrice: roundMoney(base),
    discountAmount: 0,
    hasDiscount: false,
    appliedPromotion: null,
  };

  for (const promo of promotions ?? []) {
    if (!isPromotionLive(promo, now)) continue;
    const candidate = applyPromotion(base, promo);
    if (candidate < best.finalPrice) {
      best = {
        basePrice: base,
        finalPrice: candidate,
        discountAmount: roundMoney(base - candidate),
        hasDiscount: candidate < base,
        appliedPromotion: {
          id: promo.id,
          name: promo.name,
          type: promo.type,
          value: toNumber(promo.value),
        },
      };
    }
  }

  return best;
}
