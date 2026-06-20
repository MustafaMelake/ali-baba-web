"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { createMenuItem, updateMenuItem, deleteMenuItem } from "@/lib/actions/menu";

export type AdminMenuItem = { id: string; name: string; price: number };

const fieldClasses =
  "rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition-colors placeholder:text-stone-400 focus:border-primary focus:ring-2 focus:ring-primary/20";

// ─── Existing item row ────────────────────────────────────────────
function MenuItemRow({ item }: { item: AdminMenuItem }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState(String(item.price));

  const dirty = name !== item.name || price !== String(item.price);

  function save() {
    startTransition(async () => {
      const result = await updateMenuItem({
        id: item.id,
        name: name.trim(),
        price: price === "" ? Number.NaN : Number(price),
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Item saved");
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteMenuItem(item.id);
      if (!result.success) {
        toast.error(result.error);
        setConfirming(false);
        return;
      }
      toast.success("Item removed");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2 py-2">
      {/* Price */}
      <input
        type="number"
        min="0"
        step="0.5"
        inputMode="decimal"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        aria-label={`Price for ${item.name}`}
        className={`${fieldClasses} w-24 shrink-0 tabular-nums`}
      />
      {/* Name (Arabic, RTL) */}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        dir="rtl"
        lang="ar"
        aria-label="Item name"
        className={`${fieldClasses} min-w-0 flex-1 text-right`}
      />

      {/* Save (only when dirty) */}
      {dirty && (
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-primary px-2.5 text-xs font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Save
        </button>
      )}

      {/* Delete (inline confirm) */}
      {confirming ? (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={remove}
            disabled={isPending}
            aria-label="Confirm delete"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-600 text-white transition-colors hover:bg-red-700 disabled:opacity-60"
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={isPending}
            aria-label="Cancel delete"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={`Delete ${item.name}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// ─── Add-item row ─────────────────────────────────────────────────
function AddItemRow({
  categoryId,
  defaultPrice,
}: {
  categoryId: string;
  defaultPrice?: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [price, setPrice] = useState(defaultPrice != null ? String(defaultPrice) : "");

  function add() {
    startTransition(async () => {
      const result = await createMenuItem({
        categoryId,
        name: name.trim(),
        price: price === "" ? Number.NaN : Number(price),
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Item added");
      setName("");
      setPrice(defaultPrice != null ? String(defaultPrice) : "");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2 border-t border-dashed border-stone-200 pt-3">
      <input
        type="number"
        min="0"
        step="0.5"
        inputMode="decimal"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        placeholder="Price"
        aria-label="New item price"
        className={`${fieldClasses} w-24 shrink-0 tabular-nums`}
      />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        dir="rtl"
        lang="ar"
        placeholder="اسم الصنف"
        aria-label="New item name"
        className={`${fieldClasses} min-w-0 flex-1 text-right`}
      />
      <button
        type="button"
        onClick={add}
        disabled={isPending || name.trim() === ""}
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-primary/30 bg-primary/5 px-2.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        Add
      </button>
    </div>
  );
}

// ─── Editor ───────────────────────────────────────────────────────
export default function MenuItemsEditor({
  categoryId,
  isFixedPrice,
  items,
}: {
  categoryId: string;
  isFixedPrice: boolean;
  items: AdminMenuItem[];
}) {
  // In a fixed-price category, pre-fill new items with the shared price so the
  // whole category stays internally consistent.
  const sharedPrice = isFixedPrice ? items[0]?.price : undefined;

  return (
    <div className="mt-4 space-y-1 border-t border-stone-100 pt-4">
      {items.length === 0 ? (
        <p className="py-2 text-sm text-stone-400">No items yet. Add the first one below.</p>
      ) : (
        items.map((item) => (
          // Composite key remounts the row when server data changes (save / bulk
          // adjust), resyncing local input state without a set-state effect.
          <MenuItemRow key={`${item.id}:${item.name}:${item.price}`} item={item} />
        ))
      )}
      <AddItemRow categoryId={categoryId} defaultPrice={sharedPrice} />
    </div>
  );
}
