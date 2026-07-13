// @vitest-environment jsdom
//
// ─────────────────────────────────────────────────────────────────────────────
// Cart store (Zustand) — client state suite.
//
// This is the OPTIMISTIC-INTEGRITY guard: the store applies a mutation locally
// and fires a background sync, recording the intent in `pendingOps` first. The
// data-loss bug this prevents is a stale server payload silently reverting an
// un-synced local change. These tests lock that mechanism down — `adoptDbCart`
// (login hydrate / post-merge) and the guest→auth `mergeAndSyncCart` bridge.
//
// Runs in jsdom (pragma above) so the persist middleware has `window.localStorage`.
// The store imports the cart Server Actions and sonner — both are external
// boundaries, mocked here; we drive the store directly via getState()/setState().
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The store fires these in the background on every logged-in mutation / adopt.
vi.mock("@/lib/actions/cart", () => ({
  mergeCartAction: vi.fn(),
  syncCartItemAction: vi.fn(),
  getDbCartAction: vi.fn(),
  rePriceGuestCart: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { useCartStore } from "@/lib/cart-store";
import { mergeCartAction, syncCartItemAction, getDbCartAction } from "@/lib/actions/cart";
import type { DbCartItem } from "@/lib/actions/cart";

const mockedSync = vi.mocked(syncCartItemAction);
const mockedMerge = vi.mocked(mergeCartAction);
const mockedGetDbCart = vi.mocked(getDbCartAction);

/** A cart line (DbCartItem is structurally identical to the store's CartItem). */
function line(over: Partial<DbCartItem> & { variantId: string }): DbCartItem {
  return {
    id: `p_${over.variantId}`,
    name: "Cake",
    price: 100,
    image: "/cake.jpg",
    quantity: 1,
    category: "Cakes",
    ...over, // provides variantId (required) and overrides any default above
  };
}

/** Seed the store's mutable state directly. */
function seed(state: Partial<ReturnType<typeof useCartStore.getState>>) {
  useCartStore.setState(state);
}

beforeEach(() => {
  vi.resetAllMocks();
  useCartStore.setState({ items: [], pendingOps: {}, isOpen: false });
  localStorage.clear();
  // Background reconcile resolves cleanly by default (confirms + clears the op).
  mockedSync.mockResolvedValue({ success: true, data: null });
  mockedMerge.mockResolvedValue({ success: true, data: null });
  mockedGetDbCart.mockResolvedValue({ success: true, data: [] });
});

afterAll(() => {
  vi.restoreAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════════
// adoptDbCart — plain adoption (no unsynced intent) & guest clearing
// ═════════════════════════════════════════════════════════════════════════════

describe("adoptDbCart — plain adoption (no pending ops)", () => {
  it("replaces the local items array with the DB payload", () => {
    seed({ items: [line({ variantId: "v_guest", quantity: 9 })] });
    const db = [line({ variantId: "v1", quantity: 2 }), line({ variantId: "v2", quantity: 3 })];

    useCartStore.getState().adoptDbCart(db);
    expect(useCartStore.getState().items).toEqual(db);
  });

  it("clears the guest cart — the prior local lines are gone, replaced by DB truth", () => {
    // There is no separate "guest id": the guest cart IS `items` (+ pendingOps)
    // in the persisted `ali-baba-cart` key, so adoption REPLACING items is the clear.
    seed({ items: [line({ variantId: "v_guest", quantity: 5 })] });

    useCartStore.getState().adoptDbCart([line({ variantId: "v_db", quantity: 1 })]);
    const ids = useCartStore.getState().items.map((i) => i.variantId);
    expect(ids).toEqual(["v_db"]);
    expect(ids).not.toContain("v_guest");
    expect(useCartStore.getState().pendingOps).toEqual({}); // no stale intent left behind
  });

  it("adopts an empty DB cart by emptying local items", () => {
    seed({ items: [line({ variantId: "v1", quantity: 3 })] });
    useCartStore.getState().adoptDbCart([]);
    expect(useCartStore.getState().items).toEqual([]);
  });

  it("fires NO background sync when there is nothing unsynced", () => {
    useCartStore.getState().adoptDbCart([line({ variantId: "v1", quantity: 1 })]);
    expect(mockedSync).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// adoptDbCart — pendingOps replay (the anti-revert guard)
// ═════════════════════════════════════════════════════════════════════════════

describe("adoptDbCart — pendingOps replay (optimistic integrity)", () => {
  it("replays a pending SET over a STALE DB payload so the quantity does not revert", () => {
    // User bumped v1 to 5 locally; the sync hasn't landed, so the DB still says 3.
    seed({
      items: [line({ variantId: "v1", quantity: 5, name: "Local Cake" })],
      pendingOps: { v1: { quantity: 5, action: "SET" } },
    });

    useCartStore.getState().adoptDbCart([line({ variantId: "v1", quantity: 3, name: "DB Cake" })]);

    const v1 = useCartStore.getState().items.find((i) => i.variantId === "v1")!;
    expect(v1.quantity).toBe(5); // local intent wins → no visual jump back to 3
    expect(v1.name).toBe("DB Cake"); // display data still comes from the live DB row
  });

  it("replays a pending DELETE so a locally-removed line stays gone despite the DB listing it", () => {
    seed({
      items: [], // already removed locally
      pendingOps: { v1: { quantity: 0, action: "DELETE" } },
    });

    useCartStore.getState().adoptDbCart([
      line({ variantId: "v1", quantity: 2 }), // DB hasn't processed the delete yet
      line({ variantId: "v2", quantity: 1 }),
    ]);

    const ids = useCartStore.getState().items.map((i) => i.variantId);
    expect(ids).not.toContain("v1"); // stays deleted
    expect(ids).toContain("v2"); // an untouched DB line survives
  });

  it("keeps a DB-only line (added on another device) that has no pending op", () => {
    seed({
      items: [line({ variantId: "v1", quantity: 5 })],
      pendingOps: { v1: { quantity: 5, action: "SET" } },
    });

    useCartStore.getState().adoptDbCart([
      line({ variantId: "v1", quantity: 3 }),
      line({ variantId: "v_other_device", quantity: 7 }),
    ]);

    const byId = new Map(useCartStore.getState().items.map((i) => [i.variantId, i]));
    expect(byId.get("v1")!.quantity).toBe(5); // replayed local intent
    expect(byId.get("v_other_device")!.quantity).toBe(7); // cross-device line survives
  });

  it("restores a pending SET for a line the DB never saw, from local display data", () => {
    seed({
      items: [line({ variantId: "v_new", quantity: 4, name: "Just Added" })],
      pendingOps: { v_new: { quantity: 4, action: "SET" } },
    });

    useCartStore.getState().adoptDbCart([]); // DB doesn't have the just-added line yet

    const v = useCartStore.getState().items.find((i) => i.variantId === "v_new");
    expect(v).toMatchObject({ variantId: "v_new", quantity: 4, name: "Just Added" });
  });

  it("retires an ORPHANED op (no DB row, no local display data) instead of replaying it", () => {
    seed({
      items: [], // nothing to restore from
      pendingOps: { v_ghost: { quantity: 2, action: "SET" } },
    });

    useCartStore.getState().adoptDbCart([]);
    expect(useCartStore.getState().items).toEqual([]);
    expect(useCartStore.getState().pendingOps).not.toHaveProperty("v_ghost"); // dropped, won't retry forever
  });

  it("reconciles every surviving op in the background via syncCartItemAction", () => {
    seed({
      items: [line({ variantId: "v1", quantity: 5 })],
      pendingOps: { v1: { quantity: 5, action: "SET" } },
    });

    useCartStore.getState().adoptDbCart([line({ variantId: "v1", quantity: 3 })]);
    // fireSync pushes the replayed intent to the server (absolute SET → beats races).
    expect(mockedSync).toHaveBeenCalledWith("v1", 5, "SET");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// mergeAndSyncCart — guest → authenticated transition (don't lose pendingOps)
// ═════════════════════════════════════════════════════════════════════════════

describe("mergeAndSyncCart — guest → auth without losing intent", () => {
  it("adopts the merged DB cart as the source of truth on a clean sign-in", async () => {
    seed({ items: [line({ variantId: "v_guest", quantity: 2 })] });
    mockedMerge.mockResolvedValue({ success: true, data: null });
    mockedGetDbCart.mockResolvedValue({ success: true, data: [line({ variantId: "v1", quantity: 4 })] });

    await useCartStore.getState().mergeAndSyncCart();

    expect(mockedMerge).toHaveBeenCalledWith([{ variantId: "v_guest", quantity: 2 }]);
    expect(useCartStore.getState().items).toEqual([line({ variantId: "v1", quantity: 4 })]);
  });

  it("preserves the guest cart as pendingOps when the server merge FAILS (no data loss)", async () => {
    seed({
      items: [line({ variantId: "v1", quantity: 2 }), line({ variantId: "v2", quantity: 3 })],
    });
    mockedMerge.mockResolvedValue({ success: false, error: "network down" });

    await useCartStore.getState().mergeAndSyncCart();

    // Local items are NOT dropped…
    expect(useCartStore.getState().items).toHaveLength(2);
    // …and every line is queued as unsynced intent for the next hydrate to reconcile.
    expect(useCartStore.getState().pendingOps).toEqual({
      v1: { quantity: 2, action: "SET" },
      v2: { quantity: 3, action: "SET" },
    });
    // A failed merge must NOT then adopt a partial/empty DB cart over the guest's work.
    expect(mockedGetDbCart).not.toHaveBeenCalled();
  });

  it("does not lose a PRE-EXISTING pending op across a successful merge (replayed via adopt)", async () => {
    // An optimistic op is already queued when the sign-in merge fires.
    seed({
      items: [line({ variantId: "v1", quantity: 8, name: "Local" })],
      pendingOps: { v1: { quantity: 8, action: "SET" } },
    });
    mockedMerge.mockResolvedValue({ success: true, data: null });
    // The post-merge DB read still reflects the pre-op quantity (5).
    mockedGetDbCart.mockResolvedValue({ success: true, data: [line({ variantId: "v1", quantity: 5, name: "DB" })] });

    await useCartStore.getState().mergeAndSyncCart();

    const v1 = useCartStore.getState().items.find((i) => i.variantId === "v1")!;
    expect(v1.quantity).toBe(8); // the pending op replayed → local intent survived the transition
    expect(v1.name).toBe("DB"); // live display from the adopted DB cart
  });

  it("skips the server merge for an empty guest cart but still adopts the DB cart", async () => {
    seed({ items: [] });
    mockedGetDbCart.mockResolvedValue({ success: true, data: [line({ variantId: "v1", quantity: 1 })] });

    await useCartStore.getState().mergeAndSyncCart();

    expect(mockedMerge).not.toHaveBeenCalled(); // nothing to merge up
    expect(useCartStore.getState().items).toEqual([line({ variantId: "v1", quantity: 1 })]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// clearLocalCart / clearCart — dropping unsynced intent so it can't replay
// ═════════════════════════════════════════════════════════════════════════════

describe("clearLocalCart / clearCart — pendingOps hygiene", () => {
  it("clearLocalCart (logout) wipes items AND pendingOps so intent can't replay into the next account", () => {
    seed({
      items: [line({ variantId: "v1" })],
      pendingOps: { v1: { quantity: 1, action: "SET" } },
      isOpen: true,
    });

    useCartStore.getState().clearLocalCart();
    expect(useCartStore.getState().items).toEqual([]);
    expect(useCartStore.getState().pendingOps).toEqual({});
    expect(useCartStore.getState().isOpen).toBe(false);
  });

  it("clearCart (checkout / Clear button) also drops pendingOps so a stale op can't resurrect the emptied cart", () => {
    seed({
      items: [line({ variantId: "v1" })],
      pendingOps: { v1: { quantity: 1, action: "SET" } },
    });

    useCartStore.getState().clearCart();
    expect(useCartStore.getState().items).toEqual([]);
    expect(useCartStore.getState().pendingOps).toEqual({});
  });
});
