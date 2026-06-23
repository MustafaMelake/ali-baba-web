"use client";

import { useRef, useState, useTransition } from "react";
import { Star, Loader2, Send, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { submitProductReview } from "@/lib/actions/reviews";
import { cn } from "@/lib/utils";

const inputClasses =
  "w-full rounded-xl border border-stone-200 bg-white px-4 py-3 font-sans text-sm text-stone-900 outline-none transition-colors placeholder:text-stone-400 focus:border-primary focus:ring-2 focus:ring-primary/15";

export default function ReviewForm({
  productId,
  hasExistingReview = false,
}: {
  productId: string;
  /**
   * Server-resolved: does this user already have a review (pending OR approved)?
   * When true we hide the form entirely and show a polite status note instead,
   * pre-empting the one-review-per-product unique constraint. Passed from the
   * Server Component, so it's identical on first server + client render — no
   * hydration mismatch.
   */
  hasExistingReview?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (rating < 1) {
      toast.error("Please select a star rating.");
      return;
    }

    const formData = new FormData(e.currentTarget);
    formData.set("rating", String(rating));

    startTransition(async () => {
      const result = await submitProductReview(productId, formData);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      formRef.current?.reset();
      setRating(0);
      setHover(0);
    });
  }

  const active = hover || rating;

  // Already reviewed → suppress the form and show a calm "received" note. Kept
  // after the hooks above so the Rules of Hooks hold regardless of this branch.
  if (hasExistingReview) {
    return (
      <div
        dir="rtl"
        lang="ar"
        role="status"
        className="rounded-2xl border border-blue-200/70 bg-blue-50 p-6 md:p-8 text-center"
      >
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-blue-600">
          <CheckCircle2 className="h-6 w-6" />
        </span>
        <p className="mt-4 font-sans text-base font-semibold leading-relaxed text-blue-800">
          شكراً لك، تقييمك قيد المراجعة الآن
        </p>
        <p className="mt-1.5 font-sans text-sm text-blue-700/70">
          سيظهر تقييمك بمجرد اعتماده من فريقنا.
        </p>
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="rounded-2xl border border-stone-200/80 bg-stone-50/40 p-6 md:p-8"
    >
      <h3 className="font-serif text-2xl font-medium tracking-tight text-stone-900">
        Write a review
      </h3>
      <p className="mt-1.5 font-sans text-sm text-stone-500">
        Share your experience — submissions appear once approved by our team.
      </p>

      {/* Star picker */}
      <div className="mt-6">
        <span className="mb-2 block font-sans text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-500">
          Your rating
        </span>
        <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
          {Array.from({ length: 5 }).map((_, i) => {
            const star = i + 1;
            return (
              <button
                key={star}
                type="button"
                onClick={() => setRating(star)}
                onMouseEnter={() => setHover(star)}
                aria-label={`${star} star${star === 1 ? "" : "s"}`}
                aria-pressed={rating === star}
                className="rounded-md p-0.5 transition-transform hover:scale-110"
              >
                <Star
                  className={cn(
                    "h-7 w-7 transition-colors",
                    star <= active
                      ? "fill-amber-400 text-amber-400"
                      : "fill-stone-200 text-stone-200",
                  )}
                  strokeWidth={0}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Comment */}
      <div className="mt-6">
        <label
          htmlFor="comment"
          className="mb-2 block font-sans text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-500"
        >
          Comment <span className="font-normal text-stone-400">(optional)</span>
        </label>
        <textarea
          id="comment"
          name="comment"
          rows={4}
          maxLength={2000}
          placeholder="What did you love about it?"
          className={cn(inputClasses, "resize-y leading-relaxed")}
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-sans text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Submitting…
          </>
        ) : (
          <>
            <Send className="h-4 w-4" />
            Submit Review
          </>
        )}
      </button>
    </form>
  );
}
