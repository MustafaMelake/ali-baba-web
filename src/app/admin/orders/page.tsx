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

/** Parse ?page= into a 1-based integer — anything invalid falls back to 1
 *  (getOrders re-clamps defensively; this keeps the two in agreement). */
function parsePage(raw?: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : 1;
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; query?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const activeStatus = parseStatus(sp.status);
  const q = sp.query?.trim() ?? "";
  const page = parsePage(sp.page);

  // Fetch + branch RBAC live in getOrders: ADMIN sees every branch, a MANAGER is
  // filtered to their own. A throw means a MANAGER with no branch assigned.
  let result: GetOrdersResult;
  try {
    result = await getOrders({
      status: activeStatus === "ALL" ? undefined : activeStatus,
      query: q,
      page,
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

      {/* Prev/Next through the filtered list. Self-hides on a single page;
          stays rendered on an out-of-range page (stale ?page= URL) so
          "Previous" remains the recovery path back into the data. */}
      <AdminOrdersPagination
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        shown={orders.length}
        hasMore={result.hasMore}
      />
    </div>
  );
}
