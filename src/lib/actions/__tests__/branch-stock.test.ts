// ─────────────────────────────────────────────────────────────────────────────
// Branch stock — src/lib/actions/branch-stock.ts.
//
// The manager-facing write and the checkout's preview read. What's pinned:
//
//   • RBAC is structural: a MANAGER writes ONLY their own branch (live DB
//     scope via requireDashboardAccess + resolveBranchScope), a USER/anonymous
//     caller writes nothing, an ADMIN must name a branch.
//   • The write touches BranchVariantAvailability ONLY — never the product or
//     variant rows the admin owns.
//   • The preview mirrors placeOrder: inactive branch → nothing flagged, and
//     the message is placeOrder's own wording.
//
// MOCKING — @/lib/prisma deep-mocked, requireDashboardAccess stubbed, the REAL
// resolveBranchScope, validators and catalog helpers run.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));
vi.mock("@/lib/session", async (importOriginal) => {
  // Keep the pure resolveBranchScope real — it IS the branch lock under test.
  const actual = await importOriginal<typeof import("@/lib/session")>();
  return { ...actual, requireDashboardAccess: vi.fn(), requireAdmin: vi.fn() };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  clearSoldOutToday,
  getBranchStockIssues,
  markSoldOutToday,
  setBranchStock,
} from "@/lib/actions/branch-stock";
import { requireDashboardAccess, type DashboardScope } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { BRANCH_STOCK_MAX_VARIANTS } from "@/lib/validators";

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>;
const mockedAccess = vi.mocked(requireDashboardAccess);

const ADMIN: DashboardScope = { userId: "admin_1", role: "ADMIN" };
const MENOUF_MANAGER: DashboardScope = {
  userId: "mgr_1",
  role: "MANAGER",
  branchId: "branch_menouf",
};

vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  mockReset(mockPrisma);
  mockedAccess.mockReset();
  vi.mocked(revalidatePath).mockReset();
  mockPrisma.$transaction.mockResolvedValue([{ count: 1 }, { count: 1 }] as never);
});

/** The two statements handed to the batch transaction, in order. */
function writes() {
  return {
    create: mockPrisma.branchVariantAvailability.createMany.mock.calls[0]?.[0] as any,
    update: mockPrisma.branchVariantAvailability.updateMany.mock.calls[0]?.[0] as any,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// setBranchStock — authorization
// ─────────────────────────────────────────────────────────────────────────────

describe("setBranchStock — authorization", () => {
  it("refuses a non-staff caller and writes nothing", async () => {
    mockedAccess.mockRejectedValue(new Error("Forbidden"));

    const res = await setBranchStock({ variantIds: ["v1"], isAvailable: false });

    expect(res).toEqual({ success: false, error: "Unauthorized." });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("pins a MANAGER to their own branch when none is named", async () => {
    mockedAccess.mockResolvedValue(MENOUF_MANAGER);

    const res = await setBranchStock({ variantIds: ["v1"], isAvailable: false });

    expect(res).toEqual({ success: true, updated: 1 });
    expect(writes().update.where).toEqual({
      branchId: "branch_menouf",
      variantId: { in: ["v1"] },
    });
  });

  it("REFUSES a MANAGER naming another branch — and writes nothing", async () => {
    mockedAccess.mockResolvedValue(MENOUF_MANAGER);

    const res = await setBranchStock({
      branchId: "branch_sadat",
      variantIds: ["v1"],
      isAvailable: false,
    });

    expect(res).toEqual({
      success: false,
      error: "Unauthorized: you can only manage your own branch's stock.",
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.branchVariantAvailability.createMany).not.toHaveBeenCalled();
  });

  it("lets an ADMIN write any named branch", async () => {
    mockedAccess.mockResolvedValue(ADMIN);

    const res = await setBranchStock({
      branchId: "branch_sadat",
      variantIds: ["v1"],
      isAvailable: false,
    });

    expect(res.success).toBe(true);
    expect(writes().update.where.branchId).toBe("branch_sadat");
  });

  it("asks an ADMIN to pick a branch rather than writing 'all branches'", async () => {
    mockedAccess.mockResolvedValue(ADMIN);

    const res = await setBranchStock({ variantIds: ["v1"], isAvailable: false });

    expect(res).toEqual({ success: false, error: "Choose a branch first." });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setBranchStock — the write itself
// ─────────────────────────────────────────────────────────────────────────────

describe("setBranchStock — writes the branch override only", () => {
  beforeEach(() => mockedAccess.mockResolvedValue(MENOUF_MANAGER));

  it("inserts missing rows, then sets the flag on all of them — two statements for any number of variants", async () => {
    await setBranchStock({ variantIds: ["v1", "v2", "v3"], isAvailable: false });

    const { create, update } = writes();
    expect(create).toEqual({
      data: [
        { branchId: "branch_menouf", variantId: "v1", isAvailable: false },
        { branchId: "branch_menouf", variantId: "v2", isAvailable: false },
        { branchId: "branch_menouf", variantId: "v3", isAvailable: false },
      ],
      skipDuplicates: true,
    });
    expect(update).toEqual({
      where: { branchId: "branch_menouf", variantId: { in: ["v1", "v2", "v3"] } },
      data: { isAvailable: false },
    });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("never touches the admin-owned product or variant rows", async () => {
    await setBranchStock({ variantIds: ["v1"], isAvailable: false });

    expect(mockPrisma.product.update).not.toHaveBeenCalled();
    expect(mockPrisma.product.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.productVariant.update).not.toHaveBeenCalled();
    expect(mockPrisma.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it("restocks with the same two statements, clearing any stale sold-out-today mark", async () => {
    const res = await setBranchStock({ variantIds: ["v1"], isAvailable: true });

    expect(res).toEqual({ success: true, updated: 1 });
    expect(writes().update.data).toEqual({ isAvailable: true, soldOutUntil: null });
  });

  it("switching off long-term leaves soldOutUntil untouched (it's moot anyway)", async () => {
    await setBranchStock({ variantIds: ["v1"], isAvailable: false });
    expect(writes().update.data).toEqual({ isAvailable: false });
  });

  it("revalidates the inventory console", async () => {
    await setBranchStock({ variantIds: ["v1"], isAvailable: false });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/inventory");
  });

  it("translates a P2003 (variant or branch deleted meanwhile) into a user-facing message", async () => {
    mockPrisma.$transaction.mockRejectedValue(Object.assign(new Error("fk"), { code: "P2003" }));

    const res = await setBranchStock({ variantIds: ["v1"], isAvailable: false });

    expect(res).toEqual({
      success: false,
      error: "That branch or item no longer exists. Refresh and try again.",
    });
  });

  it("falls back to a generic message for anything else", async () => {
    mockPrisma.$transaction.mockRejectedValue(new Error("connection reset"));

    const res = await setBranchStock({ variantIds: ["v1"], isAvailable: false });

    expect(res).toEqual({ success: false, error: "Could not update branch stock." });
  });
});

describe("setBranchStock — payload validation", () => {
  beforeEach(() => mockedAccess.mockResolvedValue(MENOUF_MANAGER));

  it.each([
    ["no variants", { variantIds: [], isAvailable: false }, "Pick at least one item."],
    ["a duplicated variant", { variantIds: ["v1", "v1"], isAvailable: false }, "Each item may appear only once."],
    [
      "too many variants",
      {
        variantIds: Array.from({ length: BRANCH_STOCK_MAX_VARIANTS + 1 }, (_, i) => `v${i}`),
        isAvailable: false,
      },
      "Too many items in one change.",
    ],
    ["a non-boolean flag", { variantIds: ["v1"], isAvailable: "no" }, "Choose in stock or out of stock."],
  ])("rejects %s before any write", async (_label, input, error) => {
    const res = await setBranchStock(input as never);

    expect(res).toEqual({ success: false, error });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// markSoldOutToday / clearSoldOutToday — MANAGER-only, self-expiring, own branch
// ─────────────────────────────────────────────────────────────────────────────

describe("markSoldOutToday / clearSoldOutToday — authorization", () => {
  it("refuses a non-staff caller and writes nothing", async () => {
    mockedAccess.mockRejectedValue(new Error("Forbidden"));

    expect(await markSoldOutToday({ productId: "p1" })).toEqual({
      success: false,
      error: "Unauthorized.",
    });
    expect(mockPrisma.productVariant.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses an ADMIN — this is a MANAGER-only action — and writes nothing", async () => {
    mockedAccess.mockResolvedValue(ADMIN);

    expect(await markSoldOutToday({ variantId: "v1" })).toEqual({
      success: false,
      error: "Only branch managers can set today's stock.",
    });
    expect(mockPrisma.productVariant.findMany).not.toHaveBeenCalled();
  });
});

describe("markSoldOutToday — the write", () => {
  beforeEach(() => {
    mockedAccess.mockResolvedValue(MENOUF_MANAGER);
    mockPrisma.productVariant.findMany.mockResolvedValue([{ id: "v1" }] as never);
  });

  it("marks EVERY available size of a product, at the manager's OWN branch, until the next Cairo midnight", async () => {
    mockPrisma.productVariant.findMany.mockResolvedValue([{ id: "v1" }, { id: "v2" }] as never);

    const res = await markSoldOutToday({ productId: "p1" });

    expect(res).toEqual({ success: true, updated: 2 });
    // Resolved to the product's AVAILABLE variants only.
    expect(mockPrisma.productVariant.findMany).toHaveBeenCalledWith({
      where: { productId: "p1", isAvailable: true },
      select: { id: true },
    });
    const { create, update } = writes();
    // Branch is the scope's own — nothing from the payload.
    expect(create.data).toEqual([
      { branchId: "branch_menouf", variantId: "v1", soldOutUntil: expect.any(Date) },
      { branchId: "branch_menouf", variantId: "v2", soldOutUntil: expect.any(Date) },
    ]);
    expect(create.skipDuplicates).toBe(true);
    expect(update.where).toEqual({ branchId: "branch_menouf", variantId: { in: ["v1", "v2"] } });
    // A real future instant (tomorrow's Cairo midnight), never isAvailable.
    expect(update.data.soldOutUntil).toBeInstanceOf(Date);
    expect(update.data.soldOutUntil.getTime()).toBeGreaterThan(Date.now());
    expect(update.data).not.toHaveProperty("isAvailable");
  });

  it("IGNORES a forged branchId in the payload — always writes the manager's own branch", async () => {
    mockPrisma.productVariant.findMany.mockResolvedValue([{ id: "v1" }] as never);

    // soldOutTodaySchema has no branchId field, so Zod strips it; the branch is
    // the live scope's. A manager cannot reach another branch this way.
    const res = await markSoldOutToday({ productId: "p1", branchId: "branch_sadat" } as never);

    expect(res).toEqual({ success: true, updated: 1 });
    expect(writes().create.data[0].branchId).toBe("branch_menouf");
    expect(writes().update.where.branchId).toBe("branch_menouf");
  });

  it("marks a single named size", async () => {
    mockPrisma.productVariant.findMany.mockResolvedValue([{ id: "v2" }] as never);

    const res = await markSoldOutToday({ variantId: "v2" });

    expect(res).toEqual({ success: true, updated: 1 });
    expect(mockPrisma.productVariant.findMany).toHaveBeenCalledWith({
      where: { id: "v2", isAvailable: true },
      select: { id: true },
    });
  });

  it("reports a vanished product / unavailable size instead of writing", async () => {
    mockPrisma.productVariant.findMany.mockResolvedValue([] as never);

    expect(await markSoldOutToday({ productId: "p_gone" })).toEqual({
      success: false,
      error: "That product no longer exists.",
    });
    expect(await markSoldOutToday({ variantId: "v_gone" })).toEqual({
      success: false,
      error: "That item is no longer available.",
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("revalidates the manager page and the admin inventory view", async () => {
    await markSoldOutToday({ productId: "p1" });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/today");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/inventory");
  });

  it.each([
    ["both product and size", { productId: "p1", variantId: "v1" }],
    ["neither", {}],
  ])("rejects a payload naming %s before any write", async (_label, input) => {
    const res = await markSoldOutToday(input as never);
    expect(res).toEqual({
      success: false,
      error: "Choose a product or a single size, not both.",
    });
    expect(mockPrisma.productVariant.findMany).not.toHaveBeenCalled();
  });

  it("translates a P2003 (variant or branch deleted meanwhile) into a user-facing message", async () => {
    mockPrisma.$transaction.mockRejectedValue(Object.assign(new Error("fk"), { code: "P2003" }));

    expect(await markSoldOutToday({ productId: "p1" })).toEqual({
      success: false,
      error: "That branch or item no longer exists. Refresh and try again.",
    });
  });
});

describe("clearSoldOutToday — bring it back now", () => {
  beforeEach(() => {
    mockedAccess.mockResolvedValue(MENOUF_MANAGER);
    mockPrisma.productVariant.findMany.mockResolvedValue([{ id: "v1" }, { id: "v2" }] as never);
    mockPrisma.branchVariantAvailability.updateMany.mockResolvedValue({ count: 2 } as never);
  });

  it("clears soldOutUntil for the product's sizes at the manager's branch, with ONE statement and no insert", async () => {
    const res = await clearSoldOutToday({ productId: "p1" });

    expect(res).toEqual({ success: true, updated: 2 });
    expect(mockPrisma.branchVariantAvailability.createMany).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    const call = mockPrisma.branchVariantAvailability.updateMany.mock.calls[0][0] as any;
    expect(call).toEqual({
      where: { branchId: "branch_menouf", variantId: { in: ["v1", "v2"] } },
      data: { soldOutUntil: null },
    });
    // Never resurrects a head-office-off size.
    expect(call.data).not.toHaveProperty("isAvailable");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getBranchStockIssues — the checkout preview
// ─────────────────────────────────────────────────────────────────────────────

describe("getBranchStockIssues — checkout preview", () => {
  const FAR_FUTURE = new Date("2999-01-01T00:00:00.000Z"); // always ahead of `now`
  const PAST = new Date("2000-01-01T00:00:00.000Z");

  function stubOutRows(
    rows: {
      variantId: string;
      product: string;
      variant: string;
      isAvailable?: boolean;
      soldOutUntil?: Date | null;
    }[],
  ) {
    mockPrisma.branchVariantAvailability.findMany.mockResolvedValue(
      rows.map((r) => ({
        variantId: r.variantId,
        isAvailable: r.isAvailable ?? false,
        soldOutUntil: r.soldOutUntil ?? null,
        variant: { name: r.variant, product: { name: r.product } },
      })) as never,
    );
  }

  it("flags each switched-off line with placeOrder's exact wording", async () => {
    mockPrisma.branch.findFirst.mockResolvedValue({ name: "Menouf" } as never);
    stubOutRows([{ variantId: "v2", product: "Kunafa", variant: "Small", isAvailable: false }]);

    const res = await getBranchStockIssues(["v1", "v2"], "branch_menouf");

    expect(res).toEqual({
      success: true,
      issues: [
        { variantId: "v2", message: "Kunafa (Small) is currently out of stock at the Menouf branch." },
      ],
    });
  });

  it("flags a sold-out-today line with the 'today' wording, distinct from a long-term stock-out", async () => {
    mockPrisma.branch.findFirst.mockResolvedValue({ name: "Menouf" } as never);
    stubOutRows([
      { variantId: "v2", product: "Kunafa", variant: "Small", isAvailable: true, soldOutUntil: FAR_FUTURE },
    ]);

    const res = await getBranchStockIssues(["v2"], "branch_menouf");

    expect(res).toEqual({
      success: true,
      issues: [
        { variantId: "v2", message: "Kunafa (Small) is sold out at the Menouf branch today." },
      ],
    });
  });

  it("treats a long-term-off row with a stale mark as a plain stock-out", async () => {
    mockPrisma.branch.findFirst.mockResolvedValue({ name: "Menouf" } as never);
    stubOutRows([
      { variantId: "v2", product: "Kunafa", variant: "Small", isAvailable: false, soldOutUntil: PAST },
    ]);

    const res = await getBranchStockIssues(["v2"], "branch_menouf");

    expect(res.success && res.issues[0]?.message).toBe(
      "Kunafa (Small) is currently out of stock at the Menouf branch.",
    );
  });

  it("asks only for branch stock-outs or sold-out-today of globally-live items", async () => {
    mockPrisma.branch.findFirst.mockResolvedValue({ name: "Menouf" } as never);
    stubOutRows([]);

    await getBranchStockIssues([" v1 ", "v1", "v2"], "branch_menouf");

    expect(mockPrisma.branchVariantAvailability.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          branchId: "branch_menouf",
          variantId: { in: ["v1", "v2"] }, // trimmed + de-duplicated
          OR: [{ isAvailable: false }, { soldOutUntil: { gt: expect.any(Date) } }],
          variant: { isAvailable: true, product: { isAvailable: true } },
        }),
      }),
    );
  });

  it("flags nothing for an inactive / unknown branch — placeOrder treats it as unassigned", async () => {
    mockPrisma.branch.findFirst.mockResolvedValue(null);
    stubOutRows([{ variantId: "v2", product: "Kunafa", variant: "Small" }]);

    const res = await getBranchStockIssues(["v2"], "branch_closed");

    expect(res).toEqual({ success: true, issues: [] });
  });

  it("short-circuits with no database work for 'Other Areas' (null) or an empty cart", async () => {
    expect(await getBranchStockIssues(["v1"], null)).toEqual({ success: true, issues: [] });
    expect(await getBranchStockIssues([], "branch_menouf")).toEqual({ success: true, issues: [] });
    expect(mockPrisma.branch.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.branchVariantAvailability.findMany).not.toHaveBeenCalled();
  });

  it("reports a failed read as an error envelope, never a throw", async () => {
    mockPrisma.branch.findFirst.mockRejectedValue(new Error("connection reset"));
    stubOutRows([]);

    const res = await getBranchStockIssues(["v1"], "branch_menouf");

    expect(res).toEqual({ success: false, error: "Could not check branch stock." });
  });
});
