// ─────────────────────────────────────────────────────────────────────────────
// Storefront FAQ actions — unit/integration suite (src/lib/actions/faqs.ts).
//
// The Faq model backs the (formerly hardcoded) homepage FAQ section. These tests
// lock the two behaviours the storefront/admin split depends on:
//
//   • READS — getStorefrontFaqs returns ACTIVE rows only, ordered by `order`
//     (public, ungated); getAdminFaqs returns EVERY row and is ADMIN-gated.
//   • WRITES — create/update/delete/reorder each gate on ensureAdmin (a rejected
//     caller writes nothing and gets the standard envelope), validate their
//     payload, append/rewrite `order` correctly, and translate P2025 into a
//     friendly "no longer exists" instead of leaking the Prisma code.
//
// MOCKING — same strategy as cart.test.ts / orders.test.ts: mock only the true
// boundaries (@/lib/prisma deep-mocked, @/lib/session, next/cache) and run the
// real action-utils gate (ensureAdmin → requireAdmin). Every assertion targets
// the EXACT payload sent to Prisma.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));
// getServerSession is stubbed only because @/lib/session exports it; the FAQ
// actions reach auth through requireAdmin (directly for getAdminFaqs, via
// ensureAdmin/action-utils for every mutation).
vi.mock("@/lib/session", () => ({ getServerSession: vi.fn(), requireAdmin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  getStorefrontFaqs,
  getAdminFaqs,
  createFaq,
  updateFaq,
  deleteFaq,
  reorderFaqs,
} from "@/lib/actions/faqs";
import { requireAdmin } from "@/lib/session";
import { revalidatePath } from "next/cache";

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>;
const mockedRequireAdmin = vi.mocked(requireAdmin);
const mockedRevalidate = vi.mocked(revalidatePath);

const UNAUTHORIZED = "Unauthorized: admin access required.";

// Mutations log unexpected failures via console.error — silence it.
vi.spyOn(console, "error").mockImplementation(() => {});

/** Build a P2025 (record-not-found) error the way Prisma surfaces it. */
const notFound = () => Object.assign(new Error("Record not found"), { code: "P2025" });

// ── Default happy-path state — each test overrides only what it exercises ─────

beforeEach(() => {
  mockReset(mockPrisma);
  mockedRequireAdmin.mockReset();
  mockedRevalidate.mockClear();

  // Admin by default (an authorized caller); RBAC tests override to reject.
  mockedRequireAdmin.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } } as never);

  // create: empty list (order → 1), returns a fresh id.
  mockPrisma.faq.aggregate.mockResolvedValue({ _max: { order: null } } as never);
  mockPrisma.faq.create.mockResolvedValue({ id: "faq_new" } as never);
  mockPrisma.faq.update.mockResolvedValue({ id: "faq_1" } as never);
  mockPrisma.faq.delete.mockResolvedValue({ id: "faq_1" } as never);
  mockPrisma.faq.findMany.mockResolvedValue([] as never);

  // $transaction handles BOTH forms: the interactive callback (create) and the
  // batched array (reorder). A throw inside either rejects, so the "rolls back"
  // safety tests hold.
  mockPrisma.$transaction.mockImplementation(((arg: unknown) =>
    typeof arg === "function"
      ? (arg as (tx: typeof mockPrisma) => unknown)(mockPrisma)
      : Promise.all(arg as Promise<unknown>[])) as never);
});

afterAll(() => {
  vi.restoreAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════════
// getStorefrontFaqs — public, active-only, ordered
// ═════════════════════════════════════════════════════════════════════════════

describe("getStorefrontFaqs", () => {
  it("reads ACTIVE rows only, ordered by `order` then `createdAt`, minimal select", async () => {
    const rows = [
      { id: "f1", question: "Q1", answer: "A1" },
      { id: "f2", question: "Q2", answer: "A2" },
    ];
    mockPrisma.faq.findMany.mockResolvedValue(rows as never);

    const result = await getStorefrontFaqs();

    expect(result).toEqual(rows);
    expect(mockPrisma.faq.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true, question: true, answer: true },
    });
  });

  it("is PUBLIC — never calls the admin gate (renders even for a signed-out visitor)", async () => {
    // Prove it isn't gated: even with requireAdmin rejecting, the read succeeds.
    mockedRequireAdmin.mockRejectedValue(new Error("not admin"));

    const result = await getStorefrontFaqs();

    expect(result).toEqual([]);
    expect(mockedRequireAdmin).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// getAdminFaqs — ADMIN-gated, ALL rows
// ═════════════════════════════════════════════════════════════════════════════

describe("getAdminFaqs", () => {
  it("returns EVERY row (no isActive filter), ordered, with the full admin select", async () => {
    const rows = [
      { id: "f1", question: "Q1", answer: "A1", order: 0, isActive: true },
      { id: "f2", question: "Q2", answer: "A2", order: 1, isActive: false },
    ];
    mockPrisma.faq.findMany.mockResolvedValue(rows as never);

    const result = await getAdminFaqs();

    expect(result).toEqual(rows);
    expect(mockPrisma.faq.findMany).toHaveBeenCalledWith({
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true, question: true, answer: true, order: true, isActive: true },
    });
  });

  it("is ADMIN-gated — a non-admin caller is rejected (requireAdmin throws) and reads nothing", async () => {
    mockedRequireAdmin.mockRejectedValue(new Error("not admin"));

    await expect(getAdminFaqs()).rejects.toThrow();
    expect(mockPrisma.faq.findMany).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// RBAC — every mutation returns the standard envelope for a non-admin & writes nothing
// ═════════════════════════════════════════════════════════════════════════════

describe("mutations — RBAC gate (ensureAdmin)", () => {
  beforeEach(() => {
    mockedRequireAdmin.mockRejectedValue(new Error("not admin"));
  });

  it("createFaq rejects a non-admin and opens no transaction", async () => {
    const res = await createFaq({ question: "Valid question?", answer: "Valid answer." });
    expect(res).toEqual({ success: false, error: UNAUTHORIZED });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.faq.create).not.toHaveBeenCalled();
  });

  it("updateFaq rejects a non-admin and writes nothing", async () => {
    const res = await updateFaq("f1", { question: "Q?", answer: "A.", isActive: true });
    expect(res).toEqual({ success: false, error: UNAUTHORIZED });
    expect(mockPrisma.faq.update).not.toHaveBeenCalled();
  });

  it("deleteFaq rejects a non-admin and writes nothing", async () => {
    const res = await deleteFaq("f1");
    expect(res).toEqual({ success: false, error: UNAUTHORIZED });
    expect(mockPrisma.faq.delete).not.toHaveBeenCalled();
  });

  it("reorderFaqs rejects a non-admin and writes nothing", async () => {
    const res = await reorderFaqs(["f1", "f2"]);
    expect(res).toEqual({ success: false, error: UNAUTHORIZED });
    expect(mockPrisma.faq.update).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("does not revalidate any path when a mutation is denied", async () => {
    await createFaq({ question: "Valid question?", answer: "Valid answer." });
    expect(mockedRevalidate).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// createFaq
// ═════════════════════════════════════════════════════════════════════════════

describe("createFaq — validation", () => {
  it("rejects a too-short question and writes nothing", async () => {
    const res = await createFaq({ question: "?", answer: "A valid answer." });
    expect(res).toEqual({ success: false, error: "Question must be at least 2 characters." });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a too-short answer and writes nothing", async () => {
    const res = await createFaq({ question: "A valid question?", answer: " " });
    expect(res).toEqual({ success: false, error: "Answer must be at least 2 characters." });
    expect(mockPrisma.faq.create).not.toHaveBeenCalled();
  });

  it("trims whitespace off both fields before persisting", async () => {
    await createFaq({ question: "  Trimmed question?  ", answer: "  Trimmed answer.  " });
    expect(mockPrisma.faq.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ question: "Trimmed question?", answer: "Trimmed answer." }),
      }),
    );
  });
});

describe("createFaq — append-to-end ordering", () => {
  it("uses order = 1 for the very first FAQ (empty table → max is null)", async () => {
    mockPrisma.faq.aggregate.mockResolvedValue({ _max: { order: null } } as never);

    const res = await createFaq({ question: "First question?", answer: "First answer." });

    expect(res).toEqual({ success: true, id: "faq_new" });
    expect(mockPrisma.faq.create).toHaveBeenCalledWith({
      data: { question: "First question?", answer: "First answer.", order: 1 },
      select: { id: true },
    });
  });

  it("appends after the current max order (4 → 5)", async () => {
    mockPrisma.faq.aggregate.mockResolvedValue({ _max: { order: 4 } } as never);

    await createFaq({ question: "Another question?", answer: "Another answer." });

    expect(mockPrisma.faq.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ order: 5 }) }),
    );
  });

  it("revalidates the homepage and the admin list on success", async () => {
    await createFaq({ question: "A question?", answer: "An answer." });
    expect(mockedRevalidate).toHaveBeenCalledWith("/");
    expect(mockedRevalidate).toHaveBeenCalledWith("/admin/faqs");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// updateFaq
// ═════════════════════════════════════════════════════════════════════════════

describe("updateFaq", () => {
  it("rejects a missing id before touching the DB", async () => {
    const res = await updateFaq("", { question: "Q?", answer: "An answer.", isActive: true });
    expect(res).toEqual({ success: false, error: "Missing FAQ id." });
    expect(mockPrisma.faq.update).not.toHaveBeenCalled();
  });

  it("persists trimmed fields and the isActive toggle", async () => {
    const res = await updateFaq("f1", {
      question: "  Edited question?  ",
      answer: "  Edited answer.  ",
      isActive: false,
    });

    expect(res).toEqual({ success: true });
    expect(mockPrisma.faq.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: { question: "Edited question?", answer: "Edited answer.", isActive: false },
      select: { id: true },
    });
  });

  it("translates a P2025 into a friendly 'no longer exists'", async () => {
    mockPrisma.faq.update.mockRejectedValue(notFound());
    const res = await updateFaq("gone", { question: "Q?", answer: "An answer.", isActive: true });
    expect(res).toEqual({ success: false, error: "That FAQ no longer exists." });
  });

  it("re-validates the payload (a blank answer is rejected even on update)", async () => {
    const res = await updateFaq("f1", { question: "A valid question?", answer: "", isActive: true });
    expect(res).toEqual({ success: false, error: "Answer must be at least 2 characters." });
    expect(mockPrisma.faq.update).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// deleteFaq
// ═════════════════════════════════════════════════════════════════════════════

describe("deleteFaq", () => {
  it("rejects a missing id before touching the DB", async () => {
    const res = await deleteFaq("");
    expect(res).toEqual({ success: false, error: "Missing FAQ id." });
    expect(mockPrisma.faq.delete).not.toHaveBeenCalled();
  });

  it("deletes the row and revalidates on success", async () => {
    const res = await deleteFaq("f1");
    expect(res).toEqual({ success: true });
    expect(mockPrisma.faq.delete).toHaveBeenCalledWith({ where: { id: "f1" } });
    expect(mockedRevalidate).toHaveBeenCalledWith("/");
  });

  it("translates a P2025 into a friendly 'no longer exists'", async () => {
    mockPrisma.faq.delete.mockRejectedValue(notFound());
    const res = await deleteFaq("gone");
    expect(res).toEqual({ success: false, error: "That FAQ no longer exists." });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// reorderFaqs — drag-and-drop persistence
// ═════════════════════════════════════════════════════════════════════════════

describe("reorderFaqs", () => {
  it("rejects an empty id list", async () => {
    const res = await reorderFaqs([]);
    expect(res).toEqual({ success: false, error: "Nothing to reorder." });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rewrites each row's `order` to its index inside ONE transaction", async () => {
    const res = await reorderFaqs(["f3", "f1", "f2"]);

    expect(res).toEqual({ success: true });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    // Positions follow the array index: f3 → 0, f1 → 1, f2 → 2.
    expect(mockPrisma.faq.update).toHaveBeenNthCalledWith(1, {
      where: { id: "f3" },
      data: { order: 0 },
      select: { id: true },
    });
    expect(mockPrisma.faq.update).toHaveBeenNthCalledWith(2, {
      where: { id: "f1" },
      data: { order: 1 },
      select: { id: true },
    });
    expect(mockPrisma.faq.update).toHaveBeenNthCalledWith(3, {
      where: { id: "f2" },
      data: { order: 2 },
      select: { id: true },
    });
    expect(mockedRevalidate).toHaveBeenCalledWith("/");
  });

  it("translates a P2025 (a row vanished mid-reorder) into a refresh-and-retry message", async () => {
    mockPrisma.faq.update.mockRejectedValue(notFound());
    const res = await reorderFaqs(["f1", "f2"]);
    expect(res).toEqual({
      success: false,
      error: "One of those FAQs no longer exists. Refresh and try again.",
    });
  });
});
