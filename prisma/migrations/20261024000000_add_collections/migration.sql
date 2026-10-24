-- Collections: an admin-curated, ordered set of products with its own page
-- (/collections/[slug]), shown as cards on any number of category pages.
-- Distinct from Category by design: a product has one Category but may sit in
-- many Collections.
--
-- Every ON DELETE CASCADE here removes LINK rows only (CollectionProduct /
-- CollectionCategory): deleting a collection never deletes a product or a
-- category, and deleting a product/category only drops its own links.
-- New collections start inactive (drafts). Purely additive: three new tables,
-- no existing row is touched.

-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "image" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "showInFooter" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionProduct" (
    "collectionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionProduct_pkey" PRIMARY KEY ("collectionId","productId")
);

-- CreateTable
CREATE TABLE "CollectionCategory" (
    "collectionId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "CollectionCategory_pkey" PRIMARY KEY ("collectionId","categoryId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Collection_slug_key" ON "Collection"("slug");

-- CreateIndex
CREATE INDEX "Collection_isActive_order_idx" ON "Collection"("isActive", "order");

-- CreateIndex
CREATE INDEX "CollectionProduct_collectionId_order_idx" ON "CollectionProduct"("collectionId", "order");

-- CreateIndex
CREATE INDEX "CollectionProduct_productId_idx" ON "CollectionProduct"("productId");

-- CreateIndex
CREATE INDEX "CollectionCategory_categoryId_idx" ON "CollectionCategory"("categoryId");

-- AddForeignKey
ALTER TABLE "CollectionProduct" ADD CONSTRAINT "CollectionProduct_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionProduct" ADD CONSTRAINT "CollectionProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionCategory" ADD CONSTRAINT "CollectionCategory_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionCategory" ADD CONSTRAINT "CollectionCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

