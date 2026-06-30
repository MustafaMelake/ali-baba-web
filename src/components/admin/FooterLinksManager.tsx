"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Navigation,
  Plus,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  Check,
  X,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  deleteFooterLink,
  reorderFooterLinks,
  updateFooterLink,
  type FooterLinkRow,
} from "@/lib/actions/settings";
import { cn } from "@/lib/utils";
import FooterLinkModal, { type EditableFooterLink } from "./FooterLinkModal";

const isExternal = (url: string) => /^https?:\/\//i.test(url);

/**
 * Admin manager for the storefront Footer's navigation links. Lists the links in
 * their saved order with inline reorder (▲▼), an active toggle, edit and delete,
 * plus a modal to add/edit. Mutations run through the `settings` Server Actions
 * and the card re-reads via `router.refresh()`; reordering is applied
 * optimistically to local state so the arrows feel instant.
 */
export default function FooterLinksManager({
  links,
}: {
  links: FooterLinkRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Local mirror so reorder feels instant; re-synced whenever the server list
  // changes underneath us (after any router.refresh()).
  const [items, setItems] = useState(links);
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- mirror server truth */
    setItems(links);
  }, [links]);

  // null = closed; "new" = create; otherwise the link being edited.
  const [modal, setModal] = useState<EditableFooterLink | "new" | null>(null);

  // Reorder WITHIN a column: swap a link with its neighbour in the same group,
  // then persist the whole flattened order. The footer derives column order from
  // link order, so a same-group swap never reshuffles the columns themselves.
  function move(link: FooterLinkRow, direction: -1 | 1) {
    const siblings = items.filter((l) => l.group === link.group);
    const pos = siblings.findIndex((l) => l.id === link.id);
    const target = pos + direction;
    if (target < 0 || target >= siblings.length) return;

    const a = items.findIndex((l) => l.id === link.id);
    const b = items.findIndex((l) => l.id === siblings[target].id);
    const next = [...items];
    [next[a], next[b]] = [next[b], next[a]];
    const previous = items;
    setItems(next); // optimistic

    startTransition(async () => {
      const result = await reorderFooterLinks(next.map((l) => l.id));
      if (!result.success) {
        setItems(previous); // revert
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function toggleActive(link: FooterLinkRow) {
    const next = !link.isActive;
    setItems((current) =>
      current.map((l) => (l.id === link.id ? { ...l, isActive: next } : l)),
    );

    startTransition(async () => {
      const result = await updateFooterLink(link.id, {
        label: link.label,
        url: link.url,
        group: link.group,
        isActive: next,
      });
      if (!result.success) {
        setItems((current) =>
          current.map((l) => (l.id === link.id ? { ...l, isActive: !next } : l)),
        );
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  // Group rows into columns exactly as the storefront footer will: by `group`,
  // preserving first-appearance order (the list is already in saved order).
  const columns: { heading: string; links: FooterLinkRow[] }[] = [];
  const columnIndex = new Map<string, number>();
  for (const item of items) {
    let ci = columnIndex.get(item.group);
    if (ci === undefined) {
      ci = columns.length;
      columnIndex.set(item.group, ci);
      columns.push({ heading: item.group, links: [] });
    }
    columns[ci].links.push(item);
  }
  const existingGroups = columns.map((c) => c.heading);

  return (
    <section className="rounded-2xl border border-stone-200/70 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-stone-100 pb-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Navigation className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-serif text-xl font-medium text-stone-900">
              Footer Navigation
            </h2>
            <p className="text-xs text-stone-400">
              Links shown in the storefront footer — categories, products, pages
              or social.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setModal("new")}
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Add link
        </button>
      </div>

      {items.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-stone-200 px-6 py-10 text-center">
          <p className="text-sm font-medium text-stone-700">No footer links yet</p>
          <p className="mt-1 text-xs text-stone-400">
            Add your first link — until then the footer shows its built-in
            defaults.
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-6">
          {columns.map((column) => (
            <div key={column.heading}>
              {/* Column heading — previews the footer's column header. */}
              <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">
                {column.heading}
              </p>
              <ul className="space-y-2.5">
                <AnimatePresence initial={false}>
                  {column.links.map((link, index) => (
                    <motion.li
                      key={link.id}
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.18 }}
                      className="flex items-center gap-3 rounded-xl border border-stone-200/80 bg-white px-3 py-2.5"
                    >
                      {/* Reorder (within this column) */}
                      <div className="flex flex-col">
                        <button
                          type="button"
                          onClick={() => move(link, -1)}
                          disabled={isPending || index === 0}
                          aria-label={`Move ${link.label} up`}
                          className="flex h-5 w-5 items-center justify-center rounded text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:pointer-events-none disabled:opacity-30"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => move(link, 1)}
                          disabled={isPending || index === column.links.length - 1}
                          aria-label={`Move ${link.label} down`}
                          className="flex h-5 w-5 items-center justify-center rounded text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:pointer-events-none disabled:opacity-30"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {/* Label + URL */}
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "truncate text-sm font-medium",
                            link.isActive ? "text-stone-900" : "text-stone-400",
                          )}
                        >
                          {link.label}
                        </p>
                        <p className="flex items-center gap-1 truncate text-xs text-stone-400">
                          {isExternal(link.url) && (
                            <ExternalLink className="h-3 w-3 shrink-0" aria-label="External link" />
                          )}
                          <span className="truncate">{link.url}</span>
                        </p>
                      </div>

                      {/* Active toggle */}
                      <button
                        type="button"
                        role="switch"
                        aria-checked={link.isActive}
                        aria-label={link.isActive ? `Hide ${link.label}` : `Show ${link.label}`}
                        onClick={() => toggleActive(link)}
                        disabled={isPending}
                        className={cn(
                          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60",
                          link.isActive ? "bg-primary" : "bg-stone-300",
                        )}
                      >
                        <span
                          className={cn(
                            "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                            link.isActive ? "translate-x-5" : "translate-x-0.5",
                          )}
                        />
                      </button>

                      {/* Edit */}
                      <button
                        type="button"
                        onClick={() =>
                          setModal({
                            id: link.id,
                            label: link.label,
                            url: link.url,
                            group: link.group,
                            isActive: link.isActive,
                          })
                        }
                        aria-label={`Edit ${link.label}`}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>

                      {/* Delete */}
                      <DeleteLinkButton id={link.id} label={link.label} />
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </div>
          ))}
        </div>
      )}

      <FooterLinkModal
        isOpen={modal !== null}
        link={modal && modal !== "new" ? modal : undefined}
        existingGroups={existingGroups}
        onClose={() => setModal(null)}
      />
    </section>
  );
}

/** Inline "Are you sure?" delete, mirroring the branch/category delete buttons. */
function DeleteLinkButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteFooterLink(id);
      if (!result.success) {
        toast.error(result.error);
        setConfirming(false);
        return;
      }
      toast.success(`"${label}" deleted`);
      router.refresh();
    });
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      {confirming ? (
        <motion.div
          key="confirm"
          initial={{ opacity: 0, width: 0 }}
          animate={{ opacity: 1, width: "auto" }}
          exit={{ opacity: 0, width: 0 }}
          transition={{ duration: 0.18 }}
          className="inline-flex shrink-0 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700"
        >
          <span>Delete?</span>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            aria-label={`Confirm delete ${label}`}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-white transition-colors hover:bg-red-700 disabled:opacity-60"
          >
            {isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Check className="h-3 w-3" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={isPending}
            aria-label="Cancel delete"
            className="flex h-5 w-5 items-center justify-center rounded-full text-red-700 transition-colors hover:bg-red-100 disabled:opacity-60"
          >
            <X className="h-3 w-3" />
          </button>
        </motion.div>
      ) : (
        <motion.button
          key="trigger"
          type="button"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => setConfirming(true)}
          aria-label={`Delete ${label}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-4 w-4" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
