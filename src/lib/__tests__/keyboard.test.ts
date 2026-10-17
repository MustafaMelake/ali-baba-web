// ─────────────────────────────────────────────────────────────────────────────
// The search palette's keyboard shortcut (src/lib/keyboard.ts).
//
// Cmd+K on Apple platforms, Ctrl+K everywhere else — never both. On macOS,
// Ctrl+K in a text field is the system "delete to end of line", so claiming it
// there would break typing in the checkout form and the cart notes. The
// physical K key counts (`code`), so the shortcut survives an Arabic layout.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { isApplePlatform, isSearchShortcut } from "@/lib/keyboard";

type Keys = Partial<Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">>;

const press = (keys: Keys) => ({
  key: "k",
  code: "KeyK",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...keys,
});

describe("isSearchShortcut — Apple platforms", () => {
  it("opens on Cmd+K", () => {
    expect(isSearchShortcut(press({ metaKey: true }), true)).toBe(true);
  });

  it("leaves Ctrl+K to the system's delete-to-end-of-line", () => {
    expect(isSearchShortcut(press({ ctrlKey: true }), true)).toBe(false);
  });
});

describe("isSearchShortcut — everywhere else", () => {
  it("opens on Ctrl+K", () => {
    expect(isSearchShortcut(press({ ctrlKey: true }), false)).toBe(true);
  });

  it("ignores the Windows/Super key + K", () => {
    expect(isSearchShortcut(press({ metaKey: true }), false)).toBe(false);
  });
});

describe("isSearchShortcut — the key itself", () => {
  it("matches the physical K key under an Arabic layout", () => {
    expect(isSearchShortcut(press({ key: "ن", ctrlKey: true }), false)).toBe(true);
  });

  it("ignores a plain K and other letters", () => {
    expect(isSearchShortcut(press({}), false)).toBe(false);
    expect(isSearchShortcut(press({ key: "j", code: "KeyJ", ctrlKey: true }), false)).toBe(false);
  });

  it("ignores K with Shift or Alt added", () => {
    expect(isSearchShortcut(press({ ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(isSearchShortcut(press({ ctrlKey: true, altKey: true }), false)).toBe(false);
  });
});

describe("isApplePlatform", () => {
  it.each([
    ["MacIntel", true],
    ["iPhone", true],
    ["iPad", true],
    ["Win32", false],
    ["Linux x86_64", false],
  ])("%s → %s", (platform, apple) => {
    expect(isApplePlatform({ platform })).toBe(apple);
  });

  it("prefers User-Agent Client Hints when the browser offers them", () => {
    expect(isApplePlatform({ platform: "", userAgentData: { platform: "macOS" } })).toBe(true);
    expect(isApplePlatform({ platform: "MacIntel", userAgentData: { platform: "Windows" } })).toBe(false);
  });
});
