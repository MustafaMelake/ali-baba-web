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
  MapPin,
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
  deleteLocation,
  reorderLocations,
  updateLocation,
  type LocationRow,
} from "@/lib/actions/locations";
import { cn } from "@/lib/utils";
import Pill from "./Pill";
import LocationModal, { type EditableLocation } from "./LocationModal";

/** Two lists represent the same order iff their ids line up position-for-position. */
function sameOrder(a: LocationRow[], b: LocationRow[]) {
  return a.length === b.length && a.every((row, i) => row.id === b[i].id);
}

/**
 * Admin manager for the storefront "Our Locations" showcase. Lists every location
 * (active + inactive) in its saved order with real drag-and-drop reordering
 * (framer-motion `Reorder`, the sanctioned motion lib — no dnd-kit dependency), an
 * active toggle, edit and delete, plus a shared modal to add/edit. Mutations run
 * through the `locations` Server Actions and the card re-reads via
 * `router.refresh()`; reorder + toggle are applied optimistically so the UI feels
 * instant. Mirrors FaqManager one-for-one.
 */
export default function LocationManager({
  locations,
}: {
  locations: LocationRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Local mirror so drag + toggle feel instant; re-synced whenever the server
  // list changes underneath us (after any router.refresh()).
  const [items, setItems] = useState(locations);
  // Latest rendered order — read inside drag-end so the commit never closes over
  // a stale render (framer-motion mutates order live via onReorder). Synced in an
  // effect, never during render (react-hooks/refs).
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  // The order the server has confirmed: both the rollback target and the
  // "did anything actually move?" baseline.
  const savedRef = useRef(locations);

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- mirror server truth */
    setItems(locations);
    savedRef.current = locations;
  }, [locations]);

  // null = closed; "new" = create; otherwise the location being edited.
  const [modal, setModal] = useState<EditableLocation | "new" | null>(null);

  // Persist the current order once a drag settles — only if the sequence
  // actually changed, so a click/nudge that lands in place is a no-op. The full
  // id list goes to `reorderLocations`, which rewrites every `order` in one
  // transaction (no gaps, no duplicates).
  function commitOrder() {
    const next = itemsRef.current;
    if (sameOrder(next, savedRef.current)) return;

    const previous = savedRef.current;
    savedRef.current = next; // optimistic baseline

    startTransition(async () => {
      const result = await reorderLocations(next.map((l) => l.id));
      if (!result.success) {
        savedRef.current = previous;
        setItems(previous); // revert
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function toggleActive(location: LocationRow) {
    const next = !location.isActive;
    setItems((current) =>
      current.map((l) => (l.id === location.id ? { ...l, isActive: next } : l)),
    );

    startTransition(async () => {
      const result = await updateLocation(location.id, {
        tag: location.tag,
        hours: location.hours,
        title: location.title,
        description: location.description,
        imageUrl: location.imageUrl,
        locality: location.locality,
        type: location.type,
        isActive: next,
      });
      if (!result.success) {
        setItems((current) =>
          current.map((l) =>
            l.id === location.id ? { ...l, isActive: !next } : l,
          ),
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
            <MapPin className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-serif text-xl font-medium text-stone-900">
              Our Locations
            </h2>
            <p className="text-xs text-stone-400">
              Drag to reorder. Active locations appear in the homepage “Our
              Locations” section in this order.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setModal("new")}
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Add Location
        </button>
      </div>

      {items.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-stone-200 px-6 py-10 text-center">
          <p className="text-sm font-medium text-stone-700">No locations yet</p>
          <p className="mt-1 text-xs text-stone-400">
            Add your first location — the homepage “Our Locations” section stays
            hidden until at least one is active.
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
            {items.map((location) => (
              <LocationCard
                key={location.id}
                location={location}
                disabled={isPending}
                onCommit={commitOrder}
                onToggle={() => toggleActive(location)}
                onEdit={() =>
                  setModal({
                    id: location.id,
                    tag: location.tag,
                    hours: location.hours,
                    title: location.title,
                    description: location.description,
                    imageUrl: location.imageUrl,
                    locality: location.locality,
                    type: location.type,
                    isActive: location.isActive,
                  })
                }
              />
            ))}
          </AnimatePresence>
        </Reorder.Group>
      )}

      <LocationModal
        isOpen={modal !== null}
        location={modal && modal !== "new" ? modal : undefined}
        onClose={() => setModal(null)}
      />
    </section>
  );
}

/** One draggable location row. Drag is scoped to the grip handle (`dragListener={false}`
 *  + `useDragControls`) so the toggle / edit / delete buttons stay clickable. */
function LocationCard({
  location,
  disabled,
  onCommit,
  onToggle,
  onEdit,
}: {
  location: LocationRow;
  disabled: boolean;
  onCommit: () => void;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const controls = useDragControls();

  return (
    <Reorder.Item
      value={location}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onCommit}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="flex items-center gap-3 rounded-xl border border-stone-200/80 bg-white px-3 py-3"
    >
      {/* Drag handle — the only surface that initiates a reorder. */}
      <button
        type="button"
        onPointerDown={(e) => {
          if (!disabled) controls.start(e);
        }}
        aria-label={`Drag to reorder "${location.title}"`}
        className="flex h-7 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-stone-300 transition-colors hover:text-stone-500 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
        disabled={disabled}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Thumbnail — a plain <img> (not next/image) so arbitrary UploadThing /
          external URLs render without remotePatterns config. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={location.imageUrl}
        alt=""
        className={cn(
          "h-11 w-11 shrink-0 rounded-lg object-cover ring-1 ring-stone-200/70",
          !location.isActive && "opacity-50 grayscale",
        )}
      />

      {/* Title + tag · locality */}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-sm font-medium",
            location.isActive ? "text-stone-900" : "text-stone-400",
          )}
        >
          {location.title}
        </p>
        <p className="mt-0.5 truncate text-xs text-stone-400">
          {location.tag} · {location.locality}
        </p>
      </div>

      {/* Status */}
      <Pill
        className={cn(
          "shrink-0",
          location.isActive
            ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
            : "bg-stone-100 text-stone-500 ring-stone-200",
        )}
      >
        {location.isActive ? "Active" : "Hidden"}
      </Pill>

      {/* Active toggle */}
      <button
        type="button"
        role="switch"
        aria-checked={location.isActive}
        aria-label={location.isActive ? "Hide from storefront" : "Show on storefront"}
        onClick={onToggle}
        disabled={disabled}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60",
          location.isActive ? "bg-primary" : "bg-stone-300",
        )}
      >
        <span
          className={cn(
            "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
            location.isActive ? "translate-x-5" : "translate-x-0.5",
          )}
        />
      </button>

      {/* Edit */}
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit "${location.title}"`}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
      >
        <Pencil className="h-4 w-4" />
      </button>

      {/* Delete */}
      <DeleteLocationButton id={location.id} title={location.title} />
    </Reorder.Item>
  );
}

/** Inline "Are you sure?" delete, mirroring the FAQ / footer-link / branch /
 *  category delete buttons — a confirm-in-place control, not a separate modal. */
function DeleteLocationButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteLocation(id);
      if (!result.success) {
        toast.error(result.error);
        setConfirming(false);
        return;
      }
      toast.success("Location deleted");
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
            aria-label={`Confirm delete "${title}"`}
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
          aria-label={`Delete "${title}"`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-4 w-4" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
