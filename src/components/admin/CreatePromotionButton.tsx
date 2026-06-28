"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import PromotionModal, {
  type PromotionFormOptions,
} from "@/components/admin/PromotionModal";

/**
 * Client island for the (Server Component) promotions page header action:
 * owns the open state and renders the creation modal.
 */
export default function CreatePromotionButton({
  options,
}: {
  options: PromotionFormOptions;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
      >
        <Plus className="h-4 w-4" />
        Create Promotion
      </button>

      <PromotionModal
        options={options}
        isOpen={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
