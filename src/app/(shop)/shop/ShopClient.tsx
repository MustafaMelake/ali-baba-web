"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import ProductCard, { type ShopProduct } from "@/components/ProductCard";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const ALL = "All Collection";

/** A shop category as the filter bar needs it: display name + URL slug. */
export interface ShopCategory {
  name: string;
  slug: string;
}

export interface ShopClientProps {
  /** Categories fetched from the DB (without the synthetic "All Collection"). */
  categories: ShopCategory[];
  /** Already filtered server-side to the active category — rendered as-is. */
  products: ShopProduct[];
}

export default function ShopClient({ categories, products }: ShopClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Keeps the UI interactive while the server refetches the filtered grid, and
  // exposes a pending flag we use to dim the grid mid-transition.
  const [isPending, startTransition] = useTransition();

  // The active filter is the URL's ?category=slug (null ⇒ "All Collection").
  const activeSlug = searchParams.get("category");
  const activeName =
    categories.find((c) => c.slug === activeSlug)?.name ?? ALL;

  // "All Collection" is the first, synthetic filter (slug=null); the rest are data.
  const filters: { name: string; slug: string | null }[] = [
    { name: ALL, slug: null },
    ...categories,
  ];

  // Push the new filter into the URL (slug, or none for "All Collection") as a
  // transition: scroll:false keeps the sticky bar in place — no jump to top.
  function selectCategory(slug: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (slug) params.set("category", slug);
    else params.delete("category");
    const query = params.toString();
    startTransition(() => {
      router.push(query ? `/shop?${query}` : "/shop", { scroll: false });
    });
  }

  // Server already returned exactly the rows for the active category.
  const filtered = products;

  return (
    <div className="min-h-screen bg-white pt-8 md:pt-10">
      {/* ─── Editorial header ──────────────────────────────── */}
      <header className="max-w-screen-xl mx-auto px-6 md:px-10 lg:px-14 pt-12 md:pt-20 pb-10 md:pb-14 text-center">
        <motion.span
          className="inline-block font-sans text-[11px] font-semibold uppercase tracking-[0.35em] text-primary mb-6"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE }}
        >
          Est. 1998 · The Maison
        </motion.span>

        <motion.h1
          className="font-serif font-medium tracking-tight leading-[1.02] text-stone-900 text-[clamp(2.5rem,7vw,5.5rem)]"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: EASE, delay: 0.08 }}
        >
          The Signature <em className="not-italic text-primary">Collection</em>
        </motion.h1>

        <motion.p
          className="mx-auto mt-6 max-w-xl font-sans text-base text-stone-500 leading-relaxed"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.2 }}
        >
          A curated anthology of our most celebrated creations — each one
          hand-crafted in the Menouf kitchen, perfected over a quarter century.
        </motion.p>
      </header>

      {/* ─── Filter bar ────────────────────────────────────── */}
      <motion.div
        className="sticky top-0 md:top-0 z-30 bg-white/90 backdrop-blur-md border-y border-stone-100"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.3 }}
      >
        <div className="max-w-screen-xl mx-auto px-4 md:px-10 lg:px-14">
          <div className="flex items-center justify-center gap-2 overflow-x-auto py-4 scrollbar-none -mx-1 px-1">
            {filters.map((cat) => {
              const isActive = cat.slug === activeSlug;
              return (
                <button
                  key={cat.name}
                  onClick={() => selectCategory(cat.slug)}
                  className={`relative shrink-0 rounded-full px-5 py-2.5 font-sans text-[13px] font-medium uppercase tracking-[0.12em] transition-colors duration-300 ${
                    isActive
                      ? "text-white"
                      : "text-stone-500 hover:text-stone-900"
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="shop-filter-pill"
                      className="absolute inset-0 rounded-full bg-stone-900"
                      transition={{
                        type: "spring",
                        stiffness: 380,
                        damping: 32,
                      }}
                    />
                  )}
                  <span className="relative z-10 whitespace-nowrap">{cat.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </motion.div>

      {/* ─── Product grid ──────────────────────────────────── */}
      <div className="max-w-screen-xl mx-auto px-6 md:px-10 lg:px-14 py-12 md:py-16">
        {/* Result count */}
        <motion.p
          key={activeName}
          className="font-sans text-xs uppercase tracking-[0.2em] text-stone-400 mb-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          {filtered.length} {filtered.length === 1 ? "Creation" : "Creations"}
          {activeName !== ALL && ` · ${activeName}`}
        </motion.p>

        <motion.div
          layout
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8"
          // Pending dim while the server refetches — purely additive (opacity 1
          // at rest, so the resting layout is byte-identical); a CSS opacity
          // transition that never touches Framer's transform-based layout anim.
          style={{ opacity: isPending ? 0.6 : 1, transition: "opacity 0.25s ease" }}
        >
          <AnimatePresence mode="popLayout">
            {filtered.map((product) => (
              <motion.div
                key={product.id}
                layout
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ duration: 0.45, ease: EASE }}
              >
                <ProductCard product={product} />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>

        {/* Empty state — now genuinely reachable when a category has no products. */}
        {filtered.length === 0 && (
          <div className="py-24 text-center">
            <p className="font-serif text-2xl text-stone-800 mb-2">
              Nothing here yet.
            </p>
            <p className="font-sans text-sm text-stone-400">
              This collection is being perfected. Please check back soon.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
