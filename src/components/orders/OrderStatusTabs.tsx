"use client";

import { useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { OrderStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

export type TabValue = OrderStatus | "ALL";

// "ALL" first (synthetic), then every enum value in declaration order.
const TABS: TabValue[] = ["ALL", ...Object.values(OrderStatus)];

function tabLabel(tab: TabValue) {
  if (tab === "ALL") return "All";
  return tab.charAt(0) + tab.slice(1).toLowerCase();
}

/**
 * Reads the active filter from the server (via `activeStatus`) and pushes the
 * new `?status=` param on click — a soft navigation (no hard reload, no scroll
 * jump) so the server re-runs the filtered query and streams fresh results.
 */
export default function OrderStatusTabs({
  activeStatus,
}: {
  activeStatus: TabValue;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function selectTab(tab: TabValue) {
    if (tab === activeStatus) return;
    const href = tab === "ALL" ? pathname : `${pathname}?status=${tab}`;
    startTransition(() => router.push(href, { scroll: false }));
  }

  return (
    <div
      className={cn(
        "-mx-1 mb-8 overflow-x-auto scrollbar-none transition-opacity",
        isPending && "opacity-60",
      )}
    >
      <div
        role="tablist"
        aria-label="Filter orders by status"
        className="flex items-center gap-1.5 px-1"
      >
        {TABS.map((tab) => {
          const isActive = tab === activeStatus;
          return (
            <button
              key={tab}
              role="tab"
              aria-selected={isActive}
              onClick={() => selectTab(tab)}
              disabled={isPending}
              className={cn(
                "relative shrink-0 rounded-full px-5 py-2.5 font-sans text-[13px] font-medium uppercase tracking-[0.12em] transition-colors duration-300 disabled:cursor-wait",
                isActive ? "text-white" : "text-stone-500 hover:text-stone-900",
              )}
            >
              {isActive && (
                <motion.span
                  layoutId="order-status-pill"
                  className="absolute inset-0 rounded-full bg-stone-900"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              <span className="relative z-10 whitespace-nowrap">
                {tabLabel(tab)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
