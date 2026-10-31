// ─────────────────────────────────────────────────────────────────────────────
// Store-timezone date arithmetic — unit suite (Africa/Cairo boundaries).
//
// `src/lib/timezone.ts` converts Cairo wall-clock boundaries into exact UTC
// instants. Every business "day"/"month" in the platform is a CAIRO calendar
// boundary (`.claude/rules/business-logic.md`), so a bug here silently shifts
// revenue windows, dashboard counters and promotion liveness by hours.
//
// The `storeDateStart` / `storeDateEnd` cases pin the regression they were
// written for: a promotion whose edges come from an `<input type="date">`
// ("YYYY-MM-DD") used to be parsed with `new Date(...)`, which resolves to
// 00:00 **UTC** — 02:00/03:00 Cairo. Because `livePromotionWhere` tests
// `startDate <= now <= endDate`, a same-day promotion collapsed to a single
// instant and was never live at all.
//
// Egypt reinstated DST in 2023, so the offset is +02:00 in winter and +03:00 in
// summer — a hardcoded offset is wrong for part of the year and these tests
// assert both sides of that.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  STORE_TZ,
  storeDayKey,
  storeDateStart,
  storeDateEnd,
  nextStoreMidnight,
} from "@/lib/timezone";

/** `livePromotionWhere` / `isPromotionLive` semantics: inclusive on both ends. */
function isLive(start: Date, end: Date, now: Date): boolean {
  return start <= now && now <= end;
}

describe("STORE_TZ", () => {
  it("is Africa/Cairo", () => {
    expect(STORE_TZ).toBe("Africa/Cairo");
  });
});

describe("storeDateStart — Cairo midnight as a UTC instant", () => {
  it("resolves a winter date at UTC+02:00 (DST inactive)", () => {
    // 2026-01-15 00:00 Cairo === 2026-01-14 22:00 UTC.
    expect(storeDateStart("2026-01-15")?.toISOString()).toBe(
      "2026-01-14T22:00:00.000Z",
    );
  });

  it("resolves a summer date at UTC+03:00 (DST active)", () => {
    // 2026-07-15 00:00 Cairo === 2026-07-14 21:00 UTC.
    expect(storeDateStart("2026-07-15")?.toISOString()).toBe(
      "2026-07-14T21:00:00.000Z",
    );
  });

  it("lands on the requested Cairo calendar day, not the UTC one", () => {
    const start = storeDateStart("2026-07-21")!;
    expect(storeDayKey(start)).toBe("2026-07-21");
  });

  it("rejects malformed input instead of coercing it", () => {
    for (const bad of ["", "2026-7-21", "21/07/2026", "not-a-date", "2026-13-01", "2026-01-32"]) {
      expect(storeDateStart(bad)).toBeNull();
    }
  });
});

describe("storeDateEnd — the final millisecond of a Cairo day", () => {
  it("is 1ms before the next Cairo midnight", () => {
    const end = storeDateEnd("2026-07-21")!;
    const nextStart = storeDateStart("2026-07-22")!;
    expect(nextStart.getTime() - end.getTime()).toBe(1);
  });

  it("still belongs to the requested Cairo day", () => {
    expect(storeDayKey(storeDateEnd("2026-07-21")!)).toBe("2026-07-21");
  });

  it("rolls over a month boundary", () => {
    expect(storeDayKey(storeDateEnd("2026-01-31")!)).toBe("2026-01-31");
    expect(storeDateStart("2026-02-01")!.getTime()).toBe(
      storeDateEnd("2026-01-31")!.getTime() + 1,
    );
  });

  it("rolls over a year boundary", () => {
    expect(storeDayKey(storeDateEnd("2026-12-31")!)).toBe("2026-12-31");
    expect(storeDateStart("2027-01-01")!.getTime()).toBe(
      storeDateEnd("2026-12-31")!.getTime() + 1,
    );
  });

  it("rejects malformed input instead of coercing it", () => {
    expect(storeDateEnd("2026-7-21")).toBeNull();
    expect(storeDateEnd("")).toBeNull();
  });
});

describe("promotion window regression — a same-day promotion is live all day", () => {
  const DAY = "2026-07-21";
  const start = storeDateStart(DAY)!;
  const end = storeDateEnd(DAY)!;

  /** The UTC instant of `hour`:00 Cairo wall-clock on DAY. */
  const cairoHour = (hour: number) => new Date(start.getTime() + hour * 3_600_000);

  it.each([0, 1, 2, 3, 9, 14, 20, 23])(
    "is live at %i:00 Cairo",
    (hour) => {
      expect(isLive(start, end, cairoHour(hour))).toBe(true);
    },
  );

  it("is NOT live one millisecond before the Cairo day begins", () => {
    expect(isLive(start, end, new Date(start.getTime() - 1))).toBe(false);
  });

  it("is NOT live once the Cairo day has ended", () => {
    expect(isLive(start, end, new Date(end.getTime() + 1))).toBe(false);
  });

  it("beats the old `new Date(dateOnly)` behaviour, which was never live", () => {
    // What the code used to do: both edges collapse to 00:00 UTC == 03:00 Cairo.
    const naiveStart = new Date(DAY);
    const naiveEnd = new Date(DAY);
    // Not live during business hours — the bug this suite pins.
    expect(isLive(naiveStart, naiveEnd, cairoHour(14))).toBe(false);
    expect(isLive(start, end, cairoHour(14))).toBe(true);
  });
});

// The expiry instant of a "Sold out today" mark: the NEXT Cairo midnight after
// `now`. It must equal the start of the FOLLOWING Cairo day for any instant in
// the current one — so a mark set at 00:01 and one set at 23:59 of the same
// Cairo day both expire at the same instant, and a reader's `soldOutUntil > now`
// stays true until exactly that instant.
describe("nextStoreMidnight — when a sold-out-today mark expires", () => {
  it("is the start of TOMORROW (Cairo), in winter (UTC+02:00)", () => {
    // 2026-01-15 12:00 Cairo → next midnight is 2026-01-16 00:00 Cairo.
    expect(nextStoreMidnight(new Date("2026-01-15T10:00:00.000Z"))!.toISOString()).toBe(
      storeDateStart("2026-01-16")!.toISOString(),
    );
    expect(nextStoreMidnight(new Date("2026-01-15T10:00:00.000Z")).toISOString()).toBe(
      "2026-01-15T22:00:00.000Z",
    );
  });

  it("is the start of TOMORROW (Cairo), in summer (UTC+03:00)", () => {
    expect(nextStoreMidnight(new Date("2026-07-15T10:00:00.000Z")).toISOString()).toBe(
      "2026-07-15T21:00:00.000Z",
    );
  });

  it("is constant across a whole Cairo day — set at 00:01 or 23:59, same expiry", () => {
    const dayStart = storeDateStart("2026-07-21")!; // 00:00 Cairo
    const nearStart = new Date(dayStart.getTime() + 60_000); // 00:01 Cairo
    const nearEnd = new Date(storeDateEnd("2026-07-21")!.getTime() - 60_000); // ~23:59 Cairo
    const expected = storeDateStart("2026-07-22")!.toISOString();
    expect(nextStoreMidnight(nearStart).toISOString()).toBe(expected);
    expect(nextStoreMidnight(nearEnd).toISOString()).toBe(expected);
  });

  // Egypt left DST on 2026-10-29 (the 25h fall-back day). Both sides must resolve
  // to the real next Cairo midnight, not a naive +24h that would land an hour off.
  it("resolves the next midnight on both sides of the 2026-10-29 fall-back", () => {
    // During 2026-10-28 (still DST) → start of the 25h day 2026-10-29.
    expect(nextStoreMidnight(new Date("2026-10-28T12:00:00.000Z")).toISOString()).toBe(
      storeDateStart("2026-10-29")!.toISOString(),
    );
    // During the 25h day 2026-10-29 → start of 2026-10-30 (now UTC+02:00).
    expect(nextStoreMidnight(new Date("2026-10-29T12:00:00.000Z")).toISOString()).toBe(
      storeDateStart("2026-10-30")!.toISOString(),
    );
    // The mark stays in the future until that exact instant, then expires.
    const now = new Date("2026-10-29T12:00:00.000Z");
    const expiry = nextStoreMidnight(now);
    expect(expiry > now).toBe(true);
    expect(expiry > new Date(expiry.getTime() - 1)).toBe(true);
    expect(expiry > expiry).toBe(false); // at the instant itself: no longer sold out
  });

  it("is independent of the machine's own timezone", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "America/New_York";
      expect(nextStoreMidnight(new Date("2026-07-15T10:00:00.000Z")).toISOString()).toBe(
        "2026-07-15T21:00:00.000Z",
      );
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

// Egypt's DST transitions (reinstated 2023): clocks jump 00:00 → 01:00 on the
// last Friday of April, and fall back 24:00 → 23:00 on the last Thursday of
// October. On the spring-forward day Cairo midnight does not exist, so the day
// must begin at the instant the clocks jump; both transition days must still
// tile seamlessly with their neighbours (23h and 25h long, no gap, no overlap).
describe("store day edges across Egypt's DST transitions", () => {
  const hours = (day: string) =>
    (storeDateEnd(day)!.getTime() + 1 - storeDateStart(day)!.getTime()) / 3_600_000;

  it.each([
    ["2026-04-24", "2026-04-23T22:00:00.000Z", 23], // spring forward (Fri)
    ["2026-10-29", "2026-10-28T21:00:00.000Z", 25], // fall back (Thu)
    ["2024-04-26", "2024-04-25T22:00:00.000Z", 23],
    ["2024-10-31", "2024-10-30T21:00:00.000Z", 25],
  ])("%s starts at %s and lasts %ih", (day, startIso, length) => {
    expect(storeDateStart(day)!.toISOString()).toBe(startIso);
    expect(hours(day)).toBe(length);
    expect(storeDayKey(storeDateStart(day)!)).toBe(day);
    expect(storeDayKey(storeDateEnd(day)!)).toBe(day);
  });

  it.each([
    ["2026-04-23", "2026-04-24", "2026-04-25"],
    ["2026-10-28", "2026-10-29", "2026-10-30"],
  ])("tiles %s → %s → %s with no gap or overlap", (before, day, after) => {
    expect(storeDateStart(day)!.getTime()).toBe(storeDateEnd(before)!.getTime() + 1);
    expect(storeDateStart(after)!.getTime()).toBe(storeDateEnd(day)!.getTime() + 1);
  });

  it("is independent of the machine's own timezone", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "UTC";
      expect(storeDateStart("2026-04-24")!.toISOString()).toBe("2026-04-23T22:00:00.000Z");
      process.env.TZ = "America/New_York";
      expect(storeDateEnd("2026-10-29")!.toISOString()).toBe("2026-10-29T21:59:59.999Z");
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});
