import BranchSelector from "@/components/BranchSelector";
import CategorySlider from "@/components/CategorySlider";
import FeaturesBar from "@/components/FeaturesBar";
import Hero from "@/components/Hero";
import OurStory from "@/components/OurStory";
import { prisma } from "@/lib/prisma";
import { livePromotionWhere } from "@/lib/discounts";
import { DiscountType } from "@/generated/prisma/enums";

// Fully dynamic: the slider categories (and their promotion badges) are
// re-queried on every request, so a freshly-started/expired promotion is
// reflected immediately — there's no cache window to lag behind. Category
// mutations also call revalidatePath("/"). Switch to a positive `revalidate`
// (e.g. 3600) to trade that immediacy for fewer DB reads on this hot route.
export const revalidate = 0;

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
    return `${Math.round(best)}% OFF`;
  }

  return "SALE";
}

/**
 * Loads the admin-curated "featured" categories — those with `isFeatured: true`
 * — ordered by `sliderOrder` ascending, and maps the DB rows into the shape
 * <CategorySlider /> expects. Each row also pulls its currently-live category
 * promotions so the slider can surface a premium discount badge.
 */
async function getSliderCategories() {
  const now = new Date();

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
    discountLabel: discountLabelFor(category.promotions),
  }));
}

export default async function ShopHomePage() {
  const sliderCategories = await getSliderCategories();

  return (
    // Navbar + Footer come from the (shop) layout, which also owns the <main>
    // landmark and the fixed-navbar clearance padding.
    <div className="min-h-screen bg-background font-sans" dir="ltr">
      <Hero />

      <CategorySlider categories={sliderCategories} />

      <div className="max-w-7xl mx-auto px-6 py-12">
        <BranchSelector />
      </div>

      <OurStory />
      <FeaturesBar />
    </div>
  );
}
