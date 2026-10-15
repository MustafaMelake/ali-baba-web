"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { AlertCircle, Minus, Plus, Sparkles, Trash2 } from "lucide-react";
import { useCartStore, type CartItem } from "@/lib/cart-store";
import { useSession } from "@/lib/auth-client";
import type { RepricedVariant } from "@/lib/actions/cart";
import { CHECKOUT_MAX_QUANTITY } from "@/lib/validators";
import { roundMoney } from "@/lib/discounts";
import { formatMoney } from "@/lib/utils";

const PLACEHOLDER_IMAGE = "/placeholder.jpg";

/**
 * One line of the full cart page. Every mutation keys on `variantId` — never
 * the product id — and goes through the cart store, which mirrors it to the DB
 * cart for a signed-in customer. Prices are display-only: `item.price` is the
 * live, discounted unit price the store holds; `live` adds what a stored line
 * can't (variant label, PDP slug, promotion, "was" price, availability).
 */
export default function CartLineRow({
  item,
  live,
  unavailable,
}: {
  item: CartItem;
  /** This line's live catalogue read — null until loaded, or if absent from it. */
  live: RepricedVariant | null;
  /** The live read was asked about this line and found it gone or switched off. */
  unavailable: boolean;
}) {
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const addItem = useCartStore((s) => s.addItem);
  const closeCart = useCartStore((s) => s.closeCart);
  const setOrderNote = useCartStore((s) => s.setOrderNote);
  const isLoggedIn = !!useSession().data?.user;

  // The typed quantity while the input is focused; null = show the real one.
  const [draft, setDraft] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  const wasPrice =
    live?.compareAtPrice != null && live.compareAtPrice > item.price ? live.compareAtPrice : null;
  const href = live ? `/product/${live.productSlug}` : null;
  const imageSrc = imageFailed || !item.image ? PLACEHOLDER_IMAGE : item.image;

  function setQuantity(quantity: number) {
    updateQuantity(item.variantId, quantity, isLoggedIn);
  }

  // Typed quantities apply on blur / Enter — one sync, not one per keystroke.
  // Blank or zero reverts; removal stays an explicit action.
  function commitDraft() {
    if (draft === null) return;
    const quantity = Number.parseInt(draft, 10);
    setDraft(null);
    if (!Number.isFinite(quantity) || quantity < 1 || quantity === item.quantity) return;
    setQuantity(Math.min(quantity, CHECKOUT_MAX_QUANTITY));
  }

  function remove() {
    const removed = item;
    // Removing the last line drops the note with the bag — Undo brings both back.
    const note = useCartStore.getState().orderNote;
    removeItem(item.variantId, isLoggedIn);
    toast(`Removed ${item.name}`, {
      action: {
        label: "Undo",
        onClick: () => {
          addItem(removed, isLoggedIn);
          closeCart(); // addItem opens the drawer — we're already on the cart
          if (note && !useCartStore.getState().orderNote) setOrderNote(note);
        },
      },
    });
  }

  const thumbnail = (
    <Image
      src={imageSrc}
      alt={item.name}
      fill
      sizes="(max-width: 640px) 96px, 112px"
      className="object-cover"
      onError={() => setImageFailed(true)}
    />
  );

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -24, transition: { duration: 0.2 } }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="flex gap-4 py-6 sm:gap-6"
    >
      {/* Thumbnail */}
      <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl bg-stone-100 sm:h-28 sm:w-28">
        {href ? (
          <Link href={href} tabIndex={-1} aria-hidden="true" className="block h-full w-full">
            {thumbnail}
          </Link>
        ) : (
          thumbnail
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {item.category && (
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-400">
                {item.category}
              </p>
            )}
            <h3 className="mt-0.5 font-serif text-lg font-medium leading-snug text-stone-900">
              {href ? (
                <Link href={href} className="transition-colors hover:text-primary">
                  {item.name}
                </Link>
              ) : (
                item.name
              )}
            </h3>
            {live?.variantName && (
              <p className="mt-0.5 text-sm text-stone-500">{live.variantName}</p>
            )}
            {live?.promotionName && (
              <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                {live.promotionName}
              </span>
            )}
          </div>

          {/* Unit price */}
          <p className="shrink-0 text-right">
            <span className="block text-sm font-medium tabular-nums text-stone-900">
              {formatMoney(item.price)}
              <span className="ml-1 text-xs font-normal text-stone-400">ج.م</span>
            </span>
            {wasPrice !== null && (
              <span className="block text-xs tabular-nums text-stone-400 line-through">
                <span className="sr-only">Was </span>
                {formatMoney(wasPrice)}
              </span>
            )}
            <span className="block text-[11px] text-stone-400">each</span>
          </p>
        </div>

        {unavailable && (
          <p role="alert" className="mt-3 flex items-center gap-1.5 text-xs font-medium text-red-600">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            No longer available — remove it to check out.
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-4">
          <div className="flex items-center gap-3">
            {/* Quantity stepper */}
            <div
              role="group"
              aria-label={`Quantity of ${item.name}`}
              className="flex items-center rounded-full border border-stone-200 bg-white"
            >
              <button
                type="button"
                onClick={() => setQuantity(item.quantity - 1)}
                disabled={item.quantity <= 1}
                aria-label={`Decrease quantity of ${item.name}`}
                className="flex h-9 w-9 items-center justify-center rounded-full text-stone-500 transition-colors hover:text-stone-900 disabled:opacity-30 disabled:hover:text-stone-500"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                aria-label="Quantity"
                value={draft ?? String(item.quantity)}
                onFocus={(e) => {
                  setDraft(String(item.quantity));
                  e.currentTarget.select();
                }}
                onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 2))}
                onBlur={commitDraft}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setDraft(null);
                }}
                className="w-9 bg-transparent text-center text-sm font-semibold tabular-nums text-stone-900 outline-none"
              />
              <button
                type="button"
                onClick={() => setQuantity(item.quantity + 1)}
                disabled={item.quantity >= CHECKOUT_MAX_QUANTITY}
                aria-label={`Increase quantity of ${item.name}`}
                className="flex h-9 w-9 items-center justify-center rounded-full text-stone-500 transition-colors hover:text-stone-900 disabled:opacity-30 disabled:hover:text-stone-500"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={remove}
              aria-label={`Remove ${item.name} from your bag`}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Remove</span>
            </button>
          </div>

          {/* Line total */}
          <p className="font-serif text-lg font-medium tabular-nums text-stone-900">
            <span className="sr-only">Line total </span>
            {formatMoney(roundMoney(item.price * item.quantity))}
            <span className="ml-1 font-sans text-xs font-normal text-stone-400">ج.م</span>
          </p>
        </div>
      </div>
    </motion.li>
  );
}
