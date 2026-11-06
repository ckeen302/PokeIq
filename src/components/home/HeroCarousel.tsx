"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { HeroClip } from "./HeroClip";
import { HOME_SECTIONS } from "./sections";

/** The longest a tab stays on screen (its clip normally moves it on sooner, after two plays). */
const ROTATE_MS = 25_000;
/** A clip plays this many times before the slideshow moves on. */
const PLAYS = 2;
const FADE_MS = 1200;
/** The next slide's poster and clip start loading this long before it shows. */
const PREFETCH_MS = 6000;

/**
 * The title screen: one slide per tab of the site, a clip of the tab being
 * played filling the card, with the tab's name, a line about it and a button
 * to it. A slide moves on once its clip has played twice (25 seconds at
 * most) with a slow crossfade; the arrows (and the keyboard's left and right
 * arrows) and the dots change it by hand, and the button pauses it, clip and
 * all (WCAG 2.2.2). PokéGuessr comes first: its poster (the clip's first
 * frame) is the page's hero image, server-rendered. The clips start once the
 * page has gone idle; only the one on screen loads in full, the next one a
 * little before its turn, and each other poster loads shortly before its
 * turn, or as soon as the controls are touched. For reduced motion (or Save
 * Data) the posters stay still and nothing moves by itself; nothing plays
 * while the tab is in the background or the slideshow is off screen, and the
 * slideshow waits while a keyboard user is inside it.
 */
export function HeroCarousel() {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [started, setStarted] = useState(false);
  const [mounted, setMounted] = useState<ReadonlySet<number>>(() => new Set([0]));
  const [hidden, setHidden] = useState(false);
  const [focused, setFocused] = useState(false);
  /** On screen (clips pause and the slideshow waits while it's scrolled away). */
  const [seen, setSeen] = useState(true);
  /** Slides whose clip may load: the one on screen, and the next shortly before its turn. */
  const [warm, setWarm] = useState<ReadonlySet<number>>(() => new Set());
  const root = useRef<HTMLDivElement>(null);
  const count = HOME_SECTIONS.length;

  // Reduced motion: no rotation until the player presses Play.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPlaying(false);
  }, []);

  // The clock starts once the page has loaded and gone idle, so the hero image keeps the bandwidth.
  useEffect(() => {
    let idle: number | undefined;
    let timer: number | undefined;
    const arm = () => {
      const go = () => setStarted(true);
      if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(go, { timeout: 4000 });
      else timer = window.setTimeout(go, 1500);
    };
    const settle = () => {
      timer = window.setTimeout(arm, 1500);
    };
    if (document.readyState === "complete") settle();
    else window.addEventListener("load", settle, { once: true });
    return () => {
      window.removeEventListener("load", settle);
      if (timer !== undefined) window.clearTimeout(timer);
      if (idle !== undefined && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idle);
    };
  }, []);

  useEffect(() => {
    const sync = () => setHidden(document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  useEffect(() => {
    const node = root.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setSeen(entry.isIntersecting), { threshold: 0.15 });
    io.observe(node);
    return () => io.disconnect();
  }, []);

  const load = useCallback((...slides: number[]) => {
    setMounted((m) => (slides.every((i) => m.has(i)) ? m : new Set([...m, ...slides])));
  }, []);
  /** The controls were touched: fetch every poster, so any slide shows at once. */
  const prime = useCallback(() => load(...HOME_SECTIONS.map((_, i) => i)), [load]);

  // The clip on screen may load once the page has settled (the poster is the hero image until then).
  useEffect(() => {
    if (!started) return;
    setWarm((w) => (w.has(index) ? w : new Set([...w, index])));
  }, [started, index]);

  const next = useCallback(() => setIndex((i) => (i + 1) % count), [count]);

  // At most 25 seconds after every change, and after the tab comes back; the next poster and clip load a little before.
  useEffect(() => {
    if (!playing || hidden || focused || !started || !seen) return;
    const prefetch = window.setTimeout(() => {
      load((index + 1) % count);
      setWarm((w) => new Set([...w, (index + 1) % count]));
    }, ROTATE_MS - PREFETCH_MS);
    const timer = window.setTimeout(next, ROTATE_MS);
    return () => {
      window.clearTimeout(prefetch);
      window.clearTimeout(timer);
    };
  }, [index, playing, hidden, focused, started, seen, count, load, next]);

  /** The clip on screen has played `times` times: get the next one ready after the first, move on after the second. */
  const played = useCallback(
    (times: number) => {
      if (!playing || focused) return;
      if (times === 1) {
        load((index + 1) % count);
        setWarm((w) => new Set([...w, (index + 1) % count]));
      }
      if (times >= PLAYS) next();
    },
    [playing, focused, index, count, load, next]
  );

  const show = useCallback(
    (i: number) => {
      setStarted(true);
      prime();
      setIndex(((i % count) + count) % count);
    },
    [prime, count]
  );

  const active = HOME_SECTIONS[index];
  const prevSection = HOME_SECTIONS[(index - 1 + count) % count];
  const nextSection = HOME_SECTIONS[(index + 1) % count];
  const run = playing && started && !hidden && seen;

  return (
    <div
      ref={root}
      className="relative"
      role="region"
      aria-roledescription="carousel"
      aria-label="PokéIQ's games"
      data-testid="hero-carousel"
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        show(index + (e.key === "ArrowRight" ? 1 : -1));
      }}
      onFocus={(e) => {
        // A keyboard user inside the slideshow holds it still; a click on an arrow doesn't.
        if (e.target instanceof HTMLElement && e.target.matches(":focus-visible")) setFocused(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      {/* The picture: 16:9 on a phone, a wide band across the card on bigger screens (the screenshots keep their tops). */}
      <div className="relative aspect-video overflow-hidden lg:aspect-[21/10]" aria-live={playing ? "off" : "polite"}>
        {HOME_SECTIONS.map((section, i) => {
          const on = i === index;
          return (
            <div
              key={section.id}
              role="group"
              aria-roledescription="slide"
              aria-label={section.name}
              aria-hidden={!on}
              data-testid="hero-slide"
              data-slide={section.id}
              data-active={on ? "true" : "false"}
              className={cn("absolute inset-0 transition-opacity ease-in-out motion-reduce:transition-none", on ? "opacity-100" : "opacity-0")}
              style={{ transitionDuration: `${FADE_MS}ms` }}
            >
              <HeroClip clip={section.clip} active={on} load={warm.has(i)} run={run && on} priority={i === 0} posterReady={mounted.has(i)} onPlayed={on ? played : undefined} />
            </div>
          );
        })}
        {/* Wide screens: a shade under the name and button, so they read over any picture. */}
        <div className="pointer-events-none absolute inset-0 hidden bg-[linear-gradient(to_top,hsl(var(--card))_0%,hsl(var(--card)/0.75)_22%,transparent_55%),linear-gradient(to_right,hsl(var(--card)/0.7)_0%,transparent_45%)] lg:block" />

        {/* Previous and next, on the picture's edges. */}
        {(
          [
            ["prev", prevSection, -1, ChevronLeft, "left-2 sm:left-3"],
            ["next", nextSection, 1, ChevronRight, "right-2 sm:right-3"],
          ] as const
        ).map(([key, target, step, Icon, side]) => (
          <button
            key={key}
            type="button"
            onClick={() => show(index + step)}
            className={cn(
              "absolute top-1/2 z-[3] flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white/90 backdrop-blur-md transition-colors hover:bg-black/70 hover:text-white lg:h-12 lg:w-12",
              side
            )}
            aria-label={`${key === "next" ? "Next" : "Previous"}: ${target.name}`}
            data-testid={`hero-${key}`}
          >
            <Icon className="h-5 w-5 lg:h-6 lg:w-6" aria-hidden />
          </button>
        ))}
      </div>

      {/* This tab's name, a line and its button: under the picture on a phone, over its lower left on wide screens. */}
      <div
        className="relative z-[2] px-5 pt-4 sm:px-8 sm:pt-5 lg:absolute lg:bottom-0 lg:left-0 lg:max-w-[46rem] lg:px-12 lg:pb-12 lg:pt-0"
        style={{ "--accent-c": active.accent } as React.CSSProperties}
      >
        {/* The name and line fade in with each slide; the button stays put, so keyboard focus on it survives a change.
            On a phone the line always takes two lines' room, so the card's height never changes between slides. */}
        <h2 key={`${active.id}-name`} className="flex items-center gap-3 duration-700 animate-in fade-in motion-reduce:animate-none font-display text-3xl font-bold uppercase leading-none tracking-tight [text-shadow:0_2px_18px_rgb(0_0_0/0.6)] sm:text-4xl lg:text-6xl" data-testid="hero-slide-name">
          <active.icon className="h-7 w-7 shrink-0 text-[hsl(var(--accent-c))] sm:h-8 sm:w-8 lg:h-11 lg:w-11" aria-hidden />
          {active.name}
        </h2>
        <p key={`${active.id}-line`} className="mt-2 line-clamp-2 min-h-[2.6rem] duration-700 animate-in fade-in motion-reduce:animate-none text-[15px] sm:min-h-0 leading-snug text-muted-foreground sm:text-lg lg:mt-3 lg:text-xl lg:text-foreground/85">{active.line}</p>
        <Link
          href={active.href}
          className="group mt-4 inline-flex h-11 items-center gap-2 rounded-md bg-[hsl(var(--accent-c))] px-5 font-display text-[15px] font-bold uppercase tracking-wider text-black shadow-[0_0_24px_hsl(var(--accent-c)/0.35)] transition-[filter] hover:brightness-110 lg:mt-6 lg:h-12 lg:px-6"
          aria-label={`${active.cta} ${active.name}`}
          data-testid="hero-slide-cta"
        >
          {active.cta}
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1 motion-reduce:transition-none" aria-hidden />
        </Link>
      </div>

      {/* Pause, then one dot per slide. */}
      <div
        onPointerEnter={prime}
        onFocus={prime}
        className="relative z-[2] mx-auto my-4 flex w-fit items-center gap-1 rounded-full border border-white/10 bg-black/45 px-1.5 backdrop-blur-md sm:my-5 lg:absolute lg:bottom-12 lg:right-12 lg:m-0"
      >
        <button
          type="button"
          onClick={() => {
            setStarted(true);
            prime();
            setPlaying((p) => !p);
          }}
          className="flex h-7 w-7 items-center justify-center rounded-full text-white/80 transition-colors hover:text-white"
          aria-label={playing ? "Pause the slideshow" : "Play the slideshow"}
          data-testid="hero-pause"
        >
          {playing ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
        </button>
        {HOME_SECTIONS.map((section, i) => {
          const on = i === index;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => show(i)}
              className="group flex h-7 w-6 items-center justify-center"
              aria-label={`Show ${section.name}`}
              aria-current={on ? "true" : undefined}
              data-testid="hero-dot"
            >
              <span
                className={cn("block h-2 rounded-full transition-all duration-300 motion-reduce:transition-none", on ? "w-4" : "w-2 bg-white/45 group-hover:bg-white/80")}
                style={on ? { background: `hsl(${section.accent})` } : undefined}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
