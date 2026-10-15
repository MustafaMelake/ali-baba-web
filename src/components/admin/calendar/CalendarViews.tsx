"use client";

import { useState } from "react";
import { CalendarDays, Plus } from "lucide-react";
import Pill from "@/components/admin/Pill";
import EmptyState from "@/components/admin/EmptyState";
import { cn } from "@/lib/utils";
import {
  addDays,
  dayOfWeek,
  daysBetween,
  maxDay,
  prepStatus,
  type CalendarEvent,
  type DayKey,
} from "@/lib/marketing-calendar";
import {
  countdownLabel,
  dayNumber,
  EVENT_TYPE_META,
  formatDayLong,
  formatRange,
  monthName,
  WEEKDAY_HEADERS,
  weekdayShort,
} from "@/components/admin/calendar/calendar-ui";

interface ViewProps {
  range: { start: DayKey; end: DayKey };
  today: DayKey;
  /** Already ordered by compareEvents on the server. */
  events: CalendarEvent[];
  onSelectEvent: (event: CalendarEvent) => void;
  onCreateOn: (day: DayKey) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function daysIn(range: { start: DayKey; end: DayKey }): DayKey[] {
  const count = daysBetween(range.start, range.end) + 1;
  return Array.from({ length: count }, (_, i) => addDays(range.start, i));
}

function eventsOn(events: CalendarEvent[], day: DayKey): CalendarEvent[] {
  return events.filter((event) => event.start <= day && event.end >= day);
}

/** Friday and Saturday — the Egyptian weekend. */
function isWeekend(day: DayKey): boolean {
  const dow = dayOfWeek(day);
  return dow === 5 || dow === 6;
}

function eventLabel(event: CalendarEvent): string {
  return `${event.title} — ${EVENT_TYPE_META[event.type].label}, ${formatRange(event.start, event.end)}`;
}

/** Events grouped under the month they first appear in within the range. */
function groupByMonth(events: CalendarEvent[], rangeStart: DayKey) {
  const groups: Array<{ month: DayKey; events: CalendarEvent[] }> = [];
  for (const event of events) {
    const month = `${maxDay(event.start, rangeStart).slice(0, 7)}-01`;
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.events.push(event);
    else groups.push({ month, events: [event] });
  }
  return groups;
}

// ── Building blocks ──────────────────────────────────────────────────────────

function EventChip({ event, onClick }: { event: CalendarEvent; onClick: () => void }) {
  const meta = EVENT_TYPE_META[event.type];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={eventLabel(event)}
      title={event.title}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-[11px] font-medium transition-colors",
        meta.chip,
      )}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", meta.dot)} aria-hidden="true" />
      <span className="truncate">{event.title}</span>
    </button>
  );
}

/** One event as a full row — the list view and the month view's day agenda. */
function EventRow({
  event,
  today,
  onSelect,
  showDate = true,
}: {
  event: CalendarEvent;
  today: DayKey;
  onSelect: () => void;
  showDate?: boolean;
}) {
  const meta = EVENT_TYPE_META[event.type];
  const status = prepStatus(event, today);
  const detail = event.strategy ?? event.notes ?? event.prepTip;

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="group flex w-full items-start gap-4 rounded-xl px-3 py-3 text-left transition-colors hover:bg-stone-50"
      >
        {showDate ? (
          <span className="w-12 shrink-0 text-center">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.15em] text-stone-400">
              {weekdayShort(event.start)}
            </span>
            <span className="block font-serif text-2xl font-medium tabular-nums text-stone-900">
              {dayNumber(event.start)}
            </span>
          </span>
        ) : (
          <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", meta.dot)} aria-hidden="true" />
        )}

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-stone-900 transition-colors group-hover:text-primary">
              {event.title}
            </span>
            <Pill className={meta.pill}>{meta.label}</Pill>
            {event.estimated && (
              <span className="text-[11px] font-medium text-stone-400">Estimated</span>
            )}
          </span>
          {event.titleAr && (
            <span className="mt-0.5 block text-sm text-stone-400">
              <span dir="rtl" lang="ar">
                {event.titleAr}
              </span>
            </span>
          )}
          <span className="mt-1 block text-xs tabular-nums text-stone-500">
            {formatRange(event.start, event.end)}
            {status && (
              <span
                className={cn(
                  "font-semibold",
                  status.kind === "upcoming" && status.urgent ? "text-amber-700" : "text-stone-600",
                )}
              >
                {" · "}
                {countdownLabel(status)}
              </span>
            )}
          </span>
          {detail && (
            <span className="mt-1 line-clamp-1 block text-xs text-stone-400">{detail}</span>
          )}
        </span>
      </button>
    </li>
  );
}

function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-600 transition-colors hover:border-primary/40 hover:text-primary"
    >
      <Plus className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

// ── Month ────────────────────────────────────────────────────────────────────

export function MonthView({
  range,
  anchor,
  today,
  events,
  onSelectEvent,
  onCreateOn,
  onShowWeek,
}: ViewProps & { anchor: DayKey; onShowWeek: (day: DayKey) => void }) {
  const month = anchor.slice(0, 7);
  // Remounted per month (keyed by the parent), so this starts fresh each time.
  const [selectedDay, setSelectedDay] = useState<DayKey | null>(
    today.startsWith(month) ? today : null,
  );
  const days = daysIn(range);
  const selectedEvents = selectedDay ? eventsOn(events, selectedDay) : [];

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-stone-100 bg-stone-50/70">
        {WEEKDAY_HEADERS.map((weekday) => (
          <div
            key={weekday.short}
            className="px-2 py-2.5 text-center text-[11px] font-semibold uppercase tracking-[0.15em] text-stone-400"
          >
            <abbr title={weekday.long} className="no-underline">
              {weekday.short}
            </abbr>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day) => {
          const dayEvents = eventsOn(events, day);
          const inMonth = day.startsWith(month);
          const isToday = day === today;
          const isSelected = day === selectedDay;

          return (
            <div
              key={day}
              className={cn(
                "min-h-[4.5rem] border-b border-r border-stone-100 p-1.5 sm:min-h-[7.5rem]",
                !inMonth && "bg-stone-50/70",
                inMonth && isWeekend(day) && "bg-stone-50/40",
                isSelected && "bg-primary/5",
              )}
            >
              <button
                type="button"
                onClick={() => setSelectedDay(isSelected ? null : day)}
                aria-pressed={isSelected}
                aria-label={`${formatDayLong(day)}${
                  dayEvents.length ? `, ${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}` : ""
                }`}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold tabular-nums transition-colors",
                  isToday
                    ? "bg-primary text-white"
                    : isSelected
                      ? "bg-primary/15 text-primary"
                      : inMonth
                        ? "text-stone-700 hover:bg-stone-100"
                        : "text-stone-300 hover:bg-stone-100",
                )}
              >
                {dayNumber(day)}
              </button>

              {/* Desktop: labelled chips. */}
              <div className="mt-1 hidden flex-col gap-1 sm:flex">
                {dayEvents.slice(0, 3).map((event) => (
                  <EventChip key={event.id} event={event} onClick={() => onSelectEvent(event)} />
                ))}
                {dayEvents.length > 3 && (
                  <button
                    type="button"
                    onClick={() => onShowWeek(day)}
                    className="px-1.5 text-left text-[11px] font-medium text-stone-500 transition-colors hover:text-primary"
                  >
                    +{dayEvents.length - 3} more
                  </button>
                )}
              </div>

              {/* Phone: dots — tap the day for its agenda below. */}
              {dayEvents.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1 px-1 sm:hidden" aria-hidden="true">
                  {dayEvents.slice(0, 4).map((event) => (
                    <span
                      key={event.id}
                      className={cn("h-1.5 w-1.5 rounded-full", EVENT_TYPE_META[event.type].dot)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selectedDay && (
        <div className="px-3 py-4 sm:px-5" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-3 px-3">
            <p className="font-serif text-xl font-medium text-stone-900">{formatDayLong(selectedDay)}</p>
            <AddButton onClick={() => onCreateOn(selectedDay)} label="Add reminder" />
          </div>
          {selectedEvents.length === 0 ? (
            <p className="px-3 pt-3 text-sm text-stone-400">Nothing scheduled on this day.</p>
          ) : (
            <ul className="mt-2">
              {selectedEvents.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  today={today}
                  showDate={false}
                  onSelect={() => onSelectEvent(event)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ── Week ─────────────────────────────────────────────────────────────────────

export function WeekView({ range, today, events, onSelectEvent, onCreateOn }: ViewProps) {
  return (
    <div className="grid grid-cols-1 divide-y divide-stone-100 sm:grid-cols-7 sm:divide-x sm:divide-y-0">
      {daysIn(range).map((day, i) => {
        const dayEvents = eventsOn(events, day);
        const isToday = day === today;

        return (
          <section
            key={day}
            aria-label={formatDayLong(day)}
            className={cn("flex flex-col p-3 sm:min-h-[24rem]", isWeekend(day) && "bg-stone-50/40")}
          >
            <header className="flex items-baseline gap-2 sm:block">
              <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-stone-400">
                {WEEKDAY_HEADERS[i].short}
              </p>
              <p
                className={cn(
                  "font-serif text-2xl font-medium tabular-nums sm:mt-0.5",
                  isToday ? "text-primary" : "text-stone-900",
                )}
              >
                {dayNumber(day)}
              </p>
            </header>

            <div className="mt-2 flex flex-1 flex-col gap-1.5">
              {dayEvents.map((event) => {
                const meta = EVENT_TYPE_META[event.type];
                const span = daysBetween(event.start, event.end) + 1;
                return (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => onSelectEvent(event)}
                    aria-label={eventLabel(event)}
                    className={cn("rounded-lg px-2 py-1.5 text-left text-xs transition-colors", meta.chip)}
                  >
                    <span className="line-clamp-2 font-semibold">{event.title}</span>
                    {span > 1 && (
                      <span className="mt-0.5 block text-[10px] tabular-nums opacity-75">
                        Day {daysBetween(event.start, day) + 1} of {span}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => onCreateOn(day)}
              aria-label={`Add a reminder on ${formatDayLong(day)}`}
              className="mt-2 inline-flex items-center gap-1 self-start text-[11px] font-medium text-stone-400 transition-colors hover:text-primary"
            >
              <Plus className="h-3 w-3" />
              Add
            </button>
          </section>
        );
      })}
    </div>
  );
}

// ── List ─────────────────────────────────────────────────────────────────────

export function ListView({ range, today, events, onSelectEvent, onCreateOn }: ViewProps) {
  if (events.length === 0) {
    return (
      <div className="pb-10">
        <EmptyState
          icon={CalendarDays}
          title="Nothing scheduled in this period"
          description="Add a reminder to start planning your next campaign."
        />
        <div className="flex justify-center">
          <AddButton onClick={() => onCreateOn(maxDay(range.start, today))} label="Add reminder" />
        </div>
      </div>
    );
  }

  return (
    <div className="divide-y divide-stone-100">
      {groupByMonth(events, range.start).map((group) => (
        <section key={group.month} aria-label={monthName(group.month)} className="px-3 py-4 sm:px-5">
          <h3 className="px-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-stone-400">
            {monthName(group.month)}
          </h3>
          <ul className="mt-2">
            {group.events.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                today={today}
                onSelect={() => onSelectEvent(event)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
