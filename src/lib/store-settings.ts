// ─────────────────────────────────────────────────────────────────────────────
// Store settings — the shared reader for the single-row StoreSettings table.
//
// Server-only (imports Prisma). Every consumer of the global pricing knobs —
// `placeOrder`, the admin Settings page, and the public checkout-preview action
// — reads through `getStoreSettings()`, exactly like every price flows through
// `resolvePrice`: one reader means the preview and the bill can't disagree
// about what the settings ARE (the math stays in each caller).
//
// STRICTLY READ-ONLY. This runs on hot public paths (every checkout mount),
// so it must never write: a missing row is answered from the in-memory
// DEFAULT_PRICING_SETTINGS below, not upserted into existence. The singleton
// row is created only by the ADMIN-gated mutations in
// src/lib/actions/store-settings.ts when an admin first saves the form.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";

/** The one and only StoreSettings row id. */
export const STORE_SETTINGS_ID = "store";

/** The pricing knobs every consumer needs (subset of the StoreSettings row). */
export type PricingSettings = {
  /** VAT as a FRACTION (0.14 = 14%). */
  vatRate: number;
  /** Master switch — when false, no VAT is shown or charged. */
  isVatEnabled: boolean;
  /** Delivery fee (EGP) for DELIVERY orders with no branch ("Other Areas"). */
  defaultDeliveryFee: number;
};

/**
 * Served when the singleton row doesn't exist yet (fresh database, admin has
 * never saved). MUST mirror the schema defaults on the StoreSettings model —
 * the row an admin's first partial save creates fills unspecified columns from
 * those same defaults, so preview, billing, and the eventual row all agree.
 */
export const DEFAULT_PRICING_SETTINGS: Readonly<PricingSettings> = Object.freeze({
  vatRate: 0.14,
  isVatEnabled: true,
  defaultDeliveryFee: 35,
});

/**
 * Read the global pricing settings. Pure read — a primary-key lookup, no row
 * lock, no write compute (Neon-friendly). Falls back to the in-memory schema
 * defaults when the row is absent; it NEVER creates the row.
 */
export async function getStoreSettings(): Promise<PricingSettings> {
  const row = await prisma.storeSettings.findUnique({
    where: { id: STORE_SETTINGS_ID },
    select: { vatRate: true, isVatEnabled: true, defaultDeliveryFee: true },
  });
  if (!row) return DEFAULT_PRICING_SETTINGS;
  return {
    // vatRate is a Float already; only defaultDeliveryFee is a Decimal money
    // column. Coerce it to a plain number here so every consumer (the public
    // checkout-preview action → client, and placeOrder) gets a serializable
    // number and never a Decimal object.
    vatRate: row.vatRate,
    isVatEnabled: row.isVatEnabled,
    defaultDeliveryFee: row.defaultDeliveryFee.toNumber(),
  };
}
