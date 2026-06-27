import type { OrderView } from "@/components/orders/types";

/**
 * The order snapshot the admin board/drawer works with: the same fully-serialized
 * shape the storefront uses, plus the placing account's email (null for guests).
 */
export type AdminOrderView = OrderView & {
  userEmail: string | null;
  // Branch routing surfaces via OrderView.branchName ("Assigned to" in the drawer).
};
