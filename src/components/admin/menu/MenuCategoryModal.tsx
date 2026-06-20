"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { X, Loader2, Check, Coffee } from "lucide-react";
import { toast } from "sonner";
import { createMenuCategory, updateMenuCategory } from "@/lib/actions/menu";

export type EditableMenuCategory = {
  id: string;
  title: string;
  order: number;
  isFixedPrice: boolean;
};

const inputClasses =
  "w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-900 outline-none transition-colors placeholder:text-stone-400 focus:border-primary focus:ring-2 focus:ring-primary/20";

export default function MenuCategoryModal({
  category,
  isOpen,
  onClose,
}: {
  /** null → create mode; a category → edit mode. */
  category: EditableMenuCategory | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isEdit = category !== null;

  const [title, setTitle] = useState("");
  const [order, setOrder] = useState("");
  const [isFixedPrice, setIsFixedPrice] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    /* eslint-disable react-hooks/set-state-in-effect -- intentional: seed the form on open */
    setTitle(category?.title ?? "");
    setOrder(category != null ? String(category.order) : "");
    setIsFixedPrice(category?.isFixedPrice ?? false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [isOpen, category]);

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

    const parsedOrder = order.trim() === "" ? null : Number(order);
    if (parsedOrder != null && !Number.isFinite(parsedOrder)) {
      toast.error("Display order must be a number.");
      return;
    }

    startTransition(async () => {
      const result = isEdit
        ? await updateMenuCategory({
            id: category.id,
            title: title.trim(),
            order: parsedOrder,
            isFixedPrice,
          })
        : await createMenuCategory({
            title: title.trim(),
            order: parsedOrder,
            isFixedPrice,
          });

      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(isEdit ? "Category updated" : "Category created");
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
            aria-label={isEdit ? `Edit ${category.title}` : "Add menu category"}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 flex w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <form onSubmit={handleSubmit}>
              {/* Header */}
              <div className="flex items-center justify-between border-b border-stone-100 px-6 py-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Coffee className="h-4.5 w-4.5" />
                  </span>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
                      {isEdit ? "Edit Category" : "New Category"}
                    </p>
                    <h3 className="font-serif text-xl font-medium text-stone-900">
                      {isEdit ? category.title : "Menu category"}
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
              <div className="space-y-5 px-6 py-5">
                <div className="space-y-1.5">
                  <label htmlFor="mc-title" className="text-sm font-medium text-stone-700">
                    Title
                  </label>
                  <input
                    id="mc-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Signature Desserts"
                    className={inputClasses}
                    autoFocus
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="mc-order" className="text-sm font-medium text-stone-700">
                    Display order
                  </label>
                  <input
                    id="mc-order"
                    type="number"
                    inputMode="numeric"
                    value={order}
                    onChange={(e) => setOrder(e.target.value)}
                    placeholder="Auto (append to end)"
                    className={inputClasses}
                  />
                  <p className="text-xs text-stone-400">
                    Lower numbers appear first on the storefront. Leave blank to add last.
                  </p>
                </div>

                <label
                  htmlFor="mc-fixed"
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-stone-200 px-4 py-3 transition-colors hover:bg-stone-50"
                >
                  <input
                    id="mc-fixed"
                    type="checkbox"
                    checked={isFixedPrice}
                    onChange={(e) => setIsFixedPrice(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-stone-300 text-primary accent-primary focus:ring-primary/30"
                  />
                  <span>
                    <span className="block text-sm font-medium text-stone-800">
                      Fixed price for all items
                    </span>
                    <span className="mt-0.5 block text-xs text-stone-400">
                      Smoothies-style: every flavour shares one price and renders as a grid.
                    </span>
                  </span>
                </label>
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
                      {isEdit ? "Save Changes" : "Create Category"}
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
