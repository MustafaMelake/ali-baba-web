"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";

export interface PromoWidgetBannerProps {
  /** Promotion display name, e.g. "Summer Flash Sale". */
  headline: string;
  /**
   * Rounded percent off (e.g. 20) for a PERCENTAGE promotion — already a
   * plain number, never a Decimal. `null` means a fixed-amount promotion,
   * rendered with a generic "Flash Sale" treatment instead of a figure.
   */
  percentOff: number | null;
  /** CTA target — a single-category deep link or /shop. */
  href: string;
  /** Pre-formatted Cairo-local end date ("18 July"), or null to omit urgency. */
  endsOn: string | null;
}

/**
 * Display-only client leaf under the server-side <PromoWidget />. It exists
 * purely for the framer-motion entrance + pulse — all data is fetched, priced
 * and serialized by its Server Component parent. The banner is advisory
 * marketing, not the pricing contract: actual prices are still resolved
 * per-variant by `resolvePrice` everywhere money is shown or billed.
 */
export default function PromoWidgetBanner({
  headline,
  percentOff,
  href,
  endsOn,
}: PromoWidgetBannerProps) {
  return (
    <section
      aria-label="Current promotion"
      className="px-4 sm:px-6 md:px-10 lg:px-14 pb-12 md:pb-16"
    >
      <motion.div
        className="relative overflow-hidden rounded-[1.75rem] md:rounded-[2.5rem] border border-primary/15 bg-gradient-to-r from-primary/[0.07] via-white to-primary/[0.04]"
        initial={{ opacity: 0, y: 36 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ type: "spring", stiffness: 90, damping: 18 }}
      >
        {/* Soft turquoise glow — decorative only */}
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl"
          aria-hidden="true"
        />

        <div className="relative flex flex-col items-center gap-8 px-8 py-10 text-center md:flex-row md:items-center md:justify-between md:px-14 md:py-12 md:text-left">
          {/* ─── Copy block ─────────────────────────────────── */}
          <div className="max-w-xl">
            <p className="mb-4 flex items-center justify-center gap-2 font-sans text-[11px] font-semibold uppercase tracking-[0.35em] text-primary md:justify-start">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Limited-time offer
            </p>

            <h2 className="font-serif font-medium leading-tight tracking-tight text-stone-900 text-[clamp(1.75rem,3.5vw,2.75rem)]">
              {headline}
            </h2>

            {endsOn && (
              <p className="mt-4 font-sans text-xs font-medium uppercase tracking-[0.2em] text-stone-400">
                Ends {endsOn}
              </p>
            )}
          </div>

          {/* ─── Discount figure + CTA ──────────────────────── */}
          <div className="flex flex-col items-center gap-6 md:items-end">
            {/* Gentle infinite pulse — same idiom as the CategorySlider badge */}
            <motion.p
              className="font-serif font-medium leading-none text-primary"
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            >
              {percentOff !== null ? (
                <>
                  <span className="text-[clamp(3rem,6vw,4.5rem)] tabular-nums">
                    &minus;{percentOff}%
                  </span>{" "}
                  <span className="font-sans text-sm font-semibold uppercase tracking-[0.25em]">
                    off
                  </span>
                </>
              ) : (
                <span className="text-[clamp(2rem,4vw,3rem)]">Flash Sale</span>
              )}
            </motion.p>

            <Link
              href={href}
              className="group inline-flex items-center gap-3 rounded-full bg-stone-900 px-8 py-4 font-sans text-xs font-semibold uppercase tracking-[0.18em] text-white transition-colors duration-200 hover:bg-primary"
            >
              Shop the offer
              <ArrowRight
                className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1"
                aria-hidden="true"
              />
            </Link>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
