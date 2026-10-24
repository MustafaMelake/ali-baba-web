"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Reorder, useDragControls } from "framer-motion";
import { AlertTriangle, ArrowDown, ArrowUp, GripVertical, Loader2, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import {
  addCategoryProductsToCollection,
  setCollectionCategories,
  setCollectionProducts,
  type CollectionDetail,
} from "@/lib/actions/collections";
import { COLLECTION_MAX_PRODUCTS } from "@/lib/validators";
import MultiSelect from "./MultiSelect";

type Product = CollectionDetail["products"][number];
export type ProductOption = Product;

const inputClasses =
  "w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-900 outline-none transition-colors placeholder:text-stone-400 focus:border-primary focus:ring-2 focus:ring-primary/20";
const card = "rounded-2xl border border-stone-200/70 bg-white p-6 text-start shadow-sm";

const sameOrder = (a: Product[], b: Product[]) =>
  a.length === b.length && a.every((p, i) => p.id === b[i].id);

/**
 * What's IN a collection: the categories it's shown under, and its products in
 * curated order. Products reorder by drag (the grip handle) with ▲/▼ as the
 * keyboard fallback; every change saves the full ordered list through
 * `setCollectionProducts` (one short transaction), optimistically, rolling back
 * on `{ success: false }`. Add one product by search, or every product of a
 * category at once.
 */
export default function CollectionContentsEditor({
  collection,
  categories,
  productOptions,
}: {
  collection: CollectionDetail;
  categories: { id: string; name: string }[];
  productOptions: ProductOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // ── Categories ──
  const [categoryIds, setCategoryIds] = useState(collection.categoryIds);
  const categoriesDirty =
    categoryIds.length !== collection.categoryIds.length ||
    categoryIds.some((id) => !collection.categoryIds.includes(id));

  function saveCategories() {
    startTransition(async () => {
      const result = await setCollectionCategories(collection.id, categoryIds);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Categories saved");
      router.refresh();
    });
  }

  // ── Products ──
  const [items, setItems] = useState(collection.products);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const savedRef = useRef(collection.products);
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- mirror server truth */
    setItems(collection.products);
    savedRef.current = collection.products;
  }, [collection.products]);

  /** Persist `next` as the collection's full ordered product list. */
  function save(next: Product[], success?: string) {
    if (sameOrder(next, savedRef.current)) return;
    const previous = savedRef.current;
    savedRef.current = next;
    setItems(next);
    startTransition(async () => {
      const result = await setCollectionProducts(collection.id, next.map((p) => p.id));
      if (!result.success) {
        savedRef.current = previous;
        setItems(previous);
        toast.error(result.error);
        return;
      }
      if (success) toast.success(success);
      router.refresh();
    });
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    save(next);
  }

  // Add one product by search.
  const [query, setQuery] = useState("");
  const inCollection = new Set(items.map((p) => p.id));
  const q = query.trim().toLowerCase();
  const matches = q
    ? productOptions.filter((p) => !inCollection.has(p.id) && p.name.toLowerCase().includes(q)).slice(0, 8)
    : [];
  const atCap = items.length >= COLLECTION_MAX_PRODUCTS;

  // Bulk add a whole category.
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  function addCategory() {
    if (!bulkCategoryId) return;
    startTransition(async () => {
      const result = await addCategoryProductsToCollection(collection.id, bulkCategoryId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(result.added === 0 ? "Everything in that category is already here" : `Added ${result.added} products`);
      setBulkCategoryId("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-8">
      {/* ── Categories ─────────────────────────────────────── */}
      <section className={card}>
        <h2 className="font-serif text-xl font-medium text-stone-900">Shown under categories</h2>
        <p className="mt-1 text-xs text-stone-400">
          The collection appears as a card at the top of each chosen category&apos;s page.
        </p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex-1">
            <MultiSelect
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
              selected={categoryIds}
              onChange={setCategoryIds}
              placeholder="Not shown under any category"
              searchPlaceholder="Search categories…"
            />
          </div>
          <button
            type="button"
            onClick={saveCategories}
            disabled={!categoriesDirty || isPending}
            className="shrink-0 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            Save categories
          </button>
        </div>
      </section>

      {/* ── Products ───────────────────────────────────────── */}
      <section className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-serif text-xl font-medium text-stone-900">Products</h2>
          <span className="text-xs text-stone-400">
            <span className="tabular-nums">{items.length}</span>/{COLLECTION_MAX_PRODUCTS} · drag to reorder, or use ▲▼
            {isPending && <Loader2 className="ms-2 inline h-3.5 w-3.5 animate-spin" />}
          </span>
        </div>

        {/* Add */}
        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="col-add-product" className="sr-only">
              Add a product
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
              <input
                id="col-add-product"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={atCap ? "This collection is full" : "Add a product…"}
                disabled={atCap}
                autoComplete="off"
                className={`${inputClasses} ps-10`}
              />
            </div>
            {q && (
              <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200">
                {matches.length === 0 ? (
                  <li className="px-3.5 py-3 text-sm text-stone-400">No products match.</li>
                ) : (
                  matches.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setQuery("");
                          save([...itemsRef.current, p], `Added "${p.name}"`);
                        }}
                        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-start transition-colors hover:bg-stone-50"
                      >
                        <Plus className="h-4 w-4 text-stone-400" />
                        <span className="min-w-0 flex-1 truncate text-sm text-stone-800">{p.name}</span>
                        <span className="shrink-0 text-xs text-stone-400">{p.categoryName}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
          <div className="flex gap-2">
            <label htmlFor="col-bulk-category" className="sr-only">
              Add every product of a category
            </label>
            <select
              id="col-bulk-category"
              value={bulkCategoryId}
              onChange={(e) => setBulkCategoryId(e.target.value)}
              className={inputClasses}
            >
              <option value="">Add every product of a category…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addCategory}
              disabled={!bulkCategoryId || isPending}
              className="shrink-0 rounded-full border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50 disabled:opacity-50"
            >
              Add all
            </button>
          </div>
        </div>

        {/* List */}
        {items.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-stone-200 px-6 py-10 text-center text-sm text-stone-400">
            No products yet — search above, or add a whole category.
          </div>
        ) : (
          <Reorder.Group axis="y" values={items} onReorder={setItems} className="mt-5 space-y-2">
            {items.map((p, i) => (
              <ProductRow
                key={p.id}
                product={p}
                index={i}
                count={items.length}
                disabled={isPending}
                onCommit={() => save(itemsRef.current)}
                onMove={(delta) => move(i, delta)}
                onRemove={() => save(items.filter((x) => x.id !== p.id), `Removed "${p.name}"`)}
              />
            ))}
          </Reorder.Group>
        )}
      </section>
    </div>
  );
}

/** One draggable product row. Drag is scoped to the grip; ▲/▼ are the keyboard path. */
function ProductRow({
  product,
  index,
  count,
  disabled,
  onCommit,
  onMove,
  onRemove,
}: {
  product: Product;
  index: number;
  count: number;
  disabled: boolean;
  onCommit: () => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={product}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onCommit}
      className="flex items-center gap-3 rounded-xl border border-stone-200/80 bg-white px-3 py-2.5"
    >
      <button
        type="button"
        onPointerDown={(e) => {
          if (!disabled) controls.start(e);
        }}
        aria-label={`Drag to reorder "${product.name}"`}
        tabIndex={-1}
        className="flex h-7 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-stone-300 transition-colors hover:text-stone-500 active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="w-7 shrink-0 text-center text-xs tabular-nums text-stone-400">{index + 1}</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={product.image ?? "/placeholder.jpg"}
        alt=""
        className="h-9 w-9 shrink-0 rounded-md object-cover ring-1 ring-stone-200"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-stone-900">{product.name}</p>
        <p className="flex items-center gap-1.5 truncate text-xs text-stone-400">
          {product.categoryName}
          {!product.isListable && (
            <span className="inline-flex items-center gap-1 text-amber-700">
              <AlertTriangle className="h-3 w-3" />
              Unavailable — hidden from customers
            </span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 gap-0.5">
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={disabled || index === 0}
          aria-label={`Move "${product.name}" up`}
          className="flex h-7 w-7 items-center justify-center rounded text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={disabled || index === count - 1}
          aria-label={`Move "${product.name}" down`}
          className="flex h-7 w-7 items-center justify-center rounded text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove "${product.name}" from the collection`}
          className="flex h-7 w-7 items-center justify-center rounded text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </Reorder.Item>
  );
}
