import { prisma } from "@/lib/prisma";
import { LISTABLE_PRODUCT } from "@/lib/catalog";
import type { CollectionCardData } from "@/components/CollectionCard";

// ─────────────────────────────────────────────────────────────────────────────
// Collections — storefront reads (server-only; not "use server": these never
// take a POST, they're imported by RSC pages).
//
// Only ACTIVE collections exist for customers. Product counts are LISTABLE
// products only — what the collection page will actually show — computed in
// ONE grouped query for any number of collections, never one count per card.
// ─────────────────────────────────────────────────────────────────────────────

/** The storefront filter: a collection customers can see. */
export const ACTIVE_COLLECTION = { isActive: true } as const;

/** Listable-product count per collection, in one grouped query. */
export async function listableCountsByCollection(
  collectionIds: string[],
): Promise<Map<string, number>> {
  if (collectionIds.length === 0) return new Map();
  const rows = await prisma.collectionProduct.groupBy({
    by: ["collectionId"],
    where: { collectionId: { in: collectionIds }, product: LISTABLE_PRODUCT },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.collectionId, r._count._all]));
}

const CARD_SELECT = { id: true, slug: true, name: true, description: true, image: true } as const;

/** Attach listable counts to card rows (one grouped query for the batch). */
async function withCounts(
  rows: { id: string; slug: string; name: string; description: string | null; image: string | null }[],
): Promise<CollectionCardData[]> {
  const counts = await listableCountsByCollection(rows.map((r) => r.id));
  return rows.map(({ id, ...row }) => ({ ...row, productCount: counts.get(id) ?? 0 }));
}

/** The active collections shown as cards on a category page, in global order. */
export async function getCategoryCollectionCards(categoryId: string): Promise<CollectionCardData[]> {
  const rows = await prisma.collection.findMany({
    where: { ...ACTIVE_COLLECTION, categories: { some: { categoryId } } },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: CARD_SELECT,
  });
  return withCounts(rows);
}

/** One page of the /collections index, plus the total active count. */
export async function getCollectionIndexPage(
  skip: number,
  take: number,
): Promise<{ total: number; cards: CollectionCardData[] }> {
  const [total, rows] = await Promise.all([
    prisma.collection.count({ where: ACTIVE_COLLECTION }),
    prisma.collection.findMany({
      where: ACTIVE_COLLECTION,
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: CARD_SELECT,
      skip,
      take,
    }),
  ]);
  return { total, cards: await withCounts(rows) };
}
