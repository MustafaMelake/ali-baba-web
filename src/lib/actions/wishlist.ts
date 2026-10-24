"use server";

import { prisma } from "@/lib/prisma";
// السيشن بتتجاب من الـ wrapper المخصص عندنا (مش من better-auth مباشرة).
import { getServerSession } from "@/lib/session";
import { revalidatePath } from "next/cache";
import {
  collectionPromotionsInclude,
  collectionPromotionsOf,
  gatherPromotions,
  livePromotionWhere,
  PROMOTION_SELECT_FIELDS,
  resolvePrice,
} from "@/lib/discounts";
import { prismaErrorCode } from "@/lib/action-utils";
import { pageSlice, STOREFRONT_PAGE_SIZE } from "@/lib/pagination";

export type ToggleWishlistResult =
  | { success: true; added: boolean }
  | { success: false; error: string };

export type WishlistProduct = {
  id: string;
  name: string;
  slug: string;
  image: string;
  category: string;
  /** Final (possibly discounted) starting price; `null` when the product can't
   *  be bought right now (switched off, or every variant archived). */
  price: number | null;
  /** Struck-through "was" price — the base price under a live promotion, else
   *  the variant's manual Compare-At; `null` when neither applies. */
  compareAtPrice: number | null;
};

export type GetWishlistResult =
  | { success: true; data: WishlistProduct[]; /** saved items across ALL pages */ total: number }
  | { success: false; error: string };

/**
 * تبديل حالة المنتج في المفضلة: لو موجود يتشال، لو مش موجود يتضاف.
 * Auth-gated. Returns the *resulting* state so the client can reconcile its
 * optimistic UI with the server's truth.
 */
export async function toggleWishlist(
  productId: string,
): Promise<ToggleWishlistResult> {
  if (!productId) return { success: false, error: "Missing product." };

  const session = await getServerSession();
  if (!session) {
    return { success: false, error: "Please sign in to use your wishlist." };
  }
  const userId = session.user.id;

  try {
    const existing = await prisma.wishlistItem.findUnique({
      where: { userId_productId: { userId, productId } },
      select: { id: true },
    });

    if (existing) {
      await prisma.wishlistItem.delete({ where: { id: existing.id } });
      revalidatePath("/wishlist");
      return { success: true, added: false };
    }

    await prisma.wishlistItem.create({ data: { userId, productId } });
    revalidatePath("/wishlist");
    return { success: true, added: true };
  } catch (err) {
    // سباق إضافة متزامن → نعتبره "متضاف بالفعل".
    if (prismaErrorCode(err) === "P2002") {
      return { success: true, added: true };
    }
    // productId غير صالح / محذوف → خرق مفتاح أجنبي.
    if (prismaErrorCode(err) === "P2003") {
      return { success: false, error: "This product no longer exists." };
    }
    console.error("toggleWishlist failed:", err);
    return { success: false, error: "Something went wrong. Please try again." };
  }
}

/**
 * جلب منتجات المفضلة للمستخدم الحالي — already mapped to a flat, card-ready shape
 * (starting price = lowest available variant; category name included for display).
 */
export async function getWishlistItems(page: unknown = 1): Promise<GetWishlistResult> {
  const session = await getServerSession();
  if (!session) return { success: false, error: "Unauthorized" };
  // A server action input — never trust the shape; a bad page reads as page 1.
  const pageNumber = typeof page === "number" && Number.isInteger(page) && page >= 1 ? page : 1;
  const where = { userId: session.user.id };

  // One instant drives every promotion filter + evaluation this request.
  const now = new Date();

  try {
    const [total, items] = await Promise.all([
      prisma.wishlistItem.count({ where }),
      prisma.wishlistItem.findMany({
        where,
        // `id` tie-break keeps a stable page order for items saved together.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...pageSlice(pageNumber, STOREFRONT_PAGE_SIZE),
        include: {
          product: {
            include: {
              category: {
                select: {
                  name: true,
                  promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
                },
              },
              promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
              // Promotions on the product's ACTIVE collections (the fourth level).
              ...collectionPromotionsInclude(now),
              variants: {
                where: { isAvailable: true },
                orderBy: { price: "asc" }, // [0] = starting price
                select: {
                  id: true,
                  price: true,
                  compareAtPrice: true, // manual "was" price → card fallback
                  promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
                },
              },
            },
          },
        },
      }),
    ]);

    const data: WishlistProduct[] = items.map(({ product }) => {
      const card = {
        id: product.id,
        name: product.name,
        slug: product.slug,
        image: product.images[0] ?? "/placeholder.jpg",
        category: product.category.name,
      };

      // Saved products stay listed even when the catalog would hide them (the
      // heart is how the shopper removes one) — but with no price, since
      // placeOrder would reject them. Same rule as LISTABLE_PRODUCT.
      const starting = product.variants[0];
      if (!product.isAvailable || !starting) {
        return { ...card, price: null, compareAtPrice: null };
      }

      const priced = resolvePrice(
        starting.price,
        gatherPromotions(
          starting.promotions,
          product.promotions,
          product.category.promotions,
          collectionPromotionsOf(product),
        ),
        now,
      );
      return {
        ...card,
        price: priced.finalPrice,
        // Live promo → struck-through base price; otherwise fall back to the
        // variant's manual Compare-At (mirrors the PDP and storefront cards).
        // The Decimal column is serialized to a plain number for the client.
        compareAtPrice: priced.hasDiscount
          ? priced.basePrice
          : starting.compareAtPrice?.toNumber() ?? null,
      };
    });

    return { success: true, data, total };
  } catch (err) {
    console.error("getWishlistItems failed:", err);
    return { success: false, error: "Could not load your wishlist." };
  }
}

/**
 * أخف استعلام ممكن: مجرد قائمة productIds الموجودة في مفضلة اليوزر الحالي.
 *
 * Consumed by the client wishlist store (src/lib/wishlist-store.ts) — ONE call
 * per page hydrates every heart after the cached HTML paints. Returns `[]` for
 * guests (and on error) so the caller never branches on auth. Select a single
 * column so Postgres only ships the ids we need.
 */
export async function getWishlistedProductIds(): Promise<string[]> {
  const session = await getServerSession();
  if (!session) return [];

  try {
    const rows = await prisma.wishlistItem.findMany({
      where: { userId: session.user.id },
      select: { productId: true },
    });
    return rows.map((r) => r.productId);
  } catch (err) {
    console.error("getWishlistedProductIds failed:", err);
    return [];
  }
}
