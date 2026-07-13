// ─────────────────────────────────────────────────────────────────────────────
// placeOrder — integration suite (the price-integrity boundary).
//
// `placeOrder` is the platform's most consequential write path: the client
// sends only `{ variantId, quantity }[]` + fulfillment + contact, and the
// server authoritatively re-prices, re-taxes and bills. These tests pin the
// invariants from `.claude/rules/business-logic.md` ("placeOrder" + "Money
// math") and `.claude/rules/backend.md` (transaction discipline):
//
//   • The 4-point rounding pipeline, in order: per-line discount → roundMoney
//     (subtotal) → VAT on the DISCOUNTED subtotal → delivery fee → roundMoney
//     (total). No client price ever crosses the wire.
//   • The [H-1] per-phone throttle: ≥ 3 simultaneously-PENDING orders is refused
//     before any transaction opens.
//   • Transaction integrity: a missing / switched-off variant throws and rolls
//     back the WHOLE order — no partial write is ever attempted.
//
// MOCKING STRATEGY — mock only the true external boundaries, run everything
// else for real, so this exercises the actual money math end-to-end:
//   • @/lib/prisma   — the database (deep-mocked via vitest-mock-extended).
//   • @/lib/session  — auth (reads cookies/headers, unavailable off-request).
//   • next/cache     — revalidatePath throws outside a Next request scope.
// The REAL checkoutSchema (validators), getStoreSettings (store-settings) and
// Discount Engine (discounts) all run — that is what makes this an integration
// test rather than an assertion that our mocks return what we told them to.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@/generated/prisma/client";

// Registered before the module-under-test is imported. The factory calls
// `mockDeep` inline (an imported binding — safe inside a hoisted factory) and we
// recover the created instance through the mocked `prisma` import below.
vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));
vi.mock("@/lib/session", () => ({
  getServerSession: vi.fn(),
  requireDashboardAccess: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { placeOrder, updateOrderStatus, type CheckoutPayload } from "@/lib/actions/orders";
import { getServerSession, requireDashboardAccess } from "@/lib/session";
import type { DashboardScope } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { DiscountType, FulfillmentMethod, OrderStatus } from "@/generated/prisma/enums";
import { roundMoney } from "@/lib/discounts";
import type { PromotionLike } from "@/lib/discounts";

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>;
const mockedSession = vi.mocked(getServerSession);
const mockedRevalidate = vi.mocked(revalidatePath);
const mockedDashboardAccess = vi.mocked(requireDashboardAccess);

// placeOrder's catch logs expected business rejections (unavailable variant)
// via console.error — silence it so CI output stays clean.
vi.spyOn(console, "error").mockImplementation(() => {});

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** A Prisma-`Decimal`-like stand-in: money columns come back as objects. */
const decimalLike = (n: number) => ({ toNumber: () => n });

/** Always-live window so promos are live against the real `new Date()` inside placeOrder. */
const LIVE_WINDOW = {
  startDate: new Date("2000-01-01T00:00:00.000Z"),
  endDate: new Date("2999-12-31T23:59:59.999Z"),
};

/** A live promotion (percentage by default). */
function livePromo(overrides: Partial<PromotionLike> & Pick<PromotionLike, "value">): PromotionLike {
  return {
    id: "promo-1",
    name: "Promo",
    type: DiscountType.PERCENTAGE,
    isActive: true,
    ...LIVE_WINDOW,
    ...overrides,
  };
}

/** One row of the `productVariant.findMany` result, in the shape placeOrder reads. */
function variantRow(o: {
  id: string;
  price: number;
  name?: string;
  productName?: string;
  variantAvailable?: boolean;
  productAvailable?: boolean;
  variantPromos?: PromotionLike[];
  productPromos?: PromotionLike[];
  categoryPromos?: PromotionLike[];
}) {
  return {
    id: o.id,
    name: o.name ?? "Large",
    price: decimalLike(o.price),
    isAvailable: o.variantAvailable ?? true,
    promotions: o.variantPromos ?? [],
    product: {
      name: o.productName ?? "Chocolate Gateau",
      isAvailable: o.productAvailable ?? true,
      promotions: o.productPromos ?? [],
      category: { promotions: o.categoryPromos ?? [] },
    },
  };
}

/** Seed the batched variant read. */
function stubVariants(rows: ReturnType<typeof variantRow>[]) {
  mockPrisma.productVariant.findMany.mockResolvedValue(rows as never);
}

/** Override the global pricing knobs for a test. */
function stubSettings(s: { vatRate?: number; isVatEnabled?: boolean; defaultDeliveryFee?: number }) {
  mockPrisma.storeSettings.findUnique.mockResolvedValue({
    vatRate: s.vatRate ?? 0.14,
    isVatEnabled: s.isVatEnabled ?? true,
    defaultDeliveryFee: decimalLike(s.defaultDeliveryFee ?? 35),
  } as never);
}

/** A valid PICKUP payload; override per test. */
function payload(overrides: Partial<CheckoutPayload> = {}): CheckoutPayload {
  return {
    items: [{ variantId: "v1", quantity: 1 }],
    fulfillment: FulfillmentMethod.PICKUP,
    customerName: "Mostafa Ali",
    customerPhone: "01000000000",
    ...overrides,
  };
}

/** The `data` object handed to `order.create` (what actually gets persisted). */
function persistedOrder(): any {
  expect(mockPrisma.order.create).toHaveBeenCalledTimes(1);
  return (mockPrisma.order.create.mock.calls[0][0] as any).data;
}

// ── Default happy-path DB state — each test overrides only what it exercises ──

beforeEach(() => {
  mockReset(mockPrisma);
  mockedSession.mockReset();
  mockedRevalidate.mockReset();
  mockedDashboardAccess.mockReset();

  mockedSession.mockResolvedValue(null); // guest by default
  mockPrisma.order.count.mockResolvedValue(0); // no pending backlog
  mockPrisma.branch.findFirst.mockResolvedValue(null); // no branch unless a test sets one
  stubSettings({}); // VAT 14% on, default delivery 35
  stubVariants([variantRow({ id: "v1", price: 100 })]);
  mockPrisma.order.create.mockResolvedValue({ id: "order_1", orderNumber: 1001 } as never);
  mockPrisma.order.update.mockResolvedValue({ id: "order_1" } as never); // updateOrderStatus happy path

  // Interactive $transaction: run the callback with the same deep mock as `tx`.
  // A throw inside rejects the transaction (Prisma rolls back) — precisely the
  // behaviour the integrity tests rely on.
  mockPrisma.$transaction.mockImplementation((async (cb: (tx: typeof mockPrisma) => unknown) =>
    cb(mockPrisma)) as any);
});

afterAll(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Payload validation — the authoritative gate (runs BEFORE any DB work)
// ─────────────────────────────────────────────────────────────────────────────

describe("placeOrder — payload validation (authoritative gate)", () => {
  it("rejects an empty cart before touching the database", async () => {
    const res = await placeOrder(payload({ items: [] }));
    expect(res).toEqual({ success: false, error: "Your cart is empty." });
    expect(mockPrisma.order.count).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a DELIVERY order with no address (the cross-field rule a client could bypass)", async () => {
    const res = await placeOrder(
      payload({ fulfillment: FulfillmentMethod.DELIVERY, addressLine: "" }),
    );
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("Please add a delivery address.");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a blank customer name", async () => {
    const res = await placeOrder(payload({ customerName: "   " }));
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("Name is required");
    expect(mockPrisma.order.create).not.toHaveBeenCalled();
  });

  it("accepts a well-formed DELIVERY order with an address", async () => {
    const res = await placeOrder(
      payload({ fulfillment: FulfillmentMethod.DELIVERY, addressLine: "12 El-Nasr St, Menouf" }),
    );
    expect(res.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. [H-1] Per-phone pending-order throttle
// ─────────────────────────────────────────────────────────────────────────────

describe("placeOrder — per-phone pending throttle [H-1]", () => {
  it("allows an order when 2 orders are pending (below the cap of 3)", async () => {
    mockPrisma.order.count.mockResolvedValue(2);
    const res = await placeOrder(payload());
    expect(res.success).toBe(true);
    expect(mockPrisma.order.create).toHaveBeenCalledTimes(1);
  });

  it("REJECTS at exactly 3 pending orders, without opening a transaction", async () => {
    mockPrisma.order.count.mockResolvedValue(3);
    const res = await placeOrder(payload({ customerPhone: "01234567890" }));
    expect(res).toEqual({
      success: false,
      error: "Too many pending orders. Please wait for your current orders to be confirmed.",
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.order.create).not.toHaveBeenCalled();
  });

  it("rejects above the cap too (e.g. 5 pending)", async () => {
    mockPrisma.order.count.mockResolvedValue(5);
    const res = await placeOrder(payload());
    expect(res.success).toBe(false);
    expect(mockPrisma.order.create).not.toHaveBeenCalled();
  });

  it("counts ONLY this phone's PENDING orders (confirmed/cancelled never block)", async () => {
    await placeOrder(payload({ customerPhone: "01555555555" }));
    expect(mockPrisma.order.count).toHaveBeenCalledWith({
      where: { customerPhone: "01555555555", status: OrderStatus.PENDING },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Transaction integrity — no partial orders
// ─────────────────────────────────────────────────────────────────────────────

describe("placeOrder — transaction integrity (no partial orders)", () => {
  it("rolls back when a variant id is missing from the batch read (forged/deleted id)", async () => {
    stubVariants([]); // the id resolves to nothing
    const res = await placeOrder(payload({ items: [{ variantId: "ghost", quantity: 1 }] }));
    expect(res).toEqual({
      success: false,
      error: "An item in your cart is no longer available.",
    });
    expect(mockPrisma.productVariant.findMany).toHaveBeenCalledTimes(1); // the read happened…
    expect(mockPrisma.order.create).not.toHaveBeenCalled(); // …but NO write was attempted
  });

  it("rolls back when a variant is switched off (isAvailable: false)", async () => {
    stubVariants([variantRow({ id: "v1", price: 100, variantAvailable: false, productName: "Basbousa" })]);
    const res = await placeOrder(payload());
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("Basbousa is no longer available.");
    expect(mockPrisma.order.create).not.toHaveBeenCalled();
  });

  it("rolls back when the parent product is unavailable", async () => {
    stubVariants([variantRow({ id: "v1", price: 100, productAvailable: false, productName: "Konafa" })]);
    const res = await placeOrder(payload());
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("Konafa is no longer available.");
    expect(mockPrisma.order.create).not.toHaveBeenCalled();
  });

  it("rejects the WHOLE order when just one of several lines is unavailable", async () => {
    // v1 valid, v2 missing from the read → the entire order rolls back.
    stubVariants([variantRow({ id: "v1", price: 100 })]);
    const res = await placeOrder(
      payload({
        items: [
          { variantId: "v1", quantity: 1 },
          { variantId: "v2", quantity: 1 },
        ],
      }),
    );
    expect(res.success).toBe(false);
    expect(mockPrisma.order.create).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. The 4-point rounding pipeline (order of operations)
// ─────────────────────────────────────────────────────────────────────────────

describe("placeOrder — the 4-point rounding pipeline", () => {
  it("applies discount → subtotal → VAT(on discounted) → delivery → total, rounding at each step", async () => {
    mockPrisma.branch.findFirst.mockResolvedValue({ id: "b1", deliveryFee: decimalLike(35) } as never);
    stubSettings({ vatRate: 0.14, isVatEnabled: true });
    stubVariants([
      // 11.22 − 10% → 10.098 → roundMoney 10.10  (per-line discount snapshot)
      variantRow({
        id: "vA",
        price: 11.22,
        variantPromos: [livePromo({ id: "p10", type: DiscountType.PERCENTAGE, value: 10 })],
      }),
      variantRow({ id: "vB", price: 20.2 }),
    ]);

    const res = await placeOrder(
      payload({
        fulfillment: FulfillmentMethod.DELIVERY,
        addressLine: "12 El-Nasr St, Menouf",
        branchId: "b1",
        items: [
          { variantId: "vA", quantity: 1 },
          { variantId: "vB", quantity: 1 },
        ],
      }),
    );

    expect(res.success).toBe(true);
    const data = persistedOrder();
    const items = data.items.create as any[];

    // Point 1 — per-line discount is snapshotted onto each OrderItem.
    expect(items.find((i) => i.variantId === "vA").unitPrice).toBe(10.1);
    expect(items.find((i) => i.variantId === "vB").unitPrice).toBe(20.2);

    // Point 2 — subtotal is rounded ONCE over the accumulation.
    // Raw 10.10 + 20.20 === 30.299999999999997 in IEEE-754 → stored 30.30.
    expect(data.subtotal).toBe(30.3);

    // Point 3 (delivery) — the fulfilling branch's OWN fee, not the default.
    expect(data.deliveryFee).toBe(35);

    // Point 3 (VAT) — computed on the DISCOUNTED subtotal (30.30 × 0.14 = 4.24),
    // never the pre-discount 31.42. Derived exactly as a receipt does.
    expect(roundMoney(data.totalAmount - data.subtotal - data.deliveryFee)).toBe(4.24);
    expect(roundMoney(data.subtotal * 0.14)).toBe(4.24);

    // Point 4 — final total rounded once more.
    // Raw 30.30 + 35 + 4.24 === 69.53999999999999 → stored 69.54.
    expect(data.totalAmount).toBe(69.54);
  });

  it("applies VAT to the DISCOUNTED subtotal, never the pre-discount price", async () => {
    stubSettings({ vatRate: 0.14, isVatEnabled: true });
    stubVariants([
      variantRow({ id: "v1", price: 100, variantPromos: [livePromo({ value: 10 })] }),
    ]);

    const res = await placeOrder(payload({ items: [{ variantId: "v1", quantity: 2 }] }));
    expect(res.success).toBe(true);
    const data = persistedOrder();

    expect(data.subtotal).toBe(180); // 90 × 2, on the discounted unit price
    // VAT is 180 × 0.14 = 25.20, NOT the pre-discount 200 × 0.14 = 28.00.
    const vat = roundMoney(data.totalAmount - data.subtotal - data.deliveryFee);
    expect(vat).toBe(25.2);
    expect(vat).not.toBe(28);
    expect(data.totalAmount).toBe(205.2); // 180 + 0 (pickup) + 25.20
  });

  it("rounds the accumulated subtotal once, absorbing binary-float drift", async () => {
    stubSettings({ isVatEnabled: false }); // isolate the subtotal step
    stubVariants([variantRow({ id: "v1", price: 10.1 }), variantRow({ id: "v2", price: 20.2 })]);

    const res = await placeOrder(
      payload({
        items: [
          { variantId: "v1", quantity: 1 },
          { variantId: "v2", quantity: 1 },
        ],
      }),
    );
    expect(res.success).toBe(true);
    const data = persistedOrder();
    expect(data.subtotal).toBe(30.3); // not 30.299999999999997
    expect(data.totalAmount).toBe(30.3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Delivery-fee resolution — the branch's four hats
// ─────────────────────────────────────────────────────────────────────────────

describe("placeOrder — delivery fee resolution", () => {
  it("DELIVERY routes to the selected ACTIVE branch's own fee", async () => {
    stubSettings({ isVatEnabled: false });
    mockPrisma.branch.findFirst.mockResolvedValue({ id: "b1", deliveryFee: decimalLike(40) } as never);

    const res = await placeOrder(
      payload({ fulfillment: FulfillmentMethod.DELIVERY, addressLine: "Menouf", branchId: "b1" }),
    );
    expect(res.success).toBe(true);
    const data = persistedOrder();
    expect(data.deliveryFee).toBe(40);
    expect(data.branchId).toBe("b1");
    // Only ever resolves a REAL, ACTIVE branch.
    expect(mockPrisma.branch.findFirst).toHaveBeenCalledWith({
      where: { id: "b1", isActive: true },
      select: { id: true, deliveryFee: true },
    });
  });

  it("DELIVERY with no branch ('Other Areas') falls back to the store default fee", async () => {
    stubSettings({ isVatEnabled: false, defaultDeliveryFee: 35 });
    const res = await placeOrder(
      payload({ fulfillment: FulfillmentMethod.DELIVERY, addressLine: "Somewhere far", branchId: null }),
    );
    expect(res.success).toBe(true);
    const data = persistedOrder();
    expect(data.deliveryFee).toBe(35);
    expect(data.branchId).toBeNull();
    expect(mockPrisma.branch.findFirst).not.toHaveBeenCalled();
  });

  it("DELIVERY to an inactive/missing branch falls back to default AND unassigns the order", async () => {
    stubSettings({ isVatEnabled: false, defaultDeliveryFee: 35 });
    mockPrisma.branch.findFirst.mockResolvedValue(null); // went inactive mid-checkout

    const res = await placeOrder(
      payload({ fulfillment: FulfillmentMethod.DELIVERY, addressLine: "Menouf", branchId: "b-stale" }),
    );
    expect(res.success).toBe(true);
    const data = persistedOrder();
    expect(data.deliveryFee).toBe(35); // default, never a crash
    expect(data.branchId).toBeNull(); // surfaces to the Super Admin
    expect(mockPrisma.branch.findFirst).toHaveBeenCalledWith({
      where: { id: "b-stale", isActive: true },
      select: { id: true, deliveryFee: true },
    });
  });

  it("PICKUP is always free, even when the branch carries a delivery fee", async () => {
    stubSettings({ isVatEnabled: false });
    mockPrisma.branch.findFirst.mockResolvedValue({ id: "b1", deliveryFee: decimalLike(50) } as never);

    const res = await placeOrder(payload({ fulfillment: FulfillmentMethod.PICKUP, branchId: "b1" }));
    expect(res.success).toBe(true);
    const data = persistedOrder();
    expect(data.deliveryFee).toBe(0); // pickup → no fee…
    expect(data.branchId).toBe("b1"); // …but the pickup branch is still recorded
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. VAT toggle
// ─────────────────────────────────────────────────────────────────────────────

describe("placeOrder — VAT toggle", () => {
  it("VAT enabled → tax is included and reconciles as a residual", async () => {
    stubSettings({ vatRate: 0.14, isVatEnabled: true });
    stubVariants([variantRow({ id: "v1", price: 100 })]);

    const res = await placeOrder(payload({ items: [{ variantId: "v1", quantity: 1 }] }));
    expect(res.success).toBe(true);
    const data = persistedOrder();
    expect(data.subtotal).toBe(100);
    expect(data.totalAmount).toBe(114); // 100 + 0 + 14
    expect(roundMoney(data.totalAmount - data.subtotal - data.deliveryFee)).toBe(14);
  });

  it("VAT disabled → no tax; total is subtotal + delivery only", async () => {
    stubSettings({ isVatEnabled: false });
    stubVariants([variantRow({ id: "v1", price: 100 })]);

    const res = await placeOrder(
      payload({ fulfillment: FulfillmentMethod.DELIVERY, addressLine: "Menouf", branchId: null }),
    );
    expect(res.success).toBe(true);
    const data = persistedOrder();
    expect(data.totalAmount).toBe(135); // 100 + 35 (default fee) + 0 VAT
    expect(roundMoney(data.totalAmount - data.subtotal - data.deliveryFee)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Identity, snapshots & side effects
// ─────────────────────────────────────────────────────────────────────────────

describe("placeOrder — identity, snapshot & revalidation", () => {
  it("guest checkout persists userId: null and does NOT revalidate /my-orders", async () => {
    mockedSession.mockResolvedValue(null);
    const res = await placeOrder(payload());
    expect(res.success).toBe(true);
    expect(persistedOrder().userId).toBeNull();
    expect(mockedRevalidate).toHaveBeenCalledWith("/admin");
    expect(mockedRevalidate).toHaveBeenCalledWith("/admin/orders");
    expect(mockedRevalidate).not.toHaveBeenCalledWith("/my-orders");
  });

  it("logged-in checkout stamps the session userId and revalidates /my-orders", async () => {
    mockedSession.mockResolvedValue({ user: { id: "user_42" } } as never);
    const res = await placeOrder(payload());
    expect(res.success).toBe(true);
    expect(persistedOrder().userId).toBe("user_42");
    expect(mockedRevalidate).toHaveBeenCalledWith("/my-orders");
  });

  it("returns the created order number and id on success", async () => {
    mockPrisma.order.create.mockResolvedValue({ id: "order_9", orderNumber: 2050 } as never);
    const res = await placeOrder(payload());
    expect(res).toEqual({ success: true, orderNumber: 2050, orderId: "order_9" });
  });

  it("persists status PENDING and an immutable line snapshot (name/variant/price)", async () => {
    stubVariants([
      variantRow({ id: "v1", price: 100, name: "Medium", productName: "Om Ali" }),
    ]);
    const res = await placeOrder(payload({ items: [{ variantId: "v1", quantity: 3 }] }));
    expect(res.success).toBe(true);
    const data = persistedOrder();

    expect(data.status).toBe(OrderStatus.PENDING);
    expect(data.customerName).toBe("Mostafa Ali");
    expect(data.customerPhone).toBe("01000000000");
    expect(data.items.create).toEqual([
      { variantId: "v1", productName: "Om Ali", variantName: "Medium", unitPrice: 100, quantity: 3 },
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// updateOrderStatus — Structural RBAC & branch isolation
//
// The lifecycle-advance action. RBAC here is STRUCTURAL, not cosmetic: the
// caller's role + branch are re-derived LIVE via requireDashboardAccess (which
// reads the DB, not the token) and re-enforced on every call — sidebar
// link-hiding is decoration; THIS is the gate (@rules/backend.md). We stub
// requireDashboardAccess to project each identity, then prove the action's own
// enforcement holds:
//   • ADMIN   → may advance ANY order; the branch gate is never even consulted.
//   • MANAGER → pinned to their branch; another branch — or an unassigned (null)
//     order — is a hard Unauthorized with NO write (cross-branch leak guard).
//   • status is re-validated against the real OrderStatus enum.
//   • a successful write fans out revalidation to the admin surfaces only.
// ═════════════════════════════════════════════════════════════════════════════

const ADMIN: DashboardScope = { userId: "admin_1", role: "ADMIN" };
const CAIRO_MANAGER: DashboardScope = { userId: "mgr_1", role: "MANAGER", branchId: "branch_cairo" };

describe("updateOrderStatus — authentication & input gates", () => {
  it("rejects a caller who is neither ADMIN nor MANAGER (requireDashboardAccess throws)", async () => {
    mockedDashboardAccess.mockRejectedValue(new Error("Unauthorized: authentication required."));
    const res = await updateOrderStatus("order_1", OrderStatus.PREPARING);
    expect(res).toEqual({ success: false, error: "Unauthorized." });
    expect(mockPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });

  it("rejects a missing order id before any write", async () => {
    mockedDashboardAccess.mockResolvedValue(ADMIN);
    const res = await updateOrderStatus("", OrderStatus.PREPARING);
    expect(res).toEqual({ success: false, error: "Missing order id." });
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });
});

describe("updateOrderStatus — status validation (real enum allow-list)", () => {
  it("rejects an arbitrary/injected status string", async () => {
    mockedDashboardAccess.mockResolvedValue(ADMIN);
    const res = await updateOrderStatus("order_1", "DROP TABLE orders" as OrderStatus);
    expect(res).toEqual({ success: false, error: "Invalid order status." });
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });

  it("rejects a wrong-case near-miss — the allow-list is EXACT", async () => {
    mockedDashboardAccess.mockResolvedValue(ADMIN);
    const res = await updateOrderStatus("order_1", "delivered" as OrderStatus);
    expect(res).toEqual({ success: false, error: "Invalid order status." });
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });

  // Parametrized over the REAL enum: proves every legitimate member is accepted
  // and that the guard's allow-list is literally `Object.values(OrderStatus)`.
  it.each(Object.values(OrderStatus))("accepts the real status %s", async (status) => {
    mockedDashboardAccess.mockResolvedValue(ADMIN);
    const res = await updateOrderStatus("order_1", status);
    expect(res).toEqual({ success: true });
    expect(mockPrisma.order.update).toHaveBeenCalledWith({
      where: { id: "order_1" },
      data: { status },
      select: { id: true },
    });
  });
});

describe("updateOrderStatus — ADMIN super-admin power", () => {
  it("updates an order WITHOUT consulting the branch gate (branch is irrelevant to an admin)", async () => {
    mockedDashboardAccess.mockResolvedValue(ADMIN);
    const res = await updateOrderStatus("order_1", OrderStatus.DELIVERED);
    expect(res).toEqual({ success: true });
    // The branch-ownership read is MANAGER-only. An admin never inspects the
    // order's branch, so no branch value — assigned or null — can gate them.
    expect(mockPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.order.update).toHaveBeenCalledWith({
      where: { id: "order_1" },
      data: { status: OrderStatus.DELIVERED },
      select: { id: true },
    });
  });

  it("updates an UNASSIGNED (branchId: null) order all the same", async () => {
    mockedDashboardAccess.mockResolvedValue(ADMIN);
    const res = await updateOrderStatus("order_unassigned", OrderStatus.CANCELLED);
    expect(res).toEqual({ success: true });
    expect(mockPrisma.order.findUnique).not.toHaveBeenCalled(); // proof: branch never checked
    expect(mockPrisma.order.update).toHaveBeenCalledTimes(1);
  });
});

describe("updateOrderStatus — MANAGER branch lock (cross-branch data-leak protection)", () => {
  it("allows a manager to update an order in their OWN branch", async () => {
    mockedDashboardAccess.mockResolvedValue(CAIRO_MANAGER);
    mockPrisma.order.findUnique.mockResolvedValue({ branchId: "branch_cairo" } as never);

    const res = await updateOrderStatus("order_1", OrderStatus.SHIPPED);
    expect(res).toEqual({ success: true });
    expect(mockPrisma.order.findUnique).toHaveBeenCalledWith({
      where: { id: "order_1" },
      select: { branchId: true },
    });
    expect(mockPrisma.order.update).toHaveBeenCalledTimes(1);
  });

  it("REJECTS a manager updating ANOTHER branch's order — and performs NO write", async () => {
    mockedDashboardAccess.mockResolvedValue(CAIRO_MANAGER);
    mockPrisma.order.findUnique.mockResolvedValue({ branchId: "branch_alexandria" } as never);

    const res = await updateOrderStatus("order_1", OrderStatus.DELIVERED);
    expect(res).toEqual({
      success: false,
      error: "Unauthorized: that order belongs to another branch.",
    });
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });

  it("REJECTS a manager updating an UNASSIGNED (null) order — and performs NO write", async () => {
    mockedDashboardAccess.mockResolvedValue(CAIRO_MANAGER);
    mockPrisma.order.findUnique.mockResolvedValue({ branchId: null } as never);

    const res = await updateOrderStatus("order_1", OrderStatus.DELIVERED);
    expect(res).toEqual({
      success: false,
      error: "Unauthorized: that order belongs to another branch.",
    });
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });

  it("returns 'no longer exists' when the manager's target order is gone", async () => {
    mockedDashboardAccess.mockResolvedValue(CAIRO_MANAGER);
    mockPrisma.order.findUnique.mockResolvedValue(null);

    const res = await updateOrderStatus("ghost", OrderStatus.DELIVERED);
    expect(res).toEqual({ success: false, error: "That order no longer exists." });
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
  });
});

describe("updateOrderStatus — cache fan-out revalidation", () => {
  it("revalidates exactly the admin surfaces (/admin/orders + /admin) on success", async () => {
    mockedDashboardAccess.mockResolvedValue(ADMIN);
    await updateOrderStatus("order_1", OrderStatus.DELIVERED);
    expect(mockedRevalidate).toHaveBeenCalledWith("/admin/orders");
    expect(mockedRevalidate).toHaveBeenCalledWith("/admin");
    expect(mockedRevalidate).toHaveBeenCalledTimes(2);
  });

  it("does NOT revalidate /my-orders — that page is force-dynamic, so it self-refreshes", async () => {
    // Unlike placeOrder, updateOrderStatus deliberately omits /my-orders: the
    // customer page src/app/(shop)/my-orders/page.tsx declares
    // `export const dynamic = "force-dynamic"`, so it re-queries the live DB on
    // every visit and can never serve a stale status. Asserting the ABSENCE
    // documents that intent and guards against a needless revalidate creeping in.
    mockedDashboardAccess.mockResolvedValue(ADMIN);
    await updateOrderStatus("order_1", OrderStatus.DELIVERED);
    expect(mockedRevalidate).not.toHaveBeenCalledWith("/my-orders");
  });

  it("does NOT revalidate anything when the update is rejected (manager cross-branch)", async () => {
    mockedDashboardAccess.mockResolvedValue(CAIRO_MANAGER);
    mockPrisma.order.findUnique.mockResolvedValue({ branchId: "branch_alexandria" } as never);
    await updateOrderStatus("order_1", OrderStatus.DELIVERED);
    expect(mockedRevalidate).not.toHaveBeenCalled();
  });
});

describe("updateOrderStatus — concurrent deletion (P2025)", () => {
  it("translates a P2025 (order deleted mid-update) into a friendly message", async () => {
    // Let the DB own the invariant: no racy pre-check — the caught P2025 IS the
    // "order vanished between the gate and the write" path (@rules/database.md).
    mockedDashboardAccess.mockResolvedValue(ADMIN);
    const notFound = Object.assign(new Error("Record to update not found."), { code: "P2025" });
    mockPrisma.order.update.mockRejectedValue(notFound);

    const res = await updateOrderStatus("order_1", OrderStatus.DELIVERED);
    expect(res).toEqual({ success: false, error: "That order no longer exists." });
  });
});
