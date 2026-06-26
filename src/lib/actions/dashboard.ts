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
import type { AdminOrderView } from "@/components/admin/order-types";
import type { TabValue } from "@/components/admin/AdminOrderFilters";

const DAY_MS = 24 * 60 * 60 * 1000;
const CHART_DAYS = 30;

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Local calendar-day key for bucketing orders into days. */
function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

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

  // ── Time windows ──────────────────────────────────────────────
  const now = new Date();
  const todayStart = startOfDay(now);
  const yesterdayStart = new Date(todayStart.getTime() - DAY_MS);
  const last30Start = new Date(todayStart.getTime() - (CHART_DAYS - 1) * DAY_MS);
  const prev30Start = new Date(last30Start.getTime() - CHART_DAYS * DAY_MS);

  // Revenue counts every order that wasn't cancelled.
  const notCancelled: Prisma.OrderWhereInput = {
    status: { not: OrderStatus.CANCELLED },
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
      where: { ...branchWhere, ...notCancelled },
    }),
    prisma.order.aggregate({
      _sum: { totalAmount: true },
      where: { ...branchWhere, ...notCancelled, createdAt: { gte: last30Start } },
    }),
    prisma.order.aggregate({
      _sum: { totalAmount: true },
      where: {
        ...branchWhere,
        ...notCancelled,
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
      where: { ...branchWhere, ...notCancelled, createdAt: { gte: last30Start } },
      select: { createdAt: true, totalAmount: true },
    }),
    // Resolve the branch name for the UI label (only when scoped to one branch).
    branchId
      ? prisma.branch.findUnique({ where: { id: branchId }, select: { name: true } })
      : Promise.resolve(null),
  ]);

  // ── Chart series: revenue bucketed into the last 30 calendar days ──
  const labelFmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" });
  const indexByKey = new Map<string, number>();
  const chartData: RevenuePoint[] = [];
  for (let i = 0; i < CHART_DAYS; i++) {
    const d = new Date(last30Start.getTime() + i * DAY_MS);
    indexByKey.set(dayKey(d), i);
    chartData.push({ date: labelFmt.format(d), revenue: 0 });
  }
  for (const order of chartOrders) {
    const idx = indexByKey.get(dayKey(order.createdAt));
    if (idx != null) chartData[idx].revenue += order.totalAmount;
  }

  return {
    scope: {
      role: scope.role,
      branchId: branchId ?? null,
      branchName: branch?.name ?? null,
    },
    totalRevenue: revenueAllTime._sum.totalAmount ?? 0,
    revenueLast30: revenueLast30._sum.totalAmount ?? 0,
    revenuePrev30: revenuePrev30._sum.totalAmount ?? 0,
    ordersToday,
    ordersYesterday,
    activeProducts,
    newProducts30,
    customers,
    newCustomers30,
    recentOrders,
    chartData,
  };
}

export type GetOrdersParams = {
  branchId?: string;
  /** Omit / undefined = all statuses. */
  status?: OrderStatus;
  query?: string;
};

export type GetOrdersResult = {
  orders: AdminOrderView[];
  counts: Record<TabValue, number>;
};

/**
 * Branch-scoped orders list + per-status counters for the admin orders board.
 * Same search/filter behaviour as before, with the caller's branch ANDed into
 * every query so a MANAGER physically cannot read another branch's orders.
 */
export async function getOrders(
  params?: GetOrdersParams,
): Promise<GetOrdersResult> {
  const scope = await requireDashboardAccess();
  const branchId = resolveBranchScope(scope, params?.branchId);
  const branchWhere: Prisma.OrderWhereInput = branchId ? { branchId } : {};

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

  const [orders, grouped] = await Promise.all([
    prisma.order.findMany({
      where: listWhere,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        user: { select: { email: true } },
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

  // Serialize for the client table/drawer; VAT is the residual so receipts
  // reconcile to the canonical totalAmount.
  const view: AdminOrderView[] = orders.map((order) => ({
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
    subtotal: order.subtotal,
    vat: Math.max(0, order.totalAmount - order.subtotal - order.deliveryFee),
    deliveryFee: order.deliveryFee,
    totalAmount: order.totalAmount,
    itemCount: order.items.reduce((n, it) => n + it.quantity, 0),
    items: order.items.map((it) => ({
      id: it.id,
      productName: it.productName,
      variantName: it.variantName,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      lineTotal: it.unitPrice * it.quantity,
    })),
    userEmail: order.user?.email ?? null,
  }));

  return { orders: view, counts };
}
