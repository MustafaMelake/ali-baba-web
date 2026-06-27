"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  LogOut,
  User as UserIcon,
  Loader2,
  Package,
  Heart,
} from "lucide-react";
import { signOut } from "@/lib/auth-client";

type SessionUser = {
  name: string;
  email: string;
  image?: string | null;
  // Inferred as `string` by Better Auth; the DB enum constrains it to
  // USER / MANAGER / ADMIN.
  role: string;
};

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Desktop avatar + dropdown menu for an authenticated user.
 * Self-contained: owns its own open/close state, click-outside and sign-out.
 */
export default function UserMenu({ user }: { user: SessionUser }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    setOpen(false);
    // refresh() re-runs Server Components so any server-read session clears too.
    router.push("/");
    router.refresh();
  }

  const isAdmin = user.role === "ADMIN";
  const isManager = user.role === "MANAGER";
  // ADMIN or MANAGER may reach the dashboard; USERs and guests never see it.
  // (UI visibility only — server gates enforce the real access boundary.)
  const isStaff = isAdmin || isManager;

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2.5 rounded-full pl-1 pr-3 py-1 transition-colors hover:bg-stone-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        <span className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-[13px] font-semibold text-primary ring-1 ring-primary/15">
          {user.image ? (
            <Image
              src={user.image}
              alt={user.name}
              fill
              sizes="36px"
              className="object-cover"
            />
          ) : (
            initials(user.name) || <UserIcon className="h-4 w-4" />
          )}
        </span>
        <span className="hidden lg:block max-w-[8rem] truncate text-[14px] font-medium text-foreground">
          {user.name.split(/\s+/)[0]}
        </span>
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 mt-3 w-60 origin-top-right overflow-hidden rounded-2xl border border-stone-100 bg-background shadow-xl shadow-stone-900/5"
          >
            {/* Identity header */}
            <div className="px-4 py-3.5 border-b border-stone-100">
              <p className="truncate font-serif text-base font-medium text-stone-900">
                {user.name}
              </p>
              <p className="truncate text-xs text-stone-400">{user.email}</p>
              {isStaff && (
                <span className="mt-1.5 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                  {isAdmin ? "Admin" : "Manager"}
                </span>
              )}
            </div>

            <div className="py-1.5">
              <Link
                href="/my-orders"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50 hover:text-primary"
              >
                <Package className="h-4 w-4" />
                My Orders
              </Link>
              <Link
                href="/wishlist"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50 hover:text-primary"
              >
                <Heart className="h-4 w-4" />
                Wishlist
              </Link>
              {isStaff && (
                <Link
                  href="/admin"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50 hover:text-primary"
                >
                  <LayoutDashboard className="h-4 w-4" />
                  Dashboard
                </Link>
              )}
              <button
                role="menuitem"
                onClick={handleSignOut}
                disabled={signingOut}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60"
              >
                {signingOut ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <LogOut className="h-4 w-4" />
                )}
                Sign Out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
