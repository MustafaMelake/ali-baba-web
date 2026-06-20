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
import { formatEGP } from "@/lib/utils";

export type RevenuePoint = { date: string; revenue: number };

// Brand turquoise (matches --ali-turquoise / text-primary).
const PRIMARY = "#198b9e";

/** Compact axis labels — 1500 → "1.5k", 2000 → "2k". */
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
  label,
}: {
  active?: boolean;
  payload?: { value?: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 shadow-lg">
      <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">
        {label}
      </p>
      <p className="mt-0.5 font-serif text-lg font-medium text-stone-900">
        {formatEGP(payload[0]?.value ?? 0)}
      </p>
    </div>
  );
}

export default function RevenueChart({ data }: { data: RevenuePoint[] }) {
  const hasRevenue = data.some((d) => d.revenue > 0);
  // Thin x-axis labels so 30 days don't collide (show ~6 ticks).
  const interval = data.length > 8 ? Math.ceil(data.length / 6) - 1 : 0;

  return (
    <div className="relative h-[260px] w-full">
      {!hasRevenue && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <p className="text-sm text-stone-400">
            No revenue recorded in this period yet.
          </p>
        </div>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: -12 }}>
          <defs>
            <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={PRIMARY} stopOpacity={0.22} />
              <stop offset="100%" stopColor={PRIMARY} stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid
            vertical={false}
            strokeDasharray="3 3"
            stroke="#e7e5e4"
          />
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
            width={48}
            tickFormatter={compact}
            tick={{ fill: "#a8a29e", fontSize: 11 }}
          />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ stroke: PRIMARY, strokeOpacity: 0.25, strokeWidth: 1 }}
          />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke={PRIMARY}
            strokeWidth={2}
            fill="url(#revenueFill)"
            activeDot={{ r: 4, fill: PRIMARY, stroke: "#fff", strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
