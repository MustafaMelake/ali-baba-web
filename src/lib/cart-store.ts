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
  type DbCartItem,
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

/**
 * A cart line's latest local intent that the server has NOT yet confirmed —
 * either the sync is still in flight or it failed (offline / timeout / auth).
 */
export type PendingCartOp = { quantity: number; action: "SET" | "DELETE" };

interface CartState {
  items: CartItem[];
  isOpen: boolean;
  /**
   * Unsynced local intent, keyed by `variantId`. An entry is written the
   * moment a logged-in mutation fires and cleared only when the server
   * CONFIRMS that exact op — so a failed fire-and-forget sync (or one cut off
   * by a page close) survives here, in localStorage. `adoptDbCart` replays
   * these over the server payload instead of letting a blind hydrate silently
   * drop the un-synced change (the old data-loss bug).
   */
  pendingOps: Record<string, PendingCartOp>;

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

  /** Local-only empty (used by checkout / the "Clear cart" button). Also drops
   *  pending ops — the caller empties the DB side via clearDbCartAction, so
   *  replaying stale line intents afterwards would resurrect the cart. */
  clearCart: () => void;
  /**
   * LOGOUT-only wipe. Clears the in-memory + persisted (localStorage) cart —
   * including pending ops, which belong to the signed-out user and must never
   * replay into the next account's cart — but deliberately NEVER touches the
   * database, so the signed-out user's saved cart survives for their next
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
   * Adopt a freshly-fetched DB cart as the source of truth (login hydrate /
   * post-merge). With no unsynced intent this is a plain overwrite; when
   * `pendingOps` is non-empty the ops are REPLAYED over the server payload —
   * a failed DELETE stays deleted, a failed SET keeps its local quantity —
   * and then re-synced in the background. Lines that exist only in the DB
   * (added from another device) always survive.
   */
  adoptDbCart: (dbItems: DbCartItem[]) => void;

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
    (set, get) => {
      /**
       * Record-then-confirm persistence of a single line:
       *   1. The op is written to `pendingOps` BEFORE the request leaves, so
       *      local intent is never unaccounted for — even if the tab closes.
       *   2. On server confirmation the entry is cleared, but ONLY if it still
       *      matches the op we sent (a newer mutation may have superseded it).
       *   3. On rejection/failure the entry simply stays: the optimistic local
       *      state already applied, and the next `adoptDbCart` (or this
       *      function, re-invoked by its replay loop) reconciles the DB.
       */
      function fireSync(
        variantId: string,
        quantity: number,
        actionType: "SET" | "DELETE",
      ) {
        set((s) => ({
          pendingOps: {
            ...s.pendingOps,
            [variantId]: { quantity, action: actionType },
          },
        }));

        void syncCartItemAction(variantId, quantity, actionType)
          .then((res) => {
            if (!res.success) {
              // Op stays pending for the next hydrate/replay to reconcile.
              console.error("cart sync rejected:", res.error);
              return;
            }
            set((s) => {
              const current = s.pendingOps[variantId];
              // Superseded by a newer op → that one is still awaiting its own
              // confirmation; leave it in place.
              if (
                !current ||
                current.quantity !== quantity ||
                current.action !== actionType
              ) {
                return {};
              }
              const next = { ...s.pendingOps };
              delete next[variantId];
              return { pendingOps: next };
            });
          })
          .catch((err) => {
            console.error("cart sync failed:", err); // op stays pending
          });
      }

      return {
        items: [],
        isOpen: false,
        pendingOps: {},

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

        clearCart: () => set({ items: [], pendingOps: {} }),

        clearLocalCart: () => set({ items: [], isOpen: false, pendingOps: {} }),

        mergeAndSyncCart: async () => {
          const localLines = get()
            .items.map((i) => ({ variantId: i.variantId, quantity: i.quantity }))
            .filter((l) => l.quantity > 0);

          // 1) Merge the guest cart up (server sums onto existing DB rows).
          if (localLines.length > 0) {
            const merged = await mergeCartAction(localLines);
            if (!merged.success) {
              console.error("mergeAndSyncCart: merge failed —", merged.error);
              // Keep the local cart AND record every line as unsynced intent,
              // so a later hydrate MERGES these lines instead of overwriting
              // them away. (The replay degrades the merge's SUM semantics to
              // an absolute SET — losing a cross-device increment is the
              // lesser evil than losing the whole guest cart.)
              set((s) => ({
                pendingOps: {
                  ...s.pendingOps,
                  ...Object.fromEntries(
                    localLines.map((l) => [
                      l.variantId,
                      { quantity: l.quantity, action: "SET" as const },
                    ]),
                  ),
                },
              }));
              return;
            }
          }

          // 2) Adopt the DB cart: live prices/names/images, server truth.
          //    Goes through adoptDbCart so any pending intent still replays.
          const dbCart = await getDbCartAction();
          if (dbCart.success) {
            get().adoptDbCart(dbCart.data);
          } else {
            console.error("mergeAndSyncCart: fetch failed —", dbCart.error);
          }
        },

        adoptDbCart: (dbItems) => {
          const pendingEntries = Object.entries(get().pendingOps);

          // Nothing unsynced → the server payload is simply the truth.
          if (pendingEntries.length === 0) {
            set({ items: dbItems });
            return;
          }

          // Replay local intent over the server payload. DB-only lines (added
          // from another device) survive untouched; lines the user deleted
          // while the sync failed stay deleted; failed SETs keep their local
          // quantity. Display data (name/image/price) prefers the DB's live
          // copy and falls back to the local line for lines the DB never saw
          // (price stays display-only — placeOrder re-prices regardless).
          const localByVariant = new Map(
            get().items.map((i) => [i.variantId, i]),
          );
          const merged = new Map<string, CartItem>(
            dbItems.map((i) => [i.variantId, i]),
          );
          const droppedOps: string[] = [];

          for (const [variantId, op] of pendingEntries) {
            if (op.action === "DELETE" || op.quantity < 1) {
              merged.delete(variantId);
              continue;
            }
            const dbLine = merged.get(variantId);
            if (dbLine) {
              merged.set(variantId, { ...dbLine, quantity: op.quantity });
            } else {
              const localLine = localByVariant.get(variantId);
              if (localLine) {
                merged.set(variantId, { ...localLine, quantity: op.quantity });
              } else {
                // No DB row and no local display data left — nothing to
                // restore; retire the orphaned op instead of replaying it.
                droppedOps.push(variantId);
              }
            }
          }

          set((s) => {
            if (droppedOps.length === 0) return { items: [...merged.values()] };
            const nextOps = { ...s.pendingOps };
            for (const variantId of droppedOps) delete nextOps[variantId];
            return { items: [...merged.values()], pendingOps: nextOps };
          });

          // 3) Background reconcile: push every surviving op to the server.
          //    fireSync re-records + self-clears on confirmation, so a replay
          //    that fails again simply stays pending for the next adopt.
          for (const [variantId, op] of Object.entries(get().pendingOps)) {
            fireSync(variantId, op.quantity, op.action);
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
      };
    },
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
      // Persist the items AND the unsynced-intent ledger (so intent from a
      // page-life that died mid-sync survives the reload) — never UI state
      // (isOpen) or session-derived data. Carts persisted before `pendingOps`
      // existed rehydrate fine: the missing key keeps its initial {}.
      partialize: (s) => ({ items: s.items, pendingOps: s.pendingOps }),
    },
  ),
);
