// @vitest-environment jsdom
//
// ─────────────────────────────────────────────────────────────────────────────
// Seasonal intro latch — client store suite.
//
// `useSeasonalIntro` decides whether the homepage's seasonal intro plays and
// owns its three-second lifetime. The promises it keeps: at most once per tab
// session (a reload or a client-side navigation must not replay it), never
// under prefers-reduced-motion, never crash the homepage when storage is
// blocked, and never spend its one play on a background tab nobody is viewing.
//
// Runs in jsdom for `sessionStorage` + `document`. Each test re-imports the
// module (`vi.resetModules()`), which is exactly what a page load does: fresh
// in-memory state, while the tab's sessionStorage survives.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** 10:00 UTC on 16 Oct 2026 — autumn on the Cairo calendar. */
const AUTUMN_NOW = new Date("2026-10-16T10:00:00Z");

let visibility: DocumentVisibilityState = "visible";

/** jsdom has no `matchMedia`; answer the two reduced-motion queries consistently. */
function stubReducedMotion(reduce: boolean) {
  const answers: Record<string, boolean> = {
    "(prefers-reduced-motion: reduce)": reduce,
    "(prefers-reduced-motion: no-preference)": !reduce,
  };
  window.matchMedia = ((query: string) => ({
    matches: answers[query] ?? false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

/** A fresh page load: new module state, same tab session. */
async function loadPage() {
  vi.resetModules();
  const { useSeasonalIntro } = await import("@/lib/seasonal-intro-store");
  return useSeasonalIntro;
}

beforeEach(() => {
  vi.useFakeTimers({ now: AUTUMN_NOW });
  sessionStorage.clear();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  stubReducedMotion(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useSeasonalIntro — first visit", () => {
  it("plays the store's current season", async () => {
    const intro = await loadPage();
    intro.getState().begin();
    expect(intro.getState().season).toBe("autumn");
  });

  it("ends by itself after three seconds", async () => {
    const intro = await loadPage();
    intro.getState().begin();

    vi.advanceTimersByTime(2_999);
    expect(intro.getState().season).toBe("autumn");

    vi.advanceTimersByTime(1);
    expect(intro.getState().season).toBeNull();
  });

  it("ends immediately when skipped", async () => {
    const intro = await loadPage();
    intro.getState().begin();
    intro.getState().finish();
    expect(intro.getState().season).toBeNull();
  });
});

describe("useSeasonalIntro — once per session", () => {
  it("does not replay after a reload in the same tab", async () => {
    (await loadPage()).getState().begin();

    const reloaded = await loadPage();
    reloaded.getState().begin();
    expect(reloaded.getState().season).toBeNull();
  });

  it("keeps its original end time through a repeat begin()", async () => {
    const intro = await loadPage();
    intro.getState().begin();
    vi.advanceTimersByTime(1_000);

    // StrictMode re-runs effects, and returning to "/" mounts a fresh overlay.
    intro.getState().begin();
    expect(intro.getState().season).toBe("autumn");

    vi.advanceTimersByTime(1_999);
    expect(intro.getState().season).toBe("autumn");
    vi.advanceTimersByTime(1);
    expect(intro.getState().season).toBeNull();
  });

  it("plays again in the same tab once the season has turned", async () => {
    (await loadPage()).getState().begin();

    vi.setSystemTime(new Date("2026-12-01T10:00:00Z")); // winter in Cairo
    const reloaded = await loadPage();
    reloaded.getState().begin();
    expect(reloaded.getState().season).toBe("winter");
  });
});

describe("useSeasonalIntro — staying out of the way", () => {
  it("never plays under prefers-reduced-motion", async () => {
    stubReducedMotion(true);
    const intro = await loadPage();
    intro.getState().begin();
    expect(intro.getState().season).toBeNull();
  });

  it("does not play, or throw, when the browser blocks sessionStorage", async () => {
    // What Chrome does with site data blocked: reading the property throws.
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("Access is denied for this document.", "SecurityError");
    });
    const intro = await loadPage();

    expect(() => intro.getState().begin()).not.toThrow();
    expect(intro.getState().season).toBeNull();
  });

  it("waits until a background tab is first shown", async () => {
    visibility = "hidden";
    const intro = await loadPage();
    intro.getState().begin();
    intro.getState().begin(); // StrictMode's second effect run

    vi.advanceTimersByTime(10_000);
    expect(intro.getState().season).toBeNull();

    setVisibility("visible");
    expect(intro.getState().season).toBe("autumn");
  });
});
