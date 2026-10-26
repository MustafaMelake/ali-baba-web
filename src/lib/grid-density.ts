// ─────────────────────────────────────────────────────────────────────────────
// Product-grid density on phones — "2 per row" (default) or "1 per row".
//
// The cached storefront HTML is identical for every visitor, so the choice
// can't be server-rendered. Instead it lives on `<html data-grid="1|2">`:
//   • GRID_DENSITY_SCRIPT runs inline in the root layout's <head>, before the
//     first paint, and copies the saved choice from localStorage onto <html>;
//   • CSS reads the attribute (the `grid-1up:` / `grid-2up:` variants in
//     globals.css), so the column count and the compact card never pass
//     through React state — no flash, no layout shift;
//   • the toggle island only calls `setGridDensity`.
// No attribute (first visit, storage blocked) means the default, 2-up.
//
// Plain module — imported by the root layout (the script string) and the
// client toggle. Every storage touch is wrapped: a private window or blocked
// site data must never break a page.
// ─────────────────────────────────────────────────────────────────────────────

export type GridDensity = "1" | "2";

/** localStorage key of the visitor's choice — shared by every tab of the site. */
export const GRID_DENSITY_STORAGE_KEY = "ali-baba-grid-density";

/**
 * The pre-paint script: saved "1"/"2" → `<html data-grid>`. Anything else
 * (nothing saved, junk, storage throwing) leaves the attribute off = 2-up.
 */
export const GRID_DENSITY_SCRIPT = `try{var d=localStorage.getItem(${JSON.stringify(
  GRID_DENSITY_STORAGE_KEY,
)});if(d==="1"||d==="2")document.documentElement.setAttribute("data-grid",d)}catch(e){}`;

/** The density on screen right now — read off `<html>`, the one source of truth. */
export function readGridDensity(): GridDensity {
  return document.documentElement.getAttribute("data-grid") === "1" ? "1" : "2";
}

const listeners = new Set<() => void>();

/** For `useSyncExternalStore`: notified whenever `setGridDensity` runs. */
export function subscribeGridDensity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Apply a density on this page and remember it for the next one. */
export function setGridDensity(density: GridDensity): void {
  document.documentElement.setAttribute("data-grid", density);
  try {
    window.localStorage.setItem(GRID_DENSITY_STORAGE_KEY, density);
  } catch {
    // Storage blocked — the choice still holds for this page.
  }
  for (const listener of listeners) listener();
}

/**
 * The phone-width column classes every product grid starts from — 2-up by
 * default, 1-up when chosen — plus `data-product-grid` on the element, which
 * scopes the compact card styles to cards inside a grid. Each grid appends its
 * own `sm:`/`lg:`/`xl:` columns and gaps; from `sm` up the attribute changes
 * nothing.
 */
export const PRODUCT_GRID_PHONE = "grid-cols-2 gap-x-4 gap-y-10 grid-1up:grid-cols-1";
