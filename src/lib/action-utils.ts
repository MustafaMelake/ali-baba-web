// ─────────────────────────────────────────────────────────────────────────────
// Shared Server-Action helpers — the single home for the infrastructure idioms
// that were previously copy-pasted across src/lib/actions/* (DOMAIN_MAP §15.3):
// `prismaErrorCode` (was ×11), `ensureAdmin` (was ×5) and `slugify` (was ×3).
//
// Deliberately NOT a "use server" file: these are plain utilities imported BY
// action modules ("use server" files may only export async functions). The
// module is server-only by dependency — the ensureAdmin* gates pull in the
// session reader, which reads request headers.
// ─────────────────────────────────────────────────────────────────────────────

import { requireAdmin } from "@/lib/session";

/** Reads a Prisma known-request error code without importing the error class. */
export function prismaErrorCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/**
 * ADMIN-only gate that returns the admin's SESSION, or a standard error
 * envelope instead of throwing. Use this variant when the action needs the
 * session itself (e.g. manage-users' self-demotion guard reads
 * `gate.session.user.id`); otherwise prefer the leaner `ensureAdmin`.
 */
export async function ensureAdminSession(): Promise<
  { session: Awaited<ReturnType<typeof requireAdmin>> } | { error: string }
> {
  try {
    return { session: await requireAdmin() };
  } catch {
    return { error: "Unauthorized: admin access required." };
  }
}

/**
 * ADMIN-only gate that returns a standard error object instead of throwing —
 * `null` means the caller is an admin and may proceed. The uniform envelope
 * lets action UIs surface a toast rather than crash on a thrown guard.
 */
export async function ensureAdmin(): Promise<{ error: string } | null> {
  const gate = await ensureAdminSession();
  return "error" in gate ? gate : null;
}

/** Lowercase, trim, collapse non-alphanumerics to "-", strip stray hyphens.
 *  Non-latin input (e.g. Arabic) slugifies to "" — callers that need a
 *  guaranteed non-empty slug must supply their own fallback (see menu.ts). */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
