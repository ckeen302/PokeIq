"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { GuessrShowcase, type ShowcaseSlide } from "./GuessrShowcase";
import { HOME_SECTIONS } from "./sections";

/** How long each tab stays on screen. */
const ROTATE_MS = 25_000;
const FADE_MS = 1200;
/** The next slide's screenshot starts loading this long before it shows. */
const PREFETCH_MS = 6000;

/**
 * The title screen: one slide per tab of the site, the picture filling the
 * card, with the tab's name, a line about it and a button to it. It changes
 * every 25 seconds with a slow crossfade; the arrows (and the keyboard's left
 * and right arrows) and the dots change it by hand, and the button pauses it
 * (WCAG 2.2.2). PokéGuessr comes first and is the page's hero image
 * (server-rendered); the clock starts once the page has gone idle, and each
 * other screenshot loads shortly before its turn, or as soon as the controls
 * are touched. It doesn't move by itself for reduced motion, and waits while
 * the tab is in the background or a keyboard user is inside it.
 */
export function HeroCarousel({ guessr }: { guessr: { slides: ShowcaseSlide[]; map: { src: string; width: number; height: number } } }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [started, setStarted] = useState(false);
  const [mounted, setMounted] = useState<ReadonlySet<number>>(() => new Set([0]));
  const [hidden, setHidden] = useState(false);
  const [focused, setFocused] = useState(false);
  const count = HOME_SECTIONS.length;
  /** Where a finger came down on the picture (phones swipe between slides). */
  const swipe = useRef<{ x: number; y: number } | null>(null);

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

  const load = useCallback((...slides: number[]) => {
    setMounted((m) => (slides.every((i) => m.has(i)) ? m : new Set([...m, ...slides])));
  }, []);
  /** The controls were touched: fetch every screenshot, so any slide shows at once. */
  const prime = useCallback(() => load(...HOME_SECTIONS.map((_, i) => i)), [load]);

  // A fresh 25 seconds after every change, and after the tab comes back; the next screenshot loads a little before.
  useEffect(() => {
    if (!playing || hidden || focused || !started) return;
    const prefetch = window.setTimeout(() => load((index + 1) % count), ROTATE_MS - PREFETCH_MS);
    const timer = window.setTimeout(() => setIndex((i) => (i + 1) % count), ROTATE_MS);
    return () => {
      window.clearTimeout(prefetch);
      window.clearTimeout(timer);
    };
  }, [index, playing, hidden, focused, started, count, load]);

  const show = useCallback(
    (i: number) => {
      setStarted(true);
      prime();
      setIndex(((i % count) + count) % count);
    },
    [prime, count]
  );

  const active = HOME_SECTIONS[index];
  const prev = HOME_SECTIONS[(index - 1 + count) % count];
  const next = HOME_SECTIONS[(index + 1) % count];

  return (
    <div
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
      {/* The picture: 16:9 on a tablet, taller and edge to edge on a phone (where a swipe changes the slide), a wide band across the card on bigger screens (the screenshots keep their tops). */}
      <div
        className="relative aspect-video overflow-hidden lg:aspect-[21/10] max-sm:aspect-[5/4] max-md:touch-pan-y"
        aria-live={playing ? "off" : "polite"}
        onPointerDown={(e) => {
          if (e.pointerType === "touch") swipe.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e) => {
          const from = swipe.current;
          swipe.current = null;
          if (!from) return;
          const dx = e.clientX - from.x;
          if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - from.y) * 1.5) show(index + (dx < 0 ? 1 : -1));
        }}
        onPointerCancel={() => {
          swipe.current = null;
        }}
        data-testid="hero-picture"
      >
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
              {section.shot ? (
                mounted.has(i) ? (
                  <Image
                    src={section.shot.src}
                    alt={section.shot.alt}
                    width={section.shot.width}
                    height={section.shot.height}
                    sizes="(min-width: 1152px) 1152px, (min-width: 640px) 100vw, 140vw"
                    loading="eager"
                    fetchPriority="low"
                    draggable={false}
                    className="absolute inset-0 h-full w-full select-none object-cover object-top max-sm:object-center"
                  />
                ) : null
              ) : (
                <GuessrShowcase slides={guessr.slides} map={guessr.map} active={on} className="absolute inset-0" />
              )}
            </div>
          );
        })}
        {/* Wide screens: a shade under the name and button, so they read over any picture. */}
        <div className="pointer-events-none absolute inset-0 hidden bg-[linear-gradient(to_top,hsl(var(--card))_0%,hsl(var(--card)/0.75)_22%,transparent_55%),linear-gradient(to_right,hsl(var(--card)/0.7)_0%,transparent_45%)] lg:block" />
        {/* Phones: the picture fades into the page under it. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-1/4 bg-gradient-to-t from-background to-transparent sm:hidden" />

        {/* Previous and next, on the picture's edges. */}
        {(
          [
            ["prev", prev, -1, ChevronLeft, "left-2 sm:left-3"],
            ["next", next, 1, ChevronRight, "right-2 sm:right-3"],
          ] as const
        ).map(([key, target, step, Icon, side]) => (
          <button
            key={key}
            type="button"
            onClick={() => show(index + step)}
            className={cn(
              "absolute top-1/2 z-[3] flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white/90 backdrop-blur-md transition-colors hover:bg-black/70 hover:text-white lg:h-12 lg:w-12 max-sm:hidden",
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
        className="relative z-[2] px-5 pt-4 sm:px-8 sm:pt-5 max-sm:px-4 max-sm:pt-1 lg:absolute lg:bottom-0 lg:left-0 lg:max-w-[46rem] lg:px-12 lg:pb-12 lg:pt-0"
        style={{ "--accent-c": active.accent } as React.CSSProperties}
      >
        {/* The name and line fade in with each slide; the button stays put, so keyboard focus on it survives a change.
            On a phone the line always takes two lines' room, so the card's height never changes between slides. */}
        <h2 key={`${active.id}-name`} className="flex items-center gap-3 duration-700 animate-in fade-in motion-reduce:animate-none font-display text-3xl font-bold uppercase leading-none tracking-tight [text-shadow:0_2px_18px_rgb(0_0_0/0.6)] sm:text-4xl lg:text-6xl max-sm:text-[2rem]" data-testid="hero-slide-name">
          <active.icon className="h-7 w-7 shrink-0 text-[hsl(var(--accent-c))] sm:h-8 sm:w-8 lg:h-11 lg:w-11" aria-hidden />
          {active.name}
        </h2>
        <p key={`${active.id}-line`} className="mt-2 line-clamp-2 min-h-[2.6rem] duration-700 animate-in fade-in motion-reduce:animate-none text-[15px] sm:min-h-0 leading-snug text-muted-foreground sm:text-lg lg:mt-3 lg:text-xl lg:text-foreground/85">{active.line}</p>
        <Link
          href={active.href}
          className="group mt-4 inline-flex h-11 items-center gap-2 rounded-md bg-[hsl(var(--accent-c))] px-5 font-display text-[15px] font-bold uppercase tracking-wider text-black shadow-[0_0_24px_hsl(var(--accent-c)/0.35)] transition-[filter] hover:brightness-110 lg:mt-6 lg:h-12 lg:px-6 max-sm:mt-5 max-sm:flex max-sm:h-[52px] max-sm:w-full max-sm:justify-center max-sm:rounded-xl max-sm:text-base max-sm:active:brightness-90"
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
        className="relative z-[2] mx-auto my-4 flex w-fit items-center gap-1 rounded-full border border-white/10 bg-black/45 px-1.5 backdrop-blur-md sm:my-5 lg:absolute lg:bottom-12 lg:right-12 lg:m-0 max-sm:mb-1 max-sm:mt-3 max-sm:border-transparent max-sm:bg-transparent max-sm:backdrop-blur-none"
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
