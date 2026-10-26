// @vitest-environment jsdom
//
// ─────────────────────────────────────────────────────────────────────────────
// Phone grid density — the pre-paint script + the toggle's writer.
//
// The promises: the saved choice reaches <html data-grid> before first paint
// (the inline script), junk or blocked storage falls back to the 2-up default
// without throwing (a broken script would sit in every page's <head>), and the
// toggle writes the attribute + storage and notifies its subscribers.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GRID_DENSITY_SCRIPT,
  GRID_DENSITY_STORAGE_KEY,
  readGridDensity,
  setGridDensity,
  subscribeGridDensity,
} from "@/lib/grid-density";

/** Run the inline <head> script exactly as the browser would. */
const runScript = () => new Function(GRID_DENSITY_SCRIPT)();

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-grid");
});

describe("GRID_DENSITY_SCRIPT (pre-paint)", () => {
  it("copies a saved 1-up choice onto <html>", () => {
    window.localStorage.setItem(GRID_DENSITY_STORAGE_KEY, "1");
    runScript();
    expect(document.documentElement.getAttribute("data-grid")).toBe("1");
    expect(readGridDensity()).toBe("1");
  });

  it("leaves the attribute off (= 2-up) when nothing or junk is saved", () => {
    runScript();
    expect(document.documentElement.hasAttribute("data-grid")).toBe(false);
    window.localStorage.setItem(GRID_DENSITY_STORAGE_KEY, "<script>");
    runScript();
    expect(document.documentElement.hasAttribute("data-grid")).toBe(false);
    expect(readGridDensity()).toBe("2");
  });

  it("never throws when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(runScript).not.toThrow();
    expect(readGridDensity()).toBe("2");
  });
});

describe("setGridDensity (the toggle)", () => {
  it("updates <html>, remembers the choice, and notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeGridDensity(listener);
    setGridDensity("1");
    expect(document.documentElement.getAttribute("data-grid")).toBe("1");
    expect(window.localStorage.getItem(GRID_DENSITY_STORAGE_KEY)).toBe("1");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setGridDensity("2");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(readGridDensity()).toBe("2");
  });

  it("still applies on this page when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(() => setGridDensity("1")).not.toThrow();
    expect(readGridDensity()).toBe("1");
  });
});
