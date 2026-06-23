"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Minus, Plus, ShoppingBag, Check } from "lucide-react";
import { useCartStore } from "@/lib/cart-store";
import { useSession } from "@/lib/auth-client";
import WishlistButton from "@/components/products/WishlistButton";
import VariantSelector, {
  type SelectableVariant,
} from "@/components/products/VariantSelector";

export interface PurchaseVariant extends SelectableVariant {
  /** Optional strikethrough "was" price. Schema-ready; null until promos ship. */
  compareAtPrice?: number | null;
}

export interface ProductPurchasePanelProps {
  product: {
    id: string;
    name: string;
    images: string[];
    category: string;
  };
  variants: PurchaseVariant[];
  /** Server-resolved wishlist state — hydration-safe seed for the heart. */
  initialIsFavorited: boolean;
}

export default function ProductPurchasePanel({
  product,
  variants,
  initialIsFavorited,
}: ProductPurchasePanelProps) {
  // Default to the cheapest AVAILABLE variant. `variants` arrives ordered price-asc
  // from the query, so the first available one is the lowest in-stock price.
  const defaultVariant = variants.find((v) => v.isAvailable) ?? variants[0];

  // ── The single source of truth. Price, availability, and the Add-to-Cart
  //    payload are all *derived* from this id — never stored in parallel state,
  //    so the displayed price can't drift from the selected variant. ──
  const [selectedVariantId, setSelectedVariantId] = useState(
    defaultVariant?.id ?? ""
  );
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  const addItem = useCartStore((s) => s.addItem);
  // When logged in, each add also persists to the DB (cross-device cart).
  const isLoggedIn = !!useSession().data?.user;

  const activeVariant =
    variants.find((v) => v.id === selectedVariantId) ?? defaultVariant;

  const canPurchase = !!activeVariant?.isAvailable;
  const unitPrice = activeVariant?.price ?? 0;
  const lineTotal = unitPrice * qty;
  const showCompareAt =
    activeVariant?.compareAtPrice != null &&
    activeVariant.compareAtPrice > unitPrice;

  function handleAdd() {
    if (!activeVariant || !canPurchase) return;
    for (let i = 0; i < qty; i++) {
      addItem(
        {
          id: product.id,
          variantId: activeVariant.id, // the selected variant — never variants[0]
          name: product.name,
          price: activeVariant.price,
          image: product.images[0],
          category: product.category,
        },
        isLoggedIn,
      );
    }
    setAdded(true);
    setTimeout(() => setAdded(false), 2500);
  }

  return (
    <div className="space-y-7">
      {/* ─── Dynamic price — reflects the selected variant ───────────────
          When a promo lands (compareAtPrice > price), the original is shown
          struck-through beside the sale price. font-serif keeps the brand voice
          on the hero figure; every numeric node is tabular-nums so switching
          variants — or a discount appearing/disappearing — never shifts the row. */}
      <div className="flex items-baseline gap-2.5">
        <span className="font-serif text-4xl font-medium tracking-tight tabular-nums text-stone-900">
          {unitPrice.toLocaleString("en-EG")}
        </span>

        {showCompareAt && (
          <span
            className="font-mono text-base tabular-nums text-stone-400 line-through"
            aria-label={`Original price ${activeVariant!.compareAtPrice!.toLocaleString("en-EG")} EGP`}
          >
            {activeVariant!.compareAtPrice!.toLocaleString("en-EG")}
          </span>
        )}

        <span className="font-sans text-sm text-stone-500">ج.م</span>
      </div>

      {/* ─── Variant pills (hidden automatically when there's only one) ── */}
      <VariantSelector
        variants={variants}
        selectedVariantId={selectedVariantId}
        onSelect={setSelectedVariantId}
      />

      {/* ─── Quantity stepper ───────────────────────────────────────── */}
      <div className="flex items-center gap-5">
        <span className="shrink-0 font-sans text-[10px] font-semibold uppercase tracking-[0.25em] text-stone-400">
          Quantity
        </span>

        <div className="flex items-center gap-5 rounded-full border border-stone-200 px-5 py-2.5">
          <button
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            disabled={qty <= 1 || !canPurchase}
            aria-label="Decrease quantity"
            className="text-stone-400 transition-colors hover:text-stone-800 disabled:opacity-25"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="w-5 text-center font-sans text-sm font-semibold tabular-nums text-stone-900">
            {qty}
          </span>
          <button
            onClick={() => setQty((q) => q + 1)}
            disabled={!canPurchase}
            aria-label="Increase quantity"
            className="text-stone-400 transition-colors hover:text-stone-800 disabled:opacity-25"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ─── Primary CTA — turquoise; disabled when the variant is sold out ── */}
      <button
        onClick={handleAdd}
        disabled={!canPurchase}
        className="relative w-full overflow-hidden rounded-full bg-primary py-4 font-sans text-sm font-semibold uppercase tracking-widest text-white shadow-[0_4px_24px_rgba(25,139,158,0.35)] transition-all duration-300 hover:bg-primary/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:bg-primary disabled:active:scale-100 md:py-[1.15rem]"
        aria-label={
          !canPurchase
            ? "Selected option is sold out"
            : added
              ? "Added to cart"
              : `Add ${qty} to cart for ${lineTotal.toLocaleString("en-EG")} EGP`
        }
      >
        {!canPurchase ? (
          <span className="flex items-center justify-center gap-2.5">
            Sold Out
          </span>
        ) : (
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
                <Check className="h-4 w-4" strokeWidth={2.5} />
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
                <ShoppingBag className="h-4 w-4" />
                Add to Cart
                <span className="opacity-70">—</span>
                <span className="tabular-nums">
                  {lineTotal.toLocaleString("en-EG")}
                </span>
                ج.م
              </motion.span>
            )}
          </AnimatePresence>
        )}
      </button>

      {/* ─── Wishlist (live toggle) ──────────────────────────────────── */}
      <WishlistButton
        variant="labeled"
        productId={product.id}
        initialIsFavorited={initialIsFavorited}
      />
    </div>
  );
}
