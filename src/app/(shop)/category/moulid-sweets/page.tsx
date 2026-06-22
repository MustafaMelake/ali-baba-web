import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { CategoryIdentifier } from "@/generated/prisma/client";
import CategoryPageTemplate from "@/components/CategoryPageTemplate";

// Personalised per-user wishlist state → render dynamically (no shared ISR cache).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Moulid Sweets | Ali Baba",
  description:
    "Festive Moulid sweets — halawet el-moulid, sugar dolls and seed brittle made to celebrate the season.",
};

export default async function MoulidSweetsPage() {
  const products = await prisma.product.findMany({
    where: {
      isAvailable: true,
      category: { identifier: CategoryIdentifier.MOULID_SWEETS },
    },
    include: {
      category: true,
      variants: { orderBy: { price: "asc" } }, // [0] = starting price
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <CategoryPageTemplate
      title="Moulid Sweets"
      description="A festive table of halawet el-moulid — sesame and peanut brittle, sugared seeds and almonds, made to mark the celebration with sweetness."
      products={products}
    />
  );
}
