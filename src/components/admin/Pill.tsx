import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Status / role badge pill. Shape & typography are fixed here; callers pass the
 * colour classes (bg / text / ring) via `className` so each domain owns its
 * own colour map.
 */
export default function Pill({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
        className,
      )}
    >
      {children}
    </span>
  );
}
