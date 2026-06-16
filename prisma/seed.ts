// ─────────────────────────────────────────────────────────────────────────────
// Seed: the five core slider categories + a SHOP menu page + sample products.
//
// Run with:  npx tsx prisma/seed.ts      (or `npx prisma db seed` once configured
//                                          in prisma.config.ts — see that file)
//
// Idempotent: categories keyed on unique `identifier`, the menu page and products
// keyed on their unique `slug`, so re-running updates in place (and product
// variants are reset each run) rather than creating duplicates.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  CategoryIdentifier,
} from "../src/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Add it to your .env file.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const coreCategories = [
  {
    identifier: CategoryIdentifier.ORIENTAL_SWEETS,
    name: "Oriental Sweets",
    slug: "oriental-sweets",
    subtitle: "Baklava, Kunafa & Heritage Confections",
    image: "/sweet1.jpg",
  },
  {
    identifier: CategoryIdentifier.WESTERN_SWEETS,
    name: "Western Sweets",
    slug: "western-sweets",
    subtitle: "European Craft, Locally Inspired",
    image: "/cake4.jpg",
  },
  {
    identifier: CategoryIdentifier.MOULID_SWEETS,
    name: "Moulid Sweets",
    slug: "moulid-sweets",
    subtitle: "Festive Halawa & Seasonal Treats",
    image: "/sweet.jpg",
  },
  {
    identifier: CategoryIdentifier.EID_SWEETS,
    name: "Eid Sweets",
    slug: "eid-sweets",
    subtitle: "Kahk, Ghorayeba & Celebration Boxes",
    image: "/eid.jpg",
  },
  {
    identifier: CategoryIdentifier.BAKERY,
    name: "Bakery",
    slug: "bakery",
    subtitle: "Fresh Breads, Croissants & Daily Bakes",
    image: "/ckae3.jpg",
  },
] as const;

// Sample catalogue. `category` references one of the core identifiers above;
// `variants` carry the prices (variants[0] = the card's starting price).
const sampleProducts: {
  slug: string;
  name: string;
  category: CategoryIdentifier;
  description: string;
  images: string[];
  isFeatured?: boolean;
  variants: { name: string; price: number; sortOrder: number }[];
}[] = [
  {
    slug: "kunafa-royale",
    name: "Kunafa Royale",
    category: CategoryIdentifier.ORIENTAL_SWEETS,
    description:
      "Gossamer-thin kataifi pastry drenched in aged clarified butter, filled with double-cream akkawi and crowned with Aleppo pistachios.",
    images: ["/cake1.jpg", "/cake2.jpg"],
    isFeatured: true,
    variants: [
      { name: "Whole Tray", price: 320, sortOrder: 0 },
      { name: "Single Slice", price: 60, sortOrder: 1 },
    ],
  },
  {
    slug: "baklava-collection",
    name: "Baklava Collection",
    category: CategoryIdentifier.ORIENTAL_SWEETS,
    description:
      "Twelve regional varieties, layered by hand and finished with our 1998 heirloom honey-rose syrup.",
    images: ["/ckae3.jpg"],
    variants: [
      { name: "12 Pieces", price: 240, sortOrder: 0 },
      { name: "24 Pieces", price: 440, sortOrder: 1 },
    ],
  },
  {
    slug: "pistachio-mille-feuille",
    name: "Pistachio Mille-Feuille",
    category: CategoryIdentifier.WESTERN_SWEETS,
    description:
      "Caramelised rough-puff pastry layered with pistachio mousseline and orange-blossom Chantilly.",
    images: ["/cake2.jpg"],
    isFeatured: true,
    variants: [{ name: "Individual", price: 185, sortOrder: 0 }],
  },
  {
    slug: "saffron-opera",
    name: "Saffron Opera",
    category: CategoryIdentifier.WESTERN_SWEETS,
    description:
      "Seven layers of almond Joconde, espresso buttercream and Kashmiri-saffron ganache under a mirror glaze.",
    images: ["/our-story2.png"],
    variants: [
      { name: "Whole Cake", price: 580, sortOrder: 0 },
      { name: "Slice", price: 95, sortOrder: 1 },
    ],
  },
  {
    slug: "moulid-halawa-box",
    name: "Moulid Halawa Box",
    category: CategoryIdentifier.MOULID_SWEETS,
    description:
      "A festive assortment of sugar-doll favourites — malban, simsimaya and roasted-nut brittle.",
    images: ["/sweet.jpg"],
    variants: [{ name: "Gift Box", price: 150, sortOrder: 0 }],
  },
  {
    slug: "eid-kahk-tin",
    name: "Eid Kahk Tin",
    category: CategoryIdentifier.EID_SWEETS,
    description:
      "Buttery kahk dusted with icing sugar, filled with agameya and toasted walnuts, in a keepsake tin.",
    images: ["/eid.jpg"],
    isFeatured: true,
    variants: [
      { name: "500 g Tin", price: 130, sortOrder: 0 },
      { name: "1 kg Tin", price: 240, sortOrder: 1 },
    ],
  },
  {
    slug: "butter-croissant",
    name: "Butter Croissant",
    category: CategoryIdentifier.BAKERY,
    description:
      "Laminated French-butter dough, proofed overnight and baked to a shattering golden crust.",
    images: ["/cake4.jpg"],
    variants: [
      { name: "Single", price: 35, sortOrder: 0 },
      { name: "Box of 6", price: 180, sortOrder: 1 },
    ],
  },
];

async function main() {
  // 1. Core categories (idempotent on unique identifier).
  const categoryIdByIdentifier = {} as Record<CategoryIdentifier, string>;
  for (const c of coreCategories) {
    const row = await prisma.category.upsert({
      where: { identifier: c.identifier },
      update: {
        name: c.name,
        slug: c.slug,
        subtitle: c.subtitle,
        image: c.image,
      },
      create: { ...c, type: "SHOP" },
    });
    categoryIdByIdentifier[c.identifier] = row.id;
    console.log(`✓ category ${c.identifier} (${c.name})`);
  }

  // 2. A SHOP menu page — Product.menuPageId is required.
  const shopPage = await prisma.menuPage.upsert({
    where: { slug: "shop" },
    update: { title: "Shop", type: "SHOP" },
    create: { title: "Shop", slug: "shop", type: "SHOP" },
  });

  // 3. Sample products + variants (idempotent on unique slug; variants reset).
  for (const p of sampleProducts) {
    await prisma.product.upsert({
      where: { slug: p.slug },
      update: {
        name: p.name,
        description: p.description,
        images: p.images,
        isFeatured: p.isFeatured ?? false,
        categoryId: categoryIdByIdentifier[p.category],
        menuPageId: shopPage.id,
        variants: { deleteMany: {}, create: p.variants },
      },
      create: {
        slug: p.slug,
        name: p.name,
        description: p.description,
        images: p.images,
        isFeatured: p.isFeatured ?? false,
        categoryId: categoryIdByIdentifier[p.category],
        menuPageId: shopPage.id,
        variants: { create: p.variants },
      },
    });
    console.log(`✓ product ${p.slug} (${p.variants.length} variant/s)`);
  }
}

main()
  .then(async () => {
    console.log("Seed complete.");
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
