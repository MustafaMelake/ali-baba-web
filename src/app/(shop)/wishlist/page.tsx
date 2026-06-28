import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Heart, ArrowUpRight } from "lucide-react";
import { getServerSession } from "@/lib/session";
import { getWishlistItems } from "@/lib/actions/wishlist";
import WishlistButton from "@/components/products/WishlistButton";
import EmptyState from "@/components/EmptyState";

// Personalised to the signed-in user → always render against the live DB.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "My Wishlist | Ali Baba",
};

export default async function WishlistPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const result = await getWishlistItems();
  const items = result.success ? result.data : [];

  return (
    <div className="min-h-screen bg-[#FAFAFA] pt-16 md:pt-20">
      <div className="mx-auto max-w-screen-xl px-6 py-12 md:px-10 lg:px-14 md:py-16">
        {/* ── Header ─────────────────────────────────────────── */}
        <header className="mb-12">
          <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.3em] text-primary">
            Saved for later
          </p>
          <h1 className="mt-2 font-serif text-4xl font-medium tracking-tight text-stone-900 md:text-5xl">
            My Wishlist
          </h1>
          {items.length > 0 && (
            <p className="mt-3 font-sans text-sm text-stone-500">
              {items.length} item{items.length === 1 ? "" : "s"} you&apos;ve fallen for.
            </p>
          )}
        </header>

        {items.length === 0 ? (
          <EmptyState
            icon={Heart}
            title="Your wishlist is empty"
            description="Tap the heart on any piece you love and it will be waiting for you right here."
            action={{ href: "/shop", label: "Explore the Collection" }}
          />
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((product) => {
              const href = `/product/${product.slug}`;
              const onSale =
                product.compareAtPrice != null &&
                product.compareAtPrice > product.price;
              const percentOff = onSale
                ? Math.round((1 - product.price / product.compareAtPrice!) * 100)
                : 0;
              return (
                <article key={product.id} className="group flex flex-col">
                  {/* Image */}
                  <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-stone-100">
                    <Link href={href} aria-label={`View ${product.name}`} className="block h-full w-full">
                      <Image
                        src={product.image}
                        alt={product.name}
                        fill
                        className="object-cover transition-transform duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.07]"
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/15 via-transparent to-transparent opacity-60 transition-opacity duration-500 group-hover:opacity-90" />
                    </Link>

                    {/* Sale badge — only while a promotion is live */}
                    {onSale && (
                      <div className="absolute left-3.5 top-3.5 z-10 rounded-full bg-primary px-2.5 py-1 font-sans text-[11px] font-bold tracking-wide text-white shadow-sm">
                        -{percentOff}%
                      </div>
                    )}

                    {/* Heart — pre-favorited; un-favoriting removes it on revalidate */}
                    <div className="absolute right-3.5 top-3.5 z-10">
                      <WishlistButton productId={product.id} initialIsFavorited />
                    </div>
                  </div>

                  {/* Info */}
                  <div className="flex flex-1 flex-col pt-4">
                    <p className="mb-2 font-sans text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400">
                      {product.category}
                    </p>
                    <Link href={href} className="block">
                      <h3 className="font-serif text-xl font-medium leading-snug tracking-tight text-stone-900 transition-colors duration-200 group-hover:text-primary md:text-[1.4rem]">
                        {product.name}
                      </h3>
                    </Link>

                    <div className="mt-4 flex items-center justify-between border-t border-stone-100 pt-3.5">
                      <span className="flex items-baseline gap-2">
                        <span className="font-serif text-lg font-medium text-stone-900">
                          {product.price.toLocaleString("en-EG")}
                          <span className="ml-1 font-sans text-xs font-normal text-stone-400">
                            ج.م
                          </span>
                        </span>
                        {onSale && (
                          <span className="font-sans text-xs tabular-nums text-stone-400 line-through">
                            {product.compareAtPrice!.toLocaleString("en-EG")}
                          </span>
                        )}
                      </span>
                      <Link
                        href={href}
                        className="group/disc flex items-center gap-1 font-sans text-[11px] font-semibold uppercase tracking-[0.15em] text-stone-500 transition-colors hover:text-primary"
                      >
                        Discover
                        <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover/disc:-translate-y-0.5 group-hover/disc:translate-x-0.5" />
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
