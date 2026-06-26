import { Coffee } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/session";
import PageHeader from "@/components/admin/PageHeader";
import EmptyState from "@/components/admin/EmptyState";
import CreateMenuCategoryButton from "@/components/admin/menu/CreateMenuCategoryButton";
import MenuCategoryCard from "@/components/admin/menu/MenuCategoryCard";

export const metadata = {
  title: "Café Menu | Admin",
};

export default async function AdminMenuPage() {
  await requireAdminPage();

  const categories = await prisma.menuCategory.findMany({
    orderBy: { order: "asc" },
    select: {
      id: true,
      title: true,
      slug: true,
      order: true,
      isFixedPrice: true,
      items: {
        orderBy: { order: "asc" },
        select: { id: true, name: true, price: true },
      },
    },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        eyebrow="Café"
        title="Menu Management"
        description="Build the dine-in menu surfaced on the public /menu page. Expand a category to edit its items, or adjust a whole category's prices at once."
        action={<CreateMenuCategoryButton />}
      />

      {categories.length === 0 ? (
        <div className="overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm">
          <EmptyState
            icon={Coffee}
            title="No menu categories yet"
            description="Create your first category (e.g. Smoothies, Desserts) to start building the café menu."
          />
        </div>
      ) : (
        <div className="space-y-4">
          {categories.map((category) => (
            <MenuCategoryCard key={category.id} category={category} />
          ))}
        </div>
      )}
    </div>
  );
}
