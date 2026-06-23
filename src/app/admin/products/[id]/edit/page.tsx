import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import PageHeader from "@/components/admin/PageHeader";
import EditProductForm from "@/components/admin/EditProductForm";

export const metadata = {
  title: "Edit Product | Admin",
};

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Product (with its variants) + the relational select options, in parallel.
  const [product, categories, menuPages] = await Promise.all([
    prisma.product.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, name: true } },
        variants: {
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            name: true,
            price: true,
            compareAtPrice: true,
            sku: true,
          },
        },
      },
    }),
    prisma.category.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.menuPage.findMany({
      orderBy: { title: "asc" },
      select: { id: true, title: true },
    }),
  ]);

  if (!product) notFound();

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
          title="Edit Product"
          description={`Update “${product.name}”, its media, status and variants.`}
        />
      </div>

      <EditProductForm
        product={{
          id: product.id,
          name: product.name,
          slug: product.slug,
          description: product.description,
          images: product.images,
          isAvailable: product.isAvailable,
          isFeatured: product.isFeatured,
          categoryId: product.categoryId,
          menuPageId: product.menuPageId,
          variants: product.variants,
        }}
        categories={categories}
        // MenuPage exposes `title`; normalise to the form's { id, name } shape.
        menuPages={menuPages.map((m) => ({ id: m.id, name: m.title }))}
      />
    </div>
  );
}
