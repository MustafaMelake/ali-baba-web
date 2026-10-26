import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Heart, ArrowUpRight } from "lucide-react";
import { getServerSession, requirePasswordCurrent } from "@/lib/session";
import { getWishlistItems } from "@/lib/actions/wishlist";
import { formatMoney } from "@/lib/utils";
import { percentOff } from "@/lib/discounts";
import WishlistButton from "@/components/products/WishlistButton";
import EmptyState from "@/components/EmptyState";
import GridDensityToggle from "@/components/GridDensityToggle";
import { PRODUCT_GRID_PHONE } from "@/lib/grid-density";
import { cn } from "@/lib/utils";
import Pagination from "@/components/Pagination";
import {
  isPageOutOfRange,
  pageInfo,
  parsePageParam,
  STOREFRONT_PAGE_SIZE,
} from "@/lib/pagination";

// Personalised to the signed-in user → always render against the live DB.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "My Wishlist | Ali Baba",
};

export default async function WishlistPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  requirePasswordCurrent(session);

  // ?page= — this route is already per-user (force-dynamic).
  const page = parsePageParam((await searchParams).page);
  if (page === null) notFound();

  const result = await getWishlistItems(page);
  const items = result.success ? result.data : [];
  const total = result.success ? result.total : 0;
  const info = pageInfo(page, STOREFRONT_PAGE_SIZE, total);
  if (isPageOutOfRange(info)) notFound();

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="mx-auto max-w-screen-xl px-6 py-12 md:px-10 lg:px-14 md:py-16">
        {/* ── Header ─────────────────────────────────────────── */}
        <header className="mb-12">
          <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.3em] text-primary">
            Saved for later
          </p>
          <h1 className="mt-2 font-serif text-4xl font-medium tracking-tight text-stone-900 md:text-5xl">
            My Wishlist
          </h1>
          {total > 0 && (
            <div className="mt-3 flex items-center justify-between gap-4">
              <p className="font-sans text-sm text-stone-500">
                <span className="tabular-nums">{total}</span> item{total === 1 ? "" : "s"} you&apos;ve fallen for.
              </p>
              <GridDensityToggle className="shrink-0" />
            </div>
          )}
        </header>

        {items.length === 0 ? (
          <EmptyState
            icon={Heart}
            title="Your wishlist is empty"
            description="Tap the heart on any piece you love and it will be waiting for you right here."
            action={{ href: "/shop", label: "Explore the Shop" }}
          />
        ) : (
          <div
            data-product-grid
            className={cn("grid sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4", PRODUCT_GRID_PHONE)}
          >
            {items.map((product) => {
              const href = `/product/${product.slug}`;
              const onSale =
                product.price !== null &&
                product.compareAtPrice != null &&
                product.compareAtPrice > product.price;
              // Rounded down — the badge never advertises more than the real markdown.
              const discountPercent = onSale
                ? percentOff(product.price!, product.compareAtPrice!)
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
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 33vw, 25vw"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/15 via-transparent to-transparent opacity-60 transition-opacity duration-500 group-hover:opacity-90" />
                    </Link>

                    {/* Sale badge — only while a markdown of at least 1% is live */}
                    {discountPercent > 0 && (
                      <div className="absolute start-3.5 top-3.5 z-10 rounded-full bg-gradient-to-br from-red-600 via-red-700 to-red-800 px-2.5 py-1 font-sans text-[11px] font-bold tracking-wide text-white tabular-nums shadow-[0_6px_16px_-6px_rgba(153,27,27,0.7)] ring-1 ring-red-900/20 grid-2up:start-2 grid-2up:top-2 grid-2up:px-2 grid-2up:py-0.5 grid-2up:text-[10px]">
                        -{discountPercent}%
                      </div>
                    )}

                    {/* Heart — hydrates from the shared wishlist store (every
                        item here is favorited by definition); un-favoriting
                        removes the card on revalidate */}
                    <div className="absolute end-3.5 top-3.5 z-10 grid-2up:end-2 grid-2up:top-2">
                      {/* 44px hit area around the 40px heart (phone tap target). */}
                      <WishlistButton
                        productId={product.id}
                        className="relative after:absolute after:-inset-0.5"
                      />
                    </div>
                  </div>

                  {/* Info — the name link stretches over the block (::after), so
                      the whole card is a tap target; the phone 2-up grid hides
                      "Discover" and clamps the name to two lines. */}
                  <div className="relative flex flex-1 flex-col pt-4 grid-2up:pt-3">
                    <p className="mb-2 font-sans text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400 grid-2up:mb-1 grid-2up:truncate">
                      {product.category}
                    </p>
                    <Link href={href} className="block after:absolute after:inset-0 grid-2up:mb-2.5">
                      <h3 className="font-serif text-xl font-medium leading-snug tracking-tight text-stone-900 transition-colors duration-200 group-hover:text-primary md:text-[1.4rem] grid-2up:line-clamp-2 grid-2up:text-base">
                        {product.name}
                      </h3>
                    </Link>

                    <div className="mt-4 flex items-center justify-between border-t border-stone-100 pt-3.5 grid-2up:mt-auto grid-2up:pt-2.5">
                      {product.price === null ? (
                        // Switched off or every variant archived — no price to quote.
                        <span className="font-sans text-xs font-medium text-stone-400">
                          Currently unavailable
                        </span>
                      ) : (
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-serif text-lg font-medium tabular-nums text-stone-900">
                            {formatMoney(product.price)}
                            <span className="ms-1 font-sans text-xs font-normal text-stone-400">
                              ج.م
                            </span>
                          </span>
                          {onSale && (
                            <span className="font-sans text-xs tabular-nums text-stone-400 line-through">
                              {formatMoney(product.compareAtPrice!)}
                            </span>
                          )}
                        </span>
                      )}
                      <Link
                        href={href}
                        className="group/disc relative z-10 -my-3.5 flex items-center gap-1 py-3.5 font-sans text-[11px] font-semibold uppercase tracking-[0.15em] text-stone-500 transition-colors hover:text-primary grid-2up:hidden"
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
        <Pagination info={info} mode={{ kind: "query", base: "/wishlist" }} />
      </div>
    </div>
  );
}
