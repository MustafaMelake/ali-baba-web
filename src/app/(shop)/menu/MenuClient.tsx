"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Info } from "lucide-react";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

// ─── Data contract (from the Server Component) ───────────────────
export type MenuItemDTO = { id: string; name: string; price: number };
export type MenuCategoryDTO = {
  id: string;
  title: string;
  slug: string;
  isFixedPrice: boolean;
  items: MenuItemDTO[];
};

// ─── Leader-line row ─────────────────────────────────────────────
function MenuRow({ name, price }: { name: string; price: number }) {
  return (
    <div className="group flex items-center gap-3 py-[14px] border-b border-stone-100 last:border-0 -mx-6 px-6 transition-colors duration-150 hover:bg-stone-50">
      {/* Price */}
      <div className="shrink-0 w-[72px]">
        <span className="font-sans text-sm font-semibold text-stone-800 tabular-nums">
          {price}
        </span>
        <span className="ml-0.5 font-sans text-[11px] text-stone-400"> ج.م</span>
      </div>

      {/* Dotted leader */}
      <div
        className="flex-1 h-px opacity-40"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg,#78716c 0,#78716c 3px,transparent 3px,transparent 9px)",
        }}
        aria-hidden="true"
      />

      {/* Arabic name */}
      <span
        className="shrink-0 font-sans text-[15px] font-medium text-stone-900 text-right max-w-[55%] leading-snug"
        dir="rtl"
        lang="ar"
      >
        {name}
      </span>
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────
function MenuSection({
  id,
  num,
  title,
  children,
}: {
  id: string;
  num: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      id={id}
      className="scroll-mt-[134px] md:scroll-mt-[148px]"
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, ease: EASE }}
    >
      {/* Card */}
      <div className="bg-white rounded-2xl shadow-[0_2px_20px_rgba(0,0,0,0.055)] overflow-hidden">
        {/* Section header */}
        <div className="px-6 pt-7 pb-6 border-b border-stone-100 flex items-start justify-between gap-4">
          <div>
            <span className="block font-sans text-[10px] font-bold uppercase tracking-[0.3em] text-primary mb-2">
              {num}
            </span>
            <h2 className="font-serif text-3xl md:text-4xl font-medium tracking-tight text-stone-900 leading-tight">
              {title}
            </h2>
          </div>
          {/* Decorative hairline accent */}
          <span
            className="shrink-0 mt-2 w-8 h-px block"
            style={{ background: "#198b9e" }}
            aria-hidden="true"
          />
        </div>

        {/* Items */}
        <div className="px-6 py-2 pb-4">{children}</div>
      </div>
    </motion.section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────
export default function MenuClient({
  categories,
}: {
  categories: MenuCategoryDTO[];
}) {
  // Nav model derived from the live categories (label = title, num = position).
  const sections = useMemo(
    () =>
      categories.map((c, i) => ({
        id: c.slug,
        label: c.title,
        num: String(i + 1).padStart(2, "0"),
      })),
    [categories],
  );

  const [activeId, setActiveId] = useState<string>(categories[0]?.slug ?? "");

  // Scroll to a section, accounting for both sticky headers
  function scrollToSection(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    const offset = window.innerWidth >= 768 ? 148 : 134;
    window.scrollTo({
      top: el.getBoundingClientRect().top + window.scrollY - offset,
      behavior: "smooth",
    });
    setActiveId(id);
  }

  // Scroll-spy: highlight nav tab matching the section currently in view
  const sectionKey = sections.map((s) => s.id).join("|");
  useEffect(() => {
    const ids = sectionKey ? sectionKey.split("|") : [];
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (!visible.length) return;
        const top = visible.reduce((a, b) =>
          a.intersectionRatio >= b.intersectionRatio ? a : b,
        );
        setActiveId(top.target.id);
      },
      { rootMargin: "-22% 0px -65% 0px", threshold: [0, 0.1, 0.5, 1] },
    );

    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [sectionKey]);

  return (
    <div className="min-h-screen bg-[#FAFAFA] pt-16 md:pt-20">
      {/* ─── Editorial header ─────────────────────────────── */}
      <header className="max-w-3xl mx-auto px-6 pt-0 md:pt-0 pb-8 text-center">
        <motion.span
          className="inline-block font-sans text-[11px] font-semibold uppercase tracking-[0.35em] text-primary mb-5"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE }}
        >
          Ali Baba · The Café
        </motion.span>

        <motion.h1
          className="font-serif font-medium tracking-tight leading-[1.02] text-stone-900 text-[clamp(2.75rem,7vw,5rem)]"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: EASE, delay: 0.08 }}
        >
          Our <em className="not-italic text-primary">Menu</em>
        </motion.h1>

        <motion.p
          className="mt-5 font-sans text-sm md:text-base text-stone-500 leading-relaxed"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.18 }}
        >
          Handcrafted in our kitchen daily — from velvety smoothies and signature
          desserts to artisan waffles and premium ice cream.
        </motion.p>
      </header>

      {/* ─── Disclaimer ───────────────────────────────────── */}
      <motion.div
        className="max-w-3xl mx-auto px-6 pb-10"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: EASE, delay: 0.28 }}
      >
        <div className="flex items-start gap-3.5 rounded-xl border border-primary/25 bg-primary/5 px-5 py-4">
          <Info className="mt-0.5 w-4 h-4 shrink-0 text-primary/70" />
          <p className="font-sans text-sm text-stone-600 leading-relaxed">
            Our Café menu is crafted fresh daily and served exclusively for{" "}
            <span className="font-medium text-stone-800">dine-in</span> &{" "}
            <span className="font-medium text-stone-800">branch pickup</span>{" "}
            experience. All prices are in Egyptian Pounds and subject to seasonal
            variation.
          </p>
        </div>
      </motion.div>

      {/* ─── Sticky category sub-nav ──────────────────────── */}
      {sections.length > 0 && (
        <div className="sticky top-0 md:top-0 z-30 bg-[#FAFAFA]/95 backdrop-blur-md border-y border-stone-200/60">
          <div className="max-w-3xl mx-auto px-4">
            <div className="flex items-center justify-center gap-1 overflow-x-auto py-3.5 scrollbar-none -mx-1 px-1">
              {sections.map(({ id, label }) => {
                const isActive = activeId === id;
                return (
                  <button
                    key={id}
                    onClick={() => scrollToSection(id)}
                    className={`relative shrink-0 rounded-full px-4 py-2 font-sans text-[13px] font-medium tracking-wide transition-colors duration-300 ${
                      isActive ? "text-white" : "text-stone-500 hover:text-stone-800"
                    }`}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="menu-filter-pill"
                        className="absolute inset-0 rounded-full bg-stone-900"
                        transition={{ type: "spring", stiffness: 400, damping: 34 }}
                      />
                    )}
                    <span className="relative z-10 whitespace-nowrap">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ─── Sections ──────────────────────────────────────── */}
      <div className="max-w-3xl mx-auto px-6 py-10 space-y-8 pb-24">
        {categories.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-[0_2px_20px_rgba(0,0,0,0.055)] px-6 py-20 text-center">
            <p className="font-serif text-2xl font-medium text-stone-900">
              Our menu is being prepared
            </p>
            <p className="mt-2 font-sans text-sm text-stone-500">
              Please check back shortly — fresh selections are on their way.
            </p>
          </div>
        ) : (
          categories.map((category, i) => {
            const num = String(i + 1).padStart(2, "0");

            // Fixed-price → flavour grid + single unified price badge.
            if (category.isFixedPrice) {
              const unitPrice = category.items[0]?.price;
              return (
                <MenuSection key={category.id} id={category.slug} num={num} title={category.title}>
                  {unitPrice != null && (
                    <div className="flex items-center justify-between py-4 border-b border-stone-100 mb-1">
                      <span className="font-sans text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">
                        All flavours at a fixed price
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3.5 py-1.5">
                        <span className="font-sans text-sm font-bold text-primary tabular-nums">
                          {unitPrice}
                        </span>
                        <span className="font-sans text-xs text-primary/80">ج.م</span>
                      </span>
                    </div>
                  )}

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-0 pt-2 pb-2">
                    {category.items.map((item) => (
                      <div
                        key={item.id}
                        className="py-3 border-b border-stone-50 text-right font-sans text-[15px] font-medium text-stone-800 last:border-0"
                        dir="rtl"
                        lang="ar"
                      >
                        {item.name}
                      </div>
                    ))}
                  </div>
                </MenuSection>
              );
            }

            // Standard → priced leader-line rows.
            return (
              <MenuSection key={category.id} id={category.slug} num={num} title={category.title}>
                {category.items.map((item) => (
                  <MenuRow key={item.id} name={item.name} price={item.price} />
                ))}
              </MenuSection>
            );
          })
        )}

        {/* Bottom mark */}
        <div className="pt-8 text-center">
          <div className="inline-block w-12 h-px bg-primary/40 mb-4" />
          <p className="font-serif italic text-stone-400 text-base">
            Crafted with care. Served with pride.
          </p>
          <p className="mt-2 font-sans text-[11px] uppercase tracking-[0.25em] text-stone-300">
            Ali Baba · Est. 1998 · Menouf, Egypt
          </p>
        </div>
      </div>
    </div>
  );
}
