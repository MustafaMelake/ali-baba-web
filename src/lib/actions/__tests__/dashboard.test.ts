// ─────────────────────────────────────────────────────────────────────────────
// Dashboard loaders — branch-manager RBAC (src/lib/actions/dashboard.ts).
//
// A MANAGER is pinned to their own branch: every ORDER query the dashboard and
// the orders board run must carry `{ branchId }` at the top level of its
// `where`, and asking for another branch must throw before anything is read.
// An ADMIN sees every branch, or one when they ask for it. Products and
// customers have no branch and stay store-wide for everyone.
//
// MOCKING — the real requireDashboardAccess + resolveBranchScope run (they ARE
// the RBAC under test); only their boundaries are mocked: Better Auth's session
// read (@/lib/auth), next/headers, and @/lib/prisma (deep-mocked), which also
// answers the live role/branch lookup.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

import { getDashboardStats, getOrders } from "@/lib/actions/dashboard";
import { auth } from "@/lib/auth";

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>;
const mockedGetSession = vi.mocked(auth.api.getSession);

// Prisma's `groupBy` is so heavily overloaded that its call signature hides the
// vitest-mock-extended mock methods from the type checker — same minimal view
// as analytics.test.ts (the runtime object is the real mock).
type MockView = { mockResolvedValue: (value: unknown) => MockView; mock: { calls: unknown[][] } };
const orderGroupBy = mockPrisma.order["groupBy"] as unknown as MockView;

const OWN_BRANCH = "branch_maadi";
const OTHER_BRANCH = "branch_zamalek";

/** Signed in, with this role/branch as the LIVE database row says. */
function signedInAs(role: "USER" | "ADMIN" | "MANAGER", branchId: string | null = null) {
  mockedGetSession.mockResolvedValue({ user: { id: "staff_1", role } } as never);
  mockPrisma.user.findUnique.mockResolvedValue({ role, branchId } as never);
}

/** The `where` of every order query the loader ran. */
function orderWheres() {
  return [
    ...mockPrisma.order.aggregate.mock.calls,
    ...mockPrisma.order.count.mock.calls,
    ...mockPrisma.order.findMany.mock.calls,
    ...orderGroupBy.mock.calls,
  ].map(([args]) => (args as { where?: Record<string, unknown> }).where ?? {});
}

function orderQueryCount() {
  return orderWheres().length + mockPrisma.$queryRaw.mock.calls.length;
}

beforeEach(() => {
  mockReset(mockPrisma);
  mockedGetSession.mockReset();

  mockPrisma.order.aggregate.mockResolvedValue({ _sum: { totalAmount: null } } as never);
  mockPrisma.order.count.mockResolvedValue(0);
  mockPrisma.order.findMany.mockResolvedValue([]);
  orderGroupBy.mockResolvedValue([]);
  mockPrisma.product.count.mockResolvedValue(0);
  mockPrisma.user.count.mockResolvedValue(0);
  mockPrisma.branch.findUnique.mockResolvedValue({ name: "Maadi" } as never);
});

describe("getDashboardStats — MANAGER", () => {
  it("scopes every order and revenue query to the manager's own branch", async () => {
    signedInAs("MANAGER", OWN_BRANCH);

    const stats = await getDashboardStats();

    const wheres = orderWheres();
    expect(wheres).toHaveLength(7); // 3 revenue sums, 2 volume counts, recent + chart
    for (const where of wheres) expect(where.branchId).toBe(OWN_BRANCH);
    expect(stats.scope).toEqual({ role: "MANAGER", branchId: OWN_BRANCH, branchName: "Maadi" });
  });

  it("accepts the manager's own branch when asked for it explicitly", async () => {
    signedInAs("MANAGER", OWN_BRANCH);

    await getDashboardStats({ branchId: OWN_BRANCH });

    for (const where of orderWheres()) expect(where.branchId).toBe(OWN_BRANCH);
  });

  it("refuses another branch before reading any order", async () => {
    signedInAs("MANAGER", OWN_BRANCH);

    await expect(getDashboardStats({ branchId: OTHER_BRANCH })).rejects.toThrow(/own branch/);
    expect(orderQueryCount()).toBe(0);
  });

  it("refuses a manager with no branch assigned", async () => {
    signedInAs("MANAGER", null);

    await expect(getDashboardStats()).rejects.toThrow(/no branch assigned/);
    expect(orderQueryCount()).toBe(0);
  });

  it("reads the role live, so a manager demoted since sign-in is refused", async () => {
    mockedGetSession.mockResolvedValue({ user: { id: "staff_1", role: "MANAGER" } } as never);
    mockPrisma.user.findUnique.mockResolvedValue({ role: "USER", branchId: null } as never);

    await expect(getDashboardStats()).rejects.toThrow(/ADMIN or MANAGER/);
    expect(orderQueryCount()).toBe(0);
  });
});

describe("getDashboardStats — ADMIN and everyone else", () => {
  it("leaves an ADMIN's order queries unscoped", async () => {
    signedInAs("ADMIN");

    const stats = await getDashboardStats();

    for (const where of orderWheres()) expect(where).not.toHaveProperty("branchId");
    expect(stats.scope).toEqual({ role: "ADMIN", branchId: null, branchName: null });
  });

  it("scopes an ADMIN to one branch when they ask for it", async () => {
    signedInAs("ADMIN");

    await getDashboardStats({ branchId: OTHER_BRANCH });

    for (const where of orderWheres()) expect(where.branchId).toBe(OTHER_BRANCH);
  });

  it("refuses a customer and a signed-out visitor", async () => {
    signedInAs("USER");
    await expect(getDashboardStats()).rejects.toThrow(/ADMIN or MANAGER/);

    mockedGetSession.mockResolvedValue(null);
    await expect(getDashboardStats()).rejects.toThrow(/authentication required/);
    expect(orderQueryCount()).toBe(0);
  });
});

describe("getOrders — MANAGER", () => {
  it("scopes the list and the tab counters to the manager's branch", async () => {
    signedInAs("MANAGER", OWN_BRANCH);

    await getOrders({ status: "PENDING" });

    const wheres = orderWheres();
    expect(wheres).toHaveLength(2); // the page + the per-status counters
    for (const where of wheres) expect(where.branchId).toBe(OWN_BRANCH);
  });

  it("keeps the branch scope on an order-number search that matches other branches", async () => {
    signedInAs("MANAGER", OWN_BRANCH);
    // The ::text search runs unscoped and may return another branch's order id…
    mockPrisma.$queryRaw.mockResolvedValue([{ id: "order_from_zamalek" }] as never);

    await getOrders({ query: "1002" });

    // …so the branch must still be ANDed at the top level of both queries.
    for (const where of orderWheres()) {
      expect(where.branchId).toBe(OWN_BRANCH);
      expect(where.OR).toContainEqual({ id: { in: ["order_from_zamalek"] } });
    }
  });

  it("refuses another branch before reading any order", async () => {
    signedInAs("MANAGER", OWN_BRANCH);

    await expect(getOrders({ branchId: OTHER_BRANCH })).rejects.toThrow(/own branch/);
    expect(orderQueryCount()).toBe(0);
  });
});
