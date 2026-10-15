// ─────────────────────────────────────────────────────────────────────────────
// Marketing calendar reminders — action suite (src/lib/actions/marketing-events.ts).
//
// Pins the house contract for the three ADMIN-only mutations:
//   • the gate runs FIRST — a non-admin writes nothing and gets the envelope;
//   • the shared marketingEventSchema is re-parsed server-side (dates, order,
//     span, whole-percent target, blank → NULL normalization);
//   • dates are stored as UTC-midnight `@db.Date` values of the Cairo day keys;
//   • P2025 becomes "no longer exists", anything else a logged generic error;
//   • every successful write revalidates /admin/calendar — and nothing else.
//
// MOCKING — same strategy as faqs.test.ts: @/lib/prisma deep-mocked,
// @/lib/session and next/cache stubbed, the real action-utils gate runs.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));
vi.mock("@/lib/session", () => ({ getServerSession: vi.fn(), requireAdmin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  createMarketingEvent,
  deleteMarketingEvent,
  updateMarketingEvent,
} from "@/lib/actions/marketing-events";
import { requireAdmin } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { MarketingEventType } from "@/generated/prisma/enums";

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>;
const mockedRequireAdmin = vi.mocked(requireAdmin);
const mockedRevalidate = vi.mocked(revalidatePath);
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

const UNAUTHORIZED = "Unauthorized: admin access required.";
const notFound = () => Object.assign(new Error("Record not found"), { code: "P2025" });

/** A valid form payload; override per test. */
function payload(overrides: Record<string, unknown> = {}) {
  return {
    title: "  Summer Flash Sale  ",
    type: MarketingEventType.CAMPAIGN,
    startDate: "2026-07-01",
    endDate: "2026-07-07",
    targetDiscountPercent: 20,
    strategy: "Bundle petits fours",
    notes: "",
    ...overrides,
  };
}

beforeEach(() => {
  mockReset(mockPrisma);
  mockedRequireAdmin.mockReset();
  mockedRevalidate.mockClear();
  consoleError.mockClear();
  mockedRequireAdmin.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } } as never);
  mockPrisma.marketingEvent.create.mockResolvedValue({ id: "me_1" } as never);
  mockPrisma.marketingEvent.update.mockResolvedValue({ id: "me_1" } as never);
  mockPrisma.marketingEvent.delete.mockResolvedValue({ id: "me_1" } as never);
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe("ADMIN gate", () => {
  it.each([
    ["create", () => createMarketingEvent(payload())],
    ["update", () => updateMarketingEvent("me_1", payload())],
    ["delete", () => deleteMarketingEvent("me_1")],
  ])("%s: a non-admin writes nothing and gets the envelope", async (_name, call) => {
    mockedRequireAdmin.mockRejectedValue(new Error("not admin"));

    const result = await call();

    expect(result).toEqual({ success: false, error: UNAUTHORIZED });
    expect(mockPrisma.marketingEvent.create).not.toHaveBeenCalled();
    expect(mockPrisma.marketingEvent.update).not.toHaveBeenCalled();
    expect(mockPrisma.marketingEvent.delete).not.toHaveBeenCalled();
    expect(mockedRevalidate).not.toHaveBeenCalled();
  });
});

describe("createMarketingEvent", () => {
  it("writes the normalized row with UTC-midnight dates and revalidates only the calendar", async () => {
    const result = await createMarketingEvent(payload());

    expect(result).toEqual({ success: true, id: "me_1" });
    expect(mockPrisma.marketingEvent.create).toHaveBeenCalledWith({
      data: {
        title: "Summer Flash Sale",
        type: MarketingEventType.CAMPAIGN,
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-07-07T00:00:00.000Z"),
        notes: null, // blank → NULL
        strategy: "Bundle petits fours",
        targetDiscountPercent: 20,
      },
      select: { id: true },
    });
    expect(mockedRevalidate).toHaveBeenCalledTimes(1);
    expect(mockedRevalidate).toHaveBeenCalledWith("/admin/calendar");
  });

  it("accepts a single-day reminder with no target", async () => {
    const result = await createMarketingEvent(
      payload({ endDate: "2026-07-01", targetDiscountPercent: null, strategy: undefined }),
    );

    expect(result.success).toBe(true);
    expect(mockPrisma.marketingEvent.create.mock.calls[0][0].data).toMatchObject({
      targetDiscountPercent: null,
      strategy: null,
    });
  });

  it.each([
    [{ endDate: "2026-06-30" }, "End date can't be before the start date."],
    [{ startDate: "2026-02-30" }, "Pick a valid date."],
    [{ endDate: "2027-07-07" }, "A reminder can span at most a year."],
    [{ targetDiscountPercent: 0 }, "Target discount must be at least 1%."],
    [{ targetDiscountPercent: 101 }, "Target discount can't exceed 100%."],
    [{ targetDiscountPercent: 12.5 }, "Use a whole percentage."],
    [{ title: " x " }, "Title must be at least 2 characters."],
    [{ type: "FLASH_SALE" }, "Pick an event type."],
  ])("rejects %j before touching the database", async (overrides, message) => {
    const result = await createMarketingEvent(payload(overrides));

    expect(result).toEqual({ success: false, error: message });
    expect(mockPrisma.marketingEvent.create).not.toHaveBeenCalled();
  });

  it("logs an unexpected failure and returns the generic envelope", async () => {
    mockPrisma.marketingEvent.create.mockRejectedValue(new Error("connection reset"));

    const result = await createMarketingEvent(payload());

    expect(result).toEqual({
      success: false,
      error: "Could not save the reminder. Please try again.",
    });
    expect(consoleError).toHaveBeenCalled();
  });
});

describe("updateMarketingEvent", () => {
  it("updates the row by id", async () => {
    const result = await updateMarketingEvent("me_1", payload({ title: "Kahk pre-orders" }));

    expect(result).toEqual({ success: true });
    expect(mockPrisma.marketingEvent.update).toHaveBeenCalledWith({
      where: { id: "me_1" },
      data: expect.objectContaining({ title: "Kahk pre-orders" }),
    });
    expect(mockedRevalidate).toHaveBeenCalledWith("/admin/calendar");
  });

  it("translates P2025 into 'no longer exists'", async () => {
    mockPrisma.marketingEvent.update.mockRejectedValue(notFound());

    const result = await updateMarketingEvent("gone", payload());

    expect(result).toEqual({ success: false, error: "This reminder no longer exists." });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("refuses a missing id without querying", async () => {
    const result = await updateMarketingEvent("", payload());

    expect(result.success).toBe(false);
    expect(mockPrisma.marketingEvent.update).not.toHaveBeenCalled();
  });
});

describe("deleteMarketingEvent", () => {
  it("deletes the row by id", async () => {
    const result = await deleteMarketingEvent("me_1");

    expect(result).toEqual({ success: true });
    expect(mockPrisma.marketingEvent.delete).toHaveBeenCalledWith({ where: { id: "me_1" } });
    expect(mockedRevalidate).toHaveBeenCalledWith("/admin/calendar");
  });

  it("translates P2025 into 'no longer exists'", async () => {
    mockPrisma.marketingEvent.delete.mockRejectedValue(notFound());

    const result = await deleteMarketingEvent("gone");

    expect(result).toEqual({ success: false, error: "This reminder no longer exists." });
  });
});
