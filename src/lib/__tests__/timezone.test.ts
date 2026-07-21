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
