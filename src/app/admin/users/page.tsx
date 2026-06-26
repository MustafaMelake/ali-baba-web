import { Users } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/session";
import { formatDate } from "@/lib/utils";
import PageHeader from "@/components/admin/PageHeader";
import EmptyState from "@/components/admin/EmptyState";
import UserRoleEditor from "@/components/admin/UserRoleEditor";

export const metadata = {
  title: "Users | Admin",
};

// Roles mutate in place from this page — always show live data.
export const dynamic = "force-dynamic";

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

export default async function AdminUsersPage() {
  // ADMIN-only; also gives us the caller's id so they can't edit their own role.
  const session = await requireAdminPage();

  const [users, branches] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        branchId: true,
        branch: { select: { name: true } },
      },
    }),
    // Only active branches are assignable from the dropdown.
    prisma.branch.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        eyebrow="People"
        title="Users"
        description="Manage accounts and roles. Assign a manager to the branch they oversee."
      />

      <div className="overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm">
        {users.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No users found"
            description="Registered customers and admins will appear here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50/70 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">
                  <th className="px-6 py-3.5 font-semibold">Name</th>
                  <th className="px-6 py-3.5 font-semibold">Email</th>
                  <th className="px-6 py-3.5 font-semibold">Joined</th>
                  <th className="px-6 py-3.5 font-semibold">Role &amp; Branch</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr
                    key={user.id}
                    className="border-t border-stone-100 transition-colors hover:bg-stone-50/50"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[12px] font-semibold text-primary ring-1 ring-primary/15">
                          {initials(user.name)}
                        </span>
                        <span className="font-medium text-stone-900">
                          {user.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-stone-500">{user.email}</td>
                    <td className="px-6 py-4 text-stone-500">
                      {formatDate(user.createdAt)}
                    </td>
                    <td className="px-6 py-4">
                      <UserRoleEditor
                        user={{
                          id: user.id,
                          name: user.name,
                          role: user.role,
                          branchId: user.branchId,
                          branchName: user.branch?.name ?? null,
                        }}
                        branches={branches}
                        isSelf={session.user.id === user.id}
                      />
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
