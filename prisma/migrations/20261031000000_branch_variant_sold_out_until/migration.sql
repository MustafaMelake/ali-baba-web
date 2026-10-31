-- "Sold out today": a MANAGER marks a variant (or a whole product's sizes) out
-- of stock at their own branch for the rest of the Cairo day. The new column
-- holds the UTC instant of the next Cairo midnight; every reader compares it to
-- `now`, so the variant comes back on its own with no cron and no manual undo.
--
-- Independent of isAvailable (the head-office long-term switch), which this
-- feature never touches. Purely additive and nullable — null means "not sold
-- out today", so no existing row needs backfilling.

-- AlterTable
ALTER TABLE "BranchVariantAvailability" ADD COLUMN "soldOutUntil" TIMESTAMP(3);
