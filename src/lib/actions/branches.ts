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
  const rows = await prisma.branch.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, slug: true, name: true, deliveryFee: true },
  });
  // deliveryFee is a Decimal money column — serialize to a plain number for the
  // client checkout selectors (display-only; placeOrder re-reads the Decimal).
  return rows.map((b) => ({
    id: b.id,
    slug: b.slug,
    name: b.name,
    deliveryFee: b.deliveryFee.toNumber(),
  }));
}
