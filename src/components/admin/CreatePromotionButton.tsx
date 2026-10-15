"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import PromotionModal, {
  type PromotionDraft,
  type PromotionFormOptions,
} from "@/components/admin/PromotionModal";

/**
 * Client island for the (Server Component) promotions page header action:
 * owns the open state and renders the creation modal. Given a `draft` (the
 * marketing calendar's "Create promotion" hand-off, parsed from the URL by the
 * page) it opens pre-filled straight away.
 */
export default function CreatePromotionButton({
  options,
  draft,
}: {
  options: PromotionFormOptions;
  draft?: PromotionDraft;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(draft));

  function close() {
    setOpen(false);
    // Drop the hand-off query so a refresh doesn't reopen the pre-filled form.
    if (draft) router.replace("/admin/promotions", { scroll: false });
  }

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

      <PromotionModal options={options} draft={draft} isOpen={open} onClose={close} />
    </>
  );
}
