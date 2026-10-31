"use server";

// ─────────────────────────────────────────────────────────────────────────────
// Branch stock — a branch-local "out of stock" switch under the global flags.
//
//   - setBranchStock       → ADMIN (any branch) or MANAGER (own branch only).
//     Writes ONLY BranchVariantAvailability rows: the product's name, price,
//     category, images and global isAvailable stay ADMIN-only
//     (src/app/admin/products/actions.ts, gated by ensureAdmin).
//   - getBranchStockIssues → PUBLIC read for the checkout preview. It reveals
//     only what the order would be refused for anyway.
//
// The rule both sides apply lives in src/lib/catalog.ts (isAvailableAtBranch /
// branchOutOfStockMessage); placeOrder enforces it authoritatively.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import {
  requireDashboardAccess,
  resolveBranchScope,
  type DashboardScope,
} from "@/lib/session";
import { prismaErrorCode } from "@/lib/action-utils";
import {
  branchOutOfStockMessage,
  branchSoldOutTodayMessage,
  isSoldOutToday,
} from "@/lib/catalog";
import {
  branchStockSchema,
  CHECKOUT_MAX_ITEMS,
  type BranchStockInput,
} from "@/lib/validators";

export type SetBranchStockResult =
  | { success: true; updated: number }
  | { success: false; error: string };

/**
 * Mark one or more variants in / out of stock at a branch. A MANAGER is pinned
 * to their own branch (scope resolved LIVE from the DB, so a reassigned manager
 * loses the old branch on their next click); an ADMIN must name one.
 */
export async function setBranchStock(
  input: BranchStockInput,
): Promise<SetBranchStockResult> {
  let scope: DashboardScope;
  try {
    scope = await requireDashboardAccess();
  } catch {
    return { success: false, error: "Unauthorized." };
  }

  const parsed = branchStockSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid stock change.",
    };
  }
  const { variantIds, isAvailable } = parsed.data;

  let branchId: string | undefined;
  try {
    branchId = resolveBranchScope(scope, parsed.data.branchId);
  } catch {
    return {
      success: false,
      error: "Unauthorized: you can only manage your own branch's stock.",
    };
  }
  // Only an ADMIN can get here without a branch — "all branches" is not a
  // stock location.
  if (!branchId) return { success: false, error: "Choose a branch first." };

  try {
    // Two set-based statements for any number of variants (bounded by
    // BRANCH_STOCK_MAX_VARIANTS): insert the missing rows, then set the flag on
    // all of them. Insert-THEN-update keeps concurrent toggles last-writer-wins
    // — a racing insert blocks on the first, skips, and its update lands after.
    await prisma.$transaction([
      prisma.branchVariantAvailability.createMany({
        data: variantIds.map((variantId) => ({ branchId, variantId, isAvailable })),
        skipDuplicates: true,
      }),
      prisma.branchVariantAvailability.updateMany({
        where: { branchId, variantId: { in: variantIds } },
        data: { isAvailable },
      }),
    ]);

    // Only the console renders branch stock: the storefront's cached catalog
    // is branch-agnostic, and checkout reads it live (getBranchStockIssues).
    revalidatePath("/admin/inventory");
    return { success: true, updated: variantIds.length };
  } catch (err) {
    if (prismaErrorCode(err) === "P2003") {
      return {
        success: false,
        error: "That branch or item no longer exists. Refresh and try again.",
      };
    }
    console.error("setBranchStock failed:", err);
    return { success: false, error: "Could not update branch stock." };
  }
}

export type BranchStockIssue = { variantId: string; message: string };

export type BranchStockIssuesResult =
  | { success: true; issues: BranchStockIssue[] }
  | { success: false; error: string };

/**
 * Checkout preview: which cart lines are switched off at the chosen branch.
 * Public (guest checkout exists) and read-only.
 *
 * Mirrors placeOrder exactly: an unknown / inactive branch is "unassigned"
 * there (no branch check), so it reports nothing here; a globally unavailable
 * variant is placeOrder's "no longer available" case, not a branch stock-out,
 * so it is left out. The messages are placeOrder's own wording.
 */
export async function getBranchStockIssues(
  variantIds: string[],
  branchId: string | null,
): Promise<BranchStockIssuesResult> {
  const ids = [
    ...new Set(
      (variantIds ?? [])
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter(Boolean),
    ),
  ].slice(0, CHECKOUT_MAX_ITEMS);

  if (!branchId || ids.length === 0) return { success: true, issues: [] };

  try {
    // One instant for the whole preview — the same `now` the sold-out-today
    // filter and the per-row message decision both read.
    const now = new Date();
    const [branch, rows] = await Promise.all([
      prisma.branch.findFirst({
        where: { id: branchId, isActive: true },
        select: { name: true },
      }),
      prisma.branchVariantAvailability.findMany({
        where: {
          branchId,
          variantId: { in: ids },
          // Off long-term OR sold out today — either way the order would be
          // refused, so both are surfaced here.
          OR: [{ isAvailable: false }, { soldOutUntil: { gt: now } }],
          variant: { isAvailable: true, product: { isAvailable: true } },
        },
        select: {
          variantId: true,
          isAvailable: true,
          soldOutUntil: true,
          variant: { select: { name: true, product: { select: { name: true } } } },
        },
      }),
    ]);

    if (!branch) return { success: true, issues: [] };

    return {
      success: true,
      issues: rows.map((row) => ({
        variantId: row.variantId,
        // A row off long-term (isAvailable: false) reads as a stock-out even if
        // it also carries a stale soldOutUntil; only a still-live row counts as
        // "sold out today".
        message: isSoldOutToday(row, now)
          ? branchSoldOutTodayMessage(
              row.variant.product.name,
              row.variant.name,
              branch.name,
            )
          : branchOutOfStockMessage(
              row.variant.product.name,
              row.variant.name,
              branch.name,
            ),
      })),
    };
  } catch (err) {
    console.error("getBranchStockIssues failed:", err);
    return { success: false, error: "Could not check branch stock." };
  }
}
