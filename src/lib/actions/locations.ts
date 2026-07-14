"use server";

// ─────────────────────────────────────────────────────────────────────────────
// Storefront locations — admin-managed "Our Locations" showcase (Location model).
//
// Replaces the hardcoded two-card list that used to live inside BranchSelector.
// The public BranchSelector reads the ACTIVE rows through `getStorefrontLocations`
// (rendered into both the editorial grid and the LocalBusiness JSON-LD), while the
// admin console reads EVERY row through `getAdminLocations`.
//
// This is the display-only marketing model — NOT the commerce `Branch` (which
// owns fulfillment, delivery fees and MANAGER RBAC). There is no cart/order path
// here; it mirrors the FAQ manager one-for-one.
//
// Every mutation gates on `ensureAdmin()` (Locations is an ADMIN-only screen),
// translating a rejected caller into a standard `{ success: false, error }`
// envelope so the client toasts instead of crashing. The section renders on the
// ISR-cached homepage ("/"), so each write busts that route (and the /admin/
// locations list) for read-your-own-writes.
//
// NOTE: this is a "use server" module — every export MUST be an async function.
// The row/result shapes below are inline `export type` DECLARATIONS (fully erased
// by TS, exactly like faqs.ts / categories.ts / menu.ts); never add an
// `export type { X }` RE-EXPORT here — Turbopack miscompiles that form into a
// runtime reference and crashes the app (the checkout "no branches" incident).
// ─────────────────────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
// requireAdmin stays for getAdminLocations (a throwing admin-only read); the
// mutations use the consolidated envelope gate.
import { requireAdmin } from "@/lib/session";
import { ensureAdmin, prismaErrorCode } from "@/lib/action-utils";

/** The editable fields shared by create + update (everything but order/isActive). */
export type LocationInput = {
  tag: string;
  hours: string;
  title: string;
  description: string;
  imageUrl: string;
  locality: string;
  type: string;
};

export type LocationRow = LocationInput & {
  id: string;
  order: number;
  isActive: boolean;
};

/** The public storefront shape — everything the card + JSON-LD render. */
export type StorefrontLocation = LocationInput & { id: string };

export type LocationActionResult =
  | { success: true }
  | { success: false; error: string };

export type CreateLocationResult =
  | { success: true; id: string }
  | { success: false; error: string };

// schema.org LocalBusiness subtypes offered for the JSON-LD `@type`. Kept in sync
// with the <select> in LocationModal — a controlled vocabulary so a typo can never
// emit invalid structured data. Extend both sites together.
const LOCATION_TYPES = ["Bakery", "CafeOrCoffeeShop", "Restaurant", "Store"];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Validate + normalize the fields shared by create and update. The client mirrors
 *  these exact bounds (LocationModal) for fail-fast counters — this is the source
 *  of truth; the client is never trusted. */
function validateLocation(
  data: LocationInput,
): LocationInput | { error: string } {
  const tag = data.tag?.trim() ?? "";
  if (tag.length < 2) return { error: "Tag must be at least 2 characters." };
  if (tag.length > 40) return { error: "Tag is too long (max 40 characters)." };

  const hours = data.hours?.trim() ?? "";
  if (hours.length < 2) return { error: "Hours must be at least 2 characters." };
  if (hours.length > 60) return { error: "Hours is too long (max 60 characters)." };

  const title = data.title?.trim() ?? "";
  if (title.length < 2) return { error: "Title must be at least 2 characters." };
  if (title.length > 80) return { error: "Title is too long (max 80 characters)." };

  const description = data.description?.trim() ?? "";
  if (description.length < 2) return { error: "Description must be at least 2 characters." };
  if (description.length > 600) return { error: "Description is too long (max 600 characters)." };

  const imageUrl = data.imageUrl?.trim() ?? "";
  if (imageUrl.length < 2) return { error: "Image URL is required." };
  if (imageUrl.length > 2048) return { error: "Image URL is too long (max 2048 characters)." };
  if (!/^(https?:\/\/|\/)/.test(imageUrl)) {
    return { error: "Image URL must be an absolute URL or a /public path." };
  }

  const locality = data.locality?.trim() ?? "";
  if (locality.length < 2) return { error: "Locality must be at least 2 characters." };
  if (locality.length > 80) return { error: "Locality is too long (max 80 characters)." };

  const type = data.type?.trim() ?? "";
  if (!LOCATION_TYPES.includes(type)) {
    return { error: "Choose a valid location type." };
  }

  return { tag, hours, title, description, imageUrl, locality, type };
}

/** Bust the homepage locations section + refresh the admin list after a write. */
function revalidateLocations() {
  revalidatePath("/"); // homepage BranchSelector (editorial grid + LocalBusiness JSON-LD)
  revalidatePath("/admin/locations");
}

// ── Fetch ────────────────────────────────────────────────────────────────────

/**
 * The public storefront read: ACTIVE locations only, ordered by `order` ascending
 * (matching the `@@index([isActive, order])`). A stable `createdAt` tie-break keeps
 * rows sharing an `order` in a deterministic sequence instead of letting Postgres
 * shuffle them between requests. No auth gate — this is public content.
 */
export async function getStorefrontLocations(): Promise<StorefrontLocation[]> {
  return prisma.location.findMany({
    where: { isActive: true },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      tag: true,
      hours: true,
      title: true,
      description: true,
      imageUrl: true,
      locality: true,
      type: true,
    },
  });
}

/** Every location (active + inactive), ordered for the admin list. ADMIN-only. */
export async function getAdminLocations(): Promise<LocationRow[]> {
  await requireAdmin();
  return prisma.location.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      tag: true,
      hours: true,
      title: true,
      description: true,
      imageUrl: true,
      locality: true,
      type: true,
      order: true,
      isActive: true,
    },
  });
}

// ── Create ───────────────────────────────────────────────────────────────────

export async function createLocation(
  data: LocationInput,
): Promise<CreateLocationResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };

  const parsed = validateLocation(data);
  if ("error" in parsed) return { success: false, error: parsed.error };

  try {
    const id = await prisma.$transaction(async (tx) => {
      // Append to the end of the list (max existing order + 1).
      const last = await tx.location.aggregate({ _max: { order: true } });
      const created = await tx.location.create({
        data: {
          ...parsed,
          order: (last._max.order ?? 0) + 1,
        },
        select: { id: true },
      });
      return created.id;
    });

    revalidateLocations();
    return { success: true, id };
  } catch (err) {
    console.error("createLocation failed:", err);
    return { success: false, error: "Could not create the location. Please try again." };
  }
}

// ── Update ───────────────────────────────────────────────────────────────────

export async function updateLocation(
  id: string,
  data: LocationInput & { isActive: boolean },
): Promise<LocationActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };
  if (!id) return { success: false, error: "Missing location id." };

  const parsed = validateLocation(data);
  if ("error" in parsed) return { success: false, error: parsed.error };

  try {
    await prisma.location.update({
      where: { id },
      data: {
        ...parsed,
        isActive: Boolean(data.isActive),
      },
      select: { id: true },
    });

    revalidateLocations();
    return { success: true };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return { success: false, error: "That location no longer exists." };
    }
    console.error("updateLocation failed:", err);
    return { success: false, error: "Could not update the location. Please try again." };
  }
}

// ── Delete ───────────────────────────────────────────────────────────────────

export async function deleteLocation(id: string): Promise<LocationActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };
  if (!id) return { success: false, error: "Missing location id." };

  try {
    await prisma.location.delete({ where: { id } });
    revalidateLocations();
    return { success: true };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return { success: false, error: "That location no longer exists." };
    }
    console.error("deleteLocation failed:", err);
    return { success: false, error: "Could not delete the location. Please try again." };
  }
}

// ── Reorder ──────────────────────────────────────────────────────────────────

/**
 * Persist a new ordering after a drag-and-drop. `orderedIds` is the full id list
 * in its desired order; each row's `order` is rewritten to its index inside ONE
 * transaction, so the list can never be left with duplicate or gapped positions.
 */
export async function reorderLocations(
  orderedIds: string[],
): Promise<LocationActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };

  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return { success: false, error: "Nothing to reorder." };
  }

  try {
    await prisma.$transaction(
      orderedIds.map((id, index) =>
        prisma.location.update({
          where: { id },
          data: { order: index },
          select: { id: true },
        }),
      ),
    );

    revalidateLocations();
    return { success: true };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return {
        success: false,
        error: "One of those locations no longer exists. Refresh and try again.",
      };
    }
    console.error("reorderLocations failed:", err);
    return { success: false, error: "Could not save the new order. Please try again." };
  }
}
