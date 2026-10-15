"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { ArrowRight, ShoppingBag } from "lucide-react";
import { useCartStore } from "@/lib/cart-store";
import { useSession } from "@/lib/auth-client";
import type { RepricedVariant } from "@/lib/actions/cart";
import type { PricingSettings } from "@/lib/store-settings";
import type { DeliveryEstimate } from "@/lib/cart-summary";
import CartLineRow from "@/components/cart/CartLineRow";
import CartSummaryPanel from "@/components/cart/CartSummaryPanel";

function CartSkeleton() {
  return (
    <div className="grid animate-pulse gap-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-14" aria-hidden="true">
      <div className="divide-y divide-stone-100">
        {[0, 1].map((i) => (
          <div key={i} className="flex gap-6 py-6">
            <div className="h-28 w-28 rounded-2xl bg-stone-100" />
            <div className="flex-1 space-y-3 pt-1">
              <div className="h-3 w-20 rounded-full bg-stone-100" />
              <div className="h-5 w-1/2 rounded-full bg-stone-100" />
              <div className="h-9 w-32 rounded-full bg-stone-100" />
            </div>
          </div>
        ))}
      </div>
      <div className="h-96 rounded-2xl bg-stone-100" />
    </div>
  );
}

function EmptyBag() {
  return (
    <motion.div
      className="flex flex-col items-center py-16 text-center md:py-24"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
    >
      <span className="mb-8 flex h-24 w-24 items-center justify-center rounded-full bg-stone-100">
        <ShoppingBag className="h-10 w-10 text-stone-300" strokeWidth={1.25} aria-hidden="true" />
      </span>
      <h2 className="font-serif text-3xl font-medium tracking-tight text-stone-900 md:text-4xl">
        Your bag is empty
      </h2>
      <p className="mt-4 max-w-md text-sm leading-relaxed text-stone-500">
        Everything we make is baked fresh in our kitchen — find something exquisite to fill it.
      </p>
      <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
        <Link
          href="/collections"
          className="group inline-flex items-center gap-2.5 rounded-full bg-stone-900 px-8 py-4 text-xs font-semibold uppercase tracking-widest text-white transition-colors hover:bg-stone-700"
        >
          Continue Shopping
          <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
        <Link
          href="/shop"
          className="inline-flex items-center rounded-full border border-stone-200 px-8 py-4 text-xs font-semibold uppercase tracking-widest text-stone-600 transition-colors hover:border-stone-400"
        >
          Browse the shop
        </Link>
      </div>
    </motion.div>
  );
}

/** A settled live read: what came back, and which lines it was asked about. */
interface LiveRead {
  /** null when the read failed — nothing is flagged; placeOrder stays the gate. */
  lines: ReadonlyMap<string, RepricedVariant> | null;
  requested: ReadonlySet<string>;
}

/**
 * The /cart island. The Zustand cart is the single source of truth; this view
 * adds a live catalogue read (via the store's `refreshPrices`) for what a
 * stored line can't hold — variant label, PDP link, promotion, "was" price,
 * availability — and, for a guest, the current price itself. The totals stay
 * in a loading state until the first read settles, so the first figure the
 * customer sees is the one checkout will show.
 */
export default function CartView({
  pricing,
  delivery,
}: {
  pricing: PricingSettings | null;
  delivery: DeliveryEstimate | null;
}) {
  const items = useCartStore((s) => s.items);
  const refreshPrices = useCartStore((s) => s.refreshPrices);
  const { isPending: sessionPending } = useSession();

  // The cart rehydrates from localStorage after mount — wait for it rather
  // than flash "Your bag is empty" at a customer who has one (checkout does the same).
  const hydrated = useSyncExternalStore(
    useCartStore.persist.onFinishHydration,
    () => useCartStore.persist.hasHydrated(),
    () => false,
  );

  const [read, setRead] = useState<LiveRead | null>(null);

  // The lines no settled read has covered: all of them at first, then any that
  // arrive later — e.g. CartSyncProvider adopting a DB cart line added on
  // another device. Owed only once the cart is hydrated and the session has
  // settled (a signed-in customer mid-`isPending` must not be read as a guest).
  const unreadKey =
    hydrated && !sessionPending
      ? items
          .filter((item) => !read?.requested.has(item.variantId))
          .map((item) => item.variantId)
          .join(",")
      : "";
  const totalsReady = !sessionPending && read !== null;

  useEffect(() => {
    if (!unreadKey) return;
    let alive = true;
    // The same snapshot refreshPrices sends — read synchronously, before its await.
    const requested = new Set(useCartStore.getState().items.map((item) => item.variantId));
    refreshPrices()
      .then(({ updated, lines }) => {
        if (!alive) return;
        setRead({ lines: lines && new Map(lines.map((line) => [line.variantId, line])), requested });
        if (updated > 0) toast.info("Prices were updated to reflect current offers.");
      })
      .catch((err: unknown) => {
        // Non-fatal: the stored prices stay on screen; checkout re-validates.
        console.error("cart live read failed:", err);
        if (alive) setRead({ lines: null, requested });
      });
    return () => {
      alive = false;
    };
  }, [unreadKey, refreshPrices]);

  if (!hydrated) return <CartSkeleton />;
  if (items.length === 0) return <EmptyBag />;

  // Gone = asked about and absent or switched off. A line the read never saw
  // is just unread — flagging it would block checkout on a line placeOrder takes.
  const isUnavailable = (variantId: string) =>
    !!read?.lines &&
    read.requested.has(variantId) &&
    !read.lines.get(variantId)?.isAvailable;
  const unavailableCount = items.filter((item) => isUnavailable(item.variantId)).length;
  const units = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-14 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <section aria-labelledby="bag-items-heading">
        <div className="flex items-baseline justify-between gap-4 border-b border-stone-200 pb-4">
          <h2 id="bag-items-heading" className="font-serif text-2xl font-medium text-stone-900">
            Items <span className="text-lg tabular-nums text-stone-400">({units})</span>
          </h2>
          <Link
            href="/collections"
            className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500 transition-colors hover:text-primary"
          >
            Keep browsing
          </Link>
        </div>
        <ul className="divide-y divide-stone-100">
          <AnimatePresence initial={false}>
            {items.map((item) => (
              <CartLineRow
                key={item.variantId}
                item={item}
                live={read?.lines?.get(item.variantId) ?? null}
                unavailable={isUnavailable(item.variantId)}
              />
            ))}
          </AnimatePresence>
        </ul>
      </section>

      <CartSummaryPanel
        items={items}
        live={read?.lines ?? null}
        pricing={pricing}
        delivery={delivery}
        ready={totalsReady}
        unavailableCount={unavailableCount}
      />
    </div>
  );
}
