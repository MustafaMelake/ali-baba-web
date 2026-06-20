import Link from "next/link";
import { ImageIcon, Package, Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatEGP } from "@/lib/utils";
import PageHeader from "@/components/admin/PageHeader";
import EmptyState from "@/components/admin/EmptyState";
import Pill from "@/components/admin/Pill";
import ProductRowActions from "@/components/admin/ProductRowActions";

export const metadata = {
  title: "Products | Admin",
};

export default async function AdminProductsPage() {
  // Prices live on ProductVariant, not Product — pull them to derive a "from"
  // price; category name comes from the relation.
  const products = await prisma.product.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      category: { select: { name: true } },
      variants: { select: { price: true } },
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        eyebrow="Catalog"
        title="Products"
        description="Every item in your catalogue, newest first."
        action={
          <Link
            href="/admin/products/new"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Add New Product
          </Link>
        }
      />

      <div className="overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm">
        {products.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No products yet"
            description="Create your first product to start selling."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50/70 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">
                  <th className="px-6 py-3.5 font-semibold">Product</th>
                  <th className="px-6 py-3.5 font-semibold">Category</th>
                  <th className="px-6 py-3.5 font-semibold">Price</th>
                  <th className="px-6 py-3.5 font-semibold">Stock</th>
                  <th className="px-6 py-3.5 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => {
                  const prices = product.variants.map((v) => v.price);
                  const minPrice = prices.length ? Math.min(...prices) : null;
                  const thumb = product.images[0];
                  return (
                    <tr
                      key={product.id}
                      className="border-t border-stone-100 transition-colors hover:bg-stone-50/50"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          {/* CSS background avoids next/image remote-domain config */}
                          <div
                            className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-stone-100 bg-cover bg-center text-stone-300"
                            style={
                              thumb
                                ? { backgroundImage: `url(${thumb})` }
                                : undefined
                            }
                          >
                            {!thumb && <ImageIcon className="h-5 w-5" />}
                          </div>
                          <div>
                            <div className="font-medium text-stone-900">
                              {product.name}
                            </div>
                            <div className="text-xs text-stone-400">
                              {product.variants.length} variant
                              {product.variants.length === 1 ? "" : "s"}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-stone-500">
                        {product.category.name}
                      </td>
                      <td className="px-6 py-4 font-medium text-stone-900">
                        {minPrice === null ? (
                          <span className="text-stone-400">—</span>
                        ) : (
                          <>
                            {prices.length > 1 && (
                              <span className="text-xs font-normal text-stone-400">
                                from{" "}
                              </span>
                            )}
                            {formatEGP(minPrice)}
                          </>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {product.isAvailable ? (
                          <Pill className="bg-emerald-50 text-emerald-700 ring-emerald-600/20">
                            In Stock
                          </Pill>
                        ) : (
                          <Pill className="bg-stone-100 text-stone-500 ring-stone-300/50">
                            Out of Stock
                          </Pill>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <ProductRowActions id={product.id} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-stone-400">
        Note: the schema has no numeric inventory field yet, so “Stock” reflects
        each product’s <span className="font-medium">availability</span> flag.
      </p>
    </div>
  );
}
