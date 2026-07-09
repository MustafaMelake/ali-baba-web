"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LogIn } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { hasUserReviewedProduct } from "@/lib/actions/reviews";
import ReviewForm from "@/components/ReviewForm";

/**
 * Client-side gate for the PDP review form.
 *
 * The PDP is served from a shared ISR cache, so the server can no longer bake
 * "is this visitor signed in / have they already reviewed" into the HTML —
 * that per-user state resolves here, AFTER the cached page paints: the session
 * via Better Auth's client hook, the once-per-product check via the
 * `hasUserReviewedProduct` server action. Until both resolve, a pulse skeleton
 * (sized to the sign-in card) holds the slot so the panel never flashes the
 * wrong state.
 */
export default function ReviewGate({ productId }: { productId: string }) {
  const { data: session, isPending } = useSession();
  const userId = session?.user?.id ?? null;

  // null = still resolving for the current user. Reset on account change so a
  // switch mid-visit can't leak user A's answer to user B.
  const [hasReviewed, setHasReviewed] = useState<boolean | null>(null);

  useEffect(() => {
    setHasReviewed(null);
    if (!userId) return;

    let alive = true;
    hasUserReviewedProduct(productId)
      .then((reviewed) => {
        if (alive) setHasReviewed(reviewed);
      })
      .catch(() => {
        // Fail open to the form — the server action re-checks on submit and
        // rejects a duplicate with a clean message anyway.
        if (alive) setHasReviewed(false);
      });
    return () => {
      alive = false;
    };
  }, [userId, productId]);

  // Session unresolved, or reviewed-check in flight for a signed-in user.
  if (isPending || (userId && hasReviewed === null)) {
    return (
      <div
        aria-hidden="true"
        className="animate-pulse rounded-2xl border border-stone-200/80 bg-stone-50/40 p-6 md:p-8"
      >
        <div className="mx-auto h-14 w-14 rounded-full bg-stone-200" />
        <div className="mx-auto mt-4 h-6 w-2/3 rounded-lg bg-stone-200" />
        <div className="mx-auto mt-2.5 h-4 w-1/2 rounded-lg bg-stone-200" />
        <div className="mx-auto mt-6 h-11 w-40 rounded-full bg-stone-200" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="rounded-2xl border border-stone-200/80 bg-stone-50/40 p-6 md:p-8 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <LogIn className="h-6 w-6" />
        </span>
        <h3 className="mt-4 font-serif text-2xl font-medium tracking-tight text-stone-900">
          Please log in to leave a review
        </h3>
        <p className="mt-1.5 font-sans text-sm text-stone-500">
          Sign in to your account to share your experience with this product.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-sans text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
        >
          <LogIn className="h-4 w-4" />
          Log in to review
        </Link>
      </div>
    );
  }

  return (
    <ReviewForm productId={productId} hasExistingReview={hasReviewed === true} />
  );
}
