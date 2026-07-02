// ─────────────────────────────────────────────────────────────────────────────
// Store settings — the shared reader for the single-row StoreSettings table.
//
// Server-only (imports Prisma). Every consumer of the global pricing knobs —
// `placeOrder`, the admin Settings page, and the public checkout-preview action
// — reads through `getStoreSettings()`, exactly like every price flows through
// `resolvePrice`: one reader means the preview and the bill can't disagree
// about what the settings ARE (the math stays in each caller).
//
// The row is upserted into existence on first read (fixed id "store"), so a
// fresh database needs no seed step and callers never handle a missing row.
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
 * Read the global pricing settings, creating the singleton row with its schema
 * defaults on first use. An empty `update` makes this a pure read-or-create.
 */
export async function getStoreSettings(): Promise<PricingSettings> {
  return prisma.storeSettings.upsert({
    where: { id: STORE_SETTINGS_ID },
    update: {},
    create: { id: STORE_SETTINGS_ID },
    select: { vatRate: true, isVatEnabled: true, defaultDeliveryFee: true },
  });
}
