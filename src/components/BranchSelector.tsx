"use client";

import Image from "next/image";
import { motion, Variants } from "framer-motion";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

// إعدادات الأنيميشن لظهور العناصر بسلاسة عند السكرول
const fadeUpVariant: Variants = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: "easeOut" } },
};

// Pure presentational leaf: the location data is fetched server-side (homepage)
// via getStorefrontLocations and handed down as props. This keeps the animated
// grid a thin "use client" island over server state — no client data layer.
type Location = {
  id: string;
  tag: string;
  hours: string;
  title: string;
  description: string;
  imageUrl: string;
  locality: string;
  type: string;
};

// Two-tone editorial palette, alternated by position — preserving the original
// green Patisserie / blue Café look for the first two cards and cycling beyond.
const TAG_STYLES = [
  "bg-[#829E87]/20 text-[#5C7561]", // even — Patisserie green
  "bg-[#759EBD]/20 text-[#4A7292]", // odd  — Café blue
];

export default function BranchSelector({
  locations,
}: {
  locations: Location[];
}) {
  // Nothing active → render nothing at all (no empty section, no bare JSON-LD),
  // mirroring FaqsSection.
  if (locations.length === 0) return null;

  // Schema Markup for SEO (LocalBusiness) — built from the same rows the grid
  // renders, so the markup and the crawler payload can never drift apart.
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": locations.map((location) => ({
      "@type": location.type,
      name: `Ali Baba — ${location.title}`,
      description: location.description,
      address: {
        "@type": "PostalAddress",
        addressLocality: location.locality,
        addressCountry: "EG",
      },
    })),
  };

  return (
    <section
      className="w-full py-24 md:py-32 px-6 md:px-12 lg:px-20 bg-background overflow-hidden"
      aria-labelledby="branches-heading"
      id="branches"
    >
      {/* حقن كود الـ SEO في الصفحة */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="max-w-7xl mx-auto">
        {/* Header Section - Centered Perfectly */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={fadeUpVariant}
          className="text-center mb-16 md:mb-24 flex flex-col items-center justify-center"
        >
          <h2
            id="branches-heading"
            className="font-serif text-4xl md:text-6xl font-medium tracking-tight text-foreground"
          >
            Our Locations
          </h2>
          <p className="mt-4 text-lg text-stone-500 max-w-xl font-sans mx-auto">
            Two distinct experiences, one signature quality. Discover our pastry
            boutique in Menouf and our relaxing café lounge in Beba.
          </p>
        </motion.div>

        {/* Asymmetrical Grid (Editorial Style) — every odd card is nudged down and
            flips its image/text order for the staggered, magazine-style rhythm. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-16 lg:gap-24">
          {locations.map((location, index) => {
            const isShifted = index % 2 === 1;
            const tagStyle = TAG_STYLES[index % TAG_STYLES.length];

            return (
              <motion.article
                key={location.id}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-100px" }}
                variants={fadeUpVariant}
                // Shifted columns drop down on desktop to create the "staircase".
                className={cn("flex flex-col gap-8", isShifted && "md:mt-32")}
              >
                {/* Image — DOM-first, then reordered per column: even cards show
                    text above image everywhere; shifted cards show text first on
                    mobile but image first on desktop. */}
                <div
                  className={cn(
                    "relative w-full aspect-[4/3] rounded-[2rem] overflow-hidden group order-2",
                    isShifted && "md:order-1",
                  )}
                >
                  <Image
                    src={location.imageUrl}
                    alt={`${location.title} — ${location.locality}`}
                    fill
                    className="object-cover transition-transform duration-700 group-hover:scale-105"
                    sizes="(max-width: 768px) 100vw, 50vw"
                  />
                  <div className="absolute inset-0 bg-black/5 group-hover:bg-transparent transition-colors duration-500"></div>
                </div>

                {/* Text Content */}
                <div
                  className={cn(
                    "flex flex-col gap-4 order-1",
                    isShifted && "md:order-2",
                  )}
                >
                  <div className="flex items-center gap-4">
                    <span
                      className={cn(
                        "inline-flex px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest",
                        tagStyle,
                      )}
                    >
                      {location.tag}
                    </span>
                    <span className="flex items-center gap-1 text-sm text-stone-400 font-medium">
                      <Clock className="w-3.5 h-3.5" /> {location.hours}
                    </span>
                  </div>

                  <h3 className="font-serif text-3xl md:text-4xl font-medium text-foreground">
                    {location.title}
                  </h3>

                  <p className="text-stone-500 text-lg leading-relaxed">
                    {location.description}
                  </p>
                </div>
              </motion.article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
