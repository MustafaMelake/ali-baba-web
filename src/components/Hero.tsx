"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import HeroCarousel from "@/components/HeroCarousel";
import type { HeroSlideView } from "@/lib/hero-slides";
import { cn } from "@/lib/utils";

// Cinematic cubic-bezier — fast start, silky deceleration
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * The brand copy, shared by the classic hero and the intro band under the
 * carousel — one table, so the two can never drift (and the Arabic locale
 * swaps a table, not markup). The headline is the page's one <h1> in both.
 */
const BRAND_COPY = {
  eyebrow: "Ali Baba · Since 1998 · Hand-crafted",
  /** Lines of the headline before the accented last word. */
  headlineLines: ["Mastering the art", "of oriental"],
  headlineAccent: "pastry.",
  subtitle:
    "We blend time-honored recipes with premium ingredients to create moments of pure indulgence.",
  shop: { label: "Shop Now", href: "/shop" },
  menu: { label: "Explore Menu", href: "/menu" },
  imageAlt: "Ali Baba artisan pastry — hand-crafted confections since 1998",
} as const;

/**
 * Shop Now (charcoal, primary) + Explore Menu (turquoise outline). `compact`
 * is the band's smaller size on phones; both sizes match from `md` up.
 */
function BrandButtons({ compact = false, className }: { compact?: boolean; className?: string }) {
  const size = compact ? "px-6 py-3 text-xs md:px-8 md:py-4 md:text-sm" : "px-8 py-4 text-sm";
  return (
    <div className={className}>
      <Link
        href={BRAND_COPY.shop.href}
        className={cn(
          "group flex items-center gap-3 rounded-full bg-stone-900 font-sans font-semibold uppercase tracking-widest text-white transition-colors duration-200 hover:bg-stone-700",
          size,
        )}
      >
        {BRAND_COPY.shop.label}
        <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1 rtl:-scale-x-100 rtl:group-hover:-translate-x-1" />
      </Link>
      <Link
        href={BRAND_COPY.menu.href}
        className={cn(
          "flex items-center rounded-full border border-primary/40 font-sans font-semibold uppercase tracking-widest text-primary transition-all duration-200 hover:border-primary hover:bg-primary/5",
          size,
        )}
      >
        {BRAND_COPY.menu.label}
      </Link>
    </div>
  );
}

/**
 * The compact brand intro under the carousel — what the classic hero says,
 * at a fraction of its height (~¼–⅓ of a desktop viewport): eyebrow, the
 * headline as the page's visible <h1> (one step below the classic size),
 * the supporting line and both buttons, with the promotion seal beside it on
 * desktop and below it on phones. Rendered on the server with no entrance
 * animation, so nothing in it arrives late or shifts the layout. Logical
 * properties only (RTL-ready).
 */
function BrandIntro({ promo }: { promo?: React.ReactNode }) {
  return (
    <section
      aria-labelledby="brand-intro-heading"
      className="mx-auto flex max-w-6xl flex-col gap-4 pt-6 md:flex-row md:items-center md:justify-between md:gap-10 md:pt-12"
    >
      <div className="min-w-0 flex-1 text-start">
        <p className="mb-2 font-sans text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400 md:mb-4 md:text-[11px] md:tracking-[0.35em]">
          {BRAND_COPY.eyebrow}
        </p>
        <h1
          id="brand-intro-heading"
          className="font-serif text-[clamp(2rem,4.2vw,4rem)] font-medium leading-[1.08] tracking-tight text-stone-900"
        >
          {BRAND_COPY.headlineLines.join(" ")}{" "}
          <em className="not-italic text-primary">{BRAND_COPY.headlineAccent}</em>
        </h1>
        <p className="mt-2 max-w-2xl font-sans text-sm leading-relaxed text-stone-500 md:mt-4 md:text-base">
          {BRAND_COPY.subtitle}
        </p>
        <BrandButtons compact className="mt-4 flex flex-wrap items-center gap-3 md:mt-7 md:gap-4" />
      </div>
      {/* The seal slot may render nothing (no live promotion) — `empty:hidden`
          then drops the wrapper, so it adds no gap on phones. */}
      {promo && <div className="shrink-0 self-start empty:hidden md:self-center">{promo}</div>}
    </section>
  );
}

interface HeroProps {
  /**
   * Optional server-rendered promotion seal (the page passes <PromoWidget />),
   * so this client island stays presentational and never fetches. The slot
   * may render nothing when no promotion is live.
   */
  promo?: React.ReactNode;
  /**
   * Live admin-managed slides (already filtered + priced on the server). When
   * there is at least one, the banner carousel leads and the brand intro band
   * follows it; with none, the classic hero below renders exactly as before.
   */
  slides?: HeroSlideView[];
}

export default function Hero({ promo, slides = [] }: HeroProps) {
  if (slides.length > 0) {
    return (
      // Banner variant: the carousel, then the brand intro, whose headline is
      // the page's visible <h1> — slide titles are <h2>. The seal sits in the
      // band, never over the carousel.
      <div className="w-full bg-white px-4 pt-4 pb-10 sm:px-6 md:px-10 md:pt-6 md:pb-14 lg:px-14">
        <HeroCarousel slides={slides} />
        <BrandIntro promo={promo} />
      </div>
    );
  }

  return (
    <div className="w-full bg-white">
      {/* ─── Upper Typography Block ──────────────────────────── */}
      <div className="relative max-w-5xl mx-auto px-6 text-center pt-32 md:pt-44 pb-10 md:pb-14">
        {/*
          Promo seal — pinned top-left inside the top padding band, so it sits
          above the eyebrow's left flank without shifting the headline (no
          layout cost when the slot renders nothing). The fixed navbar is
          already cleared by the (shop) layout's <main> padding.
        */}
        {promo && (
          <div className="absolute left-6 top-8 md:top-14 lg:top-12 z-10">
            {promo}
          </div>
        )}

        {/* Eyebrow kicker */}
        <motion.p
          className="text-[11px] font-sans font-semibold uppercase tracking-[0.35em] text-stone-400 mb-8 md:mb-10"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeOut", delay: 0.1 }}
        >
          {BRAND_COPY.eyebrow}
        </motion.p>

        {/*
          Each headline line sits inside overflow-hidden so the slide-up
          produces the classic "text emerges from below the line" reveal.
        */}
        <h1 className="font-serif font-medium tracking-tight leading-[1.05] text-[clamp(2.8rem,7.5vw,7.5rem)] text-stone-900">
          {BRAND_COPY.headlineLines.map((line, i) => (
            <span key={line} className="block overflow-hidden">
              <motion.span
                className="block"
                initial={{ y: "110%" }}
                animate={{ y: "0%" }}
                transition={{ duration: 1, ease: EASE, delay: 0.2 + i * 0.14 }}
              >
                {line}
              </motion.span>
            </span>
          ))}

          {/* "pastry." — italic, turquoise accent, same slide-up treatment */}
          <span className="block overflow-hidden">
            <motion.em
              className="not-italic text-primary"
              initial={{ y: "110%" }}
              animate={{ y: "0%" }}
              transition={{ duration: 1, ease: EASE, delay: 0.48 }}
            >
              {BRAND_COPY.headlineAccent}
            </motion.em>
          </span>
        </h1>

        {/* Turquoise hairline divider — expands from center */}
        <motion.div
          className="w-12 h-px bg-primary mx-auto mt-8 md:mt-10"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.7, ease: "easeOut", delay: 0.75 }}
          style={{ transformOrigin: "center" }}
        />

        {/* Subtitle */}
        <motion.p
          className="mt-6 text-base md:text-lg text-stone-500 max-w-xl mx-auto font-sans leading-relaxed"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.85 }}
        >
          {BRAND_COPY.subtitle}
        </motion.p>
      </div>

      {/* ─── Cinematic Hero Image ────────────────────────────── */}
      <div className="px-4 sm:px-6 md:px-10 lg:px-14">
        {/* Transform-only entrance: the image is the LCP element, and an
            `opacity: 0` start would hold its paint back until the fade ran
            (~0.9s delay + 1.2s). It now paints on arrival and only slides. */}
        <motion.div
          className="relative overflow-hidden rounded-[1.75rem] md:rounded-[2.5rem]"
          initial={{ y: 48 }}
          animate={{ y: 0 }}
          transition={{ duration: 1.2, ease: EASE, delay: 0.9 }}
        >
          {/* Inner scale — creates a "curtain lifts to reveal" effect */}
          <motion.div
            className="relative w-full h-[65vw] min-h-[320px] max-h-[780px]"
            initial={{ scale: 1.07 }}
            animate={{ scale: 1 }}
            transition={{ duration: 1.8, ease: EASE, delay: 0.9 }}
          >
            <Image
              src="/hero.jpeg"
              alt={BRAND_COPY.imageAlt}
              fill
              preload
              className="object-cover object-center"
              sizes="(max-width: 640px) 92vw, (max-width: 1024px) 94vw, 96vw"
            />

            {/* Whisper-thin gradient so the image fades cleanly into the CTA area */}
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-white/30 pointer-events-none" />
          </motion.div>
        </motion.div>
      </div>

      {/* ─── CTA Row ─────────────────────────────────────────── */}
      <motion.div
        className="px-6 pt-12 pb-16 md:pt-14 md:pb-20"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut", delay: 1.25 }}
      >
        {/* Primary — deep charcoal, not turquoise; secondary — turquoise outline */}
        <BrandButtons className="flex flex-col sm:flex-row items-center justify-center gap-4 md:gap-5" />
      </motion.div>
    </div>
  );
}
