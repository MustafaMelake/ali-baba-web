import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { CategoryIdentifier } from "@/generated/prisma/client";
import CategoryPageTemplate from "@/components/CategoryPageTemplate";

// ISR: re-fetch this category at most once per hour (tune or remove as needed).
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Eid Sweets | Ali Baba",
  description:
    "The Eid collection — kahk, ghorayeba and biscuits dusted with sugar, baked fresh for the holidays.",
};

export default async function EidSweetsPage() {
  const products = await prisma.product.findMany({
    where: {
      isAvailable: true,
      category: { identifier: CategoryIdentifier.EID_SWEETS },
    },
    include: {
      category: true,
      variants: { orderBy: { price: "asc" } }, // [0] = starting price
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <CategoryPageTemplate
      title="Eid Sweets"
      description="The holiday table, set — buttery kahk filled with dates and nuts, melt-in-the-mouth ghorayeba and sugar-dusted biscuits, baked fresh for Eid."
      products={products}
    />
  );
}
