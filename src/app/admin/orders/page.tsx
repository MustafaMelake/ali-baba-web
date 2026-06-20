import { ShoppingBag } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatDate, formatEGP } from "@/lib/utils";
import type { OrderStatus } from "@/generated/prisma/enums";
import PageHeader from "@/components/admin/PageHeader";
import EmptyState from "@/components/admin/EmptyState";
import Pill from "@/components/admin/Pill";

export const metadata = {
  title: "Orders | Admin",
};

// Colour map keyed by the Prisma OrderStatus enum (exhaustive).
const STATUS_STYLES: Record<OrderStatus, string> = {
  PENDING: "bg-amber-50 text-amber-700 ring-amber-600/20",
  PREPARING: "bg-blue-50 text-blue-700 ring-blue-600/20",
  SHIPPED: "bg-violet-50 text-violet-700 ring-violet-600/20",
  DELIVERED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  CANCELLED: "bg-red-50 text-red-700 ring-red-600/20",
};

// PENDING -> "Pending"
function statusLabel(status: OrderStatus) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

export default async function AdminOrdersPage() {
  // 25 most recent orders, with the placing user (orders may be guest → user null).
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    take: 25,
    include: { user: { select: { name: true, email: true } } },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        eyebrow="Commerce"
        title="Orders"
        description="The 25 most recent orders placed across the store."
      />

      <div className="overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm">
        {orders.length === 0 ? (
          <EmptyState
            icon={ShoppingBag}
            title="No orders found"
            description="New orders will appear here as customers check out."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50/70 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">
                  <th className="px-6 py-3.5 font-semibold">Order</th>
                  <th className="px-6 py-3.5 font-semibold">Customer</th>
                  <th className="px-6 py-3.5 font-semibold">Date</th>
                  <th className="px-6 py-3.5 font-semibold">Status</th>
                  <th className="px-6 py-3.5 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr
                    key={order.id}
                    className="border-t border-stone-100 transition-colors hover:bg-stone-50/50"
                  >
                    <td className="px-6 py-4 font-medium text-stone-900">
                      #{order.orderNumber}
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-stone-800">
                        {order.customerName}
                      </div>
                      <div className="text-xs text-stone-400">
                        {order.user?.email ?? order.customerPhone}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-stone-500">
                      {formatDate(order.createdAt)}
                    </td>
                    <td className="px-6 py-4">
                      <Pill className={STATUS_STYLES[order.status]}>
                        {statusLabel(order.status)}
                      </Pill>
                    </td>
                    <td className="px-6 py-4 text-right font-medium text-stone-900">
                      {formatEGP(order.totalAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
