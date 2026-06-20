"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Menu, LogOut, User as UserIcon, Loader2 } from "lucide-react";
import { signOut } from "@/lib/auth-client";
import { useAdminUi } from "@/lib/admin-ui-store";

type AdminUser = {
  name: string;
  email: string;
  image?: string | null;
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
 * Sticky admin top bar.
 *
 * Mobile: hamburger toggles the <Sidebar /> drawer via the shared UI store.
 * All sizes: shows the signed-in admin and a Sign Out action.
 */
export default function TopHeader({ user }: { user: AdminUser }) {
  const router = useRouter();
  const { toggleMobileNav } = useAdminUi();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    // refresh() re-runs the Server Component layout so its session guard
    // re-evaluates and bounces the now-anonymous user out of /admin.
    router.push("/");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-stone-200/80 bg-white/80 px-4 backdrop-blur-md md:px-8">
      {/* Mobile nav trigger */}
      <button
        onClick={toggleMobileNav}
        aria-label="Open navigation"
        className="rounded-lg p-2 text-stone-600 transition-colors hover:bg-stone-100 lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="hidden flex-col leading-tight sm:flex">
        <span className="text-[11px] font-semibold uppercase tracking-[0.25em] text-primary">
          Control Room
        </span>
        <span className="font-serif text-lg font-medium text-stone-900">
          Dashboard
        </span>
      </div>

      {/* Right cluster */}
      <div className="ml-auto flex items-center gap-3">
        <div className="flex items-center gap-2.5">
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
          <div className="hidden flex-col leading-tight md:flex">
            <span className="max-w-[10rem] truncate text-sm font-medium text-stone-900">
              {user.name}
            </span>
            <span className="max-w-[10rem] truncate text-xs text-stone-400">
              {user.email}
            </span>
          </div>
        </div>

        <button
          onClick={handleSignOut}
          disabled={signingOut}
          className="flex items-center gap-2 rounded-full border border-stone-200 px-3.5 py-2 text-sm font-medium text-stone-700 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-60"
        >
          {signingOut ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LogOut className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">Sign Out</span>
        </button>
      </div>
    </header>
  );
}
