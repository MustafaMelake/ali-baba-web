import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/session";
import { getAdminCollection } from "@/lib/actions/collections";
import PageHeader from "@/components/admin/PageHeader";
import Pill from "@/components/admin/Pill";
import CollectionContentsEditor from "@/components/admin/CollectionContentsEditor";
import CollectionDetailsButton from "@/components/admin/CollectionDetailsButton";

export const metadata = {
  title: "Collection | Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminCollectionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;

  const [collection, categories, products] = await Promise.all([
    getAdminCollection(id),
    prisma.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    // The "add a product" picker's catalog (filtered client-side).
    prisma.product.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        images: true,
        isAvailable: true,
        category: { select: { name: true } },
        variants: { where: { isAvailable: true }, select: { id: true }, take: 1 },
      },
    }),
  ]);
  if (!collection) notFound();

  const productOptions = products.map((p) => ({
    id: p.id,
    name: p.name,
    image: p.images[0] ?? null,
    categoryName: p.category.name,
    isListable: p.isAvailable && p.variants.length > 0,
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="space-y-6">
        <Link
          href="/admin/collections"
          className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-stone-400 transition-colors hover:text-stone-700"
        >
          <ArrowLeft className="h-3.5 w-3.5 rtl:-scale-x-100" />
          Back to collections
        </Link>
        <PageHeader
          eyebrow="Collection"
          title={collection.name}
          description={`/collections/${collection.slug}`}
          action={
            <div className="flex items-center gap-2">
              <Pill
                className={
                  collection.isActive
                    ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                    : "bg-stone-100 text-stone-500 ring-stone-500/20"
                }
              >
                {collection.isActive ? "Active" : "Inactive"}
              </Pill>
              {collection.isActive && (
                <Link
                  href={`/collections/${collection.slug}`}
                  target="_blank"
                  className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  View
                </Link>
              )}
              <CollectionDetailsButton collection={collection} />
            </div>
          }
        />
      </div>

      <CollectionContentsEditor
        collection={collection}
        categories={categories}
        productOptions={productOptions}
      />
    </div>
  );
}
