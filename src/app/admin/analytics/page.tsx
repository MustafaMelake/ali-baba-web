import {
  Crown,
  TrendingUp,
  Clock,
  BarChart3,
  Trophy,
  Package,
} from "lucide-react";
import { requireAdminPage } from "@/lib/session";
import { getAnalytics } from "@/lib/actions/analytics";
import { formatEGP } from "@/lib/utils";
import BranchSalesChart from "@/components/admin/analytics/BranchSalesChart";
import PeakHoursChart from "@/components/admin/analytics/PeakHoursChart";

export const metadata = {
  title: "Advanced Analytics | Ali Baba",
};

// Analytics must always reflect the live database, never a cached snapshot.
export const dynamic = "force-dynamic";

/** "20 Jun 2026 · 14:30" style timestamp for the "as of" line. */
function asOf(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(iso))
    .replace(",", " ·");
}

export default async function AnalyticsPage() {
  // ADMIN-only: bounces managers back to their own dashboard before any query.
  await requireAdminPage();

  const data = await getAnalytics();
  const { branchSales, peakHours, topProducts, star, monthLabel, generatedAt } =
    data;

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-primary">
            Insights
          </span>
          <h1 className="mt-2 font-serif text-4xl font-medium tracking-tight text-stone-900">
            Advanced Analytics
          </h1>
          <p className="mt-2 max-w-xl text-sm text-stone-500">
            Cross-branch performance, trading patterns and best-sellers across
            every active location.
          </p>
        </div>
        <p className="text-xs text-stone-400">As of {asOf(generatedAt)}</p>
      </header>

      {/* Star of the Month */}
      <section className="mt-8">
        {star ? (
          <article className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-[#0f6d7d] p-6 text-white shadow-sm sm:p-8">
            {/* Decorative trophy watermark */}
            <Trophy
              className="pointer-events-none absolute -right-6 -top-6 h-40 w-40 text-white/10"
              strokeWidth={1.25}
            />
            <div className="relative">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/80">
                <Crown className="h-4 w-4" />
                Star of the Month · {monthLabel}
              </div>
              <h2 className="mt-3 font-serif text-4xl font-medium tracking-tight">
                {star.name}
              </h2>
              <div className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-white/70">
                    Revenue
                  </p>
                  <p className="mt-1 font-serif text-2xl font-medium">
                    {formatEGP(star.revenue)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-white/70">
                    Orders
                  </p>
                  <p className="mt-1 font-serif text-2xl font-medium">
                    {star.orders.toLocaleString("en-US")}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-white/70">
                    Share of month
                  </p>
                  <p className="mt-1 font-serif text-2xl font-medium">
                    {Math.round(star.share * 100)}%
                  </p>
                </div>
              </div>
            </div>
          </article>
        ) : (
          <article className="flex items-center gap-4 rounded-2xl border border-dashed border-stone-200 bg-white p-8 text-center">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-400">
              <Crown className="h-5 w-5" />
            </span>
            <div className="text-left">
              <p className="text-sm font-medium text-stone-600">
                No “Star of the Month” yet for {monthLabel}
              </p>
              <p className="mt-1 text-xs text-stone-400">
                Once branches record sales this month, the top performer appears
                here.
              </p>
            </div>
          </article>
        )}
      </section>

      {/* Branch sales comparison */}
      <section className="mt-6 rounded-2xl border border-stone-200/70 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <BarChart3 className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-serif text-xl font-medium text-stone-900">
              Branch Sales Comparison
            </h2>
            <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-stone-400">
              All-time, excluding cancelled orders
            </p>
          </div>
        </div>
        <div className="mt-6">
          <BranchSalesChart data={branchSales} />
        </div>
      </section>

      {/* Peak hours */}
      <section className="mt-6 rounded-2xl border border-stone-200/70 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Clock className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-serif text-xl font-medium text-stone-900">
              Peak Hours by Branch
            </h2>
            <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-stone-400">
              Orders per hour of day · Cairo time
            </p>
          </div>
        </div>
        <div className="mt-6">
          <PeakHoursChart data={peakHours} />
        </div>
      </section>

      {/* Top selling products per branch */}
      <section className="mt-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Package className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-serif text-xl font-medium text-stone-900">
              Top Selling Products
            </h2>
            <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-stone-400">
              Best-sellers compared across branches
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {topProducts.map((branch) => (
            <article
              key={branch.branchId}
              className="rounded-2xl border border-stone-200/70 bg-white p-5 shadow-sm"
            >
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: branch.color }}
                />
                <h3 className="font-serif text-lg font-medium text-stone-900">
                  {branch.branchName}
                </h3>
              </div>

              {branch.products.length === 0 ? (
                <p className="mt-6 rounded-xl border border-dashed border-stone-200 py-8 text-center text-xs text-stone-400">
                  No sales recorded yet.
                </p>
              ) : (
                <ol className="mt-4 space-y-4">
                  {branch.products.map((product, i) => {
                    const top = branch.products[0].quantity || 1;
                    const width = Math.max(6, (product.quantity / top) * 100);
                    return (
                      <li key={product.name}>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-stone-100 text-[11px] font-bold text-stone-500">
                              {i + 1}
                            </span>
                            <span className="truncate text-sm font-medium text-stone-800">
                              {product.name}
                            </span>
                          </span>
                          <span className="shrink-0 text-sm font-semibold text-stone-900">
                            {product.quantity.toLocaleString("en-US")}
                            <span className="ml-1 text-xs font-normal text-stone-400">
                              sold
                            </span>
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-100">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${width}%`,
                                backgroundColor: branch.color,
                              }}
                            />
                          </div>
                          <span className="shrink-0 text-[11px] tabular-nums text-stone-400">
                            {formatEGP(product.revenue)}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}

              {branch.products.length > 0 && (
                <p className="mt-4 flex items-center gap-1.5 border-t border-stone-100 pt-3 text-xs text-stone-400">
                  <TrendingUp className="h-3.5 w-3.5" />
                  {branch.totalUnits.toLocaleString("en-US")} units across top{" "}
                  {branch.products.length}
                </p>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
