import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Nightly Vercel Cron (vercel.json → "crons"): deletes VisitEvent rows older
 * than VISIT_RETENTION_DAYS (audit H-2). The table is append-only analytics fed
 * by a public write, so without this it grows forever.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Without the
 * env var the route refuses everything (fail closed), so it can never be
 * triggered anonymously. Compared in constant time.
 *
 * Bounded: deletes in batches of PRUNE_BATCH by primary key (`createdAt`
 * index), at most PRUNE_MAX_BATCHES per run — a backlog after a traffic
 * spike drains over several nights instead of one long statement. Each batch
 * is its own short statement (Neon-friendly); no transaction is held.
 * VisitEvent has no foreign keys pointing at it, so nothing cascades.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VISIT_RETENTION_DAYS = 90;
const PRUNE_BATCH = 5_000;
const PRUNE_MAX_BATCHES = 40; // ≤ 200k rows per run

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/prune-visits] CRON_SECRET is not set — refusing to run.");
    return NextResponse.json({ success: false, error: "Not configured." }, { status: 500 });
  }
  if (!authorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - VISIT_RETENTION_DAYS * 86_400_000);
  let deleted = 0;
  try {
    for (let batch = 0; batch < PRUNE_MAX_BATCHES; batch++) {
      const n = await prisma.$executeRaw`
        DELETE FROM "VisitEvent"
        WHERE "id" IN (
          SELECT "id" FROM "VisitEvent" WHERE "createdAt" < ${cutoff} LIMIT ${PRUNE_BATCH}
        )
      `;
      deleted += n;
      if (n < PRUNE_BATCH) break;
    }
    return NextResponse.json({ success: true, deleted, cutoff: cutoff.toISOString() });
  } catch (err) {
    console.error("[cron/prune-visits] failed after deleting", deleted, "rows:", err);
    return NextResponse.json({ success: false, error: "Prune failed.", deleted }, { status: 500 });
  }
}
