"use client";

import { useEffect, useRef } from "react";
import { useSession } from "@/lib/auth-client";
import { CART_STORAGE_KEY, useCartStore } from "@/lib/cart-store";

/**
 * CartSyncProvider — bridges the client cart with the persisted (DB) cart
 * across the auth lifecycle. It renders its children untouched; all behaviour
 * lives in a client-only effect, so it introduces no SSR hydration mismatch.
 *
 * The hard part is distinguishing two superficially identical situations where
 * `useSession()` ends up reporting a logged-in user:
 *
 *   • "Already logged in on mount" (page load / refresh / new device): the
 *     localStorage cart and the DB cart may overlap. Quantity-summing here
 *     would double-count. → We HYDRATE: pull the DB cart and adopt it via
 *     `adoptDbCart`, which replays any UNSYNCED local intent (pendingOps —
 *     e.g. a fire-and-forget sync that failed offline) over the payload
 *     instead of blindly overwriting it away.
 *
 *   • "Guest → Logged in" (a real sign-in this session): the localStorage cart
 *     is the guest's work that must be folded into the account exactly once.
 *     → We MERGE (server sums), then adopt the merged DB cart.
 *
 * We tell them apart with refs: `firstResolve` marks the very first non-pending
 * session reading after mount, and `knownUserId` records the last id we acted
 * on so each transition fires exactly once (no loops, no redundant calls).
 *
 * Tabs share localStorage but not their in-memory stores, and Better Auth
 * refetches the session when a tab regains focus — so a second tab can notice
 * a sign-in that another tab already merged. Two guards keep that from merging
 * the same guest cart twice: every tab re-reads the cart when another tab
 * writes it, and the merge itself is skipped for a cart the account already
 * owns (`ownerId`, see cart-store.ts).
 */
export default function CartSyncProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, isPending } = useSession();
  const userId = session?.user?.id ?? null;

  // Zustand actions have stable identity — safe to use as effect deps. (They
  // source their own items from the store, which is why this provider never
  // subscribes to `items` — doing so would re-run the effect on every edit.)
  const mergeAndSyncCart = useCartStore((s) => s.mergeAndSyncCart);
  const hydrateFromDb = useCartStore((s) => s.hydrateFromDb);
  const clearLocalCart = useCartStore((s) => s.clearLocalCart);

  // Have we handled the first resolved session reading yet?
  const firstResolve = useRef(true);
  // The user id whose transition we last acted on (null = guest).
  const knownUserId = useRef<string | null>(null);

  // Another tab changed the persisted cart — adopt it, so this tab's next
  // write can't overwrite it with a stale copy and its next decision sees
  // that tab's ownership claim.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === CART_STORAGE_KEY) void useCartStore.persist.rehydrate();
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    // Wait until Better Auth has actually resolved the session.
    if (isPending) return;

    // ── First resolution after mount ────────────────────────────────────────
    // This is "state on load", not a transition. If a user is already logged
    // in, hydrate from the DB (no quantity-SUM → no double-count; unsynced
    // local intent still replays on top — see adoptDbCart). If it's a guest,
    // leave the local cart exactly as persisted.
    if (firstResolve.current) {
      firstResolve.current = false;
      knownUserId.current = userId;
      if (userId) void hydrateFromDb(userId);
      return;
    }

    // No change since the last transition we handled → nothing to do.
    // (Guards against re-runs from session refetches toggling `isPending`.)
    if (userId === knownUserId.current) return;

    const prevUserId = knownUserId.current;
    knownUserId.current = userId;

    if (prevUserId === null && userId !== null) {
      // ── Guest → Logged in: the one true merge moment. Re-read storage
      //    first: if another tab already merged this cart, its claim is
      //    there and the merge becomes a plain hydrate. ──
      void Promise.resolve(useCartStore.persist.rehydrate()).then(() =>
        mergeAndSyncCart(userId),
      );
    } else if (userId === null) {
      // ── Logged in → Guest (logout): wipe local + persisted storage so the
      //    next guest on this device sees nothing. DB cart is left intact. ──
      clearLocalCart();
    } else {
      // ── Account switch A → B without an intervening guest state: drop A's
      //    local cart, then hydrate B's from the DB. ──
      clearLocalCart();
      void hydrateFromDb(userId);
    }
  }, [userId, isPending, mergeAndSyncCart, clearLocalCart, hydrateFromDb]);

  return <>{children}</>;
}
