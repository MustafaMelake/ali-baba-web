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

/**
 * Variants orderable at `branchId`: globally available AND not switched off at
 * that branch. The relation filter is `none` (not `some … true`) because a
 * variant with no override row must still match.
 */
export function variantAvailableAtBranch(
  branchId: string,
): Prisma.ProductVariantWhereInput {
  return {
    isAvailable: true,
    branchAvailability: { none: { branchId, isAvailable: false } },
  };
}

/** `LISTABLE_PRODUCT`, narrowed to products with a variant in stock at `branchId`. */
export function listableProductAtBranch(
  branchId: string,
): Prisma.ProductWhereInput {
  return {
    isAvailable: true,
    variants: { some: variantAvailableAtBranch(branchId) },
  };
}

/**
 * The in-memory form of the same rule, for rows already loaded with their
 * branch override (`branchAvailable` is that row's flag; `null`/`undefined`
 * when there is none). Used where the variant is fetched for other reasons
 * too — `placeOrder`'s batched read — so the decision never drifts from the
 * `where` helpers above.
 */
export function isAvailableAtBranch(line: {
  productAvailable: boolean;
  variantAvailable: boolean;
  branchAvailable?: boolean | null;
}): boolean {
  return (
    line.productAvailable &&
    line.variantAvailable &&
    line.branchAvailable !== false
  );
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
