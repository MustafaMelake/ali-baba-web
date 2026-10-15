// ─────────────────────────────────────────────────────────────────────────────
// Marketing calendar date model — unit suite (src/lib/marketing-calendar.ts).
//
// Pins the day-key arithmetic every calendar surface leans on: real-date
// validation, month/year/leap rollovers, the Saturday-first Egyptian week, the
// exact ranges each view renders, and the campaign-prep window boundaries.
// Pure functions — no mocks.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { MarketingEventType } from "@/generated/prisma/enums";
import {
  addDays,
  addMonths,
  compareEvents,
  dateToDayKey,
  dayKeyToDate,
  daysBetween,
  dayOfWeek,
  endOfMonth,
  isDayKey,
  overlaps,
  prepStatus,
  startOfWeek,
  stepAnchor,
  viewRange,
  type CalendarEvent,
} from "@/lib/marketing-calendar";

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: "e",
    source: "custom",
    title: "Event",
    titleAr: null,
    type: MarketingEventType.CAMPAIGN,
    start: "2026-10-15",
    end: "2026-10-15",
    prepTip: null,
    estimated: false,
    notes: null,
    strategy: null,
    targetDiscountPercent: null,
    ...overrides,
  };
}

describe("isDayKey", () => {
  it.each(["2026-10-15", "2028-02-29", "2000-01-01", "2099-12-31"])("accepts %s", (key) => {
    expect(isDayKey(key)).toBe(true);
  });

  it.each([
    "2026-02-29", // not a leap year
    "2026-02-30",
    "2026-13-01",
    "2026-10-1",
    "26-10-15",
    "2026-10-15T00:00:00Z",
    "1999-12-31", // before the supported range
    "2100-01-01", // after it
    "",
  ])("rejects %j", (key) => {
    expect(isDayKey(key)).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isDayKey(20261015)).toBe(false);
    expect(isDayKey(undefined)).toBe(false);
  });
});

describe("day arithmetic", () => {
  it("rolls over months, years and leap days in calendar space", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDays("2026-10-15", 30)).toBe("2026-11-14");
    expect(daysBetween("2026-10-15", "2026-11-14")).toBe(30);
    expect(daysBetween("2026-11-14", "2026-10-15")).toBe(-30);
  });

  it("is immune to DST — Egypt's spring-forward night still counts as one day", () => {
    // Egypt switches to summer time on the last Friday of April.
    expect(daysBetween("2026-04-23", "2026-04-25")).toBe(2);
  });

  it("moves months without overflowing short ones", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-01");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-01");
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
  });

  it("round-trips through a @db.Date value at UTC midnight", () => {
    const date = dayKeyToDate("2026-10-15");
    expect(date.toISOString()).toBe("2026-10-15T00:00:00.000Z");
    expect(dateToDayKey(date)).toBe("2026-10-15");
  });
});

describe("weeks start on Saturday (the Egyptian calendar week)", () => {
  it("snaps any day back to its Saturday", () => {
    expect(startOfWeek("2026-10-15")).toBe("2026-10-10"); // Thursday → Saturday
    expect(startOfWeek("2026-10-10")).toBe("2026-10-10"); // already Saturday
    expect(startOfWeek("2026-10-16")).toBe("2026-10-10"); // Friday closes the week
    expect(dayOfWeek(startOfWeek("2027-03-03"))).toBe(6);
  });
});

describe("viewRange / stepAnchor", () => {
  it("month: whole Saturday–Friday weeks covering the month", () => {
    // October 2026 runs Thursday the 1st to Saturday the 31st.
    expect(viewRange("month", "2026-10-15")).toEqual({ start: "2026-09-26", end: "2026-11-06" });
  });

  it("week: the Saturday-to-Friday week of the anchor", () => {
    expect(viewRange("week", "2026-10-15")).toEqual({ start: "2026-10-10", end: "2026-10-16" });
  });

  it("list: a rolling quarter from the anchor month", () => {
    expect(viewRange("list", "2026-11-20")).toEqual({ start: "2026-11-01", end: "2027-01-31" });
  });

  it("steps a week in week view, a month otherwise", () => {
    expect(stepAnchor("week", "2026-10-15", 1)).toBe("2026-10-22");
    expect(stepAnchor("month", "2026-10-15", -1)).toBe("2026-09-01");
    expect(stepAnchor("list", "2026-12-15", 1)).toBe("2027-01-01");
  });
});

describe("overlaps", () => {
  it("counts touching edges as overlapping (both ends inclusive)", () => {
    const span = { start: "2026-10-10", end: "2026-10-12" };
    expect(overlaps(span, "2026-10-12", "2026-10-20")).toBe(true);
    expect(overlaps(span, "2026-10-01", "2026-10-10")).toBe(true);
    expect(overlaps(span, "2026-10-13", "2026-10-20")).toBe(false);
    expect(overlaps(span, "2026-10-01", "2026-10-09")).toBe(false);
  });
});

describe("prepStatus — the campaign-prep window", () => {
  const today = "2026-10-15";

  it("drops events that are over", () => {
    expect(prepStatus({ start: "2026-10-01", end: "2026-10-14" }, today)).toBeNull();
  });

  it("marks events in progress, with days left", () => {
    expect(prepStatus({ start: "2026-10-15", end: "2026-10-15" }, today)).toEqual({
      kind: "running",
      endsIn: 0,
    });
    expect(prepStatus({ start: "2026-10-01", end: "2026-10-18" }, today)).toEqual({
      kind: "running",
      endsIn: 3,
    });
  });

  it("flags ≤ 14 days as urgent, keeps 15–30 as on the horizon, drops beyond 30", () => {
    expect(prepStatus({ start: "2026-10-29", end: "2026-10-29" }, today)).toEqual({
      kind: "upcoming",
      startsIn: 14,
      urgent: true,
    });
    expect(prepStatus({ start: "2026-10-30", end: "2026-10-30" }, today)).toEqual({
      kind: "upcoming",
      startsIn: 15,
      urgent: false,
    });
    expect(prepStatus({ start: "2026-11-14", end: "2026-11-14" }, today)).toMatchObject({
      startsIn: 30,
    });
    expect(prepStatus({ start: "2026-11-15", end: "2026-11-15" }, today)).toBeNull();
  });
});

describe("compareEvents", () => {
  it("orders by start, then longer spans first, then title", () => {
    const sorted = [
      event({ id: "c", title: "B", start: "2026-10-02", end: "2026-10-02" }),
      event({ id: "b", title: "Z", start: "2026-10-01", end: "2026-10-01" }),
      event({ id: "a", title: "Z", start: "2026-10-01", end: "2026-10-05" }),
      event({ id: "d", title: "A", start: "2026-10-02", end: "2026-10-02" }),
    ].sort(compareEvents);

    expect(sorted.map((e) => e.id)).toEqual(["a", "b", "d", "c"]);
  });
});
