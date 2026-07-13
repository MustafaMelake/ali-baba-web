// ─────────────────────────────────────────────────────────────────────────────
// Cart state machine — integration suite (syncCartItemAction + mergeCartAction).
//
// The DB `CartItem` stores ONLY identity + intent: `{ userId, variantId,
// quantity }` — never price (re-resolved on read). These tests lock the cart
// invariants from `.claude/rules/business-logic.md` (Cart sync / DB limits) and
// `.claude/rules/backend.md` (bounded, transactional writes):
//
//   • syncCartItemAction — SET upserts to an EXACT quantity (idempotent, no
//     increment races); quantity is clamped to [1, 99]; anything < 1 (or a
//     DELETE) removes the line; a NEW distinct line past the 50-line ceiling is
//     rejected with CART_LIMIT_ERROR, while an EXISTING line is never capped.
//   • mergeCartAction — the guest→auth bridge: one bounded $transaction that
//     SUMS guest + DB quantities per variant, clamps at 99, upserts on the
//     compound key (so a shared variant never trips a unique constraint), and
//     skips stale variant ids up-front.
//
// MOCKING — same strategy as orders.test.ts: mock only the true boundaries
// (@/lib/prisma deep-mocked, @/lib/session), and run the real validators,
// action-utils and discount engine. cart.ts imports no next/cache, so none is
// stubbed. Every assertion targets the EXACT mutation payload sent to Prisma.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));
// requireAdmin is included only because @/lib/action-utils imports the binding;
// the cart paths never call it.
vi.mock("@/lib/session", () => ({ getServerSession: vi.fn(), requireAdmin: vi.fn() }));

import { syncCartItemAction, mergeCartAction } from "@/lib/actions/cart";
import { getServerSession } from "@/lib/session";
import { CART_LIMIT_ERROR } from "@/lib/validators";

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>;
const mockedSession = vi.mocked(getServerSession);

// Both actions log expected failures (P2003, merge failure) via console.error.
vi.spyOn(console, "error").mockImplementation(() => {});

const USER_ID = "user_1";

// ── Default happy-path state — each test overrides only what it exercises ─────

beforeEach(() => {
  mockReset(mockPrisma);
  mockedSession.mockReset();
  mockedSession.mockResolvedValue({ user: { id: USER_ID } } as never); // logged in by default

  // sync defaults: a brand-new line into an empty cart.
  mockPrisma.cartItem.findUnique.mockResolvedValue(null);
  mockPrisma.cartItem.count.mockResolvedValue(0);
  mockPrisma.cartItem.upsert.mockResolvedValue({} as never);
  mockPrisma.cartItem.deleteMany.mockResolvedValue({ count: 1 } as never);

  // merge defaults: no valid variants, empty auth cart.
  mockPrisma.productVariant.findMany.mockResolvedValue([] as never);
  mockPrisma.cartItem.findMany.mockResolvedValue([] as never);

  // Interactive $transaction: run the callback with the deep mock as `tx`, so a
  // throw inside rejects the transaction (Prisma rolls back) — the safety tests
  // depend on this.
  mockPrisma.$transaction.mockImplementation((async (cb: (tx: typeof mockPrisma) => unknown) =>
    cb(mockPrisma)) as any);
});

afterAll(() => {
  vi.restoreAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════════
// syncCartItemAction
// ═════════════════════════════════════════════════════════════════════════════

describe("syncCartItemAction — auth & input guards", () => {
  it("rejects a guest (no session) and writes nothing", async () => {
    mockedSession.mockResolvedValue(null);
    const res = await syncCartItemAction("v1", 2, "SET");
    expect(res).toEqual({ success: false, error: "Please sign in to save your cart." });
    expect(mockPrisma.cartItem.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.cartItem.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects a blank variant id", async () => {
    const res = await syncCartItemAction("   ", 2, "SET");
    expect(res).toEqual({ success: false, error: "Missing variant." });
    expect(mockPrisma.cartItem.upsert).not.toHaveBeenCalled();
  });
});

describe("syncCartItemAction — distinct-line ceiling (CART_LIMIT_ERROR)", () => {
  it("REJECTS a NEW line when the cart already holds 50 distinct lines", async () => {
    mockPrisma.cartItem.findUnique.mockResolvedValue(null); // new line
    mockPrisma.cartItem.count.mockResolvedValue(50); // at the ceiling

    const res = await syncCartItemAction("v_new", 1, "SET");
    expect(res).toEqual({ success: false, error: CART_LIMIT_ERROR });
    expect(mockPrisma.cartItem.upsert).not.toHaveBeenCalled();
  });

  it("allows a NEW line at 49 distinct lines (the 50th line is fine)", async () => {
    mockPrisma.cartItem.findUnique.mockResolvedValue(null);
    mockPrisma.cartItem.count.mockResolvedValue(49);

    const res = await syncCartItemAction("v_new", 1, "SET");
    expect(res).toEqual({ success: true, data: null });
    expect(mockPrisma.cartItem.upsert).toHaveBeenCalledTimes(1);
  });

  it("NEVER caps an EXISTING line — a full cart can still be re-quantified (count not even read)", async () => {
    mockPrisma.cartItem.findUnique.mockResolvedValue({ id: "row_1" } as never); // line already exists
    mockPrisma.cartItem.count.mockResolvedValue(50); // would block a new line — but this isn't one

    const res = await syncCartItemAction("v1", 5, "SET");
    expect(res).toEqual({ success: true, data: null });
    expect(mockPrisma.cartItem.count).not.toHaveBeenCalled(); // the ceiling check is new-line-only
    expect(mockPrisma.cartItem.upsert).toHaveBeenCalledWith({
      where: { userId_variantId: { userId: USER_ID, variantId: "v1" } },
      update: { quantity: 5 },
      create: { userId: USER_ID, variantId: "v1", quantity: 5 },
    });
  });
});

describe("syncCartItemAction — quantity bounds (clamp to [1, 99])", () => {
  it("CLAMPS a SET above 99 down to 99 (clamps, never rejects)", async () => {
    mockPrisma.cartItem.findUnique.mockResolvedValue({ id: "row_1" } as never);
    const res = await syncCartItemAction("v1", 150, "SET");
    expect(res).toEqual({ success: true, data: null });
    expect(mockPrisma.cartItem.upsert).toHaveBeenCalledWith({
      where: { userId_variantId: { userId: USER_ID, variantId: "v1" } },
      update: { quantity: 99 },
      create: { userId: USER_ID, variantId: "v1", quantity: 99 },
    });
  });

  it("keeps exactly 99 at the boundary", async () => {
    mockPrisma.cartItem.findUnique.mockResolvedValue({ id: "row_1" } as never);
    await syncCartItemAction("v1", 99, "SET");
    expect(mockPrisma.cartItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { quantity: 99 } }),
    );
  });

  it("floors a fractional quantity (2.9 → 2)", async () => {
    mockPrisma.cartItem.findUnique.mockResolvedValue({ id: "row_1" } as never);
    await syncCartItemAction("v1", 2.9, "SET");
    expect(mockPrisma.cartItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { quantity: 2 } }),
    );
  });
});

describe("syncCartItemAction — zero/negative quantity deletes (optimistic support)", () => {
  it("treats a SET of quantity 0 as a DELETE (deleteMany, not upsert)", async () => {
    const res = await syncCartItemAction("v1", 0, "SET");
    expect(res).toEqual({ success: true, data: null });
    expect(mockPrisma.cartItem.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, variantId: "v1" },
    });
    expect(mockPrisma.cartItem.upsert).not.toHaveBeenCalled();
  });

  it("treats a negative quantity as a DELETE", async () => {
    const res = await syncCartItemAction("v1", -3, "SET");
    expect(res.success).toBe(true);
    expect(mockPrisma.cartItem.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.cartItem.upsert).not.toHaveBeenCalled();
  });

  it("treats a non-finite quantity (NaN) as a DELETE", async () => {
    const res = await syncCartItemAction("v1", Number.NaN, "SET");
    expect(res.success).toBe(true);
    expect(mockPrisma.cartItem.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, variantId: "v1" },
    });
    expect(mockPrisma.cartItem.upsert).not.toHaveBeenCalled();
  });

  it("an explicit DELETE removes the line even when a positive quantity is passed", async () => {
    const res = await syncCartItemAction("v1", 5, "DELETE"); // actionType wins over quantity
    expect(res).toEqual({ success: true, data: null });
    expect(mockPrisma.cartItem.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, variantId: "v1" },
    });
    expect(mockPrisma.cartItem.upsert).not.toHaveBeenCalled();
  });
});

describe("syncCartItemAction — catalogue integrity (P2003)", () => {
  it("translates a P2003 (variant deleted from the catalogue) into a friendly message", async () => {
    mockPrisma.cartItem.findUnique.mockResolvedValue({ id: "row_1" } as never);
    const fkError = Object.assign(new Error("FK violation"), { code: "P2003" });
    mockPrisma.cartItem.upsert.mockRejectedValue(fkError);

    const res = await syncCartItemAction("v1", 2, "SET");
    expect(res).toEqual({ success: false, error: "That item is no longer available." });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// mergeCartAction — the guest → auth identity bridge
// ═════════════════════════════════════════════════════════════════════════════

describe("mergeCartAction — auth & no-op guards", () => {
  it("rejects a guest (no session) and opens no transaction", async () => {
    mockedSession.mockResolvedValue(null);
    const res = await mergeCartAction([{ variantId: "v1", quantity: 1 }]);
    expect(res).toEqual({ success: false, error: "Please sign in to save your cart." });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("treats an empty guest cart as a no-op success (no transaction)", async () => {
    const res = await mergeCartAction([]);
    expect(res).toEqual({ success: true, data: null });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("treats an all-invalid guest cart (blank ids / zero qty) as a no-op success", async () => {
    const res = await mergeCartAction([
      { variantId: "   ", quantity: 5 },
      { variantId: "v1", quantity: 0 },
    ]);
    expect(res).toEqual({ success: true, data: null });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("mergeCartAction — merge into an EMPTY auth cart", () => {
  it("creates each guest line at its own quantity, scoped to the auth user", async () => {
    mockPrisma.productVariant.findMany.mockResolvedValue([{ id: "v1" }, { id: "v2" }] as never);
    mockPrisma.cartItem.findMany.mockResolvedValue([] as never); // empty auth cart

    const res = await mergeCartAction([
      { variantId: "v1", quantity: 2 },
      { variantId: "v2", quantity: 3 },
    ]);
    expect(res).toEqual({ success: true, data: null });
    expect(mockPrisma.cartItem.upsert).toHaveBeenCalledTimes(2);
    expect(mockPrisma.cartItem.upsert).toHaveBeenNthCalledWith(1, {
      where: { userId_variantId: { userId: USER_ID, variantId: "v1" } },
      update: { quantity: 2 },
      create: { userId: USER_ID, variantId: "v1", quantity: 2 },
    });
    expect(mockPrisma.cartItem.upsert).toHaveBeenNthCalledWith(2, {
      where: { userId_variantId: { userId: USER_ID, variantId: "v2" } },
      update: { quantity: 3 },
      create: { userId: USER_ID, variantId: "v2", quantity: 3 },
    });
  });

  it("pre-sums a guest cart that carries two lines for the same variant", async () => {
    mockPrisma.productVariant.findMany.mockResolvedValue([{ id: "v1" }] as never);
    mockPrisma.cartItem.findMany.mockResolvedValue([] as never);

    await mergeCartAction([
      { variantId: "v1", quantity: 2 },
      { variantId: "v1", quantity: 3 },
    ]);
    expect(mockPrisma.cartItem.upsert).toHaveBeenCalledTimes(1); // de-duped to one line
    expect(mockPrisma.cartItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { quantity: 5 } }),
    );
  });

  it("clamps an over-99 guest line down to 99", async () => {
    mockPrisma.productVariant.findMany.mockResolvedValue([{ id: "v1" }] as never);
    mockPrisma.cartItem.findMany.mockResolvedValue([] as never);

    await mergeCartAction([{ variantId: "v1", quantity: 150 }]);
    expect(mockPrisma.cartItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { quantity: 99 }, create: { userId: USER_ID, variantId: "v1", quantity: 99 } }),
    );
  });
});

describe("mergeCartAction — SUM on conflict, clamped at 99", () => {
  it("SUMS the guest and DB quantities for a shared variant", async () => {
    mockPrisma.productVariant.findMany.mockResolvedValue([{ id: "v1" }] as never);
    mockPrisma.cartItem.findMany.mockResolvedValue([{ variantId: "v1", quantity: 40 }] as never);

    const res = await mergeCartAction([{ variantId: "v1", quantity: 30 }]);
    expect(res).toEqual({ success: true, data: null });
    // Upsert on the compound key writes the ABSOLUTE summed value — no unique
    // constraint is ever tripped (the shared variant is one row, updated).
    expect(mockPrisma.cartItem.upsert).toHaveBeenCalledWith({
      where: { userId_variantId: { userId: USER_ID, variantId: "v1" } },
      update: { quantity: 70 }, // 40 (DB) + 30 (guest)
      create: { userId: USER_ID, variantId: "v1", quantity: 70 },
    });
  });

  it("CLAMPS the summed quantity at 99 rather than overflowing", async () => {
    mockPrisma.productVariant.findMany.mockResolvedValue([{ id: "v1" }] as never);
    mockPrisma.cartItem.findMany.mockResolvedValue([{ variantId: "v1", quantity: 80 }] as never);

    const res = await mergeCartAction([{ variantId: "v1", quantity: 50 }]); // 80 + 50 = 130
    expect(res.success).toBe(true);
    expect(mockPrisma.cartItem.upsert).toHaveBeenCalledWith({
      where: { userId_variantId: { userId: USER_ID, variantId: "v1" } },
      update: { quantity: 99 }, // capped
      create: { userId: USER_ID, variantId: "v1", quantity: 99 },
    });
  });
});

describe("mergeCartAction — skips stale/unknown variants", () => {
  it("upserts only the variants that still exist; a stale id is silently skipped", async () => {
    // Only v1 is returned by the validity read; v_ghost was deleted from the catalogue.
    mockPrisma.productVariant.findMany.mockResolvedValue([{ id: "v1" }] as never);
    mockPrisma.cartItem.findMany.mockResolvedValue([] as never);

    const res = await mergeCartAction([
      { variantId: "v1", quantity: 2 },
      { variantId: "v_ghost", quantity: 5 },
    ]);
    expect(res).toEqual({ success: true, data: null });
    expect(mockPrisma.cartItem.upsert).toHaveBeenCalledTimes(1); // ghost skipped, no FK throw
    expect(mockPrisma.cartItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_variantId: { userId: USER_ID, variantId: "v1" } },
      }),
    );
  });
});

describe("mergeCartAction — transaction safety (all-or-nothing)", () => {
  it("wraps the validity read, the existing-rows read and every upsert in ONE $transaction", async () => {
    mockPrisma.productVariant.findMany.mockResolvedValue([{ id: "v1" }] as never);
    mockPrisma.cartItem.findMany.mockResolvedValue([] as never);

    await mergeCartAction([{ variantId: "v1", quantity: 2 }]);

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    // The bounded `id IN (…)` validity read…
    expect(mockPrisma.productVariant.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["v1"] } },
      select: { id: true },
    });
    // …the user-scoped existing-rows read…
    expect(mockPrisma.cartItem.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, variantId: { in: ["v1"] } },
      select: { variantId: true, quantity: true },
    });
    // …and the write all execute inside the transaction.
    expect(mockPrisma.cartItem.upsert).toHaveBeenCalledTimes(1);
  });

  it("returns a failure envelope when a write fails midway (the transaction rolls back)", async () => {
    mockPrisma.productVariant.findMany.mockResolvedValue([{ id: "v1" }, { id: "v2" }] as never);
    mockPrisma.cartItem.findMany.mockResolvedValue([] as never);
    // First upsert succeeds, the second throws → the whole callback rejects, so
    // Prisma rolls the transaction back (no orphaned first line is committed).
    mockPrisma.cartItem.upsert
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error("write failed"));

    const res = await mergeCartAction([
      { variantId: "v1", quantity: 2 },
      { variantId: "v2", quantity: 3 },
    ]);
    expect(res).toEqual({ success: false, error: "Could not merge your cart. Please try again." });
  });
});

describe("mergeCartAction — identity transition (server side of the guest-cart handoff)", () => {
  it("scopes every merged row to the authenticated user id from the session", async () => {
    mockedSession.mockResolvedValue({ user: { id: "user_99" } } as never);
    mockPrisma.productVariant.findMany.mockResolvedValue([{ id: "v1" }] as never);
    mockPrisma.cartItem.findMany.mockResolvedValue([] as never);

    await mergeCartAction([{ variantId: "v1", quantity: 4 }]);
    expect(mockPrisma.cartItem.upsert).toHaveBeenCalledWith({
      where: { userId_variantId: { userId: "user_99", variantId: "v1" } },
      update: { quantity: 4 },
      create: { userId: "user_99", variantId: "v1", quantity: 4 },
    });
  });

  it("returns an empty success envelope — the client then re-adopts the merged DB cart", async () => {
    // The server action never touches the guest's localStorage cart; clearing it
    // is the store's job (mergeAndSyncCart → adoptDbCart replaces local state).
    // All the server owes the client is a clean success so it can re-fetch.
    mockPrisma.productVariant.findMany.mockResolvedValue([{ id: "v1" }] as never);
    mockPrisma.cartItem.findMany.mockResolvedValue([] as never);

    const res = await mergeCartAction([{ variantId: "v1", quantity: 1 }]);
    expect(res).toEqual({ success: true, data: null });
  });
});
