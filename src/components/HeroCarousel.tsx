"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import useEmblaCarousel from "embla-carousel-react";
import Image, { getImageProps } from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { HERO_AUTOPLAY_MS, HERO_COPY, type HeroSlideView } from "@/lib/hero-slides";
import { useSeasonalIntro } from "@/lib/seasonal-intro-store";
import { cn, formatEGP } from "@/lib/utils";

// Cinematic cubic-bezier — matches the Hero's entrance curve.
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** The frame spans the content width (the same gutters as the classic hero image). */
const SIZES = "(max-width: 640px) 92vw, (max-width: 1024px) 94vw, 96vw";

/**
 * The frame's layout switches on its OWN width (container queries, `@2xl` =
 * 672px), not the viewport's, so the admin preview can render the phone layout
 * inside a desktop window. The phone crop's media query must agree: the frame
 * reaches 672px at a 720px viewport (720 − 2 × 24px `sm:` gutters).
 */
const MOBILE_MEDIA = "(max-width: 719px)";

// ── Tab visibility (autoplay pauses in a background tab) ─────────────────────

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}
const isTabHidden = () => document.visibilityState === "hidden";
const serverTabHidden = () => false;

/** Add `indexes` to a set, returning the SAME set when nothing is new (no re-render). */
function withIndexes(set: ReadonlySet<number>, indexes: number[]): ReadonlySet<number> {
  if (indexes.every((i) => set.has(i))) return set;
  return new Set([...set, ...indexes]);
}

// ── Media ────────────────────────────────────────────────────────────────────

/**
 * One slide's image. Slide 0 is the LCP element: preloaded when there's a
 * single crop; with an art-directed phone crop the LCP image differs per
 * viewport, so it's fetched eagerly at high priority instead (Next's docs: no
 * `preload` when the LCP candidate depends on the viewport). Every other slide
 * stays lazy until the carousel `requested` it — see HeroCarousel.
 */
function SlideMedia({
  slide,
  isFirst,
  requested,
  onLoaded,
}: {
  slide: HeroSlideView;
  isFirst: boolean;
  requested: boolean;
  onLoaded: () => void;
}) {
  const loading: "eager" | "lazy" = isFirst || requested ? "eager" : "lazy";

  if (!slide.imageMobile) {
    return (
      <Image
        src={slide.imageDesktop}
        alt={slide.imageAlt}
        fill
        sizes={SIZES}
        className="object-cover"
        {...(isFirst ? { preload: true } : { loading })}
        onLoad={onLoaded}
      />
    );
  }

  const common = {
    alt: slide.imageAlt,
    fill: true,
    sizes: SIZES,
    loading,
    fetchPriority: isFirst ? ("high" as const) : undefined,
  };
  const { props: mobile } = getImageProps({ ...common, src: slide.imageMobile });
  const { props: desktop } = getImageProps({ ...common, src: slide.imageDesktop });

  return (
    <picture>
      <source media={MOBILE_MEDIA} srcSet={mobile.srcSet} sizes={mobile.sizes} />
      {/* Art direction: getImageProps feeds a plain <img> inside the <picture>. */}
      <img
        {...desktop}
        alt={slide.imageAlt}
        className="object-cover"
        onLoad={onLoaded}
        // A cached image can finish before hydration attaches onLoad.
        ref={(img) => {
          if (img?.complete && img.naturalWidth > 0) onLoaded();
        }}
      />
    </picture>
  );
}

// ── Slide ────────────────────────────────────────────────────────────────────

/**
 * The overlay: eyebrow, headline, subtitle, price pill, CTA — each rendered
 * only when present (a designed image may carry its own text). ONE link per
 * slide: the CTA, stretched over the whole frame so the banner is clickable
 * without a second, duplicate link. Logical properties only (start/end, ps/pe,
 * text-start) — RTL later is a `dir` flip, not a rewrite.
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
    "group mt-6 inline-flex items-center gap-3 rounded-full bg-white px-6 py-3 text-xs font-semibold uppercase tracking-widest text-stone-900 shadow-sm transition-colors duration-200 hover:bg-stone-100 @2xl:mt-8 @2xl:px-7 @2xl:py-3.5 @2xl:text-sm",
    "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white",
  );
  const ctaContent = (
    <>
      {slide.ctaLabel}
      <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1 rtl:-scale-x-100 rtl:group-hover:-translate-x-1" />
    </>
  );

  return (
    <>
      {hasCopy && (
        // Subtle scrim on the start side (bottom on phones) for legibility.
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent @2xl:bg-gradient-to-r @2xl:from-black/55 @2xl:via-black/15 rtl:@2xl:bg-gradient-to-l" />
      )}

      <div className="absolute inset-0 flex flex-col items-start justify-end ps-6 pe-6 pb-20 text-start @2xl:max-w-[58%] @2xl:justify-center @2xl:ps-14 @2xl:pe-0 @2xl:pb-0 @5xl:ps-20">
        {slide.eyebrow && (
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-white/80 @2xl:mb-4">
            {slide.eyebrow}
          </p>
        )}
        {slide.title && (
          <h2 className="font-serif text-[clamp(1.75rem,5.2cqw,4.5rem)] font-medium leading-[1.05] tracking-tight text-white">
            {slide.title}
          </h2>
        )}
        {slide.subtitle && (
          <p className="mt-3 max-w-md text-sm leading-relaxed text-white/85 @2xl:mt-5 @2xl:text-base">
            {slide.subtitle}
          </p>
        )}

        {slide.price && (
          <p className="mt-5 inline-flex items-baseline gap-2 rounded-full bg-white/95 px-4 py-1.5 text-sm text-stone-900 shadow-sm @2xl:mt-6">
            {slide.price.isFrom && <span className="text-stone-500">{HERO_COPY.priceFrom}</span>}
            <span className="font-semibold tabular-nums">{formatEGP(slide.price.amount)}</span>
            {slide.price.compareAt !== null && slide.price.compareAt > slide.price.amount && (
              <s className="text-xs text-stone-400 tabular-nums">
                {formatEGP(slide.price.compareAt)}
              </s>
            )}
          </p>
        )}
        {!slide.price && pricePlaceholder && (
          <p className="mt-5 inline-flex items-baseline gap-2 rounded-full bg-white/95 px-4 py-1.5 text-sm text-stone-500 shadow-sm @2xl:mt-6">
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

/** 4:5 on phones, ≈2.35:1 (47:20) once the carousel container reaches `@2xl`. */
const FRAME_ASPECT = "aspect-[4/5] @2xl:aspect-[47/20]";

const controlButton =
  "pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/85 text-stone-800 shadow-sm backdrop-blur transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

// ── Carousel ─────────────────────────────────────────────────────────────────

/**
 * The homepage hero banner when ≥1 slide is live: full content width, rounded,
 * aspect reserved per breakpoint (zero CLS), transform-only entrance (never
 * `opacity: 0`, which would hold back the LCP paint).
 *
 * Accessibility (WAI carousel pattern): a labelled region, each slide a
 * "slide" group ("2 of 4"), off-screen slides `inert`, prev/next + dots +
 * ←/→ keys, and a visible pause/play button (WCAG 2.2.2). Autoplay is OFF
 * under prefers-reduced-motion, pauses on hover, focus, a background tab and
 * while the seasonal intro plays, and stops for good once the visitor
 * navigates. Live-region politeness follows it: "off" while rotating.
 *
 * Image requests: slide 0 is eager/high priority; the next slide is requested
 * once slide 0 has painted, and each newly selected slide requests its
 * neighbours. Autoplay only advances to a slide whose image has LOADED, so a
 * transition never lands on a blank frame.
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

  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: isCarousel,
    direction,
    active: isCarousel,
  });

  const [selected, setSelected] = useState(0);
  const [requested, setRequested] = useState<ReadonlySet<number>>(() => new Set([0]));
  const [loaded, setLoaded] = useState<ReadonlySet<number>>(() => new Set());

  // Autoplay inputs. `choice` is the visitor's explicit pause/play (null until
  // they touch anything — then the default is "on unless reduced motion").
  const reducedMotion = useReducedMotion();
  const [choice, setChoice] = useState<boolean | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const tabHidden = useSyncExternalStore(subscribeVisibility, isTabHidden, serverTabHidden);
  const introPlaying = useSeasonalIntro((s) => s.season !== null);

  const autoplayOn = isCarousel && (choice ?? !reducedMotion);
  const rotating = autoplayOn && !hovered && !focused && !tabHidden && !introPlaying;

  const neighbours = useCallback(
    (i: number) => [i, (i + 1) % count, (i - 1 + count) % count],
    [count],
  );

  const markLoaded = useCallback(
    (i: number) => {
      setLoaded((prev) => withIndexes(prev, [i]));
      // Slide 0 has painted → request the next one (and the loop's previous).
      if (i === 0) setRequested((prev) => withIndexes(prev, neighbours(0)));
    },
    [neighbours],
  );

  // Track the selected slide; any drag/swipe is a manual navigation.
  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => {
      const i = emblaApi.selectedScrollSnap();
      setSelected(i);
      setRequested((prev) => withIndexes(prev, neighbours(i)));
    };
    const onPointerDown = () => setChoice(false);
    emblaApi.on("select", onSelect).on("pointerDown", onPointerDown);
    return () => {
      emblaApi.off("select", onSelect).off("pointerDown", onPointerDown);
    };
  }, [emblaApi, neighbours]);

  // One timeout per shown slide, armed only once the NEXT image has loaded.
  const nextReady = loaded.has((selected + 1) % count);
  useEffect(() => {
    if (!emblaApi || !rotating || !nextReady) return;
    const timer = window.setTimeout(() => emblaApi.scrollNext(), HERO_AUTOPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [emblaApi, rotating, nextReady, selected]);

  const goPrev = () => {
    setChoice(false);
    emblaApi?.scrollPrev();
  };
  const goNext = () => {
    setChoice(false);
    emblaApi?.scrollNext();
  };
  const goTo = (i: number) => {
    setChoice(false);
    emblaApi?.scrollTo(i);
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
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <div ref={emblaRef} className="overflow-hidden rounded-[1.75rem] md:rounded-[2.5rem]">
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
                className={FRAME_ASPECT}
                media={
                  <SlideMedia
                    slide={slide}
                    isFirst={i === 0}
                    requested={requested.has(i)}
                    onLoaded={() => markLoaded(i)}
                  />
                }
              />
            </div>
          ))}
        </div>
      </div>

      {isCarousel && (
        <>
          {/* Dots — centered at the bottom. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-5 z-10 flex justify-center gap-2">
            {slides.map((slide, i) => (
              <button
                key={slide.id}
                type="button"
                onClick={() => goTo(i)}
                aria-label={HERO_COPY.goToSlide(i + 1)}
                aria-current={i === selected ? "true" : undefined}
                className={cn(
                  "pointer-events-auto h-2 rounded-full transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
                  i === selected ? "w-6 bg-white" : "w-2 bg-white/55 hover:bg-white/80",
                )}
              />
            ))}
          </div>

          {/* Prev · pause/play · next — the bottom end corner. */}
          <div className="pointer-events-none absolute bottom-3 end-3 z-10 flex gap-1.5 md:bottom-4 md:end-5">
            <button type="button" onClick={goPrev} aria-label={HERO_COPY.previous} className={controlButton}>
              <ChevronLeft className="h-4 w-4 rtl:-scale-x-100" />
            </button>
            <button
              type="button"
              onClick={() => setChoice(!autoplayOn)}
              aria-label={autoplayOn ? HERO_COPY.pause : HERO_COPY.play}
              className={controlButton}
            >
              {autoplayOn ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <button type="button" onClick={goNext} aria-label={HERO_COPY.next} className={controlButton}>
              <ChevronRight className="h-4 w-4 rtl:-scale-x-100" />
            </button>
          </div>
        </>
      )}
    </motion.section>
  );
}
