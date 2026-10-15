"use client";

import Link from "next/link";
import { BadgePercent, BellRing, Sparkles } from "lucide-react";
import Pill from "@/components/admin/Pill";
import { cn } from "@/lib/utils";
import {
  PREP_URGENT_DAYS,
  PREP_WINDOW_DAYS,
  prepStatus,
  type CalendarEvent,
  type DayKey,
} from "@/lib/marketing-calendar";
import {
  countdownLabel,
  EVENT_TYPE_META,
  formatRange,
  promotionDraftHref,
} from "@/components/admin/calendar/calendar-ui";

/**
 * The executive heads-up: everything running now or starting within the prep
 * window, soonest first — urgent ones (≤ PREP_URGENT_DAYS) tinted amber —
 * each with a pre-filled "Create promotion" hand-off.
 */
export default function UpcomingPanel({
  events,
  today,
  onSelect,
  onPlan,
}: {
  /** Already filtered to the prep window and ordered on the server. */
  events: CalendarEvent[];
  today: DayKey;
  onSelect: (event: CalendarEvent) => void;
  onPlan: (event: CalendarEvent) => void;
}) {
  const items = events.flatMap((event) => {
    const status = prepStatus(event, today);
    return status ? [{ event, status }] : [];
  });
  const urgentCount = items.filter(
    ({ status }) => status.kind === "upcoming" && status.urgent,
  ).length;

  return (
    <section
      aria-labelledby="campaign-prep-heading"
      className="rounded-2xl border border-stone-200/70 bg-white p-5 shadow-sm md:p-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-primary">
            <BellRing className="h-3.5 w-3.5" aria-hidden="true" />
            Campaign prep
          </p>
          <h2
            id="campaign-prep-heading"
            className="mt-2 font-serif text-2xl font-medium tracking-tight text-stone-900"
          >
            The next {PREP_WINDOW_DAYS} days
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            Line up promotions, stock and banner assets before each rush.
          </p>
        </div>
        {urgentCount > 0 && (
          <Pill className="bg-amber-50 text-amber-700 ring-amber-600/20">
            {urgentCount} within {PREP_URGENT_DAYS} days
          </Pill>
        )}
      </div>

      {items.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-stone-200 px-4 py-6 text-center text-sm text-stone-400">
          Nothing on the horizon for the next {PREP_WINDOW_DAYS} days — a good time to plan ahead.
        </p>
      ) : (
        <ul className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map(({ event, status }) => {
            const meta = EVENT_TYPE_META[event.type];
            const urgent = status.kind === "upcoming" && status.urgent;
            const running = status.kind === "running";
            const promotionHref = promotionDraftHref(event, today);
            const detail = event.strategy ?? event.prepTip ?? event.notes;

            return (
              <li
                key={event.id}
                className={cn(
                  "flex flex-col rounded-xl border p-4",
                  urgent
                    ? "border-amber-200 bg-amber-50/40"
                    : running
                      ? "border-primary/25 bg-primary/5"
                      : "border-stone-200",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <Pill className={meta.pill}>{meta.label}</Pill>
                  <span
                    className={cn(
                      "text-right text-xs font-semibold tabular-nums",
                      urgent ? "text-amber-700" : running ? "text-primary" : "text-stone-500",
                    )}
                  >
                    {countdownLabel(status)}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => onSelect(event)}
                  className="mt-3 text-left font-serif text-lg font-medium leading-snug text-stone-900 transition-colors hover:text-primary"
                >
                  {event.title}
                </button>
                {event.titleAr && (
                  <p className="text-sm text-stone-400">
                    <span dir="rtl" lang="ar">
                      {event.titleAr}
                    </span>
                  </p>
                )}
                <p className="mt-1 text-xs tabular-nums text-stone-500">
                  {formatRange(event.start, event.end)}
                  {event.estimated && " · estimated"}
                </p>
                {detail && (
                  <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-stone-500">{detail}</p>
                )}

                <div className="mt-auto flex flex-wrap gap-2 pt-4">
                  {promotionHref && (
                    <Link
                      href={promotionHref}
                      className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
                    >
                      <BadgePercent className="h-3.5 w-3.5" />
                      Create promotion
                    </Link>
                  )}
                  {event.source === "builtin" && (
                    <button
                      type="button"
                      onClick={() => onPlan(event)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-600 transition-colors hover:border-primary/40 hover:text-primary"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Plan campaign
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
