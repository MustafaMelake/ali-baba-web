import { prisma } from "@/lib/prisma";
import { livePromotionWhere } from "@/lib/discounts";
import { DiscountType } from "@/generated/prisma/enums";
import { STORE_TZ } from "@/lib/timezone";
import PromoWidgetBanner from "@/components/PromoWidgetBanner";

/** Only show the "Ends …" urgency line when the offer genuinely ends soon —
 *  an evergreen promotion parked on a far-future endDate shouldn't nag. */
const ENDS_SOON_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Cairo-local "18 July" — the store's calendar day, never the server's. */
const endsOnFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  timeZone: STORE_TZ,
});

/**
 * Server Component that surfaces the single strongest live promotion as a
 * storefront banner. Fetches with the same `livePromotionWhere(now)` strict
 * liveness filter as every price surface, coerces the Decimal `value` to a
 * plain number, and hands display-ready props to the thin client leaf
 * <PromoWidgetBanner /> (which exists only for the framer-motion entrance).
 *
 * Renders nothing when no promotion is live — the section disappears rather
 * than showing an empty shell.
 *
 * Caching: no per-user state is read, so the widget inherits its page's
 * shared ISR window (60s on `/` and `/category/[slug]`). Promotion mutations
 * already bust the whole storefront tree via `revalidatePath("/", "layout")`,
 * so admin changes appear on the next request; only pure time-based liveness
 * (a window opening/closing untouched) can lag up to a minute — exactly the
 * staleness bound every other promotion surface accepts.
 */
export default async function PromoWidget() {
  // One instant drives the DB liveness filter and the urgency window alike.
  const now = new Date();

  const promotions = await prisma.promotion.findMany({
    where: livePromotionWhere(now),
    select: {
      id: true,
      name: true,
      type: true,
      value: true,
      endDate: true,
      // Deep-link target: a promotion aimed at exactly one category sends the
      // CTA straight to that collection; anything broader lands on /shop.
      categories: { select: { slug: true } },
    },
  });

  if (promotions.length === 0) return null;

  // Feature the strongest live PERCENTAGE discount; when only fixed-amount
  // promotions are live, fall back to the largest one with a generic
  // flash-sale treatment (mirrors `discountLabelFor` on the homepage slider).
  // Like the slider badge, this is advisory marketing — per-variant prices
  // are still resolved by `resolvePrice`, where a fixed-amount promo can
  // legitimately beat the advertised percentage.
  const featured = promotions.reduce((best, p) => {
    const bestIsPct = best.type === DiscountType.PERCENTAGE;
    const pIsPct = p.type === DiscountType.PERCENTAGE;
    if (pIsPct !== bestIsPct) return pIsPct ? p : best;
    // `value` is a Decimal column — coerce before comparing.
    return p.value.toNumber() > best.value.toNumber() ? p : best;
  });

  const percentOff =
    featured.type === DiscountType.PERCENTAGE
      ? Math.round(featured.value.toNumber())
      : null;

  const href =
    featured.categories.length === 1
      ? `/category/${featured.categories[0].slug}`
      : "/shop";

  const endsOn =
    featured.endDate.getTime() - now.getTime() <= ENDS_SOON_WINDOW_MS
      ? endsOnFmt.format(featured.endDate)
      : null;

  return (
    <PromoWidgetBanner
      headline={featured.name}
      percentOff={percentOff}
      href={href}
      endsOn={endsOn}
    />
  );
}
