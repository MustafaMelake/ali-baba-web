import { requireAdminPage } from "@/lib/session";
import { getAdminHeroSlides, getHeroProductOptions } from "@/lib/actions/hero-slides";
import { heroDestinationIssue, heroWindowState } from "@/lib/hero-slides";
import { STORE_TZ, storeDayKey } from "@/lib/timezone";
import PageHeader from "@/components/admin/PageHeader";
import HeroSlidesManager, { type HeroSlideAdminView } from "@/components/admin/HeroSlidesManager";

export const metadata = {
  title: "Hero Slides | Admin",
};

// Status badges compare each slide's window against "now" — always live data.
export const dynamic = "force-dynamic";

/** Cairo-local "21 Oct 2026" — the store's calendar day, never the server's. */
const dayFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: STORE_TZ,
});

export default async function AdminHeroPage() {
  // ADMIN-only screen — bounce a MANAGER before any data is read. Both loaders
  // re-assert the same gate server-side (defence in depth, never cosmetic).
  await requireAdminPage();

  const [slides, products] = await Promise.all([
    getAdminHeroSlides(),
    getHeroProductOptions(),
  ]);

  // One instant for every badge on the page — the same rule the storefront
  // filters with (`@/lib/hero-slides`).
  const now = new Date();

  // Dates → Cairo day keys (form values) + labels; nothing non-serializable
  // crosses to the client island.
  const rows: HeroSlideAdminView[] = slides.map((slide) => ({
    id: slide.id,
    eyebrow: slide.eyebrow,
    title: slide.title,
    subtitle: slide.subtitle,
    ctaLabel: slide.ctaLabel,
    showPrice: slide.showPrice,
    imageDesktop: slide.imageDesktop,
    imageMobile: slide.imageMobile,
    imageAlt: slide.imageAlt,
    productId: slide.productId,
    productName: slide.product?.name ?? null,
    linkUrl: slide.linkUrl,
    isActive: slide.isActive,
    startsOn: slide.startsAt ? storeDayKey(slide.startsAt) : null,
    endsOn: slide.endsAt ? storeDayKey(slide.endsAt) : null,
    startsLabel: slide.startsAt ? dayFmt.format(slide.startsAt) : null,
    endsLabel: slide.endsAt ? dayFmt.format(slide.endsAt) : null,
    status: heroWindowState(slide, now),
    issue: heroDestinationIssue(slide),
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        eyebrow="Storefront Content"
        title="Hero Slides"
        description="Banners shown at the top of the homepage — push new releases, link a product or any page, and schedule when each one runs."
      />

      {/* Fully wired to the `hero-slides` Server Actions (create / update /
          toggle / delete / reorder). Each write busts the homepage + this list. */}
      <HeroSlidesManager slides={rows} products={products} />
    </div>
  );
}
