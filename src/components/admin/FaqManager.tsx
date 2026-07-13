"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AnimatePresence,
  Reorder,
  motion,
  useDragControls,
} from "framer-motion";
import {
  HelpCircle,
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  Check,
  X,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  deleteFaq,
  reorderFaqs,
  updateFaq,
  type FaqRow,
} from "@/lib/actions/faqs";
import { cn } from "@/lib/utils";
import Pill from "./Pill";
import FaqModal, { type EditableFaq } from "./FaqModal";

/** Two lists represent the same order iff their ids line up position-for-position. */
function sameOrder(a: FaqRow[], b: FaqRow[]) {
  return a.length === b.length && a.every((row, i) => row.id === b[i].id);
}

/**
 * Admin manager for the storefront FAQ section. Lists every FAQ (active +
 * inactive) in its saved order with real drag-and-drop reordering (framer-motion
 * `Reorder`, the sanctioned motion lib — no dnd-kit dependency), an active
 * toggle, edit and delete, plus a shared modal to add/edit. Mutations run through
 * the `faqs` Server Actions and the card re-reads via `router.refresh()`;
 * reorder + toggle are applied optimistically so the UI feels instant.
 */
export default function FaqManager({ faqs }: { faqs: FaqRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Local mirror so drag + toggle feel instant; re-synced whenever the server
  // list changes underneath us (after any router.refresh()).
  const [items, setItems] = useState(faqs);
  // Latest rendered order — read inside drag-end so the commit never closes over
  // a stale render (framer-motion mutates order live via onReorder). Synced in an
  // effect, never during render (react-hooks/refs).
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  // The order the server has confirmed: both the rollback target and the
  // "did anything actually move?" baseline.
  const savedRef = useRef(faqs);

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- mirror server truth */
    setItems(faqs);
    savedRef.current = faqs;
  }, [faqs]);

  // null = closed; "new" = create; otherwise the FAQ being edited.
  const [modal, setModal] = useState<EditableFaq | "new" | null>(null);

  // Persist the current order once a drag settles — only if the sequence
  // actually changed, so a click/nudge that lands in place is a no-op. The full
  // id list goes to `reorderFaqs`, which rewrites every `order` in one
  // transaction (no gaps, no duplicates).
  function commitOrder() {
    const next = itemsRef.current;
    if (sameOrder(next, savedRef.current)) return;

    const previous = savedRef.current;
    savedRef.current = next; // optimistic baseline

    startTransition(async () => {
      const result = await reorderFaqs(next.map((f) => f.id));
      if (!result.success) {
        savedRef.current = previous;
        setItems(previous); // revert
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function toggleActive(faq: FaqRow) {
    const next = !faq.isActive;
    setItems((current) =>
      current.map((f) => (f.id === faq.id ? { ...f, isActive: next } : f)),
    );

    startTransition(async () => {
      const result = await updateFaq(faq.id, {
        question: faq.question,
        answer: faq.answer,
        isActive: next,
      });
      if (!result.success) {
        setItems((current) =>
          current.map((f) => (f.id === faq.id ? { ...f, isActive: !next } : f)),
        );
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="rounded-2xl border border-stone-200/70 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-stone-100 pb-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <HelpCircle className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-serif text-xl font-medium text-stone-900">
              Frequently Asked Questions
            </h2>
            <p className="text-xs text-stone-400">
              Drag to reorder. Active questions appear in the storefront FAQ
              accordion in this order.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setModal("new")}
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Add FAQ
        </button>
      </div>

      {items.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-stone-200 px-6 py-10 text-center">
          <p className="text-sm font-medium text-stone-700">No FAQs yet</p>
          <p className="mt-1 text-xs text-stone-400">
            Add your first question — the storefront FAQ section stays hidden
            until at least one is active.
          </p>
        </div>
      ) : (
        <Reorder.Group
          axis="y"
          values={items}
          onReorder={setItems}
          className="mt-5 space-y-2.5"
        >
          <AnimatePresence initial={false}>
            {items.map((faq) => (
              <FaqCard
                key={faq.id}
                faq={faq}
                disabled={isPending}
                onCommit={commitOrder}
                onToggle={() => toggleActive(faq)}
                onEdit={() =>
                  setModal({
                    id: faq.id,
                    question: faq.question,
                    answer: faq.answer,
                    isActive: faq.isActive,
                  })
                }
              />
            ))}
          </AnimatePresence>
        </Reorder.Group>
      )}

      <FaqModal
        isOpen={modal !== null}
        faq={modal && modal !== "new" ? modal : undefined}
        onClose={() => setModal(null)}
      />
    </section>
  );
}

/** One draggable FAQ row. Drag is scoped to the grip handle (`dragListener={false}`
 *  + `useDragControls`) so the toggle / edit / delete buttons stay clickable. */
function FaqCard({
  faq,
  disabled,
  onCommit,
  onToggle,
  onEdit,
}: {
  faq: FaqRow;
  disabled: boolean;
  onCommit: () => void;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const controls = useDragControls();

  return (
    <Reorder.Item
      value={faq}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onCommit}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="flex items-start gap-3 rounded-xl border border-stone-200/80 bg-white px-3 py-3"
    >
      {/* Drag handle — the only surface that initiates a reorder. */}
      <button
        type="button"
        onPointerDown={(e) => {
          if (!disabled) controls.start(e);
        }}
        aria-label={`Drag to reorder "${faq.question}"`}
        className="mt-0.5 flex h-7 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-stone-300 transition-colors hover:text-stone-500 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
        disabled={disabled}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Question + truncated answer */}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-sm font-medium",
            faq.isActive ? "text-stone-900" : "text-stone-400",
          )}
        >
          {faq.question}
        </p>
        <p className="mt-0.5 line-clamp-2 text-xs text-stone-400">
          {faq.answer}
        </p>
      </div>

      {/* Status */}
      <Pill
        className={cn(
          "mt-0.5 shrink-0",
          faq.isActive
            ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
            : "bg-stone-100 text-stone-500 ring-stone-200",
        )}
      >
        {faq.isActive ? "Active" : "Hidden"}
      </Pill>

      {/* Active toggle */}
      <button
        type="button"
        role="switch"
        aria-checked={faq.isActive}
        aria-label={faq.isActive ? "Hide from storefront" : "Show on storefront"}
        onClick={onToggle}
        disabled={disabled}
        className={cn(
          "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60",
          faq.isActive ? "bg-primary" : "bg-stone-300",
        )}
      >
        <span
          className={cn(
            "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
            faq.isActive ? "translate-x-5" : "translate-x-0.5",
          )}
        />
      </button>

      {/* Edit */}
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit "${faq.question}"`}
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
      >
        <Pencil className="h-4 w-4" />
      </button>

      {/* Delete */}
      <DeleteFaqButton id={faq.id} question={faq.question} />
    </Reorder.Item>
  );
}

/** Inline "Are you sure?" delete, mirroring the footer-link / branch / category
 *  delete buttons — a confirm-in-place control, not a separate modal. */
function DeleteFaqButton({ id, question }: { id: string; question: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteFaq(id);
      if (!result.success) {
        toast.error(result.error);
        setConfirming(false);
        return;
      }
      toast.success("FAQ deleted");
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
          className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700"
        >
          <span>Delete?</span>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            aria-label={`Confirm delete "${question}"`}
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
          aria-label={`Delete "${question}"`}
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-4 w-4" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
