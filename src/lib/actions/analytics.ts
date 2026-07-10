// ─────────────────────────────────────────────────────────────────────────────
// Advanced Analytics loader — Super-Admin only.
//
// A SERVER-ONLY async loader (like getDashboardStats): it READS, returns a rich
// plain object, and is consumed by the /admin/analytics Server Component. It is
// deliberately ADMIN-only (requireAdmin throws for everyone else) — branch
// managers see their own dashboard, not the cross-branch comparison.
//
// Every metric is computed in the DATABASE — `groupBy` aggregations and a couple
// of grouped `$queryRaw` rollups — so we never pull raw order rows into Node.
// The four datasets returned:
//   1. branchSales  — total revenue + order count per active branch.
//   2. peakHours    — orders-per-hour-of-day per branch (Africa/Cairo wall clock).
//   3. topProducts  — top-3 selling items per branch (by units sold).
//   4. star         — best branch by revenue for the current calendar month.
//
// REVENUE figures (branch sales, star of the month, top products) strictly
// count DELIVERED orders — the formalized business rule shared with the
// dashboard: money that hasn't been delivered is never reported as revenue.
// The volume-only peak-hours chart excludes just CANCELLED.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { OrderStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { branchColor } from "@/lib/analytics-palette";
// All wall-clock bucketing (peak hours, month windows) uses the shared store
// timezone — the same constant dashboard.ts converts its day boundaries with.
import { STORE_TZ, storeMonthStart } from "@/lib/timezone";

// ── Public result shape ──────────────────────────────────────────────────────

export type BranchSales = {
  branchId: string;
  name: string;
  color: string;
  revenue: number;
  orders: number;
};

/** One x-axis point (an hour of the day) carrying a column per branch. */
export type PeakHourPoint = {
  hour: number; // 0–23
  label: string; // "9 AM"
  // Plus one numeric key per branch NAME — the order count in that hour.
  [branchName: string]: number | string;
};

export type PeakHours = {
  /** Branch series metadata for the chart legend + line colours. */
  branches: { name: string; color: string }[];
  series: PeakHourPoint[];
};

export type TopProduct = {
  name: string;
  quantity: number;
  revenue: number;
};

export type BranchTopProducts = {
  branchId: string;
  branchName: string;
  color: string;
  /** Units sold across all of this branch's top products (for the share bars). */
  totalUnits: number;
  products: TopProduct[];
};

export type StarBranch = {
  name: string;
  color: string;
  revenue: number;
  orders: number;
  /** Share of the whole month's revenue, 0–1. */
  share: number;
};

export type AnalyticsData = {
  branchSales: BranchSales[];
  peakHours: PeakHours;
  topProducts: BranchTopProducts[];
  star: StarBranch | null;
  monthLabel: string;
  generatedAt: string;
};

// ── Raw-query row shapes (columns are cast to int/float8 in SQL so the pg
//    driver hands us plain numbers, never BigInt) ─────────────────────────────

type PeakRow = { branchId: string; hour: number; orders: number };
type TopRow = {
  branchId: string;
  productName: string;
  quantity: number;
  revenue: number;
};

/** 0 → "12 AM", 9 → "9 AM", 13 → "1 PM", 23 → "11 PM". */
function hourLabel(h: number): string {
  const period = h < 12 ? "AM" : "PM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${period}`;
}

/**
 * Cross-branch analytics for the Super-Admin dashboard. ADMIN-only — throws for
 * managers/users (the page also redirects them via requireAdminPage).
 */
export async function getAnalytics(): Promise<AnalyticsData> {
  await requireAdmin();

  // Every dataset aggregates only branch-attached orders. REVENUE datasets
  // (branch sales, star of the month, top products) strictly count DELIVERED
  // orders — the formalized business rule. The pure-VOLUME dataset (peak
  // hours) keeps the broader not-CANCELLED filter in its raw SQL, since it
  // measures activity, not money.
  const revenueScoped: Prisma.OrderWhereInput = {
    branchId: { not: null },
    status: OrderStatus.DELIVERED,
  };

  const now = new Date();
  // Cairo calendar month as an exact UTC instant — never the server's local
  // month boundary (which drifts with the deployment region).
  const monthStart = storeMonthStart(now);
  // Peak Hours only looks at recent activity so old test/seed data (e.g. odd
  // 2 AM spikes) can't distort the current customer-behaviour chart.
  const peakWindowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const monthLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: STORE_TZ, // label the CAIRO month, matching monthStart above
  }).format(now);

  const [activeBranches, salesGrouped, monthGrouped, peakRows, topRows] =
    await Promise.all([
      // Active branches drive every series (so a zero-order branch still shows).
      prisma.branch.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),

      // (1) All-time DELIVERED revenue + delivered-order count per branch.
      // The count rides the same groupBy, so this chart's "orders" figure is
      // delivered orders — consistent with the revenue beside it.
      prisma.order.groupBy({
        by: ["branchId"],
        where: revenueScoped,
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),

      // (4) This-Cairo-month DELIVERED revenue + count ("Star of the Month").
      prisma.order.groupBy({
        by: ["branchId"],
        where: { ...revenueScoped, createdAt: { gte: monthStart } },
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),

      // (2) Orders bucketed by branch × hour-of-day, in store-local time.
      // Pure VOLUME (not money) — deliberately keeps the broader
      // not-CANCELLED filter; every active order counts as activity. The
      // createdAt column is a UTC `timestamp`; reinterpret it as UTC then convert
      // to Cairo wall-clock before extracting the hour. COUNT(*) is bigint, so we
      // cast everything to int4 to avoid BigInt serialization. Scoped to the last
      // 30 days (peakWindowStart, bound as a parameter — not string-interpolated)
      // so stale seed/test orders can't skew the current-behaviour chart.
      prisma.$queryRaw<PeakRow[]>`
        SELECT
          "branchId",
          EXTRACT(HOUR FROM "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${STORE_TZ})::int AS hour,
          COUNT(*)::int AS orders
        FROM "Order"
        WHERE "branchId" IS NOT NULL AND "status" <> 'CANCELLED' AND "createdAt" >= ${peakWindowStart}
        GROUP BY "branchId", hour
      `,

      // (3) Units sold + revenue per branch × product — DELIVERED orders only
      // (this dataset reports money, so it follows the strict revenue rule).
      // We join OrderItem→Order to reach branchId (OrderItem has no branch of
      // its own) and roll up in SQL, ordered so the top sellers land first;
      // we slice top-3 per branch in JS.
      prisma.$queryRaw<TopRow[]>`
        SELECT
          o."branchId"            AS "branchId",
          oi."productName"        AS "productName",
          SUM(oi."quantity")::int AS quantity,
          SUM(oi."quantity" * oi."unitPrice")::float8 AS revenue
        FROM "OrderItem" oi
        JOIN "Order" o ON o."id" = oi."orderId"
        WHERE o."branchId" IS NOT NULL AND o."status" = 'DELIVERED'
        GROUP BY o."branchId", oi."productName"
        ORDER BY quantity DESC
      `,
    ]);

  // Stable colour per branch (name-sorted order) so every chart agrees.
  const colorByBranchId = new Map<string, string>();
  activeBranches.forEach((b, i) => colorByBranchId.set(b.id, branchColor(i)));
  const colorOf = (id: string) => colorByBranchId.get(id) ?? branchColor(0);

  // ── (1) Branch sales comparison ───────────────────────────────────────────
  const salesById = new Map(salesGrouped.map((g) => [g.branchId, g]));
  const branchSales: BranchSales[] = activeBranches
    .map((b) => {
      const g = salesById.get(b.id);
      return {
        branchId: b.id,
        name: b.name,
        color: colorOf(b.id),
        // _sum over a Decimal money column → coerce to number.
        revenue: g?._sum.totalAmount?.toNumber() ?? 0,
        orders: g?._count._all ?? 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  // ── (2) Peak hours: pivot branch×hour rows into one row per hour ──────────
  const peakByKey = new Map<string, number>();
  let minHour = 24;
  let maxHour = -1;
  for (const r of peakRows) {
    peakByKey.set(`${r.branchId}:${r.hour}`, r.orders);
    if (r.orders > 0) {
      if (r.hour < minHour) minHour = r.hour;
      if (r.hour > maxHour) maxHour = r.hour;
    }
  }
  // Trim the axis to the active trading window; fall back to a sensible default
  // (8 AM–11 PM) when there's no data yet so the chart isn't empty.
  if (maxHour < minHour) {
    minHour = 8;
    maxHour = 23;
  }

  const peakSeries: PeakHourPoint[] = [];
  for (let h = minHour; h <= maxHour; h++) {
    const point: PeakHourPoint = { hour: h, label: hourLabel(h) };
    for (const b of activeBranches) {
      point[b.name] = peakByKey.get(`${b.id}:${h}`) ?? 0;
    }
    peakSeries.push(point);
  }

  const peakHours: PeakHours = {
    branches: activeBranches.map((b) => ({ name: b.name, color: colorOf(b.id) })),
    series: peakSeries,
  };

  // ── (3) Top-3 products per branch ─────────────────────────────────────────
  const productsByBranch = new Map<string, TopProduct[]>();
  for (const r of topRows) {
    const list = productsByBranch.get(r.branchId) ?? [];
    list.push({ name: r.productName, quantity: r.quantity, revenue: r.revenue });
    productsByBranch.set(r.branchId, list);
  }
  const topProducts: BranchTopProducts[] = activeBranches.map((b) => {
    const products = (productsByBranch.get(b.id) ?? [])
      .sort((a, c) => c.quantity - a.quantity)
      .slice(0, 3);
    return {
      branchId: b.id,
      branchName: b.name,
      color: colorOf(b.id),
      totalUnits: products.reduce((n, p) => n + p.quantity, 0),
      products,
    };
  });

  // ── (4) Star of the month: highest-revenue branch this calendar month ─────
  const monthById = new Map(monthGrouped.map((g) => [g.branchId, g]));
  const monthTotal = monthGrouped.reduce(
    (sum, g) => sum + (g._sum.totalAmount?.toNumber() ?? 0),
    0,
  );
  let star: StarBranch | null = null;
  for (const b of activeBranches) {
    const revenue = monthById.get(b.id)?._sum.totalAmount?.toNumber() ?? 0;
    if (revenue > (star?.revenue ?? 0)) {
      star = {
        name: b.name,
        color: colorOf(b.id),
        revenue,
        orders: monthById.get(b.id)?._count._all ?? 0,
        share: monthTotal > 0 ? revenue / monthTotal : 0,
      };
    }
  }

  return {
    branchSales,
    peakHours,
    topProducts,
    star,
    monthLabel,
    generatedAt: now.toISOString(),
  };
}
