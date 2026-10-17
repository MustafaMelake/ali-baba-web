import { create } from "zustand";
import { storeSeason, type Season } from "@/lib/seasons";

/**
 * Once-per-session latch for the homepage's seasonal intro
 * (`src/components/SeasonalOverlay.tsx`).
 *
 * The homepage is served from a shared ISR cache, so the server can't decide
 * whether THIS visitor sees the intro — the cached HTML always ships without
 * it. The overlay calls `begin()` once it has mounted (idempotent, the same
 * shape as the wishlist store's `ensureLoaded`), and the first call per page
 * load decides:
 *   • prefers-reduced-motion → never plays;
 *   • this tab already played this season's intro → never plays;
 *   • sessionStorage blocked → never plays: the once-per-session promise can't
 *     be kept, and an intro on every reload is worse than none;
 *   • a background tab → waits for its first visible moment, so the timer
 *     never runs out while nobody is looking.
 * The three seconds start at `shown()`, which the scene calls once it is on
 * screen: the scene is its own chunk and arrives a moment after `begin()`, so
 * timing from the decision would shorten the intro by that download.
 * The status lives here rather than in the component, so leaving the homepage
 * and coming back within one page load can't replay it.
 */

/** sessionStorage key — holds the season whose intro this tab has played. */
const STORAGE_KEY = "ali-baba-seasonal-intro";

/** How long the intro stays on screen (from `shown()`) before it fades out. */
export const SEASONAL_INTRO_MS = 3000;

type IntroStatus = "idle" | "waiting" | "playing" | "done";

interface SeasonalIntroState {
  status: IntroStatus;
  /** The season on screen — set only while the intro is playing. */
  season: Season | null;
  /** Decide (once per page load) whether to play. */
  begin: () => void;
  /** The scene is on screen — start its three seconds. Idempotent. */
  shown: () => void;
  /** End the intro now — the timer, the skip button and Escape all land here. */
  finish: () => void;
}

/**
 * Records `season` as played in this tab. False when this tab already played
 * it, or when storage is unavailable — with site data blocked, merely reading
 * `window.sessionStorage` throws.
 */
function claimSession(season: Season): boolean {
  try {
    const storage = window.sessionStorage;
    if (storage.getItem(STORAGE_KEY) === season) return false;
    storage.setItem(STORAGE_KEY, season);
    return true;
  } catch {
    return false;
  }
}

/** Set once the three seconds are running, so a remount can't extend them. */
let clockStarted = false;

export const useSeasonalIntro = create<SeasonalIntroState>()((set, get) => ({
  status: "idle",
  season: null,

  begin: () => {
    if (get().status !== "idle") return;

    if (document.visibilityState !== "visible") {
      set({ status: "waiting" });
      const onVisible = () => {
        if (document.visibilityState !== "visible") return;
        document.removeEventListener("visibilitychange", onVisible);
        set({ status: "idle" });
        get().begin();
      };
      document.addEventListener("visibilitychange", onVisible);
      return;
    }

    const season = storeSeason();
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceMotion || !claimSession(season)) {
      set({ status: "done" });
      return;
    }

    set({ status: "playing", season });
  },

  shown: () => {
    if (get().status !== "playing" || clockStarted) return;
    clockStarted = true;
    setTimeout(get().finish, SEASONAL_INTRO_MS);
  },

  finish: () => {
    if (get().status === "playing") set({ status: "done", season: null });
  },
}));
