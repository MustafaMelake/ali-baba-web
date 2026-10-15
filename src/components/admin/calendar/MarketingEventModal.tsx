"use client";

import { useEffect, useEffectEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { CalendarPlus, Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { createMarketingEvent, updateMarketingEvent } from "@/lib/actions/marketing-events";
import { fieldErrors, marketingEventSchema, type MarketingEventInput } from "@/lib/validators";
import type { MarketingEventType } from "@/generated/prisma/enums";
import type { DayKey } from "@/lib/marketing-calendar";
import { cn } from "@/lib/utils";
import { EVENT_TYPE_META, EVENT_TYPE_ORDER } from "@/components/admin/calendar/calendar-ui";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const inputClasses =
  "w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-900 outline-none transition-colors placeholder:text-stone-400 focus:border-primary focus:ring-2 focus:ring-primary/20";

/** The form's fields as the inputs hold them (strings — the percent included). */
export interface ReminderDraft {
  title: string;
  type: MarketingEventType;
  startDate: DayKey;
  endDate: DayKey;
  targetDiscountPercent: string;
  strategy: string;
  notes: string;
}

export type ReminderEditor =
  | { mode: "create"; draft: ReminderDraft }
  | { mode: "edit"; id: string; draft: ReminderDraft };

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs font-medium text-red-600">
      {message}
    </p>
  );
}

/**
 * Create / edit a custom reminder. Mounted fresh for every open (the parent
 * keys it), so the form initializes straight from `editor.draft` — no
 * effect-driven priming. The shared schema validates instantly here; the
 * action re-parses the same schema on the server.
 */
export default function MarketingEventModal({
  editor,
  onClose,
}: {
  editor: ReminderEditor;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState<ReminderDraft>(editor.draft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const isEdit = editor.mode === "edit";

  const closeFromKey = useEffectEvent(() => {
    if (!isPending) onClose();
  });

  // Esc to close + lock background scroll (restoring whatever was there).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeFromKey();
    }
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  function update<K extends keyof ReminderDraft>(key: K, value: ReminderDraft[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const percent = form.targetDiscountPercent.trim();
    const payload: MarketingEventInput = {
      title: form.title,
      type: form.type,
      startDate: form.startDate,
      endDate: form.endDate,
      targetDiscountPercent: percent === "" ? null : Number(percent),
      strategy: form.strategy,
      notes: form.notes,
    };

    const check = marketingEventSchema.safeParse(payload);
    if (!check.success) {
      setErrors(fieldErrors(check.error));
      return;
    }

    startTransition(async () => {
      const result = isEdit
        ? await updateMarketingEvent(editor.id, payload)
        : await createMarketingEvent(payload);

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success(isEdit ? "Reminder updated" : "Reminder added to the calendar");
      onClose();
      router.refresh();
    });
  }

  const describedBy = (field: string) => (errors[field] ? `reminder-${field}-error` : undefined);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={() => !isPending && onClose()}
        className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
        aria-hidden="true"
      />

      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "Edit reminder" : "New reminder"}
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        transition={{ duration: 0.22, ease: EASE }}
        className="relative z-10 flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-stone-100 px-6 py-4">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <CalendarPlus className="h-4.5 w-4.5" />
              </span>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
                  {isEdit ? "Edit Reminder" : "New Reminder"}
                </p>
                <h3 className="font-serif text-xl font-medium text-stone-900">
                  {isEdit ? editor.draft.title : "Plan a campaign"}
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
            <div className="space-y-1.5">
              <label htmlFor="reminder-title" className="text-sm font-medium text-stone-700">
                Title
              </label>
              <input
                id="reminder-title"
                value={form.title}
                onChange={(e) => update("title", e.target.value)}
                placeholder="Summer Flash Sale — 20% off"
                maxLength={120}
                autoFocus
                aria-invalid={Boolean(errors.title)}
                aria-describedby={describedBy("title")}
                className={inputClasses}
              />
              <FieldError id="reminder-title-error" message={errors.title} />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="reminder-type" className="text-sm font-medium text-stone-700">
                Type
              </label>
              <select
                id="reminder-type"
                value={form.type}
                onChange={(e) => update("type", e.target.value as MarketingEventType)}
                className={inputClasses}
              >
                {EVENT_TYPE_ORDER.map((type) => (
                  <option key={type} value={type}>
                    {EVENT_TYPE_META[type].label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="reminder-start" className="text-sm font-medium text-stone-700">
                  Start date
                </label>
                <input
                  id="reminder-start"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => update("startDate", e.target.value)}
                  aria-invalid={Boolean(errors.startDate)}
                  aria-describedby={describedBy("startDate")}
                  className={inputClasses}
                />
                <FieldError id="reminder-startDate-error" message={errors.startDate} />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="reminder-end" className="text-sm font-medium text-stone-700">
                  End date
                </label>
                <input
                  id="reminder-end"
                  type="date"
                  value={form.endDate}
                  min={form.startDate || undefined}
                  onChange={(e) => update("endDate", e.target.value)}
                  aria-invalid={Boolean(errors.endDate)}
                  aria-describedby={describedBy("endDate")}
                  className={inputClasses}
                />
                <FieldError id="reminder-endDate-error" message={errors.endDate} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[10rem_1fr]">
              <div className="space-y-1.5">
                <label htmlFor="reminder-discount" className="text-sm font-medium text-stone-700">
                  Target discount
                </label>
                <div className="relative">
                  <input
                    id="reminder-discount"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="100"
                    step="1"
                    value={form.targetDiscountPercent}
                    onChange={(e) => update("targetDiscountPercent", e.target.value)}
                    placeholder="20"
                    aria-invalid={Boolean(errors.targetDiscountPercent)}
                    aria-describedby={describedBy("targetDiscountPercent")}
                    className={cn(inputClasses, "pr-9 tabular-nums")}
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3.5 text-xs font-semibold text-stone-400">
                    %
                  </span>
                </div>
                <FieldError
                  id="reminder-targetDiscountPercent-error"
                  message={errors.targetDiscountPercent}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="reminder-strategy" className="text-sm font-medium text-stone-700">
                  Strategy <span className="font-normal text-stone-400">(optional)</span>
                </label>
                <input
                  id="reminder-strategy"
                  value={form.strategy}
                  onChange={(e) => update("strategy", e.target.value)}
                  placeholder="Pre-order kahk tins + free delivery over 500"
                  maxLength={300}
                  aria-invalid={Boolean(errors.strategy)}
                  aria-describedby={describedBy("strategy")}
                  className={inputClasses}
                />
                <FieldError id="reminder-strategy-error" message={errors.strategy} />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="reminder-notes" className="text-sm font-medium text-stone-700">
                Notes <span className="font-normal text-stone-400">(optional)</span>
              </label>
              <textarea
                id="reminder-notes"
                rows={4}
                value={form.notes}
                onChange={(e) => update("notes", e.target.value)}
                placeholder="Banner assets, branch capacity, who owns what…"
                maxLength={1000}
                aria-invalid={Boolean(errors.notes)}
                aria-describedby={describedBy("notes")}
                className={cn(inputClasses, "resize-y")}
              />
              <FieldError id="reminder-notes-error" message={errors.notes} />
            </div>

            <p className="text-xs text-stone-400">
              A reminder is a plan — it never changes a price. Use “Create promotion” on the
              event to schedule the actual discount.
            </p>
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
                  Saving…
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  {isEdit ? "Save Changes" : "Add Reminder"}
                </>
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
