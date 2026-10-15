"use client";

import Link from "next/link";
import { ArrowRight, Banknote, ChefHat } from "lucide-react";
import { useCartStore, type CartItem } from "@/lib/cart-store";
import type { RepricedVariant } from "@/lib/actions/cart";
import type { PricingSettings } from "@/lib/store-settings";
import { summarizeCart, type DeliveryEstimate } from "@/lib/cart-summary";
import { ORDER_NOTES_MAX_LENGTH } from "@/lib/validators";
import { formatMoney } from "@/lib/utils";

function Money({ value, ready }: { value: number; ready: boolean }) {
  if (!ready) {
    return <span className="inline-block h-4 w-16 animate-pulse rounded bg-stone-200" aria-hidden="true" />;
  }
  return (
    <span className="tabular-nums">
      {formatMoney(value)}
      <span className="ml-1 text-xs font-normal text-stone-400">ج.م</span>
    </span>
  );
}

function deliveryLabel(delivery: DeliveryEstimate | null): string {
  if (!delivery) return "Calculated at checkout";
  if (delivery.max === 0) return "Free";
  if (delivery.min === delivery.max) return `${formatMoney(delivery.min)} ج.م`;
  return `${formatMoney(delivery.min)} – ${formatMoney(delivery.max)} ج.م`;
}

/**
 * The sticky order summary: a preview of what checkout will bill (same order of
 * operations as placeOrder — see src/lib/cart-summary.ts), the order-notes box
 * (stored with the cart, pre-filled at checkout) and the checkout CTA — held
 * back while a line is no longer purchasable, since placeOrder would refuse it.
 */
export default function CartSummaryPanel({
  items,
  live,
  pricing,
  delivery,
  ready,
  unavailableCount,
}: {
  items: CartItem[];
  live: ReadonlyMap<string, RepricedVariant> | null;
  /** null when the settings read failed — VAT is deferred to checkout. */
  pricing: PricingSettings | null;
  delivery: DeliveryEstimate | null;
  /** False while the live re-price is still settling the figures. */
  ready: boolean;
  unavailableCount: number;
}) {
  const orderNote = useCartStore((s) => s.orderNote);
  const setOrderNote = useCartStore((s) => s.setOrderNote);

  const totals = summarizeCart(
    items,
    (variantId) => live?.get(variantId)?.compareAtPrice ?? null,
    pricing,
  );
  const blocked = unavailableCount > 0;

  return (
    <aside aria-labelledby="order-summary-heading" className="space-y-4 lg:sticky lg:top-28 lg:self-start">
      <div className="rounded-2xl border border-stone-100 bg-stone-50 p-6 md:p-8">
        <h2
          id="order-summary-heading"
          className="font-serif text-2xl font-medium tracking-tight text-stone-900"
        >
          Order Summary
        </h2>

        <dl className="mt-6 space-y-3 text-sm" aria-busy={!ready}>
          {totals.savings > 0 && (
            <>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-stone-500">
                  Items <span className="tabular-nums">({totals.itemCount})</span>
                </dt>
                <dd className="text-stone-400 line-through">
                  <Money value={totals.originalTotal} ready={ready} />
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-emerald-700">You save</dt>
                <dd className="font-medium text-emerald-700">
                  {ready && "−"}
                  <Money value={totals.savings} ready={ready} />
                </dd>
              </div>
            </>
          )}
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-stone-500">
              Subtotal
              {totals.savings === 0 && (
                <span className="tabular-nums"> ({totals.itemCount} {totals.itemCount === 1 ? "item" : "items"})</span>
              )}
            </dt>
            <dd className="font-medium text-stone-900">
              <Money value={totals.subtotal} ready={ready} />
            </dd>
          </div>
          {pricing === null ? (
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-stone-500">VAT</dt>
              <dd className="text-right text-stone-600">Calculated at checkout</dd>
            </div>
          ) : (
            pricing.isVatEnabled && (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-stone-500">
                  VAT (<span className="tabular-nums">{totals.vatPercent}%</span>)
                </dt>
                <dd className="font-medium text-stone-900">
                  <Money value={totals.vat} ready={ready} />
                </dd>
              </div>
            )
          )}
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-stone-500">Delivery</dt>
            <dd className="text-right tabular-nums text-stone-600">{deliveryLabel(delivery)}</dd>
          </div>
        </dl>

        <div className="mt-6 flex items-baseline justify-between gap-4 border-t border-stone-200 pt-5">
          <p className="text-sm font-medium text-stone-700">
            {pricing === null ? "Total before VAT & delivery" : "Total before delivery"}
          </p>
          <p className="font-serif text-3xl font-medium text-stone-900">
            <Money value={totals.totalBeforeDelivery} ready={ready} />
          </p>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-stone-400">
          The delivery fee depends on your area and is added at checkout
          {delivery?.pickupAvailable ? " — pickup from a branch is free." : "."}
        </p>

        {/* Order notes — persisted with the cart, pre-filled at checkout. */}
        <div className="mt-8">
          <label
            htmlFor="order-note"
            className="flex items-baseline justify-between gap-4 text-sm font-medium text-stone-700"
          >
            Order notes
            <span className="text-xs font-normal tabular-nums text-stone-400" aria-hidden="true">
              {orderNote.length}/{ORDER_NOTES_MAX_LENGTH}
            </span>
          </label>
          <textarea
            id="order-note"
            rows={3}
            value={orderNote}
            onChange={(e) => setOrderNote(e.target.value)}
            maxLength={ORDER_NOTES_MAX_LENGTH}
            aria-describedby="order-note-help"
            placeholder="Gift message, dietary needs, delivery instructions…"
            className="mt-2 w-full resize-y rounded-xl border border-stone-200 bg-white px-3.5 py-3 text-sm text-stone-900 outline-none transition-colors placeholder:text-stone-400 focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <p id="order-note-help" className="mt-1.5 text-xs text-stone-400">
            Saved with your bag and carried over to checkout.
          </p>
        </div>

        {/* CTA */}
        <div className="mt-8">
          {blocked ? (
            <>
              <button
                type="button"
                disabled
                aria-describedby="checkout-blocked"
                className="flex w-full cursor-not-allowed items-center justify-center gap-3 rounded-full bg-stone-900 px-8 py-4 text-sm font-semibold uppercase tracking-widest text-white opacity-40"
              >
                Proceed to Checkout
              </button>
              <p id="checkout-blocked" role="status" className="mt-3 text-center text-xs font-medium text-red-600">
                Remove {unavailableCount === 1 ? "the unavailable item" : `${unavailableCount} unavailable items`} to continue.
              </p>
            </>
          ) : (
            <Link
              href="/checkout"
              className="group flex w-full items-center justify-center gap-3 rounded-full bg-stone-900 px-8 py-4 text-sm font-semibold uppercase tracking-widest text-white transition-colors hover:bg-stone-700"
            >
              Proceed to Checkout
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
            </Link>
          )}
          <Link
            href="/collections"
            className="mt-4 block text-center text-xs font-semibold uppercase tracking-[0.18em] text-stone-500 transition-colors hover:text-primary"
          >
            Continue Shopping
          </Link>
        </div>
      </div>

      {/* Reassurance strip */}
      <ul className="space-y-2.5 px-2 text-xs text-stone-500">
        <li className="flex items-center gap-2.5">
          <ChefHat className="h-4 w-4 shrink-0 text-stone-400" aria-hidden="true" />
          Every piece is made fresh to order.
        </li>
        <li className="flex items-center gap-2.5">
          <Banknote className="h-4 w-4 shrink-0 text-stone-400" aria-hidden="true" />
          Pay cash on delivery or at pickup.
        </li>
      </ul>
    </aside>
  );
}
