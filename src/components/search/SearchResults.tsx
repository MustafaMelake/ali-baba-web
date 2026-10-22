"use client";

import { Fragment, type MouseEvent, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, LayoutGrid, SearchX } from "lucide-react";
import type {
  SearchCategoryHit,
  SearchProductHit,
  SearchResults,
  SearchSuggestions,
} from "@/lib/actions/search";
import { formatMoney } from "@/lib/utils";

// ─── Option model ────────────────────────────────────────────────────────────
// The palette's listbox is one flat index space walked by the arrow keys;
// sections only group it visually (and for screen readers).

export type SearchOption =
  | { kind: "product"; key: string; href: string; hit: SearchProductHit }
  | { kind: "category"; key: string; href: string; hit: SearchCategoryHit };

export interface SearchSectionModel {
  key: string;
  label: string;
  layout: "rows" | "pills";
  options: SearchOption[];
}

function productOption(hit: SearchProductHit): SearchOption {
  return { kind: "product", key: `product-${hit.id}`, href: `/product/${hit.slug}`, hit };
}

function categoryOption(hit: SearchCategoryHit): SearchOption {
  return { kind: "category", key: `category-${hit.id}`, href: `/category/${hit.slug}`, hit };
}

/** Result groups for a query, in arrow-key order. Empty groups drop out. */
export function resultSections(results: SearchResults | null): SearchSectionModel[] {
  if (!results) return [];
  const sections: SearchSectionModel[] = [
    { key: "products", label: "Products", layout: "rows", options: results.products.map(productOption) },
    { key: "categories", label: "Categories", layout: "rows", options: results.categories.map(categoryOption) },
  ];
  return sections.filter((section) => section.options.length > 0);
}

/** The idle palette: category pills to jump straight in, then the newest arrivals. */
export function suggestionSections(suggestions: SearchSuggestions | null): SearchSectionModel[] {
  if (!suggestions) return [];
  const sections: SearchSectionModel[] = [
    { key: "browse", label: "Browse categories", layout: "pills", options: suggestions.categories.map(categoryOption) },
    { key: "latest", label: "Latest arrivals", layout: "rows", options: suggestions.products.map(productOption) },
  ];
  return sections.filter((section) => section.options.length > 0);
}

/** Pairs each section with the flat index of its first option. */
export function withOffsets(sections: SearchSectionModel[]) {
  let offset = 0;
  return sections.map((section) => {
    const entry = { section, offset };
    offset += section.options.length;
    return entry;
  });
}

// ─── Match highlighting ──────────────────────────────────────────────────────

/** Splits `text` into plain and matched runs (first hit of each query word). */
function highlightSegments(text: string, tokens: string[]) {
  const lower = text.toLocaleLowerCase();
  // Lowercasing changes the length of a few characters (e.g. "İ") — skip the
  // highlight rather than mis-slice the name.
  if (tokens.length === 0 || lower.length !== text.length) return [{ text, match: false }];

  const ranges: Array<[number, number]> = [];
  for (const token of tokens) {
    const needle = token.toLocaleLowerCase();
    const start = lower.indexOf(needle);
    if (start !== -1) ranges.push([start, start + needle.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);

  const segments: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (end <= cursor) continue; // fully inside an earlier match
    const from = Math.max(start, cursor);
    if (from > cursor) segments.push({ text: text.slice(cursor, from), match: false });
    segments.push({ text: text.slice(from, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}

function Highlight({ text, tokens }: { text: string; tokens: string[] }) {
  return (
    <>
      {highlightSegments(text, tokens).map((segment, i) =>
        segment.match ? (
          <mark key={i} className="bg-transparent text-primary">
            {segment.text}
          </mark>
        ) : (
          <Fragment key={i}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}

// ─── Options ─────────────────────────────────────────────────────────────────

interface OptionProps {
  id: string;
  href: string;
  active: boolean;
  /** The pointer moved onto the option — make it the active one. */
  onActivate: () => void;
  /** The option's link was clicked (plain clicks close the palette). */
  onNavigate: (e: MouseEvent<HTMLAnchorElement>) => void;
}

const ROW_CLASS =
  "group flex items-center gap-3.5 rounded-xl px-3 py-2.5 transition-colors duration-150 aria-selected:bg-stone-100/80 sm:gap-4";

function OptionLink({
  id,
  href,
  active,
  onActivate,
  onNavigate,
  className,
  children,
}: OptionProps & { className: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      // Results change per keystroke — don't prefetch every PDP they flash past.
      prefetch={false}
      id={id}
      role="option"
      aria-selected={active}
      tabIndex={-1}
      // Keep focus (and the caret) in the search input; the click still navigates.
      onMouseDown={(e) => e.preventDefault()}
      // mousemove, not mouseenter: a list scrolling under a resting pointer
      // must not steal the keyboard's selection.
      onMouseMove={active ? undefined : onActivate}
      onClick={onNavigate}
      className={className}
    >
      {children}
    </Link>
  );
}

export function ProductOption({
  hit,
  tokens,
  ...option
}: OptionProps & { hit: SearchProductHit; tokens: string[] }) {
  // A promotion is on when the "was" price is strictly above the selling price.
  const wasPrice =
    hit.compareAtPrice != null && hit.compareAtPrice > hit.price ? hit.compareAtPrice : null;

  return (
    <OptionLink {...option} className={ROW_CLASS}>
      <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-stone-100 ring-1 ring-stone-900/5">
        <Image src={hit.image} alt="" fill sizes="56px" className="object-cover" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="inline-block max-w-full truncate rounded-full bg-stone-100 px-2 py-0.5 align-top font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500 transition-colors duration-150 group-aria-selected:bg-white">
          {hit.category}
        </span>
        <span
          dir="auto"
          className="mt-1 block truncate font-serif text-[15px] font-medium leading-snug text-stone-900"
        >
          <Highlight text={hit.name} tokens={tokens} />
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end">
        <span className="font-serif text-[15px] font-medium tabular-nums text-stone-900">
          {formatMoney(hit.price)}
          <span className="ml-1 font-sans text-[11px] font-normal text-stone-400">ج.م</span>
        </span>
        {wasPrice !== null && (
          <span className="font-sans text-[11px] tabular-nums text-stone-400 line-through">
            <span className="sr-only">Was </span>
            {formatMoney(wasPrice)}
          </span>
        )}
      </span>
    </OptionLink>
  );
}

export function CategoryOption({
  hit,
  tokens,
  ...option
}: OptionProps & { hit: SearchCategoryHit; tokens: string[] }) {
  return (
    <OptionLink {...option} className={ROW_CLASS}>
      <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-stone-100 ring-1 ring-stone-900/5">
        {hit.image ? (
          <Image src={hit.image} alt="" fill sizes="44px" className="object-cover" />
        ) : (
          <LayoutGrid className="h-4 w-4 text-stone-400" aria-hidden="true" />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span
          dir="auto"
          className="block truncate font-serif text-[15px] font-medium leading-snug text-stone-900"
        >
          <Highlight text={hit.name} tokens={tokens} />
        </span>
        <span className="mt-0.5 block font-sans text-xs tabular-nums text-stone-400">
          {hit.productCount} {hit.productCount === 1 ? "creation" : "creations"}
        </span>
      </span>

      <ArrowUpRight
        className="h-4 w-4 shrink-0 text-stone-300 transition-colors duration-150 group-aria-selected:text-primary"
        aria-hidden="true"
      />
    </OptionLink>
  );
}

export function CategoryPill({ hit, ...option }: OptionProps & { hit: SearchCategoryHit }) {
  return (
    <OptionLink
      {...option}
      className="inline-flex items-center rounded-full border border-stone-200 bg-white px-4 py-2 font-sans text-[13px] font-medium text-stone-600 transition-colors duration-150 aria-selected:border-primary aria-selected:bg-primary/5 aria-selected:text-primary"
    >
      <span dir="auto">{hit.name}</span>
    </OptionLink>
  );
}

// ─── Layout pieces ───────────────────────────────────────────────────────────

/**
 * One labelled group inside the listbox. The visible heading is aria-hidden
 * and names the `group` instead — a listbox may only contain options/groups.
 */
export function SearchSection({
  id,
  label,
  layout,
  children,
}: {
  id: string;
  label: string;
  layout: "rows" | "pills";
  children: ReactNode;
}) {
  return (
    <div role="presentation" className="py-1.5">
      <div
        id={id}
        aria-hidden="true"
        className="px-3 pb-2 pt-2 font-sans text-[10px] font-semibold uppercase tracking-[0.28em] text-stone-400"
      >
        {label}
      </div>
      <div
        role="group"
        aria-labelledby={id}
        className={layout === "pills" ? "flex flex-wrap gap-2 px-3 pb-2" : "flex flex-col gap-0.5"}
      >
        {children}
      </div>
    </div>
  );
}

function RowSkeletons({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-3 py-2.5">
          <div className="h-14 w-14 shrink-0 rounded-xl bg-stone-100" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-16 rounded-full bg-stone-100" />
            <div className="h-4 w-2/3 rounded-full bg-stone-100" />
          </div>
          <div className="h-4 w-14 rounded-full bg-stone-100" />
        </div>
      ))}
    </div>
  );
}

const PILL_SKELETON_WIDTHS = ["w-20", "w-28", "w-16", "w-24", "w-32"];

export function SuggestionsSkeleton() {
  return (
    <div className="animate-pulse py-1.5" aria-hidden="true">
      <div className="mx-3 mb-3 mt-2 h-2.5 w-32 rounded-full bg-stone-100" />
      <div className="flex flex-wrap gap-2 px-3 pb-2">
        {PILL_SKELETON_WIDTHS.map((width) => (
          <div key={width} className={`h-9 rounded-full bg-stone-100 ${width}`} />
        ))}
      </div>
      <div className="mx-3 mb-3 mt-5 h-2.5 w-24 rounded-full bg-stone-100" />
      <RowSkeletons count={3} />
    </div>
  );
}

export function ResultsSkeleton() {
  return (
    <div className="animate-pulse py-1.5" aria-hidden="true">
      <div className="mx-3 mb-3 mt-2 h-2.5 w-20 rounded-full bg-stone-100" />
      <RowSkeletons count={4} />
    </div>
  );
}

export function SearchEmptyState({
  query,
  onNavigate,
}: {
  query: string;
  onNavigate: (e: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-stone-100">
        <SearchX className="h-6 w-6 text-stone-300" strokeWidth={1.5} aria-hidden="true" />
      </span>
      <p className="font-serif text-xl font-medium tracking-tight text-stone-800">
        No items found matching your search
      </p>
      <p className="mt-2 max-w-xs font-sans text-sm leading-relaxed text-stone-400">
        Nothing matches &ldquo;
        <span dir="auto" className="text-stone-600">
          {query}
        </span>
        &rdquo;. Try another word, or browse every category.
      </p>
      <Link
        href="/new-arrivals"
        onClick={onNavigate}
        className="group mt-7 inline-flex items-center gap-2 rounded-full border border-stone-200 px-5 py-2.5 font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-700 transition-colors hover:border-primary hover:text-primary"
      >
        Browse all categories
        <ArrowRight
          className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </Link>
    </div>
  );
}

export function SearchError({ message }: { message: string }) {
  return (
    <div role="alert" className="px-6 py-12 text-center">
      <p className="font-serif text-lg font-medium text-stone-800">Something went wrong</p>
      <p className="mt-2 font-sans text-sm text-stone-400">{message}</p>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-stone-200 bg-white px-1 font-sans text-[10px] font-semibold text-stone-500 shadow-[0_1px_0_rgba(28,25,23,0.06)]">
      {children}
    </kbd>
  );
}
