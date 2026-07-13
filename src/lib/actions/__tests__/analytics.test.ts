// ─────────────────────────────────────────────────────────────────────────────
// getAnalytics — financial reporting suite (Super-Admin cross-branch analytics).
//
// Locks the two formalized reporting rules from `.claude/rules/business-logic.md`:
//   1. REVENUE counts DELIVERED orders ONLY (branch sales, star-of-month, top
//      products). VOLUME (peak hours) stays status-agnostic — excludes only
//      CANCELLED. Both filters live in the query, so we assert the query.
//   2. Every business "month" is an Africa/Cairo calendar boundary expressed as
//      an exact UTC instant (`storeMonthStart`) — never the server's UTC/local
//      month, which drifts with the Vercel region.
//
// WHAT A PRISMA MOCK CAN AND CAN'T PROVE HERE (important):
//   getAnalytics filters/aggregates in Postgres (`groupBy` where-clauses + two
//   `AT TIME ZONE` raw rollups). A deep mock does NOT execute SQL, so it can't
//   "filter a mixed set" or "bucket by hour" itself. What IS testable — and what
//   actually guards the money — is the exact WHERE clause and the exact Cairo
//   date boundary the code hands the database. That is what we assert. The real
//   discount/booking math is covered by the discounts + placeOrder suites.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));
vi.mock("@/lib/session", () => ({ requireAdmin: vi.fn() }));

import { getAnalytics } from "@/lib/actions/analytics";
import { requireAdmin } from "@/lib/session";
import { OrderStatus } from "@/generated/prisma/enums";
import { STORE_TZ, storeMonthStart } from "@/lib/timezone";

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>;
const mockedRequireAdmin = vi.mocked(requireAdmin);

// Prisma's `groupBy` is so heavily overloaded that its call signature hides the
// vitest-mock-extended mock methods from the type checker. Cast through a minimal
// mock view exposing exactly what we use (the runtime object is the real mock).
type MockView = { mockResolvedValue: (value: unknown) => MockView; mock: { calls: unknown[][] } };
const orderGroupBy = mockPrisma.order["groupBy"] as unknown as MockView;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const decimalLike = (n: number) => ({ toNumber: () => n });
const branch = (id: string, name: string) => ({ id, name });

/** A `prisma.order.groupBy` row: revenue (_sum) + delivered-order count (_count). */
const salesRow = (branchId: string, revenue: number, orders: number) => ({
  branchId,
  _sum: { totalAmount: decimalLike(revenue) },
  _count: { _all: orders },
});

/** The recorded groupBy calls, loosely typed for where-clause inspection. */
const groupByCalls = () => orderGroupBy.mock.calls as unknown as [any][];

beforeEach(() => {
  mockReset(mockPrisma);
  mockedRequireAdmin.mockReset();
  mockedRequireAdmin.mockResolvedValue(undefined as never); // admin passes the gate

  mockPrisma.branch.findMany.mockResolvedValue([] as never);
  orderGroupBy.mockResolvedValue([] as never);
  mockPrisma.$queryRaw.mockResolvedValue([] as never); // peak + top rollups
});

afterEach(() => {
  vi.useRealTimers();
});

// ═════════════════════════════════════════════════════════════════════════════
// Access control
// ═════════════════════════════════════════════════════════════════════════════

describe("getAnalytics — access control", () => {
  it("throws for a non-admin caller and runs no queries", async () => {
    mockedRequireAdmin.mockRejectedValue(new Error("Unauthorized: admin access required."));
    await expect(getAnalytics()).rejects.toThrow("Unauthorized");
    expect(mockPrisma.branch.findMany).not.toHaveBeenCalled();
    expect(orderGroupBy).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. Strict status filtering — DELIVERED-only revenue
// ═════════════════════════════════════════════════════════════════════════════

describe("getAnalytics — strict status filtering (DELIVERED-only revenue)", () => {
  it("filters BOTH revenue groupBys to branch-attached, DELIVERED orders", async () => {
    mockPrisma.branch.findMany.mockResolvedValue([branch("b1", "Cairo")] as never);
    orderGroupBy.mockResolvedValue([salesRow("b1", 500, 5)] as never);

    await getAnalytics();

    const calls = groupByCalls();
    expect(calls).toHaveLength(2); // all-time sales + this-month star
    // PENDING / CANCELLED are excluded at the SQL boundary — the DB is only ever
    // asked for DELIVERED rows, so no other status can reach the _sum in JS.
    for (const [args] of calls) {
      expect(args.where).toMatchObject({
        branchId: { not: null },
        status: OrderStatus.DELIVERED,
      });
    }
  });

  it("surfaces exactly the DELIVERED aggregate the DB returns (nothing else contributes)", async () => {
    mockPrisma.branch.findMany.mockResolvedValue([branch("b1", "Cairo")] as never);
    // The DELIVERED-scoped query returns 500 over 5 orders. Had PENDING (200) or
    // CANCELLED (100) leaked into the aggregate, revenue would read 800 — the
    // where-clause above is what keeps it exactly 500.
    orderGroupBy.mockResolvedValue([salesRow("b1", 500, 5)] as never);

    const data = await getAnalytics();
    const cairo = data.branchSales.find((s) => s.branchId === "b1")!;
    expect(cairo.revenue).toBe(500);
    expect(cairo.orders).toBe(5);
  });

  it("scopes the raw rollups per rule: peak-hours by VOLUME (not CANCELLED), top-products by DELIVERED", async () => {
    mockPrisma.branch.findMany.mockResolvedValue([branch("b1", "Cairo")] as never);
    await getAnalytics();

    const sqlTexts = (mockPrisma.$queryRaw.mock.calls as unknown as [TemplateStringsArray][]).map(
      ([strings]) => Array.from(strings).join(" "),
    );
    // Peak hours measures ACTIVITY → excludes only CANCELLED.
    expect(sqlTexts.some((s) => s.includes("<> 'CANCELLED'"))).toBe(true);
    // Top products reports MONEY → strict DELIVERED-only.
    expect(sqlTexts.some((s) => s.includes("= 'DELIVERED'"))).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Africa/Cairo month bucketing (the revenue time-window boundary)
// ═════════════════════════════════════════════════════════════════════════════

describe("getAnalytics — Africa/Cairo month bucketing (vs UTC)", () => {
  it("bounds the this-month revenue window at CAIRO midnight, not UTC", async () => {
    // Freeze the clock at 2026-01-31T23:00:00Z. In Africa/Cairo (UTC+2, winter)
    // that instant is 2026-02-01 01:00 — FEBRUARY has begun in Cairo while UTC
    // still reads January 31.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-31T23:00:00.000Z"));

    mockPrisma.branch.findMany.mockResolvedValue([branch("b1", "Cairo")] as never);

    await getAnalytics();

    // The month groupBy is the one carrying a createdAt lower bound.
    const monthCall = groupByCalls().find(([a]) => a.where?.createdAt);
    expect(monthCall).toBeDefined();
    const gte = monthCall![0].where.createdAt.gte as Date;

    // Cairo Feb-1 00:00 == 2026-01-31T22:00:00Z — NOT the naive UTC Feb-1 midnight.
    expect(gte.toISOString()).toBe("2026-01-31T22:00:00.000Z");
    expect(gte.toISOString()).not.toBe("2026-02-01T00:00:00.000Z");
    // And it equals the shared boundary helper, so the JS window and the raw-SQL
    // rollups can never disagree about where the store month starts.
    expect(gte.getTime()).toBe(storeMonthStart(new Date()).getTime());
  });

  it("attributes a 01:00-Cairo order (23:00 UTC prev day) to the CURRENT month, not the previous one", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-31T23:00:00.000Z"));

    mockPrisma.branch.findMany.mockResolvedValue([branch("b1", "Cairo")] as never);
    await getAnalytics();

    const gte = groupByCalls().find(([a]) => a.where?.createdAt)![0].where.createdAt.gte as Date;

    // An order placed at 01:00 Cairo == 23:00 UTC on Jan 31.
    const orderInstant = new Date("2026-01-31T23:00:00.000Z");
    // It falls INSIDE the current Cairo month (>= the Cairo boundary)…
    expect(orderInstant.getTime()).toBeGreaterThanOrEqual(gte.getTime());
    // …but a naive UTC month start would have WRONGLY dropped it into "last month".
    const naiveUtcMonthStart = new Date("2026-02-01T00:00:00.000Z");
    expect(orderInstant.getTime()).toBeLessThan(naiveUtcMonthStart.getTime());
  });

  it("passes the Africa/Cairo zone into the raw peak-hours SQL (bucketing runs in Postgres)", async () => {
    mockPrisma.branch.findMany.mockResolvedValue([branch("b1", "Cairo")] as never);
    await getAnalytics();

    // The hour bucket is EXTRACT(HOUR ... AT TIME ZONE $zone), the zone bound as a
    // parameter (not string-interpolated). Assert it's the Cairo zone; the actual
    // hour conversion is Postgres's job, not the mock's.
    const rawArgs = (mockPrisma.$queryRaw.mock.calls as unknown as unknown[][]).flat();
    expect(rawArgs).toContain(STORE_TZ);
    expect(STORE_TZ).toBe("Africa/Cairo");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Zero-state fallback — no DELIVERED orders must never NaN/throw
// ═════════════════════════════════════════════════════════════════════════════

describe("getAnalytics — zero-state fallback", () => {
  it("returns 0 revenue per branch and a null star when there are no DELIVERED orders", async () => {
    mockPrisma.branch.findMany.mockResolvedValue([branch("b1", "Cairo"), branch("b2", "Alexandria")] as never);
    orderGroupBy.mockResolvedValue([] as never); // no delivered revenue at all
    mockPrisma.$queryRaw.mockResolvedValue([] as never);

    const data = await getAnalytics();

    expect(data.branchSales).toHaveLength(2);
    for (const s of data.branchSales) {
      expect(s.revenue).toBe(0); // not NaN / undefined
      expect(s.orders).toBe(0);
    }
    expect(data.star).toBeNull(); // no month revenue → no star of the month
  });

  it("returns clean empty structures when there are no branches and no orders", async () => {
    mockPrisma.branch.findMany.mockResolvedValue([] as never);
    orderGroupBy.mockResolvedValue([] as never);
    mockPrisma.$queryRaw.mockResolvedValue([] as never);

    const data = await getAnalytics();

    expect(data.branchSales).toEqual([]);
    expect(data.topProducts).toEqual([]);
    expect(data.star).toBeNull();
    expect(data.peakHours.branches).toEqual([]);
    // Peak-hours axis falls back to 8 AM–11 PM (16 hourly points) so the chart isn't empty.
    expect(data.peakHours.series).toHaveLength(16);
  });

  it("coerces a null _sum.totalAmount to 0 (defensive Decimal handling, no throw)", async () => {
    mockPrisma.branch.findMany.mockResolvedValue([branch("b1", "Cairo")] as never);
    orderGroupBy.mockResolvedValue([
      { branchId: "b1", _sum: { totalAmount: null }, _count: { _all: 0 } },
    ] as never);

    const data = await getAnalytics();
    expect(data.branchSales[0].revenue).toBe(0);
  });
});
