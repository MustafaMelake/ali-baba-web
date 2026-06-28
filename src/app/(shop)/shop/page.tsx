import { prisma } from "@/lib/prisma";
import { getWishlistedProductIds } from "@/lib/actions/wishlist";
import type { ShopProduct } from "@/components/ProductCard";
import {
  gatherPromotions,
  livePromotionWhere,
  PROMOTION_SELECT_FIELDS,
  resolvePrice,
} from "@/lib/discounts";
import ShopClient from "./ShopClient";

// Reads the per-user wishlist → must be dynamic (no shared ISR cache).
export const dynamic = "force-dynamic";

export default async function ShopPage() {
  // One instant drives every promotion filter + evaluation this request.
  const now = new Date();

  // Run all queries concurrently.
  const [categories, products, wishlistedIds] = await Promise.all([
    prisma.category.findMany({
      where: { type: "SHOP" },
      orderBy: { name: "asc" },
      select: { name: true },
    }),
    prisma.product.findMany({
      where: { isAvailable: true, category: { type: "SHOP" } },
      include: {
        // Category + its live promotions (name kept for the card label).
        category: {
          select: {
            name: true,
            promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
          },
        },
        // Product-level live promotions.
        promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
        // [0] = starting price; carry each variant's own live promotions.
        variants: {
          orderBy: { price: "asc" },
          include: {
            promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    getWishlistedProductIds(),
  ]);

  const fetchedCategories = categories.map((c) => c.name);

  const mappedProducts: ShopProduct[] = products.map((product) => {
    // Discount the starting (lowest-base-price) variant — that's the card's
    // representative price and the variant quick-add adds.
    const starting = product.variants[0];
    const priced = resolvePrice(
      starting?.price ?? 0,
      gatherPromotions(
        starting?.promotions,
        product.promotions,
        product.category.promotions,
      ),
      now,
    );
    return {
      id: product.id,
      variantId: starting?.id ?? "", // starting (lowest) variant id
      name: product.name,
      slug: product.slug,
      category: product.category.name,
      price: priced.finalPrice, // discounted starting price
      compareAtPrice: priced.hasDiscount ? priced.basePrice : null,
      image: product.images[0] ?? "/placeholder.jpg",
      tagline: product.description ?? undefined,
    };
  });

  return (
    <ShopClient
      categories={fetchedCategories}
      products={mappedProducts}
      wishlistedIds={wishlistedIds}
    />
  );
}
