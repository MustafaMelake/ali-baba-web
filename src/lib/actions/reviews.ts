"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getServerSession, requireAdmin } from "@/lib/session";

export type SubmitReviewResult =
  | { success: true; message: string }
  | { success: false; error: string };

export type ReviewModerationResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Rating + (optional) comment. The reviewer's name is no longer accepted from
 * the form — it's derived from the authenticated session server-side. `comment`
 * is optional, but when provided must clear a minimum length; empty strings are
 * normalised to `undefined` before validation.
 */
const reviewSchema = z.object({
  rating: z.coerce
    .number({ error: "Please select a rating." })
    .int()
    .min(1, "Rating must be between 1 and 5.")
    .max(5, "Rating must be between 1 and 5."),
  comment: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z
      .string()
      .trim()
      .min(3, "Comment must be at least 3 characters.")
      .max(2000, "Comment is too long.")
      .optional(),
  ),
});

function prismaErrorCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/**
 * Creates a customer review for a product. Authenticated users only — the
 * reviewer's id and name come from the session, never the client. The review is
 * always created with `isApproved: false` so it stays hidden until an admin
 * moderates it.
 */
export async function submitProductReview(
  productId: string,
  formData: FormData,
): Promise<SubmitReviewResult> {
  if (!productId) {
    return { success: false, error: "Missing product." };
  }

  const session = await getServerSession();
  if (!session) {
    return { success: false, error: "Please log in to leave a review." };
  }

  const parsed = reviewSchema.safeParse({
    rating: formData.get("rating"),
    comment: formData.get("comment"),
  });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Please check your input.",
    };
  }

  // Validate the FK up front so a bad/stale productId returns a clean message
  // instead of surfacing a raw Prisma foreign-key error.
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { slug: true },
  });
  if (!product) {
    return { success: false, error: "This product no longer exists." };
  }

  try {
    await prisma.review.create({
      data: {
        productId,
        userId: session.user.id,
        // Snapshot the display name at submission time.
        authorName: session.user.name,
        rating: parsed.data.rating,
        // Model column is required; store "" when no comment was given.
        comment: parsed.data.comment ?? "",
        isApproved: false,
      },
    });

    // The new review is unapproved, so nothing it adds is visible yet; we
    // revalidate so the page reflects any approval that lands later.
    revalidatePath(`/product/${product.slug}`);

    return {
      success: true,
      message: "Thank you! Your review is pending admin approval.",
    };
  } catch (err) {
    if (prismaErrorCode(err) === "P2002") {
      return { success: false, error: "You've already reviewed this product." };
    }
    console.error("submitProductReview failed:", err);
    return {
      success: false,
      error: "Could not submit your review. Please try again.",
    };
  }
}

/**
 * Admin: publishes a pending review. Revalidates the product page so the newly
 * approved review appears, and the moderation list so its status updates.
 */
export async function approveReview(reviewId: string): Promise<ReviewModerationResult> {
  await requireAdmin();
  if (!reviewId) return { success: false, error: "Missing review id." };

  try {
    const review = await prisma.review.update({
      where: { id: reviewId },
      data: { isApproved: true },
      select: { product: { select: { slug: true } } },
    });

    revalidatePath("/admin/reviews");
    revalidatePath(`/product/${review.product.slug}`);
    return { success: true };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return { success: false, error: "That review no longer exists." };
    }
    console.error("approveReview failed:", err);
    return { success: false, error: "Could not approve the review. Please try again." };
  }
}

/**
 * Admin: permanently removes a review (used for both rejecting pending reviews
 * and deleting published ones).
 */
export async function deleteReview(reviewId: string): Promise<ReviewModerationResult> {
  await requireAdmin();
  if (!reviewId) return { success: false, error: "Missing review id." };

  try {
    const review = await prisma.review.delete({
      where: { id: reviewId },
      select: { isApproved: true, product: { select: { slug: true } } },
    });

    revalidatePath("/admin/reviews");
    // Only matters publicly if it had been approved, but it's cheap and safe.
    if (review.isApproved) revalidatePath(`/product/${review.product.slug}`);
    return { success: true };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return { success: false, error: "That review no longer exists." };
    }
    console.error("deleteReview failed:", err);
    return { success: false, error: "Could not delete the review. Please try again." };
  }
}
