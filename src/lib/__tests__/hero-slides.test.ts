// ─────────────────────────────────────────────────────────────────────────────
// Hero slides — pure-rule suite (src/lib/hero-slides.ts).
//
// The homepage hero has one liveness rule in two forms: the storefront's Prisma
// filter (`liveHeroSlideWhere`) and its in-memory twin (`heroWindowState` +
// `heroDestinationIssue`), which also drives the admin badges. These tests pin:
//
//   • the window — null edges are open, both edges inclusive, evaluated against
//     the caller's single `now`, and Cairo day edges from storeDateStart/End;
//   • the admin precedence — Inactive → Expired → Scheduled → Live, with
//     destination problems as a SEPARATE issue, never the primary badge;
//   • the destination — a listable product or a link; a delisted/deleted
//     product hides the slide (never advertise what placeOrder would refuse);
//   • the display price — exactly the catalog card's chain (resolvePrice over
//     the gathered promotions; live promo → struck base price, else the
//     variant's manual Compare-At), only for product slides with showPrice.
//
// TZ is pinned to UTC: the dev machine runs in Africa/Cairo, so a device-clock
// bug would otherwise pass locally.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  heroDestinationIssue,
  heroWindowState,
  isHeroSlideLive,
  liveHeroSlideWhere,
  toHeroSlideView,
  type HeroSlideStorefrontRow,
} from "@/lib/hero-slides";
import { LISTABLE_PRODUCT } from "@/lib/catalog";
import { storeDateEnd, storeDateStart } from "@/lib/timezone";

const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "UTC";
});
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

const NOW = new Date("2026-10-22T10:00:00.000Z"); // 13:00 Cairo (EEST)

/** A Decimal-like value, as Prisma returns money columns. */
const dec = (n: number) => ({ toNumber: () => n });

const promo = (overrides: Record<string, unknown> = {}) => ({
  id: "promo_1",
  name: "Launch week",
  type: "PERCENTAGE",
  value: dec(20),
  startDate: new Date("2026-10-01T00:00:00.000Z"),
  endDate: new Date("2026-10-31T00:00:00.000Z"),
  isActive: true,
  ...overrides,
});

// Overrides are loosely typed: fixtures use plain `{ toNumber }` money and
// string promotion types where Prisma's payload has Decimal / DiscountType.
function row(overrides: Record<string, unknown> = {}): HeroSlideStorefrontRow {
  return {
    id: "slide_1",
    eyebrow: "New arrival",
    title: "Pistachio Kunafa",
    subtitle: null,
    ctaLabel: "Order now",
    showPrice: true,
    imageDesktop: "https://abc.ufs.sh/f/desktop",
    imageMobile: null,
    imageAlt: "A tray of pistachio kunafa",
    linkUrl: null,
    productId: "prod_1",
    isActive: true,
    startsAt: null,
    endsAt: null,
    product: {
      slug: "pistachio-kunafa",
      isAvailable: true,
      promotions: [],
      category: { promotions: [] },
      variants: [
        { price: dec(120), compareAtPrice: null, promotions: [] },
        { price: dec(220), compareAtPrice: null, promotions: [] },
      ],
    },
    ...overrides,
  } as unknown as HeroSlideStorefrontRow;
}

// ═════════════════════════════════════════════════════════════════════════════

describe("liveHeroSlideWhere", () => {
  it("filters active, inside an open-ended window, with a listable product or a link", () => {
    expect(liveHeroSlideWhere(NOW)).toEqual({
      isActive: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: NOW } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: NOW } }] },
        {
          OR: [
            { product: { is: LISTABLE_PRODUCT } },
            { productId: null, linkUrl: { not: null } },
          ],
        },
      ],
    });
  });

  it("uses the caller's instant, never its own clock", () => {
    const at = new Date("2030-01-01T00:00:00.000Z");
    expect(JSON.stringify(liveHeroSlideWhere(at))).toContain(at.toISOString());
  });
});

describe("heroWindowState — Inactive → Expired → Scheduled → Live", () => {
  const window = (startsAt: Date | null, endsAt: Date | null, isActive = true) => ({
    isActive,
    startsAt,
    endsAt,
  });

  it("is live with no edges", () => {
    expect(heroWindowState(window(null, null), NOW)).toBe("live");
  });

  it("is inactive whenever switched off, whatever the window", () => {
    expect(heroWindowState(window(null, null, false), NOW)).toBe("inactive");
    expect(heroWindowState(window(new Date("2027-01-01"), null, false), NOW)).toBe("inactive");
  });

  it("is scheduled before its start and expired after its end", () => {
    expect(heroWindowState(window(new Date("2026-11-01"), null), NOW)).toBe("scheduled");
    expect(heroWindowState(window(null, new Date("2026-10-01")), NOW)).toBe("expired");
  });

  it("is inclusive on both edges", () => {
    expect(heroWindowState(window(NOW, NOW), NOW)).toBe("live");
  });

  it("runs for the whole Cairo day of a same-day window", () => {
    const start = storeDateStart("2026-10-22")!;
    const end = storeDateEnd("2026-10-22")!;
    // 00:00 and 23:59:59.999 Cairo (EEST, UTC+3) on Oct 22.
    expect(heroWindowState(window(start, end), new Date("2026-10-21T21:00:00.000Z"))).toBe("live");
    expect(heroWindowState(window(start, end), new Date("2026-10-22T20:59:59.999Z"))).toBe("live");
    expect(heroWindowState(window(start, end), new Date("2026-10-21T20:59:59.999Z"))).toBe("scheduled");
    expect(heroWindowState(window(start, end), new Date("2026-10-22T21:00:00.000Z"))).toBe("expired");
  });
});

describe("heroDestinationIssue — a separate warning, never the primary badge", () => {
  it("accepts a listable product or a link", () => {
    expect(heroDestinationIssue(row())).toBeNull();
    expect(
      heroDestinationIssue(row({ productId: null, product: null, linkUrl: "/collections" })),
    ).toBeNull();
  });

  it("flags a product that is unavailable or has no available variant", () => {
    const base = row().product!;
    expect(heroDestinationIssue(row({ product: { ...base, isAvailable: false } }))).toBe(
      "product-unavailable",
    );
    expect(heroDestinationIssue(row({ product: { ...base, variants: [] } }))).toBe(
      "product-unavailable",
    );
  });

  it("flags a slide whose product was deleted (SetNull) and has no link", () => {
    expect(heroDestinationIssue(row({ productId: null, product: null, linkUrl: null }))).toBe(
      "no-destination",
    );
  });

  it("keeps the window badge independent — an expired slide with a dead product reads Expired", () => {
    const slide = row({ endsAt: new Date("2026-10-01"), product: { ...row().product!, isAvailable: false } });
    expect(heroWindowState(slide, NOW)).toBe("expired");
    expect(heroDestinationIssue(slide)).toBe("product-unavailable");
    expect(isHeroSlideLive(slide, NOW)).toBe(false);
  });
});

describe("isHeroSlideLive — the in-memory twin of the where", () => {
  it("needs both a live window and a valid destination", () => {
    expect(isHeroSlideLive(row(), NOW)).toBe(true);
    expect(isHeroSlideLive(row({ isActive: false }), NOW)).toBe(false);
    expect(isHeroSlideLive(row({ productId: null, product: null }), NOW)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe("toHeroSlideView — display-only starting price (the catalog card chain)", () => {
  it("prices the cheapest available variant with no promotion, 'From' for several variants", () => {
    const view = toHeroSlideView(row(), NOW)!;
    expect(view.href).toBe("/product/pistachio-kunafa");
    expect(view.price).toEqual({ amount: 120, compareAt: null, isFrom: true });
  });

  it("applies a live promotion from any level and strikes through the base price", () => {
    const base = row().product!;
    const viaCategory = row({ product: { ...base, category: { promotions: [promo()] } } });
    expect(toHeroSlideView(viaCategory, NOW)!.price).toEqual({
      amount: 96,
      compareAt: 120,
      isFrom: true,
    });

    const viaVariant = row({
      product: {
        ...base,
        variants: [{ ...base.variants[0], promotions: [promo({ type: "FIXED_AMOUNT", value: dec(25) })] }],
      },
    });
    expect(toHeroSlideView(viaVariant, NOW)!.price).toEqual({
      amount: 95,
      compareAt: 120,
      isFrom: false,
    });
  });

  it("picks the cheapest result when promotions overlap (Cheapest Wins — never stacks)", () => {
    const base = row().product!;
    const slide = row({
      product: {
        ...base,
        promotions: [promo({ id: "p10", value: dec(10) })],
        category: { promotions: [promo({ id: "p30", value: dec(30) })] },
      },
    });
    expect(toHeroSlideView(slide, NOW)!.price!.amount).toBe(84);
  });

  it("ignores a promotion outside its window at the caller's instant", () => {
    const base = row().product!;
    const expired = promo({ endDate: new Date("2026-10-15T00:00:00.000Z") });
    const slide = row({ product: { ...base, promotions: [expired] } });
    expect(toHeroSlideView(slide, NOW)!.price).toEqual({ amount: 120, compareAt: null, isFrom: true });
  });

  it("falls back to the variant's manual Compare-At when no promotion applies", () => {
    const base = row().product!;
    const slide = row({
      product: { ...base, variants: [{ ...base.variants[0], compareAtPrice: dec(150) }] },
    });
    expect(toHeroSlideView(slide, NOW)!.price).toEqual({ amount: 120, compareAt: 150, isFrom: false });
  });

  it("shows no price when showPrice is off, or on a link slide", () => {
    expect(toHeroSlideView(row({ showPrice: false }), NOW)!.price).toBeNull();

    const link = toHeroSlideView(
      row({ productId: null, product: null, linkUrl: "/collections", showPrice: true }),
      NOW,
    )!;
    expect(link.href).toBe("/collections");
    expect(link.price).toBeNull();
  });

  it("serializes plain values only — no Decimal crosses to the client", () => {
    const view = toHeroSlideView(row(), NOW)!;
    expect(typeof view.price!.amount).toBe("number");
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });

  it("returns null for a row with nowhere to go", () => {
    expect(toHeroSlideView(row({ productId: null, product: null, linkUrl: null }), NOW)).toBeNull();
  });
});
