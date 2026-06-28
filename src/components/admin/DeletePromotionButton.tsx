"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Trash2, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { deletePromotion } from "@/lib/actions/promotions";

/**
 * Icon button that expands into an inline "Are you sure?" confirmation before
 * deleting. Deleting a promotion only removes its target links (the implicit
 * m2m join rows) — never the categories/products/variants themselves.
 */
export default function DeletePromotionButton({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deletePromotion(id);
      if (!result.success) {
        toast.error(result.error);
        setConfirming(false);
        return;
      }
      toast.success(`"${name}" deleted`);
      router.refresh();
    });
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      {confirming ? (
        <motion.div
          key="confirm"
          initial={{ opacity: 0, width: 0 }}
          animate={{ opacity: 1, width: "auto" }}
          exit={{ opacity: 0, width: 0 }}
          transition={{ duration: 0.18 }}
          className="inline-flex items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700"
        >
          <span>Delete?</span>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            aria-label={`Confirm delete ${name}`}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-white transition-colors hover:bg-red-700 disabled:opacity-60"
          >
            {isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Check className="h-3 w-3" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={isPending}
            aria-label="Cancel delete"
            className="flex h-5 w-5 items-center justify-center rounded-full text-red-700 transition-colors hover:bg-red-100 disabled:opacity-60"
          >
            <X className="h-3 w-3" />
          </button>
        </motion.div>
      ) : (
        <motion.button
          key="trigger"
          type="button"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => setConfirming(true)}
          aria-label={`Delete ${name}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </motion.button>
      )}
    </AnimatePresence>
  );
}
