"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { productInputSchema, type ProductInput } from "@/lib/validators";

export type CreateProductResult =
  | { success: true; productId: string }
  | { success: false; error: string };

/**
 * Creates a Product together with its first ProductVariant in a single nested
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
          create: [
            {
              name: data.variant.name,
              price: data.variant.price,
              sku: data.variant.sku?.trim() || null,
              sortOrder: 0,
            },
          ],
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
