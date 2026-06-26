"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import BranchModal, { type EditableBranch } from "@/components/admin/BranchModal";

/**
 * Client island for a branches-table row: owns the open state and renders the
 * controlled <BranchModal /> in edit mode.
 */
export default function BranchEditButton({
  branch,
}: {
  branch: EditableBranch;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-600 transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
      >
        <Pencil className="h-3.5 w-3.5" />
        Edit
      </button>

      <BranchModal
        branch={branch}
        isOpen={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
