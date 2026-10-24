// ─────────────────────────────────────────────────────────────────────────────
// Display formatters render STORE (Africa/Cairo) wall-clock, never the
// runtime's zone.
//
// Production (Vercel) renders in UTC. formatDate / formatDateTime used to build
// their Intl.DateTimeFormat without a timeZone, so a promotion starting on the
// Cairo day 2026-10-25 (21:00 UTC on the 24th) listed as "24 Oct 2026", and
// order times read 2–3h early. Dev machines run on Cairo time, which hid it —
// so this suite pins process.env.TZ = "UTC" (Node re-reads it per formatter)
// and checks both sides of Egypt's DST (+03:00 summer, +02:00 winter).
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "@/lib/utils";
import { storeDateStart } from "@/lib/timezone";

const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "UTC";
});
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("the pin is real", () => {
  it("a formatter with no timeZone now renders UTC (the bug's precondition)", () => {
    const justAfterCairoMidnight = new Date("2026-10-24T21:30:00.000Z"); // 00:30 Cairo, 25 Oct
    const naive = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" });
    expect(naive.format(justAfterCairoMidnight)).toBe("24 Oct");
  });
});

describe("formatDate — the Cairo calendar day", () => {
  it("a promotion starting on the Cairo day 2026-10-25 lists as 25 Oct (summer, +03:00)", () => {
    const start = storeDateStart("2026-10-25")!; // 2026-10-24T21:00:00Z
    expect(start.toISOString()).toBe("2026-10-24T21:00:00.000Z");
    expect(formatDate(start)).toBe("25 Oct 2026");
  });

  it("an instant just after Cairo midnight is that Cairo day (summer)", () => {
    expect(formatDate(new Date("2026-10-24T21:00:01.000Z"))).toBe("25 Oct 2026");
  });

  it("an instant just after Cairo midnight is that Cairo day (winter, +02:00)", () => {
    // 2027-01-01 00:30 Cairo — still 2026 in UTC.
    expect(formatDate(new Date("2026-12-31T22:30:00.000Z"))).toBe("01 Jan 2027");
  });

  it("an instant just before Cairo midnight stays on the earlier day", () => {
    expect(formatDate(new Date("2026-10-24T20:59:59.000Z"))).toBe("24 Oct 2026");
  });
});

describe("formatDateTime — Cairo wall-clock time", () => {
  it("a 14:30 Cairo order formats as 14:30 (summer, 11:30 UTC)", () => {
    const out = formatDateTime(new Date("2026-07-15T11:30:00.000Z"));
    expect(out).toMatch(/^15 July 2026\b/);
    expect(out).toMatch(/\b14:30$/);
  });

  it("a 14:30 Cairo order formats as 14:30 (winter, 12:30 UTC)", () => {
    const out = formatDateTime(new Date("2026-01-15T12:30:00.000Z"));
    expect(out).toMatch(/^15 January 2026\b/);
    expect(out).toMatch(/\b14:30$/);
  });

  it("an order placed at 00:30 Cairo shows the Cairo day and time", () => {
    const out = formatDateTime(new Date("2026-10-24T21:30:00.000Z"));
    expect(out).toMatch(/^25 October 2026\b/);
    expect(out).toMatch(/\b00:30$/);
  });
});
