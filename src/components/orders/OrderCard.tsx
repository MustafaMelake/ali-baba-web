"use client";

import { useState } from "react";
import { ChevronRight, Package } from "lucide-react";
import { formatEGP } from "@/lib/utils";
import StatusPill from "./StatusPill";
import OrderDetailModal from "./OrderDetailModal";
import type { OrderView } from "./types";

export default function OrderCard({ order }: { order: OrderView }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="group flex w-full items-center gap-4 rounded-2xl border border-stone-200/70 bg-white px-5 py-5 text-left shadow-sm transition-all hover:border-stone-300 hover:shadow-md md:px-7"
      >
        <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-500 transition-colors group-hover:bg-primary/10 group-hover:text-primary sm:flex">
          <Package className="h-5 w-5" strokeWidth={1.6} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <span className="font-serif text-lg font-medium tracking-tight text-stone-900">
              #{order.orderNumber}
            </span>
            <StatusPill status={order.status} />
          </div>
          <p className="mt-1 font-sans text-xs text-stone-400">
            {order.dateLabel} · {order.itemCount} item
            {order.itemCount === 1 ? "" : "s"}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="font-serif text-lg font-medium text-stone-900 tabular-nums">
            {formatEGP(order.totalAmount)}
          </p>
          <span className="mt-0.5 inline-flex items-center gap-1 font-sans text-[11px] font-medium uppercase tracking-wide text-stone-400 transition-colors group-hover:text-primary">
            View details
            <ChevronRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
          </span>
        </div>
      </button>

      <OrderDetailModal order={order} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
