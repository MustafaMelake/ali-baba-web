// ─────────────────────────────────────────────────────────────────────────────
// Store-timezone date arithmetic — Africa/Cairo.
//
// The deployment region's Node timezone is an accident of hosting; every
// business "day" (dashboard counters, revenue windows, chart buckets) is a
// CAIRO calendar day. These helpers convert Cairo wall-clock boundaries into
// exact UTC instants for Prisma `gte`/`lt` range queries — DST-safely (Egypt
// reinstated DST in 2023, so a hardcoded UTC+2 offset is wrong for part of the
// year). Pure Intl, no dependencies.
//
// The raw-SQL analytics rollups perform the equivalent conversion inside
// Postgres (`"createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo'`);
// both sides import the STORE_TZ constant below so they can never disagree
// about which zone "the store day" means.
// ─────────────────────────────────────────────────────────────────────────────

export const STORE_TZ = "Africa/Cairo";

// en-CA yields ISO-style "YYYY-MM-DD" — usable directly as a bucket key.
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: STORE_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Full wall-clock in the store zone, used to measure the zone's UTC offset at
// a given instant. hourCycle "h23" prevents the "24:00" midnight artifact.
const wallClockFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: STORE_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** "YYYY-MM-DD" — the store-timezone calendar day containing instant `d`. */
export function storeDayKey(d: Date): string {
  return dayKeyFmt.format(d);
}

/** The store-timezone calendar date of instant `d`, as numeric parts. */
export function storeDayParts(d: Date): { year: number; month: number; day: number } {
  const [year, month, day] = dayKeyFmt.format(d).split("-").map(Number);
  return { year, month, day };
}

/** The store zone's UTC offset (ms) at instant `date` (e.g. +2h or +3h DST). */
function tzOffsetMs(date: Date): number {
  const v: Record<string, number> = {};
  for (const part of wallClockFmt.formatToParts(date)) {
    if (part.type !== "literal") v[part.type] = Number(part.value);
  }
  const asUTC = Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second);
  // Wall-clock re-encoded as UTC, minus the real instant = the zone's offset.
  // (Sub-second drift is irrelevant — real offsets are whole minutes.)
  return asUTC - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Convert a store-zone wall-clock midnight (encoded as a Date.UTC timestamp of
 * its calendar parts) into the exact UTC instant it occurs at. Guess with the
 * offset at the encoded time, then re-check once — the second pass corrects
 * the rare guess that lands on the other side of a DST transition.
 */
function utcInstantOfStoreMidnight(calendarUTC: number): Date {
  let ts = calendarUTC - tzOffsetMs(new Date(calendarUTC));
  ts = calendarUTC - tzOffsetMs(new Date(ts));
  return new Date(ts);
}

/**
 * The exact UTC instant of midnight in the store timezone, `daysAgo` CALENDAR
 * days before the store-zone day containing `now`. Day arithmetic happens in
 * calendar space (Date.UTC normalizes out-of-range days), never by adding
 * 24-hour blocks — so a 23h/25h DST day can't shift a boundary.
 *
 *   storeMidnight(0)  → start of "today" (Cairo)
 *   storeMidnight(1)  → start of "yesterday"
 *   storeMidnight(29) → start of the 30-day window ending today
 */
export function storeMidnight(daysAgo = 0, now: Date = new Date()): Date {
  const { year, month, day } = storeDayParts(now);
  return utcInstantOfStoreMidnight(Date.UTC(year, month - 1, day - daysAgo));
}

/** The exact UTC instant the store-timezone CURRENT month began (day 1, 00:00). */
export function storeMonthStart(now: Date = new Date()): Date {
  const { year, month } = storeDayParts(now);
  return utcInstantOfStoreMidnight(Date.UTC(year, month - 1, 1));
}
