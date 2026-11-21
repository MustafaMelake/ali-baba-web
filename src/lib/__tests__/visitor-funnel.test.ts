// ─────────────────────────────────────────────────────────────────────────────
// Visitor funnel math (src/lib/visitor-funnel.ts).
//
// Since audit H-2 the counting runs in Postgres (getVisitorFunnel's two
// rollups) and this module only builds the card from them. The central spec
// below proves the move changed no number: for every fixture, the builder fed
// a rollup computed with the SQL's semantics returns EXACTLY what the old
// in-memory algorithm (frozen here as the reference) returned from the raw
// events — unique vs total, distinct-visitor steps, drop-off, and the daily
// series on CAIRO calendar days across midnight and the DST change.
//
// The process TZ is pinned to UTC: the dev machine itself runs in Africa/Cairo,
// so an implementation bucketing by the device clock would otherwise pass.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildVisitorSummary,
  dailyVisitorSeries,
  dropOffPercent,
  funnelSteps,
  type DailyVisitorRow,
  type FunnelEventType,
  type VisitorSummary,
  type VisitWindowCounts,
} from "@/lib/visitor-funnel";
import { storeDayKey, storeDayParts, storeMidnight } from "@/lib/timezone";

const originalTZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "UTC";
});
afterAll(() => {
  process.env.TZ = originalTZ;
});

// Cairo is UTC+2 after DST ended on 2026-10-29: Cairo midnight Nov 1 = 2026-10-31T22:00Z.
const NOW = new Date("2026-11-01T10:00:00Z");

type Event = { type: FunnelEventType; visitorId: string; createdAt: Date };

function ev(visitorId: string, type: FunnelEventType, iso = "2026-11-01T09:00:00Z"): Event {
  return { visitorId, type, createdAt: new Date(iso) };
}

// ── The pre-H-2 in-memory algorithm, frozen verbatim as the reference ─────────

const labelFmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });

function referenceDaily(events: Event[], days: number, now: Date) {
  const { year, month, day } = storeDayParts(now);
  const series: { key: string; date: string; visitors: number }[] = [];
  const buckets = new Map<string, Set<string>>();
  for (let i = 0; i < days; i++) {
    const carrier = new Date(Date.UTC(year, month - 1, day - (days - 1 - i)));
    const key = carrier.toISOString().slice(0, 10);
    buckets.set(key, new Set());
    series.push({ key, date: labelFmt.format(carrier), visitors: 0 });
  }
  for (const e of events) buckets.get(storeDayKey(e.createdAt))?.add(e.visitorId);
  for (const point of series) point.visitors = buckets.get(point.key)!.size;
  return series;
}

function referenceSummarize(events: Event[], orders: number, days: number, now: Date): VisitorSummary {
  const all = new Set<string>();
  const byType: Record<FunnelEventType, Set<string>> = {
    VIEW: new Set(),
    PRODUCT_VIEW: new Set(),
    ADD_TO_CART: new Set(),
    CHECKOUT_START: new Set(),
  };
  let pageViews = 0;
  for (const e of events) {
    all.add(e.visitorId);
    byType[e.type].add(e.visitorId);
    if (e.type === "VIEW") pageViews++;
  }
  return {
    uniqueVisitors: all.size,
    pageViews,
    steps: funnelSteps({
      visitors: all.size,
      productViews: byType.PRODUCT_VIEW.size,
      addToCart: byType.ADD_TO_CART.size,
      checkout: byType.CHECKOUT_START.size,
      orders,
    }),
    daily: referenceDaily(events, days, now),
  };
}

// ── A JS twin of getVisitorFunnel's two SQL rollups (same semantics) ──────────

/** COUNT(DISTINCT visitorId) [FILTER type] / COUNT(*) FILTER VIEW over createdAt >= start. */
function sqlWindowCounts(events: Event[], start: Date): VisitWindowCounts {
  const inWindow = events.filter((e) => e.createdAt >= start);
  const distinct = (type?: FunnelEventType) =>
    new Set(inWindow.filter((e) => !type || e.type === type).map((e) => e.visitorId)).size;
  return {
    uniqueVisitors: distinct(),
    pageViews: inWindow.filter((e) => e.type === "VIEW").length,
    productViewers: distinct("PRODUCT_VIEW"),
    cartAdders: distinct("ADD_TO_CART"),
    checkoutStarters: distinct("CHECKOUT_START"),
  };
}

/** GROUP BY the Cairo day of createdAt (AT TIME ZONE STORE_TZ), COUNT(DISTINCT visitorId). */
function sqlDailyRows(events: Event[], start: Date): DailyVisitorRow[] {
  const byDay = new Map<string, Set<string>>();
  for (const e of events.filter((x) => x.createdAt >= start)) {
    const day = storeDayKey(e.createdAt);
    byDay.set(day, (byDay.get(day) ?? new Set()).add(e.visitorId));
  }
  return [...byDay].map(([day, ids]) => ({ day, visitors: ids.size }));
}

/** The whole new path for one window, as getVisitorFunnel runs it. */
function viaSql(events: Event[], orders: number, days: number, now: Date) {
  const monthStart = storeMidnight(30 - 1, now); // the daily read always spans the 30-day window
  const start = storeMidnight(days - 1, now);
  return buildVisitorSummary(sqlWindowCounts(events, start), orders, sqlDailyRows(events, monthStart), days, now);
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const FIXTURES: Record<string, { events: Event[]; orders: number; now: Date }> = {
  "repeat views + a full funnel": {
    now: NOW,
    orders: 1,
    events: [
      ev("a", "VIEW"),
      ev("a", "VIEW"),
      ev("a", "VIEW"),
      ev("b", "VIEW"),
      ev("a", "PRODUCT_VIEW"),
      ev("a", "PRODUCT_VIEW"),
      ev("b", "PRODUCT_VIEW"),
      ev("a", "ADD_TO_CART"),
      ev("a", "CHECKOUT_START"),
    ],
  },
  "orders exceed checkout (repeat buyer / blocked tracker)": {
    now: NOW,
    orders: 5,
    events: [ev("a", "VIEW"), ev("a", "CHECKOUT_START")],
  },
  empty: { now: NOW, orders: 0, events: [] },
  "Cairo midnight boundary (22:00Z is the next Cairo day)": {
    now: NOW,
    orders: 0,
    events: [
      ev("late", "VIEW", "2026-10-31T21:59:00Z"), // Oct 31 in Cairo
      ev("early", "VIEW", "2026-10-31T22:01:00Z"), // Nov 1 in Cairo
      ev("both", "VIEW", "2026-10-31T21:00:00Z"),
      ev("both", "VIEW", "2026-11-01T08:00:00Z"),
    ],
  },
  "across the DST change (Oct 29–30, UTC+3 → UTC+2)": {
    now: NOW,
    orders: 2,
    events: [
      ev("x", "VIEW", "2026-10-29T20:30:00Z"), // 23:30 Oct 29 Cairo (still UTC+3)
      ev("x", "VIEW", "2026-10-29T21:30:00Z"), // after the change
      ev("y", "PRODUCT_VIEW", "2026-10-30T21:59:00Z"),
      ev("y", "ADD_TO_CART", "2026-10-30T22:00:00Z"),
    ],
  },
  "outside the window + inside the month only": {
    now: NOW,
    orders: 3,
    events: [
      ev("old", "VIEW", "2026-09-01T08:00:00Z"), // outside both windows
      ev("mid", "VIEW", "2026-10-15T08:00:00Z"), // in the month, not the week
      ev("mid", "PRODUCT_VIEW", "2026-10-15T08:05:00Z"),
      ev("new", "VIEW", "2026-10-31T08:00:00Z"),
    ],
  },
};

// ═════════════════════════════════════════════════════════════════════════════

describe("SQL rollup → buildVisitorSummary matches the old in-memory result exactly", () => {
  for (const [name, { events, orders, now }] of Object.entries(FIXTURES)) {
    for (const days of [7, 30]) {
      it(`${name} — ${days}-day window`, () => {
        // The reference only ever saw the window's events (the old loader filtered first).
        const windowEvents = events.filter((e) => e.createdAt >= storeMidnight(days - 1, now));
        expect(viaSql(events, orders, days, now)).toEqual(referenceSummarize(windowEvents, orders, days, now));
      });
    }
  }
});

describe("buildVisitorSummary — unique vs total", () => {
  it("counts page views in full but each funnel step by distinct visitor", () => {
    const summary = viaSql(FIXTURES["repeat views + a full funnel"].events, 1, 7, NOW);
    expect(summary.uniqueVisitors).toBe(2);
    expect(summary.pageViews).toBe(4);
    expect(summary.steps.map((s) => [s.key, s.count])).toEqual([
      ["visitors", 2],
      ["productViews", 2],
      ["addToCart", 1],
      ["checkout", 1],
      ["orders", 1],
    ]);
  });

  it("an empty window is all zeros with a full series", () => {
    const summary = buildVisitorSummary(
      { uniqueVisitors: 0, pageViews: 0, productViewers: 0, cartAdders: 0, checkoutStarters: 0 },
      0,
      [],
      7,
      NOW,
    );
    expect(summary.steps.every((s) => s.count === 0 && s.dropOff === null)).toBe(true);
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

describe("dailyVisitorSeries — Cairo days from the SQL's per-day rows", () => {
  it("lays the last N Cairo days out oldest → newest, today last, labelled to match the key", () => {
    const series = dailyVisitorSeries([{ day: "2026-11-01", visitors: 4 }], 3, NOW);
    expect(series.map((d) => d.key)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(series.map((d) => d.date)).toEqual(["30 Oct", "31 Oct", "01 Nov"]);
    expect(series.map((d) => d.visitors)).toEqual([0, 0, 4]);
  });

  it("uses the CAIRO day for 'today' even when UTC is still on the previous date", () => {
    // 23:30Z on Oct 31 is already 01:30 on Nov 1 in Cairo.
    const series = dailyVisitorSeries([], 3, new Date("2026-10-31T23:30:00Z"));
    expect(series.at(-1)!.key).toBe("2026-11-01");
  });

  it("ignores rows outside the range (the week reuses the 30-day read)", () => {
    const series = dailyVisitorSeries([{ day: "2026-10-01", visitors: 9 }], 7, NOW);
    expect(series.every((d) => d.visitors === 0)).toBe(true);
  });
});
