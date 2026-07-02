"use server";

import { prisma } from "@/lib/prisma";

/**
 * Public list of active branches for the storefront checkout selectors.
 * Returns only the fields the client needs to render the dropdowns, resolve a
 * real `branchId` to stamp onto the order, and preview that branch's delivery
 * fee — no auth required (storefront-facing). The fee here is display-only:
 * `placeOrder` re-reads it from the Branch row when the order is billed.
 */
export async function getActiveBranches(): Promise<
  { id: string; slug: string; name: string; deliveryFee: number }[]
> {
  return prisma.branch.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, slug: true, name: true, deliveryFee: true },
  });
}
