// ─────────────────────────────────────────────────────────────────────────────
// Branch colour palette — one stable colour per branch, shared by every
// analytics surface (bar chart, line chart, top-product cards) so a branch
// reads as the same hue everywhere on the dashboard.
//
// The leading colour is the brand turquoise (--ali-turquoise / text-primary);
// the rest are a hand-picked enterprise palette with enough contrast to stay
// legible when several branches sit side by side.
// ─────────────────────────────────────────────────────────────────────────────

export const BRANCH_COLORS = [
  "#198b9e", // brand turquoise
  "#d97706", // amber
  "#7c3aed", // violet
  "#059669", // emerald
  "#e11d48", // rose
  "#2563eb", // blue
  "#0891b2", // cyan
  "#ca8a04", // gold
] as const;

/** Deterministic colour for the i-th branch (wraps if there are many branches). */
export function branchColor(index: number): string {
  return BRANCH_COLORS[index % BRANCH_COLORS.length];
}
