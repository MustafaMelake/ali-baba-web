// ─────────────────────────────────────────────────────────────────────────────
// One-off: copy every stored image to Cloudflare R2 and rewrite its URL.
//
//   npx tsx scripts/migrate-images-to-r2.ts            # migrate
//   npx tsx scripts/migrate-images-to-r2.ts --dry-run  # report only, no writes
//
// Scans Category.image, Location.imageUrl, Product.images[],
// HeroSlide.imageDesktop + imageMobile and Collection.image. A URL already on
// the R2 public base, or a /public path, is left alone; anything else is
// downloaded, checked to really be an image (sniffImageType — never the remote
// Content-Type), PUT to R2 under its kind's folder, and the row rewritten to
// the new public URL. The same source URL used by several rows is uploaded
// once.
//
// Safe to re-run: it is idempotent (migrated URLs are on R2 and skipped next
// time), it never deletes a row or an object, and a URL it can't fetch or that
// isn't an image is left untouched and listed in the report. Not a Prisma
// migration — it moves data in the bucket, not the schema.
//
// Needs DATABASE_URL + the R2 env (.env is loaded). Run it against the dev
// database first; the UploadThing hosts may only be dropped from next.config
// and isHostedImageUrl once a run reports zero remaining remote URLs.
// ─────────────────────────────────────────────────────────────────────────────

import { pathToFileURL } from "node:url";
import { sniffImageType, type UploadFolder, type UploadImageType } from "@/lib/validators";

export type ImageRows = {
  categories: { id: string; image: string | null }[];
  locations: { id: string; imageUrl: string }[];
  products: { id: string; images: string[] }[];
  heroSlides: { id: string; imageDesktop: string; imageMobile: string | null }[];
  collections: { id: string; image: string | null }[];
};

export type MigrationDeps = {
  load: () => Promise<ImageRows>;
  /** True when the URL is already on the R2 public base. */
  isOnR2: (url: string) => boolean;
  /** The image bytes, or a reason it couldn't be fetched. */
  fetchImage: (url: string) => Promise<{ bytes: Uint8Array } | { error: string }>;
  putImage: (folder: UploadFolder, bytes: Uint8Array, contentType: UploadImageType) => Promise<string>;
  save: {
    category: (id: string, image: string) => Promise<void>;
    location: (id: string, imageUrl: string) => Promise<void>;
    product: (id: string, images: string[]) => Promise<void>;
    heroSlide: (id: string, data: { imageDesktop: string; imageMobile: string | null }) => Promise<void>;
    collection: (id: string, image: string) => Promise<void>;
  };
  dryRun?: boolean;
};

export type MigrationReport = {
  /** Every non-empty image value scanned (an array counts per entry). */
  scanned: number;
  alreadyOnR2: number;
  publicPaths: number;
  /** Distinct source URLs copied to R2 (or that would be, in a dry run). */
  copied: number;
  /** Rows rewritten (or that would be). */
  rowsUpdated: number;
  /** Values left untouched because their source couldn't be copied. */
  failed: { url: string; where: string; reason: string }[];
};

/** Copy every off-R2 image to R2 and rewrite the rows. Never throws for a single bad URL. */
export async function migrateImages(deps: MigrationDeps): Promise<MigrationReport> {
  const report: MigrationReport = {
    scanned: 0,
    alreadyOnR2: 0,
    publicPaths: 0,
    copied: 0,
    rowsUpdated: 0,
    failed: [],
  };
  // source URL → its R2 URL (or the failure), so a shared image is copied once.
  const done = new Map<string, { url: string } | { error: string }>();

  /** The value to store for `url`: unchanged, or its new R2 URL. */
  async function migrate(url: string | null, folder: UploadFolder, where: string): Promise<string | null> {
    if (!url) return url;
    report.scanned++;
    if (url.startsWith("/")) {
      report.publicPaths++;
      return url;
    }
    if (deps.isOnR2(url)) {
      report.alreadyOnR2++;
      return url;
    }

    let result = done.get(url);
    if (!result) {
      result = await copy(url, folder);
      done.set(url, result);
      if ("url" in result) report.copied++;
    }
    if ("error" in result) {
      report.failed.push({ url, where, reason: result.error });
      return url;
    }
    return result.url;
  }

  async function copy(url: string, folder: UploadFolder): Promise<{ url: string } | { error: string }> {
    const fetched = await deps.fetchImage(url);
    if ("error" in fetched) return fetched;
    const type = sniffImageType(fetched.bytes);
    if (!type) return { error: "not a JPEG/PNG/WebP/AVIF/GIF image" };
    if (deps.dryRun) return { url: `(dry run) ${folder}/…` };
    try {
      return { url: await deps.putImage(folder, fetched.bytes, type) };
    } catch (err) {
      return { error: `R2 upload failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  async function write(save: () => Promise<void>) {
    report.rowsUpdated++;
    if (!deps.dryRun) await save();
  }

  const rows = await deps.load();

  for (const c of rows.categories) {
    const image = await migrate(c.image, "categories", `Category ${c.id}`);
    if (image !== c.image && image) await write(() => deps.save.category(c.id, image));
  }
  for (const l of rows.locations) {
    const imageUrl = await migrate(l.imageUrl, "locations", `Location ${l.id}`);
    if (imageUrl !== l.imageUrl && imageUrl) await write(() => deps.save.location(l.id, imageUrl));
  }
  for (const p of rows.products) {
    const images: string[] = [];
    for (const [i, url] of p.images.entries()) {
      images.push((await migrate(url, "products", `Product ${p.id} image ${i + 1}`)) ?? url);
    }
    if (images.some((url, i) => url !== p.images[i])) await write(() => deps.save.product(p.id, images));
  }
  for (const h of rows.heroSlides) {
    const imageDesktop = (await migrate(h.imageDesktop, "hero", `HeroSlide ${h.id} desktop`)) ?? h.imageDesktop;
    const imageMobile = await migrate(h.imageMobile, "hero", `HeroSlide ${h.id} mobile`);
    if (imageDesktop !== h.imageDesktop || imageMobile !== h.imageMobile) {
      await write(() => deps.save.heroSlide(h.id, { imageDesktop, imageMobile }));
    }
  }
  for (const c of rows.collections) {
    const image = await migrate(c.image, "collections", `Collection ${c.id}`);
    if (image !== c.image && image) await write(() => deps.save.collection(c.id, image));
  }

  return report;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 30_000;

async function fetchImage(url: string): Promise<{ bytes: Uint8Array } | { error: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return { bytes: new Uint8Array(await res.arrayBuffer()) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  await import("dotenv/config");
  const dryRun = process.argv.includes("--dry-run");
  // Imported only here, so the test can load migrateImages without a database or R2.
  const { prisma } = await import("@/lib/prisma");
  const { keyFromUrl, putImage, r2Client } = await import("@/lib/r2");
  const { r2PublicBase } = await import("@/lib/validators");

  // Fail fast on missing config, before touching any row.
  if (!r2PublicBase()) throw new Error("NEXT_PUBLIC_R2_PUBLIC_BASE_URL is missing or not an https URL.");
  r2Client();
  const base = r2PublicBase()!;
  const isOnR2 = (url: string) => keyFromUrl(url) !== null || url.startsWith(`${base.origin}${base.prefix}/`);

  console.log(`Migrating images to R2${dryRun ? " (DRY RUN — nothing is written)" : ""}…`);
  try {
    const report = await migrateImages({
      dryRun,
      isOnR2,
      fetchImage,
      putImage,
      load: async () => {
        const [categories, locations, products, heroSlides, collections] = await Promise.all([
          prisma.category.findMany({ select: { id: true, image: true } }),
          prisma.location.findMany({ select: { id: true, imageUrl: true } }),
          prisma.product.findMany({ select: { id: true, images: true } }),
          prisma.heroSlide.findMany({ select: { id: true, imageDesktop: true, imageMobile: true } }),
          prisma.collection.findMany({ select: { id: true, image: true } }),
        ]);
        return { categories, locations, products, heroSlides, collections };
      },
      save: {
        category: async (id, image) => void (await prisma.category.update({ where: { id }, data: { image } })),
        location: async (id, imageUrl) => void (await prisma.location.update({ where: { id }, data: { imageUrl } })),
        product: async (id, images) => void (await prisma.product.update({ where: { id }, data: { images } })),
        heroSlide: async (id, data) => void (await prisma.heroSlide.update({ where: { id }, data })),
        collection: async (id, image) =>
          void (await prisma.collection.update({ where: { id }, data: { image } })),
      },
    });

    console.log(`
Scanned image values : ${report.scanned}
Already on R2        : ${report.alreadyOnR2}
/public paths (kept) : ${report.publicPaths}
Copied to R2         : ${report.copied}
Rows updated         : ${report.rowsUpdated}
Failed (untouched)   : ${report.failed.length}`);
    for (const f of report.failed) console.log(`  - ${f.where}: ${f.url}\n      ${f.reason}`);
    if (report.failed.length === 0 && !dryRun) {
      console.log("\nEvery stored image is on R2 or a /public path.");
    }
    process.exitCode = report.failed.length > 0 ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
