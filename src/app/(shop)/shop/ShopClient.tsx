"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ProductCard, { type ShopProduct } from "@/components/ProductCard";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const ALL = "All Collection";

export interface ShopClientProps {
  /** Category names fetched from the DB (without the synthetic "All Collection"). */
  categories: string[];
  products: ShopProduct[];
}

export default function ShopClient({ categories, products }: ShopClientProps) {
  // "All Collection" is always the first, synthetic filter; the rest come from data.
  const filters = [ALL, ...categories];

  const [active, setActive] = useState<string>(ALL);

  const filtered =
    active === ALL ? products : products.filter((p) => p.category === active);

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
              const isActive = active === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setActive(cat)}
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
                  <span className="relative z-10 whitespace-nowrap">{cat}</span>
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
          key={active}
          className="font-sans text-xs uppercase tracking-[0.2em] text-stone-400 mb-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          {filtered.length} {filtered.length === 1 ? "Creation" : "Creations"}
          {active !== ALL && ` · ${active}`}
        </motion.p>

        <motion.div
          layout
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8"
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
