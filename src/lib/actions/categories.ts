"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { CategoryIdentifier } from "@/generated/prisma/enums";

const VALID_IDENTIFIERS = new Set<string>(Object.values(CategoryIdentifier));

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
 * (CategoryIdentifier).
 *
 * `Category.identifier` is `@unique`, so assigning a core position that another
 * category already holds would normally throw P2002. We avoid that entirely:
 * inside one transaction we first STRIP the identifier from its current holder,
 * then assign it here — the core position is simply *transferred*. The caller is
 * told which category lost it via `transferredFrom`.
 */
export async function updateCategory(
  input: UpdateCategoryInput,
): Promise<UpdateCategoryResult> {
  await requireAdmin();

  const name = input.name?.trim() ?? "";
  if (name.length < 2) {
    return { success: false, error: "Name must be at least 2 characters." };
  }

  const subtitle = input.subtitle?.trim() || null;
  const image = input.image?.trim() || null;

  let identifier: CategoryIdentifier | null = null;
  if (input.identifier) {
    if (!VALID_IDENTIFIERS.has(input.identifier)) {
      return { success: false, error: "Invalid core position." };
    }
    identifier = input.identifier as CategoryIdentifier;
  }

  try {
    const { slug, transferredFrom } = await prisma.$transaction(async (tx) => {
      let transferredFrom: string | undefined;

      if (identifier) {
        const holder = await tx.category.findUnique({
          where: { identifier },
          select: { id: true, name: true },
        });
        if (holder && holder.id !== input.id) {
          transferredFrom = holder.name;
          await tx.category.update({
            where: { id: holder.id },
            data: { identifier: null },
          });
        }
      }

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

    return transferredFrom ? { success: true, transferredFrom } : { success: true };
  } catch (err) {
    // P2002 = unique violation. Identifier is handled above, so this is `name`.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: unknown }).code === "P2002"
    ) {
      const target = (err as { meta?: { target?: unknown } }).meta?.target;
      const onName = Array.isArray(target) && target.some((t) => String(t).includes("name"));
      return {
        success: false,
        error: onName
          ? "A category with this name already exists."
          : "That value must be unique.",
      };
    }

    console.error("updateCategory failed:", err);
    return {
      success: false,
      error: "Could not update the category. Please try again.",
    };
  }
}
