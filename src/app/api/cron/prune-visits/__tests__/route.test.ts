// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cron/prune-visits — the nightly VisitEvent retention job (audit H-2).
//
// Pins: fail-closed auth (no CRON_SECRET → refuse; wrong/missing bearer →
// 401, nothing deleted), the 90-day cutoff, bounded batched deletes that stop
// on a short batch and cap per run, and a failure answering JSON (never a throw).
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));

import { GET } from "@/app/api/cron/prune-visits/route";

const VISIT_RETENTION_DAYS = 90; // mirrors the route (a route module may export only handlers + config)
import { prisma } from "@/lib/prisma";

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>;
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
const SECRET = "s3cret-cron-token";

const call = (authorization?: string) =>
  GET(new Request("https://alibaba.test/api/cron/prune-visits", {
    headers: authorization ? { authorization } : {},
  }));

beforeEach(() => {
  mockReset(mockPrisma);
  consoleError.mockClear();
  vi.stubEnv("CRON_SECRET", SECRET);
  mockPrisma.$executeRaw.mockResolvedValue(0 as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("auth — fail closed", () => {
  it("refuses everything when CRON_SECRET is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(500);
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
  });

  it.each([undefined, "Bearer wrong", `Basic ${SECRET}`, `Bearer ${SECRET}x`])(
    "401s a request with authorization %o and deletes nothing",
    async (authorization) => {
      const res = await call(authorization);
      expect(res.status).toBe(401);
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    },
  );
});

describe("pruning", () => {
  it("deletes rows older than 90 days, by a bound cutoff parameter", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-21T01:30:00Z") });
    mockPrisma.$executeRaw.mockResolvedValueOnce(12 as never);

    const res = await call(`Bearer ${SECRET}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, deleted: 12, cutoff: "2026-08-23T01:30:00.000Z" });
    const [strings, cutoff, limit] = mockPrisma.$executeRaw.mock.calls[0] as unknown as [string[], Date, number];
    expect(strings.join("?")).toMatch(/DELETE FROM "VisitEvent"[\s\S]*"createdAt" < \?[\s\S]*LIMIT \?/);
    expect(cutoff).toEqual(new Date(Date.now() - VISIT_RETENTION_DAYS * 86_400_000));
    expect(limit).toBe(5000);
  });

  it("keeps deleting full batches and stops on the first short one", async () => {
    mockPrisma.$executeRaw
      .mockResolvedValueOnce(5000 as never)
      .mockResolvedValueOnce(5000 as never)
      .mockResolvedValueOnce(17 as never);

    const res = await call(`Bearer ${SECRET}`);

    expect((await res.json()).deleted).toBe(10_017);
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(3);
  });

  it("caps one run at 40 batches — a backlog drains over several nights", async () => {
    mockPrisma.$executeRaw.mockResolvedValue(5000 as never);

    const res = await call(`Bearer ${SECRET}`);

    expect((await res.json()).deleted).toBe(200_000);
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(40);
  });

  it("answers JSON 500 with the partial count on a database failure — never throws", async () => {
    mockPrisma.$executeRaw
      .mockResolvedValueOnce(5000 as never)
      .mockRejectedValueOnce(new Error("connection reset"));

    const res = await call(`Bearer ${SECRET}`);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "Prune failed.", deleted: 5000 });
    expect(consoleError).toHaveBeenCalled();
  });
});
