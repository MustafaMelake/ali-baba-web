"use client";

import { useEffect, useMemo, type CSSProperties, type ReactNode } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { SEASONAL_INTRO_MS } from "@/lib/seasonal-intro-store";
import type { Season } from "@/lib/seasons";
import { cn } from "@/lib/utils";

// The seasonal intro's scene — every shape, palette and particle layout. It's
// its own chunk: SeasonalOverlay fetches it only once the intro is about to
// play, so a visitor who never sees the intro never downloads any of this.

/** Inline style plus the custom properties its keyframes read. */
type KeyframeStyle = CSSProperties & Record<`--${string}`, string>;

type Range = readonly [min: number, max: number];

// ─── Shapes — inline SVG and CSS gradients on a 24×24 grid, no images ───────

interface ShapeProps {
  /** A color, a `url(#season-…)` gradient, or (orbs) a CSS background. */
  tone: string;
  /** Static depth styling — tier opacity and depth-of-field blur. */
  style: CSSProperties;
}

const CRYSTAL_ARMS = [0, 60, 120, 180, 240, 300].map((angle) => (
  <path
    key={angle}
    d="M12 12V2.6M12 5.9 9.7 3.6M12 5.9l2.3-2.3M12 8.8l-1.6-1.6M12 8.8l1.6-1.6"
    transform={`rotate(${angle} 12 12)`}
    vectorEffect="non-scaling-stroke"
  />
));

/** Ice crystal: a white line drawn over an ice-blue one, so it reads on the white page and on the teal hero alike. */
function Crystal({ tone, style }: ShapeProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round" className="block size-full" style={style}>
      <g stroke={tone} strokeWidth={2.4}>{CRYSTAL_ARMS}</g>
      <g stroke="#fff" strokeWidth={1.1}>{CRYSTAL_ARMS}</g>
    </svg>
  );
}

/** A soft radial disc — powder snow, or a mote of golden dust. */
function Orb({ tone, style }: ShapeProps) {
  return <span className="block size-full rounded-full" style={{ background: tone, ...style }} />;
}

function Petal({ tone, style }: ShapeProps) {
  return (
    <svg viewBox="0 0 24 24" className="block size-full" style={style}>
      <path
        d="M12 21.5C8.2 18.4 5.8 13.6 6.3 9.2 6.7 6.2 8.4 4.6 10.2 5c.9.2 1.5.9 1.8 1.7.3-.8.9-1.5 1.8-1.7 1.8-.4 3.5 1.2 3.9 4.2.5 4.4-1.9 9.2-5.7 12.3Z"
        fill={tone}
      />
      <path d="M12 19.6c-.5-3.6-.4-7.6.1-10.9" fill="none" stroke="#fff" strokeOpacity={0.45} strokeWidth={0.7} strokeLinecap="round" />
    </svg>
  );
}

/** Orange-blossom petal — slender, with a slight curl. */
function SlenderPetal({ tone, style }: ShapeProps) {
  return (
    <svg viewBox="0 0 24 24" className="block size-full" style={style}>
      <path
        d="M12.6 2.6C16.4 6 16.8 12.6 14.2 17.6c-1 2-2 3.3-2.8 3.8-.8-.8-1.7-2.4-2.3-4.6C7.8 11.6 9 5.6 12.6 2.6Z"
        fill={tone}
      />
      <path d="M11.6 19.8c.6-4.4 1-9.4.9-14.6" fill="none" stroke="#fff" strokeOpacity={0.45} strokeWidth={0.7} strokeLinecap="round" />
    </svg>
  );
}

function Maple({ tone, style }: ShapeProps) {
  return (
    <svg viewBox="0 0 24 24" className="block size-full" style={style}>
      <path
        d="M12 1.2 13.3 4.8 15.6 3.9 15.2 7.6 19.8 5.6 22.6 6.4 20.4 9.4 21.6 11 17.4 12.6 19.4 15.8 15.6 15.4 13 17.6 12.4 17.8V22H11.6V17.8L11 17.6 8.4 15.4 4.6 15.8 6.6 12.6 2.4 11 3.6 9.4 1.4 6.4 4.2 5.6 8.8 7.6 8.4 3.9 10.7 4.8Z"
        fill={tone}
        stroke={tone}
        strokeWidth={0.6}
        strokeLinejoin="round"
      />
      <path
        d="M12 17.6V4M12 17.2 20.6 7.2M12 17.2 3.4 7.2M12 17.4 17.8 14.6M12 17.4 6.2 14.6"
        fill="none"
        stroke="#6e2d0f"
        strokeOpacity={0.3}
        strokeWidth={0.5}
        strokeLinecap="round"
      />
    </svg>
  );
}

function Leaf({ tone, style }: ShapeProps) {
  return (
    <svg viewBox="0 0 24 24" className="block size-full" style={style}>
      <path d="M12 20.2V23" stroke={tone} strokeWidth={0.9} strokeLinecap="round" />
      <path d="M12 2c5.4 3.6 7.4 10.6.8 17.6L12 20.4l-.8-.8C4.6 12.6 6.6 5.6 12 2Z" fill={tone} />
      <path
        d="M12 4.4v15M12 8l2.6-1.6M12 8 9.4 6.4M12 11.4l3.4-2M12 11.4l-3.4-2M12 14.8l2.8-1.8M12 14.8l-2.8-1.8"
        fill="none"
        stroke="#6e2d0f"
        strokeOpacity={0.32}
        strokeWidth={0.55}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Four-point glint — light catching gold leaf. */
function Glint({ tone, style }: ShapeProps) {
  return (
    <svg viewBox="0 0 24 24" className="block size-full" style={style}>
      <path d="M12 1.5c.9 6.7 3.8 9.6 10.5 10.5-6.7.9-9.6 3.8-10.5 10.5-.9-6.7-3.8-9.6-10.5-10.5C8.2 11.1 11.1 8.2 12 1.5Z" fill={tone} />
    </svg>
  );
}

const PETAL_AXIS = { x1: 0, y1: 1, x2: 0, y2: 0 }; // deep at the base, pale at the edge
const LEAF_AXIS = { x1: 0.2, y1: 0, x2: 0.8, y2: 1 }; // sunlit edge to shaded edge

/** Shared by id from every petal and leaf — the overlay is a singleton, so the ids stay unique. */
const GRADIENTS = [
  { id: "season-rose", axis: PETAL_AXIS, from: "#e07c96", to: "#fadbe3" },
  { id: "season-blush", axis: PETAL_AXIS, from: "#ee9fb1", to: "#fdeaf0" },
  { id: "season-blossom", axis: PETAL_AXIS, from: "#eeb09a", to: "#fff6ef" },
  { id: "season-amber", axis: LEAF_AXIS, from: "#f6c25a", to: "#d9822a" },
  { id: "season-ember", axis: LEAF_AXIS, from: "#f39a5e", to: "#cf5520" },
  { id: "season-russet", axis: LEAF_AXIS, from: "#dc7b45", to: "#9a3c1c" },
  { id: "season-ochre", axis: LEAF_AXIS, from: "#edc96f", to: "#b4862b" },
] as const;

// ─── Scenes ─────────────────────────────────────────────────────────────────

interface Kind {
  Shape: (props: ShapeProps) => ReactNode;
  tones: readonly string[];
  /** Size relative to the scene's — fine powder among the crystals, say. */
  scale?: number;
}

interface Scene {
  /** PRNG seed — one stable arrangement per season. */
  seed: number;
  /** Particles on desktop; phones render every other one. */
  count: number;
  kinds: readonly Kind[];
  /** Travel keyframes — falling, or rising for summer's dust. */
  travel: "season-fall" | "season-rise";
  /** Nearest-tier size (px); farther tiers scale it down. */
  size: Range;
  /** Nearest-tier seconds to cross the viewport; farther tiers take longer. Must outlast the intro (see CROSSINGS_PER_ITERATION). */
  crossing: Range;
  /** Where particles start, in % of the viewport width — shifted upwind of the drift. */
  band: Range;
  /** Net sideways travel per crossing (vw) — the wind. */
  drift: Range;
  /** The pendulum swing: half-amplitude (px), the tilt riding it (deg), half-period (s). */
  sway: Range;
  rock: Range;
  swing: Range;
  /** Each particle's own turn: keyframes, angle (deg), half-period (s). */
  turn: "season-spin" | "season-flutter" | "season-twinkle";
  turnAngle: Range;
  turnPeriod: Range;
  /** Depth-of-field blur on the nearest tier (px). */
  nearBlur: number;
  /** Ambient light behind the particles. */
  glow?: string;
  /** The skip button's countdown hairline. */
  accent: string;
}

const SCENES: Record<Season, Scene> = {
  // Soft, elegant snowfall — crisp crystals in a fine powder. Every snow tone
  // is tinted ice-blue: pure white would vanish against the white page.
  winter: {
    seed: 1201,
    count: 32,
    kinds: [
      { Shape: Crystal, tones: ["#a9cad8", "#8fb8c9"] },
      {
        Shape: Orb,
        tones: ["radial-gradient(circle, rgba(188,214,226,0.95) 0 30%, rgba(188,214,226,0.5) 50%, rgba(188,214,226,0) 70%)"],
        scale: 0.4,
      },
    ],
    travel: "season-fall",
    size: [20, 30],
    crossing: [7, 9],
    band: [0, 100],
    drift: [-3, 5],
    sway: [6, 16],
    rock: [0, 0],
    swing: [2.2, 3.4],
    turn: "season-spin",
    turnAngle: [40, 90],
    turnPeriod: [4, 7],
    nearBlur: 0,
    accent: "#8fb8c9",
  },
  // Rose and orange-blossom petals on a breeze from the left.
  spring: {
    seed: 403,
    count: 24,
    kinds: [
      { Shape: Petal, tones: ["url(#season-rose)", "url(#season-blush)"] },
      { Shape: SlenderPetal, tones: ["url(#season-blossom)", "url(#season-rose)"] },
    ],
    travel: "season-fall",
    size: [24, 34],
    crossing: [8.5, 11],
    band: [-20, 90],
    drift: [12, 26],
    sway: [16, 34],
    rock: [20, 45],
    swing: [1.8, 2.8],
    turn: "season-flutter",
    turnAngle: [30, 60],
    turnPeriod: [1.2, 2.2],
    nearBlur: 1,
    accent: "#e07c96",
  },
  // Sun-warmed golden dust rising through a soft light leak.
  summer: {
    seed: 706,
    count: 30,
    kinds: [
      {
        Shape: Orb,
        tones: [
          "radial-gradient(circle, rgba(246,201,96,1) 0 16%, rgba(236,182,70,0.7) 34%, rgba(228,168,56,0) 66%)",
          "radial-gradient(circle, rgba(249,221,146,1) 0 16%, rgba(243,204,118,0.65) 36%, rgba(236,190,90,0) 66%)",
        ],
      },
      { Shape: Glint, tones: ["#e8b74c", "#d29a2e", "#f2d68b"] },
    ],
    travel: "season-rise",
    size: [16, 26],
    crossing: [15, 21],
    band: [0, 100],
    drift: [-4, 4],
    sway: [4, 10],
    rock: [0, 0],
    swing: [2.6, 4],
    turn: "season-twinkle",
    turnAngle: [0, 45],
    turnPeriod: [1.1, 2.2],
    nearBlur: 0,
    glow: "radial-gradient(ellipse 70% 55% at 88% 0%, rgba(246,198,96,0.26), transparent 70%)",
    accent: "#d29a2e",
  },
  // Amber, ember and russet leaves — the brand's own orange against its teal.
  autumn: {
    seed: 910,
    count: 22,
    kinds: [
      { Shape: Maple, tones: ["url(#season-ember)", "url(#season-amber)", "url(#season-russet)"] },
      { Shape: Leaf, tones: ["url(#season-ochre)", "url(#season-ember)", "url(#season-russet)"] },
    ],
    travel: "season-fall",
    size: [34, 46],
    crossing: [6.5, 9],
    band: [-8, 96],
    drift: [-4, 12],
    sway: [26, 56],
    rock: [18, 40],
    swing: [1.5, 2.4],
    turn: "season-flutter",
    turnAngle: [25, 60],
    turnPeriod: [1.6, 2.8],
    nearBlur: 1.2,
    accent: "#e06c2b",
  },
};

/** Far → near: farther particles are smaller, slower and fainter — parallax depth. */
const TIERS = [
  { scale: 0.55, slow: 1.7, opacity: 0.55 },
  { scale: 0.78, slow: 1.3, opacity: 0.8 },
  { scale: 1, slow: 1, opacity: 0.95 },
] as const;

// ─── Layout ─────────────────────────────────────────────────────────────────

interface Particle {
  id: number;
  Shape: Kind["Shape"];
  tone: string;
  left: number;
  size: number;
  opacity: number;
  blur: number;
  /** Per layer: CSS animation duration and (negative) delay in seconds, plus its distances. */
  travelDuration: number;
  travelDelay: number;
  drift: number;
  swayDuration: number;
  swayDelay: number;
  sway: number;
  rock: number;
  turnDuration: number;
  turnDelay: number;
  turn: number;
  /** Phones render every other particle — still evenly spread, half the work. */
  phoneHidden: boolean;
}

/**
 * Motion repeats per keyframe iteration (globals.css). Iteration boundaries
 * cost a main-thread style pass, so each particle's first one must land after
 * the intro has left the screen (≈3.9s): phases come from the first crossing
 * or first full swing, which puts that boundary a whole crossing, or six
 * half-swings, away. Keep `crossing` above ~4s and `swing` / `turnPeriod`
 * above ~0.7s.
 */
const CROSSINGS_PER_ITERATION = 2;
const HALF_SWINGS_PER_ITERATION = 8;

/** Two decimals keeps the inline styles short. */
const round = (n: number) => Math.round(n * 100) / 100;

/** Mulberry32 — a tiny seeded PRNG, so a season scatters the same way every time. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Spreads a scene's particles evenly: each owns a column across the screen and
 * a slice of the crossing, with the slices shuffled so position across and
 * position down are unrelated (no clumps, no gaps, no diagonal stairs).
 * Negative delays start every particle mid-flight, so the season is already
 * falling on the very first frame.
 */
function scatter(scene: Scene): Particle[] {
  const random = seededRandom(scene.seed);
  const between = ([min, max]: Range) => round(min + random() * (max - min));
  const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)];
  const sign = () => (random() < 0.5 ? -1 : 1);

  const n = scene.count;
  const slices = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [slices[i], slices[j]] = [slices[j], slices[i]];
  }

  const [bandStart, bandEnd] = scene.band;
  return slices.map((slice, i) => {
    // ≈35% far, 40% mid, 25% near.
    const r = random();
    const tier = r < 0.35 ? 0 : r < 0.75 ? 1 : 2;
    const { scale, slow, opacity } = TIERS[tier];
    const kind = pick(scene.kinds);
    const crossing = round(between(scene.crossing) * slow);
    const swing = between(scene.swing);
    const turnPeriod = between(scene.turnPeriod);

    return {
      id: i,
      Shape: kind.Shape,
      tone: pick(kind.tones),
      left: bandStart + ((i + random()) / n) * (bandEnd - bandStart),
      size: Math.round(between(scene.size) * scale * (kind.scale ?? 1)),
      opacity,
      blur: tier === 2 ? scene.nearBlur : 0,
      travelDuration: round(crossing * CROSSINGS_PER_ITERATION),
      travelDelay: -round(((slice + random()) / n) * crossing),
      drift: between(scene.drift),
      swayDuration: round(swing * HALF_SWINGS_PER_ITERATION),
      swayDelay: -between([0, 2 * swing]),
      sway: Math.round(between(scene.sway) * scale),
      rock: between(scene.rock) * sign(),
      turnDuration: round(turnPeriod * HALF_SWINGS_PER_ITERATION),
      turnDelay: -between([0, 2 * turnPeriod]),
      turn: between(scene.turnAngle) * sign(),
      phoneHidden: i % 2 === 1,
    };
  });
}

// ─── Rendering ──────────────────────────────────────────────────────────────

/**
 * One particle as three nested layers, each running one keyframe on the
 * compositor: the crossing (linear), the pendulum swing, and the particle's
 * own turn. Opacity and blur sit on the static shape inside, so no animated
 * layer needs an offscreen pass to apply them.
 */
function Drifter({ particle: p, scene }: { particle: Particle; scene: Scene }) {
  const travel: KeyframeStyle = {
    left: `${p.left}%`,
    width: p.size,
    height: p.size,
    animation: `${scene.travel} ${p.travelDuration}s linear ${p.travelDelay}s infinite`,
    "--drift": `${p.drift}vw`,
  };
  const swing: KeyframeStyle = {
    animation: `season-sway ${p.swayDuration}s ease-in-out ${p.swayDelay}s infinite`,
    "--sway": `${p.sway}px`,
    "--rock": `${p.rock}deg`,
  };
  const turn: KeyframeStyle = {
    animation: `${scene.turn} ${p.turnDuration}s ease-in-out ${p.turnDelay}s infinite`,
    "--turn": `${p.turn}deg`,
  };
  const { Shape } = p;

  return (
    <span
      className={cn("absolute top-0 block will-change-transform", p.phoneHidden && "max-md:hidden")}
      style={travel}
    >
      <span className="block size-full will-change-transform" style={swing}>
        <span className="block size-full will-change-transform" style={turn}>
          <Shape
            tone={p.tone}
            style={{ opacity: p.opacity, filter: p.blur ? `blur(${p.blur}px)` : undefined }}
          />
        </span>
      </span>
    </span>
  );
}

/**
 * Fades in and out with the scene rather than animating on its own: a
 * JS-driven entrance would put the main thread back to work at the very moment
 * the particles are keeping it free.
 */
function SkipButton({ accent, onSkip }: { accent: string; onSkip: () => void }) {
  return (
    <button
      type="button"
      onClick={onSkip}
      className="pointer-events-auto absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-4 flex items-center gap-1.5 overflow-hidden rounded-full bg-white/85 py-2 pl-4 pr-3 font-sans text-xs font-medium text-stone-600 shadow-[0_8px_24px_-12px_rgba(28,25,23,0.45)] ring-1 ring-stone-900/10 backdrop-blur-md transition-colors hover:bg-white hover:text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:bottom-8 md:right-8"
    >
      Skip intro
      <X className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
      {/* Countdown hairline — shrinks away as the intro runs out. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-4 bottom-1 h-px origin-left rounded-full opacity-70"
        style={{ background: accent, animation: `season-countdown ${SEASONAL_INTRO_MS}ms linear forwards` }}
      />
    </button>
  );
}

interface SeasonSceneProps {
  season: Season;
  /** Called once the scene is on screen — the intro's three seconds start here. */
  onShown: () => void;
  onSkip: () => void;
}

export default function SeasonScene({ season, onShown, onSkip }: SeasonSceneProps) {
  const scene = SCENES[season];
  const particles = useMemo(() => scatter(scene), [scene]);

  useEffect(() => {
    onShown();
  }, [onShown]);

  return (
    <motion.div
      className="pointer-events-none fixed inset-0 z-30 contain-strict motion-reduce:hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.8, ease: "easeOut" } }}
      exit={{ opacity: 0, transition: { duration: 0.9, ease: "easeInOut" } }}
    >
      <div aria-hidden="true">
        <svg className="absolute size-0">
          <defs>
            {GRADIENTS.map(({ id, axis, from, to }) => (
              <linearGradient key={id} id={id} {...axis}>
                <stop offset="0" stopColor={from} />
                <stop offset="1" stopColor={to} />
              </linearGradient>
            ))}
          </defs>
        </svg>
        {scene.glow && <div className="absolute inset-0" style={{ background: scene.glow }} />}
        {particles.map((particle) => (
          <Drifter key={particle.id} particle={particle} scene={scene} />
        ))}
      </div>

      <SkipButton accent={scene.accent} onSkip={onSkip} />
    </motion.div>
  );
}
