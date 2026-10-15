// ─────────────────────────────────────────────────────────────────────────────
// Cart summary preview — the money figures on the /cart page.
//
// DISPLAY ONLY: placeOrder re-derives every figure server-side and is the sole
// authority on what's billed. This mirrors its ORDER OF OPERATIONS so the
// preview can't drift from the bill (see business-logic.md "Money math"):
//   discounted line prices → subtotal = roundMoney(Σ price × qty)
//   → VAT = roundMoney(subtotal × vatRate), on the DISCOUNTED subtotal
//   → delivery is added at checkout, once the area is known.
// No discount math lives here — line prices arrive already resolved by the
// Discount Engine; "savings" only compares them with the live "was" price.
// ─────────────────────────────────────────────────────────────────────────────

import { roundMoney } from "@/lib/discounts";
import type { PricingSettings } from "@/lib/store-settings";

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
  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.price * line.quantity, 0));
  const savings = roundMoney(
    lines.reduce((sum, line) => {
      const was = wasPriceOf(line.variantId);
      return was != null && was > line.price ? sum + (was - line.price) * line.quantity : sum;
    }, 0),
  );
  const vat = pricing?.isVatEnabled ? roundMoney(subtotal * pricing.vatRate) : 0;

  return {
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    originalTotal: roundMoney(subtotal + savings),
    savings,
    subtotal,
    vat,
    vatPercent: pricing ? +(pricing.vatRate * 100).toFixed(2) : 0,
    totalBeforeDelivery: roundMoney(subtotal + vat),
  };
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
