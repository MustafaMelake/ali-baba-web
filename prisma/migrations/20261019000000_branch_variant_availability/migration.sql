-- Branch-level stock: a MANAGER can mark a variant out of stock at their own
-- branch without touching the global Product/ProductVariant.isAvailable flags
-- (those stay the ADMIN's master switch). A missing row means "available", so
-- nothing needs backfilling — every existing variant stays in stock everywhere.
-- Purely additive: one new table, no existing row is rewritten.

-- CreateTable
CREATE TABLE "BranchVariantAvailability" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchVariantAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BranchVariantAvailability_variantId_idx" ON "BranchVariantAvailability"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "BranchVariantAvailability_branchId_variantId_key" ON "BranchVariantAvailability"("branchId", "variantId");

-- AddForeignKey
ALTER TABLE "BranchVariantAvailability" ADD CONSTRAINT "BranchVariantAvailability_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchVariantAvailability" ADD CONSTRAINT "BranchVariantAvailability_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

