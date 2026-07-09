"use client";

import { useEffect, useTransition } from "react";
import { Heart } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { useWishlistStore } from "@/lib/wishlist-store";
import { cn } from "@/lib/utils";

type WishlistButtonVariant = "icon" | "labeled";

interface WishlistButtonProps {
  productId: string;
  /** `icon` = floating heart for product cards · `labeled` = inline text button for detail pages. */
  variant?: WishlistButtonVariant;
  className?: string;
}

/**
 * Luxury animated wishlist toggle.
 *
 * Heart state lives in the shared client wishlist store (src/lib/
 * wishlist-store.ts), NOT in a server-seeded prop — catalog pages are served
 * from a shared cache, so the cached HTML paints un-favorited and the store
 * hydrates the user's real hearts right after the session resolves (one fetch
 * per page, shared by every button). Toggling is optimistic in the store and
 * rolls back on failure, so all instances of a product stay in sync.
 */
export default function WishlistButton({
  productId,
  variant = "icon",
  className,
}: WishlistButtonProps) {
  const { data: session, isPending: sessionPending } = useSession();
  const userId = session?.user?.id ?? null;

  const ensureLoaded = useWishlistStore((s) => s.ensureLoaded);
  const toggle = useWishlistStore((s) => s.toggle);
  const favorited = useWishlistStore((s) => s.ids.has(productId));
  const [isPending, startTransition] = useTransition();

  // Hydrate the shared store once the session resolves. Idempotent — the
  // first button on the page performs the single fetch; the rest are no-ops.
  useEffect(() => {
    if (!sessionPending) ensureLoaded(userId);
  }, [sessionPending, userId, ensureLoaded]);

  function handleToggle(e: React.MouseEvent) {
    // Cards usually wrap content in a <Link> — never let the heart navigate.
    e.preventDefault();
    e.stopPropagation();
    if (isPending) return;

    startTransition(async () => {
      // The store applies the optimistic flip synchronously and rolls back
      // itself on failure — this handler only reports the outcome.
      const res = await toggle(productId);

      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success(res.added ? "Added to Wishlist" : "Removed from Wishlist");
    });
  }

  const heart = (
    <motion.span whileTap={{ scale: 0.78 }} className="relative flex">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={favorited ? "filled" : "empty"}
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.5, opacity: 0 }}
          transition={{ type: "spring", stiffness: 520, damping: 18 }}
          className="flex"
        >
          <Heart
            className={cn(
              variant === "icon" ? "h-[18px] w-[18px]" : "h-3.5 w-3.5",
              "transition-colors duration-200",
              favorited
                ? "fill-rose-500 text-rose-500"
                : variant === "icon"
                  ? "fill-transparent text-stone-600 group-hover/wish:text-rose-400"
                  : "fill-transparent group-hover/wish:fill-stone-300",
            )}
            strokeWidth={1.8}
          />
        </motion.span>
      </AnimatePresence>
    </motion.span>
  );

  if (variant === "labeled") {
    return (
      <button
        type="button"
        onClick={handleToggle}
        disabled={isPending}
        aria-pressed={favorited}
        aria-label={favorited ? "Remove from wishlist" : "Add to wishlist"}
        className={cn(
          "group/wish flex w-full items-center justify-center gap-2 font-sans text-xs transition-colors disabled:opacity-70",
          favorited ? "text-rose-500" : "text-stone-400 hover:text-stone-700",
          className,
        )}
      >
        {heart}
        {favorited ? "Saved to Wishlist" : "Save to Wishlist"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={isPending}
      aria-pressed={favorited}
      aria-label={favorited ? "Remove from wishlist" : "Add to wishlist"}
      className={cn(
        "group/wish flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-stone-900 shadow-[0_4px_16px_rgba(0,0,0,0.14)] backdrop-blur transition-all duration-300 hover:bg-white active:scale-95 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2",
        className,
      )}
    >
      {heart}
    </button>
  );
}
