"use client";

import { useSyncExternalStore } from "react";
import { Grid2x2, RectangleVertical } from "lucide-react";
import {
  readGridDensity,
  setGridDensity,
  subscribeGridDensity,
  type GridDensity,
} from "@/lib/grid-density";
import { cn } from "@/lib/utils";

/** Strings kept out of the markup (the Arabic locale swaps this table). */
const COPY = {
  group: "Products per row",
  two: "Two per row",
  one: "One per row, larger photos",
} as const;

const OPTIONS: { density: GridDensity; label: string; Icon: typeof Grid2x2 }[] = [
  { density: "2", label: COPY.two, Icon: Grid2x2 },
  { density: "1", label: COPY.one, Icon: RectangleVertical },
];

/**
 * The phone-only 2-up / 1-up switch above a product grid. It owns no layout
 * state: it writes `<html data-grid>` + localStorage through `setGridDensity`
 * and CSS does the rest (see `@/lib/grid-density`). The pressed LOOK comes from
 * the same attribute (`grid-1up:`), so it is right on first paint; only
 * `aria-pressed` waits for hydration (the server snapshot is the 2-up default).
 */
export default function GridDensityToggle({ className }: { className?: string }) {
  const density = useSyncExternalStore(subscribeGridDensity, readGridDensity, () => "2" as const);

  return (
    <div
      role="group"
      aria-label={COPY.group}
      className={cn("inline-flex items-center rounded-full border border-stone-200 bg-white p-0.5 sm:hidden", className)}
    >
      {OPTIONS.map(({ density: value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={density === value}
          aria-label={label}
          title={label}
          onClick={() => setGridDensity(value)}
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            // Pressed styling straight from <html data-grid> — never a flash.
            value === "2"
              ? "bg-stone-900 text-white grid-1up:bg-transparent grid-1up:text-stone-400"
              : "text-stone-400 grid-1up:bg-stone-900 grid-1up:text-white",
          )}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
