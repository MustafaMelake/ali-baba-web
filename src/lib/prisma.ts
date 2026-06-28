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

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
