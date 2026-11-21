// ─────────────────────────────────────────────────────────────────────────────
// Order totals — the money order of operations, in ONE place.
//
// `orderTotals` is the single implementation of business-logic.md "Money
// math", and all three surfaces call it: the /cart preview, the checkout
// preview, and placeOrder's billing. The shown total and the billed total are
// therefore the same code, not two copies kept in step:
//   discounted line prices → subtotal = roundMoney(Σ price × qty)
//   → VAT = roundMoney(subtotal × vatRate), on the DISCOUNTED subtotal
//   → deliveryFee = roundMoney(fee) → total = roundMoney(subtotal + fee + VAT).
// Pure (no Prisma), so it runs on the client and the server alike. No discount
// math lives here — line prices arrive already resolved by the Discount
// Engine; "savings" only compares them with the live "was" price.
// ─────────────────────────────────────────────────────────────────────────────

import { roundMoney } from "@/lib/discounts";
import type { PricingSettings } from "@/lib/store-settings";

/** A priced line — `price` is the discounted unit price that gets billed. */
export interface PricedLine {
  price: number;
  quantity: number;
}

export interface OrderTotals {
  subtotal: number;
  vat: number;
  deliveryFee: number;
  total: number;
}

/** Σ price × qty, rounded once — the base both VAT and the total build on. */
export function subtotalOf(lines: readonly PricedLine[]): number {
  return roundMoney(lines.reduce((sum, line) => sum + line.price * line.quantity, 0));
}

/**
 * THE money order of operations (four rounding points; never reorder). VAT is
 * charged on the rounded, discounted subtotal and never on delivery.
 * `deliveryFee` is the fee already resolved for the order (0 for pickup).
 */
export function orderTotals(
  lines: readonly PricedLine[],
  pricing: Pick<PricingSettings, "vatRate" | "isVatEnabled">,
  deliveryFee: number,
): OrderTotals {
  const subtotal = subtotalOf(lines);
  const vat = pricing.isVatEnabled ? roundMoney(subtotal * pricing.vatRate) : 0;
  const fee = roundMoney(deliveryFee);
  return { subtotal, vat, deliveryFee: fee, total: roundMoney(subtotal + fee + vat) };
}

/**
 * Price consent at checkout (audit H-3). The checkout sends the total it
 * DISPLAYED as `expectedTotal`; placeOrder bills its own fresh `orderTotals`
 * regardless, but refuses — before writing anything — when the two differ,
 * returning this summary so the customer can review and confirm the new total.
 * `expectedTotal` is only ever compared, never billed.
 */
export const PRICES_CHANGED = "PRICES_CHANGED";

export type PricesChangedSummary = {
  /** The total the checkout showed and sent. */
  expectedTotal: number;
  subtotal: number;
  deliveryFee: number;
  vat: number;
  /** The rate behind `vat` (0 when VAT is off) — for the "VAT (14%)" label only. */
  vatRate: number;
  /** What placeOrder will bill now; resubmit with this as `expectedTotal` to confirm. */
  total: number;
  /** Each line's fresh, discounted unit price. */
  lines: { variantId: string; productName: string; variantName: string; unitPrice: number; quantity: number }[];
};

/** Two money amounts are the same bill once both are on the 2-dp grid. */
export function sameTotal(a: number, b: number): boolean {
  return roundMoney(a) === roundMoney(b);
}

export interface SummaryLine {
  variantId: string;
  /** The live, discounted unit price (what placeOrder bills). */
  price: number;
  quantity: number;
}

export interface CartTotals {
  /** Units across all lines. */
  itemCount: number;
  /** Σ "was" price × qty — equals `subtotal` when nothing is marked down. */
  originalTotal: number;
  /** originalTotal − subtotal, never negative. */
  savings: number;
  subtotal: number;
  vat: number;
  /** Human VAT label — trailing zeros trimmed (0.14 → 14, 0.1425 → 14.25). */
  vatPercent: number;
  /** subtotal + VAT. Delivery is added at checkout. */
  totalBeforeDelivery: number;
}

/**
 * @param wasPriceOf the live struck-through price for a line (promotion base
 *   price or manual Compare-At), or null when it isn't marked down.
 * @param pricing the store's VAT settings, or null when they couldn't be read —
 *   VAT is then left out of every figure (shown as "calculated at checkout")
 *   rather than guessed from the schema defaults.
 */
export function summarizeCart(
  lines: SummaryLine[],
  wasPriceOf: (variantId: string) => number | null,
  pricing: PricingSettings | null,
): CartTotals {
  // Delivery is added at checkout, once the area is known — 0 here.
  const { subtotal, vat, total } = orderTotals(
    lines,
    pricing ?? { vatRate: 0, isVatEnabled: false },
    0,
  );
  const savings = roundMoney(
    lines.reduce((sum, line) => {
      const was = wasPriceOf(line.variantId);
      return was != null && was > line.price ? sum + (was - line.price) * line.quantity : sum;
    }, 0),
  );
  return {
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    originalTotal: roundMoney(subtotal + savings),
    savings,
    subtotal,
    vat,
    vatPercent: pricing ? +(pricing.vatRate * 100).toFixed(2) : 0,
    totalBeforeDelivery: total,
  };
}

/**
 * The VAT line's label: "VAT (14%)", trailing zeros trimmed ("VAT (14.25%)").
 * `null` — an order placed before its rate was recorded — names no rate
 * rather than guess one: the store's rate may have changed since.
 */
export function vatLabel(rate: number | null): string {
  return rate === null ? "VAT" : `VAT (${+(rate * 100).toFixed(2)}%)`;
}

/** What delivery can cost, across every active branch area and "Other Areas". */
export interface DeliveryEstimate {
  min: number;
  max: number;
  /** At least one active branch exists, so free pickup is offered. */
  pickupAvailable: boolean;
}

export function estimateDelivery(branchFees: number[], defaultFee: number): DeliveryEstimate {
  const fees = [...branchFees, defaultFee];
  return {
    min: Math.min(...fees),
    max: Math.max(...fees),
    pickupAvailable: branchFees.length > 0,
  };
}
