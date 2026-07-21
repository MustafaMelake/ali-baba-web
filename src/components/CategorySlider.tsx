"use client";

import useEmblaCarousel from "embla-carousel-react";
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight, Sparkles } from "lucide-react";

export interface CategorySliderProps {
  categories: {
    id: string;
    title: string;
    subtitle: string;
    href: string;
    image: string;
    alt: string;
    /** Optional promotion badge text, e.g. "20% OFF" or "SALE". */
    discountLabel?: string;
  }[];
}

export default function CategorySlider({ categories }: CategorySliderProps) {
  const [emblaRef] = useEmblaCarousel({
    loop: false,
    align: "start",
    dragFree: true,
    containScroll: "trimSnaps",
  });

  return (
    <section
      aria-label="Shop by category"
      className="w-full py-20 md:py-28 bg-[#FAFAFA]"
    >
      {/* ─── Section Header ─────────────────────────────────── */}
      <motion.div
        className="flex items-end justify-between px-6 md:px-12 mb-10 md:mb-14 max-w-[96%] mx-auto"
        initial={{ opacity: 0, y: 28 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.7, ease: "easeOut" }}
      >
        <div>
          <p className="text-xs font-sans font-semibold uppercase tracking-[0.2em] text-primary mb-3">
            The Collection
          </p>
          <h2 className="font-serif text-4xl md:text-6xl font-medium tracking-tight leading-[1.05] text-stone-900">
            Crafted for every <br className="hidden md:block" />
            <em className="not-italic text-primary">craving</em>
          </h2>
        </div>

        <Link
          href="/shop"
          className="hidden md:flex items-center gap-2 text-sm font-sans font-medium text-stone-500 hover:text-primary transition-colors duration-200 group"
        >
          View all categories
          <ArrowUpRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </Link>
      </motion.div>

      {/* ─── Embla Carousel ──────────────────────────────────── */}
      {/* emblaRef goes on the viewport (overflow-hidden wrapper) */}
      <div
        ref={emblaRef}
        className="overflow-hidden cursor-grab active:cursor-grabbing"
      >
        <motion.div
          className="flex gap-4 md:gap-5 pl-6 md:pl-12"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5 }}
        >
          {categories.map((cat, i) => (
            <motion.article
              key={cat.id}
              /* embla requires flex children to have min-w-0 to work correctly */
              className="shrink-0 w-[272px] sm:w-[320px] md:w-[380px] rounded-[1.5rem] overflow-hidden bg-white shadow-[0_2px_24px_rgba(0,0,0,0.07)] group"
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.6, ease: "easeOut", delay: i * 0.08 }}
              whileHover={{
                y: -6,
                transition: { duration: 0.3, ease: "easeOut" },
              }}
            >
              <Link href={cat.href} draggable={false}>
                {/* Hero image block */}
                <div className="relative w-full h-[340px] md:h-[440px] overflow-hidden">
                  <Image
                    src={cat.image}
                    alt={cat.alt}
                    fill
                    draggable={false}
                    className="object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                    sizes="(max-width: 640px) 272px, (max-width: 768px) 320px, 380px"
                  />

                  {/* Gradient veil */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />

                  {/* Editorial number — ghost watermark, top-left */}
                  <span
                    className="absolute top-5 left-5 font-serif text-7xl font-bold leading-none select-none pointer-events-none"
                    style={{ color: "rgba(255,255,255,0.10)" }}
                    aria-hidden="true"
                  >
                    {cat.id}
                  </span>

                  {/* Promotion badge — premium glassmorphic pill, top-right.
                      Slides in from above, then pulses gently to draw the eye. */}
                  {cat.discountLabel && (
                    <motion.div
                      className="absolute top-5 right-5 z-10"
                      initial={{ opacity: 0, y: -14 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true, margin: "-40px" }}
                      transition={{ duration: 0.5, ease: "easeOut", delay: i * 0.08 + 0.25 }}
                    >
                      <motion.span
                        className="inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-gradient-to-br from-primary to-primary/80 px-3.5 py-1.5 text-[11px] font-sans font-bold uppercase tracking-[0.12em] text-white shadow-lg shadow-primary/30 backdrop-blur-md ring-1 ring-inset ring-white/10"
                        animate={{ scale: [1, 1.06, 1] }}
                        transition={{
                          duration: 2.2,
                          repeat: Infinity,
                          ease: "easeInOut",
                        }}
                      >
                        <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                        {cat.discountLabel}
                      </motion.span>
                    </motion.div>
                  )}

                  {/* Text block — pinned to bottom */}
                  <div className="absolute bottom-0 left-0 right-0 p-5 md:p-7">
                    <h3 className="font-serif text-2xl md:text-[1.75rem] font-semibold text-white leading-tight mb-1.5">
                      {cat.title}
                    </h3>
                    <p className="font-sans text-xs md:text-sm text-white/65 leading-snug">
                      {cat.subtitle}
                    </p>

                    {/* Hover CTA — slides up on hover */}
                    <div className="mt-4 flex items-center gap-1.5 text-white text-[11px] font-sans font-semibold uppercase tracking-[0.15em] translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300 ease-out">
                      Explore
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </div>
                  </div>
                </div>
              </Link>
            </motion.article>
          ))}

          {/* Trailing spacer so last card has right-side breathing room */}
          <div className="shrink-0 w-6 md:w-12" aria-hidden="true" />
        </motion.div>
      </div>

      {/* ─── Mobile "View all" link ──────────────────────────── */}
      <motion.div
        className="mt-8 px-6 md:hidden"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.3 }}
      >
        <Link
          href="/shop"
          className="inline-flex items-center gap-2 text-sm font-sans font-medium text-stone-500 hover:text-primary transition-colors duration-200"
        >
          View all categories
          <ArrowUpRight className="w-4 h-4" />
        </Link>
      </motion.div>
    </section>
  );
}
