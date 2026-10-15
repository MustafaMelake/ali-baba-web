// ─────────────────────────────────────────────────────────────────────────────
// Presentation helpers for the marketing calendar — colour map, labels, links.
//
// A plain module (no "use client") shared by the Server Component page and the
// client islands. Dates are formatted from fixed English name tables rather
// than Intl: the islands are server-rendered, and Node's ICU and the browser's
// can disagree on short month names ("Sep" vs "Sept"), which would surface as
// a hydration mismatch.
// ─────────────────────────────────────────────────────────────────────────────

import { MarketingEventType } from "@/generated/prisma/enums";
import {
  dayKeyToUTC,
  dayOfWeek,
  maxDay,
  WEEK_STARTS_ON,
  type CalendarEvent,
  type CalendarView,
  type DayKey,
  type PrepStatus,
} from "@/lib/marketing-calendar";

export const EVENT_TYPE_META: Record<
  MarketingEventType,
  { label: string; dot: string; chip: string; pill: string }
> = {
  [MarketingEventType.CAMPAIGN]: {
    label: "Campaign",
    dot: "bg-primary",
    chip: "bg-primary/10 text-primary hover:bg-primary/15",
    pill: "bg-primary/10 text-primary ring-primary/20",
  },
  [MarketingEventType.RETAIL_SEASON]: {
    label: "Shopping season",
    dot: "bg-amber-500",
    chip: "bg-amber-50 text-amber-800 hover:bg-amber-100",
    pill: "bg-amber-50 text-amber-700 ring-amber-600/20",
  },
  [MarketingEventType.RELIGIOUS_HOLIDAY]: {
    label: "Religious holiday",
    dot: "bg-emerald-500",
    chip: "bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
    pill: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  },
  [MarketingEventType.EGYPTIAN_HOLIDAY]: {
    label: "National holiday",
    dot: "bg-rose-500",
    chip: "bg-rose-50 text-rose-800 hover:bg-rose-100",
    pill: "bg-rose-50 text-rose-700 ring-rose-600/20",
  },
};

/** Legend + type-select order: the shop's own work first. */
export const EVENT_TYPE_ORDER: MarketingEventType[] = [
  MarketingEventType.CAMPAIGN,
  MarketingEventType.RETAIL_SEASON,
  MarketingEventType.RELIGIOUS_HOLIDAY,
  MarketingEventType.EGYPTIAN_HOLIDAY,
];

export const VIEW_LABELS: Record<CalendarView, string> = {
  month: "Month",
  week: "Week",
  list: "List",
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function parts(key: DayKey) {
  const date = new Date(dayKeyToUTC(key));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate() };
}

const shortMonth = (month: number) => MONTHS[month].slice(0, 3);

/** "20 Oct 2026", optionally "Tue, 20 Oct 2026". */
export function formatDay(key: DayKey, opts: { weekday?: boolean; year?: boolean } = {}): string {
  const { year, month, day } = parts(key);
  const weekday = opts.weekday ? `${WEEKDAYS[dayOfWeek(key)].slice(0, 3)}, ` : "";
  return `${weekday}${day} ${shortMonth(month)}${opts.year === false ? "" : ` ${year}`}`;
}

/** "20 Oct 2026" · "20 – 23 Oct 2026" · "28 Nov – 1 Dec 2026" · "31 Dec 2026 – 1 Jan 2027". */
export function formatRange(start: DayKey, end: DayKey): string {
  if (start === end) return formatDay(start);
  const a = parts(start);
  const b = parts(end);
  if (a.year !== b.year) return `${formatDay(start)} – ${formatDay(end)}`;
  if (a.month !== b.month) return `${a.day} ${shortMonth(a.month)} – ${b.day} ${shortMonth(b.month)} ${b.year}`;
  return `${a.day} – ${b.day} ${shortMonth(b.month)} ${b.year}`;
}

/** "Tuesday 20 October 2026" — for screen-reader labels. */
export function formatDayLong(key: DayKey): string {
  const { year, month, day } = parts(key);
  return `${WEEKDAYS[dayOfWeek(key)]} ${day} ${MONTHS[month]} ${year}`;
}

export function dayNumber(key: DayKey): number {
  return parts(key).day;
}

/** "Tue". */
export function weekdayShort(key: DayKey): string {
  return WEEKDAYS[dayOfWeek(key)].slice(0, 3);
}

/** "October 2026". */
export function monthName(key: DayKey): string {
  const { year, month } = parts(key);
  return `${MONTHS[month]} ${year}`;
}

/** Weekday column headers, starting on the calendar's first day (Saturday). */
export const WEEKDAY_HEADERS = Array.from({ length: 7 }, (_, i) => {
  const name = WEEKDAYS[(WEEK_STARTS_ON + i) % 7];
  return { short: name.slice(0, 3), long: name };
});

/** The toolbar title for the current view. */
export function periodLabel(view: CalendarView, range: { start: DayKey; end: DayKey }, anchor: DayKey): string {
  if (view === "week") return formatRange(range.start, range.end);
  const a = parts(anchor);
  if (view === "month") return `${MONTHS[a.month]} ${a.year}`;
  const b = parts(range.end);
  return a.year === b.year
    ? `${shortMonth(a.month)} – ${shortMonth(b.month)} ${b.year}`
    : `${shortMonth(a.month)} ${a.year} – ${shortMonth(b.month)} ${b.year}`;
}

const inDays = (n: number) => (n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);

/** "Starts in 9 days" · "Starts tomorrow" · "Happening now · ends today". */
export function countdownLabel(status: PrepStatus): string {
  if (status.kind === "running") return `Happening now · ends ${inDays(status.endsIn)}`;
  return `Starts ${inDays(status.startsIn)}`;
}

export function calendarHref(view: CalendarView, date: DayKey): string {
  return `/admin/calendar?view=${view}&date=${date}`;
}

/**
 * Deep link into the promotions page with the create form pre-filled
 * (see `parsePromotionDraft` on that page) — null once the event is over.
 * A running event's promotion starts today rather than in the past.
 */
export function promotionDraftHref(event: CalendarEvent, today: DayKey): string | null {
  if (event.end < today) return null;
  const params = new URLSearchParams({
    draft: "1",
    name: event.source === "builtin" ? `${event.title} ${event.start.slice(0, 4)}` : event.title,
    start: maxDay(event.start, today),
    end: event.end,
  });
  if (event.targetDiscountPercent != null) params.set("value", String(event.targetDiscountPercent));
  return `/admin/promotions?${params.toString()}`;
}
