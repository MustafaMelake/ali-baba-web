"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  Pencil,
  Percent,
  Trash2,
  Check,
  X,
  Loader2,
  Tag,
} from "lucide-react";
import { toast } from "sonner";
import { deleteMenuCategory } from "@/lib/actions/menu";
import MenuCategoryModal from "@/components/admin/menu/MenuCategoryModal";
import BulkPriceModal from "@/components/admin/menu/BulkPriceModal";
import MenuItemsEditor, { type AdminMenuItem } from "@/components/admin/menu/MenuItemsEditor";

export type AdminMenuCategory = {
  id: string;
  title: string;
  slug: string;
  order: number;
  isFixedPrice: boolean;
  items: AdminMenuItem[];
};

export default function MenuCategoryCard({
  category,
}: {
  category: AdminMenuCategory;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  const itemCount = category.items.length;

  function remove() {
    startTransition(async () => {
      const result = await deleteMenuCategory(category.id);
      if (!result.success) {
        toast.error(result.error);
        setConfirming(false);
        return;
      }
      toast.success(`"${category.title}" deleted`);
      router.refresh();
    });
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm">
      {/* Header — stacks on phones (title, then a full-width action row);
          side by side from `sm`, where the title side truncates instead. */}
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:p-5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="group flex min-w-0 flex-1 items-start gap-3 text-left"
          aria-expanded={expanded}
        >
          <ChevronDown
            className={`mt-1 h-5 w-5 shrink-0 text-stone-400 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="shrink-0 rounded-md bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-stone-500">
                #{category.order}
              </span>
              <h2 className="min-w-0 max-w-full truncate font-serif text-lg font-medium text-stone-900 sm:text-xl">
                {category.title}
              </h2>
              {category.isFixedPrice && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary ring-1 ring-inset ring-primary/20">
                  <Tag className="h-3 w-3" />
                  Fixed price
                </span>
              )}
            </div>
            <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-stone-400">
              <span className="shrink-0 tabular-nums">
                {itemCount} item{itemCount === 1 ? "" : "s"}
              </span>
              <span aria-hidden="true">·</span>
              <span className="min-w-0 truncate" title={`/${category.slug}`}>
                /{category.slug}
              </span>
            </p>
          </div>
        </button>

        {/* Actions — 40px touch targets on phones, compact pills from `sm`. */}
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:flex-nowrap sm:justify-end">
          <button
            type="button"
            onClick={() => setBulkOpen(true)}
            disabled={itemCount === 0}
            title={itemCount === 0 ? "Add items first" : "Adjust all prices"}
            className="inline-flex h-10 items-center gap-1.5 rounded-full border border-stone-200 px-4 text-xs font-semibold text-stone-600 transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 sm:h-8 sm:px-3"
          >
            <Percent className="h-3.5 w-3.5" />
            Prices
          </button>
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="inline-flex h-10 items-center gap-1.5 rounded-full border border-stone-200 px-4 text-xs font-semibold text-stone-600 transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary sm:h-8 sm:px-3"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>

          {/* Delete (inline confirm) */}
          <AnimatePresence mode="wait" initial={false}>
            {confirming ? (
              <motion.div
                key="confirm"
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.18 }}
                className="inline-flex h-10 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full border border-red-200 bg-red-50 pl-3 pr-1.5 text-xs font-semibold text-red-700 sm:h-8 sm:pl-2.5 sm:pr-1"
              >
                <span>Delete?</span>
                <button
                  type="button"
                  onClick={remove}
                  disabled={isPending}
                  aria-label={`Confirm delete ${category.title}`}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-red-600 text-white transition-colors hover:bg-red-700 disabled:opacity-60 sm:h-6 sm:w-6"
                >
                  {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={isPending}
                  aria-label="Cancel delete"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-red-700 transition-colors hover:bg-red-100 disabled:opacity-60 sm:h-6 sm:w-6"
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
                aria-label={`Delete ${category.title}`}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-stone-200 text-stone-400 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 sm:h-8 sm:w-8"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Items editor (collapsible) */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 sm:px-5 sm:pb-5">
              {category.isFixedPrice && (
                <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-500">
                  Fixed-price category — new items inherit the shared price. Use{" "}
                  <span className="font-medium text-stone-700">Prices</span> to shift them all together.
                </p>
              )}
              <MenuItemsEditor
                categoryId={category.id}
                isFixedPrice={category.isFixedPrice}
                items={category.items}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modals */}
      <MenuCategoryModal
        category={{
          id: category.id,
          title: category.title,
          order: category.order,
          isFixedPrice: category.isFixedPrice,
        }}
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
      />
      <BulkPriceModal
        categoryId={category.id}
        categoryTitle={category.title}
        itemCount={itemCount}
        isOpen={bulkOpen}
        onClose={() => setBulkOpen(false)}
      />
    </article>
  );
}
