// ─────────────────────────────────────────────────────────────────────────────
// Shared validators — unit suite (src/lib/validators.ts).
//
// parseDeliveryFee is the ONE rule for a delivery fee, used by both admin
// surfaces that set one (the Settings fee sheet and the Branch modal), so a
// fat-fingered "3500000" can't slip in through either door. Fees are money:
// 2-dp through roundMoney, like every other amount.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  HERO_MAX_SLIDES,
  heroSlideReorderSchema,
  heroSlideSchema,
  isHostedImageUrl,
  isSafeHref,
  PROTOCOL_RELATIVE_ERROR,
  SAFE_HREF_ERROR,
  safeHrefError,
  parseDeliveryFee,
  productInputSchema,
} from "@/lib/validators";

describe("parseDeliveryFee", () => {
  it.each([
    [0, 0], // free delivery is allowed
    [35, 35],
    [42.5, 42.5],
    [10_000, 10_000],
    [12.345, 12.35], // rounded like all money
  ])("accepts %s as %s", (input, fee) => {
    expect(parseDeliveryFee(input)).toBe(fee);
  });

  it.each([-1, 10_000.01, 3_500_000, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects %s",
    (input) => {
      expect(parseDeliveryFee(input)).toBeNull();
    },
  );
});

// isHostedImageUrl is the one rule for every persisted image URL (products,
// categories, locations, hero slides). next/image throws on a host missing from
// next.config's remotePatterns — and that throw takes down the whole ISR page
// rendering the image — so a foreign host must never reach the database.
describe("isHostedImageUrl", () => {
  it.each([
    "https://utfs.io/f/abc123",
    "https://x8k2p9.ufs.sh/f/abc123",
    "/placeholder.jpg",
    "/hero.jpeg",
  ])("accepts %s", (url) => {
    expect(isHostedImageUrl(url)).toBe(true);
  });

  it.each([
    "http://utfs.io/f/abc123", // not https
    "https://utfs.io:8443/f/abc123", // explicit port
    "https://a.b.ufs.sh/f/abc123", // remotePatterns `*` is a single label
    "https://ufs.sh/f/abc123",
    "https://utfs.io.evil.com/f/abc123",
    "https://images.example.com/cake.jpg",
    "//evil.com/cake.jpg", // protocol-relative
    "/\\evil.com/cake.jpg", // browsers treat "/\" like "//"
    "/hero.jpeg?v=2", // local image with a query string
    "/",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "cake.jpg",
    "",
  ])("rejects %s", (url) => {
    expect(isHostedImageUrl(url)).toBe(false);
  });
});

// isSafeHref is the href whitelist shared by footer links and hero slides — a
// stored-XSS control, so the rejections matter more than the acceptances.
describe("isSafeHref", () => {
  it.each([
    "/",
    "/category/oriental-sweets",
    "/shop?category=cakes#top",
    "#faq",
    "https://instagram.com/alibaba",
    "HTTP://example.com",
  ])("accepts %s", (url) => {
    expect(isSafeHref(url)).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox",
    "//evil.com", // protocol-relative: off-site despite the leading "/"
    "/\\evil.com", // browsers treat "/\" like "//"
    "https://", // no host
    "https:///evil.com",
    "mailto:hello@alibaba.eg",
    "category/cakes", // relative path
    "",
  ])("rejects %s", (url) => {
    expect(isSafeHref(url)).toBe(false);
  });
});

describe("productInputSchema images", () => {
  const base = {
    name: "Kunafa Tray",
    slug: "kunafa-tray",
    categoryId: "cat_1",
    variants: [{ name: "Small", price: 120 }],
  };

  it("accepts UploadThing gallery URLs", () => {
    const parsed = productInputSchema.safeParse({
      ...base,
      images: ["https://abc.ufs.sh/f/1", "https://utfs.io/f/2"],
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses a gallery containing a foreign host", () => {
    const parsed = productInputSchema.safeParse({
      ...base,
      images: ["https://abc.ufs.sh/f/1", "https://evil.example/x.jpg"],
    });
    expect(parsed.success).toBe(false);
  });
});

// heroSlideSchema is the one contract for a hero slide — the admin modal's
// instant feedback and the actions' authoritative re-parse.
describe("heroSlideSchema", () => {
  const productSlide = {
    eyebrow: "",
    title: "",
    subtitle: "",
    ctaLabel: "Order now",
    showPrice: true,
    imageDesktop: "https://abc.ufs.sh/f/desktop",
    imageMobile: "",
    imageAlt: "A tray of pistachio kunafa",
    productId: "prod_1",
    linkUrl: null,
    isActive: false,
    startsOn: "",
    endsOn: "",
  };

  it("accepts an image-only product slide and collapses blank optionals to null", () => {
    const parsed = heroSlideSchema.safeParse(productSlide);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({
      eyebrow: null,
      title: null,
      subtitle: null,
      imageMobile: null,
      linkUrl: null,
      startsOn: null,
      endsOn: null,
      isActive: false,
    });
  });

  it("accepts a link slide", () => {
    const parsed = heroSlideSchema.safeParse({
      ...productSlide,
      productId: null,
      linkUrl: "/new-arrivals",
    });
    expect(parsed.success).toBe(true);
  });

  it.each([
    ["both destinations", { productId: "prod_1", linkUrl: "/new-arrivals" }],
    ["no destination", { productId: "", linkUrl: "" }],
  ])("refuses %s", (_label, destination) => {
    const parsed = heroSlideSchema.safeParse({ ...productSlide, ...destination });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(["productId"]);
  });

  it.each(["javascript:alert(1)", "//evil.com"])("refuses the link %s", (linkUrl) => {
    const parsed = heroSlideSchema.safeParse({ ...productSlide, productId: null, linkUrl });
    expect(parsed.success).toBe(false);
  });

  it("refuses a foreign-host or missing desktop image", () => {
    expect(
      heroSlideSchema.safeParse({ ...productSlide, imageDesktop: "https://evil.example/x.jpg" }).success,
    ).toBe(false);
    expect(heroSlideSchema.safeParse({ ...productSlide, imageDesktop: "" }).success).toBe(false);
    expect(
      heroSlideSchema.safeParse({ ...productSlide, imageMobile: "https://evil.example/m.jpg" }).success,
    ).toBe(false);
  });

  it("requires a button label", () => {
    expect(heroSlideSchema.safeParse({ ...productSlide, ctaLabel: "" }).success).toBe(false);
  });

  it("screen-reader text is optional — blank normalizes to null (the action fills it)", () => {
    for (const imageAlt of ["", " ", null, undefined]) {
      const parsed = heroSlideSchema.safeParse({ ...productSlide, imageAlt });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.imageAlt).toBe(null);
    }
    const kept = heroSlideSchema.safeParse({ ...productSlide, imageAlt: "  Kunafa tray  " });
    expect(kept.success && kept.data.imageAlt).toBe("Kunafa tray");
    expect(heroSlideSchema.safeParse({ ...productSlide, imageAlt: "x".repeat(301) }).success).toBe(false);
  });

  it("accepts a same-day window and refuses an end before the start", () => {
    expect(
      heroSlideSchema.safeParse({ ...productSlide, startsOn: "2026-10-22", endsOn: "2026-10-22" }).success,
    ).toBe(true);
    const backwards = heroSlideSchema.safeParse({
      ...productSlide,
      startsOn: "2026-10-22",
      endsOn: "2026-10-21",
    });
    expect(backwards.success).toBe(false);
    expect(backwards.error?.issues[0]?.path).toEqual(["endsOn"]);
  });

  it("refuses a malformed date", () => {
    expect(heroSlideSchema.safeParse({ ...productSlide, startsOn: "22/10/2026" }).success).toBe(false);
  });
});

describe("heroSlideReorderSchema", () => {
  it("accepts a full id list", () => {
    expect(heroSlideReorderSchema.safeParse(["a", "b", "c"]).success).toBe(true);
  });

  it("refuses duplicates, an empty list, and more than the cap", () => {
    expect(heroSlideReorderSchema.safeParse(["a", "a"]).success).toBe(false);
    expect(heroSlideReorderSchema.safeParse([]).success).toBe(false);
    const tooMany = Array.from({ length: HERO_MAX_SLIDES + 1 }, (_, i) => `s${i}`);
    expect(heroSlideReorderSchema.safeParse(tooMany).success).toBe(false);
  });
});

describe("safeHrefError — why a link was refused", () => {
  it("gives the protocol-relative case its own message", () => {
    expect(safeHrefError("//evil.com")).toBe(PROTOCOL_RELATIVE_ERROR);
    expect(safeHrefError("/" + String.fromCharCode(92) + "evil.com")).toBe(PROTOCOL_RELATIVE_ERROR);
  });

  it("uses the generic message for other refusals and null when safe", () => {
    expect(safeHrefError("javascript:alert(1)")).toBe(SAFE_HREF_ERROR);
    expect(safeHrefError("/new-arrivals")).toBeNull();
    expect(safeHrefError("https://instagram.com/alibaba")).toBeNull();
  });

  it("surfaces the protocol-relative message through heroSlideSchema", () => {
    const parsed = heroSlideSchema.safeParse({
      ctaLabel: "Order now",
      showPrice: false,
      imageDesktop: "https://abc.ufs.sh/f/d",
      imageAlt: "Banner",
      productId: null,
      linkUrl: "//evil.com",
      isActive: false,
    });
    expect(parsed.error?.issues[0]?.message).toBe(PROTOCOL_RELATIVE_ERROR);
  });
});
