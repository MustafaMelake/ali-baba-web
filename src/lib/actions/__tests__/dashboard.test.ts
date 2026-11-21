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

import { getDashboardStats, getOrders, getVisitorFunnel } from "@/lib/actions/dashboard";
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

  it("an all-digit search is an EXACT order-number match — no raw SQL scan (audit M-6)", async () => {
    signedInAs("MANAGER", OWN_BRANCH);

    await getOrders({ query: "1002" });

    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    for (const where of orderWheres()) {
      expect(where.branchId).toBe(OWN_BRANCH); // still branch-scoped
      expect(where.OR).toContainEqual({ orderNumber: 1002 });
    }
  });

  it("accepts '#10024' as the exact order number too", async () => {
    signedInAs("ADMIN");

    await getOrders({ query: "#10024" });

    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    expect(orderWheres()[0].OR).toContainEqual({ orderNumber: 10024 });
  });

  it("a digit string longer than an INT can hold matches no order number (no overflow error)", async () => {
    signedInAs("ADMIN");

    await getOrders({ query: "201001234567" }); // a pasted phone, all digits

    const or = orderWheres()[0].OR as unknown[];
    expect(or.some((c) => (c as { orderNumber?: number }).orderNumber !== undefined)).toBe(false);
    expect(or).toContainEqual({ customerPhone: { contains: "1001234567" } }); // the phone match still runs
  });

  it("mixed text with digits keeps the partial match — branch-scoped IN the SQL and capped at 200 ids", async () => {
    signedInAs("MANAGER", OWN_BRANCH);
    mockPrisma.$queryRaw.mockResolvedValue([{ id: "order_7" }] as never);

    await getOrders({ query: "A10" });

    const [strings, ...values] = mockPrisma.$queryRaw.mock.calls[0] as unknown as [string[], ...unknown[]];
    const fragment = values[1] as { strings: string[]; values: unknown[] };
    expect(strings.join("?")).toMatch(/"orderNumber"::text ILIKE \?[\s\S]*LIMIT \?/);
    expect(values[0]).toBe("%A10%");
    expect(fragment.strings.join("?")).toContain('AND "branchId" = ?');
    expect(fragment.values).toEqual([OWN_BRANCH]);
    expect(values[2]).toBe(200);
    // …and the branch is still ANDed at the top level of both queries.
    for (const where of orderWheres()) {
      expect(where.branchId).toBe(OWN_BRANCH);
      expect(where.OR).toContainEqual({ id: { in: ["order_7"] } });
    }
  });

  it("refuses another branch before reading any order", async () => {
    signedInAs("MANAGER", OWN_BRANCH);

    await expect(getOrders({ branchId: OTHER_BRANCH })).rejects.toThrow(/own branch/);
    expect(orderQueryCount()).toBe(0);
  });
});

// ── Visitor funnel card ───────────────────────────────────────────────────────
// Same RBAC as the order loaders: the branch is spread at the top level of the
// VisitEvent read AND the order counts, and a foreign branch throws first.

/** Every raw-SQL VisitEvent read: its full text and all bound values (nested fragments flattened). */
function visitQueries() {
  type Sqlish = { strings?: readonly string[]; values?: unknown[] };
  const flatten = (v: unknown): { text: string; values: unknown[] } => {
    const sql = v as Sqlish;
    if (sql && typeof sql === "object" && Array.isArray(sql.values) && Array.isArray(sql.strings)) {
      const parts = sql.values.map(flatten);
      return {
        text: sql.strings.join("?") + parts.map((p) => p.text).join(" "),
        values: parts.flatMap((p) => p.values),
      };
    }
    return { text: "", values: [v] };
  };
  return mockPrisma.$queryRaw.mock.calls.map(([strings, ...values]) => {
    const parts = values.map(flatten);
    return {
      text: (strings as unknown as string[]).join("?") + parts.map((p) => p.text).join(" "),
      values: parts.flatMap((p) => p.values),
    };
  });
}

/** Stub the two rollups getVisitorFunnel runs: the window aggregates, then the per-day rows. */
function stubVisitRollups(window: Record<string, number>, daily: { day: string; visitors: number }[] = []) {
  mockPrisma.$queryRaw.mockImplementation((async (strings: TemplateStringsArray) =>
    strings.join("").includes("GROUP BY") ? daily : [window]) as never);
}

describe("getVisitorFunnel", () => {
  beforeEach(() => {
    stubVisitRollups({});
  });

  it("counts in SQL — never loads raw VisitEvent rows into Node (audit H-2)", async () => {
    signedInAs("ADMIN");

    await getVisitorFunnel();

    expect(mockPrisma.visitEvent.findMany).not.toHaveBeenCalled();
    const [windowQuery, dailyQuery] = visitQueries();
    expect(windowQuery.text).toContain('COUNT(DISTINCT "visitorId")');
    expect(windowQuery.text).toContain(`FILTER (WHERE "type" = 'CHECKOUT_START'`);
    expect(dailyQuery.text).toContain("AT TIME ZONE 'UTC' AT TIME ZONE ?");
    expect(dailyQuery.values).toContain("Africa/Cairo"); // STORE_TZ is a bound parameter
    expect(dailyQuery.text).toContain("GROUP BY 1");
  });

  it("scopes a MANAGER's events and orders to their own branch (a bound parameter, never interpolated)", async () => {
    signedInAs("MANAGER", OWN_BRANCH);

    const funnel = await getVisitorFunnel();

    expect(visitQueries()).toHaveLength(2);
    for (const q of visitQueries()) {
      expect(q.text).toContain('AND "branchId" = ?');
      expect(q.values).toContain(OWN_BRANCH);
      expect(q.text).not.toContain(OWN_BRANCH);
    }
    expect(orderWheres()).toHaveLength(2); // week + month order counts
    for (const where of orderWheres()) expect(where.branchId).toBe(OWN_BRANCH);
    expect(funnel.branchScoped).toBe(true);
  });

  it("refuses a MANAGER asking for another branch before reading anything", async () => {
    signedInAs("MANAGER", OWN_BRANCH);

    await expect(getVisitorFunnel({ branchId: OTHER_BRANCH })).rejects.toThrow(/own branch/);
    expect(visitQueries()).toHaveLength(0);
    expect(orderQueryCount()).toBe(0);
  });

  it("gives an ADMIN every branch", async () => {
    signedInAs("ADMIN");

    const funnel = await getVisitorFunnel();

    for (const q of visitQueries()) expect(q.text).not.toContain("branchId");
    for (const where of orderWheres()) expect(where).not.toHaveProperty("branchId");
    expect(funnel.branchScoped).toBe(false);
  });

  it("refuses a customer", async () => {
    signedInAs("USER");

    await expect(getVisitorFunnel()).rejects.toThrow();
    expect(visitQueries()).toHaveLength(0);
  });

  it("maps the rollup onto both windows, with placed orders (not cancelled) as the last step", async () => {
    signedInAs("ADMIN");
    stubVisitRollups(
      {
        weekVisitors: 1, weekPageViews: 3, weekProductViewers: 1, weekCartAdders: 0, weekCheckoutStarters: 0,
        monthVisitors: 2, monthPageViews: 5, monthProductViewers: 2, monthCartAdders: 1, monthCheckoutStarters: 1,
      },
      [{ day: "2000-01-01", visitors: 7 }], // outside every window → ignored
    );
    mockPrisma.order.count.mockResolvedValueOnce(2).mockResolvedValueOnce(9);

    const funnel = await getVisitorFunnel();

    for (const where of orderWheres()) expect(where.status).toEqual({ not: "CANCELLED" });
    expect(funnel.week).toMatchObject({ uniqueVisitors: 1, pageViews: 3 });
    expect(funnel.month).toMatchObject({ uniqueVisitors: 2, pageViews: 5 });
    expect(funnel.month.steps.map((s) => s.count)).toEqual([2, 2, 1, 1, 9]);
    expect(funnel.week.steps.at(-1)).toMatchObject({ key: "orders", count: 2 });
    expect(funnel.week.daily).toHaveLength(7);
    expect(funnel.month.daily).toHaveLength(30);
    expect(funnel.month.daily.every((d) => d.visitors === 0)).toBe(true);
  });
});
