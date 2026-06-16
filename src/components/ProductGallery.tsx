"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Props {
  images: string[];
  name: string;
}

export default function ProductGallery({ images, name }: Props) {
  const [active, setActive] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const zoomRef = useRef<HTMLDivElement>(null);

  // Update transformOrigin directly on the DOM node — no React re-render,
  // no transition on origin (instant cursor tracking), scale has transition.
  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!zoomRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (((e.clientX - rect.left) / rect.width) * 100).toFixed(2);
    const y = (((e.clientY - rect.top) / rect.height) * 100).toFixed(2);
    zoomRef.current.style.transformOrigin = `${x}% ${y}%`;
  }

  function prev() {
    setActive((a) => (a === 0 ? images.length - 1 : a - 1));
  }
  function next() {
    setActive((a) => (a === images.length - 1 ? 0 : a + 1));
  }

  return (
    <div className="flex flex-col h-full select-none">

      {/* ─── Main image ────────────────────────────────────── */}
      <div
        className="relative flex-1 overflow-hidden bg-stone-50 lg:cursor-crosshair"
        onMouseEnter={() => setZoomed(true)}
        onMouseLeave={() => {
          setZoomed(false);
          // Reset origin so next hover starts centered
          if (zoomRef.current) zoomRef.current.style.transformOrigin = "50% 50%";
        }}
        onMouseMove={handleMouseMove}
      >
        {/* Zoom target — scale only, no AnimatePresence here */}
        <div
          ref={zoomRef}
          className="absolute inset-0 will-change-transform"
          style={{
            transform: zoomed ? "scale(2.2)" : "scale(1)",
            transition: "transform 0.55s cubic-bezier(0.22,1,0.36,1)",
            transformOrigin: "50% 50%",
          }}
        >
          {/* Image crossfade on thumbnail change */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={active}
              className="absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.28, ease: "easeInOut" }}
            >
              <Image
                src={images[active]}
                alt={`${name} — view ${active + 1}`}
                fill
                priority={active === 0}
                draggable={false}
                className="object-cover"
                sizes="(max-width: 1024px) 100vw, 50vw"
              />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Zoom hint pill — desktop only */}
        <div
          className="hidden lg:block absolute bottom-4 right-4 bg-white/80 backdrop-blur-sm rounded-full px-3 py-1.5 pointer-events-none transition-opacity duration-300"
          style={{ opacity: zoomed ? 0 : 1 }}
        >
          <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-500">
            Hover to zoom
          </span>
        </div>

        {/* Mobile prev / next arrows */}
        {images.length > 1 && (
          <>
            <button
              onClick={prev}
              aria-label="Previous image"
              className="lg:hidden absolute left-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-9 h-9 rounded-full bg-white/80 backdrop-blur-sm text-stone-600 hover:bg-white transition-colors shadow-sm"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={next}
              aria-label="Next image"
              className="lg:hidden absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-9 h-9 rounded-full bg-white/80 backdrop-blur-sm text-stone-600 hover:bg-white transition-colors shadow-sm"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            {/* Mobile dot indicators */}
            <div className="lg:hidden absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5">
              {images.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setActive(i)}
                  aria-label={`Go to image ${i + 1}`}
                  className="w-1.5 h-1.5 rounded-full transition-all duration-200"
                  style={{
                    background: i === active ? "#198b9e" : "rgba(0,0,0,0.25)",
                    transform: i === active ? "scale(1.3)" : "scale(1)",
                  }}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ─── Thumbnail strip ───────────────────────────────── */}
      <div className="hidden lg:flex gap-3 p-4 bg-white border-t border-stone-100 shrink-0">
        {images.map((src, i) => (
          <button
            key={i}
            onClick={() => setActive(i)}
            aria-label={`View image ${i + 1}`}
            className="relative w-[72px] h-[72px] shrink-0 rounded-xl overflow-hidden transition-all duration-250"
            style={{
              outline: i === active ? "2px solid #198b9e" : "2px solid transparent",
              outlineOffset: "2px",
              opacity: i === active ? 1 : 0.55,
              transform: i === active ? "scale(1.04)" : "scale(1)",
            }}
          >
            <Image
              src={src}
              alt={`${name} thumbnail ${i + 1}`}
              fill
              className="object-cover"
              sizes="72px"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
