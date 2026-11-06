"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { GuessrShowcase, type ShowcaseSlide } from "./GuessrShowcase";
import { HOME_SECTIONS } from "./sections";

/** How long each tab stays on screen. */
const ROTATE_MS = 25_000;
const FADE_MS = 1200;
/** The next slide's screenshot starts loading this long before it shows. */
const PREFETCH_MS = 6000;

/**
 * The title screen's picture: one slide per tab of the site, in the nav's
 * order, changing every 25 seconds with a slow crossfade. PokéGuessr comes
 * first and is the page's hero image (server-rendered, loaded with the page);
 * the clock starts once the page has gone idle, and each other screenshot
 * loads shortly before its turn, or as soon as the controls are touched, so
 * the first load carries only the hero image. Dots pick a slide
 * and a button pauses it (WCAG 2.2.2); it doesn't move by itself for reduced
 * motion, and waits while the tab is in the background.
 */
export function HeroCarousel({ guessr }: { guessr: { slides: ShowcaseSlide[]; map: { src: string; width: number; height: number } } }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [started, setStarted] = useState(false);
  const [mounted, setMounted] = useState<ReadonlySet<number>>(() => new Set([0]));
  // The wide title screen and a phone crop the screenshots differently; known once the page runs.
  const [wide, setWide] = useState<boolean | null>(null);
  const [hidden, setHidden] = useState(false);
  const [focused, setFocused] = useState(false);
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
    const query = window.matchMedia("(min-width: 1024px)");
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
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
  /** The controls were touched: fetch every screenshot, so a dot shows its slide at once. */
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
      setIndex(i);
    },
    [prime]
  );

  const active = HOME_SECTIONS[index];

  return (
    <div
      className="pointer-events-none absolute inset-0"
      role="region"
      aria-roledescription="carousel"
      aria-label="PokéIQ at a glance"
      data-testid="hero-carousel"
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      {/* The picture: under the text, faded into the card behind it. */}
      <div
        className="absolute inset-x-0 top-0 z-0 aspect-video overflow-hidden lg:inset-y-0 lg:left-auto lg:aspect-auto lg:w-[66%]"
        aria-live={playing ? "off" : "polite"}
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
                mounted.has(i) && wide !== null ? (
                  <>
                    <Image
                      src={wide ? section.shot.src : (section.shot.small ?? section.shot.src)}
                      alt={section.shot.alt}
                      width={section.shot.width}
                      height={section.shot.height}
                      sizes={wide ? "760px" : "100vw"}
                      loading="eager"
                      fetchPriority="low"
                      className="absolute inset-0 h-full w-full select-none object-cover"
                      style={section.shot.position ? { objectPosition: section.shot.position } : undefined}
                    />
                    {/* A shade at the top, so the slide's name and button read over a busy screenshot. */}
                    <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/60 to-transparent" />
                  </>
                ) : null
              ) : (
                <GuessrShowcase slides={guessr.slides} map={guessr.map} active={on} className="absolute inset-0" />
              )}
            </div>
          );
        })}
        {/* Fade the picture into the card behind the text. */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent from-35% to-card lg:bg-gradient-to-r lg:from-card lg:from-0% lg:via-card/60 lg:via-30% lg:to-transparent lg:to-70%" />
      </div>

      {/* This slide's name and button, over the picture's corner. */}
      <div
        key={active.id}
        className="pointer-events-auto absolute left-3 top-3 z-[2] flex items-center gap-1.5 duration-700 animate-in fade-in motion-reduce:animate-none sm:left-4 sm:top-4 lg:left-auto lg:right-5 lg:top-5"
        style={{ "--accent-c": active.accent } as React.CSSProperties}
      >
        <Link
          href={active.href}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/15 bg-black/55 px-2.5 font-display text-xs font-bold uppercase tracking-wide text-white sm:h-9 sm:gap-2 sm:px-3 sm:text-sm sm:tracking-wider backdrop-blur-md transition-colors hover:border-[hsl(var(--accent-c)/0.7)]"
          data-testid="hero-slide-label"
        >
          <active.icon className="h-3.5 w-3.5 text-[hsl(var(--accent-c))] sm:h-4 sm:w-4" aria-hidden />
          {active.name}
        </Link>
        <Link
          href={active.href}
          className="group inline-flex h-8 items-center gap-1.5 rounded-md bg-[hsl(var(--accent-c))] px-2.5 font-display text-xs font-bold uppercase tracking-wide text-black sm:h-9 sm:px-3 sm:text-sm sm:tracking-wider shadow-[0_0_18px_hsl(var(--accent-c)/0.35)] transition-[filter] hover:brightness-110"
          aria-label={`${active.cta} ${active.name}`}
          data-testid="hero-slide-cta"
        >
          {active.cta}
          <ArrowRight className="hidden h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none min-[400px]:block" aria-hidden />
        </Link>
      </div>

      {/* Pause, then one dot per slide. */}
      <div
        onPointerEnter={prime}
        onFocus={prime}
        className="pointer-events-auto absolute inset-x-0 bottom-3 z-[2] mx-auto flex w-fit items-center gap-1 rounded-full border border-white/10 bg-black/45 px-1.5 backdrop-blur-md sm:bottom-4 lg:inset-x-auto lg:bottom-5 lg:left-[57%] lg:-translate-x-1/2"
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
