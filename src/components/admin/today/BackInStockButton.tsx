"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { clearSoldOutToday } from "@/lib/actions/branch-stock";
import { TODAY_COPY } from "@/lib/today-copy";

/**
 * "Back in stock" for the Sold-out-right-now list: clears every sold-out-today
 * size of one product at the manager's branch. Optimism isn't needed — the row
 * simply leaves the list on refresh — but we still disable while pending.
 */
export default function BackInStockButton({
  productId,
  productName,
}: {
  productId: string;
  productName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await clearSoldOutToday({ productId });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(TODAY_COPY.toastCleared(productName));
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
    >
      {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
      {TODAY_COPY.backInStock}
    </button>
  );
}
