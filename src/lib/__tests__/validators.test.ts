// ─────────────────────────────────────────────────────────────────────────────
// Shared validators — unit suite (src/lib/validators.ts).
//
// parseDeliveryFee is the ONE rule for a delivery fee, used by both admin
// surfaces that set one (the Settings fee sheet and the Branch modal), so a
// fat-fingered "3500000" can't slip in through either door. Fees are money:
// 2-dp through roundMoney, like every other amount.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HERO_MAX_SLIDES,
  heroSlideReorderSchema,
  heroSlideSchema,
  isHostedImageUrl,
  isSafeHref,
  PROTOCOL_RELATIVE_ERROR,
  SAFE_HREF_ERROR,
  safeHrefError,
  sniffImageType,
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
// Uploads land on the R2 public base (NEXT_PUBLIC_R2_PUBLIC_BASE_URL). The
// UploadThing hosts were retired once every stored URL had moved to R2.
describe("isHostedImageUrl", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_R2_PUBLIC_BASE_URL", "https://img.alibaba.test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    "https://img.alibaba.test/products/cl9abc.webp",
    "https://img.alibaba.test/hero/k1.png",
    "/placeholder.jpg",
    "/hero.jpeg",
  ])("accepts %s", (url) => {
    expect(isHostedImageUrl(url)).toBe(true);
  });

  it.each([
    "https://utfs.io/f/abc123", // retired UploadThing hosts
    "https://x8k2p9.ufs.sh/f/abc123",
    "http://utfs.io/f/abc123", // not https
    "https://utfs.io:8443/f/abc123", // explicit port
    "https://a.b.ufs.sh/f/abc123", // remotePatterns `*` is a single label
    "https://ufs.sh/f/abc123",
    "https://utfs.io.evil.com/f/abc123",
    "https://images.example.com/cake.jpg",
    "http://img.alibaba.test/products/a.jpg", // R2 host, not https
    "https://img.alibaba.test:8443/products/a.jpg",
    "https://img.alibaba.test.evil.com/products/a.jpg", // look-alike host
    "https://evil.img.alibaba.test/products/a.jpg",
    "https://img.alibaba.test/products/a.jpg?v=2", // query string
    "https://img.alibaba.test/",
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

  it("honours a path prefix on the public base", () => {
    vi.stubEnv("NEXT_PUBLIC_R2_PUBLIC_BASE_URL", "https://cdn.alibaba.test/media");
    expect(isHostedImageUrl("https://cdn.alibaba.test/media/products/a.jpg")).toBe(true);
    expect(isHostedImageUrl("https://cdn.alibaba.test/other/a.jpg")).toBe(false);
  });

  it("accepts no remote host at all when the public base is unset or not https", () => {
    vi.stubEnv("NEXT_PUBLIC_R2_PUBLIC_BASE_URL", "");
    expect(isHostedImageUrl("https://img.alibaba.test/products/a.jpg")).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_R2_PUBLIC_BASE_URL", "http://img.alibaba.test");
    expect(isHostedImageUrl("https://img.alibaba.test/products/a.jpg")).toBe(false);
    expect(isHostedImageUrl("/placeholder.jpg")).toBe(true);
  });
});

// sniffImageType decides what an upload IS from its leading bytes — the route
// and the image migration store that type, never a claimed one.
describe("sniffImageType", () => {
  const bytes = (...parts: (string | number[])[]) =>
    new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

  it.each([
    ["image/jpeg", bytes([0xff, 0xd8, 0xff, 0xdb])],
    ["image/png", bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a])],
    ["image/gif", bytes("GIF89a")],
    ["image/gif", bytes("GIF87a")],
    ["image/webp", bytes("RIFF", [0, 0, 0, 0], "WEBP")],
    ["image/avif", bytes([0, 0, 0, 0x1c], "ftypavif")],
  ])("recognises %s", (type, data) => {
    expect(sniffImageType(data)).toBe(type);
  });

  it.each([
    ["SVG", bytes("<svg xmlns=")],
    ["HTML", bytes("<!doctype html>")],
    ["a truncated PNG", bytes([0x89], "PN")],
    ["a RIFF that isn't WebP", bytes("RIFF", [0, 0, 0, 0], "WAVE")],
    ["an HEIC (not accepted)", bytes([0, 0, 0, 0x18], "ftypheic")],
    ["nothing", bytes()],
  ])("rejects %s", (_label, data) => {
    expect(sniffImageType(data)).toBeNull();
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

  it("accepts R2 gallery URLs", () => {
    const parsed = productInputSchema.safeParse({
      ...base,
      images: ["https://img.alibaba.test/products/1.webp", "https://img.alibaba.test/products/2.jpg"],
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses a gallery containing a foreign host", () => {
    const parsed = productInputSchema.safeParse({
      ...base,
      images: ["https://img.alibaba.test/products/1.webp", "https://evil.example/x.jpg"],
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
    imageDesktop: "https://img.alibaba.test/hero/desktop.png",
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
      imageDesktop: "https://img.alibaba.test/hero/d.png",
      imageAlt: "Banner",
      productId: null,
      linkUrl: "//evil.com",
      isActive: false,
    });
    expect(parsed.error?.issues[0]?.message).toBe(PROTOCOL_RELATIVE_ERROR);
  });
});
