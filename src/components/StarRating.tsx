import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

function StarsRow({ size, filled }: { size: number; filled?: boolean }) {
  return (
    <span className="flex">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          style={{ width: size, height: size }}
          strokeWidth={0}
          className={cn("shrink-0 fill-current", filled ? "text-amber-400" : "text-stone-200")}
        />
      ))}
    </span>
  );
}

/**
 * Read-only star rating with precise fractional fill (e.g. 4.3 ★).
 *
 * No hooks / no client directive — safe to render in Server Components. A grey
 * track of 5 stars sits underneath; an amber layer of the same 5 stars is
 * clipped by width to the exact percentage, giving smooth partial stars.
 */
export default function StarRating({
  value,
  size = 16,
  className,
}: {
  value: number;
  size?: number;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(5, value));
  const pct = (clamped / 5) * 100;

  return (
    <span
      className={cn("relative inline-flex", className)}
      role="img"
      aria-label={`${clamped.toFixed(1)} out of 5 stars`}
    >
      <StarsRow size={size} />
      <span
        className="absolute inset-0 overflow-hidden"
        style={{ width: `${pct}%` }}
        aria-hidden="true"
      >
        <StarsRow size={size} filled />
      </span>
    </span>
  );
}
