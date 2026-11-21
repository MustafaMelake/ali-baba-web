import type { OrderView } from "@/components/orders/types";

/**
 * The order snapshot the admin board/drawer works with: the same fully-serialized
 * shape the storefront uses, plus the placing account's email (null for guests).
 */
export type AdminOrderView = OrderView & {
  userEmail: string | null;
  /**
   * Audit M-3 — who last moved the order's status and when, e.g.
   * "Amira Saleh · 21 Nov 2026 · 14:30" (Cairo time). Null until the first
   * change after tracking began; "a deleted account" when that user is gone.
   */
  statusChangedLabel: string | null;
  // Branch routing surfaces via OrderView.branchName ("Assigned to" in the drawer).
};
