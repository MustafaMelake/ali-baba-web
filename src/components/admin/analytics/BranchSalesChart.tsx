"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn, formatEGP } from "@/lib/utils";
import type { BranchSales } from "@/lib/actions/analytics";

type Metric = "revenue" | "orders";

/** Compact axis labels — 1500 → "1.5k", 12000 → "12k". */
function compact(n: number) {
  if (n >= 1000) {
    const k = n / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return String(n);
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload?: BranchSales }[];
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 shadow-lg">
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: row.color }}
        />
        <p className="text-sm font-semibold text-stone-900">{row.name}</p>
      </div>
      <dl className="mt-1.5 space-y-0.5 text-xs">
        <div className="flex items-center justify-between gap-6">
          <dt className="text-stone-400">Revenue</dt>
          <dd className="font-medium text-stone-700">{formatEGP(row.revenue)}</dd>
        </div>
        <div className="flex items-center justify-between gap-6">
          <dt className="text-stone-400">Orders</dt>
          <dd className="font-medium text-stone-700">
            {row.orders.toLocaleString("en-US")}
          </dd>
        </div>
      </dl>
    </div>
  );
}

const TABS: { key: Metric; label: string }[] = [
  { key: "revenue", label: "Revenue" },
  { key: "orders", label: "Orders" },
];

export default function BranchSalesChart({ data }: { data: BranchSales[] }) {
  const [metric, setMetric] = useState<Metric>("revenue");
  const hasData = data.some((d) => d.revenue > 0 || d.orders > 0);

  return (
    <div>
      {/* Metric toggle */}
      <div className="mb-4 inline-flex rounded-xl bg-stone-100 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setMetric(tab.key)}
            aria-pressed={metric === tab.key}
            className={cn(
              "rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors",
              metric === tab.key
                ? "bg-white text-stone-900 shadow-sm"
                : "text-stone-500 hover:text-stone-700",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="relative h-[300px] w-full">
        {!hasData && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <p className="text-sm text-stone-400">No branch sales recorded yet.</p>
          </div>
        )}
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: -8 }}
            barCategoryGap="28%"
          >
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e7e5e4" />
            <XAxis
              dataKey="name"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#78716c", fontSize: 12, fontWeight: 500 }}
              dy={6}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={metric === "revenue" ? compact : (v) => String(v)}
              tick={{ fill: "#a8a29e", fontSize: 11 }}
              allowDecimals={false}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ fill: "#198b9e", fillOpacity: 0.06 }}
            />
            <Bar dataKey={metric} radius={[6, 6, 0, 0]} maxBarSize={72}>
              {data.map((entry) => (
                <Cell key={entry.branchId} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
