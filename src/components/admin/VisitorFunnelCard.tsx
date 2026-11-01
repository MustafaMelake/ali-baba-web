"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { VisitorSummary } from "@/lib/visitor-funnel";
import { VISITOR_FUNNEL_COPY, type VisitorCopyLocale } from "@/lib/visitor-funnel-copy";
import VisitorsChart from "@/components/admin/VisitorsChart";

type Range = "week" | "month";
const RANGES: Range[] = ["week", "month"];

/**
 * Dashboard visitor card — unique visitors, page views, the conversion funnel
 * with step drop-off, and daily unique visitors. Both windows arrive
 * precomputed from getVisitorFunnel, so the "This week / 30 days" toggle is
 * pure local state: no request, nothing to put in the URL.
 *
 * Direction-agnostic (logical properties only; bars grow from the reading
 * start), strings from VISITOR_FUNNEL_COPY, tabular-nums on every figure.
 */
export default function VisitorFunnelCard({
  week,
  month,
  branchScoped,
  locale = "en",
}: {
  week: VisitorSummary;
  month: VisitorSummary;
  branchScoped: boolean;
  locale?: VisitorCopyLocale;
}) {
  const [range, setRange] = useState<Range>("week");
  const copy = VISITOR_FUNNEL_COPY[locale];
  const data = range === "week" ? week : month;
  const fmt = (n: number) => n.toLocaleString(copy.numberLocale);
  const top = Math.max(1, ...data.steps.map((s) => s.count));

  return (
    <section
      dir={copy.dir}
      lang={locale}
      className="mt-6 rounded-2xl border border-stone-200/70 bg-white p-6 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-serif text-xl font-medium text-stone-900">{copy.title}</h2>
        <div
          className="inline-flex rounded-full bg-stone-100 p-1"
          role="group"
          aria-label={copy.rangeLabel}
        >
          {RANGES.map((option) => {
            const active = option === range;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setRange(option)}
                aria-pressed={active}
                className={cn(
                  "relative rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
                  active ? "text-stone-900" : "text-stone-500 hover:text-stone-800",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="visitor-range-pill"
                    className="absolute inset-0 rounded-full bg-white shadow-sm"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
                <span className="relative">{copy[option]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {branchScoped && (
        <p className="mt-3 max-w-2xl text-xs leading-relaxed text-stone-500">{copy.branchNote}</p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-5">
        {/* Headline figures + funnel */}
        <div className="lg:col-span-2">
          <dl className="grid grid-cols-2 gap-4">
            {[
              { label: copy.uniqueVisitors, value: data.uniqueVisitors },
              { label: copy.pageViews, value: data.pageViews },
            ].map(({ label, value }) => (
              <div key={label}>
                <dt className="text-[13px] font-medium uppercase tracking-wide text-stone-400">
                  {label}
                </dt>
                <dd className="mt-1 font-serif text-3xl font-medium tracking-tight tabular-nums text-stone-900">
                  {fmt(value)}
                </dd>
              </div>
            ))}
          </dl>

          <h3 className="mt-7 text-xs font-medium uppercase tracking-wide text-stone-400">
            {copy.funnelTitle}
          </h3>
          <ol className="mt-3 space-y-3">
            {data.steps.map((step) => (
              <li key={step.key}>
                {step.dropOff !== null && (
                  <p className="mb-1.5 ps-1 text-[11px] font-medium tabular-nums text-stone-400">
                    ↓ {copy.dropOff(fmt(step.dropOff))}
                  </p>
                )}
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-stone-600">{copy.steps[step.key]}</span>
                  <span className="font-medium tabular-nums text-stone-900">{fmt(step.count)}</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-stone-100">
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width] duration-500",
                      step.key === "orders" ? "bg-emerald-500" : "bg-primary",
                    )}
                    style={{ width: `${Math.min(100, (step.count / top) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-[11px] leading-relaxed text-stone-400">{copy.ordersNote}</p>
        </div>

        {/* Daily unique visitors (Cairo days) */}
        <div className="lg:col-span-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-stone-400">
            {copy.chartTitle}
          </h3>
          <div className="mt-4">
            <VisitorsChart
              data={data.daily}
              emptyLabel={copy.chartEmpty}
              unit={copy.tooltipVisitors}
              numberLocale={copy.numberLocale}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
