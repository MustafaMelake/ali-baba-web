import { ShoppingBag, SearchX } from "lucide-react";
import { prettyLabel } from "@/lib/utils";
import { OrderStatus } from "@/generated/prisma/enums";
import { getOrders, type GetOrdersResult } from "@/lib/actions/dashboard";
import PageHeader from "@/components/admin/PageHeader";
import EmptyState from "@/components/admin/EmptyState";
import AdminOrderFilters, {
  type TabValue,
} from "@/components/admin/AdminOrderFilters";
import AdminOrdersTable from "@/components/admin/AdminOrdersTable";
import AdminOrdersPagination from "@/components/admin/AdminOrdersPagination";

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
  searchParams: Promise<{
    status?: string;
    query?: string;
    cursor?: string;
    dir?: string;
  }>;
}) {
  const sp = await searchParams;
  const activeStatus = parseStatus(sp.status);
  const q = sp.query?.trim() ?? "";
  // Cursor pagination state: an order id to continue from, plus the walk
  // direction — "prev" is explicit, anything else is the default "next".
  // (getOrders re-validates both; a stale/garbage cursor just yields an
  // empty page with "Previous" as the recovery path.)
  const cursor = sp.cursor?.trim() || undefined;
  const direction = sp.dir === "prev" ? ("prev" as const) : ("next" as const);

  // Fetch + branch RBAC live in getOrders: ADMIN sees every branch, a MANAGER is
  // filtered to their own. A throw means a MANAGER with no branch assigned.
  let result: GetOrdersResult;
  try {
    result = await getOrders({
      status: activeStatus === "ALL" ? undefined : activeStatus,
      query: q,
      cursor,
      direction,
    });
  } catch {
    return (
      <div className="mx-auto max-w-6xl space-y-8">
        <PageHeader
          eyebrow="Commerce"
          title="Orders"
          description="Search, filter and manage every order placed across the store."
        />
        <div className="overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm">
          <EmptyState
            icon={ShoppingBag}
            title="Orders unavailable"
            description="Your manager account isn’t linked to a branch yet. Ask an administrator to assign you to one."
          />
        </div>
      </div>
    );
  }

  const { orders, counts } = result;

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

      {orders.length === 0 ? (
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
        <AdminOrdersTable orders={orders} />
      )}

      {/* Cursor pager through the filtered list. Self-hides when everything
          fits on one page; on a stale-cursor empty page "Previous" remains
          the recovery path back to the canonical first page. */}
      <AdminOrdersPagination
        total={result.total}
        shown={orders.length}
        hasMore={result.hasMore}
        hasPrevious={result.hasPrevious}
        startCursor={result.startCursor}
        endCursor={result.endCursor}
      />
    </div>
  );
}
