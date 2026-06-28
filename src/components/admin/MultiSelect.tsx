"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type MultiSelectOption = {
  value: string;
  label: string;
  /** Secondary muted text shown under the label (e.g. a price or variant count). */
  hint?: string;
};

/**
 * Searchable, chip-backed multi-select dropdown built to match the admin
 * aesthetic. The open panel renders IN FLOW (not absolutely positioned) so it
 * can never be clipped by the modal's scrollable body — it simply pushes the
 * fields below it down while open.
 */
export default function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No options.",
}: {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const selectedSet = new Set(selected);
  const selectedOptions = options.filter((o) => selectedSet.has(o.value));

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q),
      )
    : options;

  function toggle(value: string) {
    onChange(
      selectedSet.has(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  }

  return (
    <div ref={ref}>
      {/* Control */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-left text-sm text-stone-900 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
      >
        <span className={cn("truncate", selectedOptions.length === 0 && "text-stone-400")}>
          {selectedOptions.length === 0
            ? placeholder
            : `${selectedOptions.length} selected`}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-stone-400" />
      </button>

      {/* Selected chips */}
      {selectedOptions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selectedOptions.map((o) => (
            <span
              key={o.value}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
            >
              <span className="max-w-[14rem] truncate">{o.label}</span>
              <button
                type="button"
                onClick={() => toggle(o.value)}
                aria-label={`Remove ${o.label}`}
                className="text-primary/70 transition-colors hover:text-primary"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Dropdown panel (in-flow) */}
      {open && (
        <div className="mt-2 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-stone-100 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-stone-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent text-sm text-stone-900 outline-none placeholder:text-stone-400"
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-stone-400">{emptyText}</p>
            ) : (
              filtered.map((o) => {
                const isSelected = selectedSet.has(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => toggle(o.value)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-stone-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-stone-800">
                        {o.label}
                      </span>
                      {o.hint && (
                        <span className="block truncate text-xs text-stone-400">
                          {o.hint}
                        </span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                        isSelected
                          ? "border-primary bg-primary text-white"
                          : "border-stone-300",
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
