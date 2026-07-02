"use server";

// ─────────────────────────────────────────────────────────────────────────────
// Store pricing settings — public read + ADMIN-only mutations.
//
// - `getPublicPricingSettings` powers the storefront checkout PREVIEW (no auth:
//   it exposes only the same numbers the order summary renders anyway). The
//   authoritative pricing path is `placeOrder`, which reads the same row through
//   the same `getStoreSettings()` helper — the preview can drift only if this
//   file and orders.ts stop sharing that reader.
// - `updateVatSettings` / `updateDeliveryFees` gate on `requireAdmin()` and
//   translate a rejected caller into `{ success: false, error }` so the settings
//   UI surfaces a toast instead of crashing (same pattern as settings.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import {
  getStoreSettings,
  STORE_SETTINGS_ID,
  type PricingSettings,
} from "@/lib/store-settings";

export type { PricingSettings };

export type SettingsActionResult =
  | { success: true }
  | { success: false; error: string };

/** Sanity ceiling for any single fee — blocks fat-fingered "3500000" typos. */
const MAX_FEE = 10_000;

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

/** Validate a fee: a finite number in [0, MAX_FEE]. Returns null when invalid. */
function parseFee(value: number): number | null {
  const fee = Number(value);
  if (!Number.isFinite(fee) || fee < 0 || fee > MAX_FEE) return null;
  // 2-dp money precision, mirroring the Discount Engine's rounding.
  return Math.round((fee + Number.EPSILON) * 100) / 100;
}

// ── Public read (checkout preview) ───────────────────────────────────────────

/**
 * The global pricing knobs for the storefront checkout summary. Public by
 * design — it reveals nothing the order summary doesn't already display.
 */
export async function getPublicPricingSettings(): Promise<PricingSettings> {
  return getStoreSettings();
}

// ── Update VAT ───────────────────────────────────────────────────────────────

/**
 * Update the global VAT settings. `vatRatePercent` arrives as the human
 * percentage the admin typed (14 → 14%) and is stored as a fraction (0.14).
 * The rate is validated even while VAT is disabled, so a bad value can't lie
 * dormant and surface the moment the toggle is switched back on.
 */
export async function updateVatSettings(input: {
  isVatEnabled: boolean;
  vatRatePercent: number;
}): Promise<SettingsActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };

  const percent = Number(input.vatRatePercent);
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
    return { success: false, error: "VAT rate must be between 0 and 100 percent." };
  }
  // Store as a fraction, rounded to 4dp so 14.25% → 0.1425 exactly.
  const vatRate = Math.round((percent / 100 + Number.EPSILON) * 10_000) / 10_000;

  try {
    await prisma.storeSettings.upsert({
      where: { id: STORE_SETTINGS_ID },
      update: { vatRate, isVatEnabled: Boolean(input.isVatEnabled) },
      create: {
        id: STORE_SETTINGS_ID,
        vatRate,
        isVatEnabled: Boolean(input.isVatEnabled),
      },
      select: { id: true },
    });

    revalidatePath("/admin/settings");
    return { success: true };
  } catch (err) {
    console.error("updateVatSettings failed:", err);
    return { success: false, error: "Could not save VAT settings. Please try again." };
  }
}

// ── Update delivery fees ─────────────────────────────────────────────────────

/**
 * Persist the whole delivery-fee sheet in ONE transaction: the "Other Areas"
 * default (on StoreSettings) plus a fee per branch. All-or-nothing, so the
 * admin can never be left with half a saved fee table.
 */
export async function updateDeliveryFees(input: {
  defaultFee: number;
  branchFees: { branchId: string; fee: number }[];
}): Promise<SettingsActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };

  const defaultFee = parseFee(input.defaultFee);
  if (defaultFee === null) {
    return { success: false, error: "The default delivery fee must be a number between 0 and 10,000." };
  }

  const branchFees: { branchId: string; fee: number }[] = [];
  for (const row of input.branchFees ?? []) {
    const branchId = row?.branchId?.trim();
    if (!branchId) continue;
    const fee = parseFee(row.fee);
    if (fee === null) {
      return { success: false, error: "Every branch fee must be a number between 0 and 10,000." };
    }
    branchFees.push({ branchId, fee });
  }

  try {
    await prisma.$transaction([
      prisma.storeSettings.upsert({
        where: { id: STORE_SETTINGS_ID },
        update: { defaultDeliveryFee: defaultFee },
        create: { id: STORE_SETTINGS_ID, defaultDeliveryFee: defaultFee },
        select: { id: true },
      }),
      ...branchFees.map(({ branchId, fee }) =>
        prisma.branch.update({
          where: { id: branchId },
          data: { deliveryFee: fee },
          select: { id: true },
        }),
      ),
    ]);

    revalidatePath("/admin/settings");
    return { success: true };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return {
        success: false,
        error: "One of those branches no longer exists. Refresh and try again.",
      };
    }
    console.error("updateDeliveryFees failed:", err);
    return { success: false, error: "Could not save delivery fees. Please try again." };
  }
}
