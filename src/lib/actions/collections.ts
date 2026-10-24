"use server";

// ─────────────────────────────────────────────────────────────────────────────
// Collections — admin-curated, ordered product sets (Collection model).
//
// A collection has its own page (/collections/[slug]), may be shown as a card on
// any number of category pages, and can list in the footer. This module is the
// ADMIN side: the two admin reads plus every mutation. Every mutation gates on
// `ensureAdmin()`, re-parses a shared schema from `@/lib/validators`, keeps its
// transaction bounded (no per-row statements beyond the COLLECTION_MAX_PRODUCTS
// cap), and fans out to every surface the collection appears on.
//
// Link writes (products, categories) replace the whole set in one short
// transaction — the admin UI always sends the full, ordered list — so the
// stored `order` can never be left with gaps or duplicates.
//
// NOTE: "use server" — async exports + inline type declarations only.
// ─────────────────────────────────────────────────────────────────────────────

import { revalidatePath, updateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
// requireAdmin stays for the throwing admin-only reads; mutations use the
// consolidated envelope gate.
import { requireAdmin } from "@/lib/session";
import { ensureAdmin, prismaErrorCode, slugify } from "@/lib/action-utils";
import { deleteUploadedFiles } from "@/lib/uploadthing-server";
import {
  COLLECTION_MAX_PRODUCTS,
  collectionCategoryIdsSchema,
  collectionProductIdsSchema,
  collectionReorderSchema,
  collectionSchema,
  productCollectionIdsSchema,
} from "@/lib/validators";

export type CollectionRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image: string | null;
  order: number;
  isActive: boolean;
  showInFooter: boolean;
  productCount: number;
  categoryCount: number;
};

export type CollectionDetail = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image: string | null;
  isActive: boolean;
  showInFooter: boolean;
  categoryIds: string[];
  /** In curated order. `isListable: false` = hidden on the storefront. */
  products: {
    id: string;
    name: string;
    image: string | null;
    categoryName: string;
    isListable: boolean;
  }[];
};

export type CollectionActionResult =
  | { success: true }
  | { success: false; error: string };

export type CreateCollectionResult =
  | { success: true; id: string; slug: string }
  | { success: false; error: string };

export type AddCategoryProductsResult =
  | { success: true; added: number }
  | { success: false; error: string };

/** The transactional client type, derived straight from `prisma.$transaction`. */
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// ── Helpers ──────────────────────────────────────────────────────────────────

const COLLECTION_GONE = "That collection no longer exists.";
const LINK_GONE = "One of those items no longer exists. Refresh and try again.";

/**
 * The base slug for a name — non-Latin names get a short random fallback.
 * "page" is reserved: /collections/page/[n] is the index's pagination, so a
 * collection slugged "page" could never show its own page 2+.
 */
function collectionSlugBase(name: string): string {
  const base = slugify(name);
  if (base === "page") return "page-collection";
  return base || `collection-${Math.random().toString(36).slice(2, 8)}`;
}

/** Appends `-2`, `-3`, … to `base` until the slug is free. Minted once, never regenerated. */
async function ensureUniqueSlug(tx: Tx, base: string): Promise<string> {
  let candidate = base;
  let suffix = 2;
  while (true) {
    const existing = await tx.collection.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
    candidate = `${base}-${suffix++}`;
  }
}

/** Slug + linked category slugs of the given collections (for the fan-out). */
async function surfacesOf(collectionIds: string[]) {
  if (collectionIds.length === 0) return { slugs: [] as string[], categorySlugs: [] as string[] };
  const rows = await prisma.collection.findMany({
    where: { id: { in: collectionIds } },
    select: { slug: true, categories: { select: { category: { select: { slug: true } } } } },
  });
  return {
    slugs: rows.map((r) => r.slug),
    categorySlugs: rows.flatMap((r) => r.categories.map((c) => c.category.slug)),
  };
}

/**
 * Every surface a collection appears on: the index, its own page, the cards on
 * each linked category page, the footer column, and the admin list. Pass the
 * slugs read BEFORE a write as `before`, so a removed link or a deleted
 * collection still busts the page that showed it. Page 2+ of a paginated
 * listing ages out on its own 60s window (the accepted bound).
 */
function revalidateCollectionSurfaces(
  ...sets: { slugs: string[]; categorySlugs: string[] }[]
) {
  revalidatePath("/collections");
  revalidatePath("/admin/collections");
  updateTag("footer-collections");
  for (const slug of new Set(sets.flatMap((s) => s.slugs))) {
    revalidatePath(`/collections/${slug}`);
  }
  for (const slug of new Set(sets.flatMap((s) => s.categorySlugs))) {
    revalidatePath(`/category/${slug}`);
  }
}

function firstIssue(error: { issues: { message: string }[] }, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}

// ── Admin reads ──────────────────────────────────────────────────────────────

/** Every collection (any state), in display order. ADMIN-only. */
export async function getAdminCollections(): Promise<CollectionRow[]> {
  await requireAdmin();
  const rows = await prisma.collection.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      image: true,
      order: true,
      isActive: true,
      showInFooter: true,
      _count: { select: { products: true, categories: true } },
    },
  });
  return rows.map(({ _count, ...row }) => ({
    ...row,
    productCount: _count.products,
    categoryCount: _count.categories,
  }));
}

/** One collection with its links, for the edit page. ADMIN-only. */
export async function getAdminCollection(id: string): Promise<CollectionDetail | null> {
  await requireAdmin();
  const row = await prisma.collection.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      image: true,
      isActive: true,
      showInFooter: true,
      categories: { select: { categoryId: true } },
      products: {
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select: {
          product: {
            select: {
              id: true,
              name: true,
              images: true,
              isAvailable: true,
              category: { select: { name: true } },
              variants: { where: { isAvailable: true }, select: { id: true }, take: 1 },
            },
          },
        },
      },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    image: row.image,
    isActive: row.isActive,
    showInFooter: row.showInFooter,
    categoryIds: row.categories.map((c) => c.categoryId),
    products: row.products.map(({ product }) => ({
      id: product.id,
      name: product.name,
      image: product.images[0] ?? null,
      categoryName: product.category.name,
      isListable: product.isAvailable && product.variants.length > 0,
    })),
  };
}

// ── Create / update / delete ─────────────────────────────────────────────────

export async function createCollection(input: unknown): Promise<CreateCollectionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };

  const parsed = collectionSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error, "Invalid collection.") };

  try {
    const created = await prisma.$transaction(async (tx) => {
      const slug = await ensureUniqueSlug(tx, collectionSlugBase(parsed.data.name));
      // Append to the end of the list (max existing order + 1).
      const last = await tx.collection.aggregate({ _max: { order: true } });
      return tx.collection.create({
        data: { ...parsed.data, slug, order: (last._max.order ?? 0) + 1 },
        select: { id: true, slug: true },
      });
    });

    revalidateCollectionSurfaces({ slugs: [created.slug], categorySlugs: [] });
    return { success: true, id: created.id, slug: created.slug };
  } catch (err) {
    // P2002 = a concurrent create minted the same slug between check and insert.
    if (prismaErrorCode(err) === "P2002") {
      return { success: false, error: "A collection with that name was just created. Try again." };
    }
    console.error("createCollection failed:", err);
    return { success: false, error: "Could not create the collection. Please try again." };
  }
}

/** Update a collection's own fields. The slug never changes. */
export async function updateCollection(id: string, input: unknown): Promise<CollectionActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };
  if (!id) return { success: false, error: "Missing collection id." };

  const parsed = collectionSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error, "Invalid collection.") };

  try {
    const before = await prisma.collection.findUnique({ where: { id }, select: { image: true } });
    if (!before) return { success: false, error: COLLECTION_GONE };

    await prisma.collection.update({ where: { id }, data: parsed.data, select: { id: true } });

    // Best-effort bucket hygiene for a replaced/cleared image (post-commit).
    if (before.image && before.image !== parsed.data.image) {
      await deleteUploadedFiles([before.image]);
    }

    revalidateCollectionSurfaces(await surfacesOf([id]));
    return { success: true };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") return { success: false, error: COLLECTION_GONE };
    console.error("updateCollection failed:", err);
    return { success: false, error: "Could not update the collection. Please try again." };
  }
}

/** Delete a collection — its links go with it; products and categories never do. */
export async function deleteCollection(id: string): Promise<CollectionActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };
  if (!id) return { success: false, error: "Missing collection id." };

  try {
    // Captured BEFORE the delete: the pages that showed it, and its image.
    const before = await surfacesOf([id]);
    if (before.slugs.length === 0) return { success: false, error: COLLECTION_GONE };
    const existing = await prisma.collection.findUnique({ where: { id }, select: { image: true } });

    await prisma.collection.delete({ where: { id } });

    if (existing?.image) await deleteUploadedFiles([existing.image]);

    revalidateCollectionSurfaces(before);
    return { success: true };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") return { success: false, error: COLLECTION_GONE };
    console.error("deleteCollection failed:", err);
    return { success: false, error: "Could not delete the collection. Please try again." };
  }
}

/** Persist a new global order (index, footer, category cards). One transaction. */
export async function reorderCollections(orderedIds: unknown): Promise<CollectionActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };

  const parsed = collectionReorderSchema.safeParse(orderedIds);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error, "Nothing to reorder.") };

  try {
    await prisma.$transaction(
      parsed.data.map((id, index) =>
        prisma.collection.update({ where: { id }, data: { order: index }, select: { id: true } }),
      ),
    );
    revalidateCollectionSurfaces(await surfacesOf(parsed.data));
    return { success: true };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") return { success: false, error: LINK_GONE };
    console.error("reorderCollections failed:", err);
    return { success: false, error: "Could not save the new order. Please try again." };
  }
}

// ── Links ────────────────────────────────────────────────────────────────────

/** Replace the categories a collection is shown under. 2 statements. */
export async function setCollectionCategories(
  id: string,
  categoryIds: unknown,
): Promise<CollectionActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };
  if (!id) return { success: false, error: "Missing collection id." };

  const parsed = collectionCategoryIdsSchema.safeParse(categoryIds);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error, "Invalid categories.") };

  try {
    const before = await surfacesOf([id]);
    if (before.slugs.length === 0) return { success: false, error: COLLECTION_GONE };

    await prisma.$transaction([
      prisma.collectionCategory.deleteMany({ where: { collectionId: id } }),
      prisma.collectionCategory.createMany({
        data: parsed.data.map((categoryId) => ({ collectionId: id, categoryId })),
      }),
    ]);

    // Both the categories it left and the ones it joined.
    revalidateCollectionSurfaces(before, await surfacesOf([id]));
    return { success: true };
  } catch (err) {
    const code = prismaErrorCode(err);
    if (code === "P2003" || code === "P2025") return { success: false, error: LINK_GONE };
    console.error("setCollectionCategories failed:", err);
    return { success: false, error: "Could not save the categories. Please try again." };
  }
}

/** Replace a collection's products IN ORDER (index = position). 2 statements. */
export async function setCollectionProducts(
  id: string,
  orderedProductIds: unknown,
): Promise<CollectionActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };
  if (!id) return { success: false, error: "Missing collection id." };

  const parsed = collectionProductIdsSchema.safeParse(orderedProductIds);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error, "Invalid products.") };

  try {
    const surfaces = await surfacesOf([id]);
    if (surfaces.slugs.length === 0) return { success: false, error: COLLECTION_GONE };

    await prisma.$transaction([
      prisma.collectionProduct.deleteMany({ where: { collectionId: id } }),
      prisma.collectionProduct.createMany({
        data: parsed.data.map((productId, order) => ({ collectionId: id, productId, order })),
      }),
    ]);

    revalidateCollectionSurfaces(surfaces);
    return { success: true };
  } catch (err) {
    const code = prismaErrorCode(err);
    if (code === "P2003" || code === "P2025") return { success: false, error: LINK_GONE };
    console.error("setCollectionProducts failed:", err);
    return { success: false, error: "Could not save the products. Please try again." };
  }
}

/**
 * Bulk-add every product of a category that isn't in the collection yet,
 * newest first, after the current last position. 3 statements, capped at
 * COLLECTION_MAX_PRODUCTS.
 */
export async function addCategoryProductsToCollection(
  id: string,
  categoryId: string,
): Promise<AddCategoryProductsResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };
  if (!id || !categoryId) return { success: false, error: "Pick a collection and a category." };

  try {
    const surfaces = await surfacesOf([id]);
    if (surfaces.slugs.length === 0) return { success: false, error: COLLECTION_GONE };

    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.collectionProduct.aggregate({
        where: { collectionId: id },
        _count: true,
        _max: { order: true },
      });
      const toAdd = await tx.product.findMany({
        where: { categoryId, collections: { none: { collectionId: id } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true },
      });
      if (current._count + toAdd.length > COLLECTION_MAX_PRODUCTS) {
        return { tooMany: true as const, room: COLLECTION_MAX_PRODUCTS - current._count };
      }
      const start = (current._max.order ?? -1) + 1;
      const created = await tx.collectionProduct.createMany({
        data: toAdd.map((p, i) => ({ collectionId: id, productId: p.id, order: start + i })),
        skipDuplicates: true, // a concurrent add of the same product is a no-op
      });
      return { tooMany: false as const, added: created.count };
    });

    if (result.tooMany) {
      return {
        success: false,
        error: `That would exceed ${COLLECTION_MAX_PRODUCTS} products — there's room for ${Math.max(0, result.room)} more.`,
      };
    }

    revalidateCollectionSurfaces(surfaces);
    return { success: true, added: result.added };
  } catch (err) {
    const code = prismaErrorCode(err);
    if (code === "P2003" || code === "P2025") return { success: false, error: LINK_GONE };
    console.error("addCategoryProductsToCollection failed:", err);
    return { success: false, error: "Could not add the products. Please try again." };
  }
}

/**
 * The product form's "Collections" multi-select: make `productId` a member of
 * exactly `collectionIds`. Memberships it keeps stay in place; new ones are
 * appended at the END of each collection's order. ≤ 4 statements.
 */
export async function setProductCollections(
  productId: string,
  collectionIds: unknown,
): Promise<CollectionActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };
  if (!productId) return { success: false, error: "Missing product id." };

  const parsed = productCollectionIdsSchema.safeParse(collectionIds);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error, "Invalid collections.") };
  const wanted = new Set(parsed.data);

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const current = await tx.collectionProduct.findMany({
        where: { productId },
        select: { collectionId: true },
      });
      const have = new Set(current.map((c) => c.collectionId));
      const toRemove = [...have].filter((c) => !wanted.has(c));
      const toAdd = [...wanted].filter((c) => !have.has(c));

      if (toRemove.length > 0) {
        await tx.collectionProduct.deleteMany({
          where: { productId, collectionId: { in: toRemove } },
        });
      }
      if (toAdd.length > 0) {
        // One grouped read: each target collection's size and last position.
        const stats = await tx.collectionProduct.groupBy({
          by: ["collectionId"],
          where: { collectionId: { in: toAdd } },
          _count: { _all: true },
          _max: { order: true },
        });
        const byId = new Map(stats.map((s) => [s.collectionId, s]));
        const full = toAdd.find((c) => (byId.get(c)?._count._all ?? 0) >= COLLECTION_MAX_PRODUCTS);
        if (full) return { full };
        await tx.collectionProduct.createMany({
          data: toAdd.map((collectionId) => ({
            collectionId,
            productId,
            order: (byId.get(collectionId)?._max.order ?? -1) + 1,
          })),
          skipDuplicates: true,
        });
      }
      return { changed: [...toRemove, ...toAdd] };
    });

    if ("full" in outcome) {
      return {
        success: false,
        error: `One of those collections already has ${COLLECTION_MAX_PRODUCTS} products.`,
      };
    }

    revalidateCollectionSurfaces(await surfacesOf(outcome.changed));
    revalidatePath(`/admin/products/${productId}/edit`);
    return { success: true };
  } catch (err) {
    const code = prismaErrorCode(err);
    if (code === "P2003" || code === "P2025") return { success: false, error: LINK_GONE };
    console.error("setProductCollections failed:", err);
    return { success: false, error: "Could not save the collections. Please try again." };
  }
}
