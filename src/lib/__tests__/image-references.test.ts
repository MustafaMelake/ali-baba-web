// ─────────────────────────────────────────────────────────────────────────────
// findReferencedImageUrls — the reference check behind every R2 purge (audit
// M-1). After the R2 migration one object can back several rows, so a purge
// must spare any URL another row/column still points at. These specs pin that
// every image column is consulted and that only URLs actually found come back.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));

import { findReferencedImageUrls } from "@/lib/image-references";
import { prisma } from "@/lib/prisma";

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>;

const A = "https://img.alibaba.test/products/a.webp";
const B = "https://img.alibaba.test/hero/b.png";
const C = "https://img.alibaba.test/categories/c.jpg";

beforeEach(() => {
  mockReset(mockPrisma);
  mockPrisma.category.findMany.mockResolvedValue([] as never);
  mockPrisma.location.findMany.mockResolvedValue([] as never);
  mockPrisma.product.findMany.mockResolvedValue([] as never);
  mockPrisma.heroSlide.findMany.mockResolvedValue([] as never);
  mockPrisma.collection.findMany.mockResolvedValue([] as never);
});

describe("findReferencedImageUrls", () => {
  it("makes no query for an empty list", async () => {
    await expect(findReferencedImageUrls([])).resolves.toEqual(new Set());
    expect(mockPrisma.product.findMany).not.toHaveBeenCalled();
  });

  it("consults every image column: Category, Location, Product.images[], HeroSlide (both), Collection", async () => {
    await findReferencedImageUrls([A, B]);

    const list = [A, B];
    expect(mockPrisma.category.findMany).toHaveBeenCalledWith({
      where: { image: { in: list } },
      select: { image: true },
    });
    expect(mockPrisma.location.findMany).toHaveBeenCalledWith({
      where: { imageUrl: { in: list } },
      select: { imageUrl: true },
    });
    expect(mockPrisma.product.findMany).toHaveBeenCalledWith({
      where: { images: { hasSome: list } },
      select: { images: true },
    });
    expect(mockPrisma.heroSlide.findMany).toHaveBeenCalledWith({
      where: { OR: [{ imageDesktop: { in: list } }, { imageMobile: { in: list } }] },
      select: { imageDesktop: true, imageMobile: true },
    });
    expect(mockPrisma.collection.findMany).toHaveBeenCalledWith({
      where: { image: { in: list } },
      select: { image: true },
    });
  });

  it("returns only the asked-for URLs that some row still holds", async () => {
    mockPrisma.product.findMany.mockResolvedValue([
      { images: [A, "https://img.alibaba.test/products/other.webp"] },
    ] as never);
    mockPrisma.heroSlide.findMany.mockResolvedValue([{ imageDesktop: "/x.jpg", imageMobile: B }] as never);

    await expect(findReferencedImageUrls([A, B, C])).resolves.toEqual(new Set([A, B]));
  });

  it("de-dupes the input before querying", async () => {
    await findReferencedImageUrls([A, A, A]);

    expect(mockPrisma.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { image: { in: [A] } } }),
    );
  });

  it("lets a query failure propagate — the caller treats it as 'keep everything'", async () => {
    mockPrisma.location.findMany.mockRejectedValue(new Error("connection reset"));

    await expect(findReferencedImageUrls([A])).rejects.toThrow("connection reset");
  });
});
