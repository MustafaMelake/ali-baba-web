"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import {
  productInputSchema,
  productUpdateSchema,
  type ProductInput,
  type ProductUpdateInput,
} from "@/lib/validators";

function prismaErrorCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

export type CreateProductResult =
  | { success: true; productId: string }
  | { success: false; error: string };

export type UpdateProductResult =
  | { success: true; archivedCount: number }
  | { success: false; error: string };

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
  await requireAdmin();
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
    select: { id: true, slug: true, variants: { select: { id: true } } },
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
    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          name: data.name,
          slug: data.slug,
          description: data.description?.trim() || null,
          images: data.images,
          categoryId: data.categoryId,
          menuPageId: data.menuPageId,
          isAvailable: data.isAvailable,
          isFeatured: data.isFeatured,
        },
      });

      // Upsert kept variants (update) and create new ones; sortOrder follows
      // the on-screen ordering.
      for (const [index, v] of data.variants.entries()) {
        const sku = v.sku?.trim() || null;
        // Coalesce undefined/empty to an explicit null so ending a promotion
        // (clearing the field) actually wipes a legacy discount in the DB.
        const compareAtPrice = v.compareAtPrice ?? null;
        if (v.id && keptIds.has(v.id)) {
          await tx.productVariant.update({
            where: { id: v.id },
            data: { name: v.name, price: v.price, compareAtPrice, sku, sortOrder: index },
          });
        } else {
          await tx.productVariant.create({
            data: { productId: id, name: v.name, price: v.price, compareAtPrice, sku, sortOrder: index },
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

  revalidatePath("/admin/products");
  revalidatePath("/shop");
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
  await requireAdmin();
  if (!id) return { success: false, error: "Missing product id." };

  try {
    await prisma.product.delete({ where: { id } });

    revalidatePath("/admin/products");
    revalidatePath("/shop");
    revalidatePath("/"); // featured products surface on the homepage

    return { success: true };
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? (err as { code?: unknown }).code
        : undefined;

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
  await requireAdmin();

  const parsed = productInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid product data." };
  }
  const data = parsed.data;

  try {
    const product = await prisma.product.create({
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description?.trim() || null,
        images: data.images,
        categoryId: data.categoryId,
        menuPageId: data.menuPageId,
        variants: {
          create: data.variants.map((v, index) => ({
            name: v.name,
            price: v.price,
            // Empty/omitted → explicit null (no discount).
            compareAtPrice: v.compareAtPrice ?? null,
            sku: v.sku?.trim() || null,
            sortOrder: index,
          })),
        },
      },
      select: { id: true },
    });

    // Storefront + admin surfaces that list products.
    revalidatePath("/admin/products");
    revalidatePath("/shop");
    revalidatePath("/");

    return { success: true, productId: product.id };
  } catch (err) {
    // P2002 = unique constraint violation (slug or sku already taken).
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: unknown }).code === "P2002"
    ) {
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
