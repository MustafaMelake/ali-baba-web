import { BadgePercent } from "lucide-react";
import { requireAdminPage } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatDate, formatEGP } from "@/lib/utils";
import { DiscountType } from "@/generated/prisma/enums";
import PageHeader from "@/components/admin/PageHeader";
import EmptyState from "@/components/admin/EmptyState";
import Pill from "@/components/admin/Pill";
import CreatePromotionButton from "@/components/admin/CreatePromotionButton";
import PromotionEditButton from "@/components/admin/PromotionEditButton";
import DeletePromotionButton from "@/components/admin/DeletePromotionButton";
import PromotionActiveToggle from "@/components/admin/PromotionActiveToggle";
import type { PromotionFormOptions } from "@/components/admin/PromotionModal";

export const metadata = {
  title: "Promotions | Admin",
};

// Promotions mutate in place (create/edit/toggle/delete) — always show live data.
export const dynamic = "force-dynamic";

/** Human discount label, e.g. "15% off" or "EGP 50 off". */
function discountLabel(type: string, value: number) {
  return type === DiscountType.PERCENTAGE
    ? `${value}% off`
    : `${formatEGP(value)} off`;
}

/** Derive a promotion's live schedule state from its date window. */
function scheduleState(start: Date, end: Date) {
  const now = Date.now();
  if (now < start.getTime()) {
    return { label: "Scheduled", cls: "bg-amber-50 text-amber-700 ring-amber-600/20" };
  }
  if (now > end.getTime()) {
    return { label: "Expired", cls: "bg-stone-100 text-stone-500 ring-stone-500/20" };
  }
  return { label: "Live", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" };
}

export default async function AdminPromotionsPage() {
  // ADMIN-only: the shared layout admits MANAGERs, so this bounces them to /admin.
  await requireAdminPage();

  const [promotions, categories, products] = await Promise.all([
    prisma.promotion.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        type: true,
        value: true,
        startDate: true,
        endDate: true,
        isActive: true,
        categories: { select: { id: true } },
        products: { select: { id: true } },
        variants: { select: { id: true } },
        _count: { select: { categories: true, products: true, variants: true } },
      },
    }),
    prisma.category.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.product.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        variants: {
          orderBy: { price: "asc" },
          select: { id: true, name: true, price: true },
        },
      },
    }),
  ]);

  // Option lists shared by every Create/Edit modal on the page.
  const options: PromotionFormOptions = {
    categories: categories.map((c) => ({ value: c.id, label: c.name })),
    products: products.map((p) => ({
      value: p.id,
      label: p.name,
      hint: `${p.variants.length} variant${p.variants.length === 1 ? "" : "s"}`,
    })),
    variants: products.flatMap((p) =>
      p.variants.map((v) => ({
        value: v.id,
        label: `${p.name} — ${v.name}`,
        hint: formatEGP(v.price),
      })),
    ),
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        eyebrow="Merchandising"
        title="Promotions"
        description="Create time-boxed discounts and target them at specific categories, products or variants."
        action={<CreatePromotionButton options={options} />}
      />

      <div className="overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm">
        {promotions.length === 0 ? (
          <EmptyState
            icon={BadgePercent}
            title="No promotions yet"
            description="Create your first promotion to start running targeted discounts."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50/70 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">
                  <th className="px-6 py-3.5 font-semibold">Promotion</th>
                  <th className="px-6 py-3.5 font-semibold">Discount</th>
                  <th className="px-6 py-3.5 font-semibold">Window</th>
                  <th className="px-6 py-3.5 font-semibold">Targets</th>
                  <th className="px-6 py-3.5 font-semibold">Active</th>
                  <th className="px-6 py-3.5 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {promotions.map((p) => {
                  const schedule = scheduleState(p.startDate, p.endDate);
                  return (
                    <tr
                      key={p.id}
                      className="border-t border-stone-100 transition-colors hover:bg-stone-50/50"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                            <BadgePercent className="h-4 w-4" />
                          </span>
                          <p className="min-w-0 font-medium text-stone-900">{p.name}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-medium text-stone-900">
                          {discountLabel(p.type, p.value)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1.5">
                          <span className="whitespace-nowrap text-stone-500">
                            {formatDate(p.startDate)} → {formatDate(p.endDate)}
                          </span>
                          {p.isActive ? (
                            <Pill className={schedule.cls}>{schedule.label}</Pill>
                          ) : (
                            <Pill className="bg-stone-100 text-stone-500 ring-stone-500/20">
                              Inactive
                            </Pill>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-stone-500">
                        <div className="flex flex-wrap gap-1.5">
                          {p._count.categories > 0 && (
                            <Pill className="bg-stone-100 text-stone-600 ring-stone-500/15">
                              {p._count.categories} cat
                            </Pill>
                          )}
                          {p._count.products > 0 && (
                            <Pill className="bg-stone-100 text-stone-600 ring-stone-500/15">
                              {p._count.products} prod
                            </Pill>
                          )}
                          {p._count.variants > 0 && (
                            <Pill className="bg-stone-100 text-stone-600 ring-stone-500/15">
                              {p._count.variants} var
                            </Pill>
                          )}
                          {p._count.categories + p._count.products + p._count.variants === 0 && (
                            <span className="text-xs text-stone-400">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <PromotionActiveToggle id={p.id} isActive={p.isActive} />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <PromotionEditButton
                            promotion={{
                              id: p.id,
                              name: p.name,
                              type: p.type,
                              value: p.value,
                              startDate: p.startDate.toISOString(),
                              endDate: p.endDate.toISOString(),
                              isActive: p.isActive,
                              categoryIds: p.categories.map((c) => c.id),
                              productIds: p.products.map((x) => x.id),
                              variantIds: p.variants.map((v) => v.id),
                            }}
                            options={options}
                          />
                          <DeletePromotionButton id={p.id} name={p.name} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
