"use client";

import { useState } from "react";
import { Truck, Store, ChevronRight } from "lucide-react";
import { FulfillmentMethod } from "@/generated/prisma/enums";
import StatusPill from "@/components/orders/StatusPill";
import { formatEGP } from "@/lib/utils";
import AdminOrderDetailDrawer from "./AdminOrderDetailDrawer";
import type { AdminOrderView } from "./order-types";

export default function AdminOrdersTable({
  orders,
}: {
  orders: AdminOrderView[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Derive from the live list (not a snapshot) so a status change re-syncs here.
  const selected = orders.find((o) => o.id === selectedId) ?? null;

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-stone-50/70 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">
                <th className="px-6 py-3.5 font-semibold">Order</th>
                <th className="px-6 py-3.5 font-semibold">Date</th>
                <th className="px-6 py-3.5 font-semibold">Customer</th>
                <th className="px-6 py-3.5 font-semibold">Fulfillment</th>
                <th className="px-6 py-3.5 font-semibold">Status</th>
                <th className="px-6 py-3.5 text-right font-semibold">Total</th>
                <th className="px-6 py-3.5 text-right font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const isDelivery =
                  order.fulfillment === FulfillmentMethod.DELIVERY;
                return (
                  <tr
                    key={order.id}
                    onClick={() => setSelectedId(order.id)}
                    className="cursor-pointer border-t border-stone-100 transition-colors hover:bg-stone-50/60"
                  >
                    <td className="px-6 py-4 font-medium text-stone-900">
                      #{order.orderNumber}
                    </td>
                    <td className="px-6 py-4 text-stone-500">{order.dateLabel}</td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-stone-800">
                        {order.customerName}
                      </div>
                      <div className="text-xs text-stone-400">
                        {order.userEmail ?? order.customerPhone}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1.5 text-stone-600">
                        {isDelivery ? (
                          <Truck className="h-3.5 w-3.5 text-stone-400" />
                        ) : (
                          <Store className="h-3.5 w-3.5 text-stone-400" />
                        )}
                        {isDelivery ? "Delivery" : "Pickup"}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <StatusPill status={order.status} />
                    </td>
                    <td className="px-6 py-4 text-right font-medium text-stone-900 tabular-nums">
                      {formatEGP(order.totalAmount)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(order.id);
                        }}
                        className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-sans text-xs font-semibold text-stone-500 transition-colors hover:bg-primary/5 hover:text-primary"
                      >
                        Manage
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <AdminOrderDetailDrawer
        order={selected}
        open={selected !== null}
        onClose={() => setSelectedId(null)}
      />
    </>
  );
}
