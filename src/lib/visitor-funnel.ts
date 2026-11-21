// ─────────────────────────────────────────────────────────────────────────────
// Visitor funnel math — pure, dependency-free (no Prisma, no React).
//
// Turns one window's SQL rollup of VisitEvent (getVisitorFunnel in
// dashboard.ts — grouped COUNT / COUNT DISTINCT, never raw rows in memory)
// into the dashboard card's figures: unique visitors, page views, the funnel
// visitors → product views → add-to-cart → checkout → orders with the
// drop-off between steps, and a daily-unique-visitors series on CAIRO
// calendar days (timezone.ts — the same store day revenue uses, never the
// server's clock).
//
// Every funnel step except the last counts DISTINCT visitors, so a shopper who
// views ten products is one product viewer. The last step is the real order
// count (orders carry no visitor id), so it can exceed the checkout step —
// e.g. a repeat buyer, or a browser that blocks the tracker. Drop-off is
// therefore floored at 0 rather than shown as a negative.
// ─────────────────────────────────────────────────────────────────────────────

import { storeDayParts } from "@/lib/timezone";

/** The tracker's event types — mirrors the VisitEventType enum's values. */
export type FunnelEventType = "VIEW" | "PRODUCT_VIEW" | "ADD_TO_CART" | "CHECKOUT_START";

/**
 * One window's rollup as the SQL returns it. Each count but `pageViews` is a
 * COUNT(DISTINCT visitorId) over the window — distinct counts can't be summed
 * across days, so the window figures come from their own aggregate.
 */
export type VisitWindowCounts = {
  /** Distinct visitors with any event. */
  uniqueVisitors: number;
  /** Every VIEW event — total page loads, repeats included. */
  pageViews: number;
  /** Distinct visitors with a PRODUCT_VIEW / ADD_TO_CART / CHECKOUT_START. */
  productViewers: number;
  cartAdders: number;
  checkoutStarters: number;
};

/** Distinct visitors on one Cairo calendar day ("YYYY-MM-DD"), as the SQL groups them. */
export type DailyVisitorRow = { day: string; visitors: number };

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
 * The daily series for the `days` Cairo calendar days ending today, from the
 * SQL's per-day rows. Buckets are built in calendar space (as the revenue
 * chart does), so a DST day can't split or merge one; a day with no row is 0,
 * and a row outside the range (an older day of a wider read) is ignored. A
 * visitor active on two days counts on both.
 */
export function dailyVisitorSeries(rows: DailyVisitorRow[], days: number, now: Date): DailyVisitors[] {
  const byDay = new Map(rows.map((r) => [r.day, r.visitors]));
  const { year, month, day } = storeDayParts(now);
  const series: DailyVisitors[] = [];
  for (let i = 0; i < days; i++) {
    // UTC-midnight carrier of the Cairo calendar day — formatted in UTC so the label matches the key.
    const carrier = new Date(Date.UTC(year, month - 1, day - (days - 1 - i)));
    const key = carrier.toISOString().slice(0, 10);
    series.push({ key, date: labelFmt.format(carrier), visitors: byDay.get(key) ?? 0 });
  }
  return series;
}

/**
 * The card's figures for one window: its SQL rollup (already limited to the
 * window and the caller's branch scope), the window's real order count from
 * the same scope, and the per-day rows.
 */
export function buildVisitorSummary(
  counts: VisitWindowCounts,
  orders: number,
  dailyRows: DailyVisitorRow[],
  days: number,
  now: Date,
): VisitorSummary {
  return {
    uniqueVisitors: counts.uniqueVisitors,
    pageViews: counts.pageViews,
    steps: funnelSteps({
      visitors: counts.uniqueVisitors,
      productViews: counts.productViewers,
      addToCart: counts.cartAdders,
      checkout: counts.checkoutStarters,
      orders,
    }),
    daily: dailyVisitorSeries(dailyRows, days, now),
  };
}
