"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { togglePromotionActive } from "@/lib/actions/promotions";
import { cn } from "@/lib/utils";

/**
 * Inline on/off switch for a promotion's `isActive`. Flips optimistically for
 * instant feedback and reverts if the server action fails.
 */
export default function PromotionActiveToggle({
  id,
  isActive,
}: {
  id: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState(isActive);

  // Re-sync if the server value changes underneath us (e.g. after refresh).
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- mirror server truth */
    setOptimistic(isActive);
  }, [isActive]);

  function handleToggle() {
    const next = !optimistic;
    setOptimistic(next);
    startTransition(async () => {
      const result = await togglePromotionActive(id, next);
      if (!result.success) {
        setOptimistic(!next);
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={optimistic}
      aria-label={optimistic ? "Deactivate promotion" : "Activate promotion"}
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
  );
}
