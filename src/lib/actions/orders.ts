"use server";

import { prisma } from "@/lib/prisma";
// السيشن من الـ wrapper المخصص (مش من better-auth مباشرة).
import { getServerSession, requireDashboardAccess } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { FulfillmentMethod, OrderStatus } from "@/generated/prisma/enums";
import {
  collectionPromotionsInclude,
  collectionPromotionsOf,
  gatherPromotions,
  livePromotionWhere,
  PROMOTION_SELECT_FIELDS,
  resolvePrice,
  roundMoney,
} from "@/lib/discounts";
import { getStoreSettings } from "@/lib/store-settings";
import { prismaErrorCode } from "@/lib/action-utils";
import { checkoutSchema, PICKUP_UNAVAILABLE_ERROR } from "@/lib/validators";
import {
  orderTotals,
  PRICES_CHANGED,
  sameTotal,
  type PricesChangedSummary,
} from "@/lib/cart-summary";
import {
  branchOutOfStockMessage,
  branchSoldOutTodayMessage,
  isAvailableAtBranch,
  isSoldOutToday,
} from "@/lib/catalog";

// التسعير الرسمي بيتقري من قاعدة البيانات وقت الطلب (مش ثوابت في الكود):
// رسوم التوصيل من الـ Branch المختار (أو defaultDeliveryFee لـ "مناطق أخرى")،
// والضريبة من StoreSettings — نفس القيم اللي الـ checkout بيعرضها كـ preview.

/**
 * [H-1] Abuse throttle — ceiling on simultaneously-PENDING orders per customer
 * phone number. `placeOrder` is deliberately guest-writable, so without a gate
 * a script can fill the table with fake orders; capping *unconfirmed* orders
 * per phone means each junk identity stalls after this many rows, while a
 * legitimate repeat customer frees a slot the moment staff confirm an order
 * (PENDING → PREPARING/…).
 *
 * ATOMIC: the count runs inside the order transaction, behind a transaction-
 * scoped advisory lock on the canonical phone (PHONE_LOCK_PREFIX), so two
 * orders for one phone serialize — the second counts only after the first has
 * committed (or rolled back). A burst of parallel requests can no longer all
 * read the same count and all pass.
 *
 * What it does NOT stop: number rotation. Any of ~400M valid Egyptian mobiles
 * passes `normalizeEgyptMobile`, so a script with a fresh number per 3 orders
 * walks straight past a per-phone cap. That is the job of the per-IP rate
 * limits at the edge (Vercel Firewall — docs/DEPLOY_RUNBOOK.md); this throttle
 * only bounds what one identity can do.
 */
const MAX_PENDING_ORDERS_PER_PHONE = 3;

/** Namespaces the per-phone advisory lock key (no other advisory locks exist). */
const PHONE_LOCK_PREFIX = "order-phone:";

/** Marks the throttle refusal so the catch can pass its message through verbatim. */
class TooManyPendingOrdersError extends Error {}

const TOO_MANY_PENDING_ERROR =
  "Too many pending orders. Please wait for your current orders to be confirmed.";

/**
 * Marks a throw as a *domain* failure whose message is written for the customer
 * (e.g. "Chocolate Cake is no longer available."), so the catch below can pass
 * it through verbatim. Anything else — a Prisma fault, a driver error — falls to
 * the generic message instead of leaking internal text into the checkout UI.
 * Module-local by necessity: a "use server" file may only EXPORT async functions.
 */
class OrderLineUnavailableError extends Error {}

/**
 * [H-3] The fresh bill differs from the total the customer was shown. Thrown
 * inside the transaction before the order is created, so nothing is written;
 * the catch turns it into the typed PRICES_CHANGED result.
 */
class PricesChangedError extends Error {
  constructor(readonly summary: PricesChangedSummary) {
    super(PRICES_CHANGED);
  }
}

const PRICES_CHANGED_ERROR =
  "Prices changed since you opened checkout. Please review the new total and confirm.";

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
  /**
   * [H-3] The total the checkout DISPLAYED. Only ever compared with the fresh
   * bill — a mismatch returns PRICES_CHANGED instead of an order. Never billed,
   * never trusted for anything else. Omitted → no consent check (an old bundle).
   */
  expectedTotal?: number;
}

export type PlaceOrderResult =
  | { success: true; orderNumber: number; orderId: string }
  | { success: false; error: string; code?: undefined }
  /** [H-3] Nothing was written: show `summary` and resubmit with `summary.total` to confirm. */
  | { success: false; error: string; code: typeof PRICES_CHANGED; summary: PricesChangedSummary };

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
    // [H-1] Fast reject, NOT the authority: a phone already at the cap is
    // turned away with one indexed COUNT, before any read and without ever
    // opening a transaction or waiting on the lock — so a bot retrying one
    // number can't tie up pooled connections. The authoritative count is the
    // locked one inside the transaction below.
    const pendingBefore = await prisma.order.count({
      where: { customerPhone: data.customerPhone, status: OrderStatus.PENDING },
    });
    if (pendingBefore >= MAX_PENDING_ORDERS_PER_PHONE) {
      return { success: false, error: TOO_MANY_PENDING_ERROR };
    }

    // Defensive branch resolution: only stamp a REAL, ACTIVE branch (the pickup
    // choice or the delivery auto-route). A stale / invalid / inactive id falls
    // back to null so the order never fails — it just surfaces to the Super Admin.
    // The branch's own deliveryFee is captured here too: it's the authoritative
    // fee for DELIVERY orders routed to this branch — and its name, for the
    // branch stock-out message below.
    let branch: { id: string; name: string; deliveryFee: number } | null = null;
    if (data.branchId) {
      const row = await prisma.branch.findFirst({
        where: { id: data.branchId, isActive: true },
        select: { id: true, name: true, deliveryFee: true },
      });
      // deliveryFee is a Decimal column — normalize to a number so the rounding
      // + summation below stay plain JS arithmetic.
      if (row) {
        branch = { id: row.id, name: row.name, deliveryFee: row.deliveryFee.toNumber() };
      }
    }
    const branchId = branch?.id ?? null;

    // A pickup has to be collected SOMEWHERE. Delivery may fall back to
    // "unassigned" (the Super Admin routes it), but a pickup with no real,
    // active branch — none exist, or the chosen one was retired mid-checkout —
    // is refused before any pricing work rather than stranded unassigned.
    if (data.fulfillment === FulfillmentMethod.PICKUP && !branch) {
      return { success: false, error: PICKUP_UNAVAILABLE_ERROR };
    }

    // Global pricing knobs (VAT + the "Other Areas" delivery fee), read fresh
    // from the DB per order — the client's preview numbers are never trusted.
    const settings = await getStoreSettings();

    // One instant for the whole order: every promotion (variant/product/category
    // level) is filtered AND evaluated against the same `now`, so a promo can't
    // expire mid-loop and price two lines inconsistently.
    const now = new Date();

    // Transaction يضمن تماسك الداتا: إمّا الأوردر بكل سطوره يتعمل، أو لا شيء.
    // Kept deliberately SHORT for Neon: at most FIVE statements, regardless of
    // how many lines the order has —
    //   1. the per-phone advisory lock,
    //   2. the PENDING count (the throttle),
    //   3. one batched variant read,
    //   4. one nested order create,
    //   5. for a signed-in buyer only, one cart delete.
    // (Was a findUnique per line, an N+1 that held the transaction open in
    // proportion to cart size.)
    const newOrder = await prisma.$transaction(async (tx) => {
      // ── [H-1] Per-phone pending-order throttle, atomic ──────────────────
      // The advisory lock serializes every order for this canonical phone;
      // it is released when this transaction commits or rolls back. Only
      // then does the next order for the same phone get to count, so it sees
      // this one. A throttled request still does no pricing work.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${PHONE_LOCK_PREFIX + data.customerPhone}, 0))`;
      // Exact match on the canonical E.164 phone, PENDING only:
      // confirmed/cancelled orders never block a customer.
      const pendingCount = await tx.order.count({
        where: {
          customerPhone: data.customerPhone,
          status: OrderStatus.PENDING,
        },
      });
      if (pendingCount >= MAX_PENDING_ORDERS_PER_PHONE) {
        throw new TooManyPendingOrdersError(TOO_MANY_PENDING_ERROR);
      }

      // ONE read for the whole cart. The schema has already capped items at
      // CHECKOUT_MAX_ITEMS, so this `id IN (…)` list is bounded too.
      const variantIds = [...new Set(data.items.map((i) => i.variantId))];
      const dbVariants = await tx.productVariant.findMany({
        where: { id: { in: variantIds } },
        include: {
          // The fulfilling branch's stock override, if any — rides along in
          // the same read, so branch stock adds no statement to the
          // transaction. A branchless order ("Other Areas") matches nothing
          // (`in: []`) and is judged on the global flags alone.
          branchAvailability: {
            where: { branchId: { in: branchId ? [branchId] : [] } },
            select: { isAvailable: true, soldOutUntil: true },
          },
          // Promotions that target the variant itself…
          promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
          product: {
            select: {
              name: true,
              isAvailable: true,
              // …its parent product…
              promotions: { where: livePromotionWhere(now), select: PROMOTION_SELECT_FIELDS },
              // …one of that product's ACTIVE collections (same batched read)…
              ...collectionPromotionsInclude(now),
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

        // Globally live, but unorderable at the fulfilling branch — either
        // switched off long-term by its manager, OR sold out there for today
        // only. Same rollback, with a message that says WHERE (and, for the
        // sold-out case, that it returns), so the customer knows another branch
        // (or "Other Areas") may still have it. Judged against the single `now`.
        const override = dbVariant.branchAvailability[0];
        if (
          branch &&
          !isAvailableAtBranch(
            {
              productAvailable: dbVariant.product.isAvailable,
              variantAvailable: dbVariant.isAvailable,
              branchAvailable: override?.isAvailable,
              soldOutUntil: override?.soldOutUntil,
            },
            now,
          )
        ) {
          const message = isSoldOutToday(override, now)
            ? branchSoldOutTodayMessage(dbVariant.product.name, dbVariant.name, branch.name)
            : branchOutOfStockMessage(dbVariant.product.name, dbVariant.name, branch.name);
          throw new OrderLineUnavailableError(message);
        }

        // Apply the best live discount server-side. `resolvePrice` re-checks
        // liveness defensively even though the query already filtered to live rows.
        const promotions = gatherPromotions(
          dbVariant.promotions,
          dbVariant.product.promotions,
          dbVariant.product.category?.promotions,
          collectionPromotionsOf(dbVariant.product),
        );
        const { finalPrice } = resolvePrice(dbVariant.price, promotions, now);

        // The engine floors at 0, so a promotion that reaches a line's price
        // would give it away. promotions.ts refuses those at save time; this
        // catches a price edited afterwards — refuse rather than bill 0 EGP.
        if (finalPrice <= 0) {
          console.error(
            `placeOrder: refused a 0 EGP line — check the promotions on variant ${dbVariant.id}`,
          );
          throw new OrderLineUnavailableError(
            `${dbVariant.product.name} can't be ordered right now. Please remove it from your cart.`,
          );
        }

        // Snapshot لبيانات السطر وقت الشراء (الاسم/الـ variant/السعر النهائي بعد الخصم).
        orderItemsData.push({
          variantId: dbVariant.id,
          productName: dbVariant.product.name,
          variantName: dbVariant.name,
          unitPrice: finalPrice,
          quantity: item.quantity,
        });
      }

      // The bill, through the SAME function the /cart and checkout previews
      // call (src/lib/cart-summary.ts): subtotal rounded once (3 × 33.33 sums
      // to 99.99000000000001), VAT on that rounded, discounted subtotal, the
      // fee, then the total rounded — nothing off the 2-dp grid reaches the
      // Decimal columns. DELIVERY → the fulfilling branch's own fee;
      // branchless delivery ("Other Areas", or a branch that went inactive
      // mid-checkout) → the global default. PICKUP is always free.
      // VAT غير مخزّن في عمود مستقل — مدموج في totalAmount، وبيتحسب كـ residual
      // وقت العرض (totalAmount - subtotal - deliveryFee) فيفضل دايماً متسق،
      // حتى لو الأدمن غيّر النسبة أو قفل الضريبة بعد ما الأوردر اتعمل.
      const {
        subtotal,
        deliveryFee,
        vat,
        total: totalAmount,
      } = orderTotals(
        orderItemsData.map((line) => ({ price: line.unitPrice, quantity: line.quantity })),
        settings,
        data.fulfillment === FulfillmentMethod.DELIVERY
          ? (branch?.deliveryFee ?? settings.defaultDeliveryFee)
          : 0,
      );

      // [H-3] Price consent: the customer agreed to the total they were shown.
      // If the fresh bill differs (a promotion ended, a price/VAT/fee changed
      // while checkout was open), refuse BEFORE creating anything and hand the
      // new summary back for confirmation. The bill above is still the only
      // money that can be charged — `expectedTotal` is never used for billing.
      if (data.expectedTotal !== undefined && !sameTotal(data.expectedTotal, totalAmount)) {
        throw new PricesChangedError({
          expectedTotal: roundMoney(data.expectedTotal),
          subtotal,
          deliveryFee,
          vat,
          vatRate: settings.isVatEnabled ? settings.vatRate : 0,
          total: totalAmount,
          lines: orderItemsData.map((line) => ({
            variantId: line.variantId,
            productName: line.productName,
            variantName: line.variantName,
            unitPrice: line.unitPrice,
            quantity: line.quantity,
          })),
        });
      }

      // إنشاء الأوردر مع سطوره في عملية واحدة (nested write).
      const order = await tx.order.create({
        data: {
          userId,
          subtotal,
          deliveryFee,
          totalAmount,
          // The rate actually applied — the receipt names it; the amount
          // stays the residual. 0, not the dormant setting, when VAT is off.
          vatRate: settings.isVatEnabled ? settings.vatRate : 0,
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

      // The ordered lines leave the buyer's saved cart in the SAME transaction,
      // so a dropped connection after checkout can't hydrate them back into
      // the cart. Only the ordered variants: a line added on another device
      // meanwhile stays.
      if (userId) {
        await tx.cartItem.deleteMany({
          where: { userId, variantId: { in: variantIds } },
        });
      }

      return order;
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
    // The throttle is an expected refusal, not a fault — no log noise.
    if (err instanceof TooManyPendingOrdersError) {
      return { success: false, error: err.message };
    }
    // A price change since checkout opened — an expected outcome, not a fault.
    if (err instanceof PricesChangedError) {
      return { success: false, error: PRICES_CHANGED_ERROR, code: PRICES_CHANGED, summary: err.summary };
    }
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
