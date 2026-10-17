"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { AnimatePresence } from "framer-motion";
import { useSeasonalIntro } from "@/lib/seasonal-intro-store";

/**
 * The scene is its own chunk, fetched the first time it renders — once the
 * store has decided to play. A failed fetch (offline, or a deploy replaced the
 * build) ends the intro and resolves to an empty scene: React.lazy would
 * otherwise throw it to the route's error boundary, and a decoration must never
 * take the homepage down.
 */
const SeasonScene = dynamic(
  () =>
    import("@/components/SeasonScene").catch((err: unknown) => {
      console.warn("Seasonal intro skipped — its scene failed to load:", err);
      useSeasonalIntro.getState().finish();
      return { default: () => null };
    }),
  { ssr: false },
);

/**
 * A brief seasonal welcome over the homepage — snow in winter, petals in
 * spring, golden dust in summer, leaves in autumn (the store's Cairo calendar
 * month, `storeSeason`). It plays at most once per tab session, never under
 * prefers-reduced-motion, and fades out after three seconds or on "Skip intro"
 * / Escape; `useSeasonalIntro` owns all of those decisions.
 *
 * The homepage is ISR-cached, so nothing here reaches the server render: the
 * store decides after hydration and the scene mounts in a portal. This module
 * is only that decision; the scene (`SeasonScene.tsx`) downloads once the intro
 * is going to play — nothing at all for a visitor who won't see it — and its
 * three seconds start when it reaches the screen, not when it was asked for.
 * It can't shift layout (fixed, below the navbar's z-50 and the drawers' z-40
 * backdrops) or take a click (pointer-events-none — only the skip button opts
 * back in).
 * Particles are inline SVG and CSS gradients — no image requests, and nothing
 * that can become the LCP element. Framer Motion fades the scene in and out;
 * the particles themselves run on compositor-only CSS keyframes (globals.css),
 * so they cost the main thread nothing while the page is still settling in.
 */
export default function SeasonalOverlay() {
  const season = useSeasonalIntro((s) => s.season);
  const begin = useSeasonalIntro((s) => s.begin);
  const shown = useSeasonalIntro((s) => s.shown);
  const finish = useSeasonalIntro((s) => s.finish);

  // Decide once the page has hydrated. Idempotent — a remount or StrictMode's
  // second run can't replay or extend the intro.
  useEffect(() => {
    begin();
  }, [begin]);

  // Escape skips it — the skip button sits last in the tab order, and the
  // intro is over before a keyboard user could tab their way to it.
  useEffect(() => {
    if (!season) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") finish();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [season, finish]);

  // Portal renders client-side only (no `document` during SSR). The intro is
  // never playing on first paint, so there's nothing to hydrate-mismatch.
  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {season && <SeasonScene key={season} season={season} onShown={shown} onSkip={finish} />}
    </AnimatePresence>,
    document.body,
  );
}
