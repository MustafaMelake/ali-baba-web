"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShoppingCart, X, Menu, LayoutDashboard, LogOut } from "lucide-react";
import {
  motion,
  useScroll,
  useMotionValueEvent,
  AnimatePresence,
} from "framer-motion";
import { useCartStore } from "@/lib/cart-store";
import { useSession, signOut } from "@/lib/auth-client";
import CartSidebar from "@/components/CartSidebar";
import UserMenu from "@/components/UserMenu";

const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Branches", href: "#branches" },
  { label: "Menu", href: "/menu" },
];

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export default function Navbar() {
  const router = useRouter();
  const { scrollY } = useScroll();
  const [hidden, setHidden] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleCart = useCartStore((s) => s.toggleCart);
  const totalItems = useCartStore((s) => s.totalItems);
  const itemCount = totalItems();

  // Reactive session — re-renders on login/logout without a full page reload.
  const { data: session, isPending } = useSession();
  const user = session?.user;
  const isAdmin = user?.role === "ADMIN";

  async function handleMobileSignOut() {
    await signOut();
    setMobileOpen(false);
    router.push("/");
    router.refresh();
  }

  // Hide on scroll down, reveal on scroll up
  useMotionValueEvent(scrollY, "change", (latest) => {
    const previous = scrollY.getPrevious() ?? 0;
    setHidden(latest > previous && latest > 100);
  });

  // Close mobile menu when viewport widens past md breakpoint
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    function onResize() {
      if (mq.matches) setMobileOpen(false);
    }
    mq.addEventListener("change", onResize);
    return () => mq.removeEventListener("change", onResize);
  }, []);

  // Lock body scroll while mobile menu is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <>
      <motion.header
        variants={{ visible: { y: 0 }, hidden: { y: "-100%" } }}
        animate={hidden && !mobileOpen ? "hidden" : "visible"}
        transition={{ duration: 0.35, ease: "easeInOut" }}
        className="fixed top-0 z-50 w-full bg-background/95 backdrop-blur-sm shadow-sm"
      >
        <div className="max-w-7xl mx-auto px-6 md:px-12 h-16 md:h-20 flex items-center justify-between">
          {/* Logo */}
          <Link
            href="/"
            onClick={() => setMobileOpen(false)}
            className="text-2xl md:text-3xl font-serif font-bold tracking-tighter text-primary"
            aria-label="Ali Baba Home"
          >
            Ali Baba
          </Link>

          {/* Desktop nav — hidden on mobile */}
          <nav
            className="hidden md:flex items-center gap-12 text-[15px] font-medium text-foreground"
            aria-label="Main Navigation"
          >
            {NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="hover:text-primary transition-colors"
              >
                {l.label}
              </Link>
            ))}
          </nav>

          {/* Right actions */}
          <div className="flex items-center gap-2 md:gap-5">
            {/* Auth — desktop only */}
            <div className="hidden md:flex items-center gap-5">
              {isPending ? (
                // Avoid a flash of "Sign In" before the session resolves.
                <div
                  className="h-9 w-9 animate-pulse rounded-full bg-stone-100"
                  aria-hidden="true"
                />
              ) : user ? (
                <UserMenu
                  user={{
                    name: user.name,
                    email: user.email,
                    image: user.image,
                    role: user.role,
                  }}
                />
              ) : (
                <>
                  <Link
                    href="/login"
                    className="text-[13px] font-sans font-medium uppercase tracking-[0.15em] text-foreground/70 hover:text-primary transition-colors"
                  >
                    Sign In
                  </Link>
                  <Link
                    href="/signup"
                    className="rounded-full border border-primary/40 px-5 py-2 text-[13px] font-sans font-semibold uppercase tracking-[0.15em] text-primary hover:bg-primary/5 hover:border-primary transition-all"
                  >
                    Join
                  </Link>
                </>
              )}
            </div>

            {/* Cart button */}
            <button
              onClick={toggleCart}
              className="relative flex items-center justify-center w-10 h-10 md:w-11 md:h-11 rounded-full text-foreground hover:bg-stone-100 transition-colors"
              aria-label={`Open cart${
                itemCount > 0 ? `, ${itemCount} items` : ""
              }`}
            >
              <ShoppingCart className="w-5 h-5" />
              {itemCount > 0 && (
                <motion.span
                  key={itemCount}
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 500, damping: 28 }}
                  className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] text-white font-bold ring-2 ring-background"
                >
                  {itemCount > 9 ? "9+" : itemCount}
                </motion.span>
              )}
            </button>

            {/* Hamburger / Close — mobile only */}
            <button
              onClick={() => setMobileOpen((o) => !o)}
              className="md:hidden flex items-center justify-center w-10 h-10 rounded-full text-foreground hover:bg-stone-100 transition-colors"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
              aria-controls="mobile-menu"
            >
              <AnimatePresence mode="wait" initial={false}>
                {mobileOpen ? (
                  <motion.span
                    key="close"
                    initial={{ rotate: -90, opacity: 0 }}
                    animate={{ rotate: 0, opacity: 1 }}
                    exit={{ rotate: 90, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <X className="w-5 h-5" />
                  </motion.span>
                ) : (
                  <motion.span
                    key="menu"
                    initial={{ rotate: 90, opacity: 0 }}
                    animate={{ rotate: 0, opacity: 1 }}
                    exit={{ rotate: -90, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Menu className="w-5 h-5" />
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          </div>
        </div>
      </motion.header>

      {/* ─── Mobile drawer ─────────────────────────────────────── */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              key="mob-backdrop"
              className="md:hidden fixed inset-0 z-40 bg-stone-950/30 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              onClick={() => setMobileOpen(false)}
              aria-hidden="true"
            />

            {/* Panel */}
            <motion.div
              id="mobile-menu"
              key="mob-panel"
              role="dialog"
              aria-modal="true"
              aria-label="Mobile navigation"
              className="md:hidden fixed top-16 left-0 right-0 z-50 bg-background shadow-xl border-t border-stone-100 overflow-hidden"
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              {/* Nav links */}
              <nav className="px-6 pt-4 pb-2">
                {NAV_LINKS.map((l, i) => (
                  <motion.div
                    key={l.href}
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      duration: 0.3,
                      ease: EASE,
                      delay: 0.05 + i * 0.06,
                    }}
                  >
                    <Link
                      href={l.href}
                      onClick={() => setMobileOpen(false)}
                      className="flex items-center py-4 border-b border-stone-100 font-serif text-2xl font-medium text-stone-900 hover:text-primary transition-colors"
                    >
                      {l.label}
                    </Link>
                  </motion.div>
                ))}
              </nav>

              {/* Auth links */}
              <motion.div
                className="px-6 py-6 flex flex-col gap-3"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: EASE, delay: 0.24 }}
              >
                {isPending ? (
                  <div className="h-12 w-full animate-pulse rounded-full bg-stone-100" />
                ) : user ? (
                  <>
                    {/* Identity */}
                    <div className="mb-1 flex flex-col">
                      <span className="font-serif text-lg font-medium text-stone-900">
                        {user.name}
                      </span>
                      <span className="text-xs text-stone-400">{user.email}</span>
                    </div>

                    {isAdmin && (
                      <Link
                        href="/admin"
                        onClick={() => setMobileOpen(false)}
                        className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3.5 font-sans text-sm font-semibold uppercase tracking-widest text-white transition-colors hover:bg-primary/90"
                      >
                        <LayoutDashboard className="h-4 w-4" />
                        Admin Dashboard
                      </Link>
                    )}

                    <button
                      onClick={handleMobileSignOut}
                      className="flex w-full items-center justify-center gap-2 rounded-full border border-stone-200 py-3.5 font-sans text-sm font-semibold uppercase tracking-widest text-red-600 transition-colors hover:border-red-300 hover:bg-red-50"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign Out
                    </button>
                  </>
                ) : (
                  <>
                    <Link
                      href="/signup"
                      onClick={() => setMobileOpen(false)}
                      className="w-full text-center rounded-full bg-stone-900 py-3.5 font-sans text-sm font-semibold uppercase tracking-widest text-white hover:bg-stone-700 transition-colors"
                    >
                      Join the Inner Circle
                    </Link>
                    <Link
                      href="/login"
                      onClick={() => setMobileOpen(false)}
                      className="w-full text-center rounded-full border border-stone-200 py-3.5 font-sans text-sm font-semibold uppercase tracking-widest text-stone-600 hover:border-stone-400 transition-colors"
                    >
                      Sign In
                    </Link>
                  </>
                )}
              </motion.div>

              {/* Footer strip */}
              <div className="px-6 pb-6 flex items-center justify-between">
                <span className="font-sans text-[10px] uppercase tracking-[0.25em] text-stone-400">
                  Est. 1998 · Menouf, Egypt
                </span>
                <span className="font-serif text-sm italic text-stone-400">
                  Crafted with care.
                </span>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Cart drawer */}
      <CartSidebar />
    </>
  );
}
