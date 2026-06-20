"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Trash2, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { approveReview, deleteReview } from "@/lib/actions/reviews";

export default function ReviewActions({
  reviewId,
  isApproved,
}: {
  reviewId: string;
  isApproved: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function approve() {
    startTransition(async () => {
      const result = await approveReview(reviewId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Review approved");
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteReview(reviewId);
      if (!result.success) {
        toast.error(result.error);
        setConfirming(false);
        return;
      }
      toast.success("Review deleted");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      {!isApproved && (
        <button
          type="button"
          onClick={approve}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          Approve
        </button>
      )}

      {/* Reject / delete with inline confirmation */}
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
              onClick={remove}
              disabled={isPending}
              aria-label="Confirm delete review"
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
            aria-label="Delete review"
            className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 px-3.5 py-1.5 text-xs font-semibold text-stone-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {isApproved ? "Delete" : "Reject"}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
