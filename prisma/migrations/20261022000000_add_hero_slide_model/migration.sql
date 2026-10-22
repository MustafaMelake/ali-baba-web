-- Homepage hero slides: admin-managed banners rendered inside the Hero's image
-- frame to push newly released products. Each slide links EITHER a product
-- (productId) OR a whitelisted URL (linkUrl) — exactly-one is enforced by the
-- shared heroSlideSchema, not here (this codebase has no CHECK constraints).
-- Product → HeroSlide is ON DELETE SET NULL: deleting a never-ordered product is
-- neither blocked by a banner nor allowed to drop the slide and orphan its
-- images; a slide left without a destination is hidden by the storefront read.
-- Slides are created inactive (drafts); no price is stored — `showPrice` only
-- toggles the render-time Discount-Engine price on a product slide.
-- Purely additive: one new table, no existing row is rewritten.

-- CreateTable
CREATE TABLE "HeroSlide" (
    "id" TEXT NOT NULL,
    "eyebrow" TEXT,
    "title" TEXT,
    "subtitle" TEXT,
    "ctaLabel" TEXT NOT NULL DEFAULT 'Order now',
    "showPrice" BOOLEAN NOT NULL DEFAULT true,
    "imageDesktop" TEXT NOT NULL,
    "imageMobile" TEXT,
    "imageAlt" TEXT NOT NULL,
    "productId" TEXT,
    "linkUrl" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HeroSlide_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HeroSlide_isActive_order_idx" ON "HeroSlide"("isActive", "order");

-- CreateIndex
CREATE INDEX "HeroSlide_productId_idx" ON "HeroSlide"("productId");

-- AddForeignKey
ALTER TABLE "HeroSlide" ADD CONSTRAINT "HeroSlide_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

