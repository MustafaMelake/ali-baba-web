import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, MessageSquareQuote } from "lucide-react";
import ProductGallery from "@/components/ProductGallery";
import ProductPurchasePanel from "@/components/products/ProductPurchasePanel";
import { LogIn } from "lucide-react";
import StarRating from "@/components/StarRating";
import ReviewForm from "@/components/ReviewForm";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/session";
import { getWishlistedProductIds } from "@/lib/actions/wishlist";
import { formatDate } from "@/lib/utils";

// Rendered dynamically: the review panel is personalised to the signed-in user,
// which requires reading the session (cookies/headers) per request.
export const dynamic = "force-dynamic";

// ─── Page ────────────────────────────────────────────────────────
// Driven by Prisma. The product is resolved by its unique `slug`.
//
// NOTE: the previous mock rendered tagline / ingredients / allergens / weight /
// serves / prepTime. Those have no columns on the Product model, so they are
// intentionally omitted here rather than fabricated. Add them to the schema
// later to light those sections back up.
export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const [product, session, wishlistedIds] = await Promise.all([
    prisma.product.findUnique({
      where: { slug },
      include: {
        category: true,
        variants: { orderBy: { price: "asc" } },
        // Only moderated (approved) reviews are ever surfaced publicly.
        reviews: {
          where: { isApproved: true },
          orderBy: { createdAt: "desc" },
        },
      },
    }),
    getServerSession(),
    getWishlistedProductIds(),
  ]);

  if (!product) notFound();

  // Derived view-model (all real data, with safe fallbacks).
  const images = product.images.length ? product.images : ["/placeholder.jpg"];
  const badge = product.isFeatured ? "Featured" : null;
  const initialIsFavorited = wishlistedIds.includes(product.id);

  // The full variant set drives the client selector (price / availability /
  // Add-to-Cart). Ordered price-asc by the query, so the first available one is
  // the panel's default selection.
  const variants = product.variants.map((v) => ({
    id: v.id,
    name: v.name,
    price: v.price,
    isAvailable: v.isAvailable,
    compareAtPrice: v.compareAtPrice,
  }));

  // Review aggregates computed server-side from the approved set.
  const reviews = product.reviews;
  const reviewCount = reviews.length;
  const averageRating =
    reviewCount > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount
      : 0;

  return (
    // pt clears the fixed Navbar (h-16 md:h-20)
    <div className="pt-16 md:pt-20 bg-white">
      {/* ─── Breadcrumb ──────────────────────────────────── */}
      <nav
        aria-label="Breadcrumb"
        className="max-w-screen-xl mx-auto px-6 md:px-10 lg:px-14 py-4 flex items-center gap-2"
      >
        {[
          { label: "Home", href: "/" },
          { label: "Shop", href: "/shop" },
          {
            label: product.category.name,
            href: `/category/${product.category.slug}`,
          },
          { label: product.name, href: null },
        ].map((crumb, i, arr) => (
          <span key={crumb.label} className="flex items-center gap-2">
            {crumb.href ? (
              <Link
                href={crumb.href}
                className="font-sans text-[11px] text-stone-400 hover:text-primary transition-colors"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="font-sans text-[11px] text-stone-700 font-medium">
                {crumb.label}
              </span>
            )}
            {i < arr.length - 1 && (
              <ChevronRight className="w-3 h-3 text-stone-300" />
            )}
          </span>
        ))}
      </nav>

      {/* ─── Two-column layout ───────────────────────────── */}
      <div className="max-w-screen-xl mx-auto lg:grid lg:grid-cols-2">
        {/* ── Gallery ──────────────────────────────────── */}
        <div className="h-[80vw] min-h-[300px] max-h-[520px] overflow-hidden lg:h-[calc(100vh-80px)] lg:max-h-none lg:sticky lg:top-20">
          <ProductGallery images={images} name={product.name} />
        </div>

        {/* ── Product info (scrollable) ────────────────── */}
        <div className="px-6 md:px-10 lg:px-12 xl:px-16 py-8 lg:py-12 lg:overflow-y-auto lg:h-[calc(100vh-80px)]">
          {/* Badge — surfaced from isFeatured */}
          {badge && (
            <span className="inline-block mb-5 rounded-full bg-primary/10 px-4 py-1 font-sans text-[11px] font-semibold uppercase tracking-[0.25em] text-primary">
              {badge}
            </span>
          )}

          {/* Category kicker */}
          <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.3em] text-stone-400 mb-3">
            {product.category.name}
          </p>

          {/* Product name */}
          <h1 className="font-serif font-medium tracking-tight leading-[1.06] text-stone-900 text-[clamp(1.75rem,5.5vw,3.25rem)]">
            {product.name}
          </h1>

          {/* Rating summary */}
          <div className="mt-5 flex items-center gap-2.5">
            <StarRating value={averageRating} size={16} />
            {reviewCount > 0 ? (
              <>
                <span className="font-sans text-sm font-medium text-stone-700">
                  {averageRating.toFixed(1)}
                </span>
                <a
                  href="#reviews"
                  className="font-sans text-sm text-stone-400 transition-colors hover:text-primary"
                >
                  ({reviewCount} review{reviewCount === 1 ? "" : "s"})
                </a>
              </>
            ) : (
              <a
                href="#reviews"
                className="font-sans text-sm text-stone-400 transition-colors hover:text-primary"
              >
                No reviews yet
              </a>
            )}
          </div>

          {/* ── Purchase island (client) — price + variant selector + cart ──
              The displayed price reflects the *selected* variant, so it lives in
              the client panel, not in this Server Component. A static server-rendered
              price would silently disagree with the pills the moment a customer
              chooses a non-default variant. */}
          <div className="mt-7">
            <ProductPurchasePanel
              product={{
                id: product.id,
                name: product.name,
                images,
                category: product.category.name,
              }}
              variants={variants}
              initialIsFavorited={initialIsFavorited}
            />
          </div>

          {/* Description (real field — only render when present) */}
          {product.description && (
            <>
              <div className="my-8 h-px bg-stone-100" />
              <div>
                <p className="font-sans text-[10px] font-bold uppercase tracking-[0.28em] text-stone-400 mb-4">
                  About This Item
                </p>
                <p className="font-sans text-sm md:text-[0.9375rem] text-stone-600 leading-relaxed md:leading-loose">
                  {product.description}
                </p>
              </div>
            </>
          )}

          {/* Bottom breathing room on mobile */}
          <div className="h-10 lg:h-0" />
        </div>
      </div>

      {/* ─── Customer Reviews ────────────────────────────── */}
      <section
        id="reviews"
        className="scroll-mt-24 border-t border-stone-100 bg-[#FAFAFA]"
      >
        <div className="max-w-screen-xl mx-auto px-6 md:px-10 lg:px-14 py-16 md:py-20">
          {/* Header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.3em] text-primary mb-3">
                What people say
              </p>
              <h2 className="font-serif text-3xl md:text-4xl font-medium tracking-tight text-stone-900">
                Customer Reviews
              </h2>
            </div>
            {reviewCount > 0 && (
              <div className="flex items-center gap-3">
                <StarRating value={averageRating} size={20} />
                <div className="leading-tight">
                  <span className="font-serif text-2xl font-medium text-stone-900">
                    {averageRating.toFixed(1)}
                  </span>
                  <span className="ml-1.5 font-sans text-sm text-stone-400">
                    / 5 · {reviewCount} review{reviewCount === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="mt-10 grid gap-12 lg:grid-cols-[1.4fr_1fr] lg:gap-16">
            {/* Review list / empty state */}
            <div>
              {reviewCount === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-stone-200 bg-white px-6 py-16 text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <MessageSquareQuote className="h-6 w-6" />
                  </span>
                  <p className="mt-4 font-serif text-xl font-medium text-stone-900">
                    Be the first to review this product
                  </p>
                  <p className="mt-1.5 max-w-sm font-sans text-sm text-stone-500">
                    Your feedback helps other customers and our kitchen. Share your
                    thoughts using the form.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-stone-200/70">
                  {reviews.map((review) => (
                    <li key={review.id} className="py-6 first:pt-0">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 font-sans text-sm font-semibold text-primary">
                            {review.authorName.trim().charAt(0).toUpperCase() || "?"}
                          </span>
                          <div className="leading-tight">
                            <p className="font-sans text-sm font-semibold text-stone-900">
                              {review.authorName}
                            </p>
                            <p className="font-sans text-xs text-stone-400">
                              {formatDate(review.createdAt)}
                            </p>
                          </div>
                        </div>
                        <StarRating value={review.rating} size={15} />
                      </div>
                      {review.comment && (
                        <p className="mt-3 font-sans text-sm md:text-[0.9375rem] text-stone-600 leading-relaxed">
                          {review.comment}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Submission form (authenticated users only) */}
            <div className="lg:sticky lg:top-24 lg:self-start">
              {session ? (
                <ReviewForm productId={product.id} />
              ) : (
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
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
