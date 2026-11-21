"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { ensureAdmin, prismaErrorCode } from "@/lib/action-utils";
import { deleteUploadedFiles } from "@/lib/r2";
import { DiscountType } from "@/generated/prisma/enums";
import { findFreeingPromotion, roundMoney } from "@/lib/discounts";
import {
  productInputSchema,
  productUpdateSchema,
  type ProductInput,
  type ProductUpdateInput,
} from "@/lib/validators";

export type CreateProductResult =
  | { success: true; productId: string }
  | { success: false; error: string };

export type UpdateProductResult =
  | { success: true; archivedCount: number }
  | { success: false; error: string };

/**
 * NO PROMOTION MAY MAKE A PRODUCT FREE — the product side of the guard in
 * promotions.ts and collections.ts. A promotion is checked when it is saved,
 * but a product write can bring a price under an existing fixed-amount
 * discount: a cheaper new size, a lowered price, or a move into a promoted
 * category. This refuses that write when any live OR scheduled FIXED_AMOUNT
 * promotion reaching one of the product's orderable variants — through the
 * variant itself, the product, its (new) category, or a collection it's in —
 * would take that line to 0 EGP. The comparison is the engine's own
 * (`findFreeingPromotion` → `fixedAmountMakesFree`, on the 2-dp grid).
 *
 * Read before the write's transaction opens, so the transaction stays short; a
 * promotion saved in the same instant is still caught by `placeOrder`, which
 * refuses any 0 EGP line.
 */
async function freePriceProblem(product: {
  /** null for a product being created — only its category can reach it yet. */
  id: string | null;
  name: string;
  categoryId: string;
  /** The orderable variants AFTER the write; `id` only for one that already exists. */
  variants: { id?: string; name: string; price: number }[];
}): Promise<string | null> {
  if (product.variants.length === 0) return null;
  const productIds = product.id ? [product.id] : [];

  const promotions = await prisma.promotion.findMany({
    where: {
      type: DiscountType.FIXED_AMOUNT,
      isActive: true,
      // Live or scheduled: a scheduled one goes live with no admin action.
      endDate: { gte: new Date() },
      OR: [
        { categories: { some: { id: product.categoryId } } },
        { products: { some: { id: { in: productIds } } } },
        { collections: { some: { products: { some: { productId: { in: productIds } } } } } },
        { variants: { some: { productId: { in: productIds } } } },
      ],
    },
    // Which level matched: a category, product or collection hit prices every
    // variant; a variant hit prices only the variants it names.
    select: {
      name: true,
      value: true,
      categories: { where: { id: product.categoryId }, select: { id: true } },
      products: { where: { id: { in: productIds } }, select: { id: true } },
      collections: {
        where: { products: { some: { productId: { in: productIds } } } },
        select: { id: true },
      },
      variants: { where: { productId: { in: productIds } }, select: { id: true } },
    },
  });
  if (promotions.length === 0) return null;

  const hit = findFreeingPromotion(
    product.variants.map((variant) => ({
      variant,
      promotions: promotions.filter(
        (p) =>
          p.categories.length + p.products.length + p.collections.length > 0 ||
          (!!variant.id && p.variants.some((v) => v.id === variant.id)),
      ),
    })),
  );
  if (!hit) return null;

  const value = roundMoney(hit.promotion.value);
  const price = roundMoney(hit.variant.price);
  return `"${hit.promotion.name}" takes ${value} EGP off — it would make "${product.name} — ${hit.variant.name}" (${price} EGP) free. Set a price above ${value} EGP or lower that promotion first.`;
}

/**
 * Updates a product's core fields and reconciles its variant list.
 *
 * Variant strategy (the delicate part): incoming variants WITH an id that the
 * product already owns are updated; those WITHOUT an id are created. Variants
 * that the product owns but are absent from the payload were "removed" by the
 * admin — we attempt to hard-delete them, but `OrderItem.variant` is
 * `onDelete: Restrict`, so a variant that's part of an existing order can't be
 * deleted. In that case we ARCHIVE it instead (hide via isAvailable:false and
 * free its SKU) so order history stays intact, and report the count back.
 *
 * The removed-variant cleanup runs AFTER the core-update transaction commits, so
 * a P2003 there can never roll back an otherwise-valid product update.
 */
export async function updateProduct(
  id: string,
  input: ProductUpdateInput,
): Promise<UpdateProductResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };
  if (!id) return { success: false, error: "Missing product id." };

  const parsed = productUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid product data.",
    };
  }
  const data = parsed.data;

  const existing = await prisma.product.findUnique({
    where: { id },
    // `images` captured too: after the update commits, files the admin removed
    // are unreferenced and get purged from the R2 bucket below.
    select: {
      id: true,
      slug: true,
      images: true,
      variants: { select: { id: true, isAvailable: true } },
    },
  });
  if (!existing) {
    return { success: false, error: "That product no longer exists." };
  }

  const existingIds = new Set(existing.variants.map((v) => v.id));
  // Only treat an incoming id as "existing" if it really belongs to this product.
  const keptIds = new Set(
    data.variants
      .map((v) => v.id)
      .filter((vid): vid is string => !!vid && existingIds.has(vid)),
  );
  const removedIds = [...existingIds].filter((vid) => !keptIds.has(vid));

  // Pre-check slug uniqueness (excluding this product) for a clean message
  // instead of a raw P2002 mid-transaction.
  const slugOwner = await prisma.product.findUnique({
    where: { slug: data.slug },
    select: { id: true },
  });
  if (slugOwner && slugOwner.id !== id) {
    return { success: false, error: "A product with this slug already exists." };
  }

  try {
    // No promotion may make a product free — refused before anything is
    // written. A product switched off isn't sold, so it's checked when it's
    // switched back on; an archived (unorderable) variant is never priced.
    if (data.isAvailable) {
      const archived = new Set(existing.variants.filter((v) => !v.isAvailable).map((v) => v.id));
      const tooCheap = await freePriceProblem({
        id,
        name: data.name,
        categoryId: data.categoryId,
        variants: data.variants
          .map((v) => ({
            id: v.id && keptIds.has(v.id) ? v.id : undefined,
            name: v.name,
            price: v.price,
          }))
          .filter((v) => !(v.id && archived.has(v.id))),
      });
      if (tooCheap) return { success: false, error: tooCheap };
    }

    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          name: data.name,
          slug: data.slug,
          description: data.description?.trim() || null,
          images: data.images,
          categoryId: data.categoryId,
          isAvailable: data.isAvailable,
          isFeatured: data.isFeatured,
        },
      });

      // Upsert kept variants (update) and create new ones. Storefront ordering
      // is dynamic (price asc), so no manual ordering is persisted.
      for (const v of data.variants) {
        const sku = v.sku?.trim() || null;
        // Coalesce undefined/empty to an explicit null so ending a promotion
        // (clearing the field) actually wipes a legacy discount in the DB.
        const compareAtPrice = v.compareAtPrice ?? null;
        if (v.id && keptIds.has(v.id)) {
          await tx.productVariant.update({
            where: { id: v.id },
            data: { name: v.name, price: v.price, compareAtPrice, sku },
          });
        } else {
          await tx.productVariant.create({
            data: { productId: id, name: v.name, price: v.price, compareAtPrice, sku },
          });
        }
      }
    });
  } catch (err) {
    if (prismaErrorCode(err) === "P2002") {
      const target = (err as { meta?: { target?: unknown } }).meta?.target;
      const onSku = Array.isArray(target) && target.some((t) => String(t).includes("sku"));
      return {
        success: false,
        error: onSku
          ? "That SKU is already in use."
          : "A product with this slug already exists.",
      };
    }
    console.error("updateProduct failed:", err);
    return { success: false, error: "Could not update the product. Please try again." };
  }

  // Best-effort cleanup of removed variants (post-commit, never rolls back).
  let archivedCount = 0;
  for (const vid of removedIds) {
    try {
      await prisma.productVariant.delete({ where: { id: vid } });
    } catch (err) {
      if (prismaErrorCode(err) === "P2003") {
        // Tied to an order — archive instead of deleting.
        try {
          await prisma.productVariant.update({
            where: { id: vid },
            data: { isAvailable: false, sku: null },
          });
          archivedCount++;
        } catch (archiveErr) {
          console.error("updateProduct: archive variant failed:", archiveErr);
        }
      } else {
        console.error("updateProduct: delete variant failed:", err);
      }
    }
  }

  // Best-effort bucket hygiene (post-commit, mirrors the variant cleanup):
  // images the admin removed from the product are unreferenced now — purge
  // them from R2 so replaced media can't pile up in the bucket.
  const keptImages = new Set(data.images);
  const removedImages = existing.images.filter((url) => !keptImages.has(url));
  if (removedImages.length > 0) await deleteUploadedFiles(removedImages);

  revalidatePath("/admin/products");
  revalidatePath("/shop");
  revalidatePath("/new-arrivals");
  revalidatePath("/"); // featured products surface on the homepage
  revalidatePath(`/product/${data.slug}`);
  // If the slug changed, the old detail URL needs refreshing too.
  if (existing.slug !== data.slug) revalidatePath(`/product/${existing.slug}`);

  return { success: true, archivedCount };
}

export type DeleteProductResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Hard-deletes a product. Its variants and reviews cascade away (schema:
 * onDelete Cascade), but `OrderItem.variant` is `onDelete: Restrict` — a
 * product that has ever been ordered therefore CANNOT be deleted (that would
 * destroy order history). We surface that as a clean validation message (P2003)
 * rather than a 500.
 */
export async function deleteProduct(id: string): Promise<DeleteProductResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };
  if (!id) return { success: false, error: "Missing product id." };

  // Images captured BEFORE the delete — once the row is gone nothing points at
  // the bucket files any more. They are purged only after the delete succeeds:
  // a Restrict-blocked (ordered) product keeps its row and must keep its media.
  const existing = await prisma.product.findUnique({
    where: { id },
    select: { images: true, slug: true },
  });
  if (!existing) {
    return { success: false, error: "That product no longer exists." };
  }

  try {
    await prisma.product.delete({ where: { id } });

    // Best-effort bucket hygiene (post-commit, never fails the action).
    await deleteUploadedFiles(existing.images);

    revalidatePath("/admin/products");
    revalidatePath("/shop");
    revalidatePath("/new-arrivals");
    revalidatePath("/"); // featured products surface on the homepage
    // The ISR page would otherwise keep serving the deleted product.
    revalidatePath(`/product/${existing.slug}`);

    return { success: true };
  } catch (err) {
    const code = prismaErrorCode(err);

    if (code === "P2003") {
      return {
        success: false,
        error:
          "This product appears in existing orders and can’t be deleted. Mark it Out of Stock instead.",
      };
    }
    if (code === "P2025") {
      return { success: false, error: "That product no longer exists." };
    }

    console.error("deleteProduct failed:", err);
    return {
      success: false,
      error: "Could not delete the product. Please try again.",
    };
  }
}

/**
 * Creates a Product together with its ProductVariants in a single nested
 * write. Re-validates input server-side (never trusts the client) and revalidates
 * the affected routes so the new product shows up without a manual refresh.
 */
export async function createProduct(
  input: ProductInput,
): Promise<CreateProductResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };

  const parsed = productInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid product data.",
    };
  }
  const data = parsed.data;

  try {
    // No promotion may make a product free — a new product is reached only
    // through its category (nothing can target it by id yet).
    const tooCheap = await freePriceProblem({
      id: null,
      name: data.name,
      categoryId: data.categoryId,
      variants: data.variants.map((v) => ({ name: v.name, price: v.price })),
    });
    if (tooCheap) return { success: false, error: tooCheap };

    const product = await prisma.product.create({
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description?.trim() || null,
        images: data.images,
        categoryId: data.categoryId,
        variants: {
          create: data.variants.map((v) => ({
            name: v.name,
            price: v.price,
            // Empty/omitted → explicit null (no discount).
            compareAtPrice: v.compareAtPrice ?? null,
            sku: v.sku?.trim() || null,
          })),
        },
      },
      select: { id: true },
    });

    // Storefront + admin surfaces that list products.
    revalidatePath("/admin/products");
    revalidatePath("/shop");
    revalidatePath("/new-arrivals");
    revalidatePath("/");
    // The PDP is ISR: a visit before this slug existed cached a 404 there.
    revalidatePath(`/product/${data.slug}`);

    return { success: true, productId: product.id };
  } catch (err) {
    // P2002 = unique constraint violation (slug or sku already taken).
    if (prismaErrorCode(err) === "P2002") {
      const target = (err as { meta?: { target?: unknown } }).meta?.target;
      const onSku = Array.isArray(target) && target.some((t) => String(t).includes("sku"));
      return {
        success: false,
        error: onSku
          ? "That SKU is already in use."
          : "A product with this slug already exists.",
      };
    }

    console.error("createProduct failed:", err);
    return {
      success: false,
      error: "Could not create the product. Please try again.",
    };
  }
}
