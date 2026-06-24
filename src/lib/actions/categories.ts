"use server";

import { revalidatePath, updateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { CategoryIdentifier } from "@/generated/prisma/enums";

const VALID_IDENTIFIERS = new Set<string>(Object.values(CategoryIdentifier));

/** The transactional client type, derived straight from `prisma.$transaction`. */
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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

/**
 * Assigns `identifier` to `categoryId`, first stripping it from whoever else
 * holds it. `Category.identifier` is `@unique`, so without this the second
 * write would throw P2002 — instead the core position is *transferred*.
 * Returns the name of the category it was taken from, if any.
 */
async function transferIdentifier(
  tx: Tx,
  identifier: CategoryIdentifier | null,
  categoryId?: string,
): Promise<string | undefined> {
  if (!identifier) return undefined;
  const holder = await tx.category.findUnique({
    where: { identifier },
    select: { id: true, name: true },
  });
  if (!holder || holder.id === categoryId) return undefined;
  await tx.category.update({ where: { id: holder.id }, data: { identifier: null } });
  return holder.name;
}

/** Maps a Prisma unique-constraint violation to a user-facing message, or `null` if it's something else. */
function uniqueViolationMessage(err: unknown): string | null {
  if (
    typeof err !== "object" ||
    err === null ||
    !("code" in err) ||
    (err as { code?: unknown }).code !== "P2002"
  ) {
    return null;
  }
  const target = (err as { meta?: { target?: unknown } }).meta?.target;
  const on = (field: string) => Array.isArray(target) && target.some((t) => String(t).includes(field));
  if (on("name")) return "A category with this name already exists.";
  if (on("slug")) return "That slug is already in use.";
  return "That value must be unique.";
}

function parseIdentifier(value: string | null): { identifier: CategoryIdentifier | null } | { error: string } {
  if (!value) return { identifier: null };
  if (!VALID_IDENTIFIERS.has(value)) return { error: "Invalid core position." };
  return { identifier: value as CategoryIdentifier };
}

// ─────────────────────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────────────────────

export type CreateCategoryInput = {
  name: string;
  subtitle: string | null;
  /** A CategoryIdentifier value, or null for a standard (non-core) category. */
  identifier: string | null;
  image: string | null;
};

export type CreateCategoryResult =
  | { success: true; id: string; transferredFrom?: string }
  | { success: false; error: string };

export async function createCategory(
  input: CreateCategoryInput,
): Promise<CreateCategoryResult> {
  await requireAdmin();

  const name = input.name?.trim() ?? "";
  if (name.length < 2) {
    return { success: false, error: "Name must be at least 2 characters." };
  }

  const parsedIdentifier = parseIdentifier(input.identifier);
  if ("error" in parsedIdentifier) {
    return { success: false, error: parsedIdentifier.error };
  }
  const { identifier } = parsedIdentifier;

  const baseSlug = slugify(name);
  if (!baseSlug) {
    return { success: false, error: "Name must contain at least one letter or number." };
  }

  const subtitle = input.subtitle?.trim() || null;
  const image = input.image?.trim() || null;

  try {
    const { id, transferredFrom } = await prisma.$transaction(async (tx) => {
      const transferredFrom = await transferIdentifier(tx, identifier);
      const slug = await ensureUniqueSlug(tx, baseSlug);

      const created = await tx.category.create({
        data: { name, slug, subtitle, image, identifier },
        select: { id: true },
      });

      return { id: created.id, transferredFrom };
    });

    revalidatePath("/"); // homepage CategorySlider
    revalidatePath("/admin/categories");
    updateTag("categories"); // purge the tagged Footer cache (read-your-own-writes)

    return transferredFrom ? { success: true, id, transferredFrom } : { success: true, id };
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
  /** A CategoryIdentifier value, or null for a standard (non-core) category. */
  identifier: string | null;
  image: string | null;
};

export type UpdateCategoryResult =
  | { success: true; transferredFrom?: string }
  | { success: false; error: string };

/**
 * Updates a category's name, subtitle, cover image and "core position"
 * (CategoryIdentifier). See `transferIdentifier` for how the unique-identifier
 * conflict is resolved without ever throwing P2002.
 */
export async function updateCategory(
  input: UpdateCategoryInput,
): Promise<UpdateCategoryResult> {
  await requireAdmin();

  const name = input.name?.trim() ?? "";
  if (name.length < 2) {
    return { success: false, error: "Name must be at least 2 characters." };
  }

  const parsedIdentifier = parseIdentifier(input.identifier);
  if ("error" in parsedIdentifier) {
    return { success: false, error: parsedIdentifier.error };
  }
  const { identifier } = parsedIdentifier;

  const subtitle = input.subtitle?.trim() || null;
  const image = input.image?.trim() || null;

  try {
    const { slug, transferredFrom } = await prisma.$transaction(async (tx) => {
      const transferredFrom = await transferIdentifier(tx, identifier, input.id);

      const updated = await tx.category.update({
        where: { id: input.id },
        data: { name, subtitle, image, identifier },
        select: { slug: true },
      });

      return { slug: updated.slug, transferredFrom };
    });

    revalidatePath("/"); // homepage CategorySlider
    revalidatePath("/admin/categories");
    revalidatePath(`/category/${slug}`);
    updateTag("categories"); // purge the tagged Footer cache (read-your-own-writes)

    return transferredFrom ? { success: true, transferredFrom } : { success: true };
  } catch (err) {
    const message = uniqueViolationMessage(err);
    if (message) return { success: false, error: message };

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
  await requireAdmin();

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
    await prisma.category.delete({ where: { id } });

    revalidatePath("/"); // homepage CategorySlider
    revalidatePath("/admin/categories");
    updateTag("categories"); // purge the tagged Footer cache (read-your-own-writes)

    return { success: true };
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err) {
      const code = (err as { code?: unknown }).code;
      if (code === "P2025") return { success: false, error: "That category no longer exists." };
      if (code === "P2003") {
        return {
          success: false,
          error: "Cannot delete — products were just added to this category. Reassign them first.",
        };
      }
    }

    console.error("deleteCategory failed:", err);
    return { success: false, error: "Could not delete the category. Please try again." };
  }
}
