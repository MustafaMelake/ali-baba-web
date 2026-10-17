import type { Prisma } from "@/generated/prisma/client";

/**
 * A product is listable only if it AND at least one of its variants is
 * available. Every catalog surface (shop, category, collections, search) pairs
 * this with `variants: { where: { isAvailable: true } }`, so a card's starting
 * variant — the price it shows and the variant quick-add charges — can never be
 * an archived one that `placeOrder` would reject.
 *
 * A plain module so the `"use server"` search actions can import it too.
 */
export const LISTABLE_PRODUCT = {
  isAvailable: true,
  variants: { some: { isAvailable: true } },
} satisfies Prisma.ProductWhereInput;
