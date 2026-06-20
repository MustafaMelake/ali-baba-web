"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  LayoutDashboard,
  ShoppingBag,
  Package,
  Tags,
  Coffee,
  Star,
  Users,
  Settings,
  Store,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminUi } from "@/lib/admin-ui-store";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

/**
 * Single source of truth for the admin navigation. Add a route here and it
 * shows up in both the desktop rail and the mobile drawer.
 */
const NAV_ITEMS: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/orders", label: "Orders", icon: ShoppingBag },
  { href: "/admin/products", label: "Products", icon: Package },
  { href: "/admin/categories", label: "Categories", icon: Tags },
  { href: "/admin/menu", label: "Café Menu", icon: Coffee },
  { href: "/admin/reviews", label: "Reviews", icon: Star },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

/**
 * `/admin` must match exactly (otherwise it would light up for every
 * sub-route); deeper routes match by prefix so e.g. /admin/products/new still
 * highlights "Products".
 */
function isActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

function Brand() {
  return (
    <Link href="/admin" className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-sm font-bold text-white">
        AB
      </span>
      <span className="flex flex-col leading-none">
        <span className="font-serif text-lg font-medium text-stone-900">
          Ali Baba
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.25em] text-primary">
          Admin
        </span>
      </span>
    </Link>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-1 flex-col gap-1">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-stone-500 hover:bg-stone-100 hover:text-stone-900"
            )}
          >
            <Icon
              className={cn(
                "h-[18px] w-[18px] shrink-0 transition-colors",
                active
                  ? "text-primary"
                  : "text-stone-400 group-hover:text-stone-600"
              )}
            />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function BackToStore({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/"
      onClick={onNavigate}
      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
    >
      <Store className="h-[18px] w-[18px] shrink-0 text-stone-400" />
      Back to store
    </Link>
  );
}

export default function Sidebar() {
  const { mobileNavOpen, closeMobileNav } = useAdminUi();

  // Lock body scroll + close on Escape while the mobile drawer is open.
  useEffect(() => {
    if (!mobileNavOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeMobileNav();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [mobileNavOpen, closeMobileNav]);

  return (
    <>
      {/* ---------- Desktop rail (in-flow flex column) ---------- */}
      <aside className="hidden h-full w-64 shrink-0 flex-col overflow-y-auto border-r border-stone-200/80 bg-white px-4 py-6 lg:flex">
        <div className="px-2">
          <Brand />
        </div>
        <div className="mt-8 flex flex-1 flex-col">
          <NavLinks />
          <div className="mt-auto border-t border-stone-200/70 pt-3">
            <BackToStore />
          </div>
        </div>
      </aside>

      {/* ---------- Mobile slide-over drawer ---------- */}
      <AnimatePresence>
        {mobileNavOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={closeMobileNav}
              className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
            />
            {/* Panel */}
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-y-0 left-0 flex w-72 max-w-[80%] flex-col bg-white px-4 py-6 shadow-2xl"
            >
              <div className="flex items-center justify-between px-2">
                <Brand />
                <button
                  onClick={closeMobileNav}
                  aria-label="Close navigation"
                  className="rounded-lg p-1.5 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="mt-8 flex flex-1 flex-col">
                <NavLinks onNavigate={closeMobileNav} />
                <div className="mt-auto border-t border-stone-200/70 pt-3">
                  <BackToStore onNavigate={closeMobileNav} />
                </div>
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
