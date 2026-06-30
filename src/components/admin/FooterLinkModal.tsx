"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { X, Loader2, Check, Link2 } from "lucide-react";
import { toast } from "sonner";
import { createFooterLink, updateFooterLink } from "@/lib/actions/settings";
import { cn } from "@/lib/utils";

const inputClasses =
  "w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-900 outline-none transition-colors placeholder:text-stone-400 focus:border-primary focus:ring-2 focus:ring-primary/20";

export type EditableFooterLink = {
  id: string;
  label: string;
  url: string;
  group: string;
  isActive: boolean;
};

/**
 * One controlled modal for BOTH create and edit. Pass a `link` to edit it; omit
 * it to create. On success it closes and calls `router.refresh()` so the Server
 * Component list re-reads the (already revalidated) data instantly.
 */
export default function FooterLinkModal({
  link,
  isOpen,
  onClose,
  existingGroups = [],
}: {
  link?: EditableFooterLink;
  isOpen: boolean;
  onClose: () => void;
  /** Distinct column names already in use — offered as autocomplete suggestions. */
  existingGroups?: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isEdit = Boolean(link);

  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [group, setGroup] = useState("");
  const [isActive, setIsActive] = useState(true);

  // Sync the form to the row each time the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    /* eslint-disable react-hooks/set-state-in-effect -- intentional: prime the form on open */
    setLabel(link?.label ?? "");
    setUrl(link?.url ?? "");
    setGroup(link?.group ?? "");
    setIsActive(link?.isActive ?? true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [isOpen, link]);

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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    startTransition(async () => {
      const result =
        isEdit && link
          ? await updateFooterLink(link.id, {
              label: label.trim(),
              url: url.trim(),
              group: group.trim(),
              isActive,
            })
          : await createFooterLink({
              label: label.trim(),
              url: url.trim(),
              group: group.trim(),
            });

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success(isEdit ? "Link updated" : "Link added");
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
            aria-label={isEdit ? "Edit footer link" : "Add footer link"}
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
                    <Link2 className="h-4.5 w-4.5" />
                  </span>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
                      {isEdit ? "Edit Link" : "New Link"}
                    </p>
                    <h3 className="font-serif text-xl font-medium text-stone-900">
                      {isEdit ? link!.label : "Add a footer link"}
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
                <div className="space-y-1.5">
                  <label htmlFor="footer-link-label" className="text-sm font-medium text-stone-700">
                    Label
                  </label>
                  <input
                    id="footer-link-label"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Our Story"
                    className={inputClasses}
                    autoFocus
                  />
                  <p className="text-xs text-stone-400">
                    The text shown to customers in the footer.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="footer-link-url" className="text-sm font-medium text-stone-700">
                    URL
                  </label>
                  <input
                    id="footer-link-url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="/category/oriental-sweets"
                    className={inputClasses}
                  />
                  <p className="text-xs text-stone-400">
                    An internal path (<code className="text-stone-500">/story</code>,{" "}
                    <code className="text-stone-500">/product/baklava</code>) or a full
                    external URL (<code className="text-stone-500">https://instagram.com/…</code>).
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="footer-link-group" className="text-sm font-medium text-stone-700">
                    Column
                  </label>
                  <input
                    id="footer-link-group"
                    value={group}
                    onChange={(e) => setGroup(e.target.value)}
                    placeholder="Customer Service"
                    className={inputClasses}
                    list="footer-link-groups"
                  />
                  <datalist id="footer-link-groups">
                    {existingGroups.map((g) => (
                      <option key={g} value={g} />
                    ))}
                  </datalist>
                  <p className="text-xs text-stone-400">
                    The column heading this link appears under. Links sharing a
                    column are grouped together in the footer.
                  </p>
                </div>

                {isEdit && (
                  <div className="flex items-center justify-between rounded-xl border border-stone-200 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-stone-700">Active</p>
                      <p className="text-xs text-stone-400">
                        Inactive links are hidden from the storefront footer.
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
                  disabled={isPending}
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
                      {isEdit ? "Save Changes" : "Add Link"}
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
