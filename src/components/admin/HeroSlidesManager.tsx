"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  GalleryHorizontal,
  Link2,
  Loader2,
  Package,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  deleteHeroSlide,
  reorderHeroSlides,
  setHeroSlideActive,
  type HeroProductOption,
} from "@/lib/actions/hero-slides";
import {
  heroWindowState,
  type HeroDestinationIssue,
  type HeroWindowState,
} from "@/lib/hero-slides";
import { storeDateEnd, storeDateStart } from "@/lib/timezone";
import { HERO_MAX_SLIDES } from "@/lib/validators";
import { cn } from "@/lib/utils";
import Pill from "./Pill";
import HeroSlideModal from "./HeroSlideModal";

/** One slide as the admin list + modal see it — plain, serializable values. */
export type HeroSlideAdminView = {
  id: string;
  eyebrow: string | null;
  title: string | null;
  subtitle: string | null;
  ctaLabel: string;
  showPrice: boolean;
  imageDesktop: string;
  imageMobile: string | null;
  imageAlt: string;
  productId: string | null;
  productName: string | null;
  linkUrl: string | null;
  isActive: boolean;
  /** Cairo day keys ("YYYY-MM-DD") — the date inputs' values. */
  startsOn: string | null;
  endsOn: string | null;
  /** Cairo-formatted labels ("21 Oct 2026"). */
  startsLabel: string | null;
  endsLabel: string | null;
  /** Primary badge: the switch + time window only. */
  status: HeroWindowState;
  /** Separate warning chip: why it can't show even inside its window. */
  issue: HeroDestinationIssue | null;
};

const STATUS_PILL: Record<HeroWindowState, { label: string; cls: string }> = {
  live: { label: "Live", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  scheduled: { label: "Scheduled", cls: "bg-amber-50 text-amber-700 ring-amber-600/20" },
  expired: { label: "Expired", cls: "bg-stone-100 text-stone-500 ring-stone-500/20" },
  inactive: { label: "Inactive", cls: "bg-stone-100 text-stone-500 ring-stone-500/20" },
};

const ISSUE_LABEL: Record<HeroDestinationIssue, string> = {
  "product-unavailable": "Product unavailable",
  "no-destination": "No destination",
};

/** The slide's display name — the headline, else its image description. */
function slideName(slide: HeroSlideAdminView) {
  return slide.title ?? slide.imageAlt;
}

/**
 * Admin manager for the homepage hero slides: every slide in its saved order,
 * ▲/▼ to move one step (the full id list goes to `reorderHeroSlides`, rewritten
 * in one transaction), an active switch, edit and an inline confirm-in-place
 * delete. Reorder + toggle are optimistic and roll back on `{ success: false }`;
 * every success re-reads the list through `router.refresh()`.
 */
export default function HeroSlidesManager({
  slides,
  products,
}: {
  slides: HeroSlideAdminView[];
  products: HeroProductOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Local mirror so moves + toggles feel instant; re-synced whenever the server
  // list changes underneath us (after any router.refresh()).
  const [items, setItems] = useState(slides);
  const savedRef = useRef(slides);
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- mirror server truth */
    setItems(slides);
    savedRef.current = slides;
  }, [slides]);

  // null = closed; "new" = create; otherwise the slide being edited.
  const [modal, setModal] = useState<HeroSlideAdminView | "new" | null>(null);
  const atCap = items.length >= HERO_MAX_SLIDES;

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;

    const previous = items;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);

    startTransition(async () => {
      const result = await reorderHeroSlides(next.map((s) => s.id));
      if (!result.success) {
        setItems(previous); // revert
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function toggleActive(slide: HeroSlideAdminView) {
    const isActive = !slide.isActive;
    // Optimistic badge from the same rule the server uses; the refresh that
    // follows replaces it with the server's own computation.
    const status = heroWindowState(
      {
        isActive,
        startsAt: slide.startsOn ? storeDateStart(slide.startsOn) : null,
        endsAt: slide.endsOn ? storeDateEnd(slide.endsOn) : null,
      },
      new Date(),
    );
    const patch = (s: HeroSlideAdminView) =>
      s.id === slide.id ? { ...s, isActive, status } : s;
    setItems((current) => current.map(patch));

    startTransition(async () => {
      const result = await setHeroSlideActive(slide.id, isActive);
      if (!result.success) {
        setItems((current) =>
          current.map((s) =>
            s.id === slide.id ? { ...s, isActive: slide.isActive, status: slide.status } : s,
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
            <GalleryHorizontal className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-serif text-xl font-medium text-stone-900">Homepage Banners</h2>
            <p className="text-xs text-stone-400">
              Live slides replace the classic hero, in this order (up to 5 at a time).{" "}
              <span className="tabular-nums">
                {items.length}/{HERO_MAX_SLIDES}
              </span>{" "}
              slides.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setModal("new")}
          disabled={atCap}
          title={atCap ? `At most ${HERO_MAX_SLIDES} slides — delete an old one first.` : undefined}
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Add Slide
        </button>
      </div>

      {items.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-stone-200 px-6 py-10 text-center">
          <p className="text-sm font-medium text-stone-700">No slides yet</p>
          <p className="mt-1 text-xs text-stone-400">
            The homepage shows the classic hero until at least one slide is live.
          </p>
        </div>
      ) : (
        <ul className="mt-5 space-y-2.5">
          <AnimatePresence initial={false}>
            {items.map((slide, i) => (
              <motion.li
                key={slide.id}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="flex items-center gap-3 rounded-xl border border-stone-200/80 bg-white px-3 py-3"
              >
                {/* ▲ / ▼ */}
                <div className="flex shrink-0 flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={isPending || i === 0}
                    aria-label={`Move "${slideName(slide)}" up`}
                    className="flex h-6 w-6 items-center justify-center rounded text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={isPending || i === items.length - 1}
                    aria-label={`Move "${slideName(slide)}" down`}
                    className="flex h-6 w-6 items-center justify-center rounded text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Thumbnail — plain <img>: UploadThing / /public URLs only. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={slide.imageDesktop}
                  alt=""
                  className="h-12 w-28 shrink-0 rounded-lg object-cover ring-1 ring-stone-200"
                />

                {/* Name, destination, schedule */}
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate text-sm font-medium",
                      slide.isActive ? "text-stone-900" : "text-stone-400",
                    )}
                  >
                    {slideName(slide)}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-stone-400">
                    {slide.productId ? (
                      <Package className="h-3 w-3 shrink-0" />
                    ) : (
                      <Link2 className="h-3 w-3 shrink-0" />
                    )}
                    <span className="truncate">
                      {slide.productName ?? slide.linkUrl ?? "—"}
                    </span>
                    <span aria-hidden>·</span>
                    <span className="shrink-0 tabular-nums">
                      {slide.startsLabel || slide.endsLabel
                        ? `${slide.startsLabel ?? "Now"} → ${slide.endsLabel ?? "Open-ended"}`
                        : "Always"}
                    </span>
                  </p>
                </div>

                {/* Status + destination warning (separate chips) */}
                <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center">
                  <Pill className={STATUS_PILL[slide.status].cls}>
                    {STATUS_PILL[slide.status].label}
                  </Pill>
                  {slide.issue && (
                    <Pill className="bg-red-50 text-red-700 ring-red-600/20">
                      <AlertTriangle className="h-3 w-3" />
                      {ISSUE_LABEL[slide.issue]}
                    </Pill>
                  )}
                </div>

                {/* Active switch */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={slide.isActive}
                  aria-label={slide.isActive ? "Hide from storefront" : "Show on storefront"}
                  onClick={() => toggleActive(slide)}
                  disabled={isPending}
                  className={cn(
                    "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60",
                    slide.isActive ? "bg-primary" : "bg-stone-300",
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                      slide.isActive ? "translate-x-5" : "translate-x-0.5",
                    )}
                  />
                </button>

                {/* Edit */}
                <button
                  type="button"
                  onClick={() => setModal(slide)}
                  aria-label={`Edit "${slideName(slide)}"`}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
                >
                  <Pencil className="h-4 w-4" />
                </button>

                <DeleteSlideButton id={slide.id} name={slideName(slide)} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      <HeroSlideModal
        isOpen={modal !== null}
        slide={modal && modal !== "new" ? modal : undefined}
        products={products}
        onClose={() => setModal(null)}
      />
    </section>
  );
}

/** Inline "Delete?" confirm-in-place, mirroring the FAQ / footer-link rows. */
function DeleteSlideButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteHeroSlide(id);
      if (!result.success) {
        toast.error(result.error);
        setConfirming(false);
        return;
      }
      toast.success("Slide deleted");
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
          transition={{ duration: 0.15 }}
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
