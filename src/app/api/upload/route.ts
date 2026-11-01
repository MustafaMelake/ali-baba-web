import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session";
import { putImage, R2ConfigError } from "@/lib/r2";
import {
  isUploadFolder,
  sniffImageType,
  UPLOAD_MAX_BYTES,
  type UploadResponse,
} from "@/lib/validators";

/**
 * Admin image upload → Cloudflare R2. The single uploader gate: only an ADMIN
 * (who isn't being held to change a temporary password) may store a file —
 * MANAGERs can't, exactly as under UploadThing's requireAdminUploader.
 *
 * A route handler, not a Server Action: an action's body is capped at 1 MB by
 * default, and the picker reports progress through XHR upload events. The
 * file travels browser → this function → R2 (server-side PutObject), so the
 * bucket needs no CORS rule. The body must stay under Vercel's 4.5 MB function
 * limit, hence UPLOAD_MAX_BYTES (4 MB); the picker shrinks larger images first.
 *
 * multipart/form-data: `file` (an image) + `folder` (one of UPLOAD_FOLDERS).
 * The bytes decide the type: a file whose leading bytes aren't a JPEG, PNG,
 * WebP, AVIF or GIF is refused whatever it claims, and the object is stored
 * with the sniffed Content-Type and extension. Answers UploadResponse JSON —
 * never a raw throw. Nothing is written to the database here: the form saves
 * the returned URL through its own action, which re-checks isHostedImageUrl.
 */

/** Room for the multipart boundary and the folder field around the file. */
const MULTIPART_OVERHEAD = 64 * 1024;

function fail(status: number, error: string) {
  return NextResponse.json<UploadResponse>({ success: false, error }, { status });
}

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session) return fail(401, "Your session has expired — sign in again to upload.");
  if (session.user.role !== "ADMIN" || session.user.mustChangePassword) {
    return fail(403, "Only administrators can upload images.");
  }

  // Refuse an oversized body before reading it, when the client declares one.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > UPLOAD_MAX_BYTES + MULTIPART_OVERHEAD) {
    return fail(413, "That image is too large — the limit is 4 MB.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "Send the image as a form upload.");
  }

  const folder = form.get("folder");
  if (!isUploadFolder(folder)) return fail(400, "Unknown image kind.");

  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) return fail(400, "Choose an image to upload.");
  if (file.size > UPLOAD_MAX_BYTES) return fail(413, "That image is too large — the limit is 4 MB.");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = sniffImageType(bytes);
  if (!contentType) return fail(400, "Upload a JPEG, PNG, WebP, AVIF or GIF image.");

  try {
    const url = await putImage(folder, bytes, contentType);
    return NextResponse.json<UploadResponse>({ success: true, url });
  } catch (err) {
    console.error("[api/upload]", err);
    if (err instanceof R2ConfigError) {
      return fail(500, "Image storage isn't configured — contact the site developer.");
    }
    return fail(500, "The upload failed — please try again.");
  }
}
