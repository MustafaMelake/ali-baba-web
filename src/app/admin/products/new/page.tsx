import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/session";
import PageHeader from "@/components/admin/PageHeader";
import NewProductForm from "@/components/admin/NewProductForm";

export const metadata = {
  title: "New Product | Admin",
};

export default async function NewProductPage() {
  await requireAdminPage();

  // Relational select options come straight from the DB.
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-6">
        <Link
          href="/admin/products"
          className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-stone-400 transition-colors hover:text-stone-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to products
        </Link>

        <PageHeader
          eyebrow="Catalog"
          title="Add New Product"
          description="Create a product and its first purchasable variant."
        />
      </div>

      <NewProductForm categories={categories} />
    </div>
  );
}
