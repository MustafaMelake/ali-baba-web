"use server";

// ─────────────────────────────────────────────────────────────────────────────
// Storefront FAQ — admin-managed question/answer content (Faq model).
//
// Replaces the hardcoded list that used to live inside the homepage FeaturesBar
// (now the pure-UI FaqAccordion). The public FaqsSection Server Component reads
// the ACTIVE rows through `getStorefrontFaqs`, renders them into the accordion
// plus the FAQPage JSON-LD, while the admin console reads EVERY row through
// `getAdminFaqs`.
//
// Every mutation gates on `ensureAdmin()` (the FAQ manager is an ADMIN-only
// screen), translating a rejected caller into a standard `{ success: false,
// error }` envelope so the client toasts instead of crashing. The FAQ section is
// rendered on the ISR-cached homepage ("/"), so each write busts that route (and
// the future /admin/faqs list) for read-your-own-writes.
//
// NOTE: this is a "use server" module — every export MUST be an async function.
// The row/result shapes below are inline `export type` DECLARATIONS (fully
// erased by TS, exactly like categories.ts / menu.ts / settings.ts); never add
// an `export type { X }` RE-EXPORT here — Turbopack miscompiles that form into a
// runtime reference and crashes the app (the checkout "no branches" incident).
// ─────────────────────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
// requireAdmin stays for getAdminFaqs (a throwing admin-only read); the
// mutations use the consolidated envelope gate.
import { requireAdmin } from "@/lib/session";
import { ensureAdmin, prismaErrorCode } from "@/lib/action-utils";

export type FaqRow = {
  id: string;
  question: string;
  answer: string;
  order: number;
  isActive: boolean;
};

/** The public storefront shape — only what the accordion + JSON-LD render. */
export type StorefrontFaq = {
  id: string;
  question: string;
  answer: string;
};

export type FaqActionResult =
  | { success: true }
  | { success: false; error: string };

export type CreateFaqResult =
  | { success: true; id: string }
  | { success: false; error: string };

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Validate + normalize the question/answer fields shared by create and update. */
function validateFaq(
  data: { question: string; answer: string },
): { question: string; answer: string } | { error: string } {
  const question = data.question?.trim() ?? "";
  if (question.length < 2) return { error: "Question must be at least 2 characters." };
  if (question.length > 200) return { error: "Question is too long (max 200 characters)." };

  const answer = data.answer?.trim() ?? "";
  if (answer.length < 2) return { error: "Answer must be at least 2 characters." };
  if (answer.length > 2000) return { error: "Answer is too long (max 2000 characters)." };

  return { question, answer };
}

/** Bust the homepage FAQ section + refresh the admin list after a write. */
function revalidateFaqs() {
  revalidatePath("/"); // homepage FaqsSection (accordion + FAQPage JSON-LD)
  revalidatePath("/admin/faqs");
}

// ── Fetch ────────────────────────────────────────────────────────────────────

/**
 * The public storefront read: ACTIVE FAQs only, ordered by `order` ascending
 * (matching the `@@index([isActive, order])`). A stable `createdAt` tie-break
 * keeps rows sharing an `order` in a deterministic sequence instead of letting
 * Postgres shuffle them between requests. No auth gate — this is public content.
 */
export async function getStorefrontFaqs(): Promise<StorefrontFaq[]> {
  return prisma.faq.findMany({
    where: { isActive: true },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, question: true, answer: true },
  });
}

/** Every FAQ (active + inactive), ordered for the admin list. ADMIN-only. */
export async function getAdminFaqs(): Promise<FaqRow[]> {
  await requireAdmin();
  return prisma.faq.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      question: true,
      answer: true,
      order: true,
      isActive: true,
    },
  });
}

// ── Create ───────────────────────────────────────────────────────────────────

export async function createFaq(data: {
  question: string;
  answer: string;
}): Promise<CreateFaqResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };

  const parsed = validateFaq(data);
  if ("error" in parsed) return { success: false, error: parsed.error };

  try {
    const id = await prisma.$transaction(async (tx) => {
      // Append to the end of the list (max existing order + 1).
      const last = await tx.faq.aggregate({ _max: { order: true } });
      const created = await tx.faq.create({
        data: {
          question: parsed.question,
          answer: parsed.answer,
          order: (last._max.order ?? 0) + 1,
        },
        select: { id: true },
      });
      return created.id;
    });

    revalidateFaqs();
    return { success: true, id };
  } catch (err) {
    console.error("createFaq failed:", err);
    return { success: false, error: "Could not create the FAQ. Please try again." };
  }
}

// ── Update ───────────────────────────────────────────────────────────────────

export async function updateFaq(
  id: string,
  data: { question: string; answer: string; isActive: boolean },
): Promise<FaqActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };
  if (!id) return { success: false, error: "Missing FAQ id." };

  const parsed = validateFaq(data);
  if ("error" in parsed) return { success: false, error: parsed.error };

  try {
    await prisma.faq.update({
      where: { id },
      data: {
        question: parsed.question,
        answer: parsed.answer,
        isActive: Boolean(data.isActive),
      },
      select: { id: true },
    });

    revalidateFaqs();
    return { success: true };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return { success: false, error: "That FAQ no longer exists." };
    }
    console.error("updateFaq failed:", err);
    return { success: false, error: "Could not update the FAQ. Please try again." };
  }
}

// ── Delete ───────────────────────────────────────────────────────────────────

export async function deleteFaq(id: string): Promise<FaqActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };
  if (!id) return { success: false, error: "Missing FAQ id." };

  try {
    await prisma.faq.delete({ where: { id } });
    revalidateFaqs();
    return { success: true };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return { success: false, error: "That FAQ no longer exists." };
    }
    console.error("deleteFaq failed:", err);
    return { success: false, error: "Could not delete the FAQ. Please try again." };
  }
}

// ── Reorder ──────────────────────────────────────────────────────────────────

/**
 * Persist a new ordering after a drag-and-drop. `orderedIds` is the full id list
 * in its desired order; each row's `order` is rewritten to its index inside ONE
 * transaction, so the list can never be left with duplicate or gapped positions.
 */
export async function reorderFaqs(
  orderedIds: string[],
): Promise<FaqActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };

  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return { success: false, error: "Nothing to reorder." };
  }

  try {
    await prisma.$transaction(
      orderedIds.map((id, index) =>
        prisma.faq.update({
          where: { id },
          data: { order: index },
          select: { id: true },
        }),
      ),
    );

    revalidateFaqs();
    return { success: true };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return {
        success: false,
        error: "One of those FAQs no longer exists. Refresh and try again.",
      };
    }
    console.error("reorderFaqs failed:", err);
    return { success: false, error: "Could not save the new order. Please try again." };
  }
}
