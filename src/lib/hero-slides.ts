import type { Prisma } from "@/generated/prisma/client";
import {
  collectionPromotionsInclude,
  collectionPromotionsOf,
  gatherPromotions,
  livePromotionWhere,
  PROMOTION_SELECT_FIELDS,
  resolvePrice,
} from "@/lib/discounts";
import { LISTABLE_PRODUCT } from "@/lib/catalog";

// ─────────────────────────────────────────────────────────────────────────────
// Homepage hero slides — the shared, pure rules (no Prisma client, no React).
//
// One liveness rule in two forms that must never drift: `liveHeroSlideWhere`
// (the storefront's DB filter) and `heroWindowState` + `heroDestinationIssue`
// (the in-memory mirror the storefront re-checks with and the admin badges
// read). Both take the SAME `now` the caller captured once per request.
//
// A product slide's price is display-only and is resolved exactly like a
// catalog card's (`toCard` on /new-arrivals): the starting variant through
// `gatherPromotions` + `resolvePrice`, falling back to the variant's manual
// Compare-At strikethrough. Nothing is ever stored on the slide.
//
// Plain module (not "use server") so the admin island, the homepage and the
// actions can all import it. Overlay strings live here, not in the component,
// so the coming Arabic locale swaps a table instead of editing markup.
// ─────────────────────────────────────────────────────────────────────────────

/** Hard bound on slides the storefront renders (the read's `take`). */
export const HERO_MAX_LIVE_SLIDES = 5;

/**
 * Autoplay interval. Always on (reduced motion only removes the crossfade);
 * the visible Pause button is the WCAG 2.2.2 control. See HeroCarousel.
 */
export const HERO_AUTOPLAY_MS = 3000;

/** A swipe / arrow / dot pauses autoplay only until this long without input. */
export const HERO_RESUME_AFTER_MS = 8000;

/**
 * Recommended upload sizes, matching the frame's aspect ratios: desktop
 * ≈ 2.35:1, mobile 4:5. Shown under each admin dropzone.
 */
export const HERO_IMAGE_SIZES = {
  desktop: { width: 2400, height: 1020 },
  mobile: { width: 1080, height: 1350 },
} as const;

/** Overlay + control strings for the carousel (English for now). */
export const HERO_COPY = {
  regionLabel: "Featured",
  slideLabel: (n: number, total: number) => `${n} of ${total}`,
  goToSlide: (n: number) => `Go to slide ${n}`,
  previous: "Previous slide",
  next: "Next slide",
  pause: "Pause slideshow",
  play: "Play slideshow",
  priceFrom: "From",
  /** The storefront currency mark, rendered after the figure ("192 ج.م"). */
  currency: "ج.م",
} as const;

// ── Liveness ─────────────────────────────────────────────────────────────────

/**
 * The storefront filter: active, inside its window (null edges are open), and
 * pointing somewhere a shopper can actually go — a LISTABLE product (never
 * advertise what `placeOrder` would refuse) or a link. A slide whose product
 * was deleted (SetNull) or delisted simply drops out.
 */
export function liveHeroSlideWhere(now: Date): Prisma.HeroSlideWhereInput {
  return {
    isActive: true,
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      {
        OR: [
          { product: { is: LISTABLE_PRODUCT } },
          { productId: null, linkUrl: { not: null } },
        ],
      },
    ],
  };
}

export type HeroWindowState = "inactive" | "expired" | "scheduled" | "live";

/**
 * The slide's primary status — its switch and time window only. Precedence:
 * Inactive → Expired → Scheduled → Live (one label for `isActive: false`,
 * whether the slide is new or was switched off).
 */
export function heroWindowState(
  slide: { isActive: boolean; startsAt: Date | null; endsAt: Date | null },
  now: Date,
): HeroWindowState {
  if (!slide.isActive) return "inactive";
  if (slide.endsAt && now > slide.endsAt) return "expired";
  if (slide.startsAt && now < slide.startsAt) return "scheduled";
  return "live";
}

export type HeroDestinationIssue = "no-destination" | "product-unavailable";

/**
 * Why a slide couldn't be shown even inside its window — the admin's separate
 * warning chip. `product.variants` must be the AVAILABLE variants (the reads
 * filter `isAvailable: true`), mirroring LISTABLE_PRODUCT in memory.
 */
export function heroDestinationIssue(slide: {
  productId: string | null;
  linkUrl: string | null;
  product: { isAvailable: boolean; variants: unknown[] } | null;
}): HeroDestinationIssue | null {
  if (slide.productId) {
    const listable =
      slide.product !== null &&
      slide.product.isAvailable &&
      slide.product.variants.length > 0;
    return listable ? null : "product-unavailable";
  }
  return slide.linkUrl ? null : "no-destination";
}

/** In-memory twin of `liveHeroSlideWhere` — same rule, same `now`. */
export function isHeroSlideLive(
  slide: Parameters<typeof heroWindowState>[0] &
    Parameters<typeof heroDestinationIssue>[0],
  now: Date,
): boolean {
  return (
    heroWindowState(slide, now) === "live" &&
    heroDestinationIssue(slide) === null
  );
}

// ── Storefront read shape ────────────────────────────────────────────────────

/**
 * The storefront select: overlay fields + the product's three-level live
 * promotion hierarchy, variants available-only and price-ascending so `[0]` is
 * the starting price — the same shape as the catalog cards' include.
 */
export function heroSlideStorefrontSelect(now: Date) {
  return {
    id: true,
    eyebrow: true,
    title: true,
    subtitle: true,
    ctaLabel: true,
    showPrice: true,
    imageDesktop: true,
    imageMobile: true,
    imageAlt: true,
    linkUrl: true,
    productId: true,
    isActive: true,
    startsAt: true,
    endsAt: true,
    product: {
      select: {
        slug: true,
        isAvailable: true,
        promotions: {
          where: livePromotionWhere(now),
          select: PROMOTION_SELECT_FIELDS,
        },
        // Promotions on the product's ACTIVE collections (the fourth level).
        ...collectionPromotionsInclude(now),
        category: {
          select: {
            promotions: {
              where: livePromotionWhere(now),
              select: PROMOTION_SELECT_FIELDS,
            },
          },
        },
        variants: {
          where: { isAvailable: true },
          orderBy: { price: "asc" }, // [0] = starting (lowest) price
          select: {
            price: true,
            compareAtPrice: true,
            promotions: {
              where: livePromotionWhere(now),
              select: PROMOTION_SELECT_FIELDS,
            },
          },
        },
      },
    },
  } satisfies Prisma.HeroSlideSelect;
}

export type HeroSlideStorefrontRow = Prisma.HeroSlideGetPayload<{
  select: ReturnType<typeof heroSlideStorefrontSelect>;
}>;

/** Display-only starting price — plain 2-dp numbers, never a Decimal. */
export type HeroSlidePrice = {
  amount: number;
  /** Struck-through "was" price, or null when there's nothing to strike. */
  compareAt: number | null;
  /** More than one available variant → render "From". */
  isFrom: boolean;
};

/** What the client carousel renders — serializable, no Decimals, no Dates. */
export type HeroSlideView = {
  id: string;
  eyebrow: string | null;
  title: string | null;
  subtitle: string | null;
  ctaLabel: string;
  href: string;
  imageDesktop: string;
  imageMobile: string | null;
  imageAlt: string;
  price: HeroSlidePrice | null;
};

/**
 * Serialize one live row for the client. Returns null for a row with nowhere
 * to go (defensive — the where already excludes it). The price chain is the
 * catalog card's (`toCard`), copied, not re-derived: discount math lives only
 * in `discounts.ts`.
 */
export function toHeroSlideView(
  row: HeroSlideStorefrontRow,
  now: Date,
): HeroSlideView | null {
  const href = row.product
    ? `/product/${row.product.slug}`
    : row.linkUrl;
  if (!href) return null;

  let price: HeroSlidePrice | null = null;
  const starting = row.product?.variants[0];
  if (row.product && row.showPrice && starting) {
    const priced = resolvePrice(
      starting.price,
      gatherPromotions(
        starting.promotions,
        row.product.promotions,
        row.product.category.promotions,
        collectionPromotionsOf(row.product),
      ),
      now,
    );
    price = {
      amount: priced.finalPrice,
      // Live promo → struck-through base price; otherwise fall back to the
      // variant's manual Compare-At (mirrors the catalog cards and the PDP).
      compareAt: priced.hasDiscount
        ? priced.basePrice
        : starting.compareAtPrice?.toNumber() ?? null,
      isFrom: row.product.variants.length > 1,
    };
  }

  return {
    id: row.id,
    eyebrow: row.eyebrow,
    title: row.title,
    subtitle: row.subtitle,
    ctaLabel: row.ctaLabel,
    href,
    imageDesktop: row.imageDesktop,
    imageMobile: row.imageMobile,
    imageAlt: row.imageAlt,
    price,
  };
}
