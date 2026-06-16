"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Minus, Plus, ShoppingBag, Check, Heart } from "lucide-react";
import { useCartStore } from "@/lib/cart-store";

export interface ProductForCart {
  id: string;
  name: string;
  price: number;
  images: string[];
  category: string;
}

export default function ProductAddToCart({
  product,
}: {
  product: ProductForCart;
}) {
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const addItem = useCartStore((s) => s.addItem);

  function handleAdd() {
    for (let i = 0; i < qty; i++) {
      addItem({
        id: product.id,
        name: product.name,
        price: product.price,
        image: product.images[0],
        category: product.category,
      });
    }
    setAdded(true);
    setTimeout(() => setAdded(false), 2500);
  }

  const lineTotal = (product.price * qty).toLocaleString("en-EG");

  return (
    <div className="space-y-5 pt-2">
      {/* ─── Quantity stepper ───────────────────────────── */}
      <div className="flex items-center gap-5">
        <span className="text-[10px] font-sans font-semibold uppercase tracking-[0.25em] text-stone-400 shrink-0">
          Quantity
        </span>

        <div className="flex items-center gap-5 border border-stone-200 rounded-full px-5 py-2.5">
          <button
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            disabled={qty <= 1}
            aria-label="Decrease quantity"
            className="text-stone-400 hover:text-stone-800 disabled:opacity-25 transition-colors"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span className="font-sans text-sm font-semibold text-stone-900 w-5 text-center tabular-nums">
            {qty}
          </span>
          <button
            onClick={() => setQty((q) => q + 1)}
            aria-label="Increase quantity"
            className="text-stone-400 hover:text-stone-800 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ─── Primary CTA — turquoise ────────────────────── */}
      <button
        onClick={handleAdd}
        className="relative w-full overflow-hidden rounded-full bg-primary py-4 md:py-[1.15rem] font-sans text-sm font-semibold uppercase tracking-widest text-white shadow-[0_4px_24px_rgba(25,139,158,0.35)] hover:bg-primary/90 active:scale-[0.98] transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        aria-label={
          added ? "Added to cart" : `Add ${qty} to cart for ${lineTotal} EGP`
        }
      >
        <AnimatePresence mode="wait" initial={false}>
          {added ? (
            <motion.span
              key="added"
              className="flex items-center justify-center gap-2.5"
              initial={{ y: 18, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -18, opacity: 0 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              <Check className="w-4 h-4" strokeWidth={2.5} />
              Added to Cart
            </motion.span>
          ) : (
            <motion.span
              key="add"
              className="flex items-center justify-center gap-2.5"
              initial={{ y: 18, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -18, opacity: 0 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              <ShoppingBag className="w-4 h-4" />
              Add to Cart
              <span className="opacity-70">—</span>
              {lineTotal} ج.م
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      {/* ─── Wishlist ───────────────────────────────────── */}
      <button className="group flex w-full items-center justify-center gap-2 font-sans text-xs text-stone-400 hover:text-stone-700 transition-colors">
        <Heart className="w-3.5 h-3.5 group-hover:fill-stone-300 transition-all" />
        Save to Wishlist
      </button>
    </div>
  );
}
