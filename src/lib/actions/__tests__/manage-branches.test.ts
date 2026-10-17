// ─────────────────────────────────────────────────────────────────────────────
// Branch management — the delivery-fee rule (src/lib/actions/manage-branches.ts).
//
// A branch's fee is billed by placeOrder on every delivery to that area, and
// the branch form is the second door to it (the Settings fee sheet is the
// first). Both obey one rule, parseDeliveryFee: 0–10,000 EGP, rounded to
// piastres — so neither door is laxer than the other. A missing fee falls back
// to the schema default, 35 EGP.
//
// MOCKING — same strategy as promotions.test.ts: @/lib/prisma deep-mocked,
// @/lib/session and next/cache stubbed, the real gate and validators run.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));
vi.mock("@/lib/session", () => ({ getServerSession: vi.fn(), requireAdmin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createBranch, updateBranch } from "@/lib/actions/manage-branches";
import { requireAdmin } from "@/lib/session";

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>;

const branch = { name: "Maadi", slug: "maadi", isActive: true };
const FEE_ERROR = "Delivery fee must be a number between 0 and 10,000.";

beforeEach(() => {
  mockReset(mockPrisma);
  vi.mocked(requireAdmin).mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } } as never);
  mockPrisma.branch.create.mockResolvedValue({ id: "branch_maadi" } as never);
  mockPrisma.branch.update.mockResolvedValue({ id: "branch_maadi" } as never);
});

describe.each([
  ["createBranch", (deliveryFee?: number) => createBranch({ ...branch, deliveryFee }), () => mockPrisma.branch.create],
  ["updateBranch", (deliveryFee?: number) => updateBranch("branch_maadi", { ...branch, deliveryFee }), () => mockPrisma.branch.update],
] as const)("%s — delivery fee", (_name, save, write) => {
  it.each([10_000.01, 25_000, -1, Number.NaN])("refuses %s EGP and writes nothing", async (fee) => {
    const result = await save(fee);

    expect(result).toEqual({ success: false, error: FEE_ERROR });
    expect(write()).not.toHaveBeenCalled();
  });

  it.each([
    [10_000, 10_000],
    [0, 0],
    [40.125, 40.13],
    [undefined, 35],
  ])("saves %s EGP as %s", async (fee, saved) => {
    const result = await save(fee);

    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(write()).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deliveryFee: saved }) }),
    );
  });
});
