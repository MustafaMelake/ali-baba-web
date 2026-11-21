import dns from "node:dns";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Prefer IPv4 when resolving the database host. Neon's hostname advertises both
// AAAA (IPv6) and A (IPv4) records; on networks with broken/slow IPv6 routing a
// connection attempt to an IPv6 address hangs until ETIMEDOUT (the intermittent
// "Invalid `…findMany()` … code: 'ETIMEDOUT'" errors). Forcing IPv4-first removes
// that failure mode — IPv4 reachability to Neon is confirmed — while still
// allowing IPv6 as a fallback.
dns.setDefaultResultOrder("ipv4first");

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Add it to your .env file.");
}

/**
 * Pool settings for serverless (audit M-8). `pg`'s defaults wait FOREVER for a
 * connection, so when Neon was slow or unreachable a request hung until the
 * Vercel function itself timed out, holding the instance the whole time. These
 * make every database call fail fast with an error the action already turns
 * into its generic `{ success: false }` message.
 *
 *   - connectionTimeoutMillis 10 s: room for a Neon compute waking from
 *     scale-to-zero (typically 0.5–3 s) on top of a fra1 → eu-central-1 hop of
 *     a few ms, but bounded.
 *   - query_timeout 20 s (client-side): no legitimate query here takes more than
 *     a few seconds (the dashboard reads are SQL aggregates); past this the call
 *     errors instead of pinning the function. It works through Neon's pooler.
 *     It does NOT stop the statement on the server; the server-side cap is a
 *     role-level `statement_timeout` (docs/DEPLOY_RUNBOOK.md §14), because the
 *     pooled endpoint REJECTS `statement_timeout` as a startup option
 *     ("unsupported startup parameter") — never add it here.
 *   - idleTimeoutMillis 10 s: an idle connection is released soon after a
 *     burst, so a warm instance doesn't sit on pooler slots.
 *   - max 10: connections per function instance (pg's default, made explicit);
 *     the Neon pooler multiplexes them.
 *
 * Interactive transactions keep Prisma's own limits (5 s total, 2 s to start).
 */
export const PG_POOL_SETTINGS = {
  connectionTimeoutMillis: 10_000,
  query_timeout: 20_000,
  idleTimeoutMillis: 10_000,
  max: 10,
} as const;

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString, ...PG_POOL_SETTINGS }),
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
