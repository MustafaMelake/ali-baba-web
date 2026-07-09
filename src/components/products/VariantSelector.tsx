"use client";

import { formatMoney } from "@/lib/utils";

/**
 * Single-axis, pill-based variant picker for the PDP.
 *
 * Pure & presentational: it owns no state of its own — the parent holds the one
 * `selectedVariantId` source of truth and passes it down, so the selector can
 * never drift out of sync with the price/Add-to-Cart payload derived from it.
 *
 * Variants are a flat list (one free-text `name` each), not a size×colour matrix,
 * which is exactly what the `ProductVariant` model stores — so this is a single
 * row of choices, not a multi-dimensional grid.
 */

export interface SelectableVariant {
  id: string;
  name: string;
  price: number;
  isAvailable: boolean;
}

export default function VariantSelector({
  variants,
  selectedVariantId,
  onSelect,
}: {
  variants: SelectableVariant[];
  selectedVariantId: string;
  onSelect: (variantId: string) => void;
}) {
  // A lone variant isn't a choice — render nothing rather than a single dead pill.
  if (variants.length <= 1) return null;

  return (
    <div>
      <span className="mb-3 block font-sans text-[10px] font-semibold uppercase tracking-[0.25em] text-stone-400">
        Select Option
      </span>

      <div
        role="radiogroup"
        aria-label="Product options"
        className="flex flex-wrap gap-2.5"
      >
        {variants.map((variant) => {
          const isSelected = variant.id === selectedVariantId;
          const soldOut = !variant.isAvailable;

          return (
            <button
              key={variant.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              // Kept in the DOM (not hidden) when sold out, so the option stays
              // visible/indexable — just non-interactive.
              disabled={soldOut}
              onClick={() => onSelect(variant.id)}
              className={[
                "inline-flex items-baseline gap-2 rounded-full border px-4 py-2.5 transition-colors duration-200",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                soldOut
                  ? "cursor-not-allowed border-stone-200 bg-stone-50"
                  : isSelected
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "cursor-pointer border-stone-200 hover:border-stone-400",
              ].join(" ")}
            >
              {/* Variant name — muted when sold out */}
              <span
                className={[
                  "font-sans text-sm font-medium",
                  soldOut
                    ? "text-stone-400"
                    : isSelected
                      ? "text-primary"
                      : "text-stone-800",
                ].join(" ")}
              >
                {variant.name}
              </span>

              {/* Per-variant price — font-mono tabular-nums keeps digit width fixed
                  so switching options never reflows the pill row. Struck through
                  when sold out. */}
              <span
                className={[
                  "font-mono text-xs tabular-nums",
                  soldOut
                    ? "text-stone-300 line-through"
                    : isSelected
                      ? "text-primary/80"
                      : "text-stone-400",
                ].join(" ")}
              >
                {formatMoney(variant.price)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
