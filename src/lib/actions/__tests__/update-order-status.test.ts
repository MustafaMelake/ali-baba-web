// ─────────────────────────────────────────────────────────────────────────────
// updateOrderStatus — structural RBAC, the lifecycle graph, and the audit trail
// (audit M-3).
//
// RBAC is STRUCTURAL: role + branch are re-derived live (requireDashboardAccess)
// and re-enforced on every call. On top of that, every change must be one step
// of ORDER_STATUS_TRANSITIONS; the write is CONDITIONAL on the status (and, for
// a MANAGER, the branch) just read, and stamps statusChangedAt / ById.
// Boundary mocks only: Prisma, the session reader, next/cache.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));
vi.mock("@/lib/session", () => ({ getServerSession: vi.fn(), requireDashboardAccess: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateOrderStatus } from "@/lib/actions/orders";
import { prisma } from "@/lib/prisma";
import { requireDashboardAccess, type DashboardScope } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { FulfillmentMethod, OrderStatus } from "@/generated/prisma/enums";

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>;
const mockedAccess = vi.mocked(requireDashboardAccess);
const mockedRevalidate = vi.mocked(revalidatePath);
vi.spyOn(console, "error").mockImplementation(() => {});

const ADMIN: DashboardScope = { userId: "admin_1", role: "ADMIN" };
const CAIRO_MANAGER: DashboardScope = { userId: "mgr_1", role: "MANAGER", branchId: "branch_cairo" };
const { PENDING, PREPARING, SHIPPED, DELIVERED, CANCELLED } = OrderStatus;

function stubOrder(o: Partial<{ status: OrderStatus; branchId: string | null; fulfillment: FulfillmentMethod }> = {}) {
  mockPrisma.order.findUnique.mockResolvedValue({
    status: o.status ?? PENDING,
    branchId: o.branchId === undefined ? "branch_cairo" : o.branchId,
    fulfillment: o.fulfillment ?? FulfillmentMethod.DELIVERY,
  } as never);
}

beforeEach(() => {
  mockReset(mockPrisma);
  mockedAccess.mockReset();
  mockedRevalidate.mockReset();
  mockedAccess.mockResolvedValue(ADMIN);
  mockPrisma.order.updateMany.mockResolvedValue({ count: 1 } as never);
  stubOrder();
});

describe("gates", () => {
  it("refuses a caller who isn't ADMIN/MANAGER before reading anything", async () => {
    mockedAccess.mockRejectedValue(new Error("Unauthorized"));
    expect(await updateOrderStatus("o1", PREPARING)).toEqual({ success: false, error: "Unauthorized." });
    expect(mockPrisma.order.findUnique).not.toHaveBeenCalled();
  });

  it("refuses a missing id and a non-enum status before reading anything", async () => {
    expect(await updateOrderStatus("", PREPARING)).toEqual({ success: false, error: "Missing order id." });
    expect(await updateOrderStatus("o1", "shipped" as OrderStatus)).toEqual({
      success: false,
      error: "Invalid order status.",
    });
    expect(mockPrisma.order.findUnique).not.toHaveBeenCalled();
  });

  it("reports a deleted order", async () => {
    mockPrisma.order.findUnique.mockResolvedValue(null);
    expect(await updateOrderStatus("o1", PREPARING)).toEqual({
      success: false,
      error: "That order no longer exists.",
    });
  });

  it("a database failure is an envelope, never a throw", async () => {
    mockPrisma.order.findUnique.mockRejectedValue(new Error("connection reset"));
    expect(await updateOrderStatus("o1", PREPARING)).toEqual({
      success: false,
      error: "Could not update the order status.",
    });
  });
});

describe("allowed steps write conditionally and stamp who + when", () => {
  it("PENDING → PREPARING (ADMIN): conditional on the read status, stamps the caller", async () => {
    const before = Date.now();
    expect(await updateOrderStatus("o1", PREPARING)).toEqual({ success: true });

    const args = mockPrisma.order.updateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: { status: string; statusChangedAt: Date; statusChangedById: string };
    };
    expect(args.where).toEqual({ id: "o1", status: PENDING });
    expect(args.data.status).toBe(PREPARING);
    expect(args.data.statusChangedById).toBe("admin_1");
    expect(args.data.statusChangedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(mockedRevalidate).toHaveBeenCalledWith("/admin/orders");
    expect(mockedRevalidate).toHaveBeenCalledWith("/admin");
  });

  it.each([
    [FulfillmentMethod.DELIVERY, PREPARING, SHIPPED],
    [FulfillmentMethod.DELIVERY, SHIPPED, DELIVERED],
    [FulfillmentMethod.DELIVERY, SHIPPED, CANCELLED],
    [FulfillmentMethod.PICKUP, PREPARING, DELIVERED],
    [FulfillmentMethod.PICKUP, PENDING, CANCELLED],
  ])("%s: %s → %s succeeds", async (fulfillment, from, to) => {
    stubOrder({ status: from, fulfillment });
    expect(await updateOrderStatus("o1", to)).toEqual({ success: true });
  });

  it("an ADMIN can move an UNASSIGNED order", async () => {
    stubOrder({ branchId: null });
    expect(await updateOrderStatus("o1", PREPARING)).toEqual({ success: true });
  });

  it("re-selecting the current status is a no-op success — no write, no stamp", async () => {
    stubOrder({ status: SHIPPED });
    expect(await updateOrderStatus("o1", SHIPPED)).toEqual({ success: true });
    expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
  });

  it("someone else changed it in between → refused, nothing overwritten", async () => {
    mockPrisma.order.updateMany.mockResolvedValue({ count: 0 } as never);
    expect(await updateOrderStatus("o1", PREPARING)).toEqual({
      success: false,
      error: "Someone else just updated this order. Refresh to see its current status.",
    });
    expect(mockedRevalidate).not.toHaveBeenCalled();
  });
});

describe("forbidden jumps — refused with a typed INVALID_TRANSITION, nothing written", () => {
  const SKIPS_TO_DELIVERED: [FulfillmentMethod, OrderStatus][] = [
    [FulfillmentMethod.DELIVERY, PENDING],
    [FulfillmentMethod.DELIVERY, PREPARING],
    [FulfillmentMethod.PICKUP, PENDING],
  ];
  it.each(SKIPS_TO_DELIVERED)("%s: %s → DELIVERED (skips steps)", async (fulfillment, from) => {
    stubOrder({ status: from, fulfillment });

    const res = await updateOrderStatus("o1", DELIVERED);

    expect(res).toMatchObject({ success: false, code: "INVALID_TRANSITION", from, to: DELIVERED });
    expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
  });

  it.each([PENDING, PREPARING, SHIPPED, CANCELLED])("DELIVERED → %s (DELIVERED is final)", async (to) => {
    stubOrder({ status: DELIVERED });

    const res = await updateOrderStatus("o1", to);

    expect(res).toMatchObject({ success: false, code: "INVALID_TRANSITION", from: DELIVERED, to });
    expect(!res.success && res.error).toContain("already Delivered");
    expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
  });

  it.each([PENDING, PREPARING, SHIPPED, DELIVERED])("CANCELLED → %s (CANCELLED is final)", async (to) => {
    stubOrder({ status: CANCELLED });
    expect(await updateOrderStatus("o1", to)).toMatchObject({ code: "INVALID_TRANSITION" });
    expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    [PENDING, SHIPPED],
    [SHIPPED, PREPARING],
    [SHIPPED, PENDING],
    [PREPARING, PENDING],
  ])("DELIVERY: %s → %s (skips or goes backwards)", async (from, to) => {
    stubOrder({ status: from });
    expect(await updateOrderStatus("o1", to)).toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("PICKUP: PREPARING → SHIPPED (a pickup is never shipped)", async () => {
    stubOrder({ status: PREPARING, fulfillment: FulfillmentMethod.PICKUP });
    expect(await updateOrderStatus("o1", SHIPPED)).toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("an ADMIN is held to the same graph", async () => {
    mockedAccess.mockResolvedValue(ADMIN);
    stubOrder({ status: DELIVERED });
    expect(await updateOrderStatus("o1", PENDING)).toMatchObject({ code: "INVALID_TRANSITION" });
  });
});

describe("MANAGER stays branch-scoped", () => {
  beforeEach(() => mockedAccess.mockResolvedValue(CAIRO_MANAGER));

  it("moves an order of their own branch — and the write is ALSO scoped to that branch", async () => {
    expect(await updateOrderStatus("o1", PREPARING)).toEqual({ success: true });
    expect(mockPrisma.order.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "o1", status: PENDING, branchId: "branch_cairo" },
      data: { statusChangedById: "mgr_1" },
    });
  });

  it.each([["branch_alex"], [null]])("refuses an order of branch %s before any graph check or write", async (branchId) => {
    stubOrder({ branchId });
    expect(await updateOrderStatus("o1", PREPARING)).toEqual({
      success: false,
      error: "Unauthorized: that order belongs to another branch.",
    });
    expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
  });

  it("a branch reassignment between read and write matches nothing → refused", async () => {
    mockPrisma.order.updateMany.mockResolvedValue({ count: 0 } as never);
    expect((await updateOrderStatus("o1", PREPARING)).success).toBe(false);
  });
});
