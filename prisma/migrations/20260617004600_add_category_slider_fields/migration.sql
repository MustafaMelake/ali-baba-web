-- CreateEnum
CREATE TYPE "CategoryIdentifier" AS ENUM ('ORIENTAL_SWEETS', 'WESTERN_SWEETS', 'MOULID_SWEETS', 'EID_SWEETS', 'BAKERY');

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "identifier" "CategoryIdentifier",
ADD COLUMN     "image" TEXT,
ADD COLUMN     "subtitle" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Category_identifier_key" ON "Category"("identifier");
