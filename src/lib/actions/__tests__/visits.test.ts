// ─────────────────────────────────────────────────────────────────────────────
// Visitor analytics — the public write (src/lib/actions/visits.ts).
//
// These tests pin:
//
//   • BOTS — a missing or automated User-Agent records nothing (and still
//     answers success, so a scraper learns nothing), checked before parsing.
//   • VALIDATION — the shared visitBatchSchema: a non-UUID visitor, a query
//     string in the path, an unknown type or an over-size batch never reaches
//     Prisma.
//   • WRITE SHAPE — one createMany per batch, the client kinds mapped onto the
//     VisitEventType enum, optional ids stored as null.
//   • FAILURE — a Prisma error becomes the generic envelope, never a throw.
//
// MOCKING — @/lib/prisma (deep) and next/headers (the User-Agent); the
// validators run for real.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));
const requestHeaders = new Headers();
vi.mock("next/headers", () => ({ headers: vi.fn(async () => requestHeaders) }));

import { recordVisitEvents } from "@/lib/actions/visits";
import { isBotUserAgent, VISIT_BATCH_MAX } from "@/lib/validators";
import { VisitEventType } from "@/generated/prisma/enums";

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>;
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

const VISITOR = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
const CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

function asBrowser(ua: string | null = CHROME) {
  requestHeaders.delete("user-agent");
  if (ua) requestHeaders.set("user-agent", ua);
}

beforeEach(() => {
  mockReset(mockPrisma);
  mockPrisma.visitEvent.createMany.mockResolvedValue({ count: 1 });
  asBrowser();
});

afterAll(() => consoleError.mockRestore());

describe("recordVisitEvents — bots", () => {
  it.each([
    ["Googlebot", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
    ["headless Chrome", "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/130.0.0.0 Safari/537.36"],
    ["WhatsApp link preview", "WhatsApp/2.23.20.0"],
    ["curl", "curl/8.4.0"],
    ["Lighthouse", "Mozilla/5.0 Chrome/130 Safari/537.36 Chrome-Lighthouse"],
  ])("drops a %s request without inserting", async (_label, ua) => {
    asBrowser(ua);

    const result = await recordVisitEvents({ visitorId: VISITOR, events: [{ type: "view", path: "/" }] });

    expect(result).toEqual({ success: true, recorded: 0 });
    expect(mockPrisma.visitEvent.createMany).not.toHaveBeenCalled();
  });

  it("drops a request with no User-Agent at all", async () => {
    asBrowser(null);

    const result = await recordVisitEvents({ visitorId: VISITOR, events: [{ type: "view", path: "/" }] });

    expect(result).toEqual({ success: true, recorded: 0 });
    expect(mockPrisma.visitEvent.createMany).not.toHaveBeenCalled();
  });

  it("lets ordinary browsers through", () => {
    expect(isBotUserAgent(CHROME)).toBe(false);
    expect(
      isBotUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(false);
  });
});

describe("recordVisitEvents — validation", () => {
  it.each([
    ["a non-UUID visitor id", { visitorId: "user_42", events: [{ type: "view", path: "/" }] }],
    ["a query string in the path", { visitorId: VISITOR, events: [{ type: "view", path: "/shop?q=kunafa" }] }],
    ["a path that isn't a pathname", { visitorId: VISITOR, events: [{ type: "view", path: "https://evil.example/" }] }],
    ["an unknown event type", { visitorId: VISITOR, events: [{ type: "purchase", path: "/" }] }],
    ["an empty batch", { visitorId: VISITOR, events: [] }],
    [
      "an over-size batch",
      { visitorId: VISITOR, events: Array.from({ length: VISIT_BATCH_MAX + 1 }, () => ({ type: "view", path: "/" })) },
    ],
    ["junk", "not an object"],
  ])("refuses %s", async (_label, payload) => {
    const result = await recordVisitEvents(payload);

    expect(result).toEqual({ success: false, error: "Invalid visit events." });
    expect(mockPrisma.visitEvent.createMany).not.toHaveBeenCalled();
  });
});

describe("recordVisitEvents — write", () => {
  it("inserts a whole batch in ONE createMany, mapping kinds onto the enum", async () => {
    const result = await recordVisitEvents({
      visitorId: VISITOR,
      events: [
        { type: "view", path: "/product/kunafa" },
        { type: "product_view", path: "/product/kunafa", productId: "prod_1" },
        { type: "add_to_cart", path: "/product/kunafa", productId: "prod_1" },
        { type: "checkout_start", path: "/checkout" },
      ],
    });

    expect(result).toEqual({ success: true, recorded: 4 });
    expect(mockPrisma.visitEvent.createMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.visitEvent.createMany).toHaveBeenCalledWith({
      data: [
        { type: VisitEventType.VIEW, visitorId: VISITOR, path: "/product/kunafa", productId: null, branchId: null },
        { type: VisitEventType.PRODUCT_VIEW, visitorId: VISITOR, path: "/product/kunafa", productId: "prod_1", branchId: null },
        { type: VisitEventType.ADD_TO_CART, visitorId: VISITOR, path: "/product/kunafa", productId: "prod_1", branchId: null },
        { type: VisitEventType.CHECKOUT_START, visitorId: VISITOR, path: "/checkout", productId: null, branchId: null },
      ],
    });
  });

  it("turns a database failure into the generic envelope", async () => {
    mockPrisma.visitEvent.createMany.mockRejectedValue(new Error("connection reset"));

    const result = await recordVisitEvents({ visitorId: VISITOR, events: [{ type: "view", path: "/" }] });

    expect(result).toEqual({ success: false, error: "Could not record the visit." });
    expect(consoleError).toHaveBeenCalled();
  });
});
