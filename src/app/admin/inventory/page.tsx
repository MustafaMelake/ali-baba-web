import Link from "next/link";
import { Boxes, ImageIcon, Package } from "lucide-react";
import { prisma } from "@/lib/prisma";
import {
  requireDashboardAccess,
  resolveBranchScope,
  type DashboardScope,
} from "@/lib/session";
import { LISTABLE_PRODUCT, variantLabel } from "@/lib/catalog";
import { cn, formatEGP } from "@/lib/utils";
import PageHeader from "@/components/admin/PageHeader";
import EmptyState from "@/components/admin/EmptyState";
import Pill from "@/components/admin/Pill";
import BranchStockToggle from "@/components/admin/BranchStockToggle";
import BranchProductStockButton from "@/components/admin/BranchProductStockButton";

export const metadata = {
  title: "Branch Stock | Admin",
};

// Stock flips in place and must show the live state on refresh.
export const dynamic = "force-dynamic";

const HEADER = {
  eyebrow: "Catalog",
  title: "Branch Stock",
} as const;

/**
 * Branch inventory — ADMIN and MANAGER.
 *
 *   - MANAGER → pinned to their own branch; `?branch=` is ignored, never trusted.
 *   - ADMIN   → any branch via `?branch=<id>` (defaults to the first active one).
 *
 * Lists the ACTIVE catalog only (LISTABLE_PRODUCT + available variants): an
 * item the admin switched off globally is out everywhere, so there is nothing
 * for a branch to toggle. Every control here writes a branch override only —
 * editing or deleting the product itself stays on the ADMIN-only products page.
 */
export default async function AdminInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  let scope: DashboardScope;
  try {
    scope = await requireDashboardAccess();
  } catch {
    return (
      <div className="mx-auto max-w-6xl space-y-8">
        <PageHeader {...HEADER} />
        <div className="overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm">
          <EmptyState
            icon={Boxes}
            title="Branch stock unavailable"
            description="Your manager account isn’t linked to a branch yet. Ask an administrator to assign you to one."
          />
        </div>
      </div>
    );
  }

  const sp = await searchParams;

  // The branch picker is ADMIN-only; a manager sees exactly one branch.
  const branches = await prisma.branch.findMany({
    where: scope.role === "MANAGER" ? { id: scope.branchId } : undefined,
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: { id: true, name: true, isActive: true },
  });

  // An ADMIN's ?branch= must name a real branch; anything else falls back to
  // the first (active-first) one. A MANAGER's URL param is dropped before
  // resolveBranchScope, so a hand-edited link can't even reach the check.
  const requested =
    scope.role === "ADMIN"
      ? (branches.find((b) => b.id === sp.branch) ?? branches[0])?.id
      : undefined;
  const branchId = resolveBranchScope(scope, requested);
  const branch = branches.find((b) => b.id === branchId);

  if (!branchId || !branch) {
    return (
      <div className="mx-auto max-w-6xl space-y-8">
        <PageHeader {...HEADER} />
        <div className="overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm">
          <EmptyState
            icon={Boxes}
            title="No branches yet"
            description="Create a branch first — stock is tracked per branch."
          />
        </div>
      </div>
    );
  }

  const products = await prisma.product.findMany({
    where: LISTABLE_PRODUCT,
    orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      images: true,
      category: { select: { name: true } },
      variants: {
        where: { isAvailable: true },
        orderBy: { price: "asc" },
        select: {
          id: true,
          name: true,
          price: true,
          // This branch's override only — no row means in stock.
          branchAvailability: {
            where: { branchId },
            select: { isAvailable: true },
          },
        },
      },
    },
  });

  // Flatten the override into a plain boolean (and the Decimal price into a
  // number) before anything reaches a client island.
  const rows = products.map((product) => {
    const variants = product.variants.map((v) => ({
      id: v.id,
      name: v.name,
      price: v.price.toNumber(),
      inStock: v.branchAvailability[0]?.isAvailable !== false,
    }));
    return {
      ...product,
      variants,
      outCount: variants.filter((v) => !v.inStock).length,
    };
  });
  const totalOut = rows.reduce((sum, p) => sum + p.outCount, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        {...HEADER}
        description={
          scope.role === "MANAGER"
            ? `What ${branch.name} can fulfil right now. Items you switch off can’t be ordered from this branch; everything else stays as the admin set it.`
            : "Per-branch stock. A branch can only switch off items that are live store-wide — the product’s own availability stays on the Products page."
        }
      />

      {scope.role === "ADMIN" && branches.length > 1 && (
        <nav aria-label="Branch" className="flex flex-wrap gap-2">
          {branches.map((b) => (
            <Link
              key={b.id}
              href={`/admin/inventory?branch=${encodeURIComponent(b.id)}`}
              aria-current={b.id === branchId ? "page" : undefined}
              className={cn(
                "rounded-full px-4 py-2 text-sm font-medium transition-colors",
                b.id === branchId
                  ? "bg-stone-900 text-white"
                  : "border border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:text-stone-900",
              )}
            >
              {b.name}
              {!b.isActive && (
                <span className="ml-1.5 text-xs opacity-60">(inactive)</span>
              )}
            </Link>
          ))}
        </nav>
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm text-stone-500">
        <span className="font-serif text-xl font-medium text-stone-900">
          {branch.name}
        </span>
        {totalOut === 0 ? (
          <Pill className="bg-emerald-50 text-emerald-700 ring-emerald-600/20">
            Everything in stock
          </Pill>
        ) : (
          <Pill className="bg-amber-50 text-amber-800 ring-amber-600/20">
            <span className="tabular-nums">{totalOut}</span> item
            {totalOut === 1 ? "" : "s"} out of stock
          </Pill>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm">
        {rows.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No live products"
            description="Products the admin publishes appear here."
          />
        ) : (
          <ul className="divide-y divide-stone-100">
            {rows.map((product) => {
              const thumb = product.images[0];
              return (
                <li key={product.id} className="px-4 py-5 sm:px-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {/* CSS background avoids next/image remote-domain config */}
                      <div
                        className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-stone-100 bg-cover bg-center text-stone-300"
                        style={thumb ? { backgroundImage: `url(${thumb})` } : undefined}
                      >
                        {!thumb && <ImageIcon className="h-5 w-5" />}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-medium text-stone-900">
                          {product.name}
                        </div>
                        <div className="text-xs text-stone-400">
                          {product.category.name}
                          {product.outCount > 0 && (
                            <span className="text-amber-700">
                              {" · "}
                              <span className="tabular-nums">{product.outCount}</span>{" "}
                              of{" "}
                              <span className="tabular-nums">{product.variants.length}</span>{" "}
                              out
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {product.variants.length > 1 && (
                      <BranchProductStockButton
                        branchId={branchId}
                        productName={product.name}
                        variantIds={product.variants.map((v) => v.id)}
                        allOut={product.outCount === product.variants.length}
                      />
                    )}
                  </div>

                  <ul className="mt-3 space-y-2 sm:pl-14">
                    {product.variants.map((variant) => (
                      <li
                        key={variant.id}
                        className={cn(
                          "flex items-center justify-between gap-4 rounded-xl px-3 py-2",
                          variant.inStock ? "bg-stone-50/70" : "bg-amber-50/60",
                        )}
                      >
                        <span className="min-w-0 text-sm text-stone-700">
                          <span className="font-medium">{variant.name}</span>
                          <span className="ml-2 text-xs text-stone-400 tabular-nums">
                            {formatEGP(variant.price)}
                          </span>
                        </span>
                        <BranchStockToggle
                          branchId={branchId}
                          variantId={variant.id}
                          label={variantLabel(product.name, variant.name)}
                          isAvailable={variant.inStock}
                        />
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
