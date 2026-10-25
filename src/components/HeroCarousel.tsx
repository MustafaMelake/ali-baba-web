"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import useEmblaCarousel from "embla-carousel-react";
import Fade from "embla-carousel-fade";
import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import {
  HERO_AUTOPLAY_MS,
  HERO_COPY,
  HERO_RESUME_AFTER_MS,
  type HeroSlideView,
} from "@/lib/hero-slides";
import { useSeasonalIntro } from "@/lib/seasonal-intro-store";
import { cn, formatMoney } from "@/lib/utils";

// Cinematic cubic-bezier — matches the Hero's entrance curve.
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** The frame spans the content width (the same gutters as the classic hero image). */
const SIZES = "(max-width: 640px) 92vw, (max-width: 1024px) 94vw, 96vw";

// The frame's overlay switches on its OWN width (container queries, `@2xl` =
// 672px), not the viewport's, so the admin preview can render the phone layout
// inside a desktop window.

// ── Tab visibility (autoplay pauses in a background tab) ─────────────────────

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}
const isTabHidden = () => document.visibilityState === "hidden";
const serverTabHidden = () => false;

// "Has this tree hydrated?" — false in the server HTML, true from the first
// client render, with no effect + setState round-trip.
const noSubscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

/** Add `indexes` to a set, returning the SAME set when nothing is new (no re-render). */
function withIndexes(set: ReadonlySet<number>, indexes: number[]): ReadonlySet<number> {
  if (indexes.every((i) => set.has(i))) return set;
  return new Set([...set, ...indexes]);
}

/** Slide `i`, the one after it and the one before it (the loop wraps). */
function neighboursOf(i: number, count: number): number[] {
  return [i, (i + 1) % count, (i - 1 + count) % count];
}

/**
 * Did focus arrive from the keyboard? Autoplay pauses for keyboard focus only;
 * a tapped dot or arrow keeps (pointer) focus without matching :focus-visible.
 * An engine that can't evaluate the selector counts as keyboard (pausing is
 * the safe side).
 */
function isKeyboardFocus(target: EventTarget): boolean {
  if (!(target instanceof Element)) return false;
  try {
    return target.matches(":focus-visible");
  } catch {
    return true;
  }
}

// ── Media ────────────────────────────────────────────────────────────────────

/**
 * One slide's image — the same wide image on every screen size (the designed
 * banner carries its own text; `HeroSlide.imageMobile` is no longer used).
 * Slide 0 is the LCP element and is preloaded. Every other slide stays lazy
 * until the carousel `requested` it — see HeroCarousel.
 *
 * `onSettled(index)` fires once the image has loaded OR failed. A failed image
 * must not freeze autoplay; its frame shows the stone background instead. The
 * ref covers an image that was already complete (HTTP cache) before hydration
 * attached `onLoad`: that load event never reaches React, and waiting for it
 * was what kept the carousel from ever starting on a cached second visit.
 */
function SlideMedia({
  slide,
  index,
  requested,
  onSettled,
}: {
  slide: HeroSlideView;
  index: number;
  requested: boolean;
  onSettled: (index: number) => void;
}) {
  const isFirst = index === 0;
  const loading: "eager" | "lazy" = isFirst || requested ? "eager" : "lazy";
  const settle = useCallback(() => onSettled(index), [onSettled, index]);
  const settleIfComplete = useCallback(
    (img: HTMLImageElement | null) => {
      if (img?.complete && img.naturalWidth > 0) settle();
    },
    [settle],
  );

  return (
    <Image
      ref={settleIfComplete}
      src={slide.imageDesktop}
      alt={slide.imageAlt}
      fill
      sizes={SIZES}
      className="object-cover"
      {...(isFirst ? { preload: true } : { loading })}
      onLoad={settle}
      onError={settle}
    />
  );
}

// ── Slide ────────────────────────────────────────────────────────────────────

/**
 * The overlay: eyebrow, headline, subtitle, price pill, CTA — each rendered
 * only when present (a designed image may carry its own text). ONE link per
 * slide: the CTA, stretched over the whole frame so the banner is clickable
 * without a second, duplicate link. Logical properties only (start/end, ps/pe,
 * text-start) — RTL later is a `dir` flip, not a rewrite.
 *
 * Below `@2xl` (a phone) only a small CTA shows, at the bottom start corner:
 * the wide banner is ~150px tall there, and its designed image carries the
 * words, so the copy, the price pill and the scrim are desktop-only.
 */
function SlideOverlay({
  slide,
  linked,
  pricePlaceholder,
}: {
  slide: HeroSlideView;
  linked: boolean;
  pricePlaceholder?: string;
}) {
  const hasCopy = Boolean(
    slide.eyebrow || slide.title || slide.subtitle || slide.price || pricePlaceholder,
  );
  const name = slide.title ?? slide.imageAlt;

  const ctaClass = cn(
    "group inline-flex max-w-[60%] items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-stone-900 shadow-sm transition-colors duration-200 hover:bg-stone-100",
    "@2xl:mt-8 @2xl:max-w-none @2xl:gap-3 @2xl:px-7 @2xl:py-3.5 @2xl:text-sm",
    "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white",
  );
  const ctaContent = (
    <>
      <span className="truncate">{slide.ctaLabel}</span>
      <ArrowRight className="h-3 w-3 shrink-0 transition-transform duration-200 group-hover:translate-x-1 rtl:-scale-x-100 rtl:group-hover:-translate-x-1 @2xl:h-4 @2xl:w-4" />
    </>
  );

  return (
    <>
      {hasCopy && (
        // Subtle scrim on the start side for legibility — desktop only.
        <div className="pointer-events-none absolute inset-0 hidden bg-gradient-to-r from-black/55 via-black/15 to-transparent @2xl:block rtl:bg-gradient-to-l" />
      )}

      <div className="absolute inset-0 flex flex-col items-start justify-end ps-4 pb-3 text-start @2xl:max-w-[58%] @2xl:justify-center @2xl:ps-14 @2xl:pe-0 @2xl:pb-0 @5xl:ps-20">
        {slide.eyebrow && (
          <p className="mb-4 hidden text-[11px] font-semibold uppercase tracking-[0.3em] text-white/80 @2xl:block">
            {slide.eyebrow}
          </p>
        )}
        {slide.title && (
          <h2 className="hidden font-serif text-[clamp(1.75rem,5.2cqw,4.5rem)] font-medium leading-[1.05] tracking-tight text-white @2xl:block">
            {slide.title}
          </h2>
        )}
        {slide.subtitle && (
          <p className="mt-5 hidden max-w-md text-base leading-relaxed text-white/85 @2xl:block">
            {slide.subtitle}
          </p>
        )}

        {slide.price && (
          <p className="mt-6 hidden items-baseline gap-2 rounded-full bg-white/95 px-4 py-1.5 text-sm text-stone-900 shadow-sm @2xl:inline-flex">
            {slide.price.isFrom && <span className="text-stone-500">{HERO_COPY.priceFrom}</span>}
            {/* Storefront money: the bare figure + the mark as its own element,
                like every other storefront price (formatEGP is the admin format). */}
            <span className="font-semibold tabular-nums">
              {formatMoney(slide.price.amount)}{" "}
              <span className="text-xs font-normal text-stone-500">{HERO_COPY.currency}</span>
            </span>
            {slide.price.compareAt !== null && slide.price.compareAt > slide.price.amount && (
              <s className="text-xs text-stone-400 tabular-nums">
                {formatMoney(slide.price.compareAt)} {HERO_COPY.currency}
              </s>
            )}
          </p>
        )}
        {!slide.price && pricePlaceholder && (
          <p className="mt-6 hidden items-baseline gap-2 rounded-full bg-white/95 px-4 py-1.5 text-sm text-stone-500 shadow-sm @2xl:inline-flex">
            {pricePlaceholder}
          </p>
        )}

        {linked ? (
          <Link
            href={slide.href}
            aria-label={`${slide.ctaLabel} — ${name}`}
            // Stretched: the whole frame is this one link.
            className={cn(ctaClass, "after:absolute after:inset-0 after:content-['']")}
          >
            {ctaContent}
          </Link>
        ) : (
          <span className={ctaClass}>{ctaContent}</span>
        )}
      </div>
    </>
  );
}

/**
 * One slide frame — media + overlay — shared by the storefront carousel and
 * the admin modal's live preview. The caller sizes it (`className` carries the
 * aspect ratio); the frame is a size container, so its overlay lays itself out
 * for the width it actually has. `linked={false}` renders the CTA inert (the
 * preview must not navigate); `pricePlaceholder` stands in for the live price
 * pill the preview can't resolve.
 */
export function HeroSlideFrame({
  slide,
  media,
  linked = true,
  pricePlaceholder,
  className,
}: {
  slide: HeroSlideView;
  media: React.ReactNode;
  linked?: boolean;
  pricePlaceholder?: string;
  className?: string;
}) {
  return (
    <div className={cn("@container relative w-full overflow-hidden bg-stone-100", className)}>
      {media}
      <SlideOverlay slide={slide} linked={linked} pricePlaceholder={pricePlaceholder} />
    </div>
  );
}

/** One wide banner on every screen size: ≈2.35:1 (47:20), like the upload. */
export const HERO_FRAME_ASPECT = "aspect-[47/20]";

const controlButton =
  "pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/85 text-stone-800 shadow-sm backdrop-blur transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white @2xl:h-9 @2xl:w-9";
/** Prev/next are desktop-only — a phone swipes or taps a dot. */
const arrowButton = cn(controlButton, "hidden @2xl:inline-flex");

// ── Carousel ─────────────────────────────────────────────────────────────────

/**
 * The homepage hero banner when ≥1 slide is live: full content width, rounded,
 * aspect reserved per breakpoint (zero CLS), transform-only entrance (never
 * `opacity: 0`, which would hold back the LCP paint).
 *
 * Accessibility (WAI carousel pattern): a labelled region, each slide a
 * "slide" group ("2 of 4"), off-screen slides `inert`, prev/next + dots +
 * ←/→ keys, and a visible pause/play button (WCAG 2.2.2). Live-region
 * politeness follows autoplay: "off" while rotating.
 *
 * Autoplay is ON by default, every HERO_AUTOPLAY_MS, as a crossfade (the Embla
 * fade plugin). Under prefers-reduced-motion it keeps rotating but each change
 * is instant (`jump`), with no fade. It waits while keyboard focus is inside,
 * the tab is hidden or the seasonal intro plays. A swipe, arrow or dot holds
 * it only until HERO_RESUME_AFTER_MS without input. Only the Pause button
 * stops it until Play. Hover never pauses: on touch screens `mouseenter` fires
 * on a tap and `mouseleave` never does, which used to stop rotation for good.
 *
 * Image requests: slide 0 is eager/high priority (the LCP element) and its
 * neighbours are requested on hydration, then each newly selected slide
 * requests its own.
 * Autoplay only advances to a slide whose image has settled, so a transition
 * never lands on a blank frame.
 */
export default function HeroCarousel({
  slides,
  direction = "ltr",
}: {
  slides: HeroSlideView[];
  /** Text direction — the Arabic locale will pass "rtl". */
  direction?: "ltr" | "rtl";
}) {
  const count = slides.length;
  const isCarousel = count > 1;

  // Stable plugin list: a new array each render would re-init Embla. (An
  // inactive Embla — one slide — never initialises its plugins.)
  const [plugins] = useState(() => [Fade()]);
  const [emblaRef, emblaApi] = useEmblaCarousel(
    { loop: isCarousel, direction, active: isCarousel },
    plugins,
  );

  const [selected, setSelected] = useState(0);
  const [requested, setRequested] = useState<ReadonlySet<number>>(() => new Set([0]));
  const [loaded, setLoaded] = useState<ReadonlySet<number>>(() => new Set());
  // Slide 0's neighbours are requested as soon as the carousel hydrates, never
  // "after slide 0's onLoad" (which a cached image never delivers). Not in the
  // server HTML: eager neighbours there would compete with the LCP image.
  const hydrated = useSyncExternalStore(noSubscribe, onClient, onServer);
  const isRequested = (i: number) =>
    requested.has(i) || (hydrated && neighboursOf(0, count).includes(i));

  // Autoplay inputs.
  const reducedMotion = useReducedMotion() ?? false;
  const [paused, setPaused] = useState(false); // the Pause button — until Play
  const [holdToken, setHoldToken] = useState(0); // 0 = no manual hold
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const tabHidden = useSyncExternalStore(subscribeVisibility, isTabHidden, serverTabHidden);
  const introPlaying = useSeasonalIntro((s) => s.season !== null);

  const held = holdToken !== 0;
  const rotating =
    isCarousel && !paused && !held && !keyboardFocus && !tabHidden && !introPlaying;

  /** A manual navigation: hold autoplay, restarting the idle countdown. */
  const holdForIdle = useCallback(() => setHoldToken((n) => n + 1), []);

  // Release the hold once the visitor has been idle long enough.
  useEffect(() => {
    if (!holdToken) return;
    const timer = window.setTimeout(() => setHoldToken(0), HERO_RESUME_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [holdToken]);

  const markSettled = useCallback(
    (i: number) => setLoaded((prev) => withIndexes(prev, [i])),
    [],
  );

  // Track the selected slide; a drag/swipe is a manual navigation.
  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => {
      const i = emblaApi.selectedScrollSnap();
      setSelected(i);
      setRequested((prev) => withIndexes(prev, neighboursOf(i, count)));
    };
    emblaApi.on("select", onSelect).on("pointerDown", holdForIdle);
    return () => {
      emblaApi.off("select", onSelect).off("pointerDown", holdForIdle);
    };
  }, [emblaApi, count, holdForIdle]);

  // One timeout per shown slide, armed only once the NEXT image has settled.
  const nextReady = loaded.has((selected + 1) % count);
  useEffect(() => {
    if (!emblaApi || !rotating || !nextReady) return;
    const timer = window.setTimeout(() => emblaApi.scrollNext(reducedMotion), HERO_AUTOPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [emblaApi, rotating, nextReady, selected, reducedMotion]);

  const goPrev = () => {
    holdForIdle();
    emblaApi?.scrollPrev(reducedMotion);
  };
  const goNext = () => {
    holdForIdle();
    emblaApi?.scrollNext(reducedMotion);
  };
  const goTo = (i: number) => {
    holdForIdle();
    emblaApi?.scrollTo(i, reducedMotion);
  };

  function onKeyDown(e: React.KeyboardEvent) {
    if (!isCarousel) return;
    // Arrow keys follow the reading direction.
    const back = direction === "rtl" ? "ArrowRight" : "ArrowLeft";
    const forward = direction === "rtl" ? "ArrowLeft" : "ArrowRight";
    if (e.key === back) {
      e.preventDefault();
      goPrev();
    } else if (e.key === forward) {
      e.preventDefault();
      goNext();
    }
  }

  return (
    <motion.section
      aria-roledescription={isCarousel ? "carousel" : undefined}
      aria-label={HERO_COPY.regionLabel}
      className="@container relative"
      initial={{ y: 32, scale: 0.985 }}
      animate={{ y: 0, scale: 1 }}
      transition={{ duration: 1, ease: EASE, delay: 0.1 }}
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        if (isKeyboardFocus(e.target)) setKeyboardFocus(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setKeyboardFocus(false);
      }}
    >
      <div ref={emblaRef} className="overflow-hidden rounded-2xl @2xl:rounded-[2.5rem]">
        <div
          className="flex touch-pan-y"
          aria-live={isCarousel ? (rotating ? "off" : "polite") : undefined}
        >
          {slides.map((slide, i) => (
            <div
              key={slide.id}
              role={isCarousel ? "group" : undefined}
              aria-roledescription={isCarousel ? "slide" : undefined}
              aria-label={isCarousel ? HERO_COPY.slideLabel(i + 1, count) : undefined}
              inert={i !== selected}
              className="min-w-0 shrink-0 grow-0 basis-full"
            >
              <HeroSlideFrame
                slide={slide}
                className={HERO_FRAME_ASPECT}
                media={
                  <SlideMedia
                    slide={slide}
                    index={i}
                    requested={isRequested(i)}
                    onSettled={markSettled}
                  />
                }
              />
            </div>
          ))}
        </div>
      </div>

      {isCarousel && (
        <>
          {/* Dots — centered on desktop; on a phone they sit at the bottom
              end, beside Pause, so the start corner stays the CTA's. */}
          <div className="pointer-events-none absolute end-12 bottom-[1.375rem] z-10 flex gap-1.5 @2xl:inset-x-0 @2xl:bottom-5 @2xl:justify-center @2xl:gap-2">
            {slides.map((slide, i) => (
              <button
                key={slide.id}
                type="button"
                onClick={() => goTo(i)}
                aria-label={HERO_COPY.goToSlide(i + 1)}
                aria-current={i === selected ? "true" : undefined}
                className={cn(
                  // A faint dark ring keeps white dots readable on a bright photo.
                  "pointer-events-auto h-1.5 rounded-full ring-1 ring-black/15 transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white @2xl:h-2",
                  i === selected ? "w-4 bg-white @2xl:w-6" : "w-1.5 bg-white/70 hover:bg-white/90 @2xl:w-2",
                )}
              />
            ))}
          </div>

          {/* Prev · pause/play · next — the bottom end corner (Pause only on a phone). */}
          <div className="pointer-events-none absolute bottom-3 end-3 z-10 flex gap-1.5 @2xl:bottom-4 @2xl:end-5">
            <button type="button" onClick={goPrev} aria-label={HERO_COPY.previous} className={arrowButton}>
              <ChevronLeft className="h-4 w-4 rtl:-scale-x-100" />
            </button>
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              aria-label={paused ? HERO_COPY.play : HERO_COPY.pause}
              className={controlButton}
            >
              {paused ? <Play className="h-3.5 w-3.5 @2xl:h-4 @2xl:w-4" /> : <Pause className="h-3.5 w-3.5 @2xl:h-4 @2xl:w-4" />}
            </button>
            <button type="button" onClick={goNext} aria-label={HERO_COPY.next} className={arrowButton}>
              <ChevronRight className="h-4 w-4 rtl:-scale-x-100" />
            </button>
          </div>
        </>
      )}
    </motion.section>
  );
}
