"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PeakHours, PeakHourPoint } from "@/lib/actions/analytics";

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  // Busiest branch first, and hide flat-zero series to keep the card readable.
  const rows = payload
    .filter((p) => (p.value ?? 0) > 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  return (
    <div className="min-w-[140px] rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 shadow-lg">
      <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">
        {label}
      </p>
      {rows.length === 0 ? (
        <p className="mt-1 text-xs text-stone-400">No orders</p>
      ) : (
        <dl className="mt-1.5 space-y-1">
          {rows.map((p) => (
            <div key={p.name} className="flex items-center justify-between gap-5">
              <dt className="flex items-center gap-1.5 text-xs text-stone-500">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: p.color }}
                />
                {p.name}
              </dt>
              <dd className="text-xs font-semibold text-stone-900">{p.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export default function PeakHoursChart({ data }: { data: PeakHours }) {
  const { branches, series } = data;
  const hasData = series.some((pt) =>
    branches.some((b) => (pt[b.name] as number) > 0),
  );
  // Thin x-axis labels so a long trading window doesn't collide (~8 ticks).
  const interval = series.length > 10 ? Math.ceil(series.length / 8) - 1 : 0;

  return (
    <div>
      {/* Custom legend (branch → colour) */}
      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-2">
        {branches.map((b) => (
          <span
            key={b.name}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-600"
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: b.color }}
            />
            {b.name}
          </span>
        ))}
      </div>

      <div className="relative h-[300px] w-full">
        {!hasData && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <p className="text-sm text-stone-400">
              Not enough orders to chart peak hours yet.
            </p>
          </div>
        )}
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={series as PeakHourPoint[]}
            margin={{ top: 8, right: 12, bottom: 0, left: -16 }}
          >
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e7e5e4" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              interval={interval}
              tick={{ fill: "#a8a29e", fontSize: 11 }}
              dy={6}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={44}
              allowDecimals={false}
              tick={{ fill: "#a8a29e", fontSize: 11 }}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ stroke: "#198b9e", strokeOpacity: 0.25, strokeWidth: 1 }}
            />
            {branches.map((b) => (
              <Line
                key={b.name}
                type="monotone"
                dataKey={b.name}
                stroke={b.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: b.color, stroke: "#fff", strokeWidth: 2 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
