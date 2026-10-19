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

import { getBranchStockIssues, setBranchStock } from "@/lib/actions/branch-stock";
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

  it("restocks with the same two statements (isAvailable: true)", async () => {
    const res = await setBranchStock({ variantIds: ["v1"], isAvailable: true });

    expect(res).toEqual({ success: true, updated: 1 });
    expect(writes().update.data).toEqual({ isAvailable: true });
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
// getBranchStockIssues — the checkout preview
// ─────────────────────────────────────────────────────────────────────────────

describe("getBranchStockIssues — checkout preview", () => {
  function stubOutRows(rows: { variantId: string; product: string; variant: string }[]) {
    mockPrisma.branchVariantAvailability.findMany.mockResolvedValue(
      rows.map((r) => ({
        variantId: r.variantId,
        variant: { name: r.variant, product: { name: r.product } },
      })) as never,
    );
  }

  it("flags each switched-off line with placeOrder's exact wording", async () => {
    mockPrisma.branch.findFirst.mockResolvedValue({ name: "Menouf" } as never);
    stubOutRows([{ variantId: "v2", product: "Kunafa", variant: "Small" }]);

    const res = await getBranchStockIssues(["v1", "v2"], "branch_menouf");

    expect(res).toEqual({
      success: true,
      issues: [
        { variantId: "v2", message: "Kunafa (Small) is currently out of stock at the Menouf branch." },
      ],
    });
  });

  it("asks only for branch stock-outs of globally-live items (global ones are placeOrder's 'no longer available')", async () => {
    mockPrisma.branch.findFirst.mockResolvedValue({ name: "Menouf" } as never);
    stubOutRows([]);

    await getBranchStockIssues([" v1 ", "v1", "v2"], "branch_menouf");

    expect(mockPrisma.branchVariantAvailability.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          branchId: "branch_menouf",
          variantId: { in: ["v1", "v2"] }, // trimmed + de-duplicated
          isAvailable: false,
          variant: { isAvailable: true, product: { isAvailable: true } },
        },
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
