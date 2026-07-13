// ─────────────────────────────────────────────────────────────────────────────
// Catalog management — variant-deletion integrity suite.
//
// The invariant (@rules/database.md): a ProductVariant that has ever been
// ordered CANNOT be hard-deleted — `OrderItem.variant` is `onDelete: Restrict`,
// so destroying it would destroy order history. The system defends this with
// caught P2003s:
//
//   • updateProduct — reconciles the variant list. A variant the admin REMOVED
//     is hard-deleted if free, but if the delete raises P2003 it is ARCHIVED
//     instead: `{ isAvailable: false, sku: null }` (hidden + SKU freed), counted
//     as `archivedCount`. This cleanup runs POST-COMMIT — deliberately OUTSIDE
//     the core-update `$transaction` — so a P2003 can never roll back an
//     otherwise-valid product update.
//   • deleteProduct — hard-deletes the product (variants/reviews cascade at the
//     DB level). An ordered product hits P2003 and is REFUSED with a clean
//     message (not soft-deleted) so its history + media survive.
//
// Boundary mocks only (Prisma, session, next/cache, uploadthing); the real Zod
// validators and prismaErrorCode run. Every assertion targets the exact payload.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));
vi.mock("@/lib/session", () => ({ requireAdmin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/uploadthing-server", () => ({ deleteUploadedFiles: vi.fn() }));

import { updateProduct, deleteProduct } from "@/app/admin/products/actions";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { deleteUploadedFiles } from "@/lib/uploadthing-server";
import type { ProductUpdateInput } from "@/lib/validators";

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>;
const mockedRequireAdmin = vi.mocked(requireAdmin);
const mockedDeleteFiles = vi.mocked(deleteUploadedFiles);

// Swallowed best-effort failures log via console.error — keep CI output clean.
vi.spyOn(console, "error").mockImplementation(() => {});

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** A Prisma known-request error carrying `code` (what prismaErrorCode reads). */
const prismaError = (code: string) => Object.assign(new Error(`Prisma ${code}`), { code });

/** A valid ProductUpdateInput. Variants default to a single NEW line (no id),
 *  so `productVariant.update` is only ever exercised by the ARCHIVE path. */
function updateInput(
  variants: Array<{ id?: string; name: string; price: number; sku?: string }> = [
    { name: "New Large", price: 100 },
  ],
): ProductUpdateInput {
  return {
    name: "Chocolate Cake",
    slug: "chocolate-cake",
    description: "",
    categoryId: "cat1",
    images: [],
    isAvailable: true,
    isFeatured: false,
    variants,
  } as ProductUpdateInput;
}

/** Wire `product.findUnique`: the by-id lookup returns a product owning
 *  `variantIds`; the by-slug uniqueness pre-check returns null (no conflict). */
function stubExistingProduct(variantIds: string[], images: string[] = []) {
  mockPrisma.product.findUnique.mockImplementation((args: { where: { slug?: string } }) =>
    Promise.resolve(
      args.where.slug !== undefined
        ? null
        : { id: "prod1", slug: "chocolate-cake", images, variants: variantIds.map((id) => ({ id })) },
    ) as never,
  );
}

beforeEach(() => {
  mockReset(mockPrisma);
  mockedRequireAdmin.mockReset();
  mockedDeleteFiles.mockReset();

  mockedRequireAdmin.mockResolvedValue(undefined as never); // admin gate passes
  mockedDeleteFiles.mockResolvedValue(undefined as never);

  // Interactive $transaction: run the callback with the deep mock as `tx`.
  mockPrisma.$transaction.mockImplementation((async (cb: (tx: typeof mockPrisma) => unknown) =>
    cb(mockPrisma)) as never);

  // Default happy-path writes.
  mockPrisma.product.update.mockResolvedValue({} as never);
  mockPrisma.product.delete.mockResolvedValue({} as never);
  mockPrisma.productVariant.update.mockResolvedValue({} as never);
  mockPrisma.productVariant.create.mockResolvedValue({} as never);
  mockPrisma.productVariant.delete.mockResolvedValue({} as never);
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. Foreign-key defense (P2003) → soft-delete (archive) fallback
// ═════════════════════════════════════════════════════════════════════════════

describe("updateProduct — P2003 archives an ordered variant", () => {
  it("catches P2003 on delete and falls back to update { isAvailable: false, sku: null }", async () => {
    stubExistingProduct(["v_ordered"]); // product owns v_ordered; payload omits it
    mockPrisma.productVariant.delete.mockRejectedValue(prismaError("P2003")); // FK Restrict

    const res = await updateProduct("prod1", updateInput());

    expect(res).toEqual({ success: true, archivedCount: 1 });
    // The hard delete was attempted first…
    expect(mockPrisma.productVariant.delete).toHaveBeenCalledWith({ where: { id: "v_ordered" } });
    // …then the EXACT archive payload — hides the line AND frees its SKU for reuse.
    expect(mockPrisma.productVariant.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.productVariant.update).toHaveBeenCalledWith({
      where: { id: "v_ordered" },
      data: { isAvailable: false, sku: null },
    });
  });

  it("archives every ordered variant and reports the full count", async () => {
    stubExistingProduct(["v1", "v2"]);
    mockPrisma.productVariant.delete.mockRejectedValue(prismaError("P2003"));

    const res = await updateProduct("prod1", updateInput());

    expect(res).toEqual({ success: true, archivedCount: 2 });
    for (const id of ["v1", "v2"]) {
      expect(mockPrisma.productVariant.update).toHaveBeenCalledWith({
        where: { id },
        data: { isAvailable: false, sku: null },
      });
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Clean hard delete (no relational ties) — no soft-delete fallback
// ═════════════════════════════════════════════════════════════════════════════

describe("updateProduct — clean hard delete of an untied variant", () => {
  it("hard-deletes a removed variant with no order ties and does NOT archive", async () => {
    stubExistingProduct(["v_orphan"]); // never ordered → delete succeeds (default mock)

    const res = await updateProduct("prod1", updateInput());

    expect(res).toEqual({ success: true, archivedCount: 0 });
    expect(mockPrisma.productVariant.delete).toHaveBeenCalledWith({ where: { id: "v_orphan" } });
    expect(mockPrisma.productVariant.update).not.toHaveBeenCalled(); // no soft-delete fallback
  });

  it("mixes a clean delete with an archived (ordered) variant → archivedCount 1", async () => {
    stubExistingProduct(["v_clean", "v_ordered"]);
    mockPrisma.productVariant.delete.mockImplementation(((args: { where: { id: string } }) =>
      args.where.id === "v_ordered"
        ? Promise.reject(prismaError("P2003"))
        : Promise.resolve({})) as never);

    const res = await updateProduct("prod1", updateInput());

    expect(res).toEqual({ success: true, archivedCount: 1 });
    expect(mockPrisma.productVariant.update).toHaveBeenCalledWith({
      where: { id: "v_ordered" },
      data: { isAvailable: false, sku: null },
    });
    // The cleanly-deleted variant is NEVER archived.
    expect(mockPrisma.productVariant.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "v_clean" } }),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Transaction safety — the archive is POST-COMMIT, isolated from the update
// ═════════════════════════════════════════════════════════════════════════════

describe("updateProduct — post-commit isolation (a P2003 never rolls back the update)", () => {
  it("commits the core update inside $transaction, then handles the P2003 OUTSIDE it", async () => {
    stubExistingProduct(["v_ordered"]);
    mockPrisma.productVariant.delete.mockRejectedValue(prismaError("P2003"));

    const res = await updateProduct("prod1", updateInput());

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.product.update).toHaveBeenCalledTimes(1); // the update committed…
    expect(res.success).toBe(true); // …and the FK failure did NOT reject/roll it back
  });

  it("swallows a failed archive (best-effort): still succeeds, that variant uncounted", async () => {
    stubExistingProduct(["v_ordered"]);
    mockPrisma.productVariant.delete.mockRejectedValue(prismaError("P2003"));
    mockPrisma.productVariant.update.mockRejectedValue(new Error("archive write failed"));

    const res = await updateProduct("prod1", updateInput());
    expect(res).toEqual({ success: true, archivedCount: 0 });
  });

  it("logs and skips a NON-P2003 delete error (only P2003 archives), still succeeding", async () => {
    stubExistingProduct(["v_x"]);
    mockPrisma.productVariant.delete.mockRejectedValue(prismaError("P2025"));

    const res = await updateProduct("prod1", updateInput());
    expect(res).toEqual({ success: true, archivedCount: 0 });
    expect(mockPrisma.productVariant.update).not.toHaveBeenCalled(); // not archived
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. deleteProduct — whole-product delete: DB cascade + FK refusal
// ═════════════════════════════════════════════════════════════════════════════

describe("deleteProduct — cascade delete & FK defense", () => {
  it("hard-deletes an untied product (variants cascade at the DB level) and purges its media", async () => {
    mockPrisma.product.findUnique.mockResolvedValue({ images: ["a.jpg", "b.jpg"] } as never);

    const res = await deleteProduct("prod1");

    expect(res).toEqual({ success: true });
    expect(mockPrisma.product.delete).toHaveBeenCalledWith({ where: { id: "prod1" } });
    expect(mockedDeleteFiles).toHaveBeenCalledWith(["a.jpg", "b.jpg"]);
  });

  it("REFUSES to delete a product tied to orders (P2003) and preserves its media", async () => {
    mockPrisma.product.findUnique.mockResolvedValue({ images: ["a.jpg"] } as never);
    mockPrisma.product.delete.mockRejectedValue(prismaError("P2003"));

    const res = await deleteProduct("prod1");

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toContain("appears in existing orders");
      expect(res.error).toContain("Out of Stock");
    }
    expect(mockedDeleteFiles).not.toHaveBeenCalled(); // row survives → media must too
  });

  it("returns 'no longer exists' when the product is already gone (findUnique null)", async () => {
    mockPrisma.product.findUnique.mockResolvedValue(null as never);

    const res = await deleteProduct("ghost");
    expect(res).toEqual({ success: false, error: "That product no longer exists." });
    expect(mockPrisma.product.delete).not.toHaveBeenCalled();
  });

  it("translates a P2025 (deleted mid-op) into 'no longer exists'", async () => {
    mockPrisma.product.findUnique.mockResolvedValue({ images: [] } as never);
    mockPrisma.product.delete.mockRejectedValue(prismaError("P2025"));

    const res = await deleteProduct("prod1");
    expect(res).toEqual({ success: false, error: "That product no longer exists." });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Admin gate
// ═════════════════════════════════════════════════════════════════════════════

describe("catalog actions — admin gate", () => {
  it("deleteProduct rejects when requireAdmin throws (non-admin caller), touching no data", async () => {
    mockedRequireAdmin.mockRejectedValueOnce(new Error("Unauthorized: admin access required."));
    await expect(deleteProduct("prod1")).rejects.toThrow("Unauthorized");
    expect(mockPrisma.product.delete).not.toHaveBeenCalled();
  });
});
