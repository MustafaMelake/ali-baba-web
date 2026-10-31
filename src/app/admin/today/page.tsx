import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Boxes, CalendarClock, CircleCheck, Package, SearchX } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireDashboardAccess, type DashboardScope } from "@/lib/session";
import { LISTABLE_PRODUCT, isSoldOutToday } from "@/lib/catalog";
import { parseStockQuery } from "@/lib/branch-stock-filter";
import { searchTokens } from "@/lib/validators";
import {
  ADMIN_PAGE_SIZE,
  isPageOutOfRange,
  pageInfo,
  pageSlice,
  parsePageParam,
} from "@/lib/pagination";
import { TODAY_COPY } from "@/lib/today-copy";
import Pagination from "@/components/Pagination";
import PageHeader from "@/components/admin/PageHeader";
import EmptyState from "@/components/admin/EmptyState";
import TodaySearch from "@/components/admin/today/TodaySearch";
import TodayProductRow from "@/components/admin/today/TodayProductRow";
import BackInStockButton from "@/components/admin/today/BackInStockButton";
import type { TodayProduct, TodayVariantState } from "@/components/admin/today/types";

export const metadata = { title: "Today | Admin" };

// Live, per-manager, per-branch — must never be cached.
export const dynamic = "force-dynamic";

const HEADER = { eyebrow: TODAY_COPY.eyebrow, title: TODAY_COPY.title } as const;

/**
 * Manager "Today" page — a MANAGER marks what their branch has run out of for
 * the rest of the Cairo day; it comes back on its own at midnight. MANAGER-only:
 * an ADMIN who lands here (the link is hidden from them) is pointed at the
 * Branch Stock screen, which carries the long-term switch and a read-only
 * sold-out-today badge.
 *
 * Mobile-first. The whole branch catalogue is loaded once (the sold-out-now
 * summary needs every variant anyway), then searched (`?q=`) and paginated
 * (`?page=`) in memory — the same shape as /admin/inventory.
 */
export default async function AdminTodayPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  let scope: DashboardScope;
  try {
    scope = await requireDashboardAccess();
  } catch {
    return (
      <div className="mx-auto max-w-5xl space-y-8">
        <PageHeader {...HEADER} />
        <div className="overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm">
          <EmptyState
            icon={CalendarClock}
            title="Today is unavailable"
            description="Your manager account isn’t linked to a branch yet. Ask an administrator to assign you to one."
          />
        </div>
      </div>
    );
  }

  // MANAGER-only: an ADMIN sees branch stock (with a read-only badge) instead.
  if (scope.role !== "MANAGER") {
    return (
      <div className="mx-auto max-w-5xl space-y-8">
        <PageHeader {...HEADER} />
        <div className="overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm">
          <EmptyState
            icon={Boxes}
            title="For branch managers"
            description="“Sold out today” is set by the branch’s manager. As an admin you can see each branch’s long-term stock — and a read-only “sold out today” badge — on the Branch Stock screen."
          />
          <div className="border-t border-stone-100 px-6 py-4 text-center">
            <Link
              href="/admin/inventory"
              className="text-sm font-semibold text-primary hover:underline"
            >
              Go to Branch Stock →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const now = new Date();
  const branchId = scope.branchId;
  const sp = await searchParams;
  const query = parseStockQuery(sp.q);
  const page = parsePageParam(sp.page);
  if (page === null) notFound();

  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { name: true },
  });
  if (!branch) {
    return (
      <div className="mx-auto max-w-5xl space-y-8">
        <PageHeader {...HEADER} />
        <div className="overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm">
          <EmptyState
            icon={CalendarClock}
            title="Today is unavailable"
            description="Your branch no longer exists. Ask an administrator to reassign you."
          />
        </div>
      </div>
    );
  }

  // The whole listable catalogue, with EVERY variant (head-office-off sizes are
  // shown disabled) and this branch's override, so availability is resolved
  // against the single `now`.
  const products = await prisma.product.findMany({
    where: LISTABLE_PRODUCT,
    orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      images: true,
      category: { select: { name: true } },
      variants: {
        orderBy: { price: "asc" },
        select: {
          id: true,
          name: true,
          sku: true,
          price: true,
          isAvailable: true,
          branchAvailability: {
            where: { branchId },
            select: { isAvailable: true, soldOutUntil: true },
          },
        },
      },
    },
  });

  // Resolve each variant's state once (Decimal → number at this boundary).
  const rows: (TodayProduct & { sku: string[] })[] = products.map((product) => {
    const sizes = product.variants.map((v) => {
      const override = v.branchAvailability[0];
      const off = !v.isAvailable || override?.isAvailable === false;
      const state: TodayVariantState = off
        ? "off"
        : isSoldOutToday(override, now)
          ? "sold_out_today"
          : "available";
      return { id: v.id, name: v.name, price: v.price.toNumber(), state };
    });
    return {
      id: product.id,
      name: product.name,
      image: product.images[0] ?? null,
      category: product.category.name,
      sizes,
      sku: product.variants.map((v) => v.sku ?? ""),
    };
  });

  // Sold out right now (branch-wide, not filtered/paginated) — grouped by product.
  const soldOutNow = rows
    .map((p) => ({
      id: p.id,
      name: p.name,
      sizes: p.sizes.filter((s) => s.state === "sold_out_today"),
    }))
    .filter((p) => p.sizes.length > 0);

  // Search over product / category / size / SKU (every word must hit somewhere).
  const tokens = searchTokens(query.toLowerCase());
  const matched =
    tokens.length === 0
      ? rows
      : rows.filter((p) => {
          const haystack = [p.name, p.category, ...p.sizes.map((s) => s.name), ...p.sku]
            .join(" ")
            .toLowerCase();
          return tokens.every((t) => haystack.includes(t));
        });

  const info = pageInfo(page, ADMIN_PAGE_SIZE, matched.length);
  if (isPageOutOfRange(info)) notFound();
  const { skip, take } = pageSlice(page, ADMIN_PAGE_SIZE);
  const pageRows = matched.slice(skip, skip + take);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader {...HEADER} description={TODAY_COPY.description(branch.name)} />

      {/* Sold out right now */}
      <section className="overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm">
        <h2 className="border-b border-stone-100 px-4 py-3 text-sm font-semibold text-stone-900 sm:px-6">
          {TODAY_COPY.soldOutNowTitle}
          {soldOutNow.length > 0 && (
            <span className="ms-2 text-xs font-normal text-stone-400 tabular-nums">
              {soldOutNow.length}
            </span>
          )}
        </h2>
        {soldOutNow.length === 0 ? (
          <div className="flex items-center gap-2.5 px-4 py-4 text-sm text-stone-500 sm:px-6">
            <CircleCheck className="h-4 w-4 shrink-0 text-emerald-600" />
            {TODAY_COPY.soldOutNowEmpty}
          </div>
        ) : (
          <ul className="divide-y divide-stone-100">
            {soldOutNow.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-stone-900">{p.name}</div>
                  <div className="truncate text-xs text-stone-400">
                    {p.sizes.map((s) => s.name).join(" · ")}
                  </div>
                </div>
                <BackInStockButton productId={p.id} productName={p.name} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Search */}
      <Suspense fallback={<div className="h-12" />}>
        <TodaySearch />
      </Suspense>

      {/* The branch catalogue */}
      <div className="overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm">
        {rows.length === 0 ? (
          <EmptyState
            icon={Package}
            title={TODAY_COPY.noProducts}
            description="Products the admin publishes appear here."
          />
        ) : matched.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title={TODAY_COPY.noMatches(query)}
            description="Try a product name, size, SKU or category."
          />
        ) : (
          <ul className="divide-y divide-stone-100">
            {pageRows.map((product) => (
              <TodayProductRow key={product.id} product={product} />
            ))}
          </ul>
        )}
      </div>

      <Pagination
        info={info}
        mode={{ kind: "query", base: "/admin/today", params: { q: query || undefined } }}
        tone="admin"
      />
    </div>
  );
}
