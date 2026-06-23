"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { FaInstagram, FaFacebook, FaTwitter } from "react-icons/fa";

// ─── Data ────────────────────────────────────────────────────────
const NAV_GROUPS = [
  {
    heading: "The Collection",
    links: [
      { label: "Oriental Sweets", href: "/category/oriental-sweets" },
      { label: "Modern Pastry", href: "/category/western-sweets" },
      { label: "Bespoke Cakes", href: "/category/eid-sweets" },
      { label: "Luxury Beverages", href: "/category/bakery" },
    ],
  },
  {
    heading: "Heritage",
    links: [
      { label: "Our Story", href: "/story" },
      { label: "The Artisans", href: "/artisans" },
      { label: "Our Philosophy", href: "/philosophy" },
      { label: "Since 1998", href: "/heritage" },
    ],
  },
  {
    heading: "Boutiques",
    links: [
      { label: "Menouf Boutique", href: "/branches/menouf" },
      { label: "Beba Café", href: "/branches/beba" },
      { label: "Find Us", href: "/branches" },
    ],
  },
  {
    heading: "Client Care",
    links: [
      { label: "Contact Us", href: "/contact" },
      { label: "Custom Orders", href: "/custom" },
      { label: "FAQ", href: "#faq" },
      { label: "Delivery", href: "/delivery" },
    ],
  },
];

const SOCIALS = [
  { Icon: FaInstagram, href: "#", label: "Instagram" },
  { Icon: FaTwitter, href: "#", label: "Twitter" },
  { Icon: FaFacebook, href: "#", label: "Facebook" },
];

// ─── Animation helper ────────────────────────────────────────────
function fadeUp(delay: number = 0) {
  return {
    initial: { opacity: 0, y: 28 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: "-60px" },
    transition: { duration: 0.75, ease: "easeOut" as const, delay },
  };
}

// ─── Component ───────────────────────────────────────────────────
export default function Footer() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!email) return;
    setSubmitted(true);
    setEmail("");
    // TODO: wire to newsletter provider
    setTimeout(() => setSubmitted(false), 4000);
  }

  return (
    <footer className="bg-[#0F5A6D] text-white">
      <div className="max-w-7xl mx-auto px-6 md:px-12 lg:px-20">
        {/* ─── Brand Statement ─────────────────────────────── */}
        <motion.div
          className="pt-20 md:pt-28 pb-16 md:pb-20 border-b border-white/10"
          {...fadeUp(0)}
        >
          <span className="text-[10px] font-sans font-semibold uppercase tracking-[0.35em] text-white/35 block mb-7">
            Est. 1998 · Menouf, Egypt
          </span>

          {/* Massive brand name — editorial masthead */}
          <div className="overflow-hidden">
            <motion.h2
              className="font-serif font-medium leading-none tracking-tight text-white/90"
              style={{ fontSize: "clamp(3.5rem, 11vw, 10rem)" }}
              initial={{ y: "105%" }}
              whileInView={{ y: "0%" }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 1, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
            >
              Ali Baba
            </motion.h2>
          </div>

          <motion.p
            className="mt-5 font-serif italic text-white/30 text-xl md:text-2xl"
            {...fadeUp(0.35)}
          >
            The art of pure indulgence.
          </motion.p>
        </motion.div>

        {/* ─── Newsletter + Nav ────────────────────────────── */}
        <div className="py-16 md:py-20 grid grid-cols-1 lg:grid-cols-5 gap-16 lg:gap-12 border-b border-white/10">
          {/* Newsletter col */}
          <motion.div className="lg:col-span-2" {...fadeUp(0.1)}>
            <p className="text-[10px] font-sans font-bold uppercase tracking-[0.3em] text-white/35 mb-5">
              Inner Circle
            </p>
            <h3 className="font-serif text-2xl md:text-3xl font-medium text-white/90 leading-snug mb-3">
              Be the first to know <br />
              <em className="not-italic text-primary">our next chapter.</em>
            </h3>
            <p className="font-sans text-sm text-white/40 leading-relaxed mb-9 max-w-xs">
              Seasonal drops, exclusive tastings, and stories from our kitchen —
              delivered quietly to your inbox.
            </p>

            {/* Ultra-minimal underline form */}
            {submitted ? (
              <p className="font-sans text-sm text-primary/80 tracking-wide pb-3 border-b border-white/20">
                Thank you. We&apos;ll be in touch.
              </p>
            ) : (
              <form
                onSubmit={handleSubmit}
                className="flex items-center gap-3 border-b border-white/20 pb-3 focus-within:border-white/45 transition-colors duration-300"
              >
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Your email address"
                  className="bg-transparent flex-1 text-sm font-sans text-white/80 placeholder:text-white/20 outline-none caret-primary"
                />
                <button
                  type="submit"
                  aria-label="Subscribe to newsletter"
                  className="shrink-0 text-white/35 hover:text-white transition-colors duration-200"
                >
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            )}
          </motion.div>

          {/* Nav link groups */}
          <motion.nav
            aria-label="Footer navigation"
            className="lg:col-span-3 grid grid-cols-2 md:grid-cols-4 gap-10"
            {...fadeUp(0.18)}
          >
            {NAV_GROUPS.map((group) => (
              <div key={group.heading}>
                <p className="text-[10px] font-sans font-bold uppercase tracking-[0.25em] text-white/30 mb-5">
                  {group.heading}
                </p>
                <ul className="flex flex-col gap-3.5">
                  {group.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className="font-sans text-sm text-white/50 hover:text-white/90 transition-colors duration-200"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </motion.nav>
        </div>

        {/* ─── Bottom Bar ──────────────────────────────────── */}
        <motion.div
          className="py-7 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5"
          {...fadeUp(0.22)}
        >
          <p className="font-sans text-xs text-white/25 tracking-wide">
            © {new Date().getFullYear()} Ali Baba. All rights reserved.
          </p>

          <div className="flex items-center gap-6 flex-wrap">
            {["Privacy Policy", "Terms of Service"].map((label) => (
              <Link
                key={label}
                href="#"
                className="font-sans text-xs text-white/25 hover:text-white/55 transition-colors duration-200"
              >
                {label}
              </Link>
            ))}

            {/* Vertical rule */}
            <span
              className="hidden sm:block w-px h-3.5 bg-white/10"
              aria-hidden="true"
            />

            {/* Social icons */}
            <div className="flex items-center gap-4">
              {SOCIALS.map(({ Icon, href, label }) => (
                <Link
                  key={label}
                  href={href}
                  aria-label={label}
                  className="text-white/25 hover:text-white/65 transition-colors duration-200"
                >
                  <Icon className="w-3.5 h-3.5" />
                </Link>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </footer>
  );
}
