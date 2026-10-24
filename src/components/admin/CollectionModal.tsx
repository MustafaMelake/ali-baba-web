"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ImagePlus, Layers, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { createCollection, updateCollection } from "@/lib/actions/collections";
import { collectionSchema, fieldErrors, type CollectionInput } from "@/lib/validators";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { UploadDropzone } from "@/lib/uploadthing";
import { cn } from "@/lib/utils";

const inputClasses =
  "w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-900 outline-none transition-colors placeholder:text-stone-400 focus:border-primary focus:ring-2 focus:ring-primary/20";

export type EditableCollection = {
  id: string;
  name: string;
  description: string | null;
  image: string | null;
  isActive: boolean;
  showInFooter: boolean;
};

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-stone-300",
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0.5 rtl:-translate-x-0.5",
        )}
      />
    </button>
  );
}

/**
 * One modal for creating a collection or editing its own fields (name,
 * description, image, visibility). Products and categories are managed on the
 * collection's page. A new collection starts as a draft (inactive) and opens its
 * page right away so products can be added.
 */
export default function CollectionModal({
  collection,
  isOpen,
  onClose,
}: {
  collection?: EditableCollection;
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const dialogRef = useDialogFocus<HTMLDivElement>(isOpen);
  const isEdit = Boolean(collection);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [isActive, setIsActive] = useState(false);
  const [showInFooter, setShowInFooter] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    /* eslint-disable react-hooks/set-state-in-effect -- intentional: prime the form on open */
    setName(collection?.name ?? "");
    setDescription(collection?.description ?? "");
    setImage(collection?.image ?? "");
    setIsActive(collection?.isActive ?? false);
    setShowInFooter(collection?.showInFooter ?? false);
    setSubmitted(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [isOpen, collection]);

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

  const payload: CollectionInput = { name, description, image, isActive, showInFooter };
  const parsed = collectionSchema.safeParse(payload);
  const errors = !parsed.success && submitted ? fieldErrors(parsed.error) : {};

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!parsed.success) return;

    startTransition(async () => {
      if (isEdit && collection) {
        const result = await updateCollection(collection.id, payload);
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        toast.success("Collection updated");
        onClose();
        router.refresh();
        return;
      }
      const result = await createCollection(payload);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Collection created — now add its products");
      onClose();
      router.push(`/admin/collections/${result.id}`);
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
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={isEdit ? "Edit collection" : "New collection"}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white text-start shadow-2xl"
          >
            <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-col">
              <div className="flex items-center justify-between border-b border-stone-100 px-6 py-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Layers className="h-4.5 w-4.5" />
                  </span>
                  <h3 className="font-serif text-xl font-medium text-stone-900">
                    {isEdit ? "Edit collection" : "New collection"}
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

              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
                <div className="space-y-1.5">
                  <label htmlFor="col-name" className="text-sm font-medium text-stone-700">
                    Name
                  </label>
                  <input
                    id="col-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ramadan Favourites"
                    maxLength={80}
                    className={inputClasses}
                    autoFocus
                  />
                  {errors.name && <p className="text-xs text-red-600">{errors.name}</p>}
                  {!isEdit && (
                    <p className="text-xs text-stone-400">
                      The web address is made from this name once and never changes.
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="col-desc" className="text-sm font-medium text-stone-700">
                    Description <span className="font-normal text-stone-400">(optional)</span>
                  </label>
                  <textarea
                    id="col-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    maxLength={600}
                    className={cn(inputClasses, "resize-y leading-relaxed")}
                  />
                </div>

                <div className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">
                    Image <span className="font-normal text-stone-400">(optional)</span>
                  </span>
                  {image ? (
                    <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-stone-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image} alt="" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setImage("")}
                        className="absolute end-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-stone-900/70 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-stone-900"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Replace
                      </button>
                    </div>
                  ) : (
                    <UploadDropzone
                      endpoint="collectionImage"
                      appearance={{
                        container:
                          "flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-stone-200 bg-stone-50/60 px-6 py-6",
                        uploadIcon: "text-stone-400",
                        label: "text-sm font-medium text-stone-600 hover:text-primary",
                        allowedContent: "text-xs text-stone-400",
                        button:
                          "rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90 after:bg-primary/40",
                      }}
                      content={{ uploadIcon: <ImagePlus className="h-7 w-7 text-stone-400" /> }}
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
                  {errors.image && <p className="text-xs text-red-600">{errors.image}</p>}
                </div>

                <div className="flex items-center justify-between rounded-xl border border-stone-200 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-stone-700">Active</p>
                    <p className="text-xs text-stone-400">
                      Inactive collections don&apos;t exist for customers — no page, no footer or search entry, no promotions.
                    </p>
                  </div>
                  <Switch checked={isActive} onChange={setIsActive} label="Toggle active" />
                </div>
                <div className="flex items-center justify-between rounded-xl border border-stone-200 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-stone-700">Show in footer</p>
                    <p className="text-xs text-stone-400">Lists it in the footer&apos;s “Collections” column (when active).</p>
                  </div>
                  <Switch checked={showInFooter} onChange={setShowInFooter} label="Toggle footer" />
                </div>
              </div>

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
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {isEdit ? "Save Changes" : "Create"}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
