// ─────────────────────────────────────────────────────────────────────────────
// Collection actions — unit/integration suite (src/lib/actions/collections.ts).
//
// Locks:
//   • GATE — every mutation is ADMIN-only (envelope, nothing written).
//   • SLUGS — minted once from the name (`-2`, `-3` on collision), a non-Latin
//     name falls back to a random slug, "page" is reserved (it's the index's
//     pagination segment).
//   • LINKS — products are stored in the order sent (index = position), within
//     COLLECTION_MAX_PRODUCTS; bulk-add appends after the last position and
//     skips duplicates; the product form appends new memberships at the END of
//     each collection and removes dropped ones.
//   • FAN-OUT — the index, the collection's page, every linked category page
//     (before AND after a change), the footer tag and the admin list.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));
vi.mock("@/lib/session", () => ({ getServerSession: vi.fn(), requireAdmin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/uploadthing-server", () => ({ deleteUploadedFiles: vi.fn() }));

import {
  addCategoryProductsToCollection,
  createCollection,
  deleteCollection,
  setCollectionCategories,
  setCollectionProducts,
  setProductCollections,
} from "@/lib/actions/collections";
import { requireAdmin } from "@/lib/session";
import { revalidatePath, updateTag } from "next/cache";
import { COLLECTION_MAX_PRODUCTS } from "@/lib/validators";

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>;
const mockedRequireAdmin = vi.mocked(requireAdmin);
const mockedRevalidate = vi.mocked(revalidatePath);
const mockedUpdateTag = vi.mocked(updateTag);
const groupBy = mockPrisma.collectionProduct.groupBy as unknown as ReturnType<typeof vi.fn>;

vi.spyOn(console, "error").mockImplementation(() => {});

const prismaError = (code: string) => Object.assign(new Error(code), { code });
const input = (overrides: Record<string, unknown> = {}) => ({
  name: "Gift Boxes",
  description: "",
  image: "",
  isActive: false,
  showInFooter: false,
  ...overrides,
});

/** surfacesOf(): the collection's slug + its linked category slugs. */
function stubSurfaces(slug = "gift-boxes", categorySlugs: string[] = ["oriental-sweets"]) {
  mockPrisma.collection.findMany.mockResolvedValue([
    { slug, categories: categorySlugs.map((s) => ({ category: { slug: s } })) },
  ] as never);
}

beforeEach(() => {
  mockReset(mockPrisma);
  mockedRequireAdmin.mockReset();
  mockedRevalidate.mockClear();
  mockedUpdateTag.mockClear();
  mockedRequireAdmin.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } } as never);
  mockPrisma.$transaction.mockImplementation(((arg: unknown) =>
    typeof arg === "function"
      ? (arg as (tx: typeof mockPrisma) => unknown)(mockPrisma)
      : Promise.all(arg as Promise<unknown>[])) as never);
  mockPrisma.collection.findUnique.mockResolvedValue(null as never);
  mockPrisma.collection.aggregate.mockResolvedValue({ _max: { order: 4 } } as never);
  mockPrisma.collection.create.mockImplementation((async (args: { data: { slug: string } }) => ({
    id: "col_new",
    slug: args.data.slug,
  })) as never);
  stubSurfaces();
});

afterAll(() => vi.restoreAllMocks());

describe("ADMIN gate", () => {
  it("refuses every mutation with the envelope and writes nothing", async () => {
    mockedRequireAdmin.mockRejectedValue(new Error("not admin"));
    const results = await Promise.all([
      createCollection(input()),
      deleteCollection("c1"),
      setCollectionProducts("c1", ["p1"]),
      setCollectionCategories("c1", ["k1"]),
      addCategoryProductsToCollection("c1", "k1"),
      setProductCollections("p1", ["c1"]),
    ]);
    for (const r of results) expect(r.success).toBe(false);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.collection.delete).not.toHaveBeenCalled();
  });
});

describe("createCollection — slugs minted once", () => {
  it("slugifies the name, appends at the end, starts as a draft", async () => {
    const res = await createCollection(input());
    expect(res).toEqual({ success: true, id: "col_new", slug: "gift-boxes" });
    expect(mockPrisma.collection.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ slug: "gift-boxes", order: 5, isActive: false }),
      select: { id: true, slug: true },
    });
  });

  it("suffixes a taken slug", async () => {
    mockPrisma.collection.findUnique
      .mockResolvedValueOnce({ id: "other" } as never)
      .mockResolvedValueOnce(null as never);
    const res = await createCollection(input());
    expect(res.success && res.slug).toBe("gift-boxes-2");
  });

  it("reserves 'page' (the index's pagination segment)", async () => {
    const res = await createCollection(input({ name: "Page" }));
    expect(res.success && res.slug).toBe("page-collection");
  });

  it("gives a non-Latin name a random fallback slug", async () => {
    const res = await createCollection(input({ name: "هدايا رمضان" }));
    expect(res.success && res.slug).toMatch(/^collection-[a-z0-9]{1,6}$/);
  });

  it("refuses a foreign-host image", async () => {
    const res = await createCollection(input({ image: "https://evil.example/x.jpg" }));
    expect(res.success).toBe(false);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("setCollectionProducts — the curated order", () => {
  it("replaces the set with order = index, in one short transaction", async () => {
    const res = await setCollectionProducts("c1", ["p3", "p1", "p2"]);
    expect(res).toEqual({ success: true });
    expect(mockPrisma.collectionProduct.deleteMany).toHaveBeenCalledWith({ where: { collectionId: "c1" } });
    expect(mockPrisma.collectionProduct.createMany).toHaveBeenCalledWith({
      data: [
        { collectionId: "c1", productId: "p3", order: 0 },
        { collectionId: "c1", productId: "p1", order: 1 },
        { collectionId: "c1", productId: "p2", order: 2 },
      ],
    });
  });

  it("refuses duplicates and more than the cap", async () => {
    expect((await setCollectionProducts("c1", ["p1", "p1"])).success).toBe(false);
    const tooMany = Array.from({ length: COLLECTION_MAX_PRODUCTS + 1 }, (_, i) => `p${i}`);
    expect((await setCollectionProducts("c1", tooMany)).success).toBe(false);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("reports a product deleted mid-edit (P2003)", async () => {
    mockPrisma.collectionProduct.createMany.mockRejectedValue(prismaError("P2003"));
    const res = await setCollectionProducts("c1", ["gone"]);
    expect(res.success).toBe(false);
  });

  it("busts the index, its page, its category pages, the footer and the admin list", async () => {
    await setCollectionProducts("c1", ["p1"]);
    expect(mockedRevalidate).toHaveBeenCalledWith("/collections");
    expect(mockedRevalidate).toHaveBeenCalledWith("/collections/gift-boxes");
    expect(mockedRevalidate).toHaveBeenCalledWith("/category/oriental-sweets");
    expect(mockedRevalidate).toHaveBeenCalledWith("/admin/collections");
    expect(mockedUpdateTag).toHaveBeenCalledWith("footer-collections");
  });
});

describe("setCollectionCategories", () => {
  it("busts the category pages it left AND the ones it joined", async () => {
    mockPrisma.collection.findMany
      .mockResolvedValueOnce([{ slug: "gift-boxes", categories: [{ category: { slug: "cakes" } }] }] as never)
      .mockResolvedValueOnce([{ slug: "gift-boxes", categories: [{ category: { slug: "sweets" } }] }] as never);
    await setCollectionCategories("c1", ["k-sweets"]);
    expect(mockedRevalidate).toHaveBeenCalledWith("/category/cakes");
    expect(mockedRevalidate).toHaveBeenCalledWith("/category/sweets");
  });
});

describe("addCategoryProductsToCollection — bulk add", () => {
  it("appends the category's missing products after the last position, skipping duplicates", async () => {
    mockPrisma.collectionProduct.aggregate.mockResolvedValue({ _count: 3, _max: { order: 7 } } as never);
    mockPrisma.product.findMany.mockResolvedValue([{ id: "p9" }, { id: "p8" }] as never);
    mockPrisma.collectionProduct.createMany.mockResolvedValue({ count: 2 } as never);

    const res = await addCategoryProductsToCollection("c1", "k1");

    expect(res).toEqual({ success: true, added: 2 });
    expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { categoryId: "k1", collections: { none: { collectionId: "c1" } } } }),
    );
    expect(mockPrisma.collectionProduct.createMany).toHaveBeenCalledWith({
      data: [
        { collectionId: "c1", productId: "p9", order: 8 },
        { collectionId: "c1", productId: "p8", order: 9 },
      ],
      skipDuplicates: true,
    });
  });

  it("refuses to overflow the cap and writes nothing", async () => {
    mockPrisma.collectionProduct.aggregate.mockResolvedValue({
      _count: COLLECTION_MAX_PRODUCTS - 1,
      _max: { order: 300 },
    } as never);
    mockPrisma.product.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }] as never);
    const res = await addCategoryProductsToCollection("c1", "k1");
    expect(res.success).toBe(false);
    expect(mockPrisma.collectionProduct.createMany).not.toHaveBeenCalled();
  });
});

describe("setProductCollections — the product form", () => {
  it("removes dropped memberships and appends new ones at the END of each collection", async () => {
    mockPrisma.collectionProduct.findMany.mockResolvedValue([
      { collectionId: "keep" },
      { collectionId: "drop" },
    ] as never);
    groupBy.mockResolvedValue([
      { collectionId: "new-a", _count: { _all: 5 }, _max: { order: 12 } },
    ]);

    const res = await setProductCollections("p1", ["keep", "new-a", "new-b"]);

    expect(res).toEqual({ success: true });
    expect(mockPrisma.collectionProduct.deleteMany).toHaveBeenCalledWith({
      where: { productId: "p1", collectionId: { in: ["drop"] } },
    });
    expect(mockPrisma.collectionProduct.createMany).toHaveBeenCalledWith({
      data: [
        { collectionId: "new-a", productId: "p1", order: 13 },
        { collectionId: "new-b", productId: "p1", order: 0 },
      ],
      skipDuplicates: true,
    });
  });

  it("refuses to join a full collection", async () => {
    mockPrisma.collectionProduct.findMany.mockResolvedValue([] as never);
    groupBy.mockResolvedValue([
      { collectionId: "full", _count: { _all: COLLECTION_MAX_PRODUCTS }, _max: { order: 199 } },
    ]);
    const res = await setProductCollections("p1", ["full"]);
    expect(res.success).toBe(false);
    expect(mockPrisma.collectionProduct.createMany).not.toHaveBeenCalled();
  });
});

describe("deleteCollection", () => {
  it("deletes only the collection (links cascade) and busts the pages that showed it", async () => {
    mockPrisma.collection.findUnique.mockResolvedValue({ image: null } as never);
    const res = await deleteCollection("c1");
    expect(res).toEqual({ success: true });
    expect(mockPrisma.collection.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
    expect(mockPrisma.product.delete).not.toHaveBeenCalled();
    expect(mockedRevalidate).toHaveBeenCalledWith("/collections/gift-boxes");
    expect(mockedRevalidate).toHaveBeenCalledWith("/category/oriental-sweets");
  });

  it("reports a collection that no longer exists", async () => {
    mockPrisma.collection.findMany.mockResolvedValue([] as never);
    expect(await deleteCollection("gone")).toEqual({ success: false, error: "That collection no longer exists." });
  });
});
