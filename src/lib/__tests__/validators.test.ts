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
  isHostedImageUrl,
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
