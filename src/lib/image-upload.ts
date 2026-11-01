// ─────────────────────────────────────────────────────────────────────────────
// Admin image upload — browser side of POST /api/upload.
//
// The route is a Vercel function (4.5 MB request-body limit), so the server
// caps a file at UPLOAD_MAX_BYTES (4 MB). The admin may still pick up to
// UPLOAD_PICK_MAX_BYTES (8 MB) — designed hero banners are often large PNGs —
// and anything over the cap is re-encoded here first: same pixel dimensions as
// WebP at falling quality, then progressively scaled down only if that still
// isn't enough. next/image re-encodes for delivery anyway, so nothing visible
// is lost. (An animated GIF over 4 MB keeps only its first frame.)
//
// The upload itself is an XHR, not fetch, for upload-progress events. Every
// outcome resolves to an UploadResponse — nothing here throws to the caller.
// ─────────────────────────────────────────────────────────────────────────────

import {
  isUploadImageType,
  UPLOAD_MAX_BYTES,
  UPLOAD_PICK_MAX_BYTES,
  type UploadFolder,
  type UploadResponse,
} from "@/lib/validators";

export const UPLOAD_ACCEPT = "image/jpeg,image/png,image/webp,image/avif,image/gif";

/** Why a picked file can't be sent, or null when it can (possibly after shrinking). */
export function pickError(file: File): string | null {
  if (!isUploadImageType(file.type)) return "Choose a JPEG, PNG, WebP, AVIF or GIF image.";
  if (file.size > UPLOAD_PICK_MAX_BYTES) return `“${file.name}” is over 8 MB — export it smaller.`;
  return null;
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
}

/** The file itself when it already fits; otherwise a WebP re-encode under the cap (null if impossible). */
export async function shrinkToFit(file: File): Promise<Blob | null> {
  if (file.size <= UPLOAD_MAX_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    for (let scale = 1; scale >= 0.4; scale = Math.round((scale - 0.15) * 100) / 100) {
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.9, 0.8, 0.7]) {
        const blob = await canvasBlob(canvas, quality);
        // A browser that can't encode WebP hands back PNG — still fine if it fits.
        if (blob && blob.size <= UPLOAD_MAX_BYTES) return blob;
      }
    }
    return null;
  } catch {
    return null; // undecodable image
  }
}

/** POST one image to /api/upload, reporting progress 0–1. Always resolves. */
export function uploadImage(
  file: Blob,
  folder: UploadFolder,
  onProgress?: (fraction: number) => void,
): Promise<UploadResponse> {
  return new Promise((resolve) => {
    const body = new FormData();
    body.append("folder", folder);
    body.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      const res = xhr.response as UploadResponse | null;
      if (res && typeof res === "object" && "success" in res) resolve(res);
      else if (xhr.status === 413) resolve({ success: false, error: "That image is too large — the limit is 4 MB." });
      else resolve({ success: false, error: "The upload failed — please try again." });
    };
    xhr.onerror = () => resolve({ success: false, error: "Network error — check your connection and try again." });
    xhr.send(body);
  });
}
