-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_menuPageId_fkey";

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "menuPageId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_menuPageId_fkey" FOREIGN KEY ("menuPageId") REFERENCES "MenuPage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
