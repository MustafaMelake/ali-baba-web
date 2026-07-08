import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import {
  mergeCartAction,
  syncCartItemAction,
  getDbCartAction,
  rePriceGuestCart,
} from "@/lib/actions/cart";
import { CHECKOUT_MAX_QUANTITY } from "@/lib/validators";

export interface CartItem {
  /**
   * Parent product id — kept for display, grouping, and PDP links only.
   * NEVER used as the merge/lookup key (see why on `variantId` below).
   */
  id: string;
  /**
   * The purchasable unit, and the canonical identity of a cart line. A product
   * sold in several variants ("Small" / "Large") yields one line per variant,
   * never a single merged line. This is also the value `placeOrder()` re-prices
   * server-side, so it must stay 1:1 with what the customer actually chose.
   */
  variantId: string;
  name: string;
  price: number; // local display currency (EGP); the server re-resolves the real price at checkout
  quantity: number;
  image: string;
  category?: string;
}

interface CartState {
  items: CartItem[];
  isOpen: boolean;

  // Drawer
  openCart: () => void;
  closeCart: () => void;
  toggleCart: () => void;

  // Items — all keyed by `variantId`, never the product `id`.
  // `isLoggedIn` is supplied by the caller (from Better Auth's session). When
  // true, the local optimistic update is mirrored to the DB in the background.
  /**
   * Adds `item.quantity` units (default 1) in ONE update + ONE background
   * sync. The resulting line is clamped to CHECKOUT_MAX_QUANTITY — the same
   * ceiling `checkoutSchema` and the DB cart enforce, so no UI path can build
   * a cart the server would reject.
   */
  addItem: (
    item: Omit<CartItem, "quantity"> & { quantity?: number },
    isLoggedIn?: boolean,
  ) => void;
  removeItem: (variantId: string, isLoggedIn?: boolean) => void;
  updateQuantity: (
    variantId: string,
    quantity: number,
    isLoggedIn?: boolean,
  ) => void;

  /** Local-only empty (used by checkout / the "Clear cart" button). */
  clearCart: () => void;
  /**
   * LOGOUT-only wipe. Clears the in-memory + persisted (localStorage) cart so
   * the next user on this device starts clean — but deliberately NEVER touches
   * the database, so the signed-out user's saved cart survives for their next
   * sign-in / other devices.
   */
  clearLocalCart: () => void;

  /**
   * Guest → authenticated bridge. Pushes the current local cart to the DB
   * (server SUMs onto any existing rows), then replaces local state with the
   * freshly-merged, live-priced DB cart as the single source of truth.
   */
  mergeAndSyncCart: () => Promise<void>;

  /**
   * GUEST price refresh. A guest cart is frozen in localStorage, so a promo
   * that started/expired since an item was added leaves a stale display price
   * (placeOrder would still bill the live one). This re-reads every line's
   * current price from the catalogue and updates only the lines that changed.
   * Logged-in carts never need it — hydrate/merge already re-price from the DB.
   * Returns how many lines changed so callers can tell the customer.
   */
  refreshPrices: () => Promise<{ updated: number }>;

  // Derived (computed inline)
  totalItems: () => number;
  totalPrice: () => number;
}

/**
 * Fire-and-forget persistence of a single line to the DB. The `.catch` only
 * guards against an unexpected throw (network/serialization) becoming an
 * unhandled rejection — the optimistic local state has already been applied,
 * and the next `mergeAndSyncCart`/hydrate reconciles any divergence.
 */
function fireSync(
  variantId: string,
  quantity: number,
  actionType: "SET" | "DELETE",
) {
  void syncCartItemAction(variantId, quantity, actionType).catch((err) => {
    console.error("cart sync failed:", err);
  });
}

/**
 * Inert storage used only when there is no `window` (server render / prerender).
 * It reads as empty and discards writes, which is exactly what we want on the
 * server: nothing to rehydrate, nothing to persist. Its real purpose is to keep
 * zustand's persist middleware from bailing out early so the `.persist` API stays
 * attached on the server too (see the `storage` option below).
 */
const SERVER_NOOP_STORAGE: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      isOpen: false,

      openCart: () => set({ isOpen: true }),
      closeCart: () => set({ isOpen: false }),
      toggleCart: () => set((s) => ({ isOpen: !s.isOpen })),

      // A line is identified by `variantId`. Merging by product `id` (the old bug)
      // would stack a "Large" onto an existing "Small" line — incrementing its
      // quantity while keeping the Small's variantId and price, so checkout would
      // charge the Small price for both. Keying on variantId keeps each chosen
      // variant a distinct, correctly-priced line.
      addItem: (newItem, isLoggedIn) => {
        // Amount to add this call — a whole number, at least 1.
        const amount = Math.max(1, Math.floor(newItem.quantity ?? 1));

        // Derive the resulting quantity first so we can both update locally and
        // send an absolute SET to the server (idempotent — beats increment
        // races). Clamped to the shared per-line ceiling: growing past it
        // silently caps at the max instead of building an unsubmittable cart.
        const existing = get().items.find(
          (i) => i.variantId === newItem.variantId,
        );
        const newQuantity = Math.min(
          (existing?.quantity ?? 0) + amount,
          CHECKOUT_MAX_QUANTITY,
        );

        set((s) => ({
          items: existing
            ? s.items.map((i) =>
                i.variantId === newItem.variantId
                  ? { ...i, quantity: newQuantity }
                  : i,
              )
            : [...s.items, { ...newItem, quantity: newQuantity }],
          isOpen: true, // open the drawer on add
        }));

        if (isLoggedIn) fireSync(newItem.variantId, newQuantity, "SET");
      },

      removeItem: (variantId, isLoggedIn) => {
        set((s) => ({
          items: s.items.filter((i) => i.variantId !== variantId),
        }));

        if (isLoggedIn) fireSync(variantId, 0, "DELETE");
      },

      updateQuantity: (variantId, quantity, isLoggedIn) => {
        // Below 1 is a removal — delegate so the DELETE sync path is shared.
        if (quantity < 1) {
          get().removeItem(variantId, isLoggedIn);
          return;
        }

        // Same shared ceiling as addItem / checkoutSchema / the DB cart.
        const clamped = Math.min(Math.floor(quantity), CHECKOUT_MAX_QUANTITY);

        set((s) => ({
          items: s.items.map((i) =>
            i.variantId === variantId ? { ...i, quantity: clamped } : i,
          ),
        }));

        if (isLoggedIn) fireSync(variantId, clamped, "SET");
      },

      clearCart: () => set({ items: [] }),

      clearLocalCart: () => set({ items: [], isOpen: false }),

      mergeAndSyncCart: async () => {
        const localLines = get()
          .items.map((i) => ({ variantId: i.variantId, quantity: i.quantity }))
          .filter((l) => l.quantity > 0);

        // 1) Merge the guest cart up (server sums onto existing DB rows). On
        //    failure we keep the local cart untouched so the user loses nothing.
        if (localLines.length > 0) {
          const merged = await mergeCartAction(localLines);
          if (!merged.success) {
            console.error("mergeAndSyncCart: merge failed —", merged.error);
            return;
          }
        }

        // 2) Adopt the DB cart wholesale: live prices/names/images, server truth.
        const dbCart = await getDbCartAction();
        if (dbCart.success) {
          set({ items: dbCart.data });
        } else {
          console.error("mergeAndSyncCart: fetch failed —", dbCart.error);
        }
      },

      refreshPrices: async () => {
        const variantIds = get().items.map((i) => i.variantId);
        if (variantIds.length === 0) return { updated: 0 };

        const res = await rePriceGuestCart(variantIds);
        if (!res.success) {
          // Non-fatal: the stale price stays on screen, and placeOrder still
          // bills the live price — the next refresh reconciles the display.
          console.error("refreshPrices failed:", res.error);
          return { updated: 0 };
        }

        const liveById = new Map(res.data.map((v) => [v.variantId, v]));

        // Re-read items AFTER the round-trip: lines the user added/removed
        // meanwhile are preserved untouched (a just-added line is current by
        // definition; a line missing from the response — deleted variant —
        // is left alone for placeOrder's availability guard to report).
        let updated = 0;
        const next = get().items.map((item) => {
          const live = liveById.get(item.variantId);
          if (!live || live.price === item.price) return item;
          updated++;
          return { ...item, price: live.price };
        });

        if (updated > 0) set({ items: next });
        return { updated };
      },

      totalItems: () => get().items.reduce((sum, i) => sum + i.quantity, 0),
      totalPrice: () =>
        get().items.reduce((sum, i) => sum + i.price * i.quantity, 0),
    }),
    {
      name: "ali-baba-cart",
      // SSR-safe storage. The default (`createJSONStorage(() => window.localStorage)`)
      // THROWS on the server (no `window`), which makes zustand's persist middleware
      // bail out *before* it attaches the `.persist` API to the store. The checkout
      // page reads `useCartStore.persist.onFinishHydration` during render, so a missing
      // `.persist` crashes any server render/prerender of that page. Falling back to a
      // no-op storage on the server keeps `createJSONStorage` returning a valid wrapper,
      // so `.persist` is always attached; on the client it resolves to the real
      // localStorage and rehydrates from it exactly as before.
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : SERVER_NOOP_STORAGE,
      ),
      // Persist ONLY the items — never UI state (isOpen) or session-derived data.
      // Keeping nothing session-specific in storage avoids stale auth across
      // users on a shared device and keeps SSR/CSR first paint identical
      // (no hydration mismatch): the server renders `items: []`, then the
      // client rehydrates from localStorage after mount, exactly as before.
      partialize: (s) => ({ items: s.items }),
    },
  ),
);
