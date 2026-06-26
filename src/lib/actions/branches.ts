"use server";

import { prisma } from "@/lib/prisma";

/**
 * Public list of active branches for the storefront checkout pickup selector.
 * Returns only the fields the client needs to render the dropdown and resolve a
 * real `branchId` to stamp onto the order — no auth required (storefront-facing).
 */
export async function getActiveBranches(): Promise<
  { id: string; slug: string; name: string }[]
> {
  return prisma.branch.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, slug: true, name: true },
  });
}
