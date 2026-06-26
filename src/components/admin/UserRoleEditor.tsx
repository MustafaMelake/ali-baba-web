"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { UserRole } from "@/generated/prisma/enums";
import { updateUserRole } from "@/lib/actions/manage-users";
import Pill from "@/components/admin/Pill";

const ROLE_STYLES: Record<UserRole, string> = {
  USER: "bg-blue-50 text-blue-700 ring-blue-600/10",
  MANAGER: "bg-amber-50 text-amber-700 ring-amber-600/20",
  ADMIN: "bg-primary/10 text-primary ring-primary/20",
};

const ROLE_OPTIONS = Object.values(UserRole);

const selectClasses =
  "rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-700 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60";

export type UserRow = {
  id: string;
  name: string;
  role: UserRole;
  branchId: string | null;
  branchName: string | null;
};

/**
 * Inline role editor for a users-table row. Picking MANAGER reveals a branch
 * dropdown (active branches); switching to USER/ADMIN hides it. A Save button
 * appears only when there are pending changes and submits BOTH role + branchId.
 */
export default function UserRoleEditor({
  user,
  branches,
  isSelf,
}: {
  user: UserRow;
  branches: { id: string; name: string }[];
  isSelf: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [role, setRole] = useState<UserRole>(user.role);
  const [branchId, setBranchId] = useState<string>(user.branchId ?? "");

  // Always keep the user's current branch selectable — even if it's since been
  // deactivated and dropped from the active-branches list.
  const branchOptions = [...branches];
  if (
    user.branchId &&
    user.branchName &&
    !branchOptions.some((b) => b.id === user.branchId)
  ) {
    branchOptions.unshift({
      id: user.branchId,
      name: `${user.branchName} (inactive)`,
    });
  }

  const isManager = role === UserRole.MANAGER;
  const dirty =
    role !== user.role || (isManager && branchId !== (user.branchId ?? ""));
  // A manager save is only valid once a branch is chosen.
  const canSave = dirty && (!isManager || branchId !== "");

  function handleSave() {
    startTransition(async () => {
      const result = await updateUserRole({
        userId: user.id,
        role,
        branchId: isManager ? branchId : null,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`${user.name} updated to ${role}`);
      router.refresh();
    });
  }

  // A Super Admin can't edit their own role (prevents self-lockout).
  if (isSelf) {
    return (
      <div className="flex items-center gap-2">
        <Pill className={ROLE_STYLES[user.role]}>{user.role}</Pill>
        <span className="text-xs text-stone-400">(you)</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label={`Role for ${user.name}`}
        value={role}
        onChange={(e) => setRole(e.target.value as UserRole)}
        disabled={isPending}
        className={selectClasses}
      >
        {ROLE_OPTIONS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>

      {isManager && (
        <select
          aria-label={`Branch for ${user.name}`}
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          disabled={isPending}
          className={selectClasses}
        >
          <option value="">Select branch…</option>
          {branchOptions.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}

      {dirty && (
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave || isPending}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          Save
        </button>
      )}
    </div>
  );
}
