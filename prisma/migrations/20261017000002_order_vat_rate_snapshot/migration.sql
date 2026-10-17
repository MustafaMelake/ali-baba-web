-- Snapshot the VAT rate each order is billed at, so receipts can label the
-- VAT line with the order's own rate instead of a hard-coded "14%". The VAT
-- AMOUNT is still derived (totalAmount − subtotal − deliveryFee); this column
-- only names the rate. Nullable: orders placed before it existed show "VAT".
-- Adding a nullable column rewrites no rows.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "vatRate" DOUBLE PRECISION;
