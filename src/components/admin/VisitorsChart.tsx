"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DailyVisitors } from "@/lib/visitor-funnel";

// Brand turquoise (matches --ali-turquoise / text-primary) — same as RevenueChart.
const PRIMARY = "#198b9e";

function ChartTooltip({
  active,
  payload,
  label,
  unit,
  numberLocale,
}: {
  active?: boolean;
  payload?: { value?: number }[];
  label?: string;
  unit: string;
  numberLocale: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 shadow-lg">
      <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">
        {label}
      </p>
      <p className="mt-0.5 font-serif text-lg font-medium tabular-nums text-stone-900">
        {(payload[0]?.value ?? 0).toLocaleString(numberLocale)}{" "}
        <span className="font-sans text-xs text-stone-400">{unit}</span>
      </p>
    </div>
  );
}

/** Daily unique visitors on Cairo days — the RevenueChart's look, counts instead of EGP. */
export default function VisitorsChart({
  data,
  emptyLabel,
  unit,
  numberLocale,
}: {
  data: DailyVisitors[];
  emptyLabel: string;
  unit: string;
  numberLocale: string;
}) {
  const hasVisits = data.some((d) => d.visitors > 0);
  // Thin x-axis labels so 30 days don't collide (show ~6 ticks).
  const interval = data.length > 8 ? Math.ceil(data.length / 6) - 1 : 0;

  return (
    <div className="relative h-[220px] w-full">
      {!hasVisits && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <p className="text-sm text-stone-400">{emptyLabel}</p>
        </div>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: -12 }}>
          <defs>
            <linearGradient id="visitorsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={PRIMARY} stopOpacity={0.22} />
              <stop offset="100%" stopColor={PRIMARY} stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e7e5e4" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            interval={interval}
            tick={{ fill: "#a8a29e", fontSize: 11 }}
            dy={6}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={40}
            allowDecimals={false}
            tick={{ fill: "#a8a29e", fontSize: 11 }}
          />
          <Tooltip
            content={<ChartTooltip unit={unit} numberLocale={numberLocale} />}
            cursor={{ stroke: PRIMARY, strokeOpacity: 0.25, strokeWidth: 1 }}
          />
          <Area
            type="monotone"
            dataKey="visitors"
            stroke={PRIMARY}
            strokeWidth={2}
            fill="url(#visitorsFill)"
            activeDot={{ r: 4, fill: PRIMARY, stroke: "#fff", strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
