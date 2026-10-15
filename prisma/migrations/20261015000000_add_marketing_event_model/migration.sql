-- CreateEnum
CREATE TYPE "MarketingEventType" AS ENUM ('RELIGIOUS_HOLIDAY', 'EGYPTIAN_HOLIDAY', 'RETAIL_SEASON', 'CAMPAIGN');

-- CreateTable
CREATE TABLE "MarketingEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "MarketingEventType" NOT NULL DEFAULT 'CAMPAIGN',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "notes" TEXT,
    "targetDiscountPercent" INTEGER,
    "strategy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingEvent_startDate_endDate_idx" ON "MarketingEvent"("startDate", "endDate");
