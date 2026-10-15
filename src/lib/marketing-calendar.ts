// ─────────────────────────────────────────────────────────────────────────────
// Marketing calendar — the shared date model behind /admin/calendar.
//
// Every calendar entry is ALL-DAY and lives on CAIRO calendar dates, so dates
// travel as "YYYY-MM-DD" day keys, never as instants: a key names the same day
// on the server, in any admin's browser, and in Postgres (`@db.Date`). All
// arithmetic runs on the UTC timestamps of those keys — no DST, no local clock.
// "Today" is storeDayKey(new Date()) from src/lib/timezone.ts, read once on the
// server and passed down, so the client never consults its own clock.
//
// Pure and dependency-free apart from the generated enum type, so the server
// page, the client islands, the shared Zod schema and the actions all import
// it. The built-in holiday catalog lives in marketing-holidays.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { MarketingEventType } from "@/generated/prisma/enums";

/** A calendar date, "YYYY-MM-DD". */
export type DayKey = string;

export type CalendarView = "month" | "week" | "list";
export const CALENDAR_VIEWS: readonly CalendarView[] = ["month", "week", "list"];

/** One calendar entry — built-in occasion or custom reminder, fully serializable. */
export interface CalendarEvent {
  /** Built-ins: "builtin:<key>:<start>"; custom: the MarketingEvent id. */
  id: string;
  source: "builtin" | "custom";
  title: string;
  /** Arabic name (built-ins only). */
  titleAr: string | null;
  type: MarketingEventType;
  /** First day, inclusive. */
  start: DayKey;
  /** Last day, inclusive. */
  end: DayKey;
  /** Built-ins: what the shop should line up ahead of the occasion. */
  prepTip: string | null;
  /** The date is computed rather than fixed (moon sighting, ministry decision). */
  estimated: boolean;
  notes: string | null;
  strategy: string | null;
  targetDiscountPercent: number | null;
}

/** Occasions starting within this many days surface in the campaign-prep panel… */
export const PREP_WINDOW_DAYS = 30;
/** …and within this many they're flagged as urgent. */
export const PREP_URGENT_DAYS = 14;

/** Saturday — the first day of the Egyptian calendar week (0 = Sunday). */
export const WEEK_STARTS_ON = 6;

/** Years the calendar accepts — keeps keys four-digit and the Hijri tables in range. */
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2099;

const DAY_MS = 86_400_000;
const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function dayKeyToUTC(key: DayKey): number {
  const [year, month, day] = key.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

export function utcToDayKey(utcMs: number): DayKey {
  return new Date(utcMs).toISOString().slice(0, 10);
}

/** True for a real calendar date "YYYY-MM-DD" within the supported years (rejects 2026-02-30). */
export function isDayKey(value: unknown): value is DayKey {
  if (typeof value !== "string") return false;
  const m = DAY_KEY_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  if (year < MIN_YEAR || year > MAX_YEAR) return false;
  // Date.UTC rolls an impossible day over into the next month — catch that.
  return utcToDayKey(Date.UTC(year, Number(m[2]) - 1, Number(m[3]))) === value;
}

/** The UTC-midnight Date Prisma writes to a `@db.Date` column for `key`. */
export function dayKeyToDate(key: DayKey): Date {
  return new Date(dayKeyToUTC(key));
}

/** The day key of a `@db.Date` value read back from Prisma (UTC midnight). */
export function dateToDayKey(date: Date): DayKey {
  return utcToDayKey(date.getTime());
}

export function addDays(key: DayKey, days: number): DayKey {
  return utcToDayKey(dayKeyToUTC(key) + days * DAY_MS);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: DayKey, to: DayKey): number {
  return Math.round((dayKeyToUTC(to) - dayKeyToUTC(from)) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(key: DayKey): number {
  return new Date(dayKeyToUTC(key)).getUTCDay();
}

/** The Saturday that opens the week containing `key`. */
export function startOfWeek(key: DayKey): DayKey {
  return addDays(key, -((dayOfWeek(key) - WEEK_STARTS_ON + 7) % 7));
}

export function startOfMonth(key: DayKey): DayKey {
  return `${key.slice(0, 7)}-01`;
}

/** The first day of the month `months` away from `key`'s month. */
export function addMonths(key: DayKey, months: number): DayKey {
  const [year, month] = key.split("-").map(Number);
  return utcToDayKey(Date.UTC(year, month - 1 + months, 1));
}

export function endOfMonth(key: DayKey): DayKey {
  return addDays(addMonths(key, 1), -1);
}

export function minDay(a: DayKey, b: DayKey): DayKey {
  return a < b ? a : b;
}

export function maxDay(a: DayKey, b: DayKey): DayKey {
  return a > b ? a : b;
}

/** Does a span touch any day of [start, end]? (Day keys compare as strings.) */
export function overlaps(span: { start: DayKey; end: DayKey }, start: DayKey, end: DayKey): boolean {
  return span.start <= end && span.end >= start;
}

/** The inclusive date range a view shows around `anchor`. */
export function viewRange(view: CalendarView, anchor: DayKey): { start: DayKey; end: DayKey } {
  if (view === "week") {
    const start = startOfWeek(anchor);
    return { start, end: addDays(start, 6) };
  }
  if (view === "list") {
    // A rolling quarter: the anchor month and the two after it.
    return { start: startOfMonth(anchor), end: endOfMonth(addMonths(anchor, 2)) };
  }
  // Month: whole Saturday-to-Friday weeks covering the month.
  return {
    start: startOfWeek(startOfMonth(anchor)),
    end: addDays(startOfWeek(endOfMonth(anchor)), 6),
  };
}

/** The anchor one step back or forward — a week in week view, a month otherwise. */
export function stepAnchor(view: CalendarView, anchor: DayKey, step: 1 | -1): DayKey {
  return view === "week" ? addDays(anchor, 7 * step) : addMonths(anchor, step);
}

/**
 * Stable display order: earlier start first, longer spans first, then title.
 * Plain comparisons (not localeCompare) so server and browser always agree.
 */
export function compareEvents(a: CalendarEvent, b: CalendarEvent): number {
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  if (a.end !== b.end) return a.end > b.end ? -1 : 1;
  return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
}

export type PrepStatus =
  | { kind: "running"; endsIn: number }
  | { kind: "upcoming"; startsIn: number; urgent: boolean };

/**
 * Where an event stands relative to `today` for the campaign-prep panel —
 * null once it's over or while it's still beyond the prep window.
 */
export function prepStatus(event: { start: DayKey; end: DayKey }, today: DayKey): PrepStatus | null {
  if (event.end < today) return null;
  if (event.start <= today) return { kind: "running", endsIn: daysBetween(today, event.end) };
  const startsIn = daysBetween(today, event.start);
  if (startsIn > PREP_WINDOW_DAYS) return null;
  return { kind: "upcoming", startsIn, urgent: startsIn <= PREP_URGENT_DAYS };
}
