"use server";

import { prisma } from "@/lib/prisma";
// Session comes from our cached server-side wrapper (not better-auth directly).
import { getServerSession } from "@/lib/session";
import {
  gatherPromotions,
  livePromotionWhere,
  PROMOTION_SELECT_FIELDS,
  resolvePrice,
} from "@/lib/discounts";
import { CHECKOUT_MAX_QUANTITY } from "@/lib/validators";

/**
 * Cart synchronization Server Actions.
 *
 * The DB (`CartItem`) tracks ONLY identity + intent: `{ userId, variantId,
 * quantity }`. Prices, names and images are NEVER stored here — they are always
 * re-resolved from the live catalogue (`ProductVariant` → `Product`) on read,
 * so a promo or price change is reflected immediately and the client can never
 * dictate a price. This mirrors how `placeOrder` re-prices at checkout.
 */

// ── Shared types ──────────────────────────────────────────────────────────

/** Minimal line the client ships up (guest cart / optimistic mutation). */
export interface LocalCartLine {
  variantId: string;
  quantity: number;
}

/**
 * A fully-hydrated cart line returned to the client. Intentionally
 * structurally identical to the Zustand `CartItem` so the store can adopt it
 * as the source of truth with no remapping:
 *   id        → parent product id (UI/links only, never the merge key)
 *   variantId → canonical line identity (the merge key)
 */
export interface DbCartItem {
  id: string;
  variantId: string;
  name: string;
  price: number;
  image: string;
  quantity: number;
  category?: string;
}

export type CartActionResult<T = null> =
  | { success: true; data: T }
  | { success: false; error: string };

// ── Constants & helpers ─────────────────────────────────────────────────────

/** Hard ceiling per line — the SAME shared limit `checkoutSchema` enforces at
 *  checkout and the Zustand store clamps to locally, so a synced cart can never
 *  hold a line the order pipeline would reject. */
const MAX_QUANTITY = CHECKOUT_MAX_QUANTITY;

const PLACEHOLDER_IMAGE = "/placeholder.jpg";

/** Reads a Prisma known-request error code without importing the error class. */
function prismaErrorCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/** Clamp to a whole number in [0, MAX_QUANTITY]; non-finite input → 0. */
function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return 0;
  return Math.max(0, Math.min(MAX_QUANTITY, Math.floor(quantity)));
}

/**
 * Normalises a raw local cart: drops blank ids and non-positive quantities,
 * clamps each quantity, and de-duplicates by `variantId` (summing) so a
 * malformed payload can't smuggle two rows for the same variant into the loop.
 */
function sanitizeLocalLines(localItems: LocalCartLine[]): LocalCartLine[] {
  const byVariant = new Map<string, number>();

  for (const item of localItems ?? []) {
    const variantId = item?.variantId?.trim();
    if (!variantId) continue;

    const qty = clampQuantity(item.quantity);
    if (qty < 1) continue;

    byVariant.set(
      variantId,
      Math.min(MAX_QUANTITY, (byVariant.get(variantId) ?? 0) + qty),
    );
  }

  return [...byVariant].map(([variantId, quantity]) => ({ variantId, quantity }));
}

// ── 1. Merge: guest cart → DB (sum on conflict) ─────────────────────────────

/**
 * Merges a guest's local cart into the authenticated user's persisted cart.
 *
 * Runs in a single transaction so the merge is all-or-nothing. For each local
 * line we UPSERT: when a `(userId, variantId)` row already exists its quantity
 * is **incremented** by the local quantity (the required "sum" semantics);
 * otherwise a new row is created. Variants that no longer exist in the catalogue
 * are skipped up-front (rather than triggering a mid-loop FK error that would
 * abort the whole merge).
 */
export async function mergeCartAction(
  localItems: LocalCartLine[],
): Promise<CartActionResult> {
  const session = await getServerSession();
  if (!session) return { success: false, error: "Please sign in to save your cart." };
  const userId = session.user.id;

  const lines = sanitizeLocalLines(localItems);
  // Nothing valid to merge is a success, not an error (e.g. empty guest cart).
  if (lines.length === 0) return { success: true, data: null };

  try {
    await prisma.$transaction(async (tx) => {
      // Validate all referenced variants in one query so unknown/stale ids are
      // filtered out instead of throwing a P2003 partway through the loop.
      const known = await tx.productVariant.findMany({
        where: { id: { in: lines.map((l) => l.variantId) } },
        select: { id: true },
      });
      const validIds = new Set(known.map((v) => v.id));

      for (const line of lines) {
        if (!validIds.has(line.variantId)) continue;

        await tx.cartItem.upsert({
          where: { userId_variantId: { userId, variantId: line.variantId } },
          // Existing row → SUM (DB quantity + local quantity).
          update: { quantity: { increment: line.quantity } },
          // Missing row → create fresh.
          create: { userId, variantId: line.variantId, quantity: line.quantity },
        });
      }
    });

    return { success: true, data: null };
  } catch (err) {
    console.error("mergeCartAction failed:", err);
    return { success: false, error: "Could not merge your cart. Please try again." };
  }
}

// ── 2. Sync a single line (optimistic mutation persistence) ─────────────────

/**
 * Persists one cart line for the logged-in user.
 *  - `SET`    → upsert the row to the EXACT `quantity` (idempotent; a late-
 *               arriving SET simply overwrites, which sidesteps increment races).
 *  - `DELETE` → remove the row.
 *  - `quantity < 1` is always treated as a delete, regardless of `actionType`.
 *
 * Uses `deleteMany` for removals so a no-op delete (row already gone) is silent
 * rather than a P2025 throw.
 */
export async function syncCartItemAction(
  variantId: string,
  quantity: number,
  actionType: "SET" | "DELETE",
): Promise<CartActionResult> {
  const session = await getServerSession();
  if (!session) return { success: false, error: "Please sign in to save your cart." };
  const userId = session.user.id;

  const id = variantId?.trim();
  if (!id) return { success: false, error: "Missing variant." };

  const qty = clampQuantity(quantity);

  try {
    if (actionType === "DELETE" || qty < 1) {
      await prisma.cartItem.deleteMany({ where: { userId, variantId: id } });
      return { success: true, data: null };
    }

    await prisma.cartItem.upsert({
      where: { userId_variantId: { userId, variantId: id } },
      update: { quantity: qty },
      create: { userId, variantId: id, quantity: qty },
    });

    return { success: true, data: null };
  } catch (err) {
    // FK violation → the variant was deleted from the catalogue.
    if (prismaErrorCode(err) === "P2003") {
      return { success: false, error: "That item is no longer available." };
    }
    console.error("syncCartItemAction failed:", err);
    return { success: false, error: "Could not sync your cart. Please try again." };
  }
}

// ── 3. Read the DB cart, hydrated with live catalogue data ──────────────────

/**
 * Returns the authenticated user's cart, each line joined to its variant and
 * parent product so the client receives live `name`, `price`, `image` and the
 * parent `productId`. Prices are read fresh from the catalogue here — the cart
 * table itself never stores them.
 *
 * (Cart rows cascade-delete with their variant, so orphan lines can't exist;
 * the optional-chaining guards below are belt-and-braces only.)
 */
export async function getDbCartAction(): Promise<CartActionResult<DbCartItem[]>> {
  const session = await getServerSession();
  if (!session) return { success: false, error: "Please sign in to view your cart." };

  // Single instant: every promotion level is filtered + evaluated against it.
  const now = new Date();

  try {
    const rows = await prisma.cartItem.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "asc" }, // stable, predictable line order
      include: {
        variant: {
          include: {
            // Variant-level promotions…
            promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
            product: {
              include: {
                // …product-level…
                promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
                // …and category-level (plus the name for display).
                category: {
                  select: {
                    name: true,
                    promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
                  },
                },
              },
            },
          },
        },
      },
    });

    const data: DbCartItem[] = rows
      .filter((row) => row.variant?.product)
      .map((row) => {
        const { variant } = row;
        const { product } = variant;
        // Display the discounted unit price so the cart/checkout match what
        // `placeOrder` will bill. The cart table itself still stores no price.
        const promotions = gatherPromotions(
          variant.promotions,
          product.promotions,
          product.category?.promotions,
        );
        const { finalPrice } = resolvePrice(variant.price, promotions, now);
        return {
          id: product.id, // parent product id — for UI/links
          variantId: row.variantId, // canonical line identity
          name: product.name, // live name (parity with client adds)
          price: finalPrice, // live, discounted price from the catalogue
          image: product.images[0] ?? PLACEHOLDER_IMAGE,
          quantity: row.quantity,
          category: product.category?.name,
        };
      });

    return { success: true, data };
  } catch (err) {
    console.error("getDbCartAction failed:", err);
    return { success: false, error: "Could not load your cart. Please try again." };
  }
}

// ── 4. Re-price a GUEST cart from the live catalogue ────────────────────────

/**
 * One re-priced cart line. `price` is the live, discounted unit price — the
 * exact figure `placeOrder` would bill right now. `compareAtPrice` mirrors the
 * PDP fallback chain (live promo's base price, else the manual column) and
 * `promotionName` names the applied promo so the UI can badge it if desired.
 */
export interface RepricedVariant {
  variantId: string;
  price: number;
  compareAtPrice: number | null;
  promotionName: string | null;
  /** False when the variant OR its parent product has been switched off. */
  isAvailable: boolean;
}

/** Ceiling on a single re-price request — keeps this public action's
 *  `id IN (…)` query bounded no matter what a forged payload sends. */
const MAX_REPRICE_IDS = 100;

/**
 * Public (no-auth) re-pricing for GUEST carts. A guest's cart lives only in
 * localStorage, so a promotion that started or expired since the item was
 * added leaves a stale price on screen — while `placeOrder` would correctly
 * bill the live one. This action lets the client refresh its lines from the
 * catalogue so the total the guest sees IS the total they'll be charged.
 *
 * Safe to expose without a session: it reveals only catalogue prices that
 * every public product page already renders, the input is de-duplicated and
 * capped at MAX_REPRICE_IDS, and nothing is written. Variants that no longer
 * exist are simply absent from the response (the caller leaves those lines
 * untouched; `placeOrder`'s availability guard remains the final gate).
 *
 * Logged-in carts never need this — `getDbCartAction` re-prices them on read.
 */
export async function rePriceGuestCart(
  variantIds: string[],
): Promise<CartActionResult<RepricedVariant[]>> {
  const ids = [
    ...new Set(
      (variantIds ?? [])
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter(Boolean),
    ),
  ].slice(0, MAX_REPRICE_IDS);

  if (ids.length === 0) return { success: true, data: [] };

  // Single instant: every promotion level is filtered + evaluated against it,
  // exactly as in getDbCartAction and placeOrder.
  const now = new Date();

  try {
    // ONE batch read for all requested lines, carrying the full promotion
    // hierarchy (variant → product → category) the Discount Engine needs.
    const variants = await prisma.productVariant.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        price: true,
        compareAtPrice: true,
        isAvailable: true,
        promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
        product: {
          select: {
            isAvailable: true,
            promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
            category: {
              select: {
                promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
              },
            },
          },
        },
      },
    });

    const data: RepricedVariant[] = variants.map((v) => {
      const priced = resolvePrice(
        v.price,
        gatherPromotions(
          v.promotions,
          v.product.promotions,
          v.product.category?.promotions,
        ),
        now,
      );
      return {
        variantId: v.id,
        price: priced.finalPrice,
        // Live promo → struck-through base price; otherwise the manual
        // Compare-At column (the same fallback the PDP and cards use).
        compareAtPrice: priced.hasDiscount ? priced.basePrice : v.compareAtPrice,
        promotionName: priced.appliedPromotion?.name ?? null,
        isAvailable: v.isAvailable && v.product.isAvailable,
      };
    });

    return { success: true, data };
  } catch (err) {
    console.error("rePriceGuestCart failed:", err);
    return { success: false, error: "Could not refresh prices. Please try again." };
  }
}

// ── 5. Clear the whole DB cart (intentional empty: checkout / "Clear cart") ──

/**
 * Wipes every cart line for the logged-in user. This is for *intentional*
 * emptying (a placed order, or the explicit "Clear cart" action) — NOT logout.
 * Logout must only clear the local store and leave the saved cart intact for
 * the next sign-in / other devices.
 */
export async function clearDbCartAction(): Promise<CartActionResult> {
  const session = await getServerSession();
  if (!session) return { success: false, error: "Please sign in to manage your cart." };

  try {
    await prisma.cartItem.deleteMany({ where: { userId: session.user.id } });
    return { success: true, data: null };
  } catch (err) {
    console.error("clearDbCartAction failed:", err);
    return { success: false, error: "Could not clear your cart. Please try again." };
  }
}
