import { Boxes, ImageIcon, Tags } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/session";
import { CategoryIdentifier } from "@/generated/prisma/enums";
import { prettyLabel } from "@/lib/utils";
import PageHeader from "@/components/admin/PageHeader";
import EmptyState from "@/components/admin/EmptyState";
import CategoryEditButton from "@/components/admin/CategoryEditButton";
import CreateCategoryButton from "@/components/admin/CreateCategoryButton";
import DeleteCategoryButton from "@/components/admin/DeleteCategoryButton";

export const metadata = {
  title: "Categories | Admin",
};

export default async function AdminCategoriesPage() {
  await requireAdminPage();

  // Every category, core and standard alike, with a live product count.
  const categories = await prisma.category.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      subtitle: true,
      image: true,
      identifier: true,
      _count: { select: { products: true } },
    },
  });

  const byIdentifier = new Map(
    categories
      .filter((c) => c.identifier !== null)
      .map((c) => [c.identifier as CategoryIdentifier, c]),
  );

  // Render all five enum slots even if a slot's category hasn't been created yet.
  const coreCards = Object.values(CategoryIdentifier).map((identifier) => {
    const row = byIdentifier.get(identifier);
    return {
      identifier,
      row, // present only once a category has claimed this slot
      name: row?.name ?? prettyLabel(identifier),
      subtitle: row?.subtitle ?? null,
      image: row?.image ?? null,
      count: row?._count.products ?? 0,
    };
  });

  const standardCategories = categories.filter((c) => c.identifier === null);

  return (
    <div className="mx-auto max-w-6xl space-y-12">
      <PageHeader
        eyebrow="Catalog"
        title="Categories"
        description="The five core collections surfaced across the storefront, plus any standard categories you've created."
        action={<CreateCategoryButton />}
      />

      {/* ── Core categories (homepage slider slots) ──────────────── */}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">
          Core Categories
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {coreCards.map((card) => (
            <article
              key={card.identifier}
              className="group flex flex-col overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm transition-shadow hover:shadow-md"
            >
              {/* Hero image (plain CSS background — UploadThing URLs, no next/image) */}
              <div
                className="relative flex h-36 items-center justify-center bg-stone-100 bg-cover bg-center"
                style={card.image ? { backgroundImage: `url(${card.image})` } : undefined}
              >
                {!card.image && <ImageIcon className="h-7 w-7 text-stone-300" />}
                {!card.row && (
                  <span className="absolute right-3 top-3 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600 ring-1 ring-inset ring-amber-600/20">
                    Not set up
                  </span>
                )}
              </div>

              <div className="flex flex-1 flex-col p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-serif text-xl font-medium text-stone-900">
                      {card.name}
                    </h3>
                    <p className="mt-1 line-clamp-1 text-sm text-stone-400">
                      {card.subtitle ?? "—"}
                    </p>
                  </div>
                  {card.row && (
                    <div className="flex shrink-0 items-center gap-2">
                      <CategoryEditButton
                        category={{
                          id: card.row.id,
                          name: card.row.name,
                          subtitle: card.row.subtitle,
                          image: card.row.image,
                          identifier: card.row.identifier,
                        }}
                      />
                      <DeleteCategoryButton id={card.row.id} name={card.row.name} />
                    </div>
                  )}
                </div>

                <div className="mt-5 flex items-center gap-2 border-t border-stone-100 pt-4 text-sm">
                  <Boxes className="h-4 w-4 text-stone-400" />
                  <span className="font-medium text-stone-900">{card.count}</span>
                  <span className="text-stone-400">
                    product{card.count === 1 ? "" : "s"} in this category
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ── Standard categories ───────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">
          Standard Categories
        </h2>

        {standardCategories.length === 0 ? (
          <div className="overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm">
            <EmptyState
              icon={Tags}
              title="No standard categories yet"
              description="Categories you create without a core position will appear here."
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {standardCategories.map((category) => (
              <article
                key={category.id}
                className="group flex flex-col overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm transition-shadow hover:shadow-md"
              >
                <div
                  className="relative flex h-36 items-center justify-center bg-stone-100 bg-cover bg-center"
                  style={category.image ? { backgroundImage: `url(${category.image})` } : undefined}
                >
                  {!category.image && <ImageIcon className="h-7 w-7 text-stone-300" />}
                </div>

                <div className="flex flex-1 flex-col p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-serif text-xl font-medium text-stone-900">
                        {category.name}
                      </h3>
                      <p className="mt-1 line-clamp-1 text-sm text-stone-400">
                        {category.subtitle ?? "—"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <CategoryEditButton
                        category={{
                          id: category.id,
                          name: category.name,
                          subtitle: category.subtitle,
                          image: category.image,
                          identifier: category.identifier,
                        }}
                      />
                      <DeleteCategoryButton id={category.id} name={category.name} />
                    </div>
                  </div>

                  <div className="mt-5 flex items-center gap-2 border-t border-stone-100 pt-4 text-sm">
                    <Boxes className="h-4 w-4 text-stone-400" />
                    <span className="font-medium text-stone-900">
                      {category._count.products}
                    </span>
                    <span className="text-stone-400">
                      product{category._count.products === 1 ? "" : "s"} in this category
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
