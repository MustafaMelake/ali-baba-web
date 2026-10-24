-- Collection-targeted promotions: the Discount Engine's fourth targeting level
-- (variant, product, category, collection). Implicit many-to-many join, the
-- same shape as the existing category/product/variant targets: deleting a
-- collection or a promotion removes only the join row — never the other side.
-- A collection target prices its products only while the collection is active
-- (enforced by the shared promotion include, not here). Purely additive.

-- CreateTable
CREATE TABLE "_CollectionToPromotion" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CollectionToPromotion_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_CollectionToPromotion_B_index" ON "_CollectionToPromotion"("B");

-- AddForeignKey
ALTER TABLE "_CollectionToPromotion" ADD CONSTRAINT "_CollectionToPromotion_A_fkey" FOREIGN KEY ("A") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CollectionToPromotion" ADD CONSTRAINT "_CollectionToPromotion_B_fkey" FOREIGN KEY ("B") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

