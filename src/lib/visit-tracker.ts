// ─────────────────────────────────────────────────────────────────────────────
// Storefront visit tracker — client-side, cookie-free, fire-and-forget.
//
// The catalog pages are ISR: a cached hit runs no server code, so a server-side
// counter would miss most visits (and adding one would force those routes
// dynamic). The browser reports instead, through the public recordVisitEvents
// action. Nothing here may ever block or break navigation: events are queued,
// flushed in one batch after a short pause (or when the tab hides, or the batch
// fills), and every failure is swallowed.
//
// Privacy-light: the visitor id is a random UUID in localStorage — no cookie,
// no account link, no query string (pathname only). Where storage is blocked
// the id lives in memory for this page load, so that visitor counts once per
// load rather than not at all. Automated browsers (navigator.webdriver) never
// report; the server additionally drops bot user agents.
// ─────────────────────────────────────────────────────────────────────────────

import { recordVisitEvents } from "@/lib/actions/visits";
import { VISIT_BATCH_MAX, VISIT_PATH_MAX, type VisitEventKind } from "@/lib/validators";

export const VISITOR_ID_KEY = "ali-baba-visitor";

/** How long events wait for company before one batched call goes out. */
export const VISIT_FLUSH_DELAY_MS = 1500;

/** The same event (type + path + product) inside this window counts once — absorbs dev double-effects and rapid re-renders. */
const DEDUPE_WINDOW_MS = 1000;

type QueuedEvent = {
  type: VisitEventKind;
  path: string;
  productId?: string;
  branchId?: string;
};

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let memoryVisitorId: string | null = null;
let hideListenerAdded = false;
const lastSeen = new Map<string, number>();

/** RFC 4122 v4 — crypto.randomUUID where available (secure contexts), else built from getRandomValues. */
function randomUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** This browser's anonymous visitor id — persisted when storage allows, in-memory otherwise. */
export function getVisitorId(): string {
  try {
    const saved = window.localStorage.getItem(VISITOR_ID_KEY);
    if (saved) return saved;
    const fresh = randomUuid();
    window.localStorage.setItem(VISITOR_ID_KEY, fresh);
    return fresh;
  } catch {
    memoryVisitorId ??= randomUuid();
    return memoryVisitorId;
  }
}

/** Send whatever is queued, now. Safe to call with an empty queue. */
export function flushVisits(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (queue.length === 0) return;
  const events = queue;
  queue = [];
  try {
    // Fire-and-forget: analytics only — never awaited, never toasted.
    recordVisitEvents({ visitorId: getVisitorId(), events }).catch(() => {});
  } catch {
    // A synchronous failure (no crypto, serialization) must not reach the page.
  }
}

/**
 * Report one storefront event. `path` defaults to the current pathname. Never
 * throws, never blocks; no-ops on the server and in automated browsers.
 */
export function trackVisit(
  type: VisitEventKind,
  extra: { productId?: string; branchId?: string; path?: string } = {},
): void {
  if (typeof window === "undefined" || navigator.webdriver) return;
  try {
    const path = (extra.path ?? window.location.pathname).slice(0, VISIT_PATH_MAX) || "/";
    const key = `${type}|${path}|${extra.productId ?? ""}`;
    const now = Date.now();
    const seen = lastSeen.get(key);
    if (seen != null && now - seen < DEDUPE_WINDOW_MS) return;
    lastSeen.set(key, now);

    queue.push({
      type,
      path,
      ...(extra.productId ? { productId: extra.productId } : {}),
      ...(extra.branchId ? { branchId: extra.branchId } : {}),
    });

    if (!hideListenerAdded) {
      hideListenerAdded = true;
      // Leaving or backgrounding the tab: send now rather than lose the batch.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flushVisits();
      });
    }

    if (queue.length >= VISIT_BATCH_MAX) flushVisits();
    else timer ??= setTimeout(flushVisits, VISIT_FLUSH_DELAY_MS);
  } catch {
    // Analytics must never break the storefront.
  }
}
