import { Boxes, ImageIcon, Sparkles, Tags } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/session";
import PageHeader from "@/components/admin/PageHeader";
import EmptyState from "@/components/admin/EmptyState";
import CategoryEditButton from "@/components/admin/CategoryEditButton";
import CreateCategoryButton from "@/components/admin/CreateCategoryButton";
import DeleteCategoryButton from "@/components/admin/DeleteCategoryButton";

export const metadata = {
  title: "Categories | Admin",
};

type CategoryRow = {
  id: string;
  name: string;
  subtitle: string | null;
  image: string | null;
  isFeatured: boolean;
  sliderOrder: number;
  _count: { products: number };
};

/** One catalog category card — shared by the Featured and Standard sections. */
function CategoryCard({ category }: { category: CategoryRow }) {
  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm transition-shadow hover:shadow-md">
      {/* Hero image (plain CSS background — UploadThing URLs, no next/image) */}
      <div
        className="relative flex h-36 items-center justify-center bg-stone-100 bg-cover bg-center"
        style={category.image ? { backgroundImage: `url(${category.image})` } : undefined}
      >
        {!category.image && <ImageIcon className="h-7 w-7 text-stone-300" />}
        {category.isFeatured && (
          <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-primary/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow-sm ring-1 ring-inset ring-white/20">
            <Sparkles className="h-3 w-3" />
            Slide #{category.sliderOrder}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-serif text-xl font-medium text-stone-900">{category.name}</h3>
            <p className="mt-1 line-clamp-1 text-sm text-stone-400">{category.subtitle ?? "—"}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <CategoryEditButton
              category={{
                id: category.id,
                name: category.name,
                subtitle: category.subtitle,
                image: category.image,
                isFeatured: category.isFeatured,
                sliderOrder: category.sliderOrder,
              }}
            />
            <DeleteCategoryButton id={category.id} name={category.name} />
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2 border-t border-stone-100 pt-4 text-sm">
          <Boxes className="h-4 w-4 text-stone-400" />
          <span className="font-medium text-stone-900">{category._count.products}</span>
          <span className="text-stone-400">
            product{category._count.products === 1 ? "" : "s"} in this category
          </span>
        </div>
      </div>
    </article>
  );
}

export default async function AdminCategoriesPage() {
  await requireAdminPage();

  // Every category, with a live product count. Featured rows come back ordered
  // by sliderOrder (mirroring the storefront slider); the rest sort by recency.
  const categories: CategoryRow[] = await prisma.category.findMany({
    orderBy: [{ sliderOrder: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      subtitle: true,
      image: true,
      isFeatured: true,
      sliderOrder: true,
      _count: { select: { products: true } },
    },
  });

  const featured = categories.filter((c) => c.isFeatured);
  const standard = categories.filter((c) => !c.isFeatured);

  return (
    <div className="mx-auto max-w-6xl space-y-12">
      <PageHeader
        eyebrow="Catalog"
        title="Categories"
        description="Curate the homepage slider and manage every product collection. Toggle a category's “Feature in slider” switch to surface it on the storefront."
        action={<CreateCategoryButton />}
      />

      {/* ── Featured in slider ─────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">
            Featured in Slider
          </h2>
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-stone-500">
            {featured.length}
          </span>
        </div>

        {featured.length === 0 ? (
          <div className="overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm">
            <EmptyState
              icon={Sparkles}
              title="No featured categories yet"
              description="Turn on “Feature in slider” when creating or editing a category to surface it in the homepage carousel."
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((category) => (
              <CategoryCard key={category.id} category={category} />
            ))}
          </div>
        )}
      </section>

      {/* ── Standard categories ───────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">
            Standard Categories
          </h2>
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-stone-500">
            {standard.length}
          </span>
        </div>

        {standard.length === 0 ? (
          <div className="overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm">
            <EmptyState
              icon={Tags}
              title="No standard categories yet"
              description="Categories that aren't featured in the slider will appear here."
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {standard.map((category) => (
              <CategoryCard key={category.id} category={category} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
