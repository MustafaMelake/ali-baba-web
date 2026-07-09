"use client";

import Image from "next/image";
import { motion, Variants } from "framer-motion";
import { Clock } from "lucide-react";

// إعدادات الأنيميشن لظهور العناصر بسلاسة عند السكرول
const fadeUpVariant: Variants = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: "easeOut" } },
};

export default function BranchSelector() {
  // Schema Markup for SEO (Local Business)
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Bakery",
        name: "Ali Baba Patisserie - Menouf",
        description: "Premium cakes, tarts, and oriental sweets in Menouf.",
        address: {
          "@type": "PostalAddress",
          addressLocality: "Menouf",
          addressCountry: "EG",
        },
      },
      {
        "@type": "CafeOrCoffeeShop",
        name: "Ali Baba Café - Beba",
        description:
          "Specialty coffee, artisanal beverages, and a relaxing lounge in Beba.",
        address: {
          "@type": "PostalAddress",
          addressLocality: "Beba",
          addressCountry: "EG",
        },
      },
    ],
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
          <p className="mt-4 text-lg text-gray-500 max-w-xl font-sans mx-auto">
            Two distinct experiences, one signature quality. Discover our pastry
            boutique in Menouf and our relaxing café lounge in Beba.
          </p>
        </motion.div>

        {/* Asymmetrical Grid (Editorial Style) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-16 lg:gap-24">
          {/* Column 1: Menouf Branch (Text First, Image Second) */}
          <motion.article
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeUpVariant}
            className="flex flex-col gap-8"
          >
            {/* Text Content */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <span className="inline-flex px-3 py-1 rounded-full bg-[#829E87]/20 text-[#5C7561] text-xs font-bold uppercase tracking-widest">
                  Patisserie
                </span>
                <span className="flex items-center gap-1 text-sm text-gray-400 font-medium">
                  <Clock className="w-3.5 h-3.5" /> 09:00 AM - 11:00 PM
                </span>
              </div>

              <h3 className="font-serif text-3xl md:text-4xl font-medium text-foreground">
                Menouf Boutique
              </h3>

              <p className="text-gray-500 text-lg leading-relaxed">
                Our flagship destination for indulgence. Featuring an exquisite
                selection of custom cakes, delicate tarts, and our signature
                oriental pastries crafted daily.
              </p>
            </div>

            {/* Image */}
            <div className="relative w-full aspect-[4/3] rounded-[2rem] overflow-hidden group">
              <Image
                src="/locat1.jpg" // تأكد من إضافة الصورة في مجلد public
                alt="Display of premium cakes and pastries at Menouf branch"
                fill
                className="object-cover transition-transform duration-700 group-hover:scale-105"
                sizes="(max-width: 768px) 100vw, 50vw"
              />
              <div className="absolute inset-0 bg-black/5 group-hover:bg-transparent transition-colors duration-500"></div>
            </div>
          </motion.article>

          {/* Column 2: Beba Branch (Image First, Text Second - Shifted down) */}
          <motion.article
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeUpVariant}
            // إزاحة العمود الثاني للأسفل في الشاشات الكبيرة لعمل تأثير السلالم (Staggered)
            className="flex flex-col gap-8 md:mt-32"
          >
            {/* Image */}
            <div className="relative w-full aspect-[4/3] rounded-[2rem] overflow-hidden group order-2 md:order-1">
              <Image
                src="/locate2.jpg" // تأكد من إضافة الصورة في مجلد public
                alt="Relaxing atmosphere and specialty drinks at Beba Cafe"
                fill
                className="object-cover transition-transform duration-700 group-hover:scale-105"
                sizes="(max-width: 768px) 100vw, 50vw"
              />
              <div className="absolute inset-0 bg-black/5 group-hover:bg-transparent transition-colors duration-500"></div>
            </div>

            {/* Text Content */}
            <div className="flex flex-col gap-4 order-1 md:order-2">
              <div className="flex items-center gap-4">
                <span className="inline-flex px-3 py-1 rounded-full bg-[#759EBD]/20 text-[#4A7292] text-xs font-bold uppercase tracking-widest">
                  Café & Lounge
                </span>
                <span className="flex items-center gap-1 text-sm text-gray-400 font-medium">
                  <Clock className="w-3.5 h-3.5" /> 07:00 AM - 12:00 AM
                </span>
              </div>

              <h3 className="font-serif text-3xl md:text-4xl font-medium text-foreground">
                Beba Café
              </h3>

              <p className="text-gray-500 text-lg leading-relaxed">
                A serene escape offering artisanal beverages, specialty coffee,
                and refreshing signature drinks. The perfect atmosphere to
                unwind or connect.
              </p>
            </div>
          </motion.article>
        </div>
      </div>
    </section>
  );
}
