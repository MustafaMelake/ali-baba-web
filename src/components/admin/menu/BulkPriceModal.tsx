"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { X, Loader2, Percent, TrendingUp, TrendingDown } from "lucide-react";
import { toast } from "sonner";
import { bulkAdjustCategoryPrices } from "@/lib/actions/menu";

const PRESETS = [-10, -5, 5, 10, 15] as const;

export default function BulkPriceModal({
  categoryId,
  categoryTitle,
  itemCount,
  isOpen,
  onClose,
}: {
  categoryId: string;
  categoryTitle: string;
  itemCount: number;
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    /* eslint-disable react-hooks/set-state-in-effect -- intentional: reset on open */
    setValue("");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isPending) onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [isOpen, isPending, onClose]);

  const percentage = value.trim() === "" ? Number.NaN : Number(value);
  const valid = Number.isFinite(percentage) && percentage !== 0 && percentage > -100;
  const direction = percentage > 0 ? "increase" : "decrease";

  function apply() {
    if (!valid) {
      toast.error("Enter a non-zero percentage above −100%.");
      return;
    }
    startTransition(async () => {
      const result = await bulkAdjustCategoryPrices(categoryId, percentage);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Adjusted ${result.count} item${result.count === 1 ? "" : "s"} by ${
          percentage > 0 ? "+" : ""
        }${percentage}%`,
      );
      onClose();
      router.refresh();
    });
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => !isPending && onClose()}
            className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`Adjust prices for ${categoryTitle}`}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 flex w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-stone-100 px-6 py-4">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Percent className="h-4.5 w-4.5" />
                </span>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
                    Bulk Price Update
                  </p>
                  <h3 className="font-serif text-xl font-medium text-stone-900">
                    {categoryTitle}
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !isPending && onClose()}
                aria-label="Close"
                className="rounded-lg p-1.5 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="space-y-5 px-6 py-5">
              <p className="text-sm text-stone-500">
                Shift the price of{" "}
                <span className="font-medium text-stone-800">
                  all {itemCount} item{itemCount === 1 ? "" : "s"}
                </span>{" "}
                in this category by a percentage. Negative values reduce prices.
              </p>

              {/* Quick presets */}
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => {
                  const active = value !== "" && Number(value) === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setValue(String(p))}
                      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-stone-200 text-stone-600 hover:border-primary/30 hover:bg-primary/5"
                      }`}
                    >
                      {p > 0 ? `+${p}` : p}%
                    </button>
                  );
                })}
              </div>

              {/* Custom input */}
              <div className="space-y-1.5">
                <label htmlFor="bulk-pct" className="text-sm font-medium text-stone-700">
                  Custom percentage
                </label>
                <div className="relative">
                  <input
                    id="bulk-pct"
                    type="number"
                    step="0.5"
                    inputMode="decimal"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="e.g. 15 or -10"
                    className="w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 pr-9 text-sm text-stone-900 outline-none transition-colors placeholder:text-stone-400 focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                  <Percent className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                </div>
              </div>

              {/* Live hint */}
              {valid && (
                <div
                  className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium ${
                    direction === "increase"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {direction === "increase" ? (
                    <TrendingUp className="h-4 w-4" />
                  ) : (
                    <TrendingDown className="h-4 w-4" />
                  )}
                  Prices will {direction} by {Math.abs(percentage)}%.
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 border-t border-stone-100 px-6 py-4">
              <button
                type="button"
                onClick={() => onClose()}
                disabled={isPending}
                className="rounded-full border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                disabled={isPending || !valid || itemCount === 0}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Applying…
                  </>
                ) : (
                  "Apply to all items"
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
