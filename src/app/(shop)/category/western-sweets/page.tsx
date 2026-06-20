import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { CategoryIdentifier } from "@/generated/prisma/client";
import CategoryPageTemplate from "@/components/CategoryPageTemplate";

// ISR: re-fetch this category at most once per hour (tune or remove as needed).
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Western Sweets | Ali Baba",
  description:
    "Modern patisserie — gâteaux, tarts, éclairs and mousses, composed with French technique and seasonal fruit.",
};

export default async function WesternSweetsPage() {
  const products = await prisma.product.findMany({
    where: {
      isAvailable: true,
      category: { identifier: CategoryIdentifier.WESTERN_SWEETS },
    },
    include: {
      category: true,
      variants: { orderBy: { price: "asc" } }, // [0] = starting price
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <CategoryPageTemplate
      title="Western Sweets"
      description="Modern patisserie composed with French technique — silken gâteaux, glazed tarts and airy éclairs, finished with seasonal fruit and fine chocolate."
      products={products}
    />
  );
}
