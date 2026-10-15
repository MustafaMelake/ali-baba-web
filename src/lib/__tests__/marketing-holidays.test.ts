// ─────────────────────────────────────────────────────────────────────────────
// Built-in marketing calendar — unit suite (src/lib/marketing-holidays.ts).
//
// The computed occasions are only useful if they land on the days Egypt
// actually observes. These tests pin them to known dates:
//   • 2025 Hijri occasions as Egypt observed them (Ramadan from 1 March, Eid
//     al-Fitr 30 March, Eid al-Adha 6 June, Hijri New Year 26 June, Mawlid
//     4 September) — the Umm al-Qura calculation matched every one;
//   • Coptic Easter (Orthodox computus) and Sham El-Nessim;
//   • White/Black Friday (day after the 4th Thursday of November).
// Runs on Node's full ICU, which ships the Umm al-Qura calendar.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { MarketingEventType } from "@/generated/prisma/enums";
import { blackFriday, builtInEventsBetween, orthodoxEaster } from "@/lib/marketing-holidays";
import { addDays, compareEvents, daysBetween, isDayKey } from "@/lib/marketing-calendar";

/** The occurrences of one built-in occasion within a range, as [start, end]. */
function spansOf(key: string, start: string, end: string) {
  return builtInEventsBetween(start, end)
    .filter((e) => e.id.startsWith(`builtin:${key}:`))
    .map((e) => [e.start, e.end]);
}

describe("orthodoxEaster / blackFriday", () => {
  it.each([
    [2024, "2024-05-05"],
    [2025, "2025-04-20"],
    [2026, "2026-04-12"],
    [2027, "2027-05-02"],
  ])("Coptic Easter %i is %s", (year, expected) => {
    expect(orthodoxEaster(year)).toBe(expected);
  });

  it.each([
    [2024, "2024-11-29"],
    [2025, "2025-11-28"],
    [2026, "2026-11-27"],
    [2027, "2027-11-26"],
  ])("Black Friday %i is %s", (year, expected) => {
    expect(blackFriday(year)).toBe(expected);
  });
});

describe("Hijri occasions (Umm al-Qura)", () => {
  it("land on the days Egypt observed in 2025", () => {
    const [from, to] = ["2025-01-01", "2025-12-31"];
    expect(spansOf("ramadan", from, to)).toEqual([["2025-03-01", "2025-03-29"]]);
    expect(spansOf("eid-al-fitr", from, to)).toEqual([["2025-03-30", "2025-04-01"]]);
    expect(spansOf("eid-al-adha", from, to)).toEqual([["2025-06-06", "2025-06-09"]]);
    expect(spansOf("hijri-new-year", from, to)).toEqual([["2025-06-26", "2025-06-26"]]);
    expect(spansOf("mawlid", from, to)).toEqual([["2025-09-04", "2025-09-04"]]);
  });

  it("project forward for 2026", () => {
    const [from, to] = ["2026-01-01", "2026-12-31"];
    expect(spansOf("ramadan", from, to)).toEqual([["2026-02-18", "2026-03-19"]]);
    expect(spansOf("eid-al-fitr", from, to)).toEqual([["2026-03-20", "2026-03-22"]]);
    expect(spansOf("eid-al-adha", from, to)).toEqual([["2026-05-27", "2026-05-30"]]);
    expect(spansOf("mawlid", from, to)).toEqual([["2026-08-25", "2026-08-25"]]);
  });

  it("Ramadan always runs 29–30 days and ends the day before Eid al-Fitr", () => {
    // One continuous range, so a Ramadan that starts in December (2030) is
    // paired with its Eid in the following January.
    const ramadans = spansOf("ramadan", "2025-01-01", "2035-12-31");
    const fitrStarts = new Set(spansOf("eid-al-fitr", "2025-01-01", "2036-12-31").map(([s]) => s));
    expect(ramadans.length).toBeGreaterThanOrEqual(11);
    for (const [start, end] of ramadans) {
      expect(daysBetween(start, end) + 1).toBeGreaterThanOrEqual(29);
      expect(daysBetween(start, end) + 1).toBeLessThanOrEqual(30);
      expect(fitrStarts.has(addDays(end, 1))).toBe(true);
    }
  });

  it("catches a Hijri date that falls twice in one Gregorian year", () => {
    // 1 Muharram 1429 and 1430 both fell in 2008.
    expect(spansOf("hijri-new-year", "2008-01-01", "2008-12-31")).toEqual([
      ["2008-01-10", "2008-01-10"],
      ["2008-12-29", "2008-12-29"],
    ]);
  });

  it("flags Hijri occasions as estimated (moon sighting can move them a day)", () => {
    const eid = builtInEventsBetween("2026-03-20", "2026-03-20").find((e) =>
      e.id.startsWith("builtin:eid-al-fitr:"),
    );
    expect(eid).toMatchObject({
      estimated: true,
      type: MarketingEventType.RELIGIOUS_HOLIDAY,
      titleAr: "عيد الفطر",
    });
  });
});

describe("builtInEventsBetween", () => {
  it("places the Easter-linked and Friday-linked occasions", () => {
    expect(spansOf("coptic-easter", "2026-04-01", "2026-04-30")).toEqual([["2026-04-12", "2026-04-12"]]);
    expect(spansOf("sham-el-nessim", "2026-04-01", "2026-04-30")).toEqual([["2026-04-13", "2026-04-13"]]);
    expect(spansOf("white-friday", "2026-11-01", "2026-11-30")).toEqual([["2026-11-27", "2026-11-30"]]);
  });

  it("includes an occasion that began the year before the range (New Year's Eve)", () => {
    expect(spansOf("new-years-eve", "2026-01-01", "2026-01-01")).toEqual([["2025-12-31", "2026-01-01"]]);
  });

  it("returns only occasions touching the range", () => {
    const october = builtInEventsBetween("2026-10-01", "2026-10-31");
    expect(october.map((e) => e.id)).toContain("builtin:armed-forces-day:2026-10-06");
    expect(october.every((e) => e.start <= "2026-10-31" && e.end >= "2026-10-01")).toBe(true);
  });

  it("produces well-formed, unique, ordered events for years ahead", () => {
    const events = builtInEventsBetween("2026-01-01", "2030-12-31");
    expect(events.length).toBeGreaterThan(90); // ~21 occasions × 5 years
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    for (const e of events) {
      expect(isDayKey(e.start) && isDayKey(e.end)).toBe(true);
      expect(e.end >= e.start).toBe(true);
      expect(e.source).toBe("builtin");
      expect(e.prepTip).toBeTruthy();
    }
    expect([...events].sort(compareEvents)).toEqual(events);
  });
});
