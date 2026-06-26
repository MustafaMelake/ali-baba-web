import Link from "next/link";
import { MessageSquareQuote, Clock } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/session";
import { formatDate } from "@/lib/utils";
import PageHeader from "@/components/admin/PageHeader";
import EmptyState from "@/components/admin/EmptyState";
import Pill from "@/components/admin/Pill";
import StarRating from "@/components/StarRating";
import ReviewActions from "@/components/admin/ReviewActions";

export const metadata = {
  title: "Reviews | Admin",
};

// Moderation must always reflect the live queue.
export const dynamic = "force-dynamic";

export default async function AdminReviewsPage() {
  await requireAdminPage();

  // Pending (isApproved: false) first, then newest approved.
  const reviews = await prisma.review.findMany({
    orderBy: [{ isApproved: "asc" }, { createdAt: "desc" }],
    include: {
      product: { select: { name: true, slug: true } },
      user: { select: { name: true, email: true } },
    },
  });

  const pendingCount = reviews.filter((r) => !r.isApproved).length;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        eyebrow="Moderation"
        title="Reviews"
        description="Approve customer reviews to publish them on the storefront, or remove ones that don't belong."
        action={
          pendingCount > 0 ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3.5 py-2 text-sm font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20">
              <Clock className="h-4 w-4" />
              {pendingCount} pending
            </span>
          ) : undefined
        }
      />

      {reviews.length === 0 ? (
        <div className="overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm">
          <EmptyState
            icon={MessageSquareQuote}
            title="No reviews yet"
            description="Customer reviews will appear here for moderation as they're submitted."
          />
        </div>
      ) : (
        <ul className="space-y-4">
          {reviews.map((review) => (
            <li
              key={review.id}
              className="rounded-2xl border border-stone-200/70 bg-white p-5 shadow-sm md:p-6"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                {/* Left: meta + content */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <StarRating value={review.rating} size={15} />
                    {review.isApproved ? (
                      <Pill className="bg-emerald-50 text-emerald-700 ring-emerald-600/20">
                        Approved
                      </Pill>
                    ) : (
                      <Pill className="bg-amber-50 text-amber-700 ring-amber-600/20">
                        Pending
                      </Pill>
                    )}
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                    <span className="font-semibold text-stone-900">
                      {review.user.name}
                    </span>
                    <span className="text-stone-300">·</span>
                    <span className="text-stone-400">{review.user.email}</span>
                  </div>

                  <p className="mt-1 text-xs text-stone-400">
                    Reviewed{" "}
                    <Link
                      href={`/product/${review.product.slug}`}
                      className="font-medium text-stone-500 underline-offset-2 transition-colors hover:text-primary hover:underline"
                    >
                      {review.product.name}
                    </Link>{" "}
                    on {formatDate(review.createdAt)}
                  </p>

                  {review.comment && (
                    <p className="mt-3 border-l-2 border-stone-100 pl-3 text-sm leading-relaxed text-stone-600">
                      {review.comment}
                    </p>
                  )}
                </div>

                {/* Right: actions */}
                <div className="shrink-0 sm:pt-0.5">
                  <ReviewActions
                    reviewId={review.id}
                    isApproved={review.isApproved}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
