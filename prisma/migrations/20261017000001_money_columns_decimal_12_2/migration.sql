-- Money columns: DECIMAL(65,30) → DECIMAL(12,2). Every amount is rounded to
-- 2 dp by roundMoney before it is written; the column now enforces it too,
-- and caps amounts below 10^10. StoreSettings.vatRate stays a Float (a rate,
-- not money).
--
-- Unlike the catch-up before it, this one RUNS on production at the next
-- deploy. Checked read-only on 2026-10-17: no stored money value had more than
-- 2 decimals or reached 10^10, so the conversion changes no value.

-- AlterTable
ALTER TABLE "Branch" ALTER COLUMN "deliveryFee" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "MenuItem" ALTER COLUMN "price" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "subtotal" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "deliveryFee" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "totalAmount" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "OrderItem" ALTER COLUMN "unitPrice" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "ProductVariant" ALTER COLUMN "price" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "compareAtPrice" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "Promotion" ALTER COLUMN "value" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "StoreSettings" ALTER COLUMN "defaultDeliveryFee" SET DATA TYPE DECIMAL(12,2);

