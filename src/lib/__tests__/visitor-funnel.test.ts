// ─────────────────────────────────────────────────────────────────────────────
// Visitor funnel math (src/lib/visitor-funnel.ts).
//
// Pins: unique visitors vs total page views, distinct-visitor funnel steps with
// the real order count as the last step, drop-off (floored at 0, null after an
// empty step), and daily-unique buckets on CAIRO calendar days across a
// midnight boundary.
//
// The process TZ is pinned to UTC: the dev machine itself runs in Africa/Cairo,
// so an implementation bucketing by the device clock would otherwise pass.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  dailyUniqueVisitors,
  dropOffPercent,
  funnelSteps,
  summarizeVisits,
  type FunnelEvent,
  type FunnelEventType,
} from "@/lib/visitor-funnel";

const originalTZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "UTC";
});
afterAll(() => {
  process.env.TZ = originalTZ;
});

// Cairo is UTC+2 after DST ended on 2026-10-29: Cairo midnight Nov 1 = 2026-10-31T22:00Z.
const NOW = new Date("2026-11-01T10:00:00Z");

function ev(visitorId: string, type: FunnelEventType, iso = "2026-11-01T09:00:00Z"): FunnelEvent {
  return { visitorId, type, createdAt: new Date(iso) };
}

describe("summarizeVisits — unique vs total", () => {
  it("counts each visitor once but every page view", () => {
    const events = [
      ev("a", "VIEW"),
      ev("a", "VIEW"),
      ev("a", "VIEW"),
      ev("b", "VIEW"),
      ev("b", "PRODUCT_VIEW"), // not a page view on its own
    ];

    const summary = summarizeVisits(events, 0, 7, NOW);

    expect(summary.uniqueVisitors).toBe(2);
    expect(summary.pageViews).toBe(4);
  });

  it("counts funnel steps as DISTINCT visitors, ending on the real order count", () => {
    const events = [
      ...["a", "b", "c", "d"].map((v) => ev(v, "VIEW")),
      ev("a", "PRODUCT_VIEW"),
      ev("a", "PRODUCT_VIEW"), // same shopper, second product
      ev("b", "PRODUCT_VIEW"),
      ev("c", "PRODUCT_VIEW"),
      ev("a", "ADD_TO_CART"),
      ev("a", "ADD_TO_CART"),
      ev("b", "ADD_TO_CART"),
      ev("a", "CHECKOUT_START"),
    ];

    const { steps } = summarizeVisits(events, 1, 7, NOW);

    expect(steps.map((s) => [s.key, s.count])).toEqual([
      ["visitors", 4],
      ["productViews", 3],
      ["addToCart", 2],
      ["checkout", 1],
      ["orders", 1],
    ]);
  });

  it("is all zeros with no traffic", () => {
    const summary = summarizeVisits([], 0, 7, NOW);
    expect(summary.uniqueVisitors).toBe(0);
    expect(summary.pageViews).toBe(0);
    expect(summary.steps.every((s) => s.count === 0 && (s.dropOff === null))).toBe(true);
    expect(summary.daily).toHaveLength(7);
  });
});

describe("funnel drop-off", () => {
  it("is the share of the previous step lost, to 1 dp", () => {
    const steps = funnelSteps({ visitors: 300, productViews: 120, addToCart: 40, checkout: 30, orders: 21 });

    expect(steps.map((s) => s.dropOff)).toEqual([null, 60, 66.7, 25, 30]);
  });

  it("floors at 0 when a step exceeds the one before (orders aren't tied to visitors)", () => {
    expect(dropOffPercent(2, 3)).toBe(0);
  });

  it("is null after an empty step — no division by zero", () => {
    expect(dropOffPercent(0, 0)).toBeNull();
    const steps = funnelSteps({ visitors: 5, productViews: 0, addToCart: 0, checkout: 0, orders: 0 });
    expect(steps.map((s) => s.dropOff)).toEqual([null, 100, null, null, null]);
  });
});

describe("dailyUniqueVisitors — Cairo days", () => {
  it("splits events on CAIRO midnight, not UTC midnight", () => {
    const events = [
      ev("late", "VIEW", "2026-10-31T21:59:00Z"), // 23:59 Oct 31 Cairo
      ev("early", "VIEW", "2026-10-31T22:00:00Z"), // 00:00 Nov 1 Cairo — still Oct 31 in UTC
      ev("early2", "VIEW", "2026-10-31T23:30:00Z"), // 01:30 Nov 1 Cairo
    ];

    const series = dailyUniqueVisitors(events, 7, NOW);
    const byKey = Object.fromEntries(series.map((d) => [d.key, d.visitors]));

    expect(byKey["2026-10-31"]).toBe(1);
    expect(byKey["2026-11-01"]).toBe(2);
  });

  it("builds one bucket per day ending on Cairo today, oldest first, labelled to match", () => {
    // 23:30Z on Oct 31 is already Nov 1 in Cairo.
    const series = dailyUniqueVisitors([], 3, new Date("2026-10-31T23:30:00Z"));

    expect(series.map((d) => d.key)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(series.map((d) => d.date)).toEqual(["30 Oct", "31 Oct", "01 Nov"]);
  });

  it("counts a visitor once per day, but on each day they came", () => {
    const events = [
      ev("a", "VIEW", "2026-10-31T08:00:00Z"),
      ev("a", "VIEW", "2026-10-31T12:00:00Z"),
      ev("a", "VIEW", "2026-11-01T08:00:00Z"),
    ];

    const series = dailyUniqueVisitors(events, 2, NOW);

    expect(series.map((d) => d.visitors)).toEqual([1, 1]);
  });

  it("ignores events outside the window", () => {
    const series = dailyUniqueVisitors([ev("old", "VIEW", "2026-10-01T08:00:00Z")], 7, NOW);
    expect(series.every((d) => d.visitors === 0)).toBe(true);
  });
});
