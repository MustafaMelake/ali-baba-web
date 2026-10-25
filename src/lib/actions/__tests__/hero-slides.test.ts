// ─────────────────────────────────────────────────────────────────────────────
// Hero slide actions — unit/integration suite (src/lib/actions/hero-slides.ts).
//
// Locks the admin side of the homepage hero:
//
//   • GATE — every read/mutation is ADMIN-only; a rejected caller writes
//     nothing and gets the standard envelope (never a throw).
//   • VALIDATION — the shared heroSlideSchema is re-parsed server-side; Cairo
//     day keys become exact instants; `isActive` is always written explicitly
//     (the column defaults to false).
//   • ERRORS — P2025 → "no longer exists", P2003 → the picked product was
//     deleted mid-edit; anything else → a generic message.
//   • MEDIA — replaced/deleted images are purged only AFTER the write commits,
//     and only the URLs no longer referenced.
//   • FAN-OUT — every success revalidates "/" and "/admin/hero".
//
// MOCKING — same boundaries as faqs.test.ts (@/lib/prisma deep-mocked,
// @/lib/session, next/cache) plus the UploadThing purge helper.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));
vi.mock("@/lib/session", () => ({ getServerSession: vi.fn(), requireAdmin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/uploadthing-server", () => ({ deleteUploadedFiles: vi.fn() }));

import {
  createHeroSlide,
  deleteHeroSlide,
  getAdminHeroSlides,
  reorderHeroSlides,
  setHeroSlideActive,
  updateHeroSlide,
} from "@/lib/actions/hero-slides";
import { requireAdmin } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { deleteUploadedFiles } from "@/lib/uploadthing-server";
import { HERO_MAX_SLIDES } from "@/lib/validators";
import { HERO_DEFAULT_ALT } from "@/lib/hero-slides";

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>;
const mockedRequireAdmin = vi.mocked(requireAdmin);
const mockedRevalidate = vi.mocked(revalidatePath);
const mockedPurge = vi.mocked(deleteUploadedFiles);

const UNAUTHORIZED = "Unauthorized: admin access required.";

vi.spyOn(console, "error").mockImplementation(() => {});

const prismaError = (code: string) => Object.assign(new Error(code), { code });

const OLD_DESKTOP = "https://abc.ufs.sh/f/old-desktop";
const OLD_MOBILE = "https://abc.ufs.sh/f/old-mobile";

/** A valid product slide as the modal sends it. */
const input = (overrides: Record<string, unknown> = {}) => ({
  eyebrow: "New arrival",
  title: "Pistachio Kunafa",
  subtitle: "",
  ctaLabel: "Order now",
  showPrice: true,
  imageDesktop: OLD_DESKTOP,
  imageMobile: OLD_MOBILE,
  imageAlt: "A tray of pistachio kunafa",
  productId: "prod_1",
  linkUrl: null,
  isActive: true,
  startsOn: "",
  endsOn: "",
  ...overrides,
});

function expectRevalidated() {
  expect(mockedRevalidate).toHaveBeenCalledWith("/");
  expect(mockedRevalidate).toHaveBeenCalledWith("/admin/hero");
}

beforeEach(() => {
  mockReset(mockPrisma);
  mockedRequireAdmin.mockReset();
  mockedRevalidate.mockClear();
  mockedPurge.mockReset();

  mockedRequireAdmin.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } } as never);

  mockPrisma.heroSlide.count.mockResolvedValue(0 as never);
  mockPrisma.heroSlide.aggregate.mockResolvedValue({ _max: { order: null } } as never);
  mockPrisma.heroSlide.create.mockResolvedValue({ id: "slide_new" } as never);
  mockPrisma.heroSlide.update.mockResolvedValue({ id: "slide_1" } as never);
  mockPrisma.heroSlide.delete.mockResolvedValue({ id: "slide_1" } as never);
  mockPrisma.heroSlide.findUnique.mockResolvedValue({
    imageDesktop: OLD_DESKTOP,
    imageMobile: OLD_MOBILE,
  } as never);

  mockPrisma.$transaction.mockImplementation(((arg: unknown) =>
    typeof arg === "function"
      ? (arg as (tx: typeof mockPrisma) => unknown)(mockPrisma)
      : Promise.all(arg as Promise<unknown>[])) as never);
});

afterAll(() => {
  vi.restoreAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════════

describe("ADMIN gate", () => {
  beforeEach(() => {
    mockedRequireAdmin.mockRejectedValue(new Error("not admin"));
  });

  it("refuses every mutation with the envelope and writes nothing", async () => {
    const results = await Promise.all([
      createHeroSlide(input()),
      updateHeroSlide("slide_1", input()),
      setHeroSlideActive("slide_1", true),
      deleteHeroSlide("slide_1"),
      reorderHeroSlides(["slide_1"]),
    ]);
    for (const res of results) expect(res).toEqual({ success: false, error: UNAUTHORIZED });

    expect(mockPrisma.heroSlide.create).not.toHaveBeenCalled();
    expect(mockPrisma.heroSlide.update).not.toHaveBeenCalled();
    expect(mockPrisma.heroSlide.delete).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockedRevalidate).not.toHaveBeenCalled();
  });

  it("gates the admin read (it throws, like getAdminFaqs)", async () => {
    await expect(getAdminHeroSlides()).rejects.toThrow();
    expect(mockPrisma.heroSlide.findMany).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe("createHeroSlide", () => {
  it("appends at the end, converts Cairo days to instants, writes isActive explicitly", async () => {
    mockPrisma.heroSlide.aggregate.mockResolvedValue({ _max: { order: 4 } } as never);

    const res = await createHeroSlide(
      input({ isActive: false, startsOn: "2026-10-22", endsOn: "2026-10-31" }),
    );

    expect(res).toEqual({ success: true, id: "slide_new" });
    expect(mockPrisma.heroSlide.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        order: 5,
        isActive: false,
        subtitle: null,
        productId: "prod_1",
        linkUrl: null,
        // 00:00 Oct 22 and 23:59:59.999 Oct 31, Cairo (EEST, UTC+3; DST ends Oct 29 → EET).
        startsAt: new Date("2026-10-21T21:00:00.000Z"),
        endsAt: new Date("2026-10-31T21:59:59.999Z"),
      }),
      select: { id: true },
    });
    expectRevalidated();
  });

  it("refuses an invalid payload before touching the database", async () => {
    const res = await createHeroSlide(input({ linkUrl: "/new-arrivals" })); // two destinations
    expect(res).toEqual({
      success: false,
      error: "Choose exactly one destination — a product or a link.",
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("enforces the soft cap", async () => {
    mockPrisma.heroSlide.count.mockResolvedValue(HERO_MAX_SLIDES as never);
    const res = await createHeroSlide(input());
    expect(res.success).toBe(false);
    expect(mockPrisma.heroSlide.create).not.toHaveBeenCalled();
    expect(mockedRevalidate).not.toHaveBeenCalled();
  });

  it("fills blank screen-reader text: headline → product name → the default", async () => {
    mockPrisma.product.findUnique.mockResolvedValue({ name: "Pistachio Kunafa Tray" } as never);
    const writtenAlt = () =>
      (mockPrisma.heroSlide.create.mock.calls.at(-1)![0] as { data: { imageAlt: string } }).data.imageAlt;

    await createHeroSlide(input({ imageAlt: "Kunafa on a tray" }));
    expect(writtenAlt()).toBe("Kunafa on a tray");

    await createHeroSlide(input({ imageAlt: "", title: "New: Pistachio Kunafa" }));
    expect(writtenAlt()).toBe("New: Pistachio Kunafa");
    // Description or headline present → the product is never read.
    expect(mockPrisma.product.findUnique).not.toHaveBeenCalled();

    await createHeroSlide(input({ imageAlt: "", title: "" }));
    expect(writtenAlt()).toBe("Pistachio Kunafa Tray");
    expect(mockPrisma.product.findUnique).toHaveBeenCalledWith({
      where: { id: "prod_1" },
      select: { name: true },
    });

    await createHeroSlide(
      input({ imageAlt: "", title: "", productId: null, linkUrl: "/new-arrivals" }),
    );
    expect(writtenAlt()).toBe(HERO_DEFAULT_ALT);
  });

  it("translates P2003 (product deleted mid-edit)", async () => {
    mockPrisma.heroSlide.create.mockRejectedValue(prismaError("P2003"));
    const res = await createHeroSlide(input());
    expect(res).toEqual({
      success: false,
      error: "That product no longer exists — pick another one.",
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe("updateHeroSlide", () => {
  it("purges only the replaced image, after the write", async () => {
    const NEW_DESKTOP = "https://abc.ufs.sh/f/new-desktop";
    const res = await updateHeroSlide("slide_1", input({ imageDesktop: NEW_DESKTOP }));

    expect(res).toEqual({ success: true });
    expect(mockedPurge).toHaveBeenCalledWith([OLD_DESKTOP]);
    expect(mockPrisma.heroSlide.update.mock.invocationCallOrder[0]).toBeLessThan(
      mockedPurge.mock.invocationCallOrder[0],
    );
    expectRevalidated();
  });

  it("fills blank screen-reader text on update too", async () => {
    await updateHeroSlide("slide_1", input({ imageAlt: "", title: "Eid boxes" }));
    expect(mockPrisma.heroSlide.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ imageAlt: "Eid boxes" }) }),
    );
  });

  it("purges the phone image when it is cleared", async () => {
    await updateHeroSlide("slide_1", input({ imageMobile: "" }));
    expect(mockedPurge).toHaveBeenCalledWith([OLD_MOBILE]);
  });

  it("re-validates the destination — a slide orphaned by SetNull can't be re-saved without one", async () => {
    const res = await updateHeroSlide("slide_1", input({ productId: null, linkUrl: null }));
    expect(res.success).toBe(false);
    expect(mockPrisma.heroSlide.update).not.toHaveBeenCalled();
  });

  it("reports a slide deleted elsewhere, without writing or purging", async () => {
    mockPrisma.heroSlide.findUnique.mockResolvedValue(null as never);
    const res = await updateHeroSlide("slide_1", input());
    expect(res).toEqual({ success: false, error: "That slide no longer exists." });
    expect(mockPrisma.heroSlide.update).not.toHaveBeenCalled();
    expect(mockedPurge).not.toHaveBeenCalled();
  });

  it.each([
    ["P2025", "That slide no longer exists."],
    ["P2003", "That product no longer exists — pick another one."],
  ])("translates %s and purges nothing", async (code, error) => {
    mockPrisma.heroSlide.update.mockRejectedValue(prismaError(code));
    const res = await updateHeroSlide("slide_1", input({ imageDesktop: "https://abc.ufs.sh/f/x" }));
    expect(res).toEqual({ success: false, error });
    expect(mockedPurge).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe("setHeroSlideActive", () => {
  it("flips the switch only", async () => {
    const res = await setHeroSlideActive("slide_1", true);
    expect(res).toEqual({ success: true });
    expect(mockPrisma.heroSlide.update).toHaveBeenCalledWith({
      where: { id: "slide_1" },
      data: { isActive: true },
      select: { id: true },
    });
    expectRevalidated();
  });

  it("translates P2025", async () => {
    mockPrisma.heroSlide.update.mockRejectedValue(prismaError("P2025"));
    expect(await setHeroSlideActive("slide_1", false)).toEqual({
      success: false,
      error: "That slide no longer exists.",
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe("deleteHeroSlide", () => {
  it("deletes, then purges both crops", async () => {
    const res = await deleteHeroSlide("slide_1");
    expect(res).toEqual({ success: true });
    expect(mockPrisma.heroSlide.delete).toHaveBeenCalledWith({ where: { id: "slide_1" } });
    expect(mockedPurge).toHaveBeenCalledWith([OLD_DESKTOP, OLD_MOBILE]);
    expectRevalidated();
  });

  it("keeps the images when the delete fails", async () => {
    mockPrisma.heroSlide.delete.mockRejectedValue(prismaError("P2025"));
    const res = await deleteHeroSlide("slide_1");
    expect(res).toEqual({ success: false, error: "That slide no longer exists." });
    expect(mockedPurge).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe("reorderHeroSlides", () => {
  it("rewrites every position to its index in one transaction", async () => {
    const res = await reorderHeroSlides(["c", "a", "b"]);
    expect(res).toEqual({ success: true });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.heroSlide.update.mock.calls.map(([args]) => [args.where.id, args.data.order])).toEqual([
      ["c", 0],
      ["a", 1],
      ["b", 2],
    ]);
    expectRevalidated();
  });

  it("refuses duplicates without a transaction", async () => {
    const res = await reorderHeroSlides(["a", "a"]);
    expect(res.success).toBe(false);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("translates P2025 for a slide deleted mid-reorder", async () => {
    mockPrisma.$transaction.mockRejectedValue(prismaError("P2025"));
    const res = await reorderHeroSlides(["a", "b"]);
    expect(res).toEqual({
      success: false,
      error: "One of those slides no longer exists. Refresh and try again.",
    });
  });
});
