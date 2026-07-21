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
  roundMoney,
} from "@/lib/discounts";
import { getStoreSettings } from "@/lib/store-settings";
import { prismaErrorCode } from "@/lib/action-utils";
import { checkoutSchema } from "@/lib/validators";

// التسعير الرسمي بيتقري من قاعدة البيانات وقت الطلب (مش ثوابت في الكود):
// رسوم التوصيل من الـ Branch المختار (أو defaultDeliveryFee لـ "مناطق أخرى")،
// والضريبة من StoreSettings — نفس القيم اللي الـ checkout بيعرضها كـ preview.

/**
 * [H-1] Abuse throttle — ceiling on simultaneously-PENDING orders per customer
 * phone number. `placeOrder` is deliberately guest-writable, so without a gate
 * a script can fill the table with fake orders; capping *unconfirmed* orders
 * per phone means each junk identity stalls after this many rows, while a
 * legitimate repeat customer frees a slot the moment staff confirm an order
 * (PENDING → PREPARING/…). Phone-keyed because no Edge KV/IP infrastructure is
 * configured and the phone is the field the business actually calls back;
 * being client-supplied, it raises the cost of abuse rather than eliminating
 * it (a rotating-phone bot needs a fresh number per 3 orders).
 */
const MAX_PENDING_ORDERS_PER_PHONE = 3;

/**
 * Marks a throw as a *domain* failure whose message is written for the customer
 * (e.g. "Chocolate Cake is no longer available."), so the catch below can pass
 * it through verbatim. Anything else — a Prisma fault, a driver error — falls to
 * the generic message instead of leaking internal text into the checkout UI.
 * Module-local by necessity: a "use server" file may only EXPORT async functions.
 */
class OrderLineUnavailableError extends Error {}

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

  // Authoritative validation — the SAME shared schema the checkout form runs
  // client-side (src/lib/validators.ts). Beyond the empty-cart and name/phone
  // checks, it enforces the conditional rule a tampered client could bypass:
  // a DELIVERY order MUST carry a non-empty addressLine (PICKUP stays
  // address-free). Client-side validation is a courtesy; this is the gate.
  const parsed = checkoutSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid order details.",
    };
  }
  const data = parsed.data;

  try {
    // ── [H-1] Per-phone pending-order throttle ─────────────────────────────
    // Runs FIRST — before the branch/settings reads and the transaction — so
    // a throttled request costs one indexed COUNT and nothing else. The match
    // is exact on the schema-trimmed phone string and counts only PENDING
    // orders: confirmed/cancelled orders never block a customer. (Count-then-
    // create is not atomic — a burst of parallel requests can land slightly
    // over the cap. Fine for a throttle; the ceiling still holds within one
    // request of the limit.)
    const pendingCount = await prisma.order.count({
      where: {
        customerPhone: data.customerPhone,
        status: OrderStatus.PENDING,
      },
    });
    if (pendingCount >= MAX_PENDING_ORDERS_PER_PHONE) {
      return {
        success: false,
        error:
          "Too many pending orders. Please wait for your current orders to be confirmed.",
      };
    }

    // Defensive branch resolution: only stamp a REAL, ACTIVE branch (the pickup
    // choice or the delivery auto-route). A stale / invalid / inactive id falls
    // back to null so the order never fails — it just surfaces to the Super Admin.
    // The branch's own deliveryFee is captured here too: it's the authoritative
    // fee for DELIVERY orders routed to this branch.
    let branch: { id: string; deliveryFee: number } | null = null;
    if (data.branchId) {
      const row = await prisma.branch.findFirst({
        where: { id: data.branchId, isActive: true },
        select: { id: true, deliveryFee: true },
      });
      // deliveryFee is a Decimal column — normalize to a number so the rounding
      // + summation below stay plain JS arithmetic.
      if (row) branch = { id: row.id, deliveryFee: row.deliveryFee.toNumber() };
    }
    const branchId = branch?.id ?? null;

    // Global pricing knobs (VAT + the "Other Areas" delivery fee), read fresh
    // from the DB per order — the client's preview numbers are never trusted.
    const settings = await getStoreSettings();

    // One instant for the whole order: every promotion (variant/product/category
    // level) is filtered AND evaluated against the same `now`, so a promo can't
    // expire mid-loop and price two lines inconsistently.
    const now = new Date();

    // Transaction يضمن تماسك الداتا: إمّا الأوردر بكل سطوره يتعمل، أو لا شيء.
    // Kept deliberately SHORT for Neon: exactly two statements — one batched
    // variant read, one nested order create — regardless of how many lines the
    // order has (was a findUnique per line, an N+1 that held the transaction
    // open in proportion to cart size).
    const newOrder = await prisma.$transaction(async (tx) => {
      // ONE read for the whole cart. The schema has already capped items at
      // CHECKOUT_MAX_ITEMS, so this `id IN (…)` list is bounded too.
      const variantIds = [...new Set(data.items.map((i) => i.variantId))];
      const dbVariants = await tx.productVariant.findMany({
        where: { id: { in: variantIds } },
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

      // O(1) per-line lookups; the loop below does no database work at all.
      const variantById = new Map(dbVariants.map((v) => [v.id, v]));

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
      for (const item of data.items) {
        const dbVariant = variantById.get(item.variantId);

        // Missing (deleted / forged id) or switched off — throw so the whole
        // order rolls back; a partial order must never be created.
        if (
          !dbVariant ||
          !dbVariant.isAvailable ||
          !dbVariant.product.isAvailable
        ) {
          throw new OrderLineUnavailableError(
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

        // Quantity is schema-guaranteed: an integer in [1, CHECKOUT_MAX_QUANTITY].
        subtotal += finalPrice * item.quantity;

        // Snapshot لبيانات السطر وقت الشراء (الاسم/الـ variant/السعر النهائي بعد الخصم).
        orderItemsData.push({
          variantId: dbVariant.id,
          productName: dbVariant.product.name,
          variantName: dbVariant.name,
          unitPrice: finalPrice,
          quantity: item.quantity,
        });
      }

      // Money hygiene: every unit price is 2-dp (resolvePrice → roundMoney),
      // but a binary-float ACCUMULATION of them can still drift — 3 × 33.33
      // sums to 99.99000000000001, and that drift would otherwise be stored
      // and compound in revenue aggregates. Round the final sum ONCE, here,
      // so the persisted subtotal is the exact 2-dp figure the summary shows
      // (per-line rounding is already done; re-rounding each line would be a
      // no-op, and rounding only at the end keeps parity with the preview's
      // own reduce-then-display math).
      subtotal = roundMoney(subtotal);

      // DELIVERY → the fulfilling branch's own fee; branchless delivery
      // ("Other Areas", or a branch that went inactive mid-checkout) → the
      // global default. PICKUP is always free. The admin mutations already
      // persist fees rounded to 2dp — roundMoney here is defensive, so a
      // legacy/hand-edited Branch row can't smuggle drift into the order.
      const deliveryFee =
        data.fulfillment === FulfillmentMethod.DELIVERY
          ? roundMoney(branch?.deliveryFee ?? settings.defaultDeliveryFee)
          : 0;
      // VAT غير مخزّن في عمود مستقل — مدموج في totalAmount، وبيتحسب كـ residual
      // وقت العرض (totalAmount - subtotal - deliveryFee) فيفضل دايماً متسق،
      // حتى لو الأدمن غيّر النسبة أو قفل الضريبة بعد ما الأوردر اتعمل.
      // 2-dp money rounding (NOT Math.round to whole EGP) so the tax keeps its
      // piastres and totalAmount reconciles exactly with the shown summary.
      // Computed from the ROUNDED subtotal — the same base the customer saw.
      const vat = settings.isVatEnabled
        ? roundMoney(subtotal * settings.vatRate)
        : 0;
      // Sum of three clean 2-dp values, rounded once more: binary addition of
      // 2-dp floats can itself reintroduce an epsilon (the 0.1 + 0.2 class),
      // and this is the last stop before the value hits the Decimal column.
      const totalAmount = roundMoney(subtotal + deliveryFee + vat);

      // إنشاء الأوردر مع سطوره في عملية واحدة (nested write).
      return tx.order.create({
        data: {
          userId,
          subtotal,
          deliveryFee,
          totalAmount,
          fulfillment: data.fulfillment,
          status: OrderStatus.PENDING,
          // Schema-guaranteed: non-empty (trimmed) for DELIVERY orders.
          addressLine: data.addressLine,
          pickupBranch: data.pickupBranch,
          // Resolved + validated above: a real active branch, or null.
          branchId,
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          orderNotes: data.orderNotes,
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
    // Only a deliberate domain throw carries a customer-safe message. Every
    // other failure (Prisma fault, driver error) gets the generic line — a
    // raw `err.message` here would surface internal schema text at checkout,
    // e.g. a P2002 on the sequential orderNumber under concurrent placement.
    console.error("placeOrder failed:", err);
    return {
      success: false,
      error:
        err instanceof OrderLineUnavailableError
          ? err.message
          : "Could not place your order. Please try again.",
    };
  }
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
): Promise<{ success: true } | { success: false; error: string }> {
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
