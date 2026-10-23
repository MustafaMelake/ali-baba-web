import { notFound, redirect } from "next/navigation";
import { ShoppingBag, Inbox } from "lucide-react";
import { getServerSession, requirePasswordCurrent } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatDate, formatDateTime, prettyLabel } from "@/lib/utils";
import { OrderStatus } from "@/generated/prisma/enums";
import EmptyState from "@/components/EmptyState";
import OrderCard from "@/components/orders/OrderCard";
import OrderStatusTabs from "@/components/orders/OrderStatusTabs";
import type { OrderView } from "@/components/orders/types";
import Pagination from "@/components/Pagination";
import {
  isPageOutOfRange,
  pageInfo,
  pageSlice,
  parsePageParam,
  STOREFRONT_PAGE_SIZE,
} from "@/lib/pagination";

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
  searchParams: Promise<{ status?: string; page?: string | string[] }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  requirePasswordCurrent(session);

  const params = await searchParams;
  const activeStatus = parseStatus(params.status);
  // ?page= — already a per-user, force-dynamic route. Bad page → 404.
  const page = parsePageParam(params.page);
  if (page === null) notFound();

  const where = {
    userId: session.user.id,
    // Only constrain by status when a specific tab is active.
    ...(activeStatus !== "ALL" ? { status: activeStatus } : {}),
  };

  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      // `id` tie-break keeps a stable page order.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...pageSlice(page, STOREFRONT_PAGE_SIZE),
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
    }),
  ]);

  const info = pageInfo(page, STOREFRONT_PAGE_SIZE, total);
  if (isPageOutOfRange(info)) notFound();

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
    // Money columns are Decimal — coerce every one to a number for the client.
    // VAT is the residual, so all three operands convert before the subtraction.
    subtotal: order.subtotal.toNumber(),
    vat: Math.max(
      0,
      order.totalAmount.toNumber() -
        order.subtotal.toNumber() -
        order.deliveryFee.toNumber(),
    ),
    vatRate: order.vatRate,
    deliveryFee: order.deliveryFee.toNumber(),
    totalAmount: order.totalAmount.toNumber(),
    itemCount: order.items.reduce((n, it) => n + it.quantity, 0),
    items: order.items.map((it) => ({
      id: it.id,
      productName: it.productName,
      variantName: it.variantName,
      quantity: it.quantity,
      unitPrice: it.unitPrice.toNumber(),
      lineTotal: it.unitPrice.toNumber() * it.quantity,
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
        <Pagination
          info={info}
          mode={{
            kind: "query",
            base: "/my-orders",
            params: { status: activeStatus !== "ALL" ? activeStatus : undefined },
          }}
        />
      </div>
    </div>
  );
}
