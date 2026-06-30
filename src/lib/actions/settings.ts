"use server";

// ─────────────────────────────────────────────────────────────────────────────
// Store settings — admin-managed Footer Navigation links.
//
// Every mutation gates on `requireAdmin()` (settings is an ADMIN-only screen),
// translating a rejected caller into a standard `{ success: false, error }` so
// the client gets a clean result instead of a thrown error.
//
// Cache: the storefront Footer reads these links through an `unstable_cache`
// tagged "footer-links" (see src/components/layout/Footer.tsx). Each write calls
// `updateTag("footer-links")` so the footer reflects the change on the very next
// render (read-your-own-writes), exactly like the category → footer flow.
// ─────────────────────────────────────────────────────────────────────────────

import { revalidatePath, updateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";

export type FooterLinkRow = {
  id: string;
  label: string;
  url: string;
  group: string;
  order: number;
  isActive: boolean;
};

export type FooterLinkActionResult =
  | { success: true }
  | { success: false; error: string };

export type CreateFooterLinkResult =
  | { success: true; id: string }
  | { success: false; error: string };

// ── Helpers ──────────────────────────────────────────────────────────────────

/** ADMIN-only gate that returns a standard error object instead of throwing. */
async function ensureAdmin(): Promise<{ error: string } | null> {
  try {
    await requireAdmin();
    return null;
  } catch {
    return { error: "Unauthorized: admin access required." };
  }
}

/** Reads a Prisma known-request error code without importing the error class. */
function prismaErrorCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/** Validate + normalize the label/url/group fields shared by create and update. */
function validateLink(
  data: { label: string; url: string; group: string },
): { label: string; url: string; group: string } | { error: string } {
  const label = data.label?.trim() ?? "";
  if (label.length < 1) return { error: "Label is required." };
  if (label.length > 60) return { error: "Label is too long (max 60 characters)." };

  const url = data.url?.trim() ?? "";
  if (url.length < 1) return { error: "URL is required." };
  if (url.length > 2048) return { error: "URL is too long." };
  // Accept internal paths ("/…", "#…") and absolute http(s) URLs only — this
  // stops an admin from pasting a "javascript:" href the footer would render.
  const isInternal = url.startsWith("/") || url.startsWith("#");
  const isHttp = /^https?:\/\//i.test(url);
  if (!isInternal && !isHttp) {
    return { error: 'URL must start with "/", "#", or "http(s)://".' };
  }

  const group = data.group?.trim() ?? "";
  if (group.length < 1) return { error: "Column (group) is required." };
  if (group.length > 40) return { error: "Column name is too long (max 40 characters)." };

  return { label, url, group };
}

/** Drop the per-page footer cache + refresh the settings screen after a write. */
function revalidateFooter() {
  updateTag("footer-links"); // purge the tagged Footer cache (read-your-own-writes)
  revalidatePath("/admin/settings");
}

// ── Fetch ──────────────────────────────────────────────────────────────────

/** Every footer link (active + inactive), ordered for the admin list. */
export async function getFooterLinks(): Promise<FooterLinkRow[]> {
  await requireAdmin();
  return prisma.footerLink.findMany({
    orderBy: { order: "asc" },
    select: {
      id: true,
      label: true,
      url: true,
      group: true,
      order: true,
      isActive: true,
    },
  });
}

// ── Create ───────────────────────────────────────────────────────────────────

export async function createFooterLink(data: {
  label: string;
  url: string;
  group: string;
}): Promise<CreateFooterLinkResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };

  const parsed = validateLink(data);
  if ("error" in parsed) return { success: false, error: parsed.error };

  try {
    const id = await prisma.$transaction(async (tx) => {
      // Append to the end of the list (max existing order + 1).
      const last = await tx.footerLink.aggregate({ _max: { order: true } });
      const created = await tx.footerLink.create({
        data: {
          label: parsed.label,
          url: parsed.url,
          group: parsed.group,
          order: (last._max.order ?? 0) + 1,
        },
        select: { id: true },
      });
      return created.id;
    });

    revalidateFooter();
    return { success: true, id };
  } catch (err) {
    console.error("createFooterLink failed:", err);
    return { success: false, error: "Could not create the link. Please try again." };
  }
}

// ── Update ───────────────────────────────────────────────────────────────────

export async function updateFooterLink(
  id: string,
  data: { label: string; url: string; group: string; isActive: boolean },
): Promise<FooterLinkActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };
  if (!id) return { success: false, error: "Missing link id." };

  const parsed = validateLink(data);
  if ("error" in parsed) return { success: false, error: parsed.error };

  try {
    await prisma.footerLink.update({
      where: { id },
      data: {
        label: parsed.label,
        url: parsed.url,
        group: parsed.group,
        isActive: Boolean(data.isActive),
      },
      select: { id: true },
    });

    revalidateFooter();
    return { success: true };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return { success: false, error: "That link no longer exists." };
    }
    console.error("updateFooterLink failed:", err);
    return { success: false, error: "Could not update the link. Please try again." };
  }
}

// ── Delete ───────────────────────────────────────────────────────────────────

export async function deleteFooterLink(
  id: string,
): Promise<FooterLinkActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };
  if (!id) return { success: false, error: "Missing link id." };

  try {
    await prisma.footerLink.delete({ where: { id } });
    revalidateFooter();
    return { success: true };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return { success: false, error: "That link no longer exists." };
    }
    console.error("deleteFooterLink failed:", err);
    return { success: false, error: "Could not delete the link. Please try again." };
  }
}

// ── Reorder ──────────────────────────────────────────────────────────────────

/**
 * Persist a new ordering. `orderedIds` is the full id list in its desired order;
 * each row's `order` is rewritten to its index inside ONE transaction, so the
 * list can never be left with duplicate or gapped positions.
 */
export async function reorderFooterLinks(
  orderedIds: string[],
): Promise<FooterLinkActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };

  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return { success: false, error: "Nothing to reorder." };
  }

  try {
    await prisma.$transaction(
      orderedIds.map((id, index) =>
        prisma.footerLink.update({
          where: { id },
          data: { order: index },
          select: { id: true },
        }),
      ),
    );

    revalidateFooter();
    return { success: true };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return {
        success: false,
        error: "One of those links no longer exists. Refresh and try again.",
      };
    }
    console.error("reorderFooterLinks failed:", err);
    return { success: false, error: "Could not save the new order. Please try again." };
  }
}
