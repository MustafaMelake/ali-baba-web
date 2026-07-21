"use server";

// ─────────────────────────────────────────────────────────────────────────────
// Branch management — ADMIN-only mutations (create / update / delete).
//
// Every action gates on `requireAdmin()`, but instead of letting it throw we
// translate a rejected caller into a standard `{ success: false, error }` so the
// UI gets a clean result. MANAGERs (and everyone else) are rejected here even
// though they can read branch-scoped data elsewhere.
//
// Relation safety on delete (see prisma/schema.prisma):
//   - User.branch  → onDelete: Restrict  (a branch with assigned staff/managers
//     cannot be deleted; we pre-check and return a helpful error).
//   - Order.branch → onDelete: SetNull   (historical orders survive a delete and
//     simply become unassigned, so order history is never destroyed).
// ─────────────────────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { ensureAdmin, prismaErrorCode, slugify } from "@/lib/action-utils";

export type CreateBranchResult =
  | { success: true; id: string }
  | { success: false; error: string };

export type BranchActionResult =
  | { success: true }
  | { success: false; error: string };

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Maps a Prisma unique-constraint violation to a message, or `null` otherwise. */
function uniqueViolationMessage(err: unknown): string | null {
  if (prismaErrorCode(err) !== "P2002") return null;
  const target = (err as { meta?: { target?: unknown } }).meta?.target;
  const on = (field: string) =>
    Array.isArray(target) && target.some((t) => String(t).includes(field));
  if (on("name")) return "A branch with this name already exists.";
  if (on("slug")) return "That slug is already in use.";
  return "That value must be unique.";
}

/** Validate + normalize the shared name/slug/deliveryFee fields. Slug is
 *  slugified so an invalid value can never reach the unique column; the fee is
 *  coerced so a client bug can never push NaN into the Decimal column. */
function validateBranchInput(
  data: { name: string; slug: string; deliveryFee?: number },
): { name: string; slug: string; deliveryFee: number } | { error: string } {
  const name = data.name?.trim() ?? "";
  if (name.length < 2) {
    return { error: "Name must be at least 2 characters." };
  }

  const slug = slugify(data.slug ?? "");
  if (!slug) {
    return { error: "Slug must contain at least one letter or number." };
  }

  // Missing fee falls back to the schema default (35 EGP). Zero is allowed —
  // it means the branch delivers for free.
  const deliveryFee = Number(data.deliveryFee ?? 35);
  if (!Number.isFinite(deliveryFee) || deliveryFee < 0) {
    return { error: "Delivery fee must be zero or a positive number." };
  }

  return { name, slug, deliveryFee: Math.round(deliveryFee * 100) / 100 };
}

// ── Create ───────────────────────────────────────────────────────────────────

export async function createBranch(data: {
  name: string;
  slug: string;
  isActive: boolean;
  deliveryFee?: number;
}): Promise<CreateBranchResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };

  const parsed = validateBranchInput(data);
  if ("error" in parsed) return { success: false, error: parsed.error };

  try {
    const created = await prisma.branch.create({
      data: {
        name: parsed.name,
        slug: parsed.slug,
        isActive: Boolean(data.isActive),
        deliveryFee: parsed.deliveryFee,
      },
      select: { id: true },
    });

    revalidatePath("/admin/branches");
    return { success: true, id: created.id };
  } catch (err) {
    const message = uniqueViolationMessage(err);
    if (message) return { success: false, error: message };

    console.error("createBranch failed:", err);
    return { success: false, error: "Could not create the branch. Please try again." };
  }
}

// ── Update ───────────────────────────────────────────────────────────────────

export async function updateBranch(
  id: string,
  data: { name: string; slug: string; isActive: boolean; deliveryFee?: number },
): Promise<BranchActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };

  if (!id) return { success: false, error: "Missing branch id." };

  const parsed = validateBranchInput(data);
  if ("error" in parsed) return { success: false, error: parsed.error };

  try {
    await prisma.branch.update({
      where: { id },
      data: {
        name: parsed.name,
        slug: parsed.slug,
        isActive: Boolean(data.isActive),
        deliveryFee: parsed.deliveryFee,
      },
      select: { id: true },
    });

    revalidatePath("/admin/branches");
    return { success: true };
  } catch (err) {
    const message = uniqueViolationMessage(err);
    if (message) return { success: false, error: message };
    if (prismaErrorCode(err) === "P2025") {
      return { success: false, error: "That branch no longer exists." };
    }

    console.error("updateBranch failed:", err);
    return { success: false, error: "Could not update the branch. Please try again." };
  }
}

// ── Delete ───────────────────────────────────────────────────────────────────

/**
 * Hard-deletes a branch. Orders tied to it are kept (onDelete: SetNull leaves
 * them unassigned), but a branch with users assigned (onDelete: Restrict) is
 * pre-checked and refused with a clean error rather than a raw FK crash. The
 * P2003 catch is a safety net for the race where a user is assigned between the
 * check and the delete.
 *
 * Prefer `updateBranch(id, { ..., isActive: false })` to retire a branch while
 * keeping its assignments and history intact.
 */
export async function deleteBranch(id: string): Promise<BranchActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };

  if (!id) return { success: false, error: "Missing branch id." };

  const assignedUsers = await prisma.user.count({ where: { branchId: id } });
  if (assignedUsers > 0) {
    return {
      success: false,
      error: `Cannot delete — ${assignedUsers} user${assignedUsers === 1 ? "" : "s"} (e.g. branch managers) ${assignedUsers === 1 ? "is" : "are"} still assigned to this branch. Reassign them first, or deactivate the branch instead.`,
    };
  }

  try {
    await prisma.branch.delete({ where: { id } });

    revalidatePath("/admin/branches");
    revalidatePath("/admin"); // dashboard branch scoping
    revalidatePath("/admin/orders"); // orders branch scoping
    return { success: true };
  } catch (err) {
    const code = prismaErrorCode(err);
    if (code === "P2025") {
      return { success: false, error: "That branch no longer exists." };
    }
    if (code === "P2003") {
      return {
        success: false,
        error: "Cannot delete — users were just assigned to this branch. Reassign them first.",
      };
    }

    console.error("deleteBranch failed:", err);
    return { success: false, error: "Could not delete the branch. Please try again." };
  }
}
