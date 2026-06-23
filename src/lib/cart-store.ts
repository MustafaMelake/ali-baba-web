import { create } from "zustand";
import { persist } from "zustand/middleware";

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
  addItem: (item: Omit<CartItem, "quantity">) => void;
  removeItem: (variantId: string) => void;
  updateQuantity: (variantId: string, quantity: number) => void;
  clearCart: () => void;

  // Derived (computed inline)
  totalItems: () => number;
  totalPrice: () => number;
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
      addItem: (newItem) => {
        set((s) => {
          const existing = s.items.find((i) => i.variantId === newItem.variantId);
          if (existing) {
            return {
              items: s.items.map((i) =>
                i.variantId === newItem.variantId
                  ? { ...i, quantity: i.quantity + 1 }
                  : i
              ),
            };
          }
          return { items: [...s.items, { ...newItem, quantity: 1 }] };
        });
        // Open the drawer on first add
        set({ isOpen: true });
      },

      removeItem: (variantId) =>
        set((s) => ({
          items: s.items.filter((i) => i.variantId !== variantId),
        })),

      updateQuantity: (variantId, quantity) => {
        if (quantity < 1) {
          get().removeItem(variantId);
          return;
        }
        set((s) => ({
          items: s.items.map((i) =>
            i.variantId === variantId ? { ...i, quantity } : i
          ),
        }));
      },

      clearCart: () => set({ items: [] }),

      totalItems: () => get().items.reduce((sum, i) => sum + i.quantity, 0),
      totalPrice: () =>
        get().items.reduce((sum, i) => sum + i.price * i.quantity, 0),
    }),
    {
      name: "ali-baba-cart",
      // Only persist items, not the open/close state.
      // The CartItem shape is unchanged by the variantId-keying fix (variantId was
      // always stored), so previously-persisted carts remain valid with no migration.
      partialize: (s) => ({ items: s.items }),
    }
  )
);
