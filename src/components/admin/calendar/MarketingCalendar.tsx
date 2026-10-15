"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react";
import { MarketingEventType } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";
import {
  CALENDAR_VIEWS,
  maxDay,
  stepAnchor,
  type CalendarEvent,
  type CalendarView,
  type DayKey,
} from "@/lib/marketing-calendar";
import {
  calendarHref,
  EVENT_TYPE_META,
  EVENT_TYPE_ORDER,
  periodLabel,
  VIEW_LABELS,
} from "@/components/admin/calendar/calendar-ui";
import { ListView, MonthView, WeekView } from "@/components/admin/calendar/CalendarViews";
import UpcomingPanel from "@/components/admin/calendar/UpcomingPanel";
import EventDetails from "@/components/admin/calendar/EventDetails";
import MarketingEventModal, {
  type ReminderDraft,
  type ReminderEditor,
} from "@/components/admin/calendar/MarketingEventModal";

/** A custom reminder flattened back into the form's string fields. */
function draftFromEvent(event: CalendarEvent): ReminderDraft {
  return {
    title: event.title,
    type: event.type,
    startDate: event.start,
    endDate: event.end,
    targetDiscountPercent:
      event.targetDiscountPercent == null ? "" : String(event.targetDiscountPercent),
    strategy: event.strategy ?? "",
    notes: event.notes ?? "",
  };
}

/**
 * The interactive calendar island. Everything it shows was computed by the
 * Server Component page for one URL (`?view=&date=`); navigation pushes a new
 * URL inside a transition, so the server re-reads and the grid dims while it
 * does. Selection and the editor are the only client state.
 */
export default function MarketingCalendar({
  view,
  anchor,
  today,
  range,
  events,
  upcoming,
  loadError,
}: {
  view: CalendarView;
  anchor: DayKey;
  today: DayKey;
  range: { start: DayKey; end: DayKey };
  events: CalendarEvent[];
  upcoming: CalendarEvent[];
  loadError: string | null;
}) {
  const router = useRouter();
  const [isNavigating, startNavigation] = useTransition();
  // The view pill moves on click; the grid follows once the server answers.
  const [shownView, setShownView] = useOptimistic(view);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [editor, setEditor] = useState<ReminderEditor | null>(null);

  function go(nextView: CalendarView, date: DayKey) {
    startNavigation(() => {
      setShownView(nextView);
      router.push(calendarHref(nextView, date), { scroll: false });
    });
  }

  function openCreate(draft: Partial<ReminderDraft> = {}) {
    const day = maxDay(today, anchor);
    setSelected(null);
    setEditor({
      mode: "create",
      draft: {
        title: "",
        type: MarketingEventType.CAMPAIGN,
        startDate: day,
        endDate: day,
        targetDiscountPercent: "",
        strategy: "",
        notes: "",
        ...draft,
      },
    });
  }

  function openEdit(event: CalendarEvent) {
    setSelected(null);
    setEditor({ mode: "edit", id: event.id, draft: draftFromEvent(event) });
  }

  /** Turn a built-in occasion into a campaign reminder of the shop's own. */
  function planCampaign(event: CalendarEvent) {
    openCreate({
      title: `${event.title} ${event.start.slice(0, 4)} campaign`,
      startDate: event.start,
      endDate: event.end,
      notes: event.prepTip ?? "",
    });
  }

  const viewProps = {
    range,
    today,
    events,
    onSelectEvent: setSelected,
    onCreateOn: (day: DayKey) => openCreate({ startDate: day, endDate: day }),
  };
  const unit = view === "week" ? "week" : "month";

  return (
    <div className="space-y-6">
      {loadError && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{loadError}</p>
        </div>
      )}

      <UpcomingPanel events={upcoming} today={today} onSelect={setSelected} onPlan={planCampaign} />

      <section
        aria-label="Marketing calendar"
        className="overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm"
      >
        {/* Toolbar */}
        <div className="flex flex-col gap-4 border-b border-stone-100 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => go(view, stepAnchor(view, anchor, -1))}
                aria-label={`Previous ${unit}`}
                className="flex h-9 w-9 items-center justify-center rounded-full text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
              >
                <ChevronLeft className="h-4.5 w-4.5" />
              </button>
              <button
                type="button"
                onClick={() => go(view, stepAnchor(view, anchor, 1))}
                aria-label={`Next ${unit}`}
                className="flex h-9 w-9 items-center justify-center rounded-full text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
              >
                <ChevronRight className="h-4.5 w-4.5" />
              </button>
            </div>
            <h2 className="font-serif text-2xl font-medium tracking-tight text-stone-900" aria-live="polite">
              {periodLabel(view, range, anchor)}
            </h2>
            {isNavigating && (
              <Loader2 className="h-4 w-4 animate-spin text-stone-400" aria-label="Loading" />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => go(view, today)}
              className="rounded-full border border-stone-200 px-3.5 py-1.5 text-xs font-semibold text-stone-600 transition-colors hover:bg-stone-50"
            >
              Today
            </button>

            <div className="inline-flex rounded-full bg-stone-100 p-1" role="group" aria-label="Calendar view">
              {CALENDAR_VIEWS.map((option) => {
                const active = option === shownView;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => option !== view && go(option, anchor)}
                    aria-pressed={active}
                    className={cn(
                      "relative rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
                      active ? "text-stone-900" : "text-stone-500 hover:text-stone-800",
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="calendar-view-pill"
                        className="absolute inset-0 rounded-full bg-white shadow-sm"
                        transition={{ type: "spring", stiffness: 500, damping: 40 }}
                      />
                    )}
                    <span className="relative">{VIEW_LABELS[option]}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => openCreate()}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              New reminder
            </button>
          </div>
        </div>

        {/* Legend */}
        <ul className="flex flex-wrap gap-x-5 gap-y-1.5 border-b border-stone-100 px-4 py-2.5 sm:px-6">
          {EVENT_TYPE_ORDER.map((type) => (
            <li key={type} className="flex items-center gap-1.5 text-xs text-stone-500">
              <span className={cn("h-2 w-2 rounded-full", EVENT_TYPE_META[type].dot)} aria-hidden="true" />
              {EVENT_TYPE_META[type].label}
            </li>
          ))}
        </ul>

        <div
          aria-busy={isNavigating}
          className={cn("transition-opacity duration-200", isNavigating && "opacity-50")}
        >
          {view === "month" ? (
            <MonthView
              key={anchor.slice(0, 7)}
              {...viewProps}
              anchor={anchor}
              onShowWeek={(day) => go("week", day)}
            />
          ) : view === "week" ? (
            <WeekView {...viewProps} />
          ) : (
            <ListView {...viewProps} />
          )}
        </div>
      </section>

      <AnimatePresence>
        {selected && (
          <EventDetails
            key={selected.id}
            event={selected}
            today={today}
            onClose={() => setSelected(null)}
            onEdit={openEdit}
            onPlan={planCampaign}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editor && (
          <MarketingEventModal
            key={editor.mode === "edit" ? editor.id : "create"}
            editor={editor}
            onClose={() => setEditor(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
