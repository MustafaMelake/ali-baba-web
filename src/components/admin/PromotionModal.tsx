"use client";

import { useEffect, useState, useTransition } from "react";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { X, Loader2, Check, BadgePercent } from "lucide-react";
import { toast } from "sonner";
import { createPromotion, updatePromotion } from "@/lib/actions/promotions";
import { DiscountType } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";
import { storeDayKey, storeDayParts } from "@/lib/timezone";
import MultiSelect, { type MultiSelectOption } from "@/components/admin/MultiSelect";

const inputClasses =
  "w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-900 outline-none transition-colors placeholder:text-stone-400 focus:border-primary focus:ring-2 focus:ring-primary/20";

const TYPE_OPTIONS = [
  { value: DiscountType.PERCENTAGE, label: "Percentage (%)" },
  { value: DiscountType.FIXED_AMOUNT, label: "Fixed amount (EGP)" },
] as const;

/** The option lists that feed the target picker (built on the server). */
export type PromotionFormOptions = {
  categories: MultiSelectOption[];
  /** `isActive: false` → the picker warns it prices nothing until published. */
  collections: (MultiSelectOption & { isActive: boolean })[];
  products: MultiSelectOption[];
  variants: MultiSelectOption[];
};

/** The four target levels, in picker order. */
const TARGET_TABS = [
  { key: "categories", label: "Category" },
  { key: "collections", label: "Collection" },
  { key: "products", label: "Product" },
  { key: "variants", label: "Variant" },
] as const;
type TargetTab = (typeof TARGET_TABS)[number]["key"];

/** A promotion flattened for the form (ISO date strings + id arrays). */
export type EditablePromotion = {
  id: string;
  name: string;
  type: string;
  value: number;
  startDate: string;
  endDate: string;
  isActive: boolean;
  categoryIds: string[];
  productIds: string[];
  variantIds: string[];
  collectionIds: string[];
};

/**
 * Pre-filled values for a NEW promotion — e.g. the marketing calendar's
 * "Create promotion" hand-off. Dates are "yyyy-mm-dd"; `value` is a percent.
 */
export type PromotionDraft = {
  name?: string;
  value?: number;
  startDate?: string;
  endDate?: string;
};

/**
 * Render a Date / ISO string as the "yyyy-mm-dd" a date input expects — the
 * CAIRO calendar day, never the browser's: the server reads the field back as
 * Cairo day edges (storeDateStart / storeDateEnd), so a browser in another zone
 * would otherwise show (and re-save) the neighbouring day.
 */
function toDateInputValue(value: string | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return storeDayKey(d);
}

/** Cairo today + `days` (calendar arithmetic, DST-proof), for a date input. */
function dateInputFromNow(days: number): string {
  const { year, month, day } = storeDayParts(new Date());
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * One controlled modal for BOTH create and edit. Pass a `promotion` to edit it;
 * omit it to create. On success it closes and calls `router.refresh()` so the
 * Server Component table re-reads the (already revalidated) data.
 */
export default function PromotionModal({
  promotion,
  draft,
  options,
  isOpen,
  onClose,
}: {
  promotion?: EditablePromotion;
  /** Create-mode defaults; ignored when editing. */
  draft?: PromotionDraft;
  options: PromotionFormOptions;
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Focus moves in on open, Tab stays inside, and returns to the opener on close.
  const dialogRef = useDialogFocus<HTMLDivElement>(isOpen);
  const isEdit = Boolean(promotion);

  const [name, setName] = useState("");
  const [type, setType] = useState<string>(DiscountType.PERCENTAGE);
  const [value, setValue] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [collectionIds, setCollectionIds] = useState<string[]>([]);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [variantIds, setVariantIds] = useState<string[]>([]);
  const [targetTab, setTargetTab] = useState<TargetTab>("categories");

  // The four target levels behind the one picker.
  const targets: Record<
    TargetTab,
    { options: MultiSelectOption[]; selected: string[]; set: (ids: string[]) => void; noun: string; kind: string }
  > = {
    categories: { options: options.categories, selected: categoryIds, set: setCategoryIds, noun: "categories", kind: "Category" },
    collections: { options: options.collections, selected: collectionIds, set: setCollectionIds, noun: "collections", kind: "Collection" },
    products: { options: options.products, selected: productIds, set: setProductIds, noun: "products", kind: "Product" },
    variants: { options: options.variants, selected: variantIds, set: setVariantIds, noun: "variants", kind: "Variant" },
  };
  const inactiveCollections = new Set(options.collections.filter((c) => !c.isActive).map((c) => c.value));
  const selectedTargets = TARGET_TABS.flatMap(({ key }) =>
    targets[key].selected.map((id) => ({
      tab: key,
      id,
      kind: targets[key].kind,
      label: targets[key].options.find((o) => o.value === id)?.label ?? id,
      inactive: key === "collections" && inactiveCollections.has(id),
    })),
  );

  // Sync the form to the row (or sensible defaults) each time the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    /* eslint-disable react-hooks/set-state-in-effect -- intentional: prime the form on open */
    setName(promotion?.name ?? draft?.name ?? "");
    setType(promotion?.type ?? DiscountType.PERCENTAGE);
    setValue(promotion ? String(promotion.value) : draft?.value != null ? String(draft.value) : "");
    setStartDate(
      toDateInputValue(promotion?.startDate) || draft?.startDate || dateInputFromNow(0),
    );
    setEndDate(toDateInputValue(promotion?.endDate) || draft?.endDate || dateInputFromNow(30));
    setIsActive(promotion?.isActive ?? true);
    setCategoryIds(promotion?.categoryIds ?? []);
    setCollectionIds(promotion?.collectionIds ?? []);
    setProductIds(promotion?.productIds ?? []);
    setVariantIds(promotion?.variantIds ?? []);
    setTargetTab("categories");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [isOpen, promotion, draft]);

  // Esc to close + lock background scroll while open.
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      name: name.trim(),
      type,
      value: Number(value),
      startDate,
      endDate,
      isActive,
      categoryIds,
      productIds,
      variantIds,
      collectionIds,
    };

    startTransition(async () => {
      const result = isEdit
        ? await updatePromotion(promotion!.id, payload)
        : await createPromotion(payload);

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success(isEdit ? "Promotion updated" : "Promotion created");
      onClose();
      router.refresh();
    });
  }

  const valueSuffix = type === DiscountType.PERCENTAGE ? "%" : "EGP";

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
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={isEdit ? "Edit promotion" : "Create promotion"}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-stone-100 px-6 py-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <BadgePercent className="h-4.5 w-4.5" />
                  </span>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
                      {isEdit ? "Edit Promotion" : "New Promotion"}
                    </p>
                    <h3 className="font-serif text-xl font-medium text-stone-900">
                      {isEdit ? promotion!.name : "Create a promotion"}
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
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
                {/* Name */}
                <div className="space-y-1.5">
                  <label htmlFor="promo-name" className="text-sm font-medium text-stone-700">
                    Name
                  </label>
                  <input
                    id="promo-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Eid Weekend — 15% off"
                    className={inputClasses}
                    autoFocus
                  />
                </div>

                {/* Type + Value */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label htmlFor="promo-type" className="text-sm font-medium text-stone-700">
                      Discount type
                    </label>
                    <select
                      id="promo-type"
                      value={type}
                      onChange={(e) => setType(e.target.value)}
                      className={inputClasses}
                    >
                      {TYPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="promo-value" className="text-sm font-medium text-stone-700">
                      Value
                    </label>
                    <div className="relative">
                      <input
                        id="promo-value"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        inputMode="decimal"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder={type === DiscountType.PERCENTAGE ? "15" : "50"}
                        className={cn(inputClasses, "pr-14")}
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3.5 text-xs font-semibold text-stone-400">
                        {valueSuffix}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Dates */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label htmlFor="promo-start" className="text-sm font-medium text-stone-700">
                      Start date
                    </label>
                    <input
                      id="promo-start"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className={inputClasses}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="promo-end" className="text-sm font-medium text-stone-700">
                      End date
                    </label>
                    <input
                      id="promo-end"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      min={startDate || undefined}
                      className={inputClasses}
                    />
                  </div>
                </div>

                {/* Active toggle */}
                <div className="flex items-center justify-between rounded-xl border border-stone-200 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-stone-700">Active</p>
                    <p className="text-xs text-stone-400">
                      Inactive promotions never apply, even inside their date window.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isActive}
                    aria-label="Toggle active"
                    onClick={() => setIsActive((v) => !v)}
                    className={cn(
                      "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                      isActive ? "bg-primary" : "bg-stone-300",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                        isActive ? "translate-x-5" : "translate-x-0.5",
                      )}
                    />
                  </button>
                </div>

                {/* Targets — one picker, four tabs, one summary */}
                <div className="space-y-4 rounded-xl border border-stone-200 bg-stone-50/40 px-4 py-4 text-start">
                  <div>
                    <p className="text-sm font-semibold text-stone-700">Apply to</p>
                    <p className="text-xs text-stone-400">
                      Any mix of categories, collections, products and variants. A
                      product reached more than one way still gets ONE discount —
                      the cheapest result wins.
                    </p>
                  </div>

                  <div role="tablist" aria-label="Target type" className="inline-flex flex-wrap gap-1 rounded-full bg-stone-100 p-1">
                    {TARGET_TABS.map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        role="tab"
                        aria-selected={targetTab === tab.key}
                        onClick={() => setTargetTab(tab.key)}
                        className={cn(
                          "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
                          targetTab === tab.key ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800",
                        )}
                      >
                        {tab.label}
                        {targets[tab.key].selected.length > 0 && (
                          <span className="ms-1.5 tabular-nums text-primary">{targets[tab.key].selected.length}</span>
                        )}
                      </button>
                    ))}
                  </div>

                  <div role="tabpanel">
                    <MultiSelect
                      key={targetTab}
                      options={targets[targetTab].options}
                      selected={targets[targetTab].selected}
                      onChange={targets[targetTab].set}
                      placeholder={`No ${targets[targetTab].noun} selected`}
                      searchPlaceholder={`Search ${targets[targetTab].noun}…`}
                      emptyText={`No ${targets[targetTab].noun} yet.`}
                    />
                  </div>

                  {/* Summary of everything selected, across all four tabs */}
                  {selectedTargets.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-stone-400">Selected</p>
                      <ul className="flex flex-wrap gap-1.5">
                        {selectedTargets.map((t) => (
                          <li
                            key={`${t.tab}-${t.id}`}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1 ring-inset",
                              t.inactive
                                ? "bg-amber-50 text-amber-800 ring-amber-600/20"
                                : "bg-white text-stone-700 ring-stone-200",
                            )}
                          >
                            <span className="text-stone-400">{t.kind}</span>
                            {t.label}
                            {t.inactive && <span className="font-semibold">· inactive — prices nothing until published</span>}
                            <button
                              type="button"
                              onClick={() => targets[t.tab].set(targets[t.tab].selected.filter((id) => id !== t.id))}
                              aria-label={`Remove ${t.kind} ${t.label}`}
                              className="text-stone-400 transition-colors hover:text-stone-700"
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
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
                  type="submit"
                  disabled={isPending}
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {isEdit ? "Saving…" : "Creating…"}
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      {isEdit ? "Save Changes" : "Create Promotion"}
                    </>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
