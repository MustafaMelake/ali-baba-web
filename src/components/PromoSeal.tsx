"use client";

import Link from "next/link";
import { motion } from "framer-motion";

export interface PromoSealProps {
  /** Promotion display name, e.g. "Summer Flash Sale" — surfaced as the accessible label. */
  headline: string;
  /**
   * Rounded percent off (e.g. 20) for a PERCENTAGE promotion — already a
   * plain number, never a Decimal. `null` means a fixed-amount promotion,
   * rendered with a generic "Flash Sale" treatment instead of a figure.
   */
  percentOff: number | null;
  /** Link target — a single-category deep link or /collections. */
  href: string;
  /** Pre-formatted Cairo-local end date ("18 July"), or null to omit urgency. */
  endsOn: string | null;
}

/**
 * Display-only client leaf under the server-side <PromoWidget />: a circular
 * crimson seal the Hero pins to the top-left of its typography block. It
 * exists purely for the framer-motion entrance — all data is fetched, priced
 * and serialized by its Server Component parent. The seal is advisory
 * marketing, not the pricing contract: actual prices are still resolved
 * per-variant by `resolvePrice` everywhere money is shown or billed.
 *
 * The entrance spring lives on the wrapper and the resting tilt + hover scale
 * on the inner <Link>, so framer-motion's inline `transform` never fights the
 * Tailwind `rotate`/`scale` utilities.
 */
export default function PromoSeal({
  headline,
  percentOff,
  href,
  endsOn,
}: PromoSealProps) {
  // The visible face is just the figure, so the full offer (name, size,
  // urgency) rides on the accessible label and the hover tooltip.
  const offer = [
    headline,
    percentOff !== null ? `${percentOff}% off` : "Flash sale",
    endsOn && `ends ${endsOn}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.4, rotate: -45 }}
      animate={{ opacity: 1, scale: 1, rotate: 0 }}
      transition={{ type: "spring", stiffness: 170, damping: 14, delay: 0.95 }}
    >
      <Link
        href={href}
        aria-label={`${offer} — shop the offer`}
        title={offer}
        className="relative flex h-[4.5rem] w-[4.5rem] -rotate-12 flex-col items-center justify-center rounded-full bg-gradient-to-br from-red-600 via-red-700 to-red-800 text-white shadow-[0_14px_30px_-12px_rgba(153,27,27,0.7)] ring-1 ring-red-900/20 transition-transform duration-300 ease-out hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-red-700 md:h-24 md:w-24 lg:h-28 lg:w-28"
      >
        {/* Dashed inner ring — the "stamped seal" detail; decorative only */}
        <span
          className="pointer-events-none absolute inset-1 rounded-full border border-dashed border-white/45 md:inset-1.5"
          aria-hidden="true"
        />

        {percentOff !== null ? (
          <>
            <span className="font-serif text-xl font-bold leading-none tracking-tight tabular-nums md:text-3xl lg:text-4xl">
              &minus;{percentOff}%
            </span>
            {/* pl balances the trailing letter-spacing so "OFF" sits truly centered */}
            <span className="mt-1 pl-[0.3em] font-sans text-[8px] font-bold uppercase tracking-[0.3em] md:text-[10px]">
              Off
            </span>
          </>
        ) : (
          <>
            <span className="pl-[0.3em] font-sans text-[8px] font-bold uppercase tracking-[0.3em] md:text-[10px]">
              Flash
            </span>
            <span className="mt-0.5 font-serif text-xl font-bold leading-none md:text-2xl lg:text-3xl">
              Sale
            </span>
          </>
        )}
      </Link>
    </motion.div>
  );
}
