import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { CategoryIdentifier } from "@/generated/prisma/client";
import CategoryPageTemplate from "@/components/CategoryPageTemplate";

// Personalised per-user wishlist state → render dynamically (no shared ISR cache).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bakery | Ali Baba",
  description:
    "The daily bakery — croissants, brioche and artisan breads, laminated and baked fresh every morning.",
};

export default async function BakeryPage() {
  const products = await prisma.product.findMany({
    where: {
      isAvailable: true,
      category: { identifier: CategoryIdentifier.BAKERY },
    },
    include: {
      category: true,
      variants: { orderBy: { price: "asc" } }, // [0] = starting price
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <CategoryPageTemplate
      title="Bakery"
      description="Laminated and baked fresh each morning — flaky croissants, pillowy brioche and rustic artisan loaves, straight from the oven."
      products={products}
    />
  );
}
