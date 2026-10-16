// ─────────────────────────────────────────────────────────────────────────────
// Store seasons — which season the storefront is in, on the store's calendar.
//
// Meteorological seasons (whole calendar months, northern hemisphere): winter
// is Dec–Feb, spring Mar–May, summer Jun–Aug, autumn Sep–Nov. The month is read
// on the Africa/Cairo calendar like every other business date — never the
// device or server clock — so a visitor abroad, or a page rendered on a UTC
// host, still sees the store's season turn at Cairo midnight. Pure, and safe on
// both sides of the client boundary (`timezone.ts` is plain Intl).
// ─────────────────────────────────────────────────────────────────────────────

import { storeDayParts } from "@/lib/timezone";

export type Season = "winter" | "spring" | "summer" | "autumn";

/** The meteorological season of calendar month `month` (1 = January). */
export function seasonForMonth(month: number): Season {
  if (month === 12 || month <= 2) return "winter";
  if (month <= 5) return "spring";
  if (month <= 8) return "summer";
  return "autumn";
}

/** The season of the store-timezone (Cairo) calendar month containing `now`. */
export function storeSeason(now: Date = new Date()): Season {
  return seasonForMonth(storeDayParts(now).month);
}
