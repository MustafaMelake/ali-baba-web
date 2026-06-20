import Link from "next/link";
import { redirect } from "next/navigation";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  ShoppingBag,
  Package,
  Users,
  ArrowUpRight,
  type LucideIcon,
} from "lucide-react";
import { getServerSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { cn, formatEGP, formatDate } from "@/lib/utils";
import { OrderStatus } from "@/generated/prisma/enums";
import Pill from "@/components/admin/Pill";
import RevenueChart, { type RevenuePoint } from "@/components/admin/RevenueChart";

export const metadata = {
  title: "Admin Dashboard | Ali Baba",
};

// The dashboard must always reflect the live database, never a cached snapshot.
export const dynamic = "force-dynamic";

type Trend = "up" | "down";
type Stat = {
  label: string;
  value: string;
  delta: string;
  trend: Trend;
  icon: LucideIcon;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const CHART_DAYS = 30;

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Local day key for bucketing orders into calendar days.
function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Percentage change vs a previous period, formatted for a stat badge. */
function pctDelta(current: number, previous: number): { delta: string; trend: Trend } {
  if (previous <= 0) {
    return current > 0
      ? { delta: "New", trend: "up" }
      : { delta: "0%", trend: "up" };
  }
  const pct = Math.round(((current - previous) / previous) * 1000) / 10;
  return { delta: `${pct >= 0 ? "+" : ""}${pct}%`, trend: pct >= 0 ? "up" : "down" };
}

/** "+N new" style delta for counts where a period comparison isn't meaningful. */
function countDelta(newInPeriod: number): { delta: string; trend: Trend } {
  return { delta: newInPeriod > 0 ? `+${newInPeriod}` : "0", trend: "up" };
}

// Order-status pill palette (mirrors /admin/orders).
const STATUS_STYLES: Record<OrderStatus, string> = {
  PENDING: "bg-amber-50 text-amber-700 ring-amber-600/20",
  PREPARING: "bg-blue-50 text-blue-700 ring-blue-600/20",
  SHIPPED: "bg-violet-50 text-violet-700 ring-violet-600/20",
  DELIVERED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  CANCELLED: "bg-red-50 text-red-700 ring-red-600/20",
};

function statusLabel(status: OrderStatus) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

export default async function AdminDashboardPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const firstName = session.user.name.split(/\s+/)[0];

  // ── Time windows ──────────────────────────────────────────────
  const now = new Date();
  const todayStart = startOfDay(now);
  const yesterdayStart = new Date(todayStart.getTime() - DAY_MS);
  const last30Start = new Date(todayStart.getTime() - (CHART_DAYS - 1) * DAY_MS);
  const prev30Start = new Date(last30Start.getTime() - CHART_DAYS * DAY_MS);

  // Revenue counts every order that wasn't cancelled.
  const notCancelled = { status: { not: OrderStatus.CANCELLED } } as const;

  // ── Live metrics (parallelised) ───────────────────────────────
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
  ] = await Promise.all([
    prisma.order.aggregate({ _sum: { totalAmount: true }, where: notCancelled }),
    prisma.order.aggregate({
      _sum: { totalAmount: true },
      where: { ...notCancelled, createdAt: { gte: last30Start } },
    }),
    prisma.order.aggregate({
      _sum: { totalAmount: true },
      where: { ...notCancelled, createdAt: { gte: prev30Start, lt: last30Start } },
    }),
    prisma.order.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.order.count({
      where: { createdAt: { gte: yesterdayStart, lt: todayStart } },
    }),
    prisma.product.count({ where: { isAvailable: true } }),
    prisma.product.count({ where: { createdAt: { gte: last30Start } } }),
    prisma.user.count({ where: { role: "USER" } }),
    prisma.user.count({ where: { role: "USER", createdAt: { gte: last30Start } } }),
    prisma.order.findMany({
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
      where: { ...notCancelled, createdAt: { gte: last30Start } },
      select: { createdAt: true, totalAmount: true },
    }),
  ]);

  const totalRevenue = revenueAllTime._sum.totalAmount ?? 0;
  const revenueDelta = pctDelta(
    revenueLast30._sum.totalAmount ?? 0,
    revenuePrev30._sum.totalAmount ?? 0,
  );
  const ordersDelta = pctDelta(ordersToday, ordersYesterday);

  const stats: Stat[] = [
    {
      label: "Total Revenue",
      value: formatEGP(totalRevenue),
      ...revenueDelta,
      icon: Wallet,
    },
    {
      label: "Orders Today",
      value: ordersToday.toLocaleString("en-US"),
      ...ordersDelta,
      icon: ShoppingBag,
    },
    {
      label: "Active Products",
      value: activeProducts.toLocaleString("en-US"),
      ...countDelta(newProducts30),
      icon: Package,
    },
    {
      label: "Customers",
      value: customers.toLocaleString("en-US"),
      ...countDelta(newCustomers30),
      icon: Users,
    },
  ];

  // ── Chart series: revenue bucketed into the last 30 calendar days ──
  const labelFmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" });
  const buckets = new Map<string, number>();
  const chartData: RevenuePoint[] = [];
  for (let i = 0; i < CHART_DAYS; i++) {
    const d = new Date(last30Start.getTime() + i * DAY_MS);
    const key = dayKey(d);
    buckets.set(key, 0);
    chartData.push({ date: labelFmt.format(d), revenue: 0 });
  }
  // Map each day key back to its index so we can accumulate in O(1).
  const indexByKey = new Map([...buckets.keys()].map((k, i) => [k, i]));
  for (const order of chartOrders) {
    const idx = indexByKey.get(dayKey(order.createdAt));
    if (idx != null) chartData[idx].revenue += order.totalAmount;
  }
  const chartTotal = chartData.reduce((sum, d) => sum + d.revenue, 0);

  return (
    <div className="mx-auto max-w-6xl">
      {/* Greeting */}
      <header>
        <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-primary">
          Overview
        </span>
        <h1 className="mt-2 font-serif text-4xl font-medium tracking-tight text-stone-900">
          Welcome back, {firstName}
        </h1>
        <p className="mt-2 max-w-xl text-sm text-stone-500">
          Here’s what’s happening across your store today.
        </p>
      </header>

      {/* Stats cards */}
      <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ label, value, delta, trend, icon: Icon }) => {
          const up = trend === "up";
          const TrendIcon = up ? TrendingUp : TrendingDown;
          return (
            <article
              key={label}
              className="group rounded-2xl border border-stone-200/70 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold",
                    up ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600",
                  )}
                >
                  <TrendIcon className="h-3.5 w-3.5" />
                  {delta}
                </span>
              </div>
              <p className="mt-4 text-[13px] font-medium uppercase tracking-wide text-stone-400">
                {label}
              </p>
              <p className="mt-1 font-serif text-3xl font-medium tracking-tight text-stone-900">
                {value}
              </p>
            </article>
          );
        })}
      </section>

      {/* Revenue chart */}
      <section className="mt-6 rounded-2xl border border-stone-200/70 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-serif text-xl font-medium text-stone-900">
              Revenue
            </h2>
            <p className="mt-1 text-xs font-medium uppercase tracking-wide text-stone-400">
              Last 30 days
            </p>
          </div>
          <div className="text-right">
            <p className="font-serif text-2xl font-medium text-stone-900">
              {formatEGP(chartTotal)}
            </p>
            <p className="text-xs text-stone-400">collected in period</p>
          </div>
        </div>
        <div className="mt-6">
          <RevenueChart data={chartData} />
        </div>
      </section>

      {/* Lower panels */}
      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Recent orders */}
        <div className="rounded-2xl border border-stone-200/70 bg-white p-6 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-xl font-medium text-stone-900">
              Recent Orders
            </h2>
            <Link
              href="/admin/orders"
              className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
            >
              View all
            </Link>
          </div>

          {recentOrders.length === 0 ? (
            <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-stone-200 py-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-stone-100 text-stone-400">
                <ShoppingBag className="h-5 w-5" />
              </span>
              <p className="mt-3 text-sm font-medium text-stone-600">
                No orders to show yet
              </p>
              <p className="mt-1 text-xs text-stone-400">
                Incoming orders will appear here in real time.
              </p>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-stone-100">
              {recentOrders.map((order) => (
                <li
                  key={order.id}
                  className="flex items-center gap-4 py-3 first:pt-1"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-stone-100 text-[11px] font-semibold text-stone-500">
                    #{order.orderNumber}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-stone-900">
                      {order.customerName}
                    </p>
                    <p className="text-xs text-stone-400">
                      {formatDate(order.createdAt)}
                    </p>
                  </div>
                  <Pill className={STATUS_STYLES[order.status]}>
                    {statusLabel(order.status)}
                  </Pill>
                  <span className="w-24 shrink-0 text-right text-sm font-medium text-stone-900">
                    {formatEGP(order.totalAmount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Quick actions */}
        <div className="rounded-2xl border border-stone-200/70 bg-white p-6 shadow-sm">
          <h2 className="font-serif text-xl font-medium text-stone-900">
            Quick Actions
          </h2>
          <div className="mt-5 flex flex-col gap-2">
            {[
              { label: "Add a product", href: "/admin/products/new" },
              { label: "Review orders", href: "/admin/orders" },
              { label: "Manage categories", href: "/admin/categories" },
              { label: "Edit café menu", href: "/admin/menu" },
            ].map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="group flex items-center justify-between rounded-xl border border-stone-200/70 px-4 py-3 text-sm font-medium text-stone-700 transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
              >
                {action.label}
                <ArrowUpRight className="h-4 w-4 text-stone-400 transition-colors group-hover:text-primary" />
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
