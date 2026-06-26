import { Building2 } from "lucide-react";
import { requireAdminPage } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/utils";
import PageHeader from "@/components/admin/PageHeader";
import EmptyState from "@/components/admin/EmptyState";
import Pill from "@/components/admin/Pill";
import CreateBranchButton from "@/components/admin/CreateBranchButton";
import BranchEditButton from "@/components/admin/BranchEditButton";
import DeleteBranchButton from "@/components/admin/DeleteBranchButton";

export const metadata = {
  title: "Branches | Admin",
};

// Branch list mutates in place (create/edit/delete) — always show live data.
export const dynamic = "force-dynamic";

export default async function AdminBranchesPage() {
  // ADMIN-only: the shared layout admits MANAGERs, so this bounces them to /admin.
  await requireAdminPage();

  const branches = await prisma.branch.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      slug: true,
      isActive: true,
      createdAt: true,
      // Live relation counts give the admin context before deleting a branch.
      _count: { select: { managers: true, orders: true } },
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        eyebrow="Operations"
        title="Branches"
        description="Create and manage your physical locations. Each manager is scoped to a single branch."
        action={<CreateBranchButton />}
      />

      <div className="overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm">
        {branches.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No branches yet"
            description="Add your first branch to start assigning managers and routing orders."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50/70 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">
                  <th className="px-6 py-3.5 font-semibold">Branch</th>
                  <th className="px-6 py-3.5 font-semibold">Status</th>
                  <th className="px-6 py-3.5 font-semibold">Managers</th>
                  <th className="px-6 py-3.5 font-semibold">Orders</th>
                  <th className="px-6 py-3.5 font-semibold">Created</th>
                  <th className="px-6 py-3.5 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {branches.map((b) => (
                  <tr
                    key={b.id}
                    className="border-t border-stone-100 transition-colors hover:bg-stone-50/50"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <Building2 className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="font-medium text-stone-900">{b.name}</p>
                          <p className="text-xs text-stone-400">/{b.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {b.isActive ? (
                        <Pill className="bg-emerald-50 text-emerald-700 ring-emerald-600/20">
                          Active
                        </Pill>
                      ) : (
                        <Pill className="bg-stone-100 text-stone-500 ring-stone-500/20">
                          Inactive
                        </Pill>
                      )}
                    </td>
                    <td className="px-6 py-4 text-stone-500">
                      {b._count.managers}
                    </td>
                    <td className="px-6 py-4 text-stone-500">
                      {b._count.orders}
                    </td>
                    <td className="px-6 py-4 text-stone-500">
                      {formatDate(b.createdAt)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <BranchEditButton
                          branch={{
                            id: b.id,
                            name: b.name,
                            slug: b.slug,
                            isActive: b.isActive,
                          }}
                        />
                        <DeleteBranchButton id={b.id} name={b.name} />
                      </div>
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
