"use client";

import Link from "next/link";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ChevronLeft, ChevronRight, List, Play, Share2, SlidersHorizontal, Square, X } from "lucide-react";
import { ERAS, LANES, LANE_BY_ID, REGION_MAPS, ROMAN, T_START, dateRows, formatDate, type EraId, type LaneId, type TimelineEntry } from "@/lib/timeline/types";
import { parseDeepLink, urlFor } from "@/lib/timeline/deeplink";
import { markIntroSeen, shouldPlayIntro } from "@/lib/timeline/intro";
import { buildTour, pickTourStops, tourAt } from "@/lib/timeline/tour";
import type { SceneApi, SceneEra, SceneRegion } from "./scene";
import type { TimelineAudio } from "./audio";
import { TimelineDetail } from "./TimelineDetail";
import { TIMELINE_CSS } from "./timeline-css";
import { cn } from "@/lib/utils";

// The intro and the era transitions load only when they are about to play.
const TimelineIntro = lazy(() => import("./TimelineIntro"));
const EraTransition = lazy(() => import("./EraTransition"));
const TimelineShare = lazy(() => import("./TimelineShare").then((m) => ({ default: m.TimelineShare })));

export interface EraStart {
  id: EraId;
  start: number;
  year: number;
}

type Mode = "boot" | "3d" | "list";

function webglOk() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const metaOf = (e: TimelineEntry) => [e.platform, e.region].filter(Boolean).join(" · ");

/** How long the intro shows its title before the camera flies in (ms). */
const INTRO_FLY_AT = 1500;
const INTRO_FLIGHT_S = 2.1;

/**
 * /pokedex/timeline: a full-screen 3D flight through Pokémon history, with
 * the server-rendered list (children) underneath for search engines, for
 * browsers without WebGL and for reduced motion. `initialId` (an entry's own
 * page) opens with that entry in view and its panel open.
 */
export function TimelineExperience({ entries, eraStarts, initialId = null, children }: { entries: TimelineEntry[]; eraStarts: EraStart[]; initialId?: string | null; children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>("boot");
  const [ready, setReady] = useState(false);
  const [lanes, setLanes] = useState<Set<LaneId>>(() => new Set(LANES.map((l) => l.id)));
  const [openId, setOpenId] = useState<string | null>(null);
  const [eraIdx, setEraIdx] = useState(0);
  const [flash, setFlash] = useState<{ i: number; n: number; forward: boolean } | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [canGl, setCanGl] = useState(false);
  const [intro, setIntro] = useState(false);
  const [touring, setTouring] = useState(false);
  const [tourStop, setTourStop] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<SceneApi | null>(null);
  const audioRef = useRef<TimelineAudio | null>(null);
  const yearRef = useRef<HTMLSpanElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const tourBarRef = useRef<HTMLSpanElement>(null);
  const openRef = useRef<string | null>(null);
  const introRef = useRef(false);
  const flyRequested = useRef(false);
  const flashCount = useRef(0);
  openRef.current = openId;
  introRef.current = intro;

  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const tEnd = useMemo(() => Math.max(...entries.map((e) => e.t)) + 0.3, [entries]);
  const span = tEnd - T_START;
  const pct = (t: number) => `${(((t - T_START) / span) * 100).toFixed(3)}%`;
  const sceneEras: SceneEra[] = useMemo(
    () => eraStarts.map((s) => { const e = ERAS.find((x) => x.id === s.id)!; return { start: s.start, a: e.a, b: e.b, deep: e.deep, label: e.label, device: e.device, year: s.year }; }),
    [eraStarts]
  );
  // Each generation's stretch runs from its opener to the next one's.
  const regions: SceneRegion[] = useMemo(() => {
    const openers = entries.filter((e) => e.introduces).sort((a, b) => a.t - b.t);
    return openers.flatMap((o, i) => {
      const map = REGION_MAPS[o.introduces!];
      if (!map) return [];
      return [{ gen: o.introduces!, start: o.t, end: openers[i + 1]?.t ?? tEnd, src: map.src, w: map.w, h: map.h }];
    });
  }, [entries, tEnd]);

  // Pick the view: 3D unless reduced motion or no WebGL.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let forced: string | null = null;
    try { forced = new URLSearchParams(window.location.search).get("view"); } catch { /* ignore */ }
    const gl = webglOk();
    setCanGl(gl);
    const next: Mode = forced === "list" || (forced !== "3d" && reduce) || !gl ? "list" : "3d";
    setMode(next);
    if (next === "3d") {
      const deep = initialId ?? parseDeepLink(window.location, (id) => byId.has(id));
      const play = shouldPlayIntro({ store: localStore(), reducedMotion: reduce, deepLink: !!deep });
      if (play) markIntroSeen(localStore());
      setIntro(play);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // List view on an entry's own link: bring the entry into view.
  useEffect(() => {
    if (mode !== "list") return;
    const id = initialId ?? parseDeepLink(window.location, (x) => byId.has(x));
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.classList.add("tl-list-hit");
  }, [mode, initialId, byId]);

  // Lock the page behind the full-screen scene.
  useEffect(() => {
    if (mode === "list") return;
    // A #entry link may have scrolled the list underneath; the scene sits at the top.
    window.scrollTo(0, 0);
    document.documentElement.classList.add("tl-locked");
    return () => document.documentElement.classList.remove("tl-locked");
  }, [mode]);

  const open = useCallback((id: string | null) => {
    const was = openRef.current;
    setOpenId(id);
    setShareOpen(false);
    apiRef.current?.focus(id, !!id);
    if (id && id !== was) audioRef.current?.open();
    else if (!id && was) audioRef.current?.close();
    try {
      // Each entry's own page is its share link; the address bar follows the open entry.
      history.replaceState(history.state, "", urlFor(id, window.location.search));
    } catch { /* ignore */ }
  }, []);

  // Sound: loaded on the first press or key on the page, and started from inside that gesture.
  useEffect(() => {
    if (mode !== "3d") return;
    let alive = true;
    const onGesture = () => {
      if (audioRef.current) { audioRef.current.gesture(); return; }
      void import("./audio").then(({ createTimelineAudio }) => {
        if (!alive || audioRef.current) return;
        audioRef.current = createTimelineAudio();
        audioRef.current.gesture();
      });
    };
    window.addEventListener("pointerdown", onGesture, true);
    window.addEventListener("keydown", onGesture, true);
    return () => {
      alive = false;
      window.removeEventListener("pointerdown", onGesture, true);
      window.removeEventListener("keydown", onGesture, true);
      audioRef.current?.dispose();
      audioRef.current = null;
    };
  }, [mode]);

  // Load three.js and build the scene.
  useEffect(() => {
    if (mode !== "3d" || !hostRef.current) return;
    let alive = true;
    const host = hostRef.current;
    const deepId = initialId ?? parseDeepLink(window.location, (id) => byId.has(id));
    const deep = deepId ? byId.get(deepId) : undefined;
    import("./scene").then(({ createScene }) => {
      if (!alive) return;
      try {
        apiRef.current = createScene(
          host,
          entries.map((e) => ({
            id: e.id,
            lane: e.lane,
            t: e.t,
            title: e.title,
            date: formatDate(dateRows(e)[0].date),
            meta: metaOf(e),
            laneLabel: LANE_BY_ID[e.lane].label,
            mons: e.lane === "games" ? [...e.legendaries.map((s) => ({ id: s.id, name: s.name, legend: true })), ...e.starters.map((s) => ({ id: s.id, name: s.name, legend: false }))] : undefined,
          })),
          sceneEras,
          LANES.map((l) => ({ id: l.id, color: l.color })),
          {
            frame(t, speed) {
              const y = Math.floor(Math.max(T_START, Math.min(t, tEnd)));
              if (yearRef.current && yearRef.current.textContent !== String(y)) yearRef.current.textContent = String(y);
              const p = pct(Math.max(T_START, Math.min(t, tEnd)));
              if (thumbRef.current) thumbRef.current.style.left = p;
              if (fillRef.current) fillRef.current.style.width = p;
              audioRef.current?.speed(speed);
            },
            open: (id) => open(id),
            current: (id) => setCurrentId(id),
            era(i, forward) {
              setEraIdx(i);
              flashCount.current += 1;
              // The intro is its own title card.
              if (introRef.current) return;
              if (forward || i > 0) setFlash({ i, n: flashCount.current, forward });
              if (flashCount.current > 1) audioRef.current?.era(i);
            },
          },
          deep ? deep.t : T_START + 0.1,
          { regions, intro: introRef.current }
        );
        setReady(true);
        if (deep) open(deep.id);
        if (flyRequested.current) apiRef.current.introFly(INTRO_FLIGHT_S);
      } catch {
        setMode("list");
      }
    }, () => alive && setMode("list"));
    return () => {
      alive = false;
      apiRef.current?.dispose();
      apiRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => { apiRef.current?.setLanes(lanes); }, [lanes, ready]);

  // Hide the era title card a moment after it plays.
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 2300);
    return () => clearTimeout(id);
  }, [flash]);

  // Tour: glide through history on its own, pausing on the key moments; any input ends it.
  useEffect(() => {
    if (!touring || !ready) return;
    const api = apiRef.current;
    if (!api) return;
    if (openRef.current) open(null);
    const plan = buildTour(
      pickTourStops(entries, (id) => lanes.has(byId.get(id)!.lane)),
      { from: T_START }
    );
    api.goTo(T_START);
    audioRef.current?.tour(true);
    const t0 = performance.now();
    let raf = 0, holding: string | null = null;
    const tick = () => {
      const st = tourAt(plan, (performance.now() - t0) / 1000);
      if (st.holding !== holding) {
        holding = st.holding;
        api.focus(holding, false);
        setTourStop(holding);
      }
      if (!holding) api.goTo(st.t);
      if (tourBarRef.current) tourBarRef.current.style.transform = `scaleX(${Math.min(1, (performance.now() - t0) / 1000 / plan.total).toFixed(4)})`;
      if (st.done) { setTouring(false); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const stop = (e: Event) => {
      if ((e.target as HTMLElement | null)?.closest?.("[data-tour-toggle]")) return;
      if (e instanceof KeyboardEvent && ["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      setTouring(false);
    };
    const evs = ["pointerdown", "wheel", "keydown", "touchstart"] as const;
    evs.forEach((n) => window.addEventListener(n, stop, { capture: true, passive: true }));
    return () => {
      cancelAnimationFrame(raf);
      evs.forEach((n) => window.removeEventListener(n, stop, { capture: true }));
      if (holding && !openRef.current) api.focus(null, false);
      setTourStop(null);
      audioRef.current?.tour(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touring, ready]);

  // Keyboard: arrows step entry to entry, Page keys jump eras, Enter opens, Escape closes.
  useEffect(() => {
    if (mode !== "3d") return;
    const onKey = (e: KeyboardEvent) => {
      const api = apiRef.current;
      if (!api || e.altKey || e.metaKey || e.ctrlKey || introRef.current) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (dir) {
        e.preventDefault();
        const id = api.step(dir as 1 | -1);
        if (openRef.current && id) open(id);
      } else if (e.key === "PageDown" || e.key === "PageUp") {
        e.preventDefault();
        if (openRef.current) open(null);
        api.stepEra(e.key === "PageDown" ? 1 : -1);
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        api.goTo(e.key === "Home" ? T_START : tEnd);
      } else if (e.key === "Enter" && !openRef.current && (e.target as HTMLElement).closest?.("button,a") == null) {
        const id = api.current();
        if (id) open(id);
      } else if (e.key === "Escape" && openRef.current) {
        open(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, open, tEnd]);

  // The intro: a title on a dot-matrix screen, then the camera flies in from the dark.
  const introFly = useCallback(() => {
    flyRequested.current = true;
    apiRef.current?.introFly(INTRO_FLIGHT_S);
  }, []);
  const introSkip = useCallback(() => {
    flyRequested.current = true;
    apiRef.current?.introSkip();
  }, []);
  const introDone = useCallback(() => setIntro(false), []);

  // Scrubber: press and drag anywhere on the bar.
  const scrubTo = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const t = T_START + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * span;
    if (openRef.current) open(null);
    apiRef.current?.goTo(t);
  };
  const onScrubDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubTo(e.clientX, e.currentTarget);
  };
  const onScrubMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons) scrubTo(e.clientX, e.currentTarget);
  };

  const toggleLane = (id: LaneId) =>
    setLanes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { if (next.size > 1) next.delete(id); } else next.add(id);
      if (openRef.current && !next.has(byId.get(openRef.current)!.lane)) open(null);
      return next;
    });

  const era = ERAS.find((e) => e.id === eraStarts[eraIdx]?.id) ?? ERAS[0];
  const openEntry = openId ? byId.get(openId) ?? null : null;
  const stopEntry = tourStop ? byId.get(tourStop) ?? null : null;
  const stepOpen = (dir: 1 | -1) => { const id = apiRef.current?.step(dir); if (id) open(id); };

  const chip = "tl-ui pointer-events-auto inline-flex items-center gap-2 rounded-md border bg-card/75 px-3 py-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.12em] backdrop-blur-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <>
      <style>{TIMELINE_CSS}</style>
      {/* Without JavaScript the list is the page. */}
      <noscript><style>{`.tl-stage{display:none!important}`}</style></noscript>
      <div className={cn(mode !== "list" && "tl-under")}>
        {mode === "list" && canGl && webglReadyHint()}
        {children}
      </div>
      {mode !== "list" && (
        <div
          className="tl-stage dark-scope fixed inset-x-0 !mt-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] top-14 z-40 overflow-hidden lg:bottom-0"
          data-testid="timeline-stage"
          data-ready={ready ? "1" : "0"}
          data-era={era.id}
          data-intro={intro ? "1" : "0"}
          data-touring={touring ? "1" : "0"}
          style={{ "--era-a": era.a, "--era-b": era.b, "--era-deep": era.deep } as React.CSSProperties}
        >
          <div className="tl-bg" aria-hidden />
          <div
            ref={hostRef}
            className="tl-host absolute inset-0 isolate z-0 cursor-grab touch-none select-none active:cursor-grabbing"
            data-testid="timeline-scene"
            aria-label="3D timeline of Pokémon history. Scroll, drag or use the arrow keys to travel through time; select a card to open it."
            role="application"
          />
          <div className="tl-fx" aria-hidden />

          {!ready && !intro && (
            <div className="absolute inset-0 flex items-center justify-center" aria-hidden>
              <div className="tl-boot font-pixel text-[10px] uppercase tracking-[0.3em] text-[color:var(--era-a)]">Booting timeline…</div>
            </div>
          )}

          {/* Era change: each generation's own signature transition going forward, a flash of light going back. */}
          {flash && flash.n > 1 && flash.forward && (
            <Suspense fallback={null}>
              <EraTransition key={`tx${flash.n}`} era={eraStarts[flash.i].id} onKick={(f) => apiRef.current?.kick(f)} />
            </Suspense>
          )}
          <AnimatePresence>
            {flash && flash.n > 1 && !flash.forward && (
              <motion.div
                key={`f${flash.n}`}
                className="pointer-events-none absolute inset-0 z-[2]"
                style={{ background: "radial-gradient(60% 50% at 50% 45%, color-mix(in srgb, var(--era-a) 45%, transparent), transparent 70%)" }}
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.9, 0] }}
                transition={{ duration: 0.9, times: [0, 0.25, 1], ease: "easeOut" }}
                aria-hidden
              />
            )}
          </AnimatePresence>
          <AnimatePresence>
            {flash && (
              <motion.div
                key={flash.n}
                className="pointer-events-none absolute inset-x-0 top-[22%] z-[3] flex flex-col items-center text-center"
                initial={{ opacity: 0, scale: 1.25, filter: "blur(10px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, scale: 0.92, filter: "blur(6px)" }}
                transition={{ duration: 0.55, delay: flash.forward && flash.n > 1 ? 0.25 : 0, ease: [0.2, 0.8, 0.2, 1] }}
                data-testid="timeline-era-flash"
              >
                <span className="tl-flash-k font-pixel text-[10px] uppercase tracking-[0.4em] sm:text-xs">{eraStarts[flash.i].year} · {ERAS.find((e) => e.id === eraStarts[flash.i].id)!.device}</span>
                <span className="tl-flash-t mt-2 font-display text-3xl font-bold uppercase tracking-[0.18em] sm:text-6xl">{ERAS.find((e) => e.id === eraStarts[flash.i].id)!.label}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Top bar: back, list view, tour; title; track filters. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 p-3 sm:p-5">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Link href="/pokedex" className={chip + " text-muted-foreground hover:text-foreground"} data-testid="timeline-back">
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Pokédex
                </Link>
                <button type="button" className={chip + " text-muted-foreground hover:text-foreground"} onClick={() => setMode("list")} data-testid="timeline-list-view">
                  <List className="h-3.5 w-3.5" aria-hidden /> List
                </button>
                <button
                  type="button"
                  className={cn(chip, "tl-tour-btn relative overflow-hidden", touring ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
                  onClick={() => setTouring((v) => !v)}
                  aria-pressed={touring}
                  disabled={!ready}
                  data-tour-toggle
                  data-testid="timeline-tour"
                >
                  {touring ? <Square className="h-3 w-3 fill-current" aria-hidden /> : <Play className="h-3.5 w-3.5 fill-current" aria-hidden />}
                  {touring ? "Stop tour" : "Tour"}
                  {touring && <span ref={tourBarRef} className="tl-tour-bar absolute inset-x-0 bottom-0 h-[2px] origin-left" style={{ transform: "scaleX(0)" }} aria-hidden />}
                </button>
              </div>
              <div className="tl-ui">
                <h1 className="font-display text-xl font-bold uppercase leading-none tracking-[0.14em] sm:text-3xl">
                  Pokémon <span className="tl-accent">Timeline</span>
                </h1>
                <p className="mt-1.5 font-pixel text-[9px] uppercase tracking-[0.16em] text-muted-foreground sm:text-[10px]">
                  {era.label} · {era.device}
                </p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="tl-year-readout tl-ui text-right" aria-live="off">
                <span className="block font-pixel text-[9px] uppercase tracking-[0.3em] text-muted-foreground">Year</span>
                <span ref={yearRef} className="font-display text-3xl font-bold tabular-nums leading-none sm:text-5xl" data-testid="timeline-year">{T_START}</span>
              </div>
              <button type="button" className={chip + " lg:hidden"} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((v) => !v)} data-testid="timeline-filters-toggle">
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden /> Tracks
              </button>
            </div>
          </div>

          <div
            className={cn(
              "tl-ui pointer-events-auto absolute right-3 top-[7.5rem] z-10 w-48 flex-col items-stretch gap-1.5 lg:items-end rounded-lg border bg-card/85 p-2 backdrop-blur-md lg:right-5 lg:top-[7.75rem] lg:flex lg:w-auto lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-0",
              filtersOpen ? "flex" : "hidden"
            )}
            role="group"
            aria-label="Tracks"
            data-testid="timeline-filters"
          >
            {LANES.map((l) => {
              const on = lanes.has(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleLane(l.id)}
                  data-testid={`timeline-lane-${l.id}`}
                  className={cn(chip, "justify-between lg:justify-end", on ? "text-foreground" : "text-muted-foreground/60 line-through decoration-1")}
                  style={on ? { borderColor: `hsl(${l.color} / 0.55)`, boxShadow: `0 0 14px hsl(${l.color} / 0.18)` } : undefined}
                >
                  {l.label}
                  <span className="h-2 w-2 rounded-full" style={{ background: on ? `hsl(${l.color})` : "transparent", boxShadow: on ? `0 0 8px hsl(${l.color})` : "none", border: `1px solid hsl(${l.color})` }} aria-hidden />
                </button>
              );
            })}
          </div>

          {/* Tour: the moment it is pausing on. */}
          <AnimatePresence>
            {touring && stopEntry && (
              <motion.div
                key={stopEntry.id}
                className="tl-ui pointer-events-none absolute inset-x-0 bottom-[5.25rem] z-10 flex justify-center px-4 sm:bottom-[6.5rem]"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
                data-testid="timeline-tour-caption"
              >
                <div className="tl-tour-cap max-w-full rounded-lg border bg-card/80 px-4 py-2 text-center backdrop-blur-md" style={{ "--lane": LANE_BY_ID[stopEntry.lane].color } as React.CSSProperties}>
                  <p className="font-pixel text-[9px] uppercase tracking-[0.2em]" style={{ color: `hsl(${LANE_BY_ID[stopEntry.lane].color})` }}>
                    {LANE_BY_ID[stopEntry.lane].label} · {formatDate(dateRows(stopEntry)[0].date)}
                  </p>
                  <p className="truncate font-display text-base font-bold uppercase tracking-wide sm:text-lg">{stopEntry.title}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Bottom: the year scrubber. */}
          <div className="tl-ui pointer-events-none absolute inset-x-0 bottom-0 z-10 px-3 pb-3 sm:px-6 sm:pb-5">
            <div className="mb-2 hidden items-center justify-between font-pixel text-[9px] uppercase tracking-[0.16em] text-muted-foreground sm:flex">
              <span>Scroll, drag or ← → to travel · PgUp / PgDn jumps an era · select a card to open it</span>
              {currentId && byId.get(currentId) && <span className="max-w-[40%] truncate text-foreground/80">{byId.get(currentId)!.title}</span>}
            </div>
            <div
              className="tl-scrub pointer-events-auto relative h-11 cursor-pointer touch-none rounded-md border bg-card/70 backdrop-blur-md"
              onPointerDown={onScrubDown}
              onPointerMove={onScrubMove}
              role="slider"
              aria-label="Year"
              aria-valuemin={T_START}
              aria-valuemax={Math.floor(tEnd)}
              aria-valuenow={Number(yearRef.current?.textContent ?? T_START)}
              tabIndex={0}
              data-testid="timeline-scrubber"
            >
              {eraStarts.map((s, i) => {
                const e = ERAS.find((x) => x.id === s.id)!;
                const end = eraStarts[i + 1]?.start ?? tEnd;
                return (
                  <div key={s.id} className="absolute inset-y-0 overflow-hidden" style={{ left: pct(Math.max(T_START, s.start)), width: `calc(${pct(end)} - ${pct(Math.max(T_START, s.start))})` }}>
                    <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${e.a}, ${e.b})`, boxShadow: `0 0 10px ${e.a}` }} />
                    <span className="absolute left-1.5 top-1.5 hidden font-pixel text-[8px] uppercase tracking-[0.14em] sm:block" style={{ color: e.a }}>
                      {e.gens.map((g) => ROMAN[g]).join("–")}
                    </span>
                  </div>
                );
              })}
              {entries.filter((e) => lanes.has(e.lane)).map((e) => (
                <span key={e.id} className="absolute bottom-1.5 h-2 w-px" style={{ left: pct(e.t), background: `hsl(${LANE_BY_ID[e.lane].color} / 0.75)` }} aria-hidden />
              ))}
              {[2000, 2005, 2010, 2015, 2020, 2025].map((y) => (
                <span key={y} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 font-pixel text-[8px] text-muted-foreground/70" style={{ left: pct(y) }} aria-hidden>
                  {y}
                </span>
              ))}
              <div ref={fillRef} className="absolute inset-y-0 left-0 rounded-l-md bg-[color:var(--era-a)] opacity-[0.08]" />
              <div ref={thumbRef} className="tl-thumb absolute inset-y-[-4px] w-[3px] -translate-x-1/2 rounded-full" aria-hidden />
            </div>
          </div>

          {/* Entry detail. */}
          <AnimatePresence>
            {openEntry && (
              <motion.aside
                key="detail"
                className="tl-ui tl-panel pointer-events-auto absolute inset-x-0 bottom-0 z-20 max-h-[72%] overflow-y-auto overscroll-contain rounded-t-xl border-t bg-card/95 backdrop-blur-xl lg:inset-x-auto lg:bottom-auto lg:right-5 lg:top-5 lg:max-h-[calc(100%-8.5rem)] lg:w-[400px] lg:rounded-xl lg:border"
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 30 }}
                transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
                aria-label={openEntry.title}
                data-testid="timeline-detail"
                style={{ "--lane": LANE_BY_ID[openEntry.lane].color } as React.CSSProperties}
              >
                <div className="sticky top-0 z-10 border-b border-foreground/[0.06] bg-card/95 backdrop-blur-xl">
                  <div className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <div className="flex gap-1">
                      <button type="button" onClick={() => stepOpen(-1)} className="rounded-md border p-1.5 text-muted-foreground hover:text-foreground" aria-label="Previous entry"><ChevronLeft className="h-4 w-4" /></button>
                      <button type="button" onClick={() => stepOpen(1)} className="rounded-md border p-1.5 text-muted-foreground hover:text-foreground" aria-label="Next entry" data-testid="timeline-detail-next"><ChevronRight className="h-4 w-4" /></button>
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setShareOpen((v) => !v)}
                        aria-expanded={shareOpen}
                        className={cn("inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors", shareOpen ? "border-[hsl(var(--lane)/0.7)] text-foreground" : "text-muted-foreground hover:text-foreground")}
                        data-testid="timeline-share"
                      >
                        <Share2 className="h-3.5 w-3.5" aria-hidden /> Share
                      </button>
                      <button type="button" onClick={() => open(null)} className="rounded-md border p-1.5 text-muted-foreground hover:text-foreground" aria-label="Close" data-testid="timeline-detail-close"><X className="h-4 w-4" /></button>
                    </div>
                  </div>
                  <AnimatePresence initial={false}>
                    {shareOpen && (
                      <Suspense key={openEntry.id} fallback={null}>
                        <TimelineShare entry={openEntry} onShared={() => audioRef.current?.share()} />
                      </Suspense>
                    )}
                  </AnimatePresence>
                </div>
                <TimelineDetail entry={openEntry} />
              </motion.aside>
            )}
          </AnimatePresence>

          {intro && (
            <Suspense fallback={<div className="absolute inset-0 z-30 bg-black" aria-hidden />}>
              <TimelineIntro ready={ready} flyAt={INTRO_FLY_AT} onFly={introFly} onSkip={introSkip} onDone={introDone} />
            </Suspense>
          )}
        </div>
      )}
    </>
  );

  function webglReadyHint() {
    return (
      <div className="mb-4 flex justify-end">
        <button type="button" onClick={() => setMode("3d")} className="rounded-md border bg-card px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:border-screen/60 hover:text-foreground" data-testid="timeline-3d-view">
          Open the 3D timeline
        </button>
      </div>
    );
  }
}
