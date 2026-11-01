"use server";

import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { VisitEventType } from "@/generated/prisma/enums";
import { isBotUserAgent, visitBatchSchema, type VisitEventKind } from "@/lib/validators";

/**
 * Visitor analytics — the write behind the storefront tracker
 * (src/lib/visit-tracker.ts, mounted by VisitTracker in the (shop) layout).
 *
 * Public by design: the tracker runs for guests on ISR-cached pages, where no
 * server code executes on a cache hit, so the browser has to report the visit
 * itself — and a Server Action is the platform's only door from the browser to
 * the database. There is no session gate and nothing to gate: the payload
 * carries no personal data (a random localStorage visitor id, a pathname,
 * optional product/branch ids) and the rows only ever feed counts — never
 * price, stock, identity or permission. Bot user agents are dropped silently (a
 * success with nothing recorded, so a scraper learns nothing). Abuse can
 * inflate the counts, which the Vercel Web Analytics cross-check exists to
 * catch; it can't bloat a row, because visitBatchSchema bounds every column and
 * the batch size.
 *
 * One call is one createMany — no transaction, no reads. Nothing rendered from
 * a cache shows these rows (/admin is force-dynamic), so nothing revalidates.
 */

export type RecordVisitEventsResult =
  | { success: true; recorded: number }
  | { success: false; error: string };

const EVENT_TYPE: Record<VisitEventKind, VisitEventType> = {
  view: VisitEventType.VIEW,
  product_view: VisitEventType.PRODUCT_VIEW,
  add_to_cart: VisitEventType.ADD_TO_CART,
  checkout_start: VisitEventType.CHECKOUT_START,
};

/** Record one tracker batch (≤ VISIT_BATCH_MAX events from one visitor). */
export async function recordVisitEvents(input: unknown): Promise<RecordVisitEventsResult> {
  try {
    const userAgent = (await headers()).get("user-agent");
    if (isBotUserAgent(userAgent)) return { success: true, recorded: 0 };

    const parsed = visitBatchSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: "Invalid visit events." };

    const { visitorId, events } = parsed.data;
    await prisma.visitEvent.createMany({
      data: events.map((e) => ({
        type: EVENT_TYPE[e.type],
        visitorId,
        path: e.path,
        productId: e.productId ?? null,
        branchId: e.branchId ?? null,
      })),
    });
    return { success: true, recorded: events.length };
  } catch (err) {
    console.error("[recordVisitEvents]", err);
    return { success: false, error: "Could not record the visit." };
  }
}
