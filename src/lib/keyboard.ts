/**
 * The search palette's shortcut: Cmd+K on Apple platforms, Ctrl+K everywhere
 * else — never both. On macOS, Ctrl+K in a text field is the system "delete to
 * end of line", so claiming it there would break typing in every form. The
 * physical K key (`code`) counts too, so the shortcut survives an Arabic
 * layout, where `key` is "ن".
 */
export function isSearchShortcut(
  e: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  apple: boolean,
): boolean {
  const isK = e.code === "KeyK" || e.key === "k" || e.key === "K";
  if (!isK || e.altKey || e.shiftKey) return false;
  return apple ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

interface NavigatorPlatform {
  platform: string;
  /** User-Agent Client Hints (Chromium) — the non-deprecated source when present. */
  userAgentData?: { platform: string };
}

/** macOS, iOS and iPadOS — where Cmd, not Ctrl, is the command key. */
export function isApplePlatform(
  nav: NavigatorPlatform = navigator as Navigator & NavigatorPlatform,
): boolean {
  const platform = nav.userAgentData?.platform || nav.platform;
  return /mac|iphone|ipad|ipod/i.test(platform);
}
