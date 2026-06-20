import Link from "next/link";
import { ChevronRight } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ProductCard, { type ShopProduct } from "@/components/ProductCard";

/**
 * The shape this template needs from a fetched Product. It is intentionally a
 * structural subset of the Prisma result — pass the rows from
 * `prisma.product.findMany({ include: { category: true, variants: ... } })`
 * straight through; the extra fields Prisma returns are simply ignored.
 *
 * `variants` is expected to be ordered ascending by price so `variants[0]` is
 * the starting (lowest) price.
 */
export interface CategoryProduct {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  images: string[];
  category: { name: string };
  variants: { price: number }[];
}

export interface CategoryPageTemplateProps {
  /** Display title of the category, e.g. "Oriental Sweets". */
  title: string;
  /** Editorial description shown beneath the title. */
  description: string;
  /** Products belonging to this category, already fetched server-side. */
  products: CategoryProduct[];
}

/**
 * Shared Server Component that renders a single category landing page:
 * an editorial header followed by a responsive product grid.
 *
 * Server Component by default (no "use client") — it composes the client
 * `ProductCard` for interactivity (quick-add) while everything else streams
 * as server-rendered HTML.
 */
export default function CategoryPageTemplate({
  title,
  description,
  products,
}: CategoryPageTemplateProps) {
  return (
    <div className="min-h-screen bg-white font-sans" dir="ltr">
      <Navbar />

      <main>
        {/* ─── Editorial header ─────────────────────────────── */}
        <header className="relative overflow-hidden border-b border-stone-100 bg-[#FAFAFA]">
          <div className="mx-auto max-w-screen-xl px-6 pb-12 pt-28 text-center md:px-10 md:pb-16 md:pt-36 lg:px-14">
            {/* Breadcrumb */}
            <nav
              aria-label="Breadcrumb"
              className="mb-7 flex items-center justify-center gap-1.5 font-sans text-[11px] font-medium uppercase tracking-[0.18em] text-stone-400"
            >
              <Link
                href="/"
                className="transition-colors hover:text-primary"
              >
                Home
              </Link>
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
              <Link
                href="/shop"
                className="transition-colors hover:text-primary"
              >
                Shop
              </Link>
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
              <span className="text-stone-600">{title}</span>
            </nav>

            <p className="mb-5 font-sans text-[11px] font-semibold uppercase tracking-[0.35em] text-primary">
              The Collection
            </p>

            <h1 className="font-serif font-medium leading-[1.03] tracking-tight text-stone-900 text-[clamp(2.5rem,6.5vw,5rem)]">
              {title}
            </h1>

            <p className="mx-auto mt-6 max-w-2xl font-sans text-base leading-relaxed text-stone-500 md:text-lg">
              {description}
            </p>

            <p className="mt-8 font-sans text-xs font-medium uppercase tracking-[0.2em] text-stone-400">
              {products.length}{" "}
              {products.length === 1 ? "creation" : "creations"}
            </p>
          </div>
        </header>

        {/* ─── Product grid ─────────────────────────────────── */}
        <section
          aria-label={`${title} products`}
          className="mx-auto max-w-screen-xl px-6 py-14 md:px-10 md:py-20 lg:px-14"
        >
          {products.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <p className="font-serif text-2xl font-medium text-stone-700 md:text-3xl">
                Nothing here just yet
              </p>
              <p className="mt-3 max-w-md font-sans text-sm text-stone-400">
                We&apos;re still perfecting this collection. Explore the rest of
                the maison in the meantime.
              </p>
              <Link
                href="/shop"
                className="mt-8 inline-flex items-center gap-2 rounded-full bg-stone-900 px-7 py-3 font-sans text-xs font-semibold uppercase tracking-[0.18em] text-white transition-colors hover:bg-primary"
              >
                Browse all collections
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {products.map((product) => {
                const card: ShopProduct = {
                  id: product.id,
                  name: product.name,
                  slug: product.slug,
                  category: product.category.name,
                  price: product.variants[0]?.price ?? 0,
                  image: product.images[0] ?? "/placeholder.jpg",
                  tagline: product.description ?? undefined,
                };
                return <ProductCard key={product.id} product={card} />;
              })}
            </div>
          )}
        </section>
      </main>

      <Footer />
    </div>
  );
}
