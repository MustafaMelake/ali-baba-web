"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

// Cinematic cubic-bezier — fast start, silky deceleration
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export default function Hero() {
  return (
    <div className="w-full bg-white">
      {/* ─── Upper Typography Block ──────────────────────────── */}
      <div className="max-w-5xl mx-auto px-6 text-center pt-32 md:pt-44 pb-10 md:pb-14">
        {/* Eyebrow kicker */}
        <motion.p
          className="text-[11px] font-sans font-semibold uppercase tracking-[0.35em] text-stone-400 mb-8 md:mb-10"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeOut", delay: 0.1 }}
        >
          Ali Baba · Since 1998 · Hand-crafted
        </motion.p>

        {/*
          Each headline line sits inside overflow-hidden so the slide-up
          produces the classic "text emerges from below the line" reveal.
        */}
        <h1 className="font-serif font-medium tracking-tight leading-[1.05] text-[clamp(2.8rem,7.5vw,7.5rem)] text-stone-900">
          {["Mastering the art", "of oriental"].map((line, i) => (
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
              pastry.
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
          We blend time-honored recipes with premium ingredients to create
          moments of pure indulgence.
        </motion.p>
      </div>

      {/* ─── Cinematic Hero Image ────────────────────────────── */}
      <div className="px-4 sm:px-6 md:px-10 lg:px-14">
        <motion.div
          className="relative overflow-hidden rounded-[1.75rem] md:rounded-[2.5rem]"
          initial={{ opacity: 0, y: 48 }}
          animate={{ opacity: 1, y: 0 }}
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
              alt="Ali Baba artisan pastry — hand-crafted confections since 1998"
              fill
              priority
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
        className="flex flex-col sm:flex-row items-center justify-center gap-4 md:gap-5 px-6 pt-12 pb-16 md:pt-14 md:pb-20"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut", delay: 1.25 }}
      >
        {/* Primary — deep charcoal, not turquoise */}
        <Link
          href="/shop"
          className="group flex items-center gap-3 bg-stone-900 text-white px-8 py-4 rounded-full text-sm font-sans font-semibold uppercase tracking-widest hover:bg-stone-700 transition-colors duration-200"
        >
          Shop Now
          <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" />
        </Link>

        {/* Secondary — turquoise as refined border + text accent */}
        <Link
          href="/menu"
          className="flex items-center px-8 py-4 rounded-full text-sm font-sans font-semibold uppercase tracking-widest text-primary border border-primary/40 hover:border-primary hover:bg-primary/5 transition-all duration-200"
        >
          Explore Menu
        </Link>
      </motion.div>
    </div>
  );
}
