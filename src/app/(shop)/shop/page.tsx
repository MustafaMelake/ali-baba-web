import { prisma } from "@/lib/prisma";
import type { ShopProduct } from "@/components/ProductCard";
import ShopClient from "./ShopClient";

// ISR: rebuild the catalogue at most once per hour (tune or remove as needed).
export const revalidate = 3600;

export default async function ShopPage() {
  // Run both queries concurrently.
  const [categories, products] = await Promise.all([
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
  ]);

  const fetchedCategories = categories.map((c) => c.name);

  const mappedProducts: ShopProduct[] = products.map((product) => ({
    id: product.id,
    name: product.name,
    slug: product.slug,
    category: product.category.name,
    price: product.variants[0]?.price ?? 0, // starting (lowest) variant price
    image: product.images[0] ?? "/placeholder.jpg",
    tagline: product.description ?? undefined,
  }));

  return <ShopClient categories={fetchedCategories} products={mappedProducts} />;
}
