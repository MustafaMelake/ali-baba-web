/*
  Warnings:

  - A unique constraint covering the columns `[userId,productId]` on the table `Review` will be added. If there are existing duplicate values, this will fail.
  - You are about to drop the index `Review_userId_idx` on the `Review` table.

*/
-- DropIndex
DROP INDEX "Review_userId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Review_userId_productId_key" ON "Review"("userId", "productId");
