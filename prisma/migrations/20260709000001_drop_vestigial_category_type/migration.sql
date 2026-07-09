-- DropIndex
DROP INDEX "MenuPage_type_idx";

-- AlterTable
ALTER TABLE "Category" DROP COLUMN "type";

-- AlterTable
ALTER TABLE "MenuPage" DROP COLUMN "type";

-- DropEnum
DROP TYPE "CategoryType";
