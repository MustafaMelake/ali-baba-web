import { Boxes, ImageIcon } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { CategoryIdentifier } from "@/generated/prisma/enums";
import PageHeader from "@/components/admin/PageHeader";
import CategoryEditButton from "@/components/admin/CategoryEditButton";

export const metadata = {
  title: "Categories | Admin",
};

// ORIENTAL_SWEETS -> "Oriental Sweets"
function prettyLabel(identifier: string) {
  return identifier
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default async function AdminCategoriesPage() {
  // Core categories carry a unique `identifier`; pull them with a live product count.
  const rows = await prisma.category.findMany({
    where: { identifier: { not: null } },
    select: {
      id: true,
      name: true,
      subtitle: true,
      image: true,
      identifier: true,
      _count: { select: { products: true } },
    },
  });

  // Index DB rows by identifier so we can render all five enum members even if
  // a Category row hasn't been seeded yet.
  const byIdentifier = new Map(
    rows.map((row) => [row.identifier as CategoryIdentifier, row]),
  );

  const cards = Object.values(CategoryIdentifier).map((identifier) => {
    const row = byIdentifier.get(identifier);
    return {
      identifier,
      row, // present only for seeded categories (needed to edit)
      name: row?.name ?? prettyLabel(identifier),
      subtitle: row?.subtitle ?? null,
      image: row?.image ?? null,
      count: row?._count.products ?? 0,
    };
  });

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        eyebrow="Catalog"
        title="Categories"
        description="The five core collections surfaced across the storefront. Edit a card to update its hero image and subtitle."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <article
            key={card.identifier}
            className="group flex flex-col overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm transition-shadow hover:shadow-md"
          >
            {/* Hero image (plain CSS background — UploadThing URLs, no next/image) */}
            <div
              className="relative flex h-36 items-center justify-center bg-stone-100 bg-cover bg-center"
              style={
                card.image ? { backgroundImage: `url(${card.image})` } : undefined
              }
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
                  <h2 className="font-serif text-xl font-medium text-stone-900">
                    {card.name}
                  </h2>
                  <p className="mt-1 line-clamp-1 text-sm text-stone-400">
                    {card.subtitle ?? "—"}
                  </p>
                </div>
                {card.row && (
                  <CategoryEditButton
                    category={{
                      id: card.row.id,
                      name: card.row.name,
                      subtitle: card.row.subtitle,
                      image: card.row.image,
                      identifier: card.row.identifier,
                    }}
                  />
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
    </div>
  );
}
