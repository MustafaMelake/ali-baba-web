import type { OrderView } from "@/components/orders/types";

/**
 * The order snapshot the admin board/drawer works with: the same fully-serialized
 * shape the storefront uses, plus the placing account's email (null for guests).
 */
export type AdminOrderView = OrderView & {
  userEmail: string | null;
  /** Name of the Branch this order is routed to, or null when unassigned
   *  (central / Super-Admin handled). */
  assignedBranchName: string | null;
};
