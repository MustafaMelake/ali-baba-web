// ─────────────────────────────────────────────────────────────────────────────
// src/lib/prisma.ts — pool timeouts (audit M-8).
//
// Pins that the driver adapter gets bounded connection / query timeouts (pg's
// defaults wait forever), and that NO server-side statement_timeout startup
// option is sent: Neon's pooled endpoint rejects it ("unsupported startup
// parameter in options: statement_timeout"), which would break every query.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const adapterConfigs: unknown[] = [];
vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {
    constructor(config: unknown) {
      adapterConfigs.push(config);
    }
  },
}));
vi.mock("@/generated/prisma/client", () => ({ PrismaClient: class {} }));

beforeEach(() => {
  adapterConfigs.length = 0;
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", "postgresql://user:pw@ep-test-pooler.eu-central-1.aws.neon.tech/db");
  delete (globalThis as { prisma?: unknown }).prisma;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("prisma client pool settings", () => {
  it("passes bounded timeouts to the pg pool", async () => {
    const { PG_POOL_SETTINGS } = await import("@/lib/prisma");

    expect(adapterConfigs).toEqual([
      {
        connectionString: "postgresql://user:pw@ep-test-pooler.eu-central-1.aws.neon.tech/db",
        connectionTimeoutMillis: 10_000,
        query_timeout: 20_000,
        idleTimeoutMillis: 10_000,
        max: 10,
      },
    ]);
    expect(PG_POOL_SETTINGS.connectionTimeoutMillis).toBeGreaterThan(0); // 0 = wait forever
  });

  it("never sends a statement_timeout startup option (Neon's pooler rejects it)", async () => {
    await import("@/lib/prisma");

    const config = adapterConfigs[0] as Record<string, unknown>;
    expect(config).not.toHaveProperty("statement_timeout");
    expect(config).not.toHaveProperty("options");
  });

  it("still refuses to start without DATABASE_URL", async () => {
    vi.stubEnv("DATABASE_URL", "");
    await expect(import("@/lib/prisma")).rejects.toThrow("DATABASE_URL is not set");
  });
});
