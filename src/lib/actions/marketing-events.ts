"use server";

// ─────────────────────────────────────────────────────────────────────────────
// Marketing calendar — custom campaign reminders (MarketingEvent).
//
// ADMIN-only planning data for /admin/calendar: every mutation gates on
// `ensureAdmin()` (a MANAGER can't plan store-wide campaigns) and re-parses the
// shared `marketingEventSchema`, because the client is never trusted. A
// reminder never prices anything — a live discount is still a Promotion — and
// nothing on the storefront renders it, so the calendar is the only surface to
// revalidate. Dates arrive as Cairo "YYYY-MM-DD" keys and are stored in
// `@db.Date` columns as UTC-midnight Dates (see dayKeyToDate).
//
// NOTE: a "use server" module — every export is an async function or an inline
// `export type` declaration; never an `export type { X }` re-export.
// ─────────────────────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { ensureAdmin, prismaErrorCode } from "@/lib/action-utils";
import { marketingEventSchema, type MarketingEventData } from "@/lib/validators";
import { dayKeyToDate } from "@/lib/marketing-calendar";

export type MarketingEventActionResult =
  | { success: true }
  | { success: false; error: string };

export type CreateMarketingEventResult =
  | { success: true; id: string }
  | { success: false; error: string };

const GONE = "This reminder no longer exists.";

function toRow(data: MarketingEventData) {
  return {
    title: data.title,
    type: data.type,
    startDate: dayKeyToDate(data.startDate),
    endDate: dayKeyToDate(data.endDate),
    notes: data.notes,
    strategy: data.strategy,
    targetDiscountPercent: data.targetDiscountPercent,
  };
}

/** Parse the payload, or the first issue as the user-facing message. */
function parseReminder(input: unknown): MarketingEventData | { error: string } {
  const parsed = marketingEventSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  return { error: parsed.error.issues[0]?.message ?? "Invalid reminder." };
}

export async function createMarketingEvent(input: unknown): Promise<CreateMarketingEventResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };

  const data = parseReminder(input);
  if ("error" in data) return { success: false, error: data.error };

  try {
    const created = await prisma.marketingEvent.create({
      data: toRow(data),
      select: { id: true },
    });
    revalidatePath("/admin/calendar");
    return { success: true, id: created.id };
  } catch (err) {
    console.error("createMarketingEvent failed:", err);
    return { success: false, error: "Could not save the reminder. Please try again." };
  }
}

export async function updateMarketingEvent(
  id: string,
  input: unknown,
): Promise<MarketingEventActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };
  if (typeof id !== "string" || id.length === 0) return { success: false, error: GONE };

  const data = parseReminder(input);
  if ("error" in data) return { success: false, error: data.error };

  try {
    await prisma.marketingEvent.update({ where: { id }, data: toRow(data) });
    revalidatePath("/admin/calendar");
    return { success: true };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") return { success: false, error: GONE };
    console.error("updateMarketingEvent failed:", err);
    return { success: false, error: "Could not update the reminder. Please try again." };
  }
}

export async function deleteMarketingEvent(id: string): Promise<MarketingEventActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };
  if (typeof id !== "string" || id.length === 0) return { success: false, error: GONE };

  try {
    await prisma.marketingEvent.delete({ where: { id } });
    revalidatePath("/admin/calendar");
    return { success: true };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") return { success: false, error: GONE };
    console.error("deleteMarketingEvent failed:", err);
    return { success: false, error: "Could not delete the reminder. Please try again." };
  }
}
