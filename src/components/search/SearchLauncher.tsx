"use client";

import { useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { getSearchSuggestions, type SearchSuggestions } from "@/lib/actions/search";
import SearchModal from "@/components/search/SearchModal";

/**
 * How long fetched suggestions are trusted. The Navbar lives for the whole
 * visit, so without a bound its suggestion prices could drift from the
 * catalog; one minute is the freshness the ISR catalog pages already promise.
 * Past it they're dropped, not shown while revalidating.
 */
const SUGGESTIONS_TTL_MS = 60_000;

/**
 * The Navbar's entry point to the search palette: the icon button, the
 * ⌘K / Ctrl+K shortcut, and the suggestions cache that outlives each
 * open/close of the dialog.
 */
export default function SearchLauncher({ onOpen }: { onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<SearchSuggestions | null>(null);
  const [isLoadingSuggestions, startLoadingSuggestions] = useTransition();
  const fetchedAtRef = useRef(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Idempotent within the TTL — hover, focus and open all call it, so the
  // suggestions are usually in hand before the palette even opens.
  function loadSuggestions() {
    const now = Date.now();
    if (now - fetchedAtRef.current < SUGGESTIONS_TTL_MS) return;
    fetchedAtRef.current = now;
    // Expired prices are no longer trusted: show the skeleton until fresh
    // ones land, rather than flash — or, if the refetch fails, keep — them.
    setSuggestions(null);

    startLoadingSuggestions(async () => {
      // A rejected call (network down) isn't an action result — keep the
      // palette usable instead of throwing to the error boundary.
      const result = await getSearchSuggestions().catch((err: unknown) => {
        console.error("search suggestions request failed:", err);
        return null;
      });
      if (result?.success) setSuggestions(result.data);
      else fetchedAtRef.current = 0; // let the next intent retry
    });
  }

  function openSearch() {
    // Remember who had focus so closing can hand it back (WAI-ARIA dialog).
    const focused = document.activeElement;
    returnFocusRef.current =
      focused instanceof HTMLElement && focused !== document.body ? focused : null;
    loadSuggestions();
    onOpen?.();
    setOpen(true);
  }

  function closeSearch() {
    setOpen(false);
    // preventScroll: after a result click the page is already navigating away.
    (returnFocusRef.current ?? triggerRef.current)?.focus({ preventScroll: true });
  }

  // Effect events always see the latest `open` without re-subscribing.
  const onShortcut = useEffectEvent(() => {
    if (open) closeSearch();
    else openSearch();
  });

  // ⌘K / Ctrl+K toggles the palette from anywhere on the storefront.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // `code` keeps the shortcut on the physical K key under an Arabic layout.
      const isK = e.code === "KeyK" || e.key === "k" || e.key === "K";
      if (!isK || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      e.preventDefault();
      onShortcut();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openSearch}
        onPointerEnter={loadSuggestions}
        onFocus={loadSuggestions}
        aria-label="Search the store"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts="Meta+K Control+K"
        className="relative flex items-center justify-center w-10 h-10 md:w-11 md:h-11 rounded-full text-foreground hover:bg-stone-100 transition-colors"
      >
        <Search className="w-5 h-5" />
      </button>

      <SearchModal
        open={open}
        onClose={closeSearch}
        suggestions={suggestions}
        isLoadingSuggestions={isLoadingSuggestions}
      />
    </>
  );
}
