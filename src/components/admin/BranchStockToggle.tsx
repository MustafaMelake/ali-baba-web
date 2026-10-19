"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setBranchStock } from "@/lib/actions/branch-stock";
import { cn } from "@/lib/utils";

/**
 * In-stock switch for ONE variant at ONE branch. Flips optimistically and
 * reverts if the server action fails. Writes only the branch override — the
 * global availability flag is the admin's, on the product form.
 */
export default function BranchStockToggle({
  branchId,
  variantId,
  label,
  isAvailable,
}: {
  branchId: string;
  variantId: string;
  /** e.g. "Chocolate Cake (Large)" — names the switch for screen readers. */
  label: string;
  isAvailable: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState(isAvailable);

  // Re-sync if the server value changes underneath us (e.g. the product-level
  // "mark all" button, or another tab).
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- mirror server truth */
    setOptimistic(isAvailable);
  }, [isAvailable]);

  function handleToggle() {
    const next = !optimistic;
    setOptimistic(next);
    startTransition(async () => {
      const result = await setBranchStock({
        branchId,
        variantIds: [variantId],
        isAvailable: next,
      });
      if (!result.success) {
        setOptimistic(!next);
        toast.error(result.error);
        return;
      }
      toast.success(next ? `${label} is back in stock` : `${label} marked out of stock`);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          "w-[5.5rem] text-right text-xs font-semibold",
          optimistic ? "text-emerald-700" : "text-stone-400",
        )}
      >
        {optimistic ? "In stock" : "Out of stock"}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={optimistic}
        aria-label={`${label} in stock at this branch`}
        onClick={handleToggle}
        disabled={isPending}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60",
          optimistic ? "bg-primary" : "bg-stone-300",
        )}
      >
        <span
          className={cn(
            "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
            optimistic ? "translate-x-5" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}
