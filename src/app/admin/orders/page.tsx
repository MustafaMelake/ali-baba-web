import { ShoppingBag, SearchX } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatDate, formatDateTime, prettyLabel } from "@/lib/utils";
import { OrderStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import PageHeader from "@/components/admin/PageHeader";
import EmptyState from "@/components/admin/EmptyState";
import AdminOrderFilters, {
  type TabValue,
} from "@/components/admin/AdminOrderFilters";
import AdminOrdersTable from "@/components/admin/AdminOrdersTable";
import type { AdminOrderView } from "@/components/admin/order-types";

export const metadata = {
  title: "Orders | Admin",
};

// Always reflect the live database (admin board mutates status in place).
export const dynamic = "force-dynamic";

/** Validate the ?status= param against the enum — never trust the raw URL. */
function parseStatus(raw?: string): TabValue {
  if (raw && raw in OrderStatus) return raw as OrderStatus;
  return "ALL";
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; query?: string }>;
}) {
  const sp = await searchParams;
  const activeStatus = parseStatus(sp.status);
  const q = sp.query?.trim() ?? "";

  // Order # is an Int column, so Prisma can't `contains` on it directly —
  // a raw ::text cast lets staff search "100" and match order #10024.
  const numericOrderIds =
    q && /\d/.test(q)
      ? (
          await prisma.$queryRaw<{ id: string }[]>`
            SELECT id FROM "Order" WHERE "orderNumber"::text ILIKE ${`%${q}%`}
          `
        ).map((row) => row.id)
      : [];

  // Search clause (order # partial-numeric, or name/phone contains). Reused
  // for the counters so they reflect the current search context.
  const searchWhere: Prisma.OrderWhereInput = q
    ? {
        OR: [
          { customerName: { contains: q, mode: "insensitive" } },
          { customerPhone: { contains: q } },
          ...(numericOrderIds.length ? [{ id: { in: numericOrderIds } }] : []),
        ],
      }
    : {};

  const listWhere: Prisma.OrderWhereInput = {
    ...searchWhere,
    ...(activeStatus !== "ALL" ? { status: activeStatus } : {}),
  };

  const [orders, grouped] = await Promise.all([
    prisma.order.findMany({
      where: listWhere,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        user: { select: { email: true } },
        items: {
          select: {
            id: true,
            productName: true,
            variantName: true,
            unitPrice: true,
            quantity: true,
          },
        },
      },
    }),
    prisma.order.groupBy({
      by: ["status"],
      where: searchWhere,
      _count: { _all: true },
    }),
  ]);

  // Per-status counters (+ ALL total) for the tab bar.
  const counts: Record<TabValue, number> = {
    ALL: 0,
    PENDING: 0,
    PREPARING: 0,
    SHIPPED: 0,
    DELIVERED: 0,
    CANCELLED: 0,
  };
  for (const g of grouped) {
    counts[g.status] = g._count._all;
    counts.ALL += g._count._all;
  }

  // Serialize for the client table/drawer; VAT is the residual so receipts
  // reconcile to the canonical totalAmount.
  const view: AdminOrderView[] = orders.map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    dateLabel: formatDate(order.createdAt),
    dateTimeLabel: formatDateTime(order.createdAt),
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    orderNotes: order.orderNotes,
    fulfillment: order.fulfillment,
    deliveryCity: order.deliveryCity,
    addressLine: order.addressLine,
    pickupBranch: order.pickupBranch,
    subtotal: order.subtotal,
    vat: Math.max(0, order.totalAmount - order.subtotal - order.deliveryFee),
    deliveryFee: order.deliveryFee,
    totalAmount: order.totalAmount,
    itemCount: order.items.reduce((n, it) => n + it.quantity, 0),
    items: order.items.map((it) => ({
      id: it.id,
      productName: it.productName,
      variantName: it.variantName,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      lineTotal: it.unitPrice * it.quantity,
    })),
    userEmail: order.user?.email ?? null,
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        eyebrow="Commerce"
        title="Orders"
        description="Search, filter and manage every order placed across the store."
      />

      <AdminOrderFilters
        activeStatus={activeStatus}
        query={q}
        counts={counts}
      />

      {view.length === 0 ? (
        <div className="overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm">
          {q ? (
            <EmptyState
              icon={SearchX}
              title={`No orders match “${q}”`}
              description="Try a different order number, customer name or phone number."
            />
          ) : activeStatus !== "ALL" ? (
            <EmptyState
              icon={ShoppingBag}
              title={`No ${prettyLabel(activeStatus)} orders`}
              description="There are no orders in this status right now."
            />
          ) : (
            <EmptyState
              icon={ShoppingBag}
              title="No orders found"
              description="New orders will appear here as customers check out."
            />
          )}
        </div>
      ) : (
        <AdminOrdersTable orders={view} />
      )}
    </div>
  );
}
