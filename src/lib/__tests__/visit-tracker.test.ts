// @vitest-environment jsdom
//
// ─────────────────────────────────────────────────────────────────────────────
// Storefront visit tracker — client batching (src/lib/visit-tracker.ts).
//
// Pins the "cheap and never in the way" contract: events batch into one action
// call after the flush delay (or immediately at VISIT_BATCH_MAX, or when the
// tab hides); a repeat of the same event inside the dedupe window counts once;
// automated browsers never report; the visitor id is one stable random UUID
// per browser, falling back to memory when storage throws; a failing action
// never surfaces.
//
// The module keeps queue state, so each test re-imports it fresh.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recordVisitEvents = vi.fn();
vi.mock("@/lib/actions/visits", () => ({ recordVisitEvents }));

async function loadTracker() {
  vi.resetModules();
  return import("@/lib/visit-tracker");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(() => {
  vi.useFakeTimers();
  recordVisitEvents.mockReset();
  recordVisitEvents.mockResolvedValue({ success: true, recorded: 1 });
  window.localStorage.clear();
  Object.defineProperty(navigator, "webdriver", { value: false, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("trackVisit — batching", () => {
  it("sends rapid events as ONE call after the flush delay", async () => {
    const { trackVisit, VISIT_FLUSH_DELAY_MS } = await loadTracker();

    trackVisit("view", { path: "/product/kunafa" });
    trackVisit("product_view", { path: "/product/kunafa", productId: "prod_1" });
    expect(recordVisitEvents).not.toHaveBeenCalled();

    vi.advanceTimersByTime(VISIT_FLUSH_DELAY_MS);

    expect(recordVisitEvents).toHaveBeenCalledTimes(1);
    const [{ visitorId, events }] = recordVisitEvents.mock.calls[0];
    expect(visitorId).toMatch(UUID);
    expect(events).toEqual([
      { type: "view", path: "/product/kunafa" },
      { type: "product_view", path: "/product/kunafa", productId: "prod_1" },
    ]);
  });

  it("flushes immediately when the batch fills", async () => {
    const { trackVisit } = await loadTracker();
    const { VISIT_BATCH_MAX } = await import("@/lib/validators");

    for (let i = 0; i < VISIT_BATCH_MAX; i++) trackVisit("view", { path: `/p/${i}` });

    expect(recordVisitEvents).toHaveBeenCalledTimes(1);
    expect(recordVisitEvents.mock.calls[0][0].events).toHaveLength(VISIT_BATCH_MAX);
  });

  it("flushes when the tab is hidden", async () => {
    const { trackVisit } = await loadTracker();
    trackVisit("view", { path: "/" });

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(recordVisitEvents).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  it("counts the same event once inside the dedupe window (dev double-effects)", async () => {
    const { trackVisit, VISIT_FLUSH_DELAY_MS } = await loadTracker();

    trackVisit("view", { path: "/" });
    trackVisit("view", { path: "/" });
    vi.advanceTimersByTime(VISIT_FLUSH_DELAY_MS);

    expect(recordVisitEvents.mock.calls[0][0].events).toHaveLength(1);
  });
});

describe("trackVisit — never in the way", () => {
  it("does not report from an automated browser", async () => {
    Object.defineProperty(navigator, "webdriver", { value: true, configurable: true });
    const { trackVisit, VISIT_FLUSH_DELAY_MS } = await loadTracker();

    trackVisit("view", { path: "/" });
    vi.advanceTimersByTime(VISIT_FLUSH_DELAY_MS);

    expect(recordVisitEvents).not.toHaveBeenCalled();
  });

  it("swallows a failing action", async () => {
    recordVisitEvents.mockRejectedValue(new Error("offline"));
    const { trackVisit, flushVisits } = await loadTracker();

    trackVisit("view", { path: "/" });
    expect(() => flushVisits()).not.toThrow();
    await vi.runAllTimersAsync();
  });
});

describe("getVisitorId", () => {
  it("is one stable id per browser, persisted in localStorage", async () => {
    const { getVisitorId, VISITOR_ID_KEY } = await loadTracker();

    const first = getVisitorId();
    expect(first).toMatch(UUID);
    expect(window.localStorage.getItem(VISITOR_ID_KEY)).toBe(first);

    const { getVisitorId: again } = await loadTracker();
    expect(again()).toBe(first);
  });

  it("falls back to an in-memory id when storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const { getVisitorId } = await loadTracker();

    const id = getVisitorId();
    expect(id).toMatch(UUID);
    expect(getVisitorId()).toBe(id);
  });
});
