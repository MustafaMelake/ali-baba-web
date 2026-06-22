import { prisma } from "@/lib/prisma";
import { getWishlistedProductIds } from "@/lib/actions/wishlist";
import type { ShopProduct } from "@/components/ProductCard";
import ShopClient from "./ShopClient";

// Reads the per-user wishlist → must be dynamic (no shared ISR cache).
export const dynamic = "force-dynamic";

export default async function ShopPage() {
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
        category: true,
        variants: { orderBy: { price: "asc" } }, // [0] = starting price
      },
      orderBy: { createdAt: "desc" },
    }),
    getWishlistedProductIds(),
  ]);

  const fetchedCategories = categories.map((c) => c.name);

  const mappedProducts: ShopProduct[] = products.map((product) => ({
    id: product.id,
    variantId: product.variants[0]?.id ?? "", // starting (lowest) variant id
    name: product.name,
    slug: product.slug,
    category: product.category.name,
    price: product.variants[0]?.price ?? 0, // starting (lowest) variant price
    image: product.images[0] ?? "/placeholder.jpg",
    tagline: product.description ?? undefined,
  }));

  return (
    <ShopClient
      categories={fetchedCategories}
      products={mappedProducts}
      wishlistedIds={wishlistedIds}
    />
  );
}
