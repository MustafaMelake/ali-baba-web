"use client";

import { useEffect, useEffectEvent, useState, useTransition } from "react";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { BadgePercent, Check, Loader2, Pencil, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import Pill from "@/components/admin/Pill";
import { MarketingEventType } from "@/generated/prisma/enums";
import { deleteMarketingEvent } from "@/lib/actions/marketing-events";
import { prepStatus, type CalendarEvent, type DayKey } from "@/lib/marketing-calendar";
import {
  countdownLabel,
  EVENT_TYPE_META,
  formatRange,
  promotionDraftHref,
} from "@/components/admin/calendar/calendar-ui";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-400">{label}</p>
      <div className="mt-1 text-sm leading-relaxed text-stone-700">{children}</div>
    </div>
  );
}

/**
 * Read-only view of one calendar entry with its next actions: a pre-filled
 * promotion for anything not yet over, "Plan a campaign" for a built-in
 * occasion, Edit / Delete (confirm-in-place) for a custom reminder.
 */
export default function EventDetails({
  event,
  today,
  onClose,
  onEdit,
  onPlan,
}: {
  event: CalendarEvent;
  today: DayKey;
  onClose: () => void;
  onEdit: (event: CalendarEvent) => void;
  onPlan: (event: CalendarEvent) => void;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isDeleting, startDeleting] = useTransition();
  // Focus moves in on open, Tab stays inside, and returns to the opener on close.
  const dialogRef = useDialogFocus<HTMLDivElement>(true);

  const meta = EVENT_TYPE_META[event.type];
  const status = prepStatus(event, today);
  const promotionHref = promotionDraftHref(event, today);
  const isCustom = event.source === "custom";

  const closeFromKey = useEffectEvent(() => {
    if (!isDeleting) onClose();
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

  function handleDelete() {
    startDeleting(async () => {
      const result = await deleteMarketingEvent(event.id);
      if (!result.success) {
        toast.error(result.error);
        setConfirming(false);
        return;
      }
      toast.success(`"${event.title}" deleted`);
      onClose();
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={() => !isDeleting && onClose()}
        className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
        aria-hidden="true"
      />

      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-event-title"
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        transition={{ duration: 0.22, ease: EASE }}
        className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="border-b border-stone-100 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Pill className={meta.pill}>{meta.label}</Pill>
              {event.estimated && (
                <Pill className="bg-stone-100 text-stone-500 ring-stone-500/15">Estimated date</Pill>
              )}
            </div>
            <button
              type="button"
              onClick={() => !isDeleting && onClose()}
              aria-label="Close"
              className="-mr-1.5 -mt-1 rounded-lg p-1.5 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <h2
            id="calendar-event-title"
            className="mt-3 font-serif text-2xl font-medium tracking-tight text-stone-900"
          >
            {event.title}
          </h2>
          {event.titleAr && (
            <p className="mt-0.5 text-base text-stone-400">
              <span dir="rtl" lang="ar">
                {event.titleAr}
              </span>
            </p>
          )}
          <p className="mt-2 text-sm tabular-nums text-stone-500">
            {formatRange(event.start, event.end)}
            {status && (
              <span
                className={
                  status.kind === "upcoming" && status.urgent
                    ? "font-semibold text-amber-700"
                    : "font-semibold text-stone-600"
                }
              >
                {" · "}
                {countdownLabel(status)}
              </span>
            )}
          </p>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {event.prepTip && <Detail label="How to prepare">{event.prepTip}</Detail>}
          {event.strategy && <Detail label="Strategy">{event.strategy}</Detail>}
          {event.targetDiscountPercent != null && (
            <Detail label="Target discount">
              <span className="font-semibold tabular-nums text-stone-900">
                {event.targetDiscountPercent}%
              </span>{" "}
              <span className="text-stone-400">— a plan, not a live discount</span>
            </Detail>
          )}
          {event.notes && (
            <Detail label="Notes">
              <p className="whitespace-pre-line">{event.notes}</p>
            </Detail>
          )}
          {isCustom && !event.strategy && !event.notes && event.targetDiscountPercent == null && (
            <p className="text-sm text-stone-400">No plan written down yet — edit to add one.</p>
          )}
          {event.estimated && (
            <p className="rounded-xl bg-stone-50 px-4 py-3 text-xs leading-relaxed text-stone-500">
              {event.type === MarketingEventType.RELIGIOUS_HOLIDAY
                ? "Calculated from the Umm al-Qura calendar. Egypt confirms the day by moon sighting, so it can shift by a day — confirm before fixing delivery dates."
                : "The exact date is announced each year — confirm it before fixing dates."}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 px-6 py-4">
          <div>
            {isCustom && (
              <AnimatePresence mode="wait" initial={false}>
                {confirming ? (
                  <motion.div
                    key="confirm"
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: "auto" }}
                    exit={{ opacity: 0, width: 0 }}
                    transition={{ duration: 0.18 }}
                    className="inline-flex items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700"
                  >
                    <span>Delete?</span>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={isDeleting}
                      aria-label={`Confirm delete ${event.title}`}
                      className="flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-white transition-colors hover:bg-red-700 disabled:opacity-60"
                    >
                      {isDeleting ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Check className="h-3 w-3" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(false)}
                      disabled={isDeleting}
                      aria-label="Cancel delete"
                      className="flex h-5 w-5 items-center justify-center rounded-full text-red-700 transition-colors hover:bg-red-100 disabled:opacity-60"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </motion.div>
                ) : (
                  <motion.button
                    key="trigger"
                    type="button"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    onClick={() => setConfirming(true)}
                    aria-label={`Delete ${event.title}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </motion.button>
                )}
              </AnimatePresence>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isCustom ? (
              <button
                type="button"
                onClick={() => onEdit(event)}
                disabled={isDeleting}
                className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-60"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onPlan(event)}
                className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Plan a campaign
              </button>
            )}
            {promotionHref && (
              <Link
                href={promotionHref}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
              >
                <BadgePercent className="h-4 w-4" />
                Create promotion
              </Link>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
