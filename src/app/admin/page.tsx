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
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Admin Dashboard | Ali Baba",
};

type Stat = {
  label: string;
  value: string;
  delta: string;
  trend: "up" | "down";
  icon: LucideIcon;
};

// Placeholder figures — wire these up to real queries (orders / products /
// revenue aggregates) when the data layer is ready.
const STATS: Stat[] = [
  {
    label: "Total Revenue",
    value: "EGP 482,900",
    delta: "+12.4%",
    trend: "up",
    icon: Wallet,
  },
  {
    label: "Orders Today",
    value: "38",
    delta: "+8.1%",
    trend: "up",
    icon: ShoppingBag,
  },
  {
    label: "Active Products",
    value: "126",
    delta: "+3",
    trend: "up",
    icon: Package,
  },
  {
    label: "Customers",
    value: "2,540",
    delta: "-1.2%",
    trend: "down",
    icon: Users,
  },
];

export default async function AdminDashboardPage() {
  // The layout is the authoritative guard; this read is request-cached and used
  // only to greet the admin. The null-check keeps TypeScript happy and guards
  // the (parallel) render in the unlikely event the layout hasn't bounced yet.
  const session = await getServerSession();
  if (!session) redirect("/login");

  const firstName = session.user.name.split(/\s+/)[0];

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
        {STATS.map(({ label, value, delta, trend, icon: Icon }) => {
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
                    up
                      ? "bg-emerald-50 text-emerald-600"
                      : "bg-red-50 text-red-600",
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

      {/* Lower panels */}
      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Recent orders — empty-state placeholder */}
        <div className="rounded-2xl border border-stone-200/70 bg-white p-6 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-xl font-medium text-stone-900">
              Recent Orders
            </h2>
            <span className="text-xs font-medium text-stone-400">
              Live feed
            </span>
          </div>
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
        </div>

        {/* Quick actions */}
        <div className="rounded-2xl border border-stone-200/70 bg-white p-6 shadow-sm">
          <h2 className="font-serif text-xl font-medium text-stone-900">
            Quick Actions
          </h2>
          <div className="mt-5 flex flex-col gap-2">
            {[
              { label: "Add a product", href: "/admin/products" },
              { label: "Review orders", href: "/admin/orders" },
              { label: "Manage categories", href: "/admin/categories" },
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
