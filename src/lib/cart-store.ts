import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface CartItem {
  id: string;         // product id — the merge key for quantity stacking
  variantId: string;  // purchasable unit — what placeOrder() prices server-side
  name: string;
  price: number;      // in the store's local currency (EGP)
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

  // Items
  addItem: (item: Omit<CartItem, "quantity">) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
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

      addItem: (newItem) => {
        set((s) => {
          const existing = s.items.find((i) => i.id === newItem.id);
          if (existing) {
            return {
              items: s.items.map((i) =>
                i.id === newItem.id
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

      removeItem: (id) =>
        set((s) => ({ items: s.items.filter((i) => i.id !== id) })),

      updateQuantity: (id, quantity) => {
        if (quantity < 1) {
          get().removeItem(id);
          return;
        }
        set((s) => ({
          items: s.items.map((i) => (i.id === id ? { ...i, quantity } : i)),
        }));
      },

      clearCart: () => set({ items: [] }),

      totalItems: () => get().items.reduce((sum, i) => sum + i.quantity, 0),
      totalPrice: () =>
        get().items.reduce((sum, i) => sum + i.price * i.quantity, 0),
    }),
    {
      name: "ali-baba-cart",
      // Only persist items, not the open/close state
      partialize: (s) => ({ items: s.items }),
    }
  )
);
