import { prisma } from "@/lib/prisma";
import MenuClient from "./MenuClient";

export const metadata = {
  title: "Menu | Ali Baba · The Café",
  description:
    "Handcrafted smoothies, signature desserts, premium ice cream, milkshakes and gourmet waffles — served fresh for dine-in & branch pickup.",
};

// Re-fetch the menu at most once per hour; admin edits call revalidatePath("/menu")
// so changes still appear immediately, not only after this window.
export const revalidate = 3600;

/**
 * Server Component: loads the café menu from Prisma (categories ordered by
 * `order`, each with its items ordered by `order`) and hands a clean,
 * fully-serializable payload to the interactive <MenuClient />.
 */
export default async function MenuPage() {
  const rows = await prisma.menuCategory.findMany({
    orderBy: { order: "asc" },
    select: {
      id: true,
      title: true,
      slug: true,
      isFixedPrice: true,
      items: {
        orderBy: { order: "asc" },
        select: { id: true, name: true, price: true },
      },
    },
  });

  // price is a Decimal money column — serialize to a plain number so the client
  // <MenuClient /> receives a fully-serializable payload.
  const categories = rows.map((c) => ({
    ...c,
    items: c.items.map((it) => ({ ...it, price: it.price.toNumber() })),
  }));

  return <MenuClient categories={categories} />;
}
