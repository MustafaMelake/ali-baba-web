// ─────────────────────────────────────────────────────────────────────────────
// UploadThing server-side admin client — bucket hygiene.
//
// The database stores only URL strings (Product.images, Category.image);
// nothing on the UploadThing side knows when a row stops referencing a file.
// This helper lets the catalog mutations purge replaced/orphaned files from
// the cloud bucket so storage no longer grows monotonically (DOMAIN_MAP D-14).
//
// Purges are STRICTLY best-effort and post-commit: a failed bucket delete must
// never roll back or fail a successful database write — the worst case is a
// lingering file (the pre-fix status quo), and the error is logged for a
// manual sweep.
// ─────────────────────────────────────────────────────────────────────────────

import { UTApi } from "uploadthing/server";

/** Singleton admin API client (credentials come from the UploadThing env). */
const utapi = new UTApi();

/**
 * Extract the file key from an UploadThing URL ("…/f/<key>" on ufs.sh /
 * utfs.io hosts). Returns null for anything else — /public paths like
 * "/placeholder.jpg", foreign hosts, or malformed values — so callers can
 * pass raw DB values verbatim without pre-filtering.
 */
function fileKeyFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const marker = "/f/";
    const at = pathname.indexOf(marker);
    if (at === -1) return null;
    const key = pathname.slice(at + marker.length);
    return key || null;
  } catch {
    return null; // not an absolute URL
  }
}

/**
 * Best-effort purge of UploadThing files by their stored URLs. De-dupes,
 * silently skips non-UploadThing values, and swallows (logs) API failures —
 * callers invoke it AFTER their DB write commits and never await-throw on it.
 */
export async function deleteUploadedFiles(
  urls: ReadonlyArray<string | null | undefined>,
): Promise<void> {
  const keys = [
    ...new Set(
      urls
        .filter((u): u is string => typeof u === "string" && u.length > 0)
        .map(fileKeyFromUrl)
        .filter((k): k is string => k !== null),
    ),
  ];
  if (keys.length === 0) return;

  try {
    await utapi.deleteFiles(keys);
  } catch (err) {
    console.error("UploadThing purge failed (files remain in the bucket):", err);
  }
}
