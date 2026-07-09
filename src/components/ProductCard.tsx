"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Check, ArrowUpRight } from "lucide-react";
import { useCartStore } from "@/lib/cart-store";
import { useSession } from "@/lib/auth-client";
import { formatMoney } from "@/lib/utils";
import WishlistButton from "@/components/products/WishlistButton";

export interface ShopProduct {
  id: string;
  /** Starting (lowest-price) variant id — what the quick-add / cart references. */
  variantId: string;
  name: string;
  slug: string;
  category: string;
  /** Final (possibly discounted) starting price — what quick-add charges. */
  price: number;
  /**
   * The undiscounted "was" price, shown struck-through. Set only when an active
   * promotion lowered `price`; null/undefined otherwise (no sale). See
   * src/lib/discounts.ts.
   */
  compareAtPrice?: number | null;
  image: string;
  tagline?: string;
}

export default function ProductCard({ product }: { product: ShopProduct }) {
  const addItem = useCartStore((s) => s.addItem);
  // When logged in, mutations also persist to the DB (cross-device cart).
  const isLoggedIn = !!useSession().data?.user;
  const [added, setAdded] = useState(false);

  // Detail route lives at (shop)/product/[slug] → /product/<slug>
  const href = `/product/${product.slug}`;

  // A promotion is on when the "was" price is strictly above the selling price.
  const onSale =
    product.compareAtPrice != null && product.compareAtPrice > product.price;
  const percentOff = onSale
    ? Math.round((1 - product.price / product.compareAtPrice!) * 100)
    : 0;

  function quickAdd() {
    addItem(
      {
        id: product.id,
        variantId: product.variantId,
        name: product.name,
        price: product.price,
        image: product.image,
        category: product.category,
      },
      isLoggedIn,
    );
    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  }

  return (
    <article className="group flex flex-col">

      {/* ─── Image ─────────────────────────────────────── */}
      <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-stone-100">
        {/* The link covers the image only — keeps interactive nesting valid */}
        <Link href={href} aria-label={`View ${product.name}`} className="block h-full w-full">
          <Image
            src={product.image}
            alt={product.name}
            fill
            className="object-cover transition-transform duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.07]"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
          />
          {/* Subtle veil that deepens on hover for text legibility */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent opacity-60 group-hover:opacity-90 transition-opacity duration-500" />
        </Link>

        {/* Sale badge — only while a promotion is live */}
        {onSale && (
          <div className="absolute top-3 left-3 z-10 rounded-full bg-primary px-2.5 py-1 font-sans text-[11px] font-bold tracking-wide text-white shadow-sm">
            -{percentOff}%
          </div>
        )}

        {/* Wishlist heart — sibling over the image, always visible. State
            hydrates client-side from the shared wishlist store. */}
        <div className="absolute top-3 right-3 z-10">
          <WishlistButton variant="icon" productId={product.id} />
        </div>

        {/* Quick-add — sibling over the image, slides up on hover */}
        <button
          onClick={quickAdd}
          aria-label={added ? `${product.name} added to cart` : `Add ${product.name} to cart`}
          className="absolute bottom-3.5 right-3.5 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white text-stone-900 shadow-[0_4px_16px_rgba(0,0,0,0.16)] transition-all duration-300 ease-out hover:bg-primary hover:text-white translate-y-3 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <AnimatePresence mode="wait" initial={false}>
            {added ? (
              <motion.span
                key="check"
                initial={{ scale: 0, rotate: -30 }}
                animate={{ scale: 1, rotate: 0 }}
                exit={{ scale: 0 }}
                transition={{ duration: 0.2 }}
              >
                <Check className="h-4 w-4" strokeWidth={2.5} />
              </motion.span>
            ) : (
              <motion.span
                key="plus"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                transition={{ duration: 0.2 }}
              >
                <Plus className="h-4 w-4" />
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>

      {/* ─── Info ──────────────────────────────────────── */}
      <div className="pt-4 flex flex-col flex-1">
        <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400 mb-2">
          {product.category}
        </p>

        <Link href={href} className="block">
          <h3 className="font-serif text-xl md:text-[1.4rem] font-medium leading-snug tracking-tight text-stone-900 transition-colors duration-200 group-hover:text-primary">
            {product.name}
          </h3>
        </Link>

        {product.tagline && (
          <p className="mt-1.5 font-sans text-[13px] text-stone-400 leading-relaxed line-clamp-1">
            {product.tagline}
          </p>
        )}

        {/* Price + Discover */}
        <div className="mt-4 flex items-center justify-between border-t border-stone-100 pt-3.5">
          <span className="flex items-baseline gap-2">
            <span className="font-serif text-lg font-medium text-stone-900">
              {formatMoney(product.price)}
              <span className="ml-1 font-sans text-xs font-normal text-stone-400">
                ج.م
              </span>
            </span>
            {onSale && (
              <span
                className="font-sans text-xs tabular-nums text-stone-400 line-through"
                aria-label={`Original price ${formatMoney(product.compareAtPrice!)} EGP`}
              >
                {formatMoney(product.compareAtPrice!)}
              </span>
            )}
          </span>

          <Link
            href={href}
            className="group/disc flex items-center gap-1 font-sans text-[11px] font-semibold uppercase tracking-[0.15em] text-stone-500 hover:text-primary transition-colors"
          >
            Discover
            <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover/disc:translate-x-0.5 group-hover/disc:-translate-y-0.5" />
          </Link>
        </div>
      </div>
    </article>
  );
}
