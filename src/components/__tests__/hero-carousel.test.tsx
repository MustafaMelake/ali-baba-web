// @vitest-environment jsdom
//
// ─────────────────────────────────────────────────────────────────────────────
// HeroCarousel autoplay — the state machine that decides when the banner moves.
//
// The production bug: rotation waited for the NEXT slide's image to load, and
// the next slide was only requested after slide 0's onLoad. On a cached second
// visit slide 0 was already complete before hydration, onLoad never reached
// React, and the carousel never started. Separately, a tap (pointerDown /
// mouseenter without mouseleave) stopped it for good.
//
// A real React tree renders into jsdom (no testing library). next/image,
// next/link and Embla are stubbed: the stub API records scrollNext/scrollTo and
// emits "select" like the real one, so the carousel's own effects run as they
// would in a browser. Fake timers drive HERO_AUTOPLAY_MS / HERO_RESUME_AFTER_MS.
// ─────────────────────────────────────────────────────────────────────────────

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HERO_AUTOPLAY_MS, HERO_RESUME_AFTER_MS, type HeroSlideView } from "@/lib/hero-slides";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── Stubs ────────────────────────────────────────────────────────────────────

type Handler = () => void;

function makeEmblaApi(count: number) {
  let index = 0;
  const handlers = new Map<string, Set<Handler>>();
  const emit = (event: string) => handlers.get(event)?.forEach((h) => h());
  const move = (to: number) => {
    index = (to + count) % count;
    emit("select");
  };
  const api = {
    on: (event: string, h: Handler) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(h);
      return api;
    },
    off: (event: string, h: Handler) => {
      handlers.get(event)?.delete(h);
      return api;
    },
    selectedScrollSnap: () => index,
    // The `jump` arg (reduced motion) is only recorded; every call moves.
    scrollNext: vi.fn<(jump?: boolean) => void>(() => move(index + 1)),
    scrollPrev: vi.fn<(jump?: boolean) => void>(() => move(index - 1)),
    scrollTo: vi.fn<(i: number, jump?: boolean) => void>((i) => move(i)),
    emit,
  };
  return api;
}

let emblaApi: ReturnType<typeof makeEmblaApi>;
let reducedMotion = false;

vi.mock("embla-carousel-react", () => ({
  default: () => [() => {}, emblaApi],
}));
vi.mock("embla-carousel-fade", () => ({ default: () => ({ name: "fade" }) }));
vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  useReducedMotion: () => reducedMotion,
}));
vi.mock("next/image", () => ({
  default: ({
    ref,
    src,
    alt,
    onLoad,
    onError,
  }: {
    ref?: React.Ref<HTMLImageElement>;
    src: string;
    alt: string;
    onLoad?: () => void;
    onError?: () => void;
  }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img ref={ref} src={src} alt={alt} onLoad={onLoad} onError={onError} />
  ),
  getImageProps: (props: Record<string, unknown>) => ({ props }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { default: HeroCarousel } = await import("@/components/HeroCarousel");

// ── Fixtures ─────────────────────────────────────────────────────────────────

const slide = (n: number): HeroSlideView => ({
  id: `s${n}`,
  eyebrow: null,
  title: `Slide ${n}`,
  subtitle: null,
  ctaLabel: "Order now",
  href: `/product/p${n}`,
  imageDesktop: `/hero-${n}.jpeg`,
  imageMobile: null,
  imageAlt: `Banner ${n}`,
  price: null,
});
const SLIDES = [slide(1), slide(2), slide(3)];

/** Make every <img> report "already decoded from cache" (or not). */
function imagesAlreadyComplete(complete: boolean) {
  Object.defineProperty(HTMLImageElement.prototype, "complete", {
    configurable: true,
    get: () => complete,
  });
  Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", {
    configurable: true,
    get: () => (complete ? 2400 : 0),
  });
}

let host: HTMLDivElement;
let root: Root;

function render(slides = SLIDES) {
  emblaApi = makeEmblaApi(slides.length);
  act(() => root.render(<HeroCarousel slides={slides} />));
}

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const button = (label: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const click = (el: HTMLElement) => act(() => el.click());
const images = () => [...host.querySelectorAll("img")];

beforeEach(() => {
  vi.useFakeTimers();
  reducedMotion = false;
  imagesAlreadyComplete(false);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  delete (HTMLImageElement.prototype as { complete?: boolean }).complete;
  delete (HTMLImageElement.prototype as { naturalWidth?: number }).naturalWidth;
});

// ── Starting ─────────────────────────────────────────────────────────────────

describe("starting", () => {
  it("rotates when every image was already complete before hydration (no load events at all)", () => {
    imagesAlreadyComplete(true);
    render();
    expect(emblaApi.scrollNext).not.toHaveBeenCalled();
    advance(HERO_AUTOPLAY_MS);
    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(1);
    advance(HERO_AUTOPLAY_MS);
    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(2);
  });

  it("requests slide 0's neighbours on mount — slide 1 can settle while slide 0 never fires onLoad", () => {
    render();
    // Only the NEXT slide's image settles; slide 0 never reports anything.
    act(() => images()[1].dispatchEvent(new Event("load")));
    advance(HERO_AUTOPLAY_MS);
    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(1);
  });

  it("waits while the next image is still loading — never fades onto a blank frame", () => {
    render();
    advance(HERO_AUTOPLAY_MS * 3);
    expect(emblaApi.scrollNext).not.toHaveBeenCalled();
  });

  it("a failed next image doesn't freeze autoplay", () => {
    render();
    act(() => images()[1].dispatchEvent(new Event("error")));
    advance(HERO_AUTOPLAY_MS);
    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(1);
  });
});

// ── Motion preferences ───────────────────────────────────────────────────────

describe("reduced motion", () => {
  it("keeps rotating, switching instantly (jump) instead of crossfading", () => {
    reducedMotion = true;
    imagesAlreadyComplete(true);
    render();
    advance(HERO_AUTOPLAY_MS);
    expect(emblaApi.scrollNext).toHaveBeenCalledWith(true);
  });

  it("crossfades (no jump) otherwise", () => {
    imagesAlreadyComplete(true);
    render();
    advance(HERO_AUTOPLAY_MS);
    expect(emblaApi.scrollNext).toHaveBeenCalledWith(false);
  });
});

// ── Pausing ──────────────────────────────────────────────────────────────────

describe("pausing", () => {
  beforeEach(() => imagesAlreadyComplete(true));

  it("hover does NOT pause (a tap on a phone fires mouseenter with no mouseleave)", () => {
    render();
    act(() => {
      host.querySelector("section")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    advance(HERO_AUTOPLAY_MS);
    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(1);
  });

  it("a manual arrow holds autoplay, then resumes after the idle window", () => {
    render();
    click(button("Next slide"));
    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(1); // the manual move itself
    advance(HERO_RESUME_AFTER_MS - 1);
    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(1); // still held
    advance(1); // the hold lifts (a re-render arms the autoplay timer)
    advance(HERO_AUTOPLAY_MS);
    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(2); // resumed
  });

  it("each manual input restarts the idle countdown (dots and swipes too)", () => {
    render();
    click(button("Go to slide 3"));
    advance(HERO_RESUME_AFTER_MS - 1000);
    act(() => emblaApi.emit("pointerDown")); // a swipe
    advance(HERO_RESUME_AFTER_MS - 1);
    expect(emblaApi.scrollNext).not.toHaveBeenCalled();
    advance(1);
    advance(HERO_AUTOPLAY_MS);
    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(1);
  });

  it("only the Pause button stops it — until Play", () => {
    render();
    click(button("Pause slideshow"));
    advance(HERO_RESUME_AFTER_MS * 5);
    expect(emblaApi.scrollNext).not.toHaveBeenCalled();
    click(button("Play slideshow"));
    advance(HERO_AUTOPLAY_MS);
    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(1);
  });

  it("keyboard focus inside pauses; pointer focus does not", () => {
    render();
    const dot = button("Go to slide 2");
    const matches = vi.spyOn(Element.prototype, "matches");

    matches.mockReturnValue(false); // pointer focus — not :focus-visible
    act(() => dot.focus());
    advance(HERO_AUTOPLAY_MS);
    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(1);

    act(() => dot.blur());
    matches.mockReturnValue(true); // keyboard focus
    act(() => dot.focus());
    advance(HERO_AUTOPLAY_MS * 3);
    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(1);

    act(() => dot.blur()); // focus leaves the carousel
    advance(HERO_AUTOPLAY_MS);
    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(2);
    matches.mockRestore();
  });

  it("a hidden tab pauses", () => {
    render();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    advance(HERO_AUTOPLAY_MS * 3);
    expect(emblaApi.scrollNext).not.toHaveBeenCalled();

    visibility.mockReturnValue("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    advance(HERO_AUTOPLAY_MS);
    expect(emblaApi.scrollNext).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
  });
});

describe("a single slide", () => {
  it("never rotates and renders no controls", () => {
    imagesAlreadyComplete(true);
    render([slide(1)]);
    advance(HERO_AUTOPLAY_MS * 3);
    expect(emblaApi.scrollNext).not.toHaveBeenCalled();
    expect(host.querySelector('button[aria-label="Pause slideshow"]')).toBeNull();
  });
});
