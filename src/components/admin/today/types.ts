// Serialized shapes the /admin/today server page hands its client islands.
// Prices are plain numbers (Decimal coerced server-side) and every variant
// carries its resolved availability at the manager's branch, computed once from
// the single request `now`.

/**
 *  - "available"        — orderable; the manager can sell it out today.
 *  - "sold_out_today"   — the manager marked it out; comes back at midnight.
 *  - "off"              — switched off long-term (head office / branch): not the
 *                         manager's to flip here, shown disabled.
 */
export type TodayVariantState = "available" | "sold_out_today" | "off";

export type TodaySize = {
  id: string;
  name: string;
  price: number;
  state: TodayVariantState;
};

export type TodayProduct = {
  id: string;
  name: string;
  image: string | null;
  category: string;
  sizes: TodaySize[];
};
