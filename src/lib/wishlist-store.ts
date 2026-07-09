import { create } from "zustand";
import {
  getWishlistedProductIds,
  toggleWishlist,
  type ToggleWishlistResult,
} from "@/lib/actions/wishlist";

/**
 * Client-side cache of the signed-in user's favorited product ids.
 *
 * Catalog pages (/shop, /category/[slug], /product/[slug]) are served from a
 * shared cache, so the server can no longer seed per-user wishlist state into
 * the HTML — that would either leak one user's hearts into everyone's page or
 * force every catalog route fully dynamic (the trap this store removes). The
 * cached page paints with empty hearts; once the session resolves, the FIRST
 * WishlistButton to mount triggers ONE `getWishlistedProductIds()` fetch for
 * the whole page. Every heart derives from this shared store, so a toggle
 * anywhere updates all instances of that product at once.
 */

type WishlistStatus = "idle" | "loading" | "ready";

interface WishlistState {
  /** The user the current `ids` belong to (null = guest / signed out). */
  userId: string | null;
  status: WishlistStatus;
  /** Favorited product ids. Replaced wholesale on change — never mutated. */
  ids: ReadonlySet<string>;

  /**
   * Idempotent hydration — every WishlistButton calls this once its session
   * has resolved; only the first call for a given user actually fetches.
   * Guests resolve to a known-empty set with no network round-trip, which
   * also wipes the previous user's hearts on sign-out / account switch.
   */
  ensureLoaded: (userId: string | null) => void;

  /**
   * Optimistic toggle: flips locally first, persists via the server action,
   * reconciles with the server's returned state, rolls back on failure.
   */
  toggle: (productId: string) => Promise<ToggleWishlistResult>;
}

const EMPTY: ReadonlySet<string> = new Set();

function withToggled(
  ids: ReadonlySet<string>,
  productId: string,
  favorited: boolean,
): ReadonlySet<string> {
  const next = new Set(ids);
  if (favorited) next.add(productId);
  else next.delete(productId);
  return next;
}

export const useWishlistStore = create<WishlistState>()((set, get) => ({
  userId: null,
  status: "idle",
  ids: EMPTY,

  ensureLoaded: (userId) => {
    const s = get();
    // Already loaded (or loading) for this exact user → nothing to do.
    if (s.userId === userId && s.status !== "idle") return;

    if (userId === null) {
      set({ userId: null, status: "ready", ids: EMPTY });
      return;
    }

    set({ userId, status: "loading", ids: EMPTY });
    void getWishlistedProductIds()
      .then((productIds) => {
        // A logout / account switch may have raced the fetch — only commit
        // the result if this user is still the store's current user.
        if (get().userId !== userId) return;
        set({ status: "ready", ids: new Set(productIds) });
      })
      .catch((err) => {
        console.error("wishlist hydrate failed:", err);
        if (get().userId !== userId) return;
        // Hearts stay empty; toggling still works and self-corrects.
        set({ status: "ready" });
      });
  },

  toggle: async (productId) => {
    const s = get();
    // Guests get the standard sign-in message without a fake optimistic
    // flip that would have to roll straight back.
    if (s.userId === null) {
      return { success: false, error: "Please sign in to use your wishlist." };
    }

    const wasFavorited = s.ids.has(productId);
    set({ ids: withToggled(s.ids, productId, !wasFavorited) }); // optimistic

    const res = await toggleWishlist(productId);
    if (!res.success) {
      set({ ids: withToggled(get().ids, productId, wasFavorited) }); // roll back
      return res;
    }
    // Trust the server's resulting state over the optimistic guess.
    set({ ids: withToggled(get().ids, productId, res.added) });
    return res;
  },
}));
