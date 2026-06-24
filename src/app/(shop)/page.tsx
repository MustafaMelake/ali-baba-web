import BranchSelector from "@/components/BranchSelector";
import CategorySlider from "@/components/CategorySlider";
import FeaturesBar from "@/components/FeaturesBar";
import Footer from "@/components/layout/Footer";
import Hero from "@/components/Hero";
import Navbar from "@/components/Navbar";
import OurStory from "@/components/OurStory";
import { prisma } from "@/lib/prisma";

// Re-fetch the core categories at most once per hour (tune or remove as needed).
export const revalidate = 3600;

/**
 * Loads the five "core" categories — the ones carrying a CategoryIdentifier —
 * and maps the DB rows into the shape <CategorySlider /> expects.
 * Ordered by `identifier` so the slider follows the enum's declared order
 * (ORIENTAL_SWEETS → WESTERN_SWEETS → MOULID_SWEETS → EID_SWEETS → BAKERY).
 */
async function getSliderCategories() {
  const categories = await prisma.category.findMany({
    where: { identifier: { not: null } },
    orderBy: { identifier: "asc" },
  });

  return categories.map((category, i) => ({
    // Editorial watermark number ("01".."05") — kept presentational, not the cuid.
    id: String(i + 1).padStart(2, "0"),
    title: category.name,
    subtitle: category.subtitle ?? "",
    href: `/category/${category.slug}`,
    image: category.image ?? "/placeholder.jpg",
    alt: category.subtitle
      ? `${category.name} — ${category.subtitle}`
      : `${category.name} category`,
  }));
}

export default async function ShopHomePage() {
  const sliderCategories = await getSliderCategories();

  return (
    <div className="min-h-screen bg-background font-sans" dir="ltr">
      <Navbar />

      <main>
        <Hero />

        <CategorySlider categories={sliderCategories} />

        <div className="max-w-7xl mx-auto px-6 py-12">
          <BranchSelector />
        </div>
      </main>

      <OurStory />
      <FeaturesBar />
      <Footer />
    </div>
  );
}
