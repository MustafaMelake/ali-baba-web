"use server";

import { prisma } from "@/lib/prisma";
// السيشن من الـ wrapper المخصص (مش من better-auth مباشرة).
import { getServerSession, requireDashboardAccess } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { FulfillmentMethod, OrderStatus } from "@/generated/prisma/enums";
import {
  gatherPromotions,
  livePromotionWhere,
  PROMOTION_SELECT_FIELDS,
  resolvePrice,
} from "@/lib/discounts";

// التسعير لازم يطابق ملخص الـ checkout بالظبط: توصيل 35 + ضريبة 14%.
const DELIVERY_FEE = 35;
const VAT_RATE = 0.14;

export interface CheckoutPayload {
  items: { variantId: string; quantity: number }[];
  fulfillment: FulfillmentMethod;
  addressLine?: string;
  pickupBranch?: string;
  /**
   * The fulfilling Branch's id, resolved directly from the checkout selection
   * (pickup branch, or delivery area-branch). `null` / omitted → unassigned →
   * the Super Admin. `pickupBranch` stays the free-text label for pickup orders.
   */
  branchId?: string | null;
  customerName: string;
  customerPhone: string;
  orderNotes?: string;
}

export type PlaceOrderResult =
  | { success: true; orderNumber: number; orderId: string }
  | { success: false; error: string };

export async function placeOrder(
  payload: CheckoutPayload,
): Promise<PlaceOrderResult> {
  // الأوردر يقبل يوزر مسجّل أو زائر (Guest).
  const session = await getServerSession();
  const userId = session?.user?.id ?? null;

  if (!payload.items?.length) {
    return { success: false, error: "Your cart is empty." };
  }
  if (!payload.customerName?.trim() || !payload.customerPhone?.trim()) {
    return { success: false, error: "Name and phone number are required." };
  }

  try {
    // Defensive branch resolution: only stamp a REAL, ACTIVE branch (the pickup
    // choice or the delivery auto-route). A stale / invalid / inactive id falls
    // back to null so the order never fails — it just surfaces to the Super Admin.
    let branchId: string | null = null;
    if (payload.branchId) {
      const branch = await prisma.branch.findFirst({
        where: { id: payload.branchId, isActive: true },
        select: { id: true },
      });
      branchId = branch?.id ?? null;
    }

    // One instant for the whole order: every promotion (variant/product/category
    // level) is filtered AND evaluated against the same `now`, so a promo can't
    // expire mid-loop and price two lines inconsistently.
    const now = new Date();

    // Transaction يضمن تماسك الداتا: إمّا الأوردر بكل سطوره يتعمل، أو لا شيء.
    const newOrder = await prisma.$transaction(async (tx) => {
      let subtotal = 0;
      const orderItemsData: {
        variantId: string;
        productName: string;
        variantName: string;
        unitPrice: number;
        quantity: number;
      }[] = [];

      // الأسعار تتقري من قاعدة البيانات مباشرة (الـ Source of Truth) — لا نثق
      // بأي سعر جاي من العميل، نمنع التلاعب بالأسعار. الخصم كمان بيتحسب هنا على
      // السيرفر فقط (Discount Engine) فالعميل يتحاسب على السعر النهائي بالظبط.
      for (const item of payload.items) {
        const quantity = Math.max(1, Math.floor(item.quantity));

        const dbVariant = await tx.productVariant.findUnique({
          where: { id: item.variantId },
          include: {
            // Promotions that target the variant itself…
            promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
            product: {
              select: {
                name: true,
                isAvailable: true,
                // …its parent product…
                promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
                // …or that product's category.
                category: {
                  select: {
                    promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
                  },
                },
              },
            },
          },
        });

        if (
          !dbVariant ||
          !dbVariant.isAvailable ||
          !dbVariant.product.isAvailable
        ) {
          throw new Error(
            `${dbVariant?.product.name ?? "An item in your cart"} is no longer available.`,
          );
        }

        // Apply the best live discount server-side. `resolvePrice` re-checks
        // liveness defensively even though the query already filtered to live rows.
        const promotions = gatherPromotions(
          dbVariant.promotions,
          dbVariant.product.promotions,
          dbVariant.product.category?.promotions,
        );
        const { finalPrice } = resolvePrice(dbVariant.price, promotions, now);

        subtotal += finalPrice * quantity;

        // Snapshot لبيانات السطر وقت الشراء (الاسم/الـ variant/السعر النهائي بعد الخصم).
        orderItemsData.push({
          variantId: dbVariant.id,
          productName: dbVariant.product.name,
          variantName: dbVariant.name,
          unitPrice: finalPrice,
          quantity,
        });
      }

      const deliveryFee =
        payload.fulfillment === FulfillmentMethod.DELIVERY ? DELIVERY_FEE : 0;
      // VAT غير مخزّن في عمود مستقل — مدموج في totalAmount، وبيتحسب كـ residual
      // وقت العرض (totalAmount - subtotal - deliveryFee) فيفضل دايماً متسق.
      const vat = Math.round(subtotal * VAT_RATE);
      const totalAmount = subtotal + deliveryFee + vat;

      // إنشاء الأوردر مع سطوره في عملية واحدة (nested write).
      return tx.order.create({
        data: {
          userId,
          subtotal,
          deliveryFee,
          totalAmount,
          fulfillment: payload.fulfillment,
          status: OrderStatus.PENDING,
          addressLine: payload.addressLine,
          pickupBranch: payload.pickupBranch,
          // Resolved + validated above: a real active branch, or null.
          branchId,
          customerName: payload.customerName.trim(),
          customerPhone: payload.customerPhone.trim(),
          orderNotes: payload.orderNotes,
          items: { create: orderItemsData },
        },
        select: { id: true, orderNumber: true },
      });
    });

    // تحديث كاش لوحة التحكم فوراً (الإيرادات + الطلبات اللحظية) وصفحة طلبات اليوزر.
    revalidatePath("/admin");
    revalidatePath("/admin/orders");
    if (userId) revalidatePath("/my-orders");

    return {
      success: true,
      orderNumber: newOrder.orderNumber,
      orderId: newOrder.id,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not place your order.";
    console.error("placeOrder failed:", err);
    return { success: false, error: message };
  }
}

/** Reads a Prisma known-request error code without importing the error class. */
function prismaErrorCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/**
 * Move an order along its lifecycle.
 *   - ADMIN   → any order.
 *   - MANAGER → only orders belonging to their OWN branch (branchId match);
 *     anything else (other branch, or an unassigned order) is unauthorized.
 * Revalidates the orders board AND the dashboard so revenue / counters re-sync.
 */
export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
): Promise<{ success: boolean; error?: string }> {
  // ADMIN or MANAGER only; role + branch resolved live from the DB.
  let scope;
  try {
    scope = await requireDashboardAccess();
  } catch {
    return { success: false, error: "Unauthorized." };
  }

  if (!orderId) return { success: false, error: "Missing order id." };
  // Defensive: never trust a status that isn't a real enum member.
  if (!Object.values(OrderStatus).includes(status)) {
    return { success: false, error: "Invalid order status." };
  }

  // A MANAGER may only touch orders fulfilled by their own branch.
  if (scope.role === "MANAGER") {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { branchId: true },
    });
    if (!order) {
      return { success: false, error: "That order no longer exists." };
    }
    if (order.branchId !== scope.branchId) {
      return {
        success: false,
        error: "Unauthorized: that order belongs to another branch.",
      };
    }
  }

  try {
    await prisma.order.update({
      where: { id: orderId },
      data: { status },
      select: { id: true },
    });

    revalidatePath("/admin/orders");
    revalidatePath("/admin");
    return { success: true };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return { success: false, error: "That order no longer exists." };
    }
    console.error("updateOrderStatus failed:", err);
    return { success: false, error: "Could not update the order status." };
  }
}
