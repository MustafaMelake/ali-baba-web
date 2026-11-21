// @vitest-environment jsdom
// ─────────────────────────────────────────────────────────────────────────────
// PricesChangedNotice — the checkout's price-consent step (audit H-3).
//
// Pins: it shows the SERVER's new totals (never a client-computed figure), the
// total the customer saw, and which lines changed; Confirm calls back so the
// page resubmits at the new total; Review dismisses; both lock while pending.
// ─────────────────────────────────────────────────────────────────────────────

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PricesChangedNotice, { PRICES_CHANGED_COPY } from "@/components/cart/PricesChangedNotice";
import type { PricesChangedSummary } from "@/lib/cart-summary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SUMMARY: PricesChangedSummary = {
  expectedTotal: 91.2,
  subtotal: 100,
  deliveryFee: 0,
  vat: 14,
  vatRate: 0.14,
  total: 114,
  lines: [
    { variantId: "v1", productName: "Kunafa", variantName: "Tray", unitPrice: 100, quantity: 1 },
    { variantId: "v2", productName: "Basbousa", variantName: "Piece", unitPrice: 25, quantity: 2 },
  ],
};

let container: HTMLDivElement;
let root: Root;

function render(props: Partial<Parameters<typeof PricesChangedNotice>[0]> = {}) {
  const onConfirm = vi.fn();
  const onDismiss = vi.fn();
  act(() => {
    root.render(
      <PricesChangedNotice
        summary={SUMMARY}
        previousPrices={new Map([["v1", 80], ["v2", 25]])}
        pickup
        pending={false}
        onConfirm={onConfirm}
        onDismiss={onDismiss}
        {...props}
      />,
    );
  });
  return { onConfirm, onDismiss };
}

const button = (text: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PricesChangedNotice", () => {
  it("announces the change and shows the server's new totals next to the total the customer saw", () => {
    render();
    const alert = container.querySelector('[role="alert"]')!;
    const text = alert.textContent!;

    expect(text).toContain(PRICES_CHANGED_COPY.title);
    expect(text).toContain("114"); // new total (server)
    expect(text).toContain("91.2"); // what they saw
    expect(text).toContain("VAT (14%)");
    expect(text).toContain("Free"); // pickup is free
  });

  it("names only the lines whose price changed", () => {
    render();
    const items = [...container.querySelectorAll("li")].map((li) => li.textContent);

    expect(items).toHaveLength(1);
    expect(items[0]).toContain("Kunafa — Tray");
    expect(items[0]).toMatch(/80.*100/);
  });

  it("Confirm calls back (the page resubmits at summary.total); Review dismisses", () => {
    const { onConfirm, onDismiss } = render();

    act(() => button("Confirm and place order").click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(button("Confirm and place order").textContent).toContain("114");

    act(() => button(PRICES_CHANGED_COPY.dismiss).click());
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("locks both buttons while the confirmed order is in flight", () => {
    render({ pending: true });

    expect(button(PRICES_CHANGED_COPY.confirming).disabled).toBe(true);
    expect(button(PRICES_CHANGED_COPY.dismiss).disabled).toBe(true);
  });

  it("labels the fee as Delivery for a delivery order", () => {
    render({ pickup: false, summary: { ...SUMMARY, deliveryFee: 35, total: 149 } });
    expect(container.textContent).toContain("Delivery");
    expect(container.textContent).toContain("35");
  });
});
