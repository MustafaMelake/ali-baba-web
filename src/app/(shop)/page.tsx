import BranchSelector from "@/components/BranchSelector";
import CategorySlider from "@/components/CategorySlider";
import FaqsSection from "@/components/FaqsSection";
import Hero from "@/components/Hero";
import OurStory from "@/components/OurStory";
import PromoWidget from "@/components/PromoWidget";
import SeasonalOverlay from "@/components/SeasonalOverlay";
import { prisma } from "@/lib/prisma";
import { getStorefrontLocations } from "@/lib/actions/locations";
import { advertisedPercent, livePromotionWhere } from "@/lib/discounts";
import {
  HERO_MAX_LIVE_SLIDES,
  heroSlideStorefrontSelect,
  isHeroSlideLive,
  liveHeroSlideWhere,
  toHeroSlideView,
  type HeroSlideView,
} from "@/lib/hero-slides";
import { DiscountType } from "@/generated/prisma/enums";

// Shared ISR cache (60s), matching the PDP and category pages: this page reads
// no per-user state, and every ADMIN action that can change it already busts
// the cache directly — category, product and hero-slide mutations call
// revalidatePath("/") and promotion mutations bust the whole storefront tree
// via revalidatePath("/", "layout") — so changes still appear on the next
// request, not after the window. The 60s window only bounds pure time-based
// liveness (a promo or hero slide whose start/end date passes with no admin
// action can lag up to a minute, exactly as it does on the PDP). The previous `revalidate = 0`
// paid a Neon round-trip per visit on the hottest route for no correctness win.
export const revalidate = 60;

/**
 * Derives a short, eye-catching badge from a category's live promotions.
 * Prefers the strongest percentage discount ("20% OFF"); any other live
 * promotion (e.g. a fixed-amount one) falls back to a generic "SALE".
 * Returns `undefined` when nothing is live, so the slider shows no badge.
 */
function discountLabelFor(
  promotions: { type: string; value: number }[]
): string | undefined {
  if (promotions.length === 0) return undefined;

  const percentages = promotions.filter(
    (p) => p.type === DiscountType.PERCENTAGE
  );
  if (percentages.length > 0) {
    const best = Math.max(...percentages.map((p) => p.value));
    // Rounded down — 12.5% is advertised as "12% OFF", never "13% OFF".
    return `${advertisedPercent(best)}% OFF`;
  }

  return "SALE";
}

/**
 * Loads the admin-curated "featured" categories — those with `isFeatured: true`
 * — ordered by `sliderOrder` ascending, and maps the DB rows into the shape
 * <CategorySlider /> expects. Each row also pulls its currently-live category
 * promotions so the slider can surface a premium discount badge.
 */
async function getSliderCategories(now: Date) {
  const categories = await prisma.category.findMany({
    where: { isFeatured: true },
    // Secondary `createdAt: "desc"` tie-break so categories sharing a
    // `sliderOrder` (the default 0, or any collision) keep a stable, deterministic
    // order instead of Postgres shuffling them arbitrarily between requests.
    orderBy: [{ sliderOrder: "asc" }, { createdAt: "desc" }],
    include: {
      promotions: {
        where: livePromotionWhere(now),
        select: { type: true, value: true },
      },
    },
  });

  return categories.map((category, i) => ({
    // Editorial watermark number ("01".."05"…) — kept presentational, not the cuid.
    id: String(i + 1).padStart(2, "0"),
    title: category.name,
    subtitle: category.subtitle ?? "",
    href: `/category/${category.slug}`,
    image: category.image ?? "/placeholder.jpg",
    alt: category.subtitle
      ? `${category.name} — ${category.subtitle}`
      : `${category.name} category`,
    // Promotion `value` is a Decimal column — coerce to number for the label math.
    discountLabel: discountLabelFor(
      category.promotions.map((p) => ({
        type: p.type,
        value: p.value.toNumber(),
      }))
    ),
  }));
}

/**
 * The live admin-managed hero slides, priced for display. Liveness is filtered
 * in the query and re-checked in memory against the SAME `now` (the pure rules
 * in `@/lib/hero-slides`); a product slide's starting price goes through the
 * Discount Engine exactly like a catalog card's — display-only, never billed.
 *
 * Decoration must never take down the hottest route: a failed read (e.g. a
 * not-yet-migrated environment) logs and falls back to the classic hero.
 */
async function getHeroSlides(now: Date): Promise<HeroSlideView[]> {
  try {
    const rows = await prisma.heroSlide.findMany({
      where: liveHeroSlideWhere(now),
      // `createdAt` tie-break keeps slides sharing an `order` deterministic.
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      take: HERO_MAX_LIVE_SLIDES,
      select: heroSlideStorefrontSelect(now),
    });
    return rows
      .filter((row) => isHeroSlideLive(row, now))
      .map((row) => toHeroSlideView(row, now))
      .filter((view): view is HeroSlideView => view !== null);
  } catch (err) {
    console.error("getHeroSlides failed — rendering the classic hero:", err);
    return [];
  }
}

export default async function ShopHomePage() {
  // One instant per request: every promotion/slide liveness check on the page
  // prices against the same `now`.
  const now = new Date();

  // Parallel reads — the hero slides, the featured-category slider and the
  // "Our Locations" showcase are independent, so fetch them together rather
  // than in a waterfall.
  const [heroSlides, sliderCategories, locations] = await Promise.all([
    getHeroSlides(now),
    getSliderCategories(now),
    getStorefrontLocations(),
  ]);

  return (
    // Navbar + Footer come from the (shop) layout, which also owns the <main>
    // landmark and the fixed-navbar clearance padding.
    <div className="min-h-screen bg-background font-sans" dir="ltr">
      {/* Once-per-session seasonal intro. Homepage only — not the (shop)
          layout — so a cart, checkout or product page never opens with it:
          each new tab is a fresh sessionStorage session. Client-only, so the
          cached HTML stays identical for every visitor. */}
      <SeasonalOverlay />

      {/* Live slides → the banner carousel, then a compact brand-intro band
          beneath it. None → the classic hero. Either way the strongest live
          promotion is the seal (a self-contained Server Component handed in
          as a slot; renders nothing when no promotion is live): top-left of
          the classic hero, beside the band's headline under the carousel. */}
      <Hero slides={heroSlides} promo={<PromoWidget />} />

      <CategorySlider categories={sliderCategories} />

      {/* Self-contained section (owns its own container + padding), like
          FaqsSection/OurStory. Renders nothing when no active locations. */}
      <BranchSelector locations={locations} />
      <FaqsSection />
      <OurStory />
    </div>
  );
}
