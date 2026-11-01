-- Visitor analytics: one row per client-side storefront tracker event (page
-- view, product view, add-to-cart, checkout start), feeding the /admin
-- visitor funnel. Purely additive. branchId / productId are plain columns with
-- NO foreign keys — an append-only analytics log must never block, or vanish
-- with, a product or branch delete.

-- CreateEnum
CREATE TYPE "VisitEventType" AS ENUM ('VIEW', 'PRODUCT_VIEW', 'ADD_TO_CART', 'CHECKOUT_START');

-- CreateTable
CREATE TABLE "VisitEvent" (
    "id" TEXT NOT NULL,
    "type" "VisitEventType" NOT NULL,
    "visitorId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "branchId" TEXT,
    "productId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VisitEvent_type_createdAt_idx" ON "VisitEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "VisitEvent_createdAt_idx" ON "VisitEvent"("createdAt");

-- CreateIndex
CREATE INDEX "VisitEvent_branchId_createdAt_idx" ON "VisitEvent"("branchId", "createdAt");
