import { useEffect, useRef } from "react";

/**
 * Keyboard focus for a modal dialog or drawer — attach the returned ref to the
 * `role="dialog"` element and pass whether it's open:
 *   • opening moves focus to its first control, unless an autoFocus field
 *     already took it;
 *   • Tab / Shift+Tab wrap inside the topmost open dialog (`aria-modal` hides
 *     the page from screen readers but doesn't stop Tab walking into it);
 *   • closing returns focus to the control that opened it.
 * Escape stays with each dialog, which already owns its close logic.
 */

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** Open dialogs, innermost last — only the top one handles Tab. */
const openDialogs: HTMLElement[] = [];

/**
 * The two most recent focus targets. An autoFocus field moves focus into a
 * dialog during React's commit, BEFORE the hook's effect runs — at which point
 * the opener is `previousFocus`. A pointer press clears the trail, because
 * Safari doesn't focus a pressed button: the dialog it opens must not hand
 * focus back to whatever was focused long before.
 */
let currentFocus: HTMLElement | null = null;
let previousFocus: HTMLElement | null = null;

if (typeof document !== "undefined") {
  document.addEventListener(
    "focusin",
    (e) => {
      previousFocus = currentFocus;
      currentFocus = e.target instanceof HTMLElement ? e.target : null;
    },
    true,
  );
  document.addEventListener(
    "pointerdown",
    () => {
      currentFocus = null;
    },
    true,
  );
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const top = openDialogs[openDialogs.length - 1];
    if (top) trapTab(top, e);
  });
}

function isVisible(el: HTMLElement): boolean {
  return typeof el.checkVisibility === "function"
    ? el.checkVisibility()
    : el.getClientRects().length > 0;
}

function focusables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible);
}

function trapTab(container: HTMLElement, e: KeyboardEvent) {
  const items = focusables(container);
  const active = document.activeElement;
  const inside = active instanceof Node && container.contains(active);

  if (items.length === 0) {
    e.preventDefault();
    container.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey ? !inside || active === first : !inside || active === last) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  }
}

export function useDialogFocus<T extends HTMLElement = HTMLDivElement>(open: boolean) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const container = ref.current;
    if (!open || !container) return;

    const active = document.activeElement;
    const returnTo =
      active instanceof HTMLElement && container.contains(active)
        ? previousFocus
        : active instanceof HTMLElement && active !== document.body
          ? active
          : null;

    openDialogs.push(container);
    if (!container.contains(document.activeElement)) {
      const [first] = focusables(container);
      if (first) {
        first.focus({ preventScroll: true });
      } else {
        if (!container.hasAttribute("tabindex")) container.tabIndex = -1;
        container.focus({ preventScroll: true });
      }
    }

    return () => {
      openDialogs.splice(openDialogs.lastIndexOf(container), 1);
      // Only take focus back if it's still ours to give — not if the user has
      // already moved on to something else.
      const now = document.activeElement;
      const ours = !now || now === document.body || container.contains(now);
      if (ours && returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    };
  }, [open]);

  return ref;
}
