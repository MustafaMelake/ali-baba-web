// ─────────────────────────────────────────────────────────────────────────────
// Store season — unit suite.
//
// `src/lib/seasons.ts` names the season the homepage's seasonal intro paints
// (`src/components/SeasonalOverlay.tsx`). Seasons are meteorological — whole
// calendar months, Dec–Feb winter through Sep–Nov autumn — and, like every
// business date in the platform, they follow the STORE's Africa/Cairo calendar
// (`.claude/rules/business-logic.md`), not UTC or the device clock.
//
// The boundary cases sit at 23:00 UTC on the last day of a season: UTC is still
// on the old month while Cairo (UTC+02:00, or +03:00 under DST) has already
// turned the page. The process is pinned to UTC for this file — the dev
// machines run on Cairo time, where a naive `getMonth()` would pass by accident.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seasonForMonth, storeSeason } from "@/lib/seasons";

const originalTz = process.env.TZ;

beforeAll(() => {
  process.env.TZ = "UTC";
});

afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("seasonForMonth — meteorological seasons", () => {
  it.each([
    [1, "winter"],
    [2, "winter"],
    [3, "spring"],
    [4, "spring"],
    [5, "spring"],
    [6, "summer"],
    [7, "summer"],
    [8, "summer"],
    [9, "autumn"],
    [10, "autumn"],
    [11, "autumn"],
    [12, "winter"],
  ] as const)("month %i is %s", (month, season) => {
    expect(seasonForMonth(month)).toBe(season);
  });
});

describe("storeSeason — the Cairo calendar month, not the UTC one", () => {
  it.each([
    ["2026-02-28T23:00:00Z", "spring"], // 01:00 on 1 Mar in Cairo
    ["2026-05-31T23:00:00Z", "summer"], // 02:00 on 1 Jun (DST)
    ["2026-08-31T23:00:00Z", "autumn"], // 02:00 on 1 Sep (DST)
    ["2026-11-30T23:00:00Z", "winter"], // 01:00 on 1 Dec
  ])("%s is already %s in Cairo", (instant, season) => {
    expect(storeSeason(new Date(instant))).toBe(season);
  });

  it("stays in the old season until Cairo midnight", () => {
    // 23:59 on 30 Nov in Cairo (UTC+02:00) — still autumn.
    expect(storeSeason(new Date("2026-11-30T21:59:00Z"))).toBe("autumn");
  });
});
