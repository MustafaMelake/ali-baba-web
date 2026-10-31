"use server";

// ─────────────────────────────────────────────────────────────────────────────
// Branch stock — a branch-local "out of stock" switch under the global flags.
//
//   - setBranchStock       → ADMIN (any branch) or MANAGER (own branch only).
//     Writes ONLY BranchVariantAvailability rows: the product's name, price,
//     category, images and global isAvailable stay ADMIN-only
//     (src/app/admin/products/actions.ts, gated by ensureAdmin).
//   - markSoldOutToday /    → MANAGER only (own branch). Stamp/clear
//     clearSoldOutToday        soldOutUntil (the next Cairo midnight), a stock-out
//     that expires on its own. Never touches the head-office isAvailable switch.
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
  soldOutTodaySchema,
  type BranchStockInput,
  type SoldOutTodayInput,
} from "@/lib/validators";
import { nextStoreMidnight } from "@/lib/timezone";

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
        // Restocking long-term also clears any lingering "sold out today" mark —
        // "in stock" from head office must truly mean orderable, not blocked by a
        // stale future soldOutUntil. Switching off leaves the mark (moot anyway).
        data: isAvailable ? { isAvailable, soldOutUntil: null } : { isAvailable },
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

// ─────────────────────────────────────────────────────────────────────────────
// "Sold out today" — a MANAGER-only, self-expiring branch stock-out.
//
// Distinct from setBranchStock's head-office switch: this stamps soldOutUntil
// with the next Cairo midnight, so the variant comes back on its own with no
// cron and no manual undo. The branch is ALWAYS the manager's own (live DB
// scope) — never from the payload — and ADMIN / USER are refused server-side.
// ─────────────────────────────────────────────────────────────────────────────

export type SoldOutTodayResult =
  | { success: true; updated: number }
  | { success: false; error: string };

/**
 * Shared body for mark (soldOutUntil = next Cairo midnight) and clear
 * (soldOutUntil = null). MANAGER-only; the branch is the caller's own, resolved
 * live so a reassigned manager can't touch the old one.
 */
async function setSoldOutToday(
  input: SoldOutTodayInput,
  soldOutUntil: Date | null,
): Promise<SoldOutTodayResult> {
  let scope: DashboardScope;
  try {
    scope = await requireDashboardAccess();
  } catch {
    return { success: false, error: "Unauthorized." };
  }
  // MANAGER only, as requested: an ADMIN uses the Branch Stock screen; a USER
  // never gets past requireDashboardAccess. The branch comes from the scope.
  if (scope.role !== "MANAGER") {
    return { success: false, error: "Only branch managers can set today's stock." };
  }

  const parsed = soldOutTodaySchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid request.",
    };
  }
  const branchId = scope.branchId;
  const { productId, variantId } = parsed.data;

  try {
    // The sizes this touches: a product's AVAILABLE variants (the orderable
    // ones a manager can sell out), or the single named variant. A product's
    // head-office-off sizes are skipped — they're already unorderable.
    const variants = await prisma.productVariant.findMany({
      where: variantId
        ? { id: variantId, isAvailable: true }
        : { productId, isAvailable: true },
      select: { id: true },
    });
    const ids = variants.map((v) => v.id);
    if (ids.length === 0) {
      return {
        success: false,
        error: productId
          ? "That product no longer exists."
          : "That item is no longer available.",
      };
    }

    if (soldOutUntil) {
      // Insert any missing override rows, then stamp the expiry on all of them —
      // two set-based statements, last-writer-wins (mirrors setBranchStock). A
      // new row keeps its isAvailable default (true): this never switches a
      // variant off long-term.
      await prisma.$transaction([
        prisma.branchVariantAvailability.createMany({
          data: ids.map((id) => ({ branchId, variantId: id, soldOutUntil })),
          skipDuplicates: true,
        }),
        prisma.branchVariantAvailability.updateMany({
          where: { branchId, variantId: { in: ids } },
          data: { soldOutUntil },
        }),
      ]);
    } else {
      // Clearing never needs to create a row — a missing row is already
      // available — so one statement does it, and it never touches isAvailable.
      await prisma.branchVariantAvailability.updateMany({
        where: { branchId, variantId: { in: ids } },
        data: { soldOutUntil: null },
      });
    }

    revalidatePath("/admin/today");
    revalidatePath("/admin/inventory");
    return { success: true, updated: ids.length };
  } catch (err) {
    if (prismaErrorCode(err) === "P2003") {
      return {
        success: false,
        error: "That branch or item no longer exists. Refresh and try again.",
      };
    }
    console.error("setSoldOutToday failed:", err);
    return { success: false, error: "Could not update today's stock." };
  }
}

/** Mark a product's sizes (or one size) sold out at the manager's branch until the next Cairo midnight. */
export async function markSoldOutToday(
  input: SoldOutTodayInput,
): Promise<SoldOutTodayResult> {
  // One instant for this write; the expiry is tomorrow's Cairo midnight from it.
  const now = new Date();
  return setSoldOutToday(input, nextStoreMidnight(now));
}

/** Bring a sold-out-today product/size back now, at the manager's branch (never touches the head-office switch). */
export async function clearSoldOutToday(
  input: SoldOutTodayInput,
): Promise<SoldOutTodayResult> {
  return setSoldOutToday(input, null);
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
