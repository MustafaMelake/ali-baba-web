import type {
  OrderStatus,
  FulfillmentMethod,
  DeliveryLocation,
} from "@/generated/prisma/enums";

/** A single purchased line, snapshotted at order time. */
export type OrderItemView = {
  id: string;
  productName: string;
  variantName: string;
  quantity: number;
  unitPrice: number; // raw EGP — formatted with formatEGP() in the client
  lineTotal: number; // unitPrice * quantity
};

/**
 * Fully serialized order snapshot handed from the server page to the order
 * card + detail drawer. Money is kept as raw numbers (formatted client-side);
 * dates are pre-formatted server-side to stay hydration-safe.
 */
export type OrderView = {
  id: string;
  orderNumber: number;
  status: OrderStatus;

  // Pre-formatted on the server (no client locale/timezone drift).
  dateLabel: string; // e.g. "21 Jun 2026"
  dateTimeLabel: string; // e.g. "21 June 2026 · 14:30"

  // Customer profile
  customerName: string;
  customerPhone: string;
  orderNotes: string | null;

  // Fulfillment logistics
  fulfillment: FulfillmentMethod;
  deliveryCity: DeliveryLocation | null;
  addressLine: string | null;
  pickupBranch: string | null;
  /** Name of the assigned Branch — the delivery area / fulfilling branch — or
   *  null when unassigned (routed to central / Super Admin). */
  branchName: string | null;

  // Financials (raw EGP). `vat` is the residual total − subtotal − delivery so
  // the receipt always reconciles to the canonical `totalAmount`.
  subtotal: number;
  vat: number;
  deliveryFee: number;
  totalAmount: number;

  itemCount: number;
  items: OrderItemView[];
};
