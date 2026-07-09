import { prisma } from "@/lib/prisma";
import type { ShopProduct } from "@/components/ProductCard";
import {
  gatherPromotions,
  livePromotionWhere,
  PROMOTION_SELECT_FIELDS,
  resolvePrice,
} from "@/lib/discounts";
import ShopClient from "./ShopClient";

// No per-user data here anymore (wishlist hearts hydrate client-side from the
// shared store), but this route still renders per-request BY DESIGN: the
// server-side category filter reads `searchParams`, which is request-time
// data — an ISR `revalidate` would be inert. The win over the old version is
// the dropped session + wishlist queries on every anonymous hit.

export default async function ShopPage({
  searchParams,
}: {
  // Next 15 streams searchParams as a Promise — the active filter is the slug.
  searchParams: Promise<{ category?: string }>;
}) {
  // One instant drives every promotion filter + evaluation this request.
  const now = new Date();

  // Active category slug from the URL (?category=slug). Absent ⇒ "All Collection".
  const { category: categoryParam } = await searchParams;

  // Run all queries concurrently.
  const [categories, products] = await Promise.all([
    prisma.category.findMany({
      where: { type: "SHOP" },
      orderBy: { name: "asc" },
      select: { name: true, slug: true },
    }),
    prisma.product.findMany({
      // Server-side category filtering: narrow by slug when one is present, so
      // the grid only ever ships the products it renders (LCP scales with the
      // page size, not the whole catalog). The SHOP type guard is always kept.
      where: {
        isAvailable: true,
        category: categoryParam
          ? { type: "SHOP", slug: categoryParam }
          : { type: "SHOP" },
      },
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
  ]);

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
      // Live promo → struck-through base price; otherwise fall back to the
      // variant's manual Compare-At so admin-set "was" prices show on the card
      // too (mirrors the PDP — see product/[slug]/page.tsx).
      compareAtPrice: priced.hasDiscount ? priced.basePrice : starting?.compareAtPrice ?? null,
      image: product.images[0] ?? "/placeholder.jpg",
      tagline: product.description ?? undefined,
    };
  });

  return <ShopClient categories={categories} products={mappedProducts} />;
}
