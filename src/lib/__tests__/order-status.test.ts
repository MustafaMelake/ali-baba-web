// ─────────────────────────────────────────────────────────────────────────────
// The order lifecycle graph (src/lib/order-status.ts) — audit M-3.
//
// Pins EVERY (from, to) pair for both fulfillment methods: the allowed steps
// are exactly the table below, nothing skips ahead to DELIVERED, and nothing
// leaves DELIVERED or CANCELLED.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { FulfillmentMethod, OrderStatus } from "@/generated/prisma/enums";
import {
  canTransitionOrder,
  isFinalOrderStatus,
  nextOrderStatuses,
  orderTransitionError,
} from "@/lib/order-status";

const { PENDING, PREPARING, SHIPPED, DELIVERED, CANCELLED } = OrderStatus;
const ALL = Object.values(OrderStatus);

/** The complete allowed set, written out independently of the implementation. */
const ALLOWED: Record<FulfillmentMethod, string[]> = {
  DELIVERY: [
    "PENDING→PREPARING",
    "PENDING→CANCELLED",
    "PREPARING→SHIPPED",
    "PREPARING→CANCELLED",
    "SHIPPED→DELIVERED",
    "SHIPPED→CANCELLED",
  ],
  PICKUP: [
    "PENDING→PREPARING",
    "PENDING→CANCELLED",
    "PREPARING→DELIVERED",
    "PREPARING→CANCELLED",
    "SHIPPED→DELIVERED", // legacy rows only
    "SHIPPED→CANCELLED",
  ],
};

describe("canTransitionOrder — every pair", () => {
  for (const fulfillment of Object.values(FulfillmentMethod)) {
    for (const from of ALL) {
      for (const to of ALL) {
        const key = `${from}→${to}`;
        const allowed = ALLOWED[fulfillment].includes(key);
        it(`${fulfillment}: ${key} is ${allowed ? "allowed" : "FORBIDDEN"}`, () => {
          expect(canTransitionOrder(fulfillment, from, to)).toBe(allowed);
        });
      }
    }
  }
});

describe("the forbidden jumps the audit called out", () => {
  it.each([
    [FulfillmentMethod.DELIVERY, PENDING],
    [FulfillmentMethod.DELIVERY, PREPARING], // skips SHIPPED
    [FulfillmentMethod.DELIVERY, CANCELLED],
    [FulfillmentMethod.PICKUP, PENDING], // skips PREPARING
    [FulfillmentMethod.PICKUP, CANCELLED],
  ])("%s: %s → DELIVERED is refused (skips steps / leaves a final state)", (fulfillment, from) => {
    expect(canTransitionOrder(fulfillment, from, DELIVERED)).toBe(false);
  });

  it.each(ALL)("DELIVERED → %s is refused for both methods (DELIVERED is final)", (to) => {
    expect(canTransitionOrder(FulfillmentMethod.DELIVERY, DELIVERED, to)).toBe(false);
    expect(canTransitionOrder(FulfillmentMethod.PICKUP, DELIVERED, to)).toBe(false);
  });

  it.each(ALL)("CANCELLED → %s is refused (un-cancelling would also dodge the phone throttle)", (to) => {
    expect(canTransitionOrder(FulfillmentMethod.DELIVERY, CANCELLED, to)).toBe(false);
    expect(canTransitionOrder(FulfillmentMethod.PICKUP, CANCELLED, to)).toBe(false);
  });

  it("a pickup is never shipped", () => {
    expect(canTransitionOrder(FulfillmentMethod.PICKUP, PREPARING, SHIPPED)).toBe(false);
  });
});

describe("helpers", () => {
  it("nextOrderStatuses lists the allowed next steps; empty once final", () => {
    expect(nextOrderStatuses(FulfillmentMethod.DELIVERY, PENDING)).toEqual([PREPARING, CANCELLED]);
    expect(nextOrderStatuses(FulfillmentMethod.PICKUP, PREPARING)).toEqual([DELIVERED, CANCELLED]);
    expect(nextOrderStatuses(FulfillmentMethod.DELIVERY, DELIVERED)).toEqual([]);
  });

  it("isFinalOrderStatus is exactly DELIVERED and CANCELLED", () => {
    expect(ALL.filter(isFinalOrderStatus)).toEqual([DELIVERED, CANCELLED]);
  });

  it("explains a refusal in staff terms", () => {
    expect(orderTransitionError(FulfillmentMethod.DELIVERY, PENDING, DELIVERED)).toBe(
      "A Pending order can't go straight to Delivered — next it can only be Preparing or Cancelled.",
    );
    expect(orderTransitionError(FulfillmentMethod.DELIVERY, DELIVERED, PENDING)).toBe(
      "This order is already Delivered — that's final, so it can't be changed to Pending.",
    );
  });
});
