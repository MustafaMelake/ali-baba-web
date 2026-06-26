import { Users } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/session";
import { formatDate } from "@/lib/utils";
import type { UserRole } from "@/generated/prisma/enums";
import PageHeader from "@/components/admin/PageHeader";
import EmptyState from "@/components/admin/EmptyState";
import Pill from "@/components/admin/Pill";

export const metadata = {
  title: "Users | Admin",
};

// USER → subtle blue, MANAGER → amber, ADMIN → distinct turquoise (brand primary).
const ROLE_STYLES: Record<UserRole, string> = {
  USER: "bg-blue-50 text-blue-700 ring-blue-600/10",
  MANAGER: "bg-amber-50 text-amber-700 ring-amber-600/20",
  ADMIN: "bg-primary/10 text-primary ring-primary/20",
};

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
  await requireAdminPage();

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        eyebrow="People"
        title="Users"
        description="Everyone with an account, newest first."
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
                  <th className="px-6 py-3.5 font-semibold">Role</th>
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
                      <Pill className={ROLE_STYLES[user.role]}>{user.role}</Pill>
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
