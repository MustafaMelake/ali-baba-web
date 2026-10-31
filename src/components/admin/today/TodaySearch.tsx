"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { TODAY_COPY } from "@/lib/today-copy";

/**
 * Debounced search box for the Today page. URL-as-state: it writes `?q=` (and
 * drops `?page=` on a new query), so the server re-queries and the result is
 * bookmarkable and refresh-proof. Must sit under <Suspense> (reads
 * useSearchParams).
 */
export default function TodaySearch() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [value, setValue] = useState(searchParams.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the field in sync if the URL changes from elsewhere (e.g. back button).
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- mirror the URL */
    setValue(searchParams.get("q") ?? "");
  }, [searchParams]);

  function commit(next: string) {
    const params = new URLSearchParams(searchParams);
    if (next.trim()) params.set("q", next.trim());
    else params.delete("q");
    params.delete("page"); // a new search starts at page 1
    startTransition(() => {
      router.push(`${pathname}?${params}`, { scroll: false });
    });
  }

  function onChange(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(next), 400);
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-stone-400" />
      <input
        type="search"
        inputMode="search"
        aria-label={TODAY_COPY.searchLabel}
        placeholder={TODAY_COPY.searchPlaceholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-full border border-stone-200 bg-white py-3 ps-10 pe-10 text-sm text-stone-900 shadow-sm outline-none transition-colors placeholder:text-stone-400 focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
      {isPending && (
        <Loader2 className="absolute inset-y-0 end-3 my-auto h-4 w-4 animate-spin text-stone-400" />
      )}
    </div>
  );
}
