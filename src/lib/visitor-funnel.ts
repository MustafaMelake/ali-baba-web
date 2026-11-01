// ─────────────────────────────────────────────────────────────────────────────
// Visitor funnel math — pure, dependency-free (no Prisma, no React).
//
// Turns the VisitEvent rows of one window into the dashboard card's figures:
// unique visitors, page views, the funnel visitors → product views →
// add-to-cart → checkout → orders with the drop-off between steps, and a
// daily-unique-visitors series bucketed by CAIRO calendar day (timezone.ts —
// the same store day revenue uses, never the server's clock).
//
// Every funnel step except the last counts DISTINCT visitors, so a shopper who
// views ten products is one product viewer. The last step is the real order
// count (orders carry no visitor id), so it can exceed the checkout step —
// e.g. a repeat buyer, or a browser that blocks the tracker. Drop-off is
// therefore floored at 0 rather than shown as a negative.
// ─────────────────────────────────────────────────────────────────────────────

import { storeDayKey, storeDayParts } from "@/lib/timezone";

/** The tracker's event types — mirrors the VisitEventType enum's values. */
export type FunnelEventType = "VIEW" | "PRODUCT_VIEW" | "ADD_TO_CART" | "CHECKOUT_START";

export type FunnelEvent = { type: FunnelEventType; visitorId: string; createdAt: Date };

export const FUNNEL_STEP_KEYS = ["visitors", "productViews", "addToCart", "checkout", "orders"] as const;
export type FunnelStepKey = (typeof FUNNEL_STEP_KEYS)[number];

export type FunnelStep = {
  key: FunnelStepKey;
  count: number;
  /** Share of the PREVIOUS step lost before this one, 0–100 (1 dp). Null on the first step or after an empty step. */
  dropOff: number | null;
};

export type DailyVisitors = {
  /** Cairo calendar day, "YYYY-MM-DD". */
  key: string;
  /** Short axis label, e.g. "01 Nov". */
  date: string;
  visitors: number;
};

export type VisitorSummary = {
  uniqueVisitors: number;
  /** Every VIEW event — total page loads, repeats included. */
  pageViews: number;
  steps: FunnelStep[];
  daily: DailyVisitors[];
};

/** Percentage (1 dp) of `prev` that didn't make it to `count`; floored at 0. */
export function dropOffPercent(prev: number, count: number): number | null {
  if (prev <= 0) return null;
  const lost = Math.max(0, prev - count);
  return Math.round((lost / prev) * 1000) / 10;
}

/** The funnel from per-step counts (in FUNNEL_STEP_KEYS order). */
export function funnelSteps(counts: Record<FunnelStepKey, number>): FunnelStep[] {
  return FUNNEL_STEP_KEYS.map((key, i) => ({
    key,
    count: counts[key],
    dropOff: i === 0 ? null : dropOffPercent(counts[FUNNEL_STEP_KEYS[i - 1]], counts[key]),
  }));
}

const labelFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});

/**
 * Distinct visitors per Cairo calendar day for the `days` days ending today.
 * Buckets are built in calendar space (as the revenue chart does) and each
 * event is keyed by its createdAt's Cairo day, so a DST day can't split or
 * merge a bucket. A visitor active on two days counts on both.
 */
export function dailyUniqueVisitors(events: FunnelEvent[], days: number, now: Date): DailyVisitors[] {
  const { year, month, day } = storeDayParts(now);
  const series: DailyVisitors[] = [];
  const buckets = new Map<string, Set<string>>();
  for (let i = 0; i < days; i++) {
    // UTC-midnight carrier of the Cairo calendar day — formatted in UTC so the label matches the key.
    const carrier = new Date(Date.UTC(year, month - 1, day - (days - 1 - i)));
    const key = carrier.toISOString().slice(0, 10);
    buckets.set(key, new Set());
    series.push({ key, date: labelFmt.format(carrier), visitors: 0 });
  }
  for (const e of events) buckets.get(storeDayKey(e.createdAt))?.add(e.visitorId);
  for (const point of series) point.visitors = buckets.get(point.key)!.size;
  return series;
}

/**
 * The card's figures for one window. `events` must already be limited to the
 * window (and to the caller's branch scope); `orders` is the window's real
 * order count from the same scope.
 */
export function summarizeVisits(
  events: FunnelEvent[],
  orders: number,
  days: number,
  now: Date,
): VisitorSummary {
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
    daily: dailyUniqueVisitors(events, days, now),
  };
}
