"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { ensureAdmin, prismaErrorCode, slugify } from "@/lib/action-utils";

/** The transactional client type, derived straight from `prisma.$transaction`. */
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Menu-specific wrapper over the shared slugify: Arabic / non-latin titles
 *  slugify to "" — fall back to a stable random token so the storefront
 *  scroll-spy always has a valid DOM anchor. */
function menuSlug(value: string) {
  return slugify(value) || `menu-${Math.random().toString(36).slice(2, 8)}`;
}

/** Appends `-2`, `-3`, … to `base` until the slug is free (or already owned by `excludeId`). */
async function ensureUniqueSlug(tx: Tx, base: string, excludeId?: string) {
  let candidate = base;
  let suffix = 2;
  while (true) {
    const existing = await tx.menuCategory.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing || existing.id === excludeId) return candidate;
    candidate = `${base}-${suffix++}`;
  }
}

function revalidateMenu() {
  revalidatePath("/menu"); // public storefront menu
  revalidatePath("/admin/menu");
}

// ─────────────────────────────────────────────────────────────────────────────
// Category CRUD
// ─────────────────────────────────────────────────────────────────────────────

export type MenuCategoryInput = {
  title: string;
  /** A sort weight; omit/null to append to the end. */
  order?: number | null;
  isFixedPrice: boolean;
};

export type MenuActionResult<T = unknown> =
  | ({ success: true } & T)
  | { success: false; error: string };

export async function createMenuCategory(
  input: MenuCategoryInput,
): Promise<MenuActionResult<{ id: string }>> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };

  const title = input.title?.trim() ?? "";
  if (title.length < 2) {
    return { success: false, error: "Title must be at least 2 characters." };
  }

  try {
    const id = await prisma.$transaction(async (tx) => {
      const slug = await ensureUniqueSlug(tx, menuSlug(title));

      // Append to the end when no explicit order is given.
      let order = input.order;
      if (order == null || !Number.isFinite(order)) {
        const last = await tx.menuCategory.aggregate({ _max: { order: true } });
        order = (last._max.order ?? 0) + 1;
      }

      const created = await tx.menuCategory.create({
        data: { title, slug, order: Math.trunc(order), isFixedPrice: input.isFixedPrice },
        select: { id: true },
      });
      return created.id;
    });

    revalidateMenu();
    return { success: true, id };
  } catch (err) {
    if (prismaErrorCode(err) === "P2002") {
      return { success: false, error: "A category with this name already exists." };
    }
    console.error("createMenuCategory failed:", err);
    return { success: false, error: "Could not create the category. Please try again." };
  }
}

export async function updateMenuCategory(
  input: { id: string } & MenuCategoryInput,
): Promise<MenuActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };

  const title = input.title?.trim() ?? "";
  if (!input.id) return { success: false, error: "Missing category id." };
  if (title.length < 2) {
    return { success: false, error: "Title must be at least 2 characters." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const slug = await ensureUniqueSlug(tx, menuSlug(title), input.id);
      const order =
        input.order != null && Number.isFinite(input.order)
          ? Math.trunc(input.order)
          : undefined;

      await tx.menuCategory.update({
        where: { id: input.id },
        data: { title, slug, isFixedPrice: input.isFixedPrice, order },
      });
    });

    revalidateMenu();
    return { success: true };
  } catch (err) {
    const code = prismaErrorCode(err);
    if (code === "P2002") {
      return { success: false, error: "A category with this name already exists." };
    }
    if (code === "P2025") {
      return { success: false, error: "That category no longer exists." };
    }
    console.error("updateMenuCategory failed:", err);
    return { success: false, error: "Could not update the category. Please try again." };
  }
}

export async function deleteMenuCategory(id: string): Promise<MenuActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };
  if (!id) return { success: false, error: "Missing category id." };

  try {
    // MenuItem.category is `onDelete: Cascade`, so the items go with the category.
    await prisma.menuCategory.delete({ where: { id } });
    revalidateMenu();
    return { success: true };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return { success: false, error: "That category no longer exists." };
    }
    console.error("deleteMenuCategory failed:", err);
    return { success: false, error: "Could not delete the category. Please try again." };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Item CRUD
// ─────────────────────────────────────────────────────────────────────────────

export type MenuItemInput = {
  categoryId: string;
  name: string;
  price: number;
};

function validateItem(name: string, price: number): string | null {
  if (name.length < 1) return "Item name is required.";
  if (name.length > 120) return "Item name is too long.";
  if (!Number.isFinite(price)) return "Enter a valid price.";
  if (price < 0) return "Price cannot be negative.";
  if (price > 1_000_000) return "Price is too large.";
  return null;
}

export async function createMenuItem(
  input: MenuItemInput,
): Promise<MenuActionResult<{ id: string }>> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };

  const name = input.name?.trim() ?? "";
  const error = validateItem(name, input.price);
  if (error) return { success: false, error };
  if (!input.categoryId) return { success: false, error: "Missing category." };

  try {
    const id = await prisma.$transaction(async (tx) => {
      const last = await tx.menuItem.aggregate({
        where: { categoryId: input.categoryId },
        _max: { order: true },
      });
      const created = await tx.menuItem.create({
        data: {
          categoryId: input.categoryId,
          name,
          price: input.price,
          order: (last._max.order ?? 0) + 1,
        },
        select: { id: true },
      });
      return created.id;
    });

    revalidateMenu();
    return { success: true, id };
  } catch (err) {
    // Foreign-key violation → the category was deleted out from under us.
    if (prismaErrorCode(err) === "P2003") {
      return { success: false, error: "That category no longer exists." };
    }
    console.error("createMenuItem failed:", err);
    return { success: false, error: "Could not add the item. Please try again." };
  }
}

export async function updateMenuItem(
  input: { id: string; name: string; price: number },
): Promise<MenuActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };

  const name = input.name?.trim() ?? "";
  const error = validateItem(name, input.price);
  if (error) return { success: false, error };
  if (!input.id) return { success: false, error: "Missing item id." };

  try {
    await prisma.menuItem.update({
      where: { id: input.id },
      data: { name, price: input.price },
    });
    revalidateMenu();
    return { success: true };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return { success: false, error: "That item no longer exists." };
    }
    console.error("updateMenuItem failed:", err);
    return { success: false, error: "Could not update the item. Please try again." };
  }
}

export async function deleteMenuItem(id: string): Promise<MenuActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };
  if (!id) return { success: false, error: "Missing item id." };

  try {
    await prisma.menuItem.delete({ where: { id } });
    revalidateMenu();
    return { success: true };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return { success: false, error: "That item no longer exists." };
    }
    console.error("deleteMenuItem failed:", err);
    return { success: false, error: "Could not delete the item. Please try again." };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk price adjustment
// ─────────────────────────────────────────────────────────────────────────────

export type BulkAdjustResult =
  | { success: true; count: number }
  | { success: false; error: string };

/**
 * Increases or decreases every item's price within a category by `percentage`
 * (e.g. `15` → +15%, `-10` → −10%), in a single atomic SQL `UPDATE`.
 *
 * The arithmetic runs in the database (no read-modify-write race, scales to any
 * item count), but — unlike Prisma's atomic `{ multiply }` operator — the new
 * value is wrapped in `ROUND(…, 2)` so repeated adjustments can never accumulate
 * binary-float drift (e.g. 19.99 → ×1.1 → 21.989 → 21.99, not 21.98900000001).
 * `price` is a `Decimal` (Postgres `numeric`) column, but multiplying it by the
 * float parameter yields `double precision`, so the product is cast back to
 * `numeric` before rounding (there is no two-argument `round(double precision)`).
 * `updatedAt` is set explicitly because raw SQL bypasses Prisma's `@updatedAt`.
 * Because all items are scaled by the same factor, a fixed-price category stays
 * internally consistent (every item remains equal).
 */
export async function bulkAdjustCategoryPrices(
  categoryId: string,
  percentage: number,
): Promise<BulkAdjustResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };

  if (!categoryId) return { success: false, error: "Missing category." };
  if (!Number.isFinite(percentage)) {
    return { success: false, error: "Enter a valid percentage." };
  }
  if (percentage === 0) {
    return { success: false, error: "Enter a non-zero percentage." };
  }
  if (percentage <= -100) {
    return { success: false, error: "A reduction must be less than 100%." };
  }
  if (percentage > 1000) {
    return { success: false, error: "That increase is too large (max 1000%)." };
  }

  const factor = 1 + percentage / 100;

  try {
    // $executeRaw returns the number of rows affected — same shape as the old
    // updateMany().count. The tagged template parameterises both values.
    const count = await prisma.$executeRaw`
      UPDATE "MenuItem"
      SET "price" = ROUND(("price" * ${factor})::numeric, 2),
          "updatedAt" = NOW()
      WHERE "categoryId" = ${categoryId}
    `;

    revalidateMenu();
    return { success: true, count };
  } catch (err) {
    console.error("bulkAdjustCategoryPrices failed:", err);
    return { success: false, error: "Could not adjust prices. Please try again." };
  }
}
