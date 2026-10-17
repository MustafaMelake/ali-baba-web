// ─────────────────────────────────────────────────────────────────────────────
// Cart summary preview — unit suite (src/lib/cart-summary.ts).
//
// The /cart page previews what checkout will bill. These tests pin that the
// preview follows placeOrder's order of operations (business-logic.md "Money
// math"): discounted lines → roundMoney(subtotal) → VAT on the DISCOUNTED
// subtotal; that "savings" only counts genuine markdowns; and that float sums
// never leak off the 2-dp grid. Pure functions — no mocks.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  estimateDelivery,
  orderTotals,
  summarizeCart,
  type SummaryLine,
  vatLabel,
} from "@/lib/cart-summary";
import type { PricingSettings } from "@/lib/store-settings";

const VAT_14: PricingSettings = { vatRate: 0.14, isVatEnabled: true, defaultDeliveryFee: 35 };
const NO_VAT: PricingSettings = { ...VAT_14, isVatEnabled: false };
const none = () => null;

function lines(...specs: Array<[string, number, number]>): SummaryLine[] {
  return specs.map(([variantId, price, quantity]) => ({ variantId, price, quantity }));
}

describe("summarizeCart", () => {
  it("rounds the subtotal, then charges VAT on it, then adds them", () => {
    const totals = summarizeCart(lines(["a", 120, 2], ["b", 35.5, 1]), none, VAT_14);

    expect(totals.subtotal).toBe(275.5);
    expect(totals.vat).toBe(38.57); // roundMoney(275.5 × 0.14 = 38.57)
    expect(totals.totalBeforeDelivery).toBe(314.07);
    expect(totals.itemCount).toBe(3);
    expect(totals.vatPercent).toBe(14);
  });

  it("keeps float sums on the 2-dp grid", () => {
    const totals = summarizeCart(lines(["a", 0.1, 3], ["b", 0.2, 1]), none, NO_VAT);

    expect(totals.subtotal).toBe(0.5); // not 0.5000000000000001
    expect(totals.totalBeforeDelivery).toBe(0.5);
  });

  it("rounds the subtotal BEFORE taxing it, as placeOrder does", () => {
    // 4.3 × 3 + 2.35 sums to 15.249999999999998 in floats. Taxed raw, that's
    // 2.13 VAT; placeOrder taxes the rounded 15.25 and bills 2.14.
    const totals = summarizeCart(lines(["a", 4.3, 3], ["b", 2.35, 1]), none, VAT_14);

    expect(totals.subtotal).toBe(15.25);
    expect(totals.vat).toBe(2.14);
    expect(totals.totalBeforeDelivery).toBe(17.39);
  });

  it("leaves VAT out when the settings couldn't be read", () => {
    const totals = summarizeCart(lines(["a", 100, 1]), none, null);

    expect(totals.vat).toBe(0);
    expect(totals.vatPercent).toBe(0);
    expect(totals.totalBeforeDelivery).toBe(100);
  });

  it("charges no VAT when it's switched off", () => {
    const totals = summarizeCart(lines(["a", 100, 1]), none, NO_VAT);

    expect(totals.vat).toBe(0);
    expect(totals.totalBeforeDelivery).toBe(100);
  });

  it("taxes the DISCOUNTED subtotal — savings never raise the VAT base", () => {
    // 200 marked down to 150 (×2): VAT is on 300, not on 400.
    const was = (id: string) => (id === "a" ? 200 : null);
    const totals = summarizeCart(lines(["a", 150, 2]), was, VAT_14);

    expect(totals.originalTotal).toBe(400);
    expect(totals.savings).toBe(100);
    expect(totals.subtotal).toBe(300);
    expect(totals.vat).toBe(42);
    expect(totals.totalBeforeDelivery).toBe(342);
  });

  it("counts only genuine markdowns as savings", () => {
    const was = (id: string) => ({ up: 90, same: 100, down: 120 })[id] ?? null;
    const totals = summarizeCart(
      lines(["up", 100, 1], ["same", 100, 1], ["down", 100, 1], ["plain", 100, 1]),
      was,
      NO_VAT,
    );

    expect(totals.savings).toBe(20); // only "down"
    expect(totals.originalTotal).toBe(420);
  });

  it("trims the VAT label (0.1425 → 14.25)", () => {
    expect(summarizeCart([], none, { ...VAT_14, vatRate: 0.1425 }).vatPercent).toBe(14.25);
  });

  it("summarizes an empty cart as zeros", () => {
    expect(summarizeCart([], none, VAT_14)).toMatchObject({
      itemCount: 0,
      subtotal: 0,
      vat: 0,
      savings: 0,
      totalBeforeDelivery: 0,
    });
  });
});

describe("estimateDelivery", () => {
  it("spans every active branch fee plus the 'Other Areas' default", () => {
    expect(estimateDelivery([25, 40], 35)).toEqual({ min: 25, max: 40, pickupAvailable: true });
    expect(estimateDelivery([50], 35)).toEqual({ min: 35, max: 50, pickupAvailable: true });
  });

  it("offers no pickup without an active branch", () => {
    expect(estimateDelivery([], 35)).toEqual({ min: 35, max: 35, pickupAvailable: false });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// orderTotals — THE order of operations, shared by /cart, checkout and placeOrder
// ─────────────────────────────────────────────────────────────────────────────

describe("orderTotals", () => {
  it("rounds the subtotal, taxes it, adds delivery, then rounds the total", () => {
    const totals = orderTotals(lines(["a", 120, 2], ["b", 35.5, 1]), VAT_14, 35);

    expect(totals).toEqual({
      subtotal: 275.5,
      vat: 38.57, // roundMoney(275.5 × 0.14)
      deliveryFee: 35,
      total: 349.07,
    });
  });

  it("keeps an accumulated subtotal on the 2-dp grid (3 × 33.33)", () => {
    const totals = orderTotals(lines(["a", 33.33, 3]), VAT_14, 0);

    expect(totals.subtotal).toBe(99.99); // not 99.99000000000001
    expect(totals.vat).toBe(14); // roundMoney(99.99 × 0.14 = 13.9986)
    expect(totals.total).toBe(113.99);
  });

  it("taxes the subtotal only — never the delivery fee", () => {
    const totals = orderTotals(lines(["a", 100, 1]), VAT_14, 50);

    expect(totals.vat).toBe(14);
    expect(totals.total).toBe(164);
  });

  it("charges no VAT when it's switched off", () => {
    const totals = orderTotals(lines(["a", 100, 1]), NO_VAT, 35);

    expect(totals.vat).toBe(0);
    expect(totals.total).toBe(135);
  });

  it("rounds a delivery fee that arrives off the 2-dp grid", () => {
    expect(orderTotals(lines(["a", 10, 1]), NO_VAT, 12.345).deliveryFee).toBe(12.35);
  });
});

describe("vatLabel — the VAT line's label on summaries and receipts", () => {
  it.each([
    [0.14, "VAT (14%)"],
    [0.1425, "VAT (14.25%)"],
    [0, "VAT (0%)"],
  ])("rate %s reads %s", (rate, label) => {
    expect(vatLabel(rate)).toBe(label);
  });

  it("names no rate for an order placed before rates were recorded", () => {
    expect(vatLabel(null)).toBe("VAT");
  });
});
