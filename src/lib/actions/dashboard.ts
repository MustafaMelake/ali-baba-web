// ─────────────────────────────────────────────────────────────────────────────
// Dashboard data loaders — strict Branch-Manager RBAC.
//
// These are SERVER-ONLY async functions consumed by the /admin Server
// Components (they read the session via headers()). They are intentionally NOT
// "use server" actions: they only READ, return rich objects, and never need to
// be exposed as POST endpoints.
//
// Authorization model (see requireDashboardAccess / resolveBranchScope):
//   - ADMIN   → unrestricted; may optionally target one branch via params.
//   - MANAGER → hard-pinned to their own branch. Every order query is filtered
//     by { branchId }, and requesting any OTHER branch throws Unauthorized.
//
// Products & customers are global concepts in this schema (no branchId), so
// those metrics stay store-wide for everyone; only ORDER/revenue data is scoped.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import {
  requireDashboardAccess,
  resolveBranchScope,
} from "@/lib/session";
import { OrderStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { formatDate, formatDateTime } from "@/lib/utils";
import { storeDayKey, storeDayParts, storeMidnight } from "@/lib/timezone";
import type { AdminOrderView } from "@/components/admin/order-types";
import type { TabValue } from "@/components/admin/AdminOrderFilters";

const CHART_DAYS = 30;

export type RevenuePoint = { date: string; revenue: number };

export type DashboardStats = {
  /** Who is looking and at what slice — lets the UI label the scope. */
  scope: { role: "ADMIN" | "MANAGER"; branchId: string | null; branchName: string | null };
  totalRevenue: number;
  revenueLast30: number;
  revenuePrev30: number;
  ordersToday: number;
  ordersYesterday: number;
  activeProducts: number;
  newProducts30: number;
  customers: number;
  newCustomers30: number;
  recentOrders: {
    id: string;
    orderNumber: number;
    customerName: string;
    totalAmount: number;
    status: OrderStatus;
    createdAt: Date;
  }[];
  chartData: RevenuePoint[];
};

/**
 * Dashboard summary metrics, revenue chart series and recent orders — scoped to
 * the caller's branch (ADMIN sees all branches, or one if `params.branchId` is
 * given; a MANAGER is forced to their own and rejected if they ask for another).
 */
export async function getDashboardStats(
  params?: { branchId?: string },
): Promise<DashboardStats> {
  const scope = await requireDashboardAccess();
  const branchId = resolveBranchScope(scope, params?.branchId);

  // The single source of branch scoping for every order query below.
  // `{}` (when branchId is undefined) = unrestricted, i.e. an ADMIN seeing all.
  const branchWhere: Prisma.OrderWhereInput = branchId ? { branchId } : {};

  // ── Time windows — Africa/Cairo calendar days, as exact UTC instants ──
  // Never the server's local midnight: the deployment region must not decide
  // when "today" starts. storeMidnight does DST-safe calendar arithmetic and
  // matches the raw-SQL `AT TIME ZONE` bucketing in analytics.ts.
  const now = new Date();
  const todayStart = storeMidnight(0, now);
  const yesterdayStart = storeMidnight(1, now);
  const last30Start = storeMidnight(CHART_DAYS - 1, now);
  const prev30Start = storeMidnight(CHART_DAYS * 2 - 1, now);

  // REVENUE business rule (formalized): money strictly counts DELIVERED
  // orders — unconfirmed PENDING/PREPARING/SHIPPED cash is never reported as
  // revenue. Order-VOLUME counters (today/yesterday) stay status-agnostic.
  const deliveredOnly: Prisma.OrderWhereInput = {
    status: OrderStatus.DELIVERED,
  };

  const [
    revenueAllTime,
    revenueLast30,
    revenuePrev30,
    ordersToday,
    ordersYesterday,
    activeProducts,
    newProducts30,
    customers,
    newCustomers30,
    recentOrders,
    chartOrders,
    branch,
  ] = await Promise.all([
    prisma.order.aggregate({
      _sum: { totalAmount: true },
      where: { ...branchWhere, ...deliveredOnly },
    }),
    prisma.order.aggregate({
      _sum: { totalAmount: true },
      where: { ...branchWhere, ...deliveredOnly, createdAt: { gte: last30Start } },
    }),
    prisma.order.aggregate({
      _sum: { totalAmount: true },
      where: {
        ...branchWhere,
        ...deliveredOnly,
        createdAt: { gte: prev30Start, lt: last30Start },
      },
    }),
    prisma.order.count({
      where: { ...branchWhere, createdAt: { gte: todayStart } },
    }),
    prisma.order.count({
      where: { ...branchWhere, createdAt: { gte: yesterdayStart, lt: todayStart } },
    }),
    // Products & customers have no branchId — these stay store-wide for everyone.
    prisma.product.count({ where: { isAvailable: true } }),
    prisma.product.count({ where: { createdAt: { gte: last30Start } } }),
    prisma.user.count({ where: { role: "USER" } }),
    prisma.user.count({ where: { role: "USER", createdAt: { gte: last30Start } } }),
    prisma.order.findMany({
      where: branchWhere,
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        orderNumber: true,
        customerName: true,
        totalAmount: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.order.findMany({
      where: { ...branchWhere, ...deliveredOnly, createdAt: { gte: last30Start } },
      select: { createdAt: true, totalAmount: true },
    }),
    // Resolve the branch name for the UI label (only when scoped to one branch).
    branchId
      ? prisma.branch.findUnique({ where: { id: branchId }, select: { name: true } })
      : Promise.resolve(null),
  ]);

  // ── Chart series: revenue bucketed into the last 30 CAIRO calendar days ──
  // Buckets are built in calendar space (DST-free) and each order is keyed by
  // its createdAt's Cairo day, so a 23h/25h DST day can never split or merge a
  // bucket. Carrier dates are UTC-midnight encodings of Cairo calendar days —
  // formatted with timeZone "UTC" so the label always matches the key.
  const labelFmt = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
  const { year, month, day } = storeDayParts(now);
  const indexByKey = new Map<string, number>();
  const chartData: RevenuePoint[] = [];
  for (let i = 0; i < CHART_DAYS; i++) {
    const carrier = new Date(Date.UTC(year, month - 1, day - (CHART_DAYS - 1 - i)));
    indexByKey.set(carrier.toISOString().slice(0, 10), i);
    chartData.push({ date: labelFmt.format(carrier), revenue: 0 });
  }
  for (const order of chartOrders) {
    const idx = indexByKey.get(storeDayKey(order.createdAt));
    // totalAmount is a Decimal money column — coerce before summing.
    if (idx != null) chartData[idx].revenue += order.totalAmount.toNumber();
  }

  return {
    scope: {
      role: scope.role,
      branchId: branchId ?? null,
      branchName: branch?.name ?? null,
    },
    // _sum over a Decimal column returns Decimal | null → coerce to number.
    totalRevenue: revenueAllTime._sum.totalAmount?.toNumber() ?? 0,
    revenueLast30: revenueLast30._sum.totalAmount?.toNumber() ?? 0,
    revenuePrev30: revenuePrev30._sum.totalAmount?.toNumber() ?? 0,
    ordersToday,
    ordersYesterday,
    activeProducts,
    newProducts30,
    customers,
    newCustomers30,
    // Serialize each recent order's Decimal total to a plain number.
    recentOrders: recentOrders.map((o) => ({
      ...o,
      totalAmount: o.totalAmount.toNumber(),
    })),
    chartData,
  };
}

/** Rows per admin orders page — bounds both the RSC payload and the pager math. */
export const ORDERS_PAGE_SIZE = 50;

export type GetOrdersParams = {
  branchId?: string;
  /** Omit / undefined = all statuses. */
  status?: OrderStatus;
  query?: string;
  /**
   * Order id to continue from (exclusive) — the previous payload's `endCursor`
   * (walking next/older) or `startCursor` (walking prev/newer). Omit for the
   * newest (first) page.
   */
  cursor?: string;
  /** "next" walks toward OLDER orders, "prev" back toward newer. Default "next". */
  direction?: "next" | "prev";
};

export type GetOrdersResult = {
  orders: AdminOrderView[];
  counts: Record<TabValue, number>;
  pageSize: number;
  /** Total rows matching the ACTIVE filter (status + search + branch scope). */
  total: number;
  /** True when OLDER orders exist beyond this page — drives "Next". */
  hasMore: boolean;
  /** True when NEWER orders exist before this page — drives "Previous". */
  hasPrevious: boolean;
  /** First row's id — pass as `cursor` with direction "prev". Null on an empty page. */
  startCursor: string | null;
  /** Last row's id — pass as `cursor` with direction "next". Null on an empty page. */
  endCursor: string | null;
};

/**
 * Branch-scoped orders list + per-status counters for the admin orders board.
 * Same search/filter behaviour as before, with the caller's branch ANDed into
 * every query so a MANAGER physically cannot read another branch's orders.
 * The list is CURSOR-paginated (newest first, ORDERS_PAGE_SIZE per page): the
 * client passes a row id back as `cursor` — the last row's id to walk older
 * orders ("next"), or the first row's id with direction "prev" to walk back.
 * There is no offset `skip`, so the cost of fetching a page is independent of
 * how deep it sits in the list. The active filter's total still falls out of
 * the same groupBy that feeds the tab counters — pagination adds no query.
 */
export async function getOrders(
  params?: GetOrdersParams,
): Promise<GetOrdersResult> {
  const scope = await requireDashboardAccess();
  const branchId = resolveBranchScope(scope, params?.branchId);
  const branchWhere: Prisma.OrderWhereInput = branchId ? { branchId } : {};

  // Cursor state. An unknown direction collapses to "next"; a blank cursor to
  // the first page ("prev" without a cursor is meaningless → first page too).
  const direction: "next" | "prev" =
    params?.direction === "prev" ? "prev" : "next";
  const cursorId = params?.cursor?.trim() || undefined;

  const q = params?.query?.trim() ?? "";

  // Order # is an Int column, so Prisma can't `contains` on it directly —
  // a raw ::text cast lets staff search "100" and match order #10024. Candidate
  // ids may span branches, but branchWhere is ANDed at the top level below, so a
  // manager can never surface another branch's order this way.
  const numericOrderIds =
    q && /\d/.test(q)
      ? (
          await prisma.$queryRaw<{ id: string }[]>`
            SELECT id FROM "Order" WHERE "orderNumber"::text ILIKE ${`%${q}%`}
          `
        ).map((row) => row.id)
      : [];

  const searchWhere: Prisma.OrderWhereInput = q
    ? {
        OR: [
          { customerName: { contains: q, mode: "insensitive" } },
          { customerPhone: { contains: q } },
          ...(numericOrderIds.length ? [{ id: { in: numericOrderIds } }] : []),
        ],
      }
    : {};

  // Branch scope is ANDed into BOTH the list and the counters so every number
  // the manager sees belongs to their branch.
  const scopedSearch: Prisma.OrderWhereInput = { ...branchWhere, ...searchWhere };
  const listWhere: Prisma.OrderWhereInput = {
    ...scopedSearch,
    ...(params?.status ? { status: params.status } : {}),
  };

  // One sentinel row past the page detects whether the walk can continue. A
  // NEGATIVE take fetches the rows BEFORE the cursor (Prisma walks backwards
  // from its position) while preserving the orderBy order — that is the whole
  // "prev" mechanism; there is no offset arithmetic in either direction.
  const take =
    (ORDERS_PAGE_SIZE + 1) * (direction === "prev" && cursorId ? -1 : 1);

  const [rows, grouped] = await Promise.all([
    prisma.order.findMany({
      where: listWhere,
      // Deterministic compound order: `id` breaks createdAt ties, so every row
      // is a unique cursor position and same-timestamp rows can never be
      // skipped or repeated across page boundaries.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      // skip: 1 excludes the cursor row itself — the client already has it.
      // A cursor whose row no longer exists yields an empty page; the pager's
      // "Previous" recovers to the canonical first page in that case.
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      take,
      include: {
        user: { select: { email: true } },
        branch: { select: { name: true } },
        items: {
          select: {
            id: true,
            productName: true,
            variantName: true,
            unitPrice: true,
            quantity: true,
          },
        },
      },
    }),
    prisma.order.groupBy({
      by: ["status"],
      where: scopedSearch,
      _count: { _all: true },
    }),
  ]);

  // Per-status counters (+ ALL total) for the tab bar.
  const counts: Record<TabValue, number> = {
    ALL: 0,
    PENDING: 0,
    PREPARING: 0,
    SHIPPED: 0,
    DELIVERED: 0,
    CANCELLED: 0,
  };
  for (const g of grouped) {
    counts[g.status] = g._count._all;
    counts.ALL += g._count._all;
  }

  // Total for the ACTIVE filter, read off the counters above — the groupBy
  // ignores the status filter by design (it feeds every tab), so the list's
  // total is simply the active tab's counter.
  const total = params?.status ? counts[params.status] : counts.ALL;

  // Trim the sentinel row and derive both edges' reachability.
  let pageRows = rows;
  let hasMore: boolean;
  let hasPrevious: boolean;
  if (take < 0) {
    // Walking prev: the sentinel (when present) is the FIRST array element —
    // the newest row beyond this page.
    hasPrevious = rows.length > ORDERS_PAGE_SIZE;
    if (hasPrevious) pageRows = rows.slice(1);
    // We navigated back FROM the cursor row, so it (and everything older)
    // still lies ahead of this page.
    hasMore = true;
  } else {
    hasMore = rows.length > ORDERS_PAGE_SIZE;
    if (hasMore) pageRows = rows.slice(0, ORDERS_PAGE_SIZE);
    // Rows before this page exist exactly when we arrived here via a cursor.
    hasPrevious = cursorId != null;
  }

  // Serialize for the client table/drawer; VAT is the residual so receipts
  // reconcile to the canonical totalAmount.
  const view: AdminOrderView[] = pageRows.map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    dateLabel: formatDate(order.createdAt),
    dateTimeLabel: formatDateTime(order.createdAt),
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    orderNotes: order.orderNotes,
    fulfillment: order.fulfillment,
    deliveryCity: order.deliveryCity,
    addressLine: order.addressLine,
    pickupBranch: order.pickupBranch,
    // Money columns are Decimal — coerce every one to a number for the client
    // table/drawer. VAT is the residual, so all three operands convert first.
    subtotal: order.subtotal.toNumber(),
    vat: Math.max(
      0,
      order.totalAmount.toNumber() -
        order.subtotal.toNumber() -
        order.deliveryFee.toNumber(),
    ),
    deliveryFee: order.deliveryFee.toNumber(),
    totalAmount: order.totalAmount.toNumber(),
    itemCount: order.items.reduce((n, it) => n + it.quantity, 0),
    items: order.items.map((it) => ({
      id: it.id,
      productName: it.productName,
      variantName: it.variantName,
      quantity: it.quantity,
      unitPrice: it.unitPrice.toNumber(),
      lineTotal: it.unitPrice.toNumber() * it.quantity,
    })),
    userEmail: order.user?.email ?? null,
    branchName: order.branch?.name ?? null,
  }));

  return {
    orders: view,
    counts,
    pageSize: ORDERS_PAGE_SIZE,
    total,
    hasMore,
    hasPrevious,
    startCursor: pageRows[0]?.id ?? null,
    endCursor: pageRows[pageRows.length - 1]?.id ?? null,
  };
}
