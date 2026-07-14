"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { X, Loader2, Check, MapPin, ImagePlus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { createLocation, updateLocation } from "@/lib/actions/locations";
import { UploadDropzone } from "@/lib/uploadthing";
import { cn } from "@/lib/utils";

const inputClasses =
  "w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-900 outline-none transition-colors placeholder:text-stone-400 focus:border-primary focus:ring-2 focus:ring-primary/20";

// Mirror the server-side `validateLocation` bounds so the counters (and the
// disabled submit) fail fast before a round-trip. The server re-checks these
// regardless — this is display-only, never the source of truth.
const TAG_MAX = 40;
const HOURS_MAX = 60;
const TITLE_MAX = 80;
const DESCRIPTION_MAX = 600;
const LOCALITY_MAX = 80;
const IMAGE_URL_MAX = 2048;

// schema.org LocalBusiness subtypes — kept in sync with LOCATION_TYPES in
// src/lib/actions/locations.ts (the server rejects anything not in that list).
// Value is the schema.org `@type`; the label is the friendly admin-facing name.
const TYPE_OPTIONS = [
  { value: "Bakery", label: "Bakery / Patisserie" },
  { value: "CafeOrCoffeeShop", label: "Café / Coffee Shop" },
  { value: "Restaurant", label: "Restaurant" },
  { value: "Store", label: "Store" },
];

export type EditableLocation = {
  id: string;
  tag: string;
  hours: string;
  title: string;
  description: string;
  imageUrl: string;
  locality: string;
  type: string;
  isActive: boolean;
};

/**
 * One controlled modal for BOTH create and edit, mirroring FaqModal. Pass a
 * `location` to edit it; omit it to create. On success it closes and calls
 * `router.refresh()` so the Server Component list re-reads the (already
 * revalidated) data instantly. The Active toggle only shows when editing —
 * `createLocation` takes no `isActive` and the row defaults to active.
 */
export default function LocationModal({
  location,
  isOpen,
  onClose,
}: {
  location?: EditableLocation;
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isEdit = Boolean(location);

  const [tag, setTag] = useState("");
  const [hours, setHours] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [locality, setLocality] = useState("");
  const [type, setType] = useState("");
  const [isActive, setIsActive] = useState(true);

  // Sync the form to the row each time the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    /* eslint-disable react-hooks/set-state-in-effect -- intentional: prime the form on open */
    setTag(location?.tag ?? "");
    setHours(location?.hours ?? "");
    setTitle(location?.title ?? "");
    setDescription(location?.description ?? "");
    setImageUrl(location?.imageUrl ?? "");
    setLocality(location?.locality ?? "");
    setType(location?.type ?? "");
    setIsActive(location?.isActive ?? true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [isOpen, location]);

  // Esc to close + lock background scroll while open.
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isPending) onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [isOpen, isPending, onClose]);

  const trimmed = {
    tag: tag.trim(),
    hours: hours.trim(),
    title: title.trim(),
    description: description.trim(),
    imageUrl: imageUrl.trim(),
    locality: locality.trim(),
    type: type.trim(),
  };

  const within = (v: string, max: number) => v.length >= 2 && v.length <= max;
  const canSubmit =
    within(trimmed.tag, TAG_MAX) &&
    within(trimmed.hours, HOURS_MAX) &&
    within(trimmed.title, TITLE_MAX) &&
    within(trimmed.description, DESCRIPTION_MAX) &&
    within(trimmed.locality, LOCALITY_MAX) &&
    trimmed.imageUrl.length >= 2 &&
    trimmed.imageUrl.length <= IMAGE_URL_MAX &&
    /^(https?:\/\/|\/)/.test(trimmed.imageUrl) &&
    TYPE_OPTIONS.some((o) => o.value === trimmed.type);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    startTransition(async () => {
      const result =
        isEdit && location
          ? await updateLocation(location.id, { ...trimmed, isActive })
          : await createLocation(trimmed);

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success(isEdit ? "Location updated" : "Location added");
      onClose();
      router.refresh();
    });
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => !isPending && onClose()}
            className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={isEdit ? "Edit location" : "Add location"}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-stone-100 px-6 py-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <MapPin className="h-4.5 w-4.5" />
                  </span>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
                      {isEdit ? "Edit Location" : "New Location"}
                    </p>
                    <h3 className="font-serif text-xl font-medium text-stone-900">
                      {isEdit ? "Edit this location" : "Add a location"}
                    </h3>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => !isPending && onClose()}
                  aria-label="Close"
                  className="rounded-lg p-1.5 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Body */}
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
                {/* Title + Tag */}
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <label htmlFor="loc-title" className="text-sm font-medium text-stone-700">
                        Title
                      </label>
                      <span className="text-[11px] tabular-nums text-stone-400">
                        {trimmed.title.length}/{TITLE_MAX}
                      </span>
                    </div>
                    <input
                      id="loc-title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Menouf Boutique"
                      className={inputClasses}
                      maxLength={TITLE_MAX}
                      autoFocus
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <label htmlFor="loc-tag" className="text-sm font-medium text-stone-700">
                        Tag
                      </label>
                      <span className="text-[11px] tabular-nums text-stone-400">
                        {trimmed.tag.length}/{TAG_MAX}
                      </span>
                    </div>
                    <input
                      id="loc-tag"
                      value={tag}
                      onChange={(e) => setTag(e.target.value)}
                      placeholder="Patisserie"
                      className={inputClasses}
                      maxLength={TAG_MAX}
                    />
                  </div>
                </div>

                {/* Locality + Hours */}
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <label htmlFor="loc-locality" className="text-sm font-medium text-stone-700">
                        Locality
                      </label>
                      <span className="text-[11px] tabular-nums text-stone-400">
                        {trimmed.locality.length}/{LOCALITY_MAX}
                      </span>
                    </div>
                    <input
                      id="loc-locality"
                      value={locality}
                      onChange={(e) => setLocality(e.target.value)}
                      placeholder="Menouf"
                      className={inputClasses}
                      maxLength={LOCALITY_MAX}
                    />
                    <p className="text-xs text-stone-400">
                      City/area used in the LocalBusiness SEO markup.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <label htmlFor="loc-hours" className="text-sm font-medium text-stone-700">
                        Hours
                      </label>
                      <span className="text-[11px] tabular-nums text-stone-400">
                        {trimmed.hours.length}/{HOURS_MAX}
                      </span>
                    </div>
                    <input
                      id="loc-hours"
                      value={hours}
                      onChange={(e) => setHours(e.target.value)}
                      placeholder="09:00 AM - 11:00 PM"
                      className={inputClasses}
                      maxLength={HOURS_MAX}
                    />
                  </div>
                </div>

                {/* Type */}
                <div className="space-y-1.5">
                  <label htmlFor="loc-type" className="text-sm font-medium text-stone-700">
                    Type
                  </label>
                  <select
                    id="loc-type"
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className={cn(inputClasses, "appearance-none")}
                  >
                    <option value="" disabled>
                      Select a type…
                    </option>
                    {TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-stone-400">
                    Sets the schema.org business type in the SEO markup.
                  </p>
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <label htmlFor="loc-description" className="text-sm font-medium text-stone-700">
                      Description
                    </label>
                    <span className="text-[11px] tabular-nums text-stone-400">
                      {trimmed.description.length}/{DESCRIPTION_MAX}
                    </span>
                  </div>
                  <textarea
                    id="loc-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Our flagship destination for indulgence, featuring custom cakes and signature oriental pastries crafted daily…"
                    rows={4}
                    className={cn(inputClasses, "min-h-28 resize-y leading-relaxed")}
                    maxLength={DESCRIPTION_MAX}
                  />
                </div>

                {/* Image — integrated UploadThing picker (mirrors EditCategoryModal):
                    a rounded preview + Replace once set, the dropzone when empty.
                    No more copy-pasting a URL from a separate tab. */}
                <div className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">Image</span>

                  {imageUrl ? (
                    <div className="relative overflow-hidden rounded-xl border border-stone-200">
                      {/* Plain <img> — UploadThing / /public URLs, no next/image yet. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imageUrl}
                        alt={trimmed.title ? `${trimmed.title} card image` : "Location card image"}
                        className="h-44 w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => setImageUrl("")}
                        className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-stone-900/70 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-stone-900"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Replace
                      </button>
                    </div>
                  ) : (
                    <UploadDropzone
                      endpoint="locationImage"
                      // Styled via `appearance` (we don't import UploadThing's global
                      // stylesheet — it ships a Tailwind v3 reset that breaks layout).
                      appearance={{
                        container:
                          "flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-stone-200 bg-stone-50/60 px-6 py-6",
                        uploadIcon: "text-stone-400",
                        label: "text-sm font-medium text-stone-600 hover:text-primary",
                        allowedContent: "text-xs text-stone-400",
                        button:
                          "rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90 after:bg-primary/40",
                      }}
                      content={{
                        uploadIcon: <ImagePlus className="h-7 w-7 text-stone-400" />,
                      }}
                      onClientUploadComplete={(res) => {
                        const uploaded = res[0]?.ufsUrl;
                        if (uploaded) {
                          setImageUrl(uploaded);
                          toast.success("Image uploaded");
                        }
                      }}
                      onUploadError={(err) => {
                        toast.error(err.message || "Image upload failed.");
                      }}
                    />
                  )}
                  <p className="text-xs text-stone-400">
                    Upload the card image (max 4MB) — shown on the homepage “Our
                    Locations” card.
                  </p>
                </div>

                {isEdit && (
                  <div className="flex items-center justify-between rounded-xl border border-stone-200 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-stone-700">Active</p>
                      <p className="text-xs text-stone-400">
                        Inactive locations are hidden from the storefront.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isActive}
                      aria-label="Toggle active"
                      onClick={() => setIsActive((v) => !v)}
                      className={cn(
                        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                        isActive ? "bg-primary" : "bg-stone-300",
                      )}
                    >
                      <span
                        className={cn(
                          "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                          isActive ? "translate-x-5" : "translate-x-0.5",
                        )}
                      />
                    </button>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-3 border-t border-stone-100 px-6 py-4">
                <button
                  type="button"
                  onClick={() => onClose()}
                  disabled={isPending}
                  className="rounded-full border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending || !canSubmit}
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {isEdit ? "Saving…" : "Adding…"}
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      {isEdit ? "Save Changes" : "Add Location"}
                    </>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
