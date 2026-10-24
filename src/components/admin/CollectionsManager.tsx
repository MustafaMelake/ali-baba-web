"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowUp, Check, Layers, Loader2, Pencil, Plus, Settings2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  deleteCollection,
  reorderCollections,
  updateCollection,
  type CollectionRow,
} from "@/lib/actions/collections";
import { cn } from "@/lib/utils";
import Pill from "./Pill";
import CollectionModal, { type EditableCollection } from "./CollectionModal";

/**
 * Admin list of every collection in its global order (the /collections index,
 * the footer column and the cards on category pages all follow it): ▲/▼ to
 * move one step (the full id list goes to `reorderCollections`), quick
 * Active / Footer switches, edit details, manage contents, and an inline
 * confirm-in-place delete. Moves and switches are optimistic and roll back on
 * `{ success: false }`.
 */
export default function CollectionsManager({ collections }: { collections: CollectionRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [items, setItems] = useState(collections);
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- mirror server truth */
    setItems(collections);
  }, [collections]);
  const [modal, setModal] = useState<EditableCollection | "new" | null>(null);

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const previous = items;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
    startTransition(async () => {
      const result = await reorderCollections(next.map((c) => c.id));
      if (!result.success) {
        setItems(previous);
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function patch(row: CollectionRow, change: Partial<Pick<CollectionRow, "isActive" | "showInFooter">>) {
    const previous = items;
    setItems((current) => current.map((c) => (c.id === row.id ? { ...c, ...change } : c)));
    startTransition(async () => {
      const result = await updateCollection(row.id, {
        name: row.name,
        description: row.description,
        image: row.image,
        isActive: change.isActive ?? row.isActive,
        showInFooter: change.showInFooter ?? row.showInFooter,
      });
      if (!result.success) {
        setItems(previous);
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="rounded-2xl border border-stone-200/70 bg-white p-6 text-start shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-stone-100 pb-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Layers className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-serif text-xl font-medium text-stone-900">Collections</h2>
            <p className="text-xs text-stone-400">
              Customers see active collections in this order — on /collections, in the footer and on category pages.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setModal("new")}
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          New Collection
        </button>
      </div>

      {items.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-stone-200 px-6 py-10 text-center">
          <p className="text-sm font-medium text-stone-700">No collections yet</p>
          <p className="mt-1 text-xs text-stone-400">
            Group products into curated sets — gift boxes, seasonal favourites — each with its own page.
          </p>
        </div>
      ) : (
        <ul className="mt-5 space-y-2.5">
          {items.map((c, i) => (
            <li key={c.id} className="flex items-center gap-3 rounded-xl border border-stone-200/80 bg-white px-3 py-3">
              <div className="flex shrink-0 flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={isPending || i === 0}
                  aria-label={`Move "${c.name}" up`}
                  className="flex h-6 w-6 items-center justify-center rounded text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={isPending || i === items.length - 1}
                  aria-label={`Move "${c.name}" down`}
                  className="flex h-6 w-6 items-center justify-center rounded text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={c.image ?? "/placeholder.jpg"}
                alt=""
                className="h-12 w-16 shrink-0 rounded-lg object-cover ring-1 ring-stone-200"
              />

              <div className="min-w-0 flex-1">
                <p className={cn("truncate text-sm font-medium", c.isActive ? "text-stone-900" : "text-stone-400")}>
                  {c.name}
                </p>
                <p className="mt-0.5 truncate text-xs text-stone-400">
                  /collections/{c.slug} · <span className="tabular-nums">{c.productCount}</span> products ·{" "}
                  <span className="tabular-nums">{c.categoryCount}</span> categories
                </p>
              </div>

              <Pill
                className={
                  c.isActive
                    ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                    : "bg-stone-100 text-stone-500 ring-stone-500/20"
                }
              >
                {c.isActive ? "Active" : "Inactive"}
              </Pill>

              <label className="hidden shrink-0 items-center gap-2 text-xs text-stone-500 sm:flex">
                <input
                  type="checkbox"
                  checked={c.showInFooter}
                  onChange={(e) => patch(c, { showInFooter: e.target.checked })}
                  disabled={isPending}
                  className="h-4 w-4 accent-[var(--color-primary)]"
                />
                Footer
              </label>

              <button
                type="button"
                role="switch"
                aria-checked={c.isActive}
                aria-label={c.isActive ? `Make "${c.name}" inactive` : `Make "${c.name}" active`}
                onClick={() => patch(c, { isActive: !c.isActive })}
                disabled={isPending}
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60",
                  c.isActive ? "bg-primary" : "bg-stone-300",
                )}
              >
                <span
                  className={cn(
                    "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                    c.isActive ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0.5 rtl:-translate-x-0.5",
                  )}
                />
              </button>

              <Link
                href={`/admin/collections/${c.id}`}
                aria-label={`Manage products and categories of "${c.name}"`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
              >
                <Settings2 className="h-4 w-4" />
              </Link>
              <button
                type="button"
                onClick={() =>
                  setModal({
                    id: c.id,
                    name: c.name,
                    description: c.description,
                    image: c.image,
                    isActive: c.isActive,
                    showInFooter: c.showInFooter,
                  })
                }
                aria-label={`Edit "${c.name}"`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <DeleteCollectionButton id={c.id} name={c.name} />
            </li>
          ))}
        </ul>
      )}

      <CollectionModal
        isOpen={modal !== null}
        collection={modal && modal !== "new" ? modal : undefined}
        onClose={() => setModal(null)}
      />
    </section>
  );
}

/** Inline "Delete?" confirm-in-place. Products and categories are never deleted with it. */
function DeleteCollectionButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteCollection(id);
      if (!result.success) {
        toast.error(result.error);
        setConfirming(false);
        return;
      }
      toast.success("Collection deleted — its products are untouched");
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
            aria-label={`Confirm delete "${name}"`}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-white transition-colors hover:bg-red-700 disabled:opacity-60"
          >
            {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
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
          onClick={() => setConfirming(true)}
          aria-label={`Delete "${name}"`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-4 w-4" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
