import type { Prisma } from "@/generated/prisma/client";

/**
 * A product is listable only if it AND at least one of its variants is
 * available. Every catalog surface (shop, category, new arrivals, search) pairs
 * this with `variants: { where: { isAvailable: true } }`, so a card's starting
 * variant — the price it shows and the variant quick-add charges — can never be
 * an archived one that `placeOrder` would reject.
 *
 * A plain module so the `"use server"` search actions can import it too.
 */
export const LISTABLE_PRODUCT = {
  isAvailable: true,
  variants: { some: { isAvailable: true } },
} satisfies Prisma.ProductWhereInput;

// ─── Branch-level stock ──────────────────────────────────────────────────────
// The ADMIN's global flags are the master kill-switch; a branch override
// (BranchVariantAvailability) can only take a variant AWAY at that branch. No
// override row means available, which is why every check below reads
// "not explicitly false" rather than "true".
//
// A branch override takes a variant away in one of TWO independent ways:
//   - isAvailable: false  → the head-office LONG-TERM switch (until turned back on).
//   - soldOutUntil > now  → a MANAGER's "Sold out today", expiring on its own at
//     the next Cairo midnight. null/past = not sold out today.
// Both are read against a single `now` captured once per request, so a mark
// expiring mid-render can't flip a decision halfway.

/**
 * Variants orderable at `branchId` at `now`: globally available AND neither
 * switched off long-term nor sold out today at that branch. The relation filter
 * is `none` (not `some … true`) because a variant with no override row must
 * still match.
 */
export function variantAvailableAtBranch(
  branchId: string,
  now: Date,
): Prisma.ProductVariantWhereInput {
  return {
    isAvailable: true,
    branchAvailability: {
      none: { branchId, OR: [{ isAvailable: false }, { soldOutUntil: { gt: now } }] },
    },
  };
}

/** `LISTABLE_PRODUCT`, narrowed to products with a variant in stock at `branchId` at `now`. */
export function listableProductAtBranch(
  branchId: string,
  now: Date,
): Prisma.ProductWhereInput {
  return {
    isAvailable: true,
    variants: { some: variantAvailableAtBranch(branchId, now) },
  };
}

/**
 * The in-memory form of the same rule, for rows already loaded with their
 * branch override (`branchAvailable` is that row's `isAvailable` flag and
 * `soldOutUntil` its sold-out-today instant; both `null`/`undefined` when there
 * is no override row). Used where the variant is fetched for other reasons
 * too — `placeOrder`'s batched read — so the decision never drifts from the
 * `where` helpers above. Compares `soldOutUntil` to the caller's single `now`.
 */
export function isAvailableAtBranch(
  line: {
    productAvailable: boolean;
    variantAvailable: boolean;
    branchAvailable?: boolean | null;
    soldOutUntil?: Date | null;
  },
  now: Date,
): boolean {
  return (
    line.productAvailable &&
    line.variantAvailable &&
    line.branchAvailable !== false &&
    !(line.soldOutUntil != null && line.soldOutUntil > now)
  );
}

/** True when the branch override puts the variant off TODAY only (sold out, not head-office off). */
export function isSoldOutToday(
  override: { isAvailable?: boolean | null; soldOutUntil?: Date | null } | null | undefined,
  now: Date,
): boolean {
  if (!override) return false;
  return override.isAvailable !== false && override.soldOutUntil != null && override.soldOutUntil > now;
}

/** "Chocolate Cake (Large)" — names the exact line, since one size can be out while another isn't. */
export function variantLabel(productName: string, variantName: string): string {
  return variantName ? `${productName} (${variantName})` : productName;
}

/**
 * The one customer-facing wording for a branch stock-out — shared by the
 * checkout preview and `placeOrder`, so the warning the customer sees before
 * submitting is word-for-word the refusal they'd get from the server.
 */
export function branchOutOfStockMessage(
  productName: string,
  variantName: string,
  branchName: string,
): string {
  return `${variantLabel(productName, variantName)} is currently out of stock at the ${branchName} branch.`;
}

/**
 * The customer-facing wording for a line a MANAGER marked "sold out today" —
 * distinct from a head-office stock-out, because it comes back on its own at
 * midnight. Shared by the checkout preview and `placeOrder` so the warning and
 * the refusal read the same.
 */
export function branchSoldOutTodayMessage(
  productName: string,
  variantName: string,
  branchName: string,
): string {
  return `${variantLabel(productName, variantName)} is sold out at the ${branchName} branch today.`;
}
