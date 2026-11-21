import { AlertCircle } from "lucide-react";
import { roundMoney } from "@/lib/discounts";
import { vatLabel, type PricesChangedSummary } from "@/lib/cart-summary";
import { cn, formatMoney } from "@/lib/utils";

/** UI copy — kept out of the markup so an Arabic pass is a table edit, not a rewrite. */
export const PRICES_CHANGED_COPY = {
  title: "Prices changed since you opened checkout",
  body: "We haven’t placed your order. Here is what it costs now:",
  wasTotal: "You saw",
  subtotal: "Subtotal",
  delivery: "Delivery",
  pickup: "Pickup",
  free: "Free",
  total: "New total",
  confirm: (total: string) => `Confirm and place order · ${total} ج.م`,
  confirming: "Placing your order…",
  dismiss: "Review my order",
} as const;

/**
 * The checkout's price-consent step (audit H-3). Shown when placeOrder answers
 * PRICES_CHANGED: nothing was ordered, and these are the SERVER's fresh numbers.
 * Confirm resubmits with `summary.total` as the new expected total — the
 * browser never decides a price, it only agrees to the one the server billed.
 *
 * An inline alert, not a modal: it sits where the CTA was, so focus and the
 * reading flow stay put.
 */
export default function PricesChangedNotice({
  summary,
  previousPrices,
  pickup,
  pending,
  onConfirm,
  onDismiss,
}: {
  summary: PricesChangedSummary;
  /** The unit prices the customer was shown, by variantId — to name what changed. */
  previousPrices: ReadonlyMap<string, number>;
  pickup: boolean;
  pending: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const copy = PRICES_CHANGED_COPY;
  const changedLines = summary.lines.filter((line) => {
    const before = previousPrices.get(line.variantId);
    return before !== undefined && roundMoney(before) !== roundMoney(line.unitPrice);
  });

  const rows: { label: string; value: number; free?: boolean }[] = [
    { label: copy.subtotal, value: summary.subtotal },
    { label: pickup ? copy.pickup : copy.delivery, value: summary.deliveryFee, free: summary.deliveryFee === 0 },
  ];
  if (summary.vat > 0) rows.push({ label: vatLabel(summary.vatRate), value: summary.vat });

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <p className="flex items-start gap-2 font-medium">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {copy.title}
      </p>
      <p className="mt-1 ps-6 text-xs text-amber-800">{copy.body}</p>

      {changedLines.length > 0 && (
        <ul className="mt-3 space-y-1 ps-6 text-xs text-amber-900">
          {changedLines.map((line) => (
            <li key={line.variantId} className="flex justify-between gap-3">
              <span className="text-start">
                {line.productName} — {line.variantName}
              </span>
              <span className="shrink-0 text-end tabular-nums">
                <s className="text-amber-700">{formatMoney(previousPrices.get(line.variantId)!)}</s>{" "}
                {formatMoney(line.unitPrice)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <dl className="mt-3 space-y-1 ps-6 text-xs">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-3">
            <dt className="text-amber-800">{row.label}</dt>
            <dd className="tabular-nums">{row.free ? copy.free : formatMoney(row.value)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-3 border-t border-amber-200 pt-1 font-semibold">
          <dt>{copy.total}</dt>
          <dd className="tabular-nums">
            {formatMoney(summary.total)} <span className="font-normal">ج.م</span>
          </dd>
        </div>
        <div className="flex justify-between gap-3 text-amber-700">
          <dt>{copy.wasTotal}</dt>
          <dd className="tabular-nums">
            <s>{formatMoney(summary.expectedTotal)}</s>
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-col gap-2 ps-6">
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className={cn(
            "rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-stone-800",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          {pending ? copy.confirming : copy.confirm(formatMoney(summary.total))}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={pending}
          className="rounded-full px-5 py-2 text-xs font-semibold text-amber-900 underline-offset-2 hover:underline disabled:opacity-60"
        >
          {copy.dismiss}
        </button>
      </div>
    </div>
  );
}
