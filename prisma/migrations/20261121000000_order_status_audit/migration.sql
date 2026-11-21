-- Audit M-3: who moved an order to its current status, and when.
-- Purely additive: two NULLABLE columns (existing rows stay NULL — "changed
-- before tracking began") and a SET NULL foreign key, so deleting a staff
-- account never blocks or rewrites order history. No data is touched.
-- No index on statusChangedById: it is only read per order, and a User delete
-- (the one query that would scan by it) is rare and admin-driven.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "statusChangedAt" TIMESTAMP(3),
ADD COLUMN     "statusChangedById" TEXT;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_statusChangedById_fkey" FOREIGN KEY ("statusChangedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
