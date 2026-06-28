"use server";

// ─────────────────────────────────────────────────────────────────────────────
// Discount Engine — Promotion management (ADMIN-only mutations).
//
// CRUD for Promotions plus a dedicated isActive toggle. Each action gates on
// `requireAdmin()` but translates a rejected caller into a clean
// `{ success: false, error }` so the modal/table can surface a toast rather than
// crash. Targets are implicit many-to-many relations (Category / Product /
// ProductVariant), so:
//   - create → `connect` the chosen ids
//   - update → `set` the chosen ids (replaces the whole selection to mirror the
//     multi-select's "this is the full desired state" semantics)
//   - delete → Prisma removes the implicit join rows automatically.
//
// NOTE: discounts aren't wired into storefront pricing yet (Phase 3), so we only
// revalidate /admin/promotions here. Add the storefront paths when the engine
// starts affecting displayed prices.
// ─────────────────────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { DiscountType } from "@/generated/prisma/enums";

const VALID_TYPES = new Set<string>(Object.values(DiscountType));

export type PromotionInput = {
  name: string;
  /** A DiscountType value — "PERCENTAGE" | "FIXED_AMOUNT". */
  type: string;
  value: number;
  /** ISO string or "yyyy-mm-dd" — parsed server-side. */
  startDate: string;
  endDate: string;
  isActive: boolean;
  categoryIds: string[];
  productIds: string[];
  variantIds: string[];
};

export type CreatePromotionResult =
  | { success: true; id: string }
  | { success: false; error: string };

export type PromotionActionResult =
  | { success: true }
  | { success: false; error: string };

// ── Helpers ──────────────────────────────────────────────────────────────────

/** ADMIN-only gate that returns a standard error object instead of throwing. */
async function ensureAdmin(): Promise<{ error: string } | null> {
  try {
    await requireAdmin();
    return null;
  } catch {
    return { error: "Unauthorized: admin access required." };
  }
}

/** Reads a Prisma known-request error code without importing the error class. */
function prismaErrorCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

type ValidatedPromotion = {
  name: string;
  type: DiscountType;
  value: number;
  startDate: Date;
  endDate: Date;
  isActive: boolean;
  categoryIds: string[];
  productIds: string[];
  variantIds: string[];
};

/** Drop empties + de-dupe an id list coming off a multi-select. */
function cleanIds(ids: string[] | undefined): string[] {
  return Array.from(new Set((ids ?? []).filter(Boolean)));
}

/** Validate + normalize the shared promotion fields, or return a clean error. */
function validatePromotion(input: PromotionInput): ValidatedPromotion | { error: string } {
  const name = input.name?.trim() ?? "";
  if (name.length < 2) {
    return { error: "Name must be at least 2 characters." };
  }

  if (!VALID_TYPES.has(input.type)) {
    return { error: "Choose a valid discount type." };
  }
  const type = input.type as DiscountType;

  const value = Number(input.value);
  if (!Number.isFinite(value) || value <= 0) {
    return { error: "Discount value must be a positive number." };
  }
  if (type === DiscountType.PERCENTAGE && value > 100) {
    return { error: "A percentage discount can't exceed 100%." };
  }

  const startDate = new Date(input.startDate);
  const endDate = new Date(input.endDate);
  if (Number.isNaN(startDate.getTime())) return { error: "Start date is invalid." };
  if (Number.isNaN(endDate.getTime())) return { error: "End date is invalid." };
  if (endDate < startDate) {
    return { error: "End date must be on or after the start date." };
  }

  const categoryIds = cleanIds(input.categoryIds);
  const productIds = cleanIds(input.productIds);
  const variantIds = cleanIds(input.variantIds);
  if (categoryIds.length + productIds.length + variantIds.length === 0) {
    return { error: "Link the promotion to at least one category, product or variant." };
  }

  return {
    name,
    type,
    value,
    startDate,
    endDate,
    isActive: Boolean(input.isActive),
    categoryIds,
    productIds,
    variantIds,
  };
}

// ── Create ───────────────────────────────────────────────────────────────────

export async function createPromotion(
  input: PromotionInput,
): Promise<CreatePromotionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };

  const parsed = validatePromotion(input);
  if ("error" in parsed) return { success: false, error: parsed.error };

  try {
    const created = await prisma.promotion.create({
      data: {
        name: parsed.name,
        type: parsed.type,
        value: parsed.value,
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        isActive: parsed.isActive,
        categories: { connect: parsed.categoryIds.map((id) => ({ id })) },
        products: { connect: parsed.productIds.map((id) => ({ id })) },
        variants: { connect: parsed.variantIds.map((id) => ({ id })) },
      },
      select: { id: true },
    });

    revalidatePath("/admin/promotions");
    return { success: true, id: created.id };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return {
        success: false,
        error: "One of the selected items no longer exists. Refresh and try again.",
      };
    }
    console.error("createPromotion failed:", err);
    return { success: false, error: "Could not create the promotion. Please try again." };
  }
}

// ── Update ───────────────────────────────────────────────────────────────────

export async function updatePromotion(
  id: string,
  input: PromotionInput,
): Promise<PromotionActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };

  if (!id) return { success: false, error: "Missing promotion id." };

  const parsed = validatePromotion(input);
  if ("error" in parsed) return { success: false, error: parsed.error };

  try {
    await prisma.promotion.update({
      where: { id },
      data: {
        name: parsed.name,
        type: parsed.type,
        value: parsed.value,
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        isActive: parsed.isActive,
        // `set` replaces the entire selection — the multi-select sends the full
        // desired target list, not a delta.
        categories: { set: parsed.categoryIds.map((id) => ({ id })) },
        products: { set: parsed.productIds.map((id) => ({ id })) },
        variants: { set: parsed.variantIds.map((id) => ({ id })) },
      },
      select: { id: true },
    });

    revalidatePath("/admin/promotions");
    return { success: true };
  } catch (err) {
    const code = prismaErrorCode(err);
    if (code === "P2025") {
      return { success: false, error: "That promotion no longer exists." };
    }
    console.error("updatePromotion failed:", err);
    return { success: false, error: "Could not update the promotion. Please try again." };
  }
}

// ── Toggle isActive ──────────────────────────────────────────────────────────

export async function togglePromotionActive(
  id: string,
  isActive: boolean,
): Promise<PromotionActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };

  if (!id) return { success: false, error: "Missing promotion id." };

  try {
    await prisma.promotion.update({
      where: { id },
      data: { isActive: Boolean(isActive) },
      select: { id: true },
    });

    revalidatePath("/admin/promotions");
    return { success: true };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return { success: false, error: "That promotion no longer exists." };
    }
    console.error("togglePromotionActive failed:", err);
    return { success: false, error: "Could not update the promotion. Please try again." };
  }
}

// ── Delete ───────────────────────────────────────────────────────────────────

/**
 * Hard-deletes a promotion. The implicit m2m join rows (to categories/products/
 * variants) are removed automatically by Prisma — no catalog rows are touched.
 */
export async function deletePromotion(id: string): Promise<PromotionActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };

  if (!id) return { success: false, error: "Missing promotion id." };

  try {
    await prisma.promotion.delete({ where: { id } });

    revalidatePath("/admin/promotions");
    return { success: true };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return { success: false, error: "That promotion no longer exists." };
    }
    console.error("deletePromotion failed:", err);
    return { success: false, error: "Could not delete the promotion. Please try again." };
  }
}
