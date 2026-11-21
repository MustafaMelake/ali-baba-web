// ─────────────────────────────────────────────────────────────────────────────
// Cloudflare R2 — image storage (server-only).
//
// R2 speaks the S3 API, so this is a plain S3Client pointed at the account's R2
// endpoint (region "auto"). The client is built LAZILY on first use, never at
// module load: `next build` imports this module while analysing routes, often
// without the R2 secrets, and must not throw. Calling it without the env throws
// R2ConfigError, which callers turn into a clear message.
//
// The database stores only public URL strings (publicUrl(key)); keyFromUrl
// turns one back into its object key for deletes. Keys are
// "<folder>/<cuid>.<ext>", with the folder from the fixed UPLOAD_FOLDERS and
// the extension from the validated content type.
//
// Env (server-only, secret): R2_ENDPOINT, R2_ACCESS_KEY_ID,
// R2_SECRET_ACCESS_KEY, R2_BUCKET. Public: NEXT_PUBLIC_R2_PUBLIC_BASE_URL.
//
// Bucket hygiene: nothing on the R2 side knows when a row stops referencing a
// file, so the catalog mutations call deleteUploadedFiles after their DB write
// commits. Purges are STRICTLY best-effort — a failed delete never rolls back or
// fails the write; the worst case is a lingering file, logged for a manual sweep.
// They are also reference-aware: a URL any other row still holds is never
// purged (src/lib/image-references.ts), since one object can back several rows.
// ─────────────────────────────────────────────────────────────────────────────

import { DeleteObjectsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createId } from "@paralleldrive/cuid2";
import {
  isUploadFolder,
  r2PublicBase,
  UPLOAD_IMAGE_TYPES,
  type UploadFolder,
  type UploadImageType,
} from "@/lib/validators";

/** R2 is used without the env it needs — a deploy/config problem, not user input. */
export class R2ConfigError extends Error {
  constructor(missing: string) {
    super(`Image storage is not configured: ${missing} is not set.`);
    this.name = "R2ConfigError";
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new R2ConfigError(name);
  return value;
}

let client: S3Client | null = null;

/** The shared S3 client for R2 — constructed on first use. */
export function r2Client(): S3Client {
  client ??= new S3Client({
    region: "auto",
    endpoint: requireEnv("R2_ENDPOINT"),
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
  return client;
}

function r2Bucket(): string {
  return requireEnv("R2_BUCKET");
}

/** The public URL an object key is served at — what the database stores. */
export function publicUrl(key: string): string {
  const base = r2PublicBase();
  if (!base) throw new R2ConfigError("NEXT_PUBLIC_R2_PUBLIC_BASE_URL");
  return `${base.origin}${base.prefix}/${key}`;
}

/**
 * The object key behind a stored public URL, or null for anything that isn't
 * on our R2 public base — /public paths, legacy UploadThing URLs, foreign or
 * malformed values — so callers can pass raw DB values without pre-filtering.
 * Only "<allowed folder>/<name>" keys parse, so a delete can never reach an
 * object outside the folders our uploads write.
 */
export function keyFromUrl(url: string): string | null {
  const base = r2PublicBase();
  if (!base) return null;
  try {
    const parsed = new URL(url);
    if (parsed.origin !== base.origin || parsed.search || parsed.hash) return null;
    const lead = `${base.prefix}/`;
    if (!parsed.pathname.startsWith(lead)) return null;
    const key = decodeURIComponent(parsed.pathname.slice(lead.length));
    const [folder, name, ...rest] = key.split("/");
    if (!isUploadFolder(folder) || !name || name === "." || name === ".." || rest.length > 0) {
      return null;
    }
    return key;
  } catch {
    return null; // not an absolute URL, or a bad percent-escape
  }
}

/** A fresh object key: "<folder>/<cuid>.<ext>". */
export function objectKey(folder: UploadFolder, contentType: UploadImageType): string {
  return `${folder}/${createId()}.${UPLOAD_IMAGE_TYPES[contentType]}`;
}

/** Store one image and return its public URL. Throws on a storage failure. */
export async function putImage(
  folder: UploadFolder,
  body: Uint8Array,
  contentType: UploadImageType,
): Promise<string> {
  const key = objectKey(folder, contentType);
  await r2Client().send(
    new PutObjectCommand({
      Bucket: r2Bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
      // Keys are never reused (a fresh cuid per upload), so the object is immutable.
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return publicUrl(key);
}

/** DeleteObjects takes at most 1000 keys per request. */
const DELETE_BATCH = 1000;

/**
 * Best-effort purge of uploaded images by their stored URLs. De-dupes,
 * silently skips anything keyFromUrl doesn't recognise (/public paths, legacy
 * UploadThing URLs, foreign values), and swallows (logs) every failure —
 * including missing R2 env. Callers invoke it AFTER their DB write commits and
 * never need to catch.
 *
 * REFERENCE-AWARE (audit M-1): one object can back several rows, so a URL is
 * purged only when no row/column anywhere still holds it
 * (findReferencedImageUrls). Called post-commit, any remaining reference is
 * another row's. If that check fails, nothing is purged — a lingering file is
 * the safe failure, a deleted only-copy is not.
 */
export async function deleteUploadedFiles(
  urls: ReadonlyArray<string | null | undefined>,
): Promise<void> {
  // Only URLs that map to one of our keys are ever candidates — a /public path
  // or a foreign URL is never purged, and never even looked up.
  const candidates = [
    ...new Set(
      urls.filter((u): u is string => typeof u === "string" && u.length > 0 && keyFromUrl(u) !== null),
    ),
  ];
  if (candidates.length === 0) return;

  let referenced: Set<string>;
  try {
    // Loaded here, not at module top: the upload route and the migration
    // script use this module only to PUT, and must not pull in Prisma.
    const { findReferencedImageUrls } = await import("@/lib/image-references");
    referenced = await findReferencedImageUrls(candidates);
  } catch (err) {
    console.error("R2 purge skipped — couldn't confirm the files are unreferenced (they stay):", err);
    return;
  }

  const keys = [
    ...new Set(
      candidates
        .filter((url) => !referenced.has(url))
        .map(keyFromUrl)
        .filter((k): k is string => k !== null),
    ),
  ];
  if (keys.length === 0) return;

  try {
    for (let i = 0; i < keys.length; i += DELETE_BATCH) {
      const batch = keys.slice(i, i + DELETE_BATCH);
      const result = await r2Client().send(
        new DeleteObjectsCommand({
          Bucket: r2Bucket(),
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      if (result.Errors?.length) {
        console.error("R2 purge partly failed (files remain in the bucket):", result.Errors);
      }
    }
  } catch (err) {
    console.error("R2 purge failed (files remain in the bucket):", err);
  }
}
