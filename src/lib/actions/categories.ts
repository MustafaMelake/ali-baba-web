"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { ensureAdmin, prismaErrorCode, slugify } from "@/lib/action-utils";
import { deleteUploadedFiles } from "@/lib/uploadthing-server";

/** The transactional client type, derived straight from `prisma.$transaction`. */
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Appends `-2`, `-3`, … to `base` until the slug is free (or already owned by `excludeId`). */
async function ensureUniqueSlug(tx: Tx, base: string, excludeId?: string) {
  let candidate = base;
  let suffix = 2;
  while (true) {
    const existing = await tx.category.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing || existing.id === excludeId) return candidate;
    candidate = `${base}-${suffix++}`;
  }
}

/** Coerce a (possibly NaN / float / undefined) slider order into a safe non-negative integer. */
function sanitizeSliderOrder(value: number | null | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

/** Maps a Prisma unique-constraint violation to a user-facing message, or `null` if it's something else. */
function uniqueViolationMessage(err: unknown): string | null {
  if (prismaErrorCode(err) !== "P2002") return null;
  const target = (err as { meta?: { target?: unknown } }).meta?.target;
  const on = (field: string) => Array.isArray(target) && target.some((t) => String(t).includes(field));
  if (on("name")) return "A category with this name already exists.";
  if (on("slug")) return "That slug is already in use.";
  return "That value must be unique.";
}

// ─────────────────────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────────────────────

export type CreateCategoryInput = {
  name: string;
  subtitle: string | null;
  /** Surface this category in the homepage CategorySlider. */
  isFeatured: boolean;
  /** Ascending position within the slider (only meaningful when featured). */
  sliderOrder: number;
  image: string | null;
};

export type CreateCategoryResult =
  | { success: true; id: string }
  | { success: false; error: string };

export async function createCategory(
  input: CreateCategoryInput,
): Promise<CreateCategoryResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };

  const name = input.name?.trim() ?? "";
  if (name.length < 2) {
    return { success: false, error: "Name must be at least 2 characters." };
  }

  const baseSlug = slugify(name);
  if (!baseSlug) {
    return { success: false, error: "Name must contain at least one letter or number." };
  }

  const subtitle = input.subtitle?.trim() || null;
  const image = input.image?.trim() || null;
  const isFeatured = Boolean(input.isFeatured);
  const sliderOrder = sanitizeSliderOrder(input.sliderOrder);

  try {
    const id = await prisma.$transaction(async (tx) => {
      const slug = await ensureUniqueSlug(tx, baseSlug);

      const created = await tx.category.create({
        data: { name, slug, subtitle, image, isFeatured, sliderOrder },
        select: { id: true },
      });

      return created.id;
    });

    revalidatePath("/"); // homepage CategorySlider
    revalidatePath("/admin/categories");

    return { success: true, id };
  } catch (err) {
    const message = uniqueViolationMessage(err);
    if (message) return { success: false, error: message };

    console.error("createCategory failed:", err);
    return { success: false, error: "Could not create the category. Please try again." };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Update
// ─────────────────────────────────────────────────────────────────────────────

export type UpdateCategoryInput = {
  id: string;
  name: string;
  subtitle: string | null;
  /** Surface this category in the homepage CategorySlider. */
  isFeatured: boolean;
  /** Ascending position within the slider (only meaningful when featured). */
  sliderOrder: number;
  image: string | null;
};

export type UpdateCategoryResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Updates a category's name, subtitle, cover image and slider placement
 * (`isFeatured` + `sliderOrder`). Multiple categories may be featured at once,
 * so there is no longer any single-slot transfer logic to perform.
 */
export async function updateCategory(
  input: UpdateCategoryInput,
): Promise<UpdateCategoryResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };

  const name = input.name?.trim() ?? "";
  if (name.length < 2) {
    return { success: false, error: "Name must be at least 2 characters." };
  }

  const subtitle = input.subtitle?.trim() || null;
  const image = input.image?.trim() || null;
  const isFeatured = Boolean(input.isFeatured);
  const sliderOrder = sanitizeSliderOrder(input.sliderOrder);

  try {
    // Old image captured BEFORE the write, so a replaced/cleared file can be
    // purged from the bucket once the update commits.
    const before = await prisma.category.findUnique({
      where: { id: input.id },
      select: { image: true },
    });

    const { slug } = await prisma.category.update({
      where: { id: input.id },
      data: { name, subtitle, image, isFeatured, sliderOrder },
      select: { slug: true },
    });

    // Best-effort bucket hygiene (post-commit, never fails the action): the
    // previous image is unreferenced once it was replaced or cleared.
    if (before?.image && before.image !== image) {
      await deleteUploadedFiles([before.image]);
    }

    revalidatePath("/"); // homepage CategorySlider
    revalidatePath("/admin/categories");
    revalidatePath(`/category/${slug}`);

    return { success: true };
  } catch (err) {
    const message = uniqueViolationMessage(err);
    if (message) return { success: false, error: message };

    if (prismaErrorCode(err) === "P2025") {
      return { success: false, error: "That category no longer exists." };
    }

    console.error("updateCategory failed:", err);
    return { success: false, error: "Could not update the category. Please try again." };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete
// ─────────────────────────────────────────────────────────────────────────────

export type DeleteCategoryResult = { success: true } | { success: false; error: string };

/**
 * Deletes a category. `Product.category` is declared `onDelete: Restrict`
 * (prisma/schema.prisma) — the DB will never silently cascade-delete or null
 * out a product's category, so we pre-check usage and return a clean
 * validation error instead of ever surfacing a raw foreign-key crash. The
 * P2003 catch is a safety net for the (rare) race where a product is attached
 * between the check and the delete.
 */
export async function deleteCategory(id: string): Promise<DeleteCategoryResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };

  if (!id) {
    return { success: false, error: "Missing category id." };
  }

  const productCount = await prisma.product.count({ where: { categoryId: id } });
  if (productCount > 0) {
    return {
      success: false,
      error: `Cannot delete — ${productCount} product${productCount === 1 ? "" : "s"} still use this category. Reassign them first.`,
    };
  }

  try {
    // Image captured BEFORE the delete — nothing references it afterwards.
    // Purged only after the delete succeeds (a Restrict-blocked category
    // keeps its row, so it must keep its media too).
    const existing = await prisma.category.findUnique({
      where: { id },
      select: { image: true },
    });

    await prisma.category.delete({ where: { id } });

    // Best-effort bucket hygiene (post-commit, never fails the action).
    if (existing?.image) await deleteUploadedFiles([existing.image]);

    revalidatePath("/"); // homepage CategorySlider
    revalidatePath("/admin/categories");

    return { success: true };
  } catch (err) {
    const code = prismaErrorCode(err);
    if (code === "P2025") return { success: false, error: "That category no longer exists." };
    if (code === "P2003") {
      return {
        success: false,
        error: "Cannot delete — products were just added to this category. Reassign them first.",
      };
    }

    console.error("deleteCategory failed:", err);
    return { success: false, error: "Could not delete the category. Please try again." };
  }
}
