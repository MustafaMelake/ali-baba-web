import { redirect } from "next/navigation";
import { ShoppingBag, Inbox } from "lucide-react";
import { getServerSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatDate, formatDateTime, prettyLabel } from "@/lib/utils";
import { OrderStatus } from "@/generated/prisma/enums";
import EmptyState from "@/components/EmptyState";
import OrderCard from "@/components/orders/OrderCard";
import OrderStatusTabs from "@/components/orders/OrderStatusTabs";
import type { OrderView } from "@/components/orders/types";

// Personalised to the signed-in user → always render against the live DB.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "My Orders | Ali Baba",
};

type StatusFilter = OrderStatus | "ALL";

/** Validate the ?status= param against the enum — never trust the raw URL. */
function parseStatus(raw?: string): StatusFilter {
  if (raw && raw in OrderStatus) return raw as OrderStatus;
  return "ALL";
}

export default async function MyOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const activeStatus = parseStatus((await searchParams).status);

  const orders = await prisma.order.findMany({
    where: {
      userId: session.user.id,
      // Only constrain by status when a specific tab is active.
      ...(activeStatus !== "ALL" ? { status: activeStatus } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      branch: { select: { name: true } },
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
  });

  // Serialize for the client: money stays raw (formatted client-side), dates are
  // pre-formatted server-side, VAT is the residual so the receipt reconciles.
  const view: OrderView[] = orders.map((order) => ({
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
    branchName: order.branch?.name ?? null,
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
  }));

  const isFiltered = activeStatus !== "ALL";

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="mx-auto max-w-3xl px-6 py-12 md:py-16">
        {/* ── Header ─────────────────────────────────────────── */}
        <header className="mb-8">
          <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.3em] text-primary">
            Order history
          </p>
          <h1 className="mt-2 font-serif text-4xl font-medium tracking-tight text-stone-900 md:text-5xl">
            My Orders
          </h1>
        </header>

        {/* ── Status tabs (server-driven filter) ─────────────── */}
        <OrderStatusTabs activeStatus={activeStatus} />

        {view.length === 0 ? (
          isFiltered ? (
            <EmptyState
              icon={Inbox}
              title={`No ${prettyLabel(activeStatus)} orders`}
              description="You have no orders in this status right now. Try another filter or view everything."
              action={{ href: "/my-orders", label: "View All Orders" }}
            />
          ) : (
            <EmptyState
              icon={ShoppingBag}
              title="No orders yet"
              description="When you place your first order, it will appear here with live status updates."
              action={{ href: "/shop", label: "Start Shopping" }}
            />
          )
        ) : (
          <div className="space-y-4">
            {view.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
