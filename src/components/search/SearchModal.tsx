"use client";

import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { ArrowRight, Loader2, Search, X } from "lucide-react";
import {
  searchCatalog,
  type SearchCatalogResult,
  type SearchResults,
  type SearchSuggestions,
} from "@/lib/actions/search";
import {
  normalizeSearchQuery,
  searchTokens,
  SEARCH_MAX_QUERY_LENGTH,
  SEARCH_MIN_QUERY_LENGTH,
} from "@/lib/validators";
import { cn } from "@/lib/utils";
import {
  CategoryOption,
  CategoryPill,
  Kbd,
  ProductOption,
  ResultsSkeleton,
  SearchEmptyState,
  SearchError,
  SearchSection,
  SuggestionsSkeleton,
  resultSections,
  suggestionSections,
  withOffsets,
  type SearchOption,
} from "@/components/search/SearchResults";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Quiet time after the last keystroke before a search leaves the browser. */
const SEARCH_DEBOUNCE_MS = 300;

/** Tab stops inside the panel — options are tabindex=-1 (arrow keys own them). */
const FOCUSABLE = 'input, button:not([disabled]), a[href]:not([tabindex="-1"])';

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
  /** Idle-state content, fetched and cached by the launcher (null until loaded). */
  suggestions: SearchSuggestions | null;
  isLoadingSuggestions: boolean;
}

/**
 * The search palette — a portal'd dialog over the storefront. Opening mounts a
 * fresh SearchDialog (empty query, focused input); closing plays the exit
 * animation and unmounts it, so every open starts clean.
 */
export default function SearchModal({ open, ...dialogProps }: SearchModalProps) {
  // Portal renders client-side only (no `document` during SSR). The palette is
  // closed on first paint, so there's nothing to hydrate-mismatch.
  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && <SearchDialog key="search-dialog" {...dialogProps} />}
    </AnimatePresence>,
    document.body,
  );
}

function SearchDialog({
  onClose,
  suggestions,
  isLoadingSuggestions,
}: Omit<SearchModalProps, "open">) {
  const router = useRouter();
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const optionId = (index: number) => `${baseId}-option-${index}`;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Flat index of the highlighted option (-1 = none) — see withOffsets.
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isSearching, startSearch] = useTransition();

  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Bumped on every keystroke: an answer whose id is no longer current is
  // dropped, so a slow response can never overwrite a newer query's list.
  const requestIdRef = useRef(0);
  // Answers fetched while this palette is open — backspacing over a query
  // never asks the server twice. Dies with the dialog on close.
  const cacheRef = useRef(new Map<string, SearchResults>());

  const term = normalizeSearchQuery(query);
  const isQuerying = term.length >= SEARCH_MIN_QUERY_LENGTH;
  // The list on screen answers an older query while a newer one is pending.
  const isStale = isQuerying && results !== null && results.query !== term;
  const showSpinner = isQuerying && isSearching && results?.query !== term;

  const sections = isQuerying
    ? error
      ? []
      : resultSections(results)
    : suggestionSections(suggestions);
  const options = sections.flatMap((section) => section.options);
  const active = activeIndex < options.length ? activeIndex : -1;
  // Emphasize the words the list on screen actually matched.
  const highlightTokens = isQuerying && results ? searchTokens(results.query) : [];

  const closeFromEffect = useEffectEvent(() => onClose());

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeFromEffect();
    }
    document.addEventListener("keydown", onKeyDown);

    // Lock page scroll, restoring whatever was there before — the cart drawer
    // and the mobile menu hold locks of their own.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      // Closing mid-debounce must not fire a search for a palette that's gone.
      clearTimeout(debounceRef.current);
      requestIdRef.current += 1;
    };
  }, []);

  function showResults(next: SearchResults) {
    setResults(next);
    setError(null);
    setActiveIndex(0); // Enter opens the best match
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    setError(null);
    clearTimeout(debounceRef.current);
    // Supersede whatever search is still in flight.
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    const next = normalizeSearchQuery(value);
    if (next.length < SEARCH_MIN_QUERY_LENGTH) {
      setResults(null);
      setActiveIndex(-1);
      return;
    }

    const cached = cacheRef.current.get(next);
    if (cached) {
      showResults(cached);
      return;
    }

    debounceRef.current = setTimeout(() => {
      startSearch(async () => {
        // A rejected call (network down, mid-deploy) isn't an action result —
        // degrade to the inline error instead of throwing to the error boundary.
        const result: SearchCatalogResult = await searchCatalog(next).catch(
          (err: unknown) => {
            console.error("search request failed:", err);
            return {
              success: false,
              error: "Couldn't reach the store. Check your connection and try again.",
            };
          },
        );
        if (result.success) cacheRef.current.set(next, result.data);
        // A newer keystroke owns the list now — drop this answer.
        if (requestId !== requestIdRef.current) return;
        if (result.success) showResults(result.data);
        else setError(result.error);
      });
    }, SEARCH_DEBOUNCE_MS);
  }

  function clearQuery() {
    handleQueryChange("");
    inputRef.current?.focus();
  }

  function moveActive(step: 1 | -1) {
    if (options.length === 0) return;
    const next =
      active === -1
        ? step === 1
          ? 0
          : options.length - 1
        : (active + step + options.length) % options.length;
    setActiveIndex(next);
    document.getElementById(optionId(next))?.scrollIntoView({ block: "nearest" });
  }

  function openOption(option: SearchOption) {
    router.push(option.href);
    onClose();
  }

  function handleInputKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    // Keys pressed mid-composition belong to the IME, not the palette.
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActive(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(-1);
    } else if (e.key === "Enter" && active !== -1) {
      e.preventDefault();
      openOption(options[active]);
    }
  }

  // Focus trap: Tab / Shift+Tab cycle through the panel's own controls.
  function handlePanelKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab" || !panelRef.current) return;
    const focusable = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter((el) => el.getClientRects().length > 0); // skip display:none controls
    if (focusable.length === 0) return;

    const current = focusable.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && current <= 0) {
      e.preventDefault();
      focusable[focusable.length - 1].focus();
    } else if (!e.shiftKey && (current === -1 || current === focusable.length - 1)) {
      e.preventDefault();
      focusable[0].focus();
    }
  }

  // Plain clicks close the palette; modified clicks open a new tab and leave it up.
  function handleLinkClick(e: ReactMouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    onClose();
  }

  // What fills the body when there's no list to show (yet).
  let placeholder: ReactNode = null;
  if (isQuerying) {
    if (error) placeholder = <SearchError message={error} />;
    else if (results === null) placeholder = <ResultsSkeleton />;
    else if (options.length === 0) {
      placeholder = (
        <div className={cn("transition-opacity duration-200", isStale && "opacity-60")}>
          <SearchEmptyState query={results.query} onNavigate={handleLinkClick} />
        </div>
      );
    }
  } else if (options.length === 0) {
    // Suggestions still loading, failed, or the catalog is empty.
    placeholder = isLoadingSuggestions ? (
      <SuggestionsSkeleton />
    ) : (
      <p className="px-3 py-10 text-center font-sans text-sm text-stone-400">
        Start typing to search our creations.
      </p>
    );
  }

  const resultCount = results ? results.products.length + results.categories.length : 0;
  const announcement =
    isQuerying && results !== null && !isStale
      ? resultCount === 0
        ? "No results"
        : `${resultCount} ${resultCount === 1 ? "result" : "results"} available`
      : "";

  return (
    <MotionConfig reducedMotion="user">
      <div className="fixed inset-0 z-[100] flex items-start justify-center px-3 pt-3 sm:px-6 sm:pt-[12vh]">
        {/* Backdrop */}
        <motion.div
          className="absolute inset-0 bg-stone-950/40 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onClick={onClose}
          aria-hidden="true"
        />

        {/* Panel */}
        <motion.div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Search the store"
          // Focusable so a click on the panel's chrome keeps focus inside it.
          tabIndex={-1}
          onKeyDown={handlePanelKeyDown}
          className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-[0_32px_80px_-16px_rgba(28,25,23,0.35)] outline-none ring-1 ring-stone-900/5 sm:max-h-[min(40rem,76dvh)]"
          initial={{ opacity: 0, scale: 0.96, y: -12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: -8 }}
          transition={{ duration: 0.3, ease: EASE }}
        >
          {/* ── Search field ─────────────────────────────── */}
          <div className="flex items-center gap-3 border-b border-stone-100 px-4 py-3.5 sm:px-5 sm:py-4">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
              {showSpinner ? (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              ) : (
                <Search className="h-5 w-5 text-stone-400" />
              )}
            </span>

            <input
              ref={inputRef}
              // The palette exists to be typed into — focus lands here on open.
              autoFocus
              type="text"
              role="combobox"
              aria-label="Search products and categories"
              aria-expanded={options.length > 0}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={active === -1 ? undefined : optionId(active)}
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              onKeyDown={handleInputKeyDown}
              maxLength={SEARCH_MAX_QUERY_LENGTH}
              placeholder="Search creations & categories…"
              dir="auto"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent font-sans text-base text-stone-900 outline-none placeholder:text-stone-400 sm:text-lg"
            />

            {query && (
              <button
                type="button"
                onClick={clearQuery}
                aria-label="Clear search"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-500 transition-colors hover:bg-stone-200 hover:text-stone-800"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}

            {/* Close — a keycap on desktop, a word on touch screens (no Esc key). */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Esc, close search"
              className="hidden shrink-0 rounded-md border border-stone-200 px-1.5 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-wider text-stone-400 transition-colors hover:border-stone-300 hover:text-stone-600 sm:inline-flex"
            >
              Esc
            </button>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 font-sans text-sm font-medium text-stone-500 transition-colors hover:text-stone-800 sm:hidden"
            >
              Cancel
            </button>
          </div>

          {/* ── Results ──────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto overscroll-contain px-2 py-2 sm:px-3">
            <p role="status" aria-live="polite" className="sr-only">
              {announcement}
            </p>

            {placeholder}

            <div
              role="listbox"
              id={listboxId}
              aria-label={isQuerying ? "Search results" : "Suggestions"}
              aria-busy={isStale}
              hidden={options.length === 0}
              className={cn("transition-opacity duration-200", isStale && "opacity-60")}
            >
              {withOffsets(sections).map(({ section, offset }) => (
                <SearchSection
                  key={section.key}
                  id={`${baseId}-${section.key}`}
                  label={section.label}
                  layout={section.layout}
                >
                  {section.options.map((option, i) => {
                    const index = offset + i;
                    const optionProps = {
                      id: optionId(index),
                      href: option.href,
                      active: index === active,
                      onActivate: () => setActiveIndex(index),
                      onNavigate: handleLinkClick,
                    };
                    if (option.kind === "product") {
                      return (
                        <ProductOption
                          key={option.key}
                          {...optionProps}
                          hit={option.hit}
                          tokens={highlightTokens}
                        />
                      );
                    }
                    return section.layout === "pills" ? (
                      <CategoryPill key={option.key} {...optionProps} hit={option.hit} />
                    ) : (
                      <CategoryOption
                        key={option.key}
                        {...optionProps}
                        hit={option.hit}
                        tokens={highlightTokens}
                      />
                    );
                  })}
                </SearchSection>
              ))}
            </div>
          </div>

          {/* ── Footer ───────────────────────────────────── */}
          <div className="flex items-center justify-between gap-4 border-t border-stone-100 bg-stone-50/80 px-4 py-2.5 sm:px-5">
            <div
              className="hidden items-center gap-4 font-sans text-[11px] text-stone-400 sm:flex"
              aria-hidden="true"
            >
              <span className="flex items-center gap-1.5">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
                navigate
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>↵</Kbd>
                open
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>esc</Kbd>
                close
              </span>
            </div>

            <Link
              href="/new-arrivals"
              onClick={handleLinkClick}
              className="group ml-auto inline-flex items-center gap-1.5 font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500 transition-colors hover:text-primary"
            >
              All categories
              <ArrowRight
                className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
          </div>
        </motion.div>
      </div>
    </MotionConfig>
  );
}
