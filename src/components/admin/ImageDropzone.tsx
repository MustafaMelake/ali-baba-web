"use client";

import { useRef, useState, type DragEvent } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UploadFolder } from "@/lib/validators";
import { pickError, shrinkToFit, UPLOAD_ACCEPT, uploadImage } from "@/lib/image-upload";

/**
 * The admin image picker — choose or drop, preview while sending, progress,
 * then hand the stored R2 URLs back. Replaces UploadThing's dropzone in every
 * admin form; each form keeps its own preview + "Replace" markup for the saved
 * image, exactly as before.
 *
 * Posts to /api/upload (ADMIN-only) through src/lib/image-upload.ts, which
 * shrinks a pick over 4 MB in the browser first. `maxFiles` > 1 allows a
 * multi-select (the product gallery); extra files beyond it are ignored with a
 * notice. Files upload one after another so progress reads "2 of 3".
 */
export default function ImageDropzone({
  folder,
  onUploaded,
  onError,
  maxFiles = 1,
  hint,
  className,
}: {
  folder: UploadFolder;
  /** Called once with every URL that stored successfully (may be fewer than picked). */
  onUploaded: (urls: string[]) => void;
  onError: (message: string) => void;
  maxFiles?: number;
  /** Recommended size / usage, shown under the button. */
  hint?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<{ index: number; total: number; progress: number; preview: string } | null>(
    null,
  );

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0 || busy) return;
    const picked = Array.from(list);
    const files = picked.slice(0, maxFiles);
    if (picked.length > files.length) {
      onError(`Only ${maxFiles} more image${maxFiles === 1 ? "" : "s"} can be added — the rest were skipped.`);
    }

    const urls: string[] = [];
    for (const [i, file] of files.entries()) {
      const problem = pickError(file);
      if (problem) {
        onError(problem);
        continue;
      }
      const preview = URL.createObjectURL(file);
      setBusy({ index: i + 1, total: files.length, progress: 0, preview });
      try {
        const body = await shrinkToFit(file);
        if (!body) {
          onError(`“${file.name}” couldn’t be made small enough to upload — export it under 4 MB.`);
          continue;
        }
        const res = await uploadImage(body, folder, (progress) =>
          setBusy((b) => (b ? { ...b, progress } : b)),
        );
        if (res.success) urls.push(res.url);
        else onError(res.error);
      } finally {
        URL.revokeObjectURL(preview);
      }
    }
    setBusy(null);
    if (inputRef.current) inputRef.current.value = "";
    if (urls.length > 0) onUploaded(urls);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    void handleFiles(e.dataTransfer.files);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        "flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-6 text-center transition-colors",
        dragging ? "border-primary/50 bg-primary/5" : "border-stone-200 bg-stone-50/60",
        className,
      )}
    >
      {busy ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- a local blob: preview */}
          <img src={busy.preview} alt="" className="h-16 w-16 rounded-lg object-cover opacity-80" />
          <p className="inline-flex items-center gap-2 text-sm font-medium text-stone-600" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Uploading{busy.total > 1 ? ` ${busy.index} of ${busy.total}` : ""}…{" "}
            <span className="tabular-nums">{Math.round(busy.progress * 100)}%</span>
          </p>
          <div className="h-1.5 w-full max-w-48 overflow-hidden rounded-full bg-stone-200">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${Math.round(busy.progress * 100)}%` }}
            />
          </div>
        </>
      ) : (
        <>
          <ImagePlus className="h-7 w-7 text-stone-400" />
          <p className="text-sm font-medium text-stone-600">
            Drop {maxFiles > 1 ? "images" : "an image"} here, or
          </p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
          >
            Choose {maxFiles > 1 ? "images" : "image"}
          </button>
          <p className="text-xs text-stone-400">JPEG, PNG, WebP or AVIF · up to 8 MB</p>
          {hint && <p className="text-xs text-stone-400">{hint}</p>}
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        multiple={maxFiles > 1}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => void handleFiles(e.target.files)}
      />
    </div>
  );
}
