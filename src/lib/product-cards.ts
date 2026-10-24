import type { Prisma } from "@/generated/prisma/client";
import type { ShopProduct } from "@/components/ProductCard";
import {
  gatherPromotions,
  livePromotionWhere,
  PROMOTION_SELECT_FIELDS,
  resolvePrice,
} from "@/lib/discounts";

// ─────────────────────────────────────────────────────────────────────────────
// Product cards — the ONE include + mapping for a priced product card.
//
// Every catalog listing (new arrivals, collection pages, category previews…)
// reads a product through `productCardInclude(now)` and serializes it with
// `toProductCard(row, now)`, so the price a card shows comes from one chain:
// the starting (lowest-base-price) available variant → `gatherPromotions` over
// every targeting level → `resolvePrice` against the caller's single `now`.
// Live promotion → struck-through base price; otherwise the variant's manual
// Compare-At. The math itself lives only in `discounts.ts`.
//
// Plain module (no Prisma client, no React) — server-only by usage.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The card include: category name + the live-promotion hierarchy for the
 * Discount Engine, with variants available-only and price-ascending so `[0]`
 * is the starting price.
 */
export function productCardInclude(now: Date) {
  return {
    category: {
      select: {
        name: true,
        promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
      },
    },
    promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
    variants: {
      where: { isAvailable: true },
      orderBy: { price: "asc" }, // [0] = starting (lowest) price
      include: {
        promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
      },
    },
  } satisfies Prisma.ProductInclude;
}

export type ProductCardRow = Prisma.ProductGetPayload<{
  include: ReturnType<typeof productCardInclude>;
}>;

/** Price a product's starting variant and serialize the plain-number client card. */
export function toProductCard(product: ProductCardRow, now: Date): ShopProduct {
  const starting = product.variants[0];
  const priced = resolvePrice(
    starting?.price ?? 0,
    gatherPromotions(starting?.promotions, product.promotions, product.category.promotions),
    now,
  );
  return {
    id: product.id,
    variantId: starting?.id ?? "",
    name: product.name,
    slug: product.slug,
    category: product.category.name,
    price: priced.finalPrice,
    // Live promo → struck-through base price; otherwise fall back to the
    // variant's manual Compare-At (mirrors the PDP). The Decimal column is
    // serialized to a plain number for the client card.
    compareAtPrice: priced.hasDiscount
      ? priced.basePrice
      : starting?.compareAtPrice?.toNumber() ?? null,
    image: product.images[0] ?? "/placeholder.jpg",
    tagline: product.description ?? undefined,
  };
}
