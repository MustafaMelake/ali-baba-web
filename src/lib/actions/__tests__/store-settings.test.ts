// ─────────────────────────────────────────────────────────────────────────────
// Pricing settings — updateVatSettings / updateDeliveryFees
// (src/lib/actions/store-settings.ts).
//
// These two knobs feed every order total (placeOrder) and the /cart + checkout
// previews, so the specs pin:
//   • ADMIN-only, answered with an envelope rather than a throw;
//   • VAT arrives as a percentage, is bounded (0, 100] even while disabled, and
//     is stored as a 4-dp fraction on the StoreSettings singleton;
//   • every delivery fee obeys the shared rule (parseDeliveryFee: 0–10,000 EGP,
//     2 dp), and the whole fee sheet saves in ONE transaction or not at all;
//   • the /cart preview is revalidated after either change.
//
// MOCKING — same strategy as promotions.test.ts: @/lib/prisma deep-mocked,
// @/lib/session and next/cache stubbed, the real gate and validators run.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));
vi.mock("@/lib/session", () => ({ getServerSession: vi.fn(), requireAdmin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateDeliveryFees, updateStoreWhatsapp, updateVatSettings } from "@/lib/actions/store-settings";
import { requireAdmin } from "@/lib/session";
import { revalidatePath } from "next/cache";

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>;
const mockedRequireAdmin = vi.mocked(requireAdmin);
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  mockReset(mockPrisma);
  vi.mocked(revalidatePath).mockReset();
  mockedRequireAdmin.mockReset();
  mockedRequireAdmin.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } } as never);
  mockPrisma.storeSettings.upsert.mockResolvedValue({ id: "store" } as never);
  mockPrisma.branch.update.mockResolvedValue({ id: "branch" } as never);
  mockPrisma.$transaction.mockResolvedValue([] as never);
  consoleError.mockClear();
});

afterAll(() => {
  consoleError.mockRestore();
});

/** The `data` each upsert/update would write, as passed into the batch. */
function upsertCall() {
  return mockPrisma.storeSettings.upsert.mock.calls[0]?.[0];
}

describe("updateVatSettings", () => {
  it("answers a non-admin with an error envelope and writes nothing", async () => {
    mockedRequireAdmin.mockRejectedValue(new Error("nope"));

    const result = await updateVatSettings({ isVatEnabled: true, vatRatePercent: 14 });

    expect(result).toEqual({ success: false, error: "Unauthorized: admin access required." });
    expect(mockPrisma.storeSettings.upsert).not.toHaveBeenCalled();
  });

  it.each([0, -5, 100.01, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses a %s%% rate — even with VAT switched off",
    async (vatRatePercent) => {
      const result = await updateVatSettings({ isVatEnabled: false, vatRatePercent });

      expect(result).toEqual({ success: false, error: "VAT rate must be between 0 and 100 percent." });
      expect(mockPrisma.storeSettings.upsert).not.toHaveBeenCalled();
    },
  );

  it.each([
    [14, 0.14],
    [14.25, 0.1425],
    [100, 1],
  ])("stores %s%% as the fraction %s on the settings singleton", async (percent, fraction) => {
    const result = await updateVatSettings({ isVatEnabled: true, vatRatePercent: percent });

    expect(result).toEqual({ success: true });
    expect(upsertCall()).toEqual(
      expect.objectContaining({
        where: { id: "store" },
        update: { vatRate: fraction, isVatEnabled: true },
        create: { id: "store", vatRate: fraction, isVatEnabled: true },
      }),
    );
  });

  it("refreshes the cart preview, which shows the VAT line", async () => {
    await updateVatSettings({ isVatEnabled: true, vatRatePercent: 14 });

    expect(revalidatePath).toHaveBeenCalledWith("/cart");
  });
});

describe("updateDeliveryFees", () => {
  it("answers a non-admin with an error envelope and writes nothing", async () => {
    mockedRequireAdmin.mockRejectedValue(new Error("nope"));

    const result = await updateDeliveryFees({ defaultFee: 35, branchFees: [] });

    expect(result).toEqual({ success: false, error: "Unauthorized: admin access required." });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([-1, 10_000.01, Number.NaN])("refuses a %s EGP default fee", async (defaultFee) => {
    const result = await updateDeliveryFees({ defaultFee, branchFees: [] });

    expect(result).toEqual({
      success: false,
      error: "The default delivery fee must be a number between 0 and 10,000.",
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses the whole sheet when any one branch fee is out of range", async () => {
    const result = await updateDeliveryFees({
      defaultFee: 35,
      branchFees: [
        { branchId: "branch_maadi", fee: 40 },
        { branchId: "branch_zamalek", fee: 25_000 },
      ],
    });

    expect(result).toEqual({
      success: false,
      error: "Every branch fee must be a number between 0 and 10,000.",
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.branch.update).not.toHaveBeenCalled();
  });

  it("saves the default and every branch fee in one transaction, rounded to piastres", async () => {
    const result = await updateDeliveryFees({
      defaultFee: 10_000,
      branchFees: [
        { branchId: "branch_maadi", fee: 40.125 },
        { branchId: " ", fee: 99 }, // a blank row is skipped, not an error
        { branchId: "branch_zamalek", fee: 0 },
      ],
    });

    expect(result).toEqual({ success: true });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.$transaction.mock.calls[0][0]).toHaveLength(3); // settings + 2 branches
    expect(upsertCall()).toEqual(expect.objectContaining({ update: { defaultDeliveryFee: 10_000 } }));
    expect(mockPrisma.branch.update.mock.calls.map(([args]) => [args.where, args.data])).toEqual([
      [{ id: "branch_maadi" }, { deliveryFee: 40.13 }],
      [{ id: "branch_zamalek" }, { deliveryFee: 0 }],
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/cart");
  });

  it("translates a branch deleted mid-edit (P2025)", async () => {
    mockPrisma.$transaction.mockRejectedValue(Object.assign(new Error("gone"), { code: "P2025" }));

    const result = await updateDeliveryFees({
      defaultFee: 35,
      branchFees: [{ branchId: "branch_gone", fee: 40 }],
    });

    expect(result).toEqual({
      success: false,
      error: "One of those branches no longer exists. Refresh and try again.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateStoreWhatsapp", () => {
  it("normalizes to canonical E.164 and upserts the singleton row", async () => {
    const res = await updateStoreWhatsapp({ whatsappNumber: "0100 123 4567" });
    expect(res).toEqual({ success: true });
    expect(mockPrisma.storeSettings.upsert).toHaveBeenCalledWith({
      where: { id: "store" },
      update: { whatsappNumber: "+201001234567" },
      create: { id: "store", whatsappNumber: "+201001234567" },
      select: { id: true },
    });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/forgot-password");
  });

  it("clears the number on a blank save", async () => {
    await updateStoreWhatsapp({ whatsappNumber: "  " });
    expect(mockPrisma.storeSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { whatsappNumber: null } }),
    );
  });

  it("refuses a non-mobile number without writing", async () => {
    const res = await updateStoreWhatsapp({ whatsappNumber: "02 2345 6789" });
    expect(res).toEqual({
      success: false,
      error: "Enter an Egyptian mobile number, e.g. 010 1234 5678.",
    });
    expect(mockPrisma.storeSettings.upsert).not.toHaveBeenCalled();
  });

  it("is ADMIN-only", async () => {
    mockedRequireAdmin.mockRejectedValue(new Error("not admin"));
    const res = await updateStoreWhatsapp({ whatsappNumber: "01001234567" });
    expect(res.success).toBe(false);
    expect(mockPrisma.storeSettings.upsert).not.toHaveBeenCalled();
  });
});
