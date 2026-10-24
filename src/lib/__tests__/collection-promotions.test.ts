// ─────────────────────────────────────────────────────────────────────────────
// Collection-targeted promotions — the Discount Engine's fourth level.
//
// Pins the shared pieces every price surface uses, so the shown price and the
// billed price agree by construction:
//   • collectionPromotionsInclude(now) traverses ONLY active collections and
//     filters promotions with the caller's single `now`;
//   • collectionPromotionsOf flattens them; gatherPromotions de-dupes a
//     promotion reached through several collections; Cheapest Wins — no stacking;
//   • the shared card include/mapping (shop, category, new arrivals, collection
//     pages) and the hero select carry and apply the level.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  collectionPromotionsInclude,
  collectionPromotionsOf,
  gatherPromotions,
  resolvePrice,
  type PromotionLike,
} from "@/lib/discounts";
import { productCardInclude, toProductCard, type ProductCardRow } from "@/lib/product-cards";
import { heroSlideStorefrontSelect, toHeroSlideView, type HeroSlideStorefrontRow } from "@/lib/hero-slides";
import { DiscountType } from "@/generated/prisma/enums";

const NOW = new Date("2026-10-24T10:00:00.000Z");
const dec = (n: number) => ({ toNumber: () => n });
const promo = (id: string, value: number, type: string = DiscountType.PERCENTAGE): PromotionLike => ({
  id,
  name: id,
  type,
  value,
  startDate: new Date("2026-10-01"),
  endDate: new Date("2026-10-31"),
  isActive: true,
});
const viaCollections = (...lists: PromotionLike[][]) =>
  lists.map((promotions) => ({ collection: { promotions } }));

describe("collectionPromotionsInclude", () => {
  it("traverses only ACTIVE collections and filters with the caller's instant", () => {
    const include = collectionPromotionsInclude(NOW);
    expect(include.collections.where).toEqual({ collection: { isActive: true } });
    const where = include.collections.select.collection.select.promotions.where;
    expect(where).toEqual({ isActive: true, startDate: { lte: NOW }, endDate: { gte: NOW } });
  });
});

describe("collectionPromotionsOf + gatherPromotions", () => {
  it("flattens every collection's promotions", () => {
    const product = { collections: viaCollections([promo("a", 10)], [promo("b", 20)]) };
    expect(collectionPromotionsOf(product).map((p) => p.id)).toEqual(["a", "b"]);
    expect(collectionPromotionsOf({})).toEqual([]);
  });

  it("counts a promotion reached through two collections (and a category) once", () => {
    const shared = promo("shared", 15);
    const merged = gatherPromotions(
      [],
      [],
      [shared],
      collectionPromotionsOf({ collections: viaCollections([shared], [shared]) }),
    );
    expect(merged.map((p) => p.id)).toEqual(["shared"]);
  });

  it("applies exactly one promotion — the cheapest result — across all four levels", () => {
    const priced = resolvePrice(
      200,
      gatherPromotions(
        [promo("variant", 5)],
        [promo("product", 10)],
        [promo("category", 20)],
        collectionPromotionsOf({ collections: viaCollections([promo("collection", 30)]) }),
      ),
      NOW,
    );
    expect(priced.finalPrice).toBe(140);
    expect(priced.appliedPromotion?.id).toBe("collection");
  });
});

describe("shared card pricing (shop, category, new arrivals, collection pages)", () => {
  it("the card include carries the collection level", () => {
    expect(productCardInclude(NOW)).toHaveProperty("collections.where", { collection: { isActive: true } });
  });

  it("a card prices with a collection promotion and strikes the base price", () => {
    const row = {
      id: "p1",
      name: "Kunafa",
      slug: "kunafa",
      description: null,
      images: [],
      category: { name: "Oriental", promotions: [] },
      promotions: [],
      collections: viaCollections([promo("gift-20", 20)]),
      variants: [{ id: "v1", price: dec(100), compareAtPrice: null, promotions: [] }],
    } as unknown as ProductCardRow;
    expect(toProductCard(row, NOW)).toMatchObject({ price: 80, compareAtPrice: 100 });
  });
});

describe("homepage hero", () => {
  it("the hero select carries the collection level and the slide price applies it", () => {
    expect(heroSlideStorefrontSelect(NOW).product.select).toHaveProperty("collections.where", {
      collection: { isActive: true },
    });
    const row = {
      id: "s1",
      eyebrow: null,
      title: null,
      subtitle: null,
      ctaLabel: "Order now",
      showPrice: true,
      imageDesktop: "/hero.jpeg",
      imageMobile: null,
      imageAlt: "x",
      linkUrl: null,
      productId: "p1",
      isActive: true,
      startsAt: null,
      endsAt: null,
      product: {
        slug: "kunafa",
        isAvailable: true,
        promotions: [],
        category: { promotions: [] },
        collections: viaCollections([promo("fixed-30", 30, DiscountType.FIXED_AMOUNT)]),
        variants: [{ price: dec(120), compareAtPrice: null, promotions: [] }],
      },
    } as unknown as HeroSlideStorefrontRow;
    expect(toHeroSlideView(row, NOW)?.price).toEqual({ amount: 90, compareAt: 120, isFrom: false });
  });
});
