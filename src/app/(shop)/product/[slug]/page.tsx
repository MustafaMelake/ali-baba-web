import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import ProductGallery from "@/components/ProductGallery";
import ProductAddToCart from "@/components/ProductAddToCart";
import { prisma } from "@/lib/prisma";

// ISR: revalidate detail pages at most once per hour.
export const revalidate = 3600;

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

  const product = await prisma.product.findUnique({
    where: { slug },
    include: {
      category: true,
      variants: { orderBy: { price: "asc" } },
    },
  });

  if (!product) notFound();

  // Derived view-model (all real data, with safe fallbacks).
  const price = product.variants[0]?.price ?? 0;
  const images = product.images.length ? product.images : ["/placeholder.jpg"];
  const badge = product.isFeatured ? "Featured" : null;

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

          {/* Price */}
          <div className="mt-7 flex items-baseline gap-3">
            <span className="font-serif text-4xl font-medium text-stone-900 tracking-tight">
              {price.toLocaleString("en-EG")}
            </span>
            <span className="font-sans text-sm text-stone-500">ج.م</span>
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

          {/* Divider */}
          <div className="my-8 h-px bg-stone-100" />

          {/* ── Cart island (client component) ─────────── */}
          <ProductAddToCart
            product={{
              id: product.id,
              name: product.name,
              price,
              images,
              category: product.category.name,
            }}
          />

          {/* Bottom breathing room on mobile */}
          <div className="h-10 lg:h-0" />
        </div>
      </div>
    </div>
  );
}
