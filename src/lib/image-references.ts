// ─────────────────────────────────────────────────────────────────────────────
// Image references — which stored image URLs some row still points at.
//
// The reference check behind every R2 purge (deleteUploadedFiles in r2.ts).
// One bucket object can back several rows: the R2 migration copied a source
// URL used by several rows ONCE and gave them all the same public URL, and the
// image columns accept any hosted URL. A purge that assumed "this row was the
// only user" could delete another row's only copy — the UploadThing originals
// are gone (audit M-1). So a URL is purged only when no column anywhere still
// holds it.
//
// EVERY column that stores an uploaded image URL is listed here. A new image
// column must be added too, or a purge could delete a file it still shows.
//
// Server-only by dependency (Prisma). Plain module, not "use server".
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";

/**
 * The subset of `urls` that some row still references, across Category.image,
 * Location.imageUrl, Product.images[], HeroSlide.imageDesktop / imageMobile and
 * Collection.image. Bounded: one indexed-or-small read per table for the
 * handful of URLs a single mutation purges. A query failure propagates — the
 * caller treats it as "keep everything".
 */
export async function findReferencedImageUrls(urls: readonly string[]): Promise<Set<string>> {
  const list = [...new Set(urls)];
  if (list.length === 0) return new Set();

  const [categories, locations, products, heroSlides, collections] = await Promise.all([
    prisma.category.findMany({ where: { image: { in: list } }, select: { image: true } }),
    prisma.location.findMany({ where: { imageUrl: { in: list } }, select: { imageUrl: true } }),
    prisma.product.findMany({ where: { images: { hasSome: list } }, select: { images: true } }),
    prisma.heroSlide.findMany({
      where: { OR: [{ imageDesktop: { in: list } }, { imageMobile: { in: list } }] },
      select: { imageDesktop: true, imageMobile: true },
    }),
    prisma.collection.findMany({ where: { image: { in: list } }, select: { image: true } }),
  ]);

  const held = new Set<string | null>([
    ...categories.map((c) => c.image),
    ...locations.map((l) => l.imageUrl),
    ...products.flatMap((p) => p.images),
    ...heroSlides.flatMap((h) => [h.imageDesktop, h.imageMobile]),
    ...collections.map((c) => c.image),
  ]);
  return new Set(list.filter((url) => held.has(url)));
}
