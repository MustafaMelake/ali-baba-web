"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Minus, Plus, ArrowRight, ShoppingBag } from "lucide-react";
import { useCartStore } from "@/lib/cart-store";
import { useSession } from "@/lib/auth-client";
import { clearDbCartAction } from "@/lib/actions/cart";

const EASE: [number, number, number, number] = [0.32, 0.72, 0, 1];

// ─── Empty State ─────────────────────────────────────────────────
function EmptyCart({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      className="flex flex-col items-center justify-center flex-1 text-center px-8"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: "easeOut", delay: 0.15 }}
    >
      {/* Ghost icon */}
      <div className="w-20 h-20 rounded-full bg-stone-100 flex items-center justify-center mb-7">
        <ShoppingBag className="w-8 h-8 text-stone-300" strokeWidth={1.25} />
      </div>

      <p className="font-serif text-2xl font-medium tracking-tight text-stone-800 mb-3">
        Your cart is empty.
      </p>
      <p className="font-sans text-sm text-stone-400 leading-relaxed max-w-[200px]">
        Explore our collection and add something exquisite.
      </p>

      <Link
        href="/shop"
        onClick={onClose}
        className="mt-10 group inline-flex items-center gap-2.5 rounded-full bg-stone-900 px-7 py-3.5 text-xs font-sans font-semibold uppercase tracking-widest text-white hover:bg-stone-700 transition-colors"
      >
        Explore Shop
        <ArrowRight className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
      </Link>
    </motion.div>
  );
}

// ─── Cart Line Item ───────────────────────────────────────────────
function CartLineItem({
  item,
}: {
  item: ReturnType<typeof useCartStore.getState>["items"][number];
}) {
  const { updateQuantity, removeItem } = useCartStore();
  const isLoggedIn = !!useSession().data?.user;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24, transition: { duration: 0.22 } }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="flex gap-4 py-5 border-b border-stone-100 last:border-none"
    >
      {/* Product image */}
      <div className="relative w-[72px] h-[72px] shrink-0 rounded-xl overflow-hidden bg-stone-100">
        <Image
          src={item.image}
          alt={item.name}
          fill
          className="object-cover"
          sizes="72px"
        />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            {item.category && (
              <span className="text-[10px] font-sans font-semibold uppercase tracking-[0.2em] text-stone-400">
                {item.category}
              </span>
            )}
            <p className="font-serif text-[15px] font-medium text-stone-900 leading-snug mt-0.5 truncate">
              {item.name}
            </p>
          </div>

          {/* Remove */}
          <button
            onClick={() => removeItem(item.variantId, isLoggedIn)}
            aria-label={`Remove ${item.name}`}
            className="shrink-0 p-1 -mt-0.5 text-stone-300 hover:text-stone-600 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Quantity + price row */}
        <div className="mt-3 flex items-center justify-between">
          {/* Stepper */}
          <div className="flex items-center gap-3 border border-stone-200 rounded-full px-3 py-1.5">
            <button
              onClick={() =>
                updateQuantity(item.variantId, item.quantity - 1, isLoggedIn)
              }
              aria-label="Decrease quantity"
              className="text-stone-400 hover:text-stone-800 transition-colors"
            >
              <Minus className="w-3 h-3" />
            </button>
            <span className="font-sans text-sm font-medium text-stone-800 w-5 text-center">
              {item.quantity}
            </span>
            <button
              onClick={() =>
                updateQuantity(item.variantId, item.quantity + 1, isLoggedIn)
              }
              aria-label="Increase quantity"
              className="text-stone-400 hover:text-stone-800 transition-colors"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>

          {/* Line total */}
          <span className="font-sans text-sm font-semibold text-stone-900">
            {(item.price * item.quantity).toLocaleString("ar-EG")} ج.م
          </span>
        </div>
      </div>
    </motion.li>
  );
}

// ─── Main Drawer ──────────────────────────────────────────────────
export default function CartSidebar() {
  const { isOpen, closeCart, items, clearCart, totalItems, totalPrice } =
    useCartStore();
  const isLoggedIn = !!useSession().data?.user;

  const count = totalItems();
  const total = totalPrice();

  // Intentional empty: wipe local immediately, and the DB too when logged in
  // (so the cleared cart doesn't re-hydrate from the server on next load).
  function handleClear() {
    clearCart();
    if (isLoggedIn) void clearDbCartAction();
  }

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeCart();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, closeCart]);

  // Lock body scroll while drawer is open
  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* ── Backdrop ── */}
          <motion.div
            key="cart-backdrop"
            className="fixed inset-0 z-40 bg-stone-950/40 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            onClick={closeCart}
            aria-hidden="true"
          />

          {/* ── Drawer ── */}
          <motion.aside
            key="cart-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Shopping cart"
            className="fixed right-0 top-0 bottom-0 z-50 flex w-full max-w-[420px] flex-col bg-white shadow-[−8px_0_40px_rgba(0,0,0,0.12)]"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.45, ease: EASE }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-7 pt-8 pb-5 border-b border-stone-100">
              <div>
                <p className="text-[10px] font-sans font-semibold uppercase tracking-[0.3em] text-stone-400">
                  Your Selection
                </p>
                <h2 className="mt-1 font-serif text-2xl font-medium tracking-tight text-stone-900">
                  Cart
                  {count > 0 && (
                    <span className="ml-2.5 font-sans text-base font-normal text-stone-400">
                      ({count})
                    </span>
                  )}
                </h2>
              </div>

              <button
                onClick={closeCart}
                aria-label="Close cart"
                className="flex items-center justify-center w-9 h-9 rounded-full border border-stone-200 text-stone-500 hover:border-stone-400 hover:text-stone-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            {items.length === 0 ? (
              <EmptyCart onClose={closeCart} />
            ) : (
              <>
                {/* Item list */}
                <div className="flex-1 overflow-y-auto px-7 py-2 scrollbar-none">
                  <motion.ul layout className="divide-y-0">
                    <AnimatePresence initial={false}>
                      {items.map((item) => (
                        <CartLineItem key={item.variantId} item={item} />
                      ))}
                    </AnimatePresence>
                  </motion.ul>
                </div>

                {/* Footer / checkout */}
                <div className="px-7 pb-8 pt-5 border-t border-stone-100">
                  {/* Order note */}
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="font-sans text-sm text-stone-500">
                      Subtotal
                    </span>
                    <span className="font-sans text-sm font-medium text-stone-900">
                      {total.toLocaleString("ar-EG")} ج.م
                    </span>
                  </div>
                  <p className="font-sans text-xs text-stone-400 mb-6 leading-relaxed">
                    Taxes and delivery fees calculated at checkout.
                  </p>

                  {/* Primary CTA */}
                  <Link
                    href="/checkout"
                    onClick={closeCart}
                    className="group flex w-full items-center justify-center gap-3 rounded-full bg-stone-900 px-8 py-4 text-sm font-sans font-semibold uppercase tracking-widest text-white hover:bg-stone-700 transition-colors"
                  >
                    Proceed to Checkout
                    <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" />
                  </Link>

                  {/* Clear */}
                  <button
                    onClick={handleClear}
                    className="mt-4 w-full text-center font-sans text-xs text-stone-400 hover:text-stone-600 transition-colors"
                  >
                    Clear cart
                  </button>
                </div>
              </>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
