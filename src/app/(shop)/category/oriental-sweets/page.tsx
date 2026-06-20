import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { CategoryIdentifier } from "@/generated/prisma/client";
import CategoryPageTemplate from "@/components/CategoryPageTemplate";

// ISR: re-fetch this category at most once per hour (tune or remove as needed).
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Oriental Sweets | Ali Baba",
  description:
    "Time-honoured oriental delicacies — baklava, basbousa, kunafa and more, crafted with pistachio, honey and rosewater.",
};

export default async function OrientalSweetsPage() {
  const products = await prisma.product.findMany({
    where: {
      isAvailable: true,
      category: { identifier: CategoryIdentifier.ORIENTAL_SWEETS },
    },
    include: {
      category: true,
      variants: { orderBy: { price: "asc" } }, // [0] = starting price
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <CategoryPageTemplate
      title="Oriental Sweets"
      description="Time-honoured recipes layered with pistachio, honey and rosewater — baklava, basbousa and kunafa, crafted the way they were meant to be."
      products={products}
    />
  );
}
