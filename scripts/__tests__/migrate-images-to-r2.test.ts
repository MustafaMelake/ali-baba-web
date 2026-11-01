// ─────────────────────────────────────────────────────────────────────────────
// Image migration to R2 (scripts/migrate-images-to-r2.ts) — the core loop.
//
// Pins: a URL already on R2 (and a /public path) is skipped — re-running is a
// no-op; an off-R2 image is copied under its kind's folder with its SNIFFED
// type and the row rewritten; one source shared by several rows is copied
// once; a fetch failure or a non-image leaves the value untouched and is
// listed; a product keeps the slots that failed while the rest migrate; a dry
// run writes nothing.
//
// No database or R2: migrateImages takes every boundary as a dependency.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrateImages, type ImageRows, type MigrationDeps } from "../migrate-images-to-r2";

const R2 = "https://img.alibaba.test";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

function emptyRows(): ImageRows {
  return { categories: [], locations: [], products: [], heroSlides: [], collections: [] };
}

let counter = 0;
function makeDeps(rows: ImageRows, overrides: Partial<MigrationDeps> = {}) {
  const save = {
    category: vi.fn(async () => {}),
    location: vi.fn(async () => {}),
    product: vi.fn(async () => {}),
    heroSlide: vi.fn(async () => {}),
    collection: vi.fn(async () => {}),
  };
  const deps = {
    load: vi.fn(async () => rows),
    isOnR2: (url: string) => url.startsWith(`${R2}/`),
    fetchImage: vi.fn(async (url: string) =>
      url.includes("missing") ? { error: "HTTP 404" } : { bytes: url.endsWith(".jpg") ? JPEG : PNG },
    ),
    putImage: vi.fn(async (folder: string, _bytes: Uint8Array, type: string) => `${R2}/${folder}/n${++counter}.${type.split("/")[1]}`),
    save,
    ...overrides,
  };
  return deps;
}

beforeEach(() => {
  counter = 0;
});

describe("migrateImages — idempotence", () => {
  it("skips URLs already on R2 and /public paths — nothing fetched, nothing written", async () => {
    const rows: ImageRows = {
      ...emptyRows(),
      categories: [{ id: "c1", image: `${R2}/categories/a.png` }, { id: "c2", image: null }],
      locations: [{ id: "l1", imageUrl: "/locations/maadi.jpg" }],
      products: [{ id: "p1", images: [`${R2}/products/x.webp`, "/placeholder.jpg"] }],
      heroSlides: [{ id: "h1", imageDesktop: `${R2}/hero/d.png`, imageMobile: null }],
      collections: [{ id: "k1", image: `${R2}/collections/k.png` }],
    };
    const deps = makeDeps(rows);

    const report = await migrateImages(deps);

    expect(deps.fetchImage).not.toHaveBeenCalled();
    expect(deps.putImage).not.toHaveBeenCalled();
    for (const fn of Object.values(deps.save)) expect(fn).not.toHaveBeenCalled();
    expect(report).toEqual({ scanned: 6, alreadyOnR2: 4, publicPaths: 2, copied: 0, rowsUpdated: 0, failed: [] });
  });

  it("is a no-op the second time round", async () => {
    const rows: ImageRows = { ...emptyRows(), categories: [{ id: "c1", image: "https://x.ufs.sh/f/a" }] };
    const first = makeDeps(rows);
    await migrateImages(first);
    const migrated = vi.mocked(first.save.category).mock.calls[0][1];

    const second = makeDeps({ ...emptyRows(), categories: [{ id: "c1", image: migrated }] });
    const report = await migrateImages(second);

    expect(second.putImage).not.toHaveBeenCalled();
    expect(report.copied).toBe(0);
    expect(report.alreadyOnR2).toBe(1);
  });
});

describe("migrateImages — copying", () => {
  it("copies each kind into its folder with the sniffed type and rewrites the row", async () => {
    const rows: ImageRows = {
      categories: [{ id: "c1", image: "https://x.ufs.sh/f/cat" }],
      locations: [{ id: "l1", imageUrl: "https://utfs.io/f/loc.jpg" }],
      products: [{ id: "p1", images: ["https://x.ufs.sh/f/p1", `${R2}/products/kept.png`] }],
      heroSlides: [{ id: "h1", imageDesktop: "https://x.ufs.sh/f/d", imageMobile: "https://x.ufs.sh/f/m" }],
      collections: [{ id: "k1", image: "https://x.ufs.sh/f/k" }],
    };
    const deps = makeDeps(rows);

    const report = await migrateImages(deps);

    expect(vi.mocked(deps.putImage).mock.calls.map(([folder, , type]) => [folder, type])).toEqual([
      ["categories", "image/png"],
      ["locations", "image/jpeg"],
      ["products", "image/png"],
      ["hero", "image/png"],
      ["hero", "image/png"],
      ["collections", "image/png"],
    ]);
    expect(deps.save.category).toHaveBeenCalledWith("c1", `${R2}/categories/n1.png`);
    expect(deps.save.location).toHaveBeenCalledWith("l1", `${R2}/locations/n2.jpeg`);
    expect(deps.save.product).toHaveBeenCalledWith("p1", [`${R2}/products/n3.png`, `${R2}/products/kept.png`]);
    expect(deps.save.heroSlide).toHaveBeenCalledWith("h1", {
      imageDesktop: `${R2}/hero/n4.png`,
      imageMobile: `${R2}/hero/n5.png`,
    });
    expect(deps.save.collection).toHaveBeenCalledWith("k1", `${R2}/collections/n6.png`);
    expect(report).toMatchObject({ copied: 6, rowsUpdated: 5, alreadyOnR2: 1, failed: [] });
  });

  it("copies a source shared by several rows only once", async () => {
    const shared = "https://x.ufs.sh/f/shared";
    const deps = makeDeps({
      ...emptyRows(),
      products: [
        { id: "p1", images: [shared] },
        { id: "p2", images: [shared] },
      ],
    });

    const report = await migrateImages(deps);

    expect(deps.putImage).toHaveBeenCalledTimes(1);
    expect(deps.save.product).toHaveBeenCalledTimes(2);
    expect(report.copied).toBe(1);
  });
});

describe("migrateImages — failures leave data untouched", () => {
  it("lists a URL it can't fetch and keeps the stored value", async () => {
    const deps = makeDeps({ ...emptyRows(), categories: [{ id: "c1", image: "https://x.ufs.sh/f/missing" }] });

    const report = await migrateImages(deps);

    expect(deps.save.category).not.toHaveBeenCalled();
    expect(report.failed).toEqual([{ url: "https://x.ufs.sh/f/missing", where: "Category c1", reason: "HTTP 404" }]);
  });

  it("refuses a download that isn't an image", async () => {
    const deps = makeDeps(
      { ...emptyRows(), collections: [{ id: "k1", image: "https://x.ufs.sh/f/page" }] },
      { fetchImage: vi.fn(async () => ({ bytes: new TextEncoder().encode("<html>") })) },
    );

    const report = await migrateImages(deps);

    expect(deps.putImage).not.toHaveBeenCalled();
    expect(report.failed[0].reason).toMatch(/not a .*image/);
  });

  it("keeps a product's failed slot in place while the other images migrate", async () => {
    const deps = makeDeps({
      ...emptyRows(),
      products: [{ id: "p1", images: ["https://x.ufs.sh/f/missing", "https://x.ufs.sh/f/ok"] }],
    });

    const report = await migrateImages(deps);

    expect(deps.save.product).toHaveBeenCalledWith("p1", ["https://x.ufs.sh/f/missing", `${R2}/products/n1.png`]);
    expect(report.failed).toHaveLength(1);
  });

  it("reports an R2 upload error instead of throwing", async () => {
    const deps = makeDeps(
      { ...emptyRows(), categories: [{ id: "c1", image: "https://x.ufs.sh/f/a" }] },
      { putImage: vi.fn(async () => Promise.reject(new Error("AccessDenied"))) },
    );

    const report = await migrateImages(deps);

    expect(deps.save.category).not.toHaveBeenCalled();
    expect(report.failed[0].reason).toBe("R2 upload failed: AccessDenied");
  });
});

describe("migrateImages — dry run", () => {
  it("fetches and checks but uploads and writes nothing", async () => {
    const deps = makeDeps(
      { ...emptyRows(), categories: [{ id: "c1", image: "https://x.ufs.sh/f/a" }] },
      { dryRun: true },
    );

    const report = await migrateImages(deps);

    expect(deps.fetchImage).toHaveBeenCalledTimes(1);
    expect(deps.putImage).not.toHaveBeenCalled();
    expect(deps.save.category).not.toHaveBeenCalled();
    expect(report).toMatchObject({ copied: 1, rowsUpdated: 1 });
  });
});
