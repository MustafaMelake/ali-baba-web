"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, Percent, Truck, Building2, Globe } from "lucide-react";
import { toast } from "sonner";
import {
  updateVatSettings,
  updateDeliveryFees,
} from "@/lib/actions/store-settings";
import type { PricingSettings } from "@/lib/store-settings";
import { cn } from "@/lib/utils";

const inputClasses =
  "w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-900 outline-none transition-colors placeholder:text-stone-400 focus:border-primary focus:ring-2 focus:ring-primary/20";

export type BranchFeeRow = {
  id: string;
  name: string;
  slug: string;
  deliveryFee: number;
  /** Inactive branches are still editable here (rendered dimmed) so a stale fee
   *  can be fixed before the branch is reactivated. */
  isActive: boolean;
};

/**
 * Admin manager for the dynamic pricing knobs the checkout + `placeOrder` read:
 * the global VAT settings (StoreSettings) and the per-branch delivery fees
 * (Branch.deliveryFee, plus the "Other Areas" default on StoreSettings).
 *
 * Two independent cards, each with its own Save — a VAT tweak never blocks on a
 * half-edited fee table and vice versa. On success we `router.refresh()` so the
 * Server Component page re-reads the (already revalidated) rows instantly.
 */
export default function PricingSettingsManager({
  settings,
  branches,
}: {
  settings: PricingSettings;
  branches: BranchFeeRow[];
}) {
  const router = useRouter();

  // ── VAT card state ─────────────────────────────────────────────────────────
  const [vatEnabled, setVatEnabled] = useState(settings.isVatEnabled);
  // Kept as the input's raw string; validated on save. Fraction → percent.
  const [vatPercent, setVatPercent] = useState(
    String(+(settings.vatRate * 100).toFixed(2)),
  );
  const [vatPending, startVatSave] = useTransition();

  // ── Delivery-fees card state (raw strings keyed by branch id) ──────────────
  const [defaultFee, setDefaultFee] = useState(
    String(settings.defaultDeliveryFee),
  );
  const [fees, setFees] = useState<Record<string, string>>(() =>
    Object.fromEntries(branches.map((b) => [b.id, String(b.deliveryFee)])),
  );
  const [feesPending, startFeesSave] = useTransition();

  function saveVat() {
    const percent = Number(vatPercent);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      toast.error("VAT rate must be between 0 and 100 percent.");
      return;
    }

    startVatSave(async () => {
      const result = await updateVatSettings({
        isVatEnabled: vatEnabled,
        vatRatePercent: percent,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("VAT settings saved");
      router.refresh();
    });
  }

  function saveFees() {
    const parsedDefault = Number(defaultFee);
    if (!Number.isFinite(parsedDefault) || parsedDefault < 0) {
      toast.error("The default delivery fee must be 0 or more.");
      return;
    }

    const branchFees: { branchId: string; fee: number }[] = [];
    for (const branch of branches) {
      const fee = Number(fees[branch.id]);
      if (!Number.isFinite(fee) || fee < 0) {
        toast.error(`"${branch.name}" needs a delivery fee of 0 or more.`);
        return;
      }
      branchFees.push({ branchId: branch.id, fee });
    }

    startFeesSave(async () => {
      const result = await updateDeliveryFees({
        defaultFee: parsedDefault,
        branchFees,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Delivery fees saved");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* ── VAT ─────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-stone-200/70 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3 border-b border-stone-100 pb-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Percent className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-serif text-xl font-medium text-stone-900">
              Taxes (VAT)
            </h2>
            <p className="text-xs text-stone-400">
              Applied to the discounted subtotal at checkout — display and
              billing both read these values live.
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-5">
          <div className="flex items-center justify-between rounded-xl border border-stone-200 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-stone-700">Charge VAT</p>
              <p className="text-xs text-stone-400">
                When off, the VAT line disappears from checkout and no tax is
                added to new orders. Placed orders keep their original totals.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={vatEnabled}
              aria-label="Toggle VAT"
              onClick={() => setVatEnabled((v) => !v)}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                vatEnabled ? "bg-primary" : "bg-stone-300",
              )}
            >
              <span
                className={cn(
                  "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                  vatEnabled ? "translate-x-5" : "translate-x-0.5",
                )}
              />
            </button>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="vat-rate"
              className="text-sm font-medium text-stone-700"
            >
              VAT Rate
            </label>
            <div className="relative max-w-[200px]">
              <input
                id="vat-rate"
                type="number"
                min={0.01}
                max={100}
                step="0.01"
                inputMode="decimal"
                value={vatPercent}
                onChange={(e) => setVatPercent(e.target.value)}
                disabled={!vatEnabled}
                className={cn(inputClasses, "pr-9", !vatEnabled && "opacity-50")}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-stone-400">
                %
              </span>
            </div>
            <p className="text-xs text-stone-400">
              Entered as a percentage (e.g. 14 = 14%). Stored as a fraction and
              validated even while VAT is off.
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end border-t border-stone-100 pt-4">
          <button
            type="button"
            onClick={saveVat}
            disabled={vatPending}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {vatPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                Save VAT Settings
              </>
            )}
          </button>
        </div>
      </section>

      {/* ── Delivery fees ────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-stone-200/70 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3 border-b border-stone-100 pb-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Truck className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-serif text-xl font-medium text-stone-900">
              Delivery Fees
            </h2>
            <p className="text-xs text-stone-400">
              Each branch charges its own flat fee for delivery orders it
              fulfils. Pickup is always free.
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {branches.length === 0 ? (
            <p className="rounded-xl border border-dashed border-stone-200 px-4 py-6 text-center text-sm text-stone-400">
              No branches yet — add one under Branches to set per-area fees.
            </p>
          ) : (
            branches.map((branch) => (
              <div
                key={branch.id}
                className={cn(
                  "flex items-center justify-between gap-4 rounded-xl border border-stone-200 px-4 py-3",
                  // Dim inactive branches so they read as "not currently offered"
                  // while staying fully editable (the input is left interactive).
                  !branch.isActive && "opacity-50",
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Building2 className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-sm font-medium text-stone-900">
                      {branch.name}
                      {!branch.isActive && (
                        <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-500 ring-1 ring-stone-500/20">
                          Inactive
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-stone-400">/{branch.slug}</p>
                  </div>
                </div>
                <div className="relative w-32 shrink-0">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    aria-label={`${branch.name} delivery fee`}
                    value={fees[branch.id] ?? ""}
                    onChange={(e) =>
                      setFees((f) => ({ ...f, [branch.id]: e.target.value }))
                    }
                    className={cn(inputClasses, "pr-12 text-right")}
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-xs text-stone-400">
                    EGP
                  </span>
                </div>
              </div>
            ))
          )}

          {/* "Other Areas" — delivery orders not routed to any branch. */}
          <div className="flex items-center justify-between gap-4 rounded-xl border border-dashed border-stone-300 bg-stone-50/60 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-stone-200 text-stone-500">
                <Globe className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-stone-900">
                  Other Areas (default)
                </p>
                <p className="text-xs text-stone-400">
                  Charged when the customer&apos;s area isn&apos;t served by a branch.
                </p>
              </div>
            </div>
            <div className="relative w-32 shrink-0">
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                aria-label="Default delivery fee for other areas"
                value={defaultFee}
                onChange={(e) => setDefaultFee(e.target.value)}
                className={cn(inputClasses, "pr-12 text-right")}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-xs text-stone-400">
                EGP
              </span>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end border-t border-stone-100 pt-4">
          <button
            type="button"
            onClick={saveFees}
            disabled={feesPending}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {feesPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                Save Delivery Fees
              </>
            )}
          </button>
        </div>
      </section>
    </div>
  );
}
