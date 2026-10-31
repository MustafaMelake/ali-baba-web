// ─────────────────────────────────────────────────────────────────────────────
// Copy table for the manager "Today" page (src/app/admin/today).
//
// Kept out of the markup so the page can go bilingual later with a `dir` flip
// and a second table — no i18n framework yet, so we don't build one (mirrors
// HERO_COPY). English only for now; Arabic lands alongside, keyed the same.
// ─────────────────────────────────────────────────────────────────────────────

export const TODAY_COPY = {
  eyebrow: "Branch",
  title: "Today",
  /** Shown under the title; names the manager's own branch. */
  description: (branch: string) =>
    `Mark what ${branch} has run out of today. It comes back automatically at midnight — no need to switch anything back on.`,
  autoReturn: "Comes back automatically at midnight.",

  searchPlaceholder: "Search a product, size or SKU…",
  searchLabel: "Search products",

  soldOutNowTitle: "Sold out right now",
  soldOutNowEmpty: "Nothing is sold out today — everything your branch lists can be ordered.",
  backInStock: "Back in stock",

  markSoldOut: "Sold out today",
  bringBack: "Available again",
  sizesExpand: "Per size",
  headOfficeOff: "Off — set by head office",

  noProducts: "No products are live yet.",
  noMatches: (query: string) => `No items match “${query}”.`,

  // Toasts (sonner).
  toastMarked: (name: string) => `${name} — sold out today`,
  toastCleared: (name: string) => `${name} — back in stock`,
} as const;
