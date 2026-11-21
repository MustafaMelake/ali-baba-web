// ─────────────────────────────────────────────────────────────────────────────
// Order lifecycle — the ONE graph of allowed status changes (audit M-3).
//
// Revenue counts DELIVERED orders only, so a free-for-all status control let
// anyone with staff access rewrite revenue: un-deliver an order, deliver a
// cancelled one, or jump PENDING → DELIVERED with nothing prepared. Every
// change now has to be one step along this graph; DELIVERED and CANCELLED are
// final. updateOrderStatus enforces it (and writes it conditionally on the
// status it read, so two staff clicking at once can't both win); the admin
// drawer offers only the next allowed steps from the same table.
//
// Plain + pure (no Prisma client, no React) so the server action and the
// client drawer share it.
// ─────────────────────────────────────────────────────────────────────────────

import { FulfillmentMethod, OrderStatus } from "@/generated/prisma/enums";

type Graph = Record<OrderStatus, readonly OrderStatus[]>;

/**
 * Allowed next statuses, per fulfillment method.
 *
 *   DELIVERY: PENDING → PREPARING → SHIPPED → DELIVERED
 *   PICKUP:   PENDING → PREPARING → DELIVERED   (collected at the branch; never shipped)
 *
 * Any non-final step may be CANCELLED (a COD order refused at the door is
 * cancelled from SHIPPED). DELIVERED and CANCELLED are final — correcting a
 * mis-click there is a deliberate data fix, not a status click.
 */
export const ORDER_STATUS_TRANSITIONS: Record<FulfillmentMethod, Graph> = {
  [FulfillmentMethod.DELIVERY]: {
    [OrderStatus.PENDING]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
    [OrderStatus.PREPARING]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
    [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
    [OrderStatus.DELIVERED]: [],
    [OrderStatus.CANCELLED]: [],
  },
  [FulfillmentMethod.PICKUP]: {
    [OrderStatus.PENDING]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
    [OrderStatus.PREPARING]: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
    // Never entered by a pickup today; a legacy row marked SHIPPED can still finish.
    [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
    [OrderStatus.DELIVERED]: [],
    [OrderStatus.CANCELLED]: [],
  },
};

/** The statuses an order may move to next (empty once it's final). */
export function nextOrderStatuses(
  fulfillment: FulfillmentMethod,
  from: OrderStatus,
): readonly OrderStatus[] {
  return ORDER_STATUS_TRANSITIONS[fulfillment]?.[from] ?? [];
}

/** Whether `from → to` is one allowed step. Staying put is not a transition. */
export function canTransitionOrder(
  fulfillment: FulfillmentMethod,
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  return nextOrderStatuses(fulfillment, from).includes(to);
}

/** Final statuses — nothing follows them. */
export function isFinalOrderStatus(status: OrderStatus): boolean {
  return status === OrderStatus.DELIVERED || status === OrderStatus.CANCELLED;
}

const label = (s: OrderStatus) => s.charAt(0) + s.slice(1).toLowerCase();

/** The staff-facing refusal for a step outside the graph. */
export function orderTransitionError(
  fulfillment: FulfillmentMethod,
  from: OrderStatus,
  to: OrderStatus,
): string {
  if (isFinalOrderStatus(from)) {
    return `This order is already ${label(from)} — that's final, so it can't be changed to ${label(to)}.`;
  }
  const next = nextOrderStatuses(fulfillment, from).map(label).join(" or ");
  return `A ${label(from)} order can't go straight to ${label(to)} — next it can only be ${next}.`;
}
