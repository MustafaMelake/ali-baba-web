"use client";

import { useRef } from "react";
import Image from "next/image";
import { motion, useScroll, useTransform } from "framer-motion";

export default function OurStory() {
  const containerRef = useRef<HTMLElement>(null);

  // إعدادات الـ Parallax
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "end start"],
  });

  // حركة النصوص والصور
  const yText = useTransform(scrollYProgress, [0, 1], ["0%", "-15%"]);
  const yImage1 = useTransform(scrollYProgress, [0, 1], ["-10%", "20%"]);
  const yImage2 = useTransform(scrollYProgress, [0, 1], ["10%", "-30%"]);

  return (
    <section
      ref={containerRef}
      // شيلنا الـ overflow-hidden من السكشن عشان القباب اللي بارزة لفوق تبان
      className="relative w-full bg-[#0F5A6D] pt-40 pb-24 md:pt-56 md:pb-32 text-white mt-16 md:mt-24"
    >
      <div className="max-w-7xl mx-auto px-6 md:px-12 lg:px-20 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-24 items-center">
          {/* الجزء الأول: النصوص */}
          <motion.div style={{ y: yText }} className="flex flex-col gap-6">
            <span className="inline-block text-[#E5D3B3] font-bold uppercase tracking-[0.3em] text-xs md:text-sm">
              Our Heritage
            </span>
            <h2 className="font-serif text-5xl md:text-6xl lg:text-7xl font-medium leading-[1.1]">
              A legacy of <br className="hidden md:block" />
              <span className="text-[#E5D3B3] italic">pure craft.</span>
            </h2>

            <div className="w-16 h-[1px] bg-[#E5D3B3]/50 my-4"></div>

            <p className="text-white/80 text-lg md:text-xl leading-relaxed max-w-lg font-light">
              It started with a simple belief: that true luxury lies in
              authenticity. For decades, Ali Baba has been crafting moments of
              joy, blending time-honored oriental recipes with a modern pursuit
              of perfection.
            </p>
            <p className="text-white/80 text-lg leading-relaxed max-w-lg font-light">
              Every fold of pastry, every drop of honey, and every selected nut
              tells a story of our unwavering commitment to quality. We
              don&apos;t just bake; we preserve a rich heritage.
            </p>

            <motion.div
              whileHover={{ x: 10 }}
              className="mt-6 inline-flex items-center gap-4 text-[#E5D3B3] font-medium uppercase tracking-widest text-sm cursor-pointer w-fit"
            >
              <span className="w-8 h-[1px] bg-[#E5D3B3]"></span>
              Discover the full story
            </motion.div>
          </motion.div>

          {/* الجزء الثاني: الصور المتداخلة (Parallax) */}
          <div className="relative h-[500px] md:h-[700px] w-full mt-12 lg:mt-0">
            {/* الصورة الرئيسية */}
            <motion.div
              style={{ y: yImage1 }}
              className="absolute top-0 right-0 w-[80%] md:w-[70%] h-[75%] rounded-t-[10rem] rounded-b-[2rem] overflow-hidden shadow-2xl z-10 border border-white/10"
            >
              <Image
                src="/our-story1.png"
                alt="Crafting oriental sweets"
                fill
                className="object-cover"
                sizes="(max-width: 768px) 80vw, 40vw"
              />
              <div className="absolute inset-0 bg-[#0F5A6D]/10 mix-blend-overlay"></div>
            </motion.div>

            {/* الصورة الأصغر */}
            <motion.div
              style={{ y: yImage2 }}
              className="absolute bottom-0 left-0 w-[55%] md:w-[45%] h-[55%] rounded-[2rem] overflow-hidden shadow-2xl z-20 border-4 border-[#0F5A6D]"
            >
              <Image
                src="/our-story2.png"
                alt="Close up of premium ingredients"
                fill
                className="object-cover"
                sizes="(max-width: 768px) 50vw, 25vw"
              />
            </motion.div>

            {/* سنة التأسيس في الخلفية */}
            <div className="absolute top-1/2 left-1/4 -translate-y-1/2 -translate-x-1/2 text-white/5 font-serif text-[10rem] md:text-[12rem] font-bold pointer-events-none select-none z-0">
              1998
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
