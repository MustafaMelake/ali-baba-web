import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  mergeCartAction,
  syncCartItemAction,
  getDbCartAction,
} from "@/lib/actions/cart";

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
  addItem: (item: Omit<CartItem, "quantity">, isLoggedIn?: boolean) => void;
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
        // Derive the resulting quantity first so we can both update locally and
        // send an absolute SET to the server (idempotent — beats increment races).
        const existing = get().items.find(
          (i) => i.variantId === newItem.variantId,
        );
        const newQuantity = existing ? existing.quantity + 1 : 1;

        set((s) => ({
          items: existing
            ? s.items.map((i) =>
                i.variantId === newItem.variantId
                  ? { ...i, quantity: newQuantity }
                  : i,
              )
            : [...s.items, { ...newItem, quantity: 1 }],
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

        set((s) => ({
          items: s.items.map((i) =>
            i.variantId === variantId ? { ...i, quantity } : i,
          ),
        }));

        if (isLoggedIn) fireSync(variantId, quantity, "SET");
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

      totalItems: () => get().items.reduce((sum, i) => sum + i.quantity, 0),
      totalPrice: () =>
        get().items.reduce((sum, i) => sum + i.price * i.quantity, 0),
    }),
    {
      name: "ali-baba-cart",
      // Persist ONLY the items — never UI state (isOpen) or session-derived data.
      // Keeping nothing session-specific in storage avoids stale auth across
      // users on a shared device and keeps SSR/CSR first paint identical
      // (no hydration mismatch): the server renders `items: []`, then the
      // client rehydrates from localStorage after mount, exactly as before.
      partialize: (s) => ({ items: s.items }),
    },
  ),
);
