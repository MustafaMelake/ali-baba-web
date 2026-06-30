"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { X, Loader2, Check, ImagePlus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { updateCategory } from "@/lib/actions/categories";
import { UploadDropzone } from "@/lib/uploadthing";

export type EditableCategory = {
  id: string;
  name: string;
  subtitle: string | null;
  image: string | null;
  isFeatured: boolean;
  sliderOrder: number;
};

const inputClasses =
  "w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-900 outline-none transition-colors placeholder:text-stone-400 focus:border-primary focus:ring-2 focus:ring-primary/20";

export default function EditCategoryModal({
  category,
  isOpen,
  onClose,
}: {
  category: EditableCategory | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [isFeatured, setIsFeatured] = useState(false);
  const [sliderOrder, setSliderOrder] = useState("0");
  const [image, setImage] = useState("");

  // Sync the controlled form with the target category whenever the modal opens
  // or the selected category changes.
  useEffect(() => {
    if (!isOpen || !category) return;
    /* eslint-disable react-hooks/set-state-in-effect -- intentional: seed the form from props on open */
    setName(category.name);
    setSubtitle(category.subtitle ?? "");
    setIsFeatured(category.isFeatured);
    setSliderOrder(String(category.sliderOrder ?? 0));
    setImage(category.image ?? "");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [isOpen, category]);

  // Lock body scroll + Escape-to-close while open.
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!category) return;

    startTransition(async () => {
      const result = await updateCategory({
        id: category.id,
        name: name.trim(),
        subtitle: subtitle.trim() || null,
        isFeatured,
        sliderOrder: Number(sliderOrder) || 0,
        image: image.trim() || null,
      });

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success("Category updated");
      onClose();
      router.refresh();
    });
  }

  return (
    <AnimatePresence>
      {isOpen && category && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => !isPending && onClose()}
            className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
          />

          {/* Panel */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`Edit ${category.name}`}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-stone-100 px-6 py-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
                    Edit Category
                  </p>
                  <h3 className="font-serif text-xl font-medium text-stone-900">
                    {category.name}
                  </h3>
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

              {/* Body (scrolls if tall) */}
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
                <div className="space-y-1.5">
                  <label htmlFor="cat-name" className="text-sm font-medium text-stone-700">
                    Name
                  </label>
                  <input
                    id="cat-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Oriental Sweets"
                    className={inputClasses}
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="cat-subtitle"
                    className="text-sm font-medium text-stone-700"
                  >
                    Subtitle
                  </label>
                  <input
                    id="cat-subtitle"
                    value={subtitle}
                    onChange={(e) => setSubtitle(e.target.value)}
                    placeholder="Baklava, Kunafa & Heritage Confections"
                    className={inputClasses}
                  />
                </div>

                <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50/60 px-4 py-3.5">
                  <label className="flex cursor-pointer items-center justify-between gap-3">
                    <span>
                      <span className="block text-sm font-medium text-stone-700">
                        Feature in slider
                      </span>
                      <span className="block text-xs text-stone-400">
                        Show this category in the homepage carousel.
                      </span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isFeatured}
                      onClick={() => setIsFeatured((v) => !v)}
                      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                        isFeatured ? "bg-primary" : "bg-stone-300"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                          isFeatured ? "translate-x-[1.375rem]" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </label>

                  {isFeatured && (
                    <div className="space-y-1.5 border-t border-stone-200 pt-3">
                      <label
                        htmlFor="cat-slider-order"
                        className="text-sm font-medium text-stone-700"
                      >
                        Slider position
                      </label>
                      <input
                        id="cat-slider-order"
                        type="number"
                        min={0}
                        value={sliderOrder}
                        onChange={(e) => setSliderOrder(e.target.value)}
                        className={inputClasses}
                      />
                      <p className="text-xs text-stone-400">
                        Lower numbers appear first in the slider.
                      </p>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">
                    Cover Image
                  </span>

                  {image ? (
                    <div className="relative overflow-hidden rounded-xl border border-stone-200">
                      {/* Plain <img> — UploadThing URLs, no next/image yet. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={image}
                        alt={`${category.name} cover`}
                        className="h-40 w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => setImage("")}
                        className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-stone-900/70 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-stone-900"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Replace
                      </button>
                    </div>
                  ) : (
                    <UploadDropzone
                      endpoint="categoryImage"
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
                          setImage(uploaded);
                          toast.success("Image uploaded");
                        }
                      }}
                      onUploadError={(err) => {
                        toast.error(err.message || "Image upload failed.");
                      }}
                    />
                  )}
                </div>
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
                  disabled={isPending}
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      Save Changes
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
