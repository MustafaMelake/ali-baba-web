// ─────────────────────────────────────────────────────────────────────────────
// Reviews — cache revalidation follows visibility (audit L-12).
//
// A submitted review is created UNAPPROVED, so the cached product page has
// nothing new to show: submitting must not bust it (that let any signed-in
// account force a PDP re-render on demand). Approval revalidates the page;
// deleting revalidates it only when the review was visible.
// Boundary mocks only: Prisma, the session reader, the admin gate, next/cache.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));
vi.mock("@/lib/session", () => ({ getServerSession: vi.fn(), requireAdmin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { approveReview, deleteReview, submitProductReview } from "@/lib/actions/reviews";
import { prisma } from "@/lib/prisma";
import { getServerSession, requireAdmin } from "@/lib/session";
import { revalidatePath } from "next/cache";

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>;
const mockedSession = vi.mocked(getServerSession);
const mockedRequireAdmin = vi.mocked(requireAdmin);
const mockedRevalidate = vi.mocked(revalidatePath);
vi.spyOn(console, "error").mockImplementation(() => {});

function form(rating: string, comment = "Lovely, fresh and not too sweet.") {
  const f = new FormData();
  f.set("rating", rating);
  f.set("comment", comment);
  return f;
}

beforeEach(() => {
  mockReset(mockPrisma);
  mockedSession.mockReset();
  mockedRequireAdmin.mockReset();
  mockedRevalidate.mockReset();
  mockedSession.mockResolvedValue({ user: { id: "u1", name: "Mona" } } as never);
  mockedRequireAdmin.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } } as never);
  mockPrisma.product.findUnique.mockResolvedValue({ id: "p1" } as never);
  mockPrisma.review.create.mockResolvedValue({} as never);
});

describe("submitProductReview — no cache bust for an invisible review", () => {
  it("creates the review unapproved and revalidates NOTHING", async () => {
    const res = await submitProductReview("p1", form("5"));

    expect(res).toEqual({ success: true, message: "Thank you! Your review is pending admin approval." });
    expect(mockPrisma.review.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ productId: "p1", userId: "u1", authorName: "Mona", isApproved: false }),
    });
    expect(mockedRevalidate).not.toHaveBeenCalled();
  });

  it("a repeat review (P2002) and a refused one don't revalidate either", async () => {
    mockPrisma.review.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    expect(await submitProductReview("p1", form("4"))).toEqual({
      success: false,
      error: "You've already reviewed this product.",
    });
    expect((await submitProductReview("p1", form("9"))).success).toBe(false);
    expect(mockedRevalidate).not.toHaveBeenCalled();
  });

  it("still refuses a guest and a deleted product", async () => {
    mockedSession.mockResolvedValueOnce(null);
    expect((await submitProductReview("p1", form("5"))).success).toBe(false);
    mockPrisma.product.findUnique.mockResolvedValueOnce(null);
    expect(await submitProductReview("gone", form("5"))).toEqual({
      success: false,
      error: "This product no longer exists.",
    });
    expect(mockPrisma.review.create).not.toHaveBeenCalled();
  });
});

describe("moderation — the product page is revalidated only when visibility changes", () => {
  it("approving revalidates the queue AND the product page", async () => {
    mockPrisma.review.update.mockResolvedValue({ product: { slug: "kunafa" } } as never);

    expect((await approveReview("r1")).success).toBe(true);

    expect(mockedRevalidate).toHaveBeenCalledWith("/admin/reviews");
    expect(mockedRevalidate).toHaveBeenCalledWith("/product/kunafa");
  });

  it("deleting an APPROVED (visible) review revalidates the product page", async () => {
    mockPrisma.review.delete.mockResolvedValue({ isApproved: true, product: { slug: "kunafa" } } as never);

    await deleteReview("r1");

    expect(mockedRevalidate).toHaveBeenCalledWith("/product/kunafa");
  });

  it("deleting a still-PENDING review touches only the queue", async () => {
    mockPrisma.review.delete.mockResolvedValue({ isApproved: false, product: { slug: "kunafa" } } as never);

    await deleteReview("r1");

    expect(mockedRevalidate).toHaveBeenCalledWith("/admin/reviews");
    expect(mockedRevalidate).not.toHaveBeenCalledWith("/product/kunafa");
  });
});
