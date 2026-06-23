"use client";

import { useCallback, useEffect, useRef } from "react";
import { useSession } from "@/lib/auth-client";
import { useCartStore } from "@/lib/cart-store";
import { getDbCartAction } from "@/lib/actions/cart";

/**
 * CartSyncProvider — bridges the client cart with the persisted (DB) cart
 * across the auth lifecycle. It renders its children untouched; all behaviour
 * lives in a client-only effect, so it introduces no SSR hydration mismatch.
 *
 * The hard part is distinguishing two superficially identical situations where
 * `useSession()` ends up reporting a logged-in user:
 *
 *   • "Already logged in on mount" (page load / refresh / new device): the
 *     localStorage cart and the DB cart may overlap. Merging here would SUM the
 *     two and double-count. → We HYDRATE: pull the DB cart and overwrite local.
 *
 *   • "Guest → Logged in" (a real sign-in this session): the localStorage cart
 *     is the guest's work that must be folded into the account exactly once.
 *     → We MERGE (server sums), then adopt the merged DB cart.
 *
 * We tell them apart with refs: `firstResolve` marks the very first non-pending
 * session reading after mount, and `knownUserId` records the last id we acted
 * on so each transition fires exactly once (no loops, no redundant calls).
 */
export default function CartSyncProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, isPending } = useSession();
  const userId = session?.user?.id ?? null;

  // Zustand actions have stable identity — safe to use as effect deps.
  const mergeAndSyncCart = useCartStore((s) => s.mergeAndSyncCart);
  const clearLocalCart = useCartStore((s) => s.clearLocalCart);

  // Have we handled the first resolved session reading yet?
  const firstResolve = useRef(true);
  // The user id whose transition we last acted on (null = guest).
  const knownUserId = useRef<string | null>(null);

  /**
   * Pull the DB cart and adopt it as the source of truth. `setState` is
   * Zustand's built-in setter; it also writes through the `persist` middleware,
   * so localStorage is updated to match. (`mergeAndSyncCart` sources its own
   * items from the store, which is why this provider never subscribes to
   * `items` — doing so would re-run the effect on every cart edit.)
   */
  const hydrateFromDb = useCallback(async () => {
    const res = await getDbCartAction();
    if (res.success) {
      useCartStore.setState({ items: res.data });
    } else {
      console.error("CartSyncProvider: hydrate failed —", res.error);
    }
  }, []);

  useEffect(() => {
    // Wait until Better Auth has actually resolved the session.
    if (isPending) return;

    // ── First resolution after mount ────────────────────────────────────────
    // This is "state on load", not a transition. If a user is already logged
    // in, hydrate strictly from the DB (NO merge → no double-count). If it's a
    // guest, leave the local cart exactly as persisted.
    if (firstResolve.current) {
      firstResolve.current = false;
      knownUserId.current = userId;
      if (userId) void hydrateFromDb();
      return;
    }

    // No change since the last transition we handled → nothing to do.
    // (Guards against re-runs from session refetches toggling `isPending`.)
    if (userId === knownUserId.current) return;

    const prevUserId = knownUserId.current;
    knownUserId.current = userId;

    if (prevUserId === null && userId !== null) {
      // ── Guest → Logged in: the one true merge moment. ──
      void mergeAndSyncCart();
    } else if (userId === null) {
      // ── Logged in → Guest (logout): wipe local + persisted storage so the
      //    next guest on this device sees nothing. DB cart is left intact. ──
      clearLocalCart();
    } else {
      // ── Account switch A → B without an intervening guest state: drop A's
      //    local cart, then hydrate B's from the DB. ──
      clearLocalCart();
      void hydrateFromDb();
    }
  }, [userId, isPending, mergeAndSyncCart, clearLocalCart, hydrateFromDb]);

  return <>{children}</>;
}
