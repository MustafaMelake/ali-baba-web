"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { setBranchStock } from "@/lib/actions/branch-stock";

/**
 * Whole-product shortcut: marks every variant of a product out of stock at the
 * branch — or, once they're all out, back in. One server write for the set.
 */
export default function BranchProductStockButton({
  branchId,
  productName,
  variantIds,
  allOut,
}: {
  branchId: string;
  productName: string;
  variantIds: string[];
  /** Every listed variant is already out at this branch → the button restocks. */
  allOut: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isAvailable = allOut;

  function handleClick() {
    startTransition(async () => {
      const result = await setBranchStock({ branchId, variantIds, isAvailable });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(
        isAvailable
          ? `${productName} is back in stock`
          : `${productName} marked out of stock`,
      );
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-600 transition-colors hover:border-stone-300 hover:bg-stone-50 hover:text-stone-900 disabled:opacity-60"
    >
      {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {allOut ? "Mark all in stock" : "Mark all out of stock"}
    </button>
  );
}
