-- Audit M-5 + L-15: indexes shaped like the dashboard, orders-board and
-- analytics queries. Index-only: no table, column or row is touched, so no
-- data can be lost. The two dropped Order indexes are exact prefixes of the
-- new composites (Postgres serves a leading-column lookup from them); the
-- dropped VisitEvent index has had no reader since the funnel moved to SQL
-- aggregates over a createdAt window (audit H-2).
-- Plain CREATE INDEX (not CONCURRENTLY): Prisma runs a migration as one
-- script, and on tables this size the build takes milliseconds of write lock.

-- DropIndex
DROP INDEX "Order_branchId_idx";

-- DropIndex
DROP INDEX "Order_status_idx";

-- DropIndex
DROP INDEX "VisitEvent_type_createdAt_idx";

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_branchId_createdAt_idx" ON "Order"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_branchId_status_createdAt_idx" ON "Order"("branchId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "User_branchId_idx" ON "User"("branchId");
