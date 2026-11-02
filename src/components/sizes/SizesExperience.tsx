"use client";

import Link from "next/link";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ChevronDown, Clapperboard, List, Play, Plus, RotateCcw, Scale, Search, Share2, Square, Volume2, VolumeX, X, ZoomIn, ZoomOut } from "lucide-react";
import { isMuted, onMuteChange, setMuted } from "@/lib/sound";
import { copyText } from "@/lib/share";
import { fromRow, formatFeet, formatMetres, type SizeItem, type SizeRow } from "@/lib/sizes/types";
import { DEFAULT_PRESET, PRESETS, PRESET_BY_ID } from "@/lib/sizes/presets";
import { COMPARE_MAX, COMPARE_MIN, comparePath, compareOk, itemPath, parseVs, presetPath } from "@/lib/sizes/deeplink";
import { compareHook, lineFor, pushCompare, searchItems, type LineSpec } from "@/lib/sizes/lineup";
import { framer, viewWidth, type Framer, type Lens } from "@/lib/sizes/glide";
import { nearestIndex, planPlay, playAt, type PlayPlan } from "@/lib/sizes/play";
import { FRICTION, RATE, ORBIT_PER_PX, TILT_PER_PX, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_BUTTON, ZOOM_STEP_KEY, angleDelta, badgeBudget, badgeScaleFor, blendViews, clampOrbit, clampTilt, clampX, clampZoom, coast, damp, dragMetres, effectiveZoom, exploreView, flightAt, flightSeconds, overviewView, pinchZoom, releaseVelocity, stepIndex, viewAhead, wheelPixels, wheelZoom, zoomAnchorShift, zoomFloorAt, type Flight } from "@/lib/sizes/explore";
import { factFor, spanFact } from "@/lib/sizes/facts";
import { markIntroSeen, shouldAutoPlay } from "@/lib/sizes/intro";
import type { View } from "@/lib/sizes/camera";
import { badgeName, dexTag } from "@/lib/sizes/badges";
import type { FutureView, Quality, SizesScene } from "./scene";
import type { SizesAudio } from "./audio";
import { BadgeLayer } from "./overlay";
import { SCENE_URLS, toSceneItem } from "./scene-item";
import { SIZES_CSS } from "./sizes-css";
import { trainerFigure } from "./trainer-figure";
import { useAccount } from "@/lib/account";
import { cn } from "@/lib/utils";

const MakeVideo = lazy(() => import("./MakeVideo"));

type Mode = "boot" | "3d" | "list";
type Kind = "play" | "explore" | "overview" | "hold";

interface Placed {
  key: string;
  x: number;
  w: number;
  h: number;
}

let rowsPromise: Promise<SizeItem[]> | null = null;
/** Every figure (fetched once per page load, static and cached by the CDN). */
export function loadSizeItems(): Promise<SizeItem[]> {
  rowsPromise ??= fetch("/api/sizes")
    .then((r) => {
      if (!r.ok) throw new Error(`sizes ${r.status}`);
      return r.json() as Promise<SizeRow[]>;
    })
    .then((rows) => rows.map(fromRow))
    .catch((e) => {
      rowsPromise = null;
      throw e;
    });
  return rowsPromise;
}

function webglOk() {
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
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

/**
 * Phones, touch screens and low-memory devices start on the light render,
 * everything else on the middle one; the frame-time monitor takes it from
 * there, in both directions.
 */
function initialQuality(): Quality {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const short = Math.min(window.screen.width, window.screen.height);
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  if (coarse || short < 600 || (nav.deviceMemory !== undefined && nav.deviceMemory <= 4)) return "low";
  return "medium";
}
/** A render quality from the address (?q=draft), for automated checks on machines without a GPU: it stays put. */
function qualityParam(): Quality | null {
  try {
    const q = new URLSearchParams(window.location.search).get("q");
    return q === "draft" || q === "low" || q === "medium" || q === "high" ? q : null;
  } catch {
    return null;
  }
}
/** The live qualities, lightest first (exports and the test render are never chosen by the monitor). */
const LADDER: Quality[] = ["low", "medium", "high"];
/** A frame-time average above this (ms) is slow on any screen. */
const SLOW_MS = 18;
/** The drag follows the pointer this closely (per second); everything else eases at its RATE. */
const RATE_DRAG = 22;
const LZ_MIN = Math.log(ZOOM_MIN), LZ_MAX = Math.log(ZOOM_MAX);
/** A twist must pass this angle (radians) before it orbits, so a pinch doesn't wobble the view. */
const TWIST_DEAD = 0.14;
const softDead = (a: number, dead: number) => Math.sign(a) * Math.max(0, Math.abs(a) - dead);

const sizeLine = (i: SizeItem) => `${formatMetres(i.m)}${i.min ? "+" : ""} · ${formatFeet(i.m)}${i.min ? "+" : ""}`;

export interface SizesExperienceProps {
  /** The lineup the page opens on. */
  preset: string;
  /** A Pokémon's or form's own page: open there (no autoplay). */
  focus?: string | null;
  /** A comparison from the address (validated on the server). */
  vs?: string[];
  /** The comparison page: the tray opens even before two are chosen. */
  compare?: boolean;
  /** The server-rendered list: what search engines, reduced motion and browsers without WebGL get. */
  children: React.ReactNode;
}

/**
 * /pokedex/sizes: every Pokémon to scale, standing in a line down a sunny
 * Lumiose City boulevard, smallest first. Play glides the camera along the
 * line (the cinematic), Explore lets you drag, scroll, step and search,
 * Compare stands 2 to 6 side by side, and "Make a video" renders a vertical
 * MP4 for TikTok, Reels and Shorts. The list underneath is the page for
 * search engines, reduced motion and browsers without WebGL.
 */
export function SizesExperience({ preset, focus = null, vs = [], compare = false, children }: SizesExperienceProps) {
  const [mode, setMode] = useState<Mode>("boot");
  const [canGl, setCanGl] = useState(false);
  const [items, setItems] = useState<SizeItem[] | null>(null);
  const [ready, setReady] = useState(false);
  const [spec, setSpec] = useState<LineSpec>(() => ({ preset, vs, extra: focus ? [focus] : [] }));
  const [kind, setKind] = useState<Kind>("explore");
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [caption, setCaption] = useState<{ key: string; text: string } | null>(null);
  const [hook, setHook] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(vs.length > 0 || compare);
  const [compareKeys, setCompareKeys] = useState<string[]>(vs);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [presetMenu, setPresetMenu] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [muted, setMutedState] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [quality, setQualityState] = useState<Quality>("high");
  /** The first view is built and showing (the scene stays hidden behind the loading card until then). */
  const [shown, setShown] = useState(false);
  const shownRef = useRef(false);
  const account = useAccount();
  const myTrainer = account.user?.avatar?.trainer ?? null;
  const trainerRef = useRef(myTrainer);
  trainerRef.current = myTrainer;

  const stageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const sceneRef = useRef<SizesScene | null>(null);
  const audioRef = useRef<SizesAudio | null>(null);
  const lineRef = useRef<SizeItem[]>([]);
  const byKeyRef = useRef<Map<string, SizeItem>>(new Map());
  const placedRef = useRef<Placed[]>([]);
  const frRef = useRef<Framer | null>(null);
  const lensRef = useRef<Lens>({ vfov: 35, aspect: 16 / 9 });
  const sizeRef = useRef({ w: 1, h: 1 });
  const autoplayRef = useRef(false);
  const pendingRef = useRef<{ focus?: string; play?: boolean; overview?: boolean } | null>(focus ? { focus } : vs.length >= COMPARE_MIN ? { overview: true } : null);
  const recordingRef = useRef(false);
  recordingRef.current = recording;
  const hookRef = useRef<string | null>(null);
  hookRef.current = hook;
  const ctl = useRef({
    kind: "explore" as Kind,
    /** Point on the line: current, target and flick velocity (m/s). */
    x: 0,
    target: 0,
    vel: 0,
    /** The visitor's look: log zoom, tilt and orbit (current and target), with the flick velocities of tilt and orbit. */
    lz: 0,
    lzT: 0,
    tilt: 0,
    tiltT: 0,
    vTilt: 0,
    orbit: 0,
    orbitT: 0,
    vOrbit: 0,
    /** A pointer is holding the camera (drag, pinch). */
    dragging: false,
    /** A trackpad gesture (Safari's pinch and twist) is under way. */
    gesturing: false,
    /** When the last input arrived (performance.now(), ms). */
    lastInput: -1e9,
    flight: null as Flight | null,
    /** The flights' own clock (it slows with the camera when loading falls behind). */
    flightNow: 0,
    play: null as { plan: PlayPlan; t: number; stop: string | null; finale: boolean } | null,
    /** Camera speed, 1 normally: eased down while a figure on screen still waits for its detail, never for long. */
    ease: 1,
    easedFor: 0,
    blend: null as { from: View; t0: number; dur: number } | null,
    last: null as View | null,
    now: 0,
  });
  const qualityPinnedRef = useRef(false);
  const badgesRef = useRef<BadgeLayer | null>(null);

  const byKey = useMemo(() => new Map((items ?? []).map((i) => [i.key, i])), [items]);
  const line = useMemo(() => (items ? lineFor(spec, items) : []), [items, spec]);
  const presetInfo = PRESET_BY_ID.get(spec.preset) ?? DEFAULT_PRESET;
  const comparing = compareOk(spec.vs.length);
  const comparingRef = useRef(comparing);
  comparingRef.current = comparing;
  const lineTitle = comparing ? compareHook(line).replace(/ 😳$/, "") : presetInfo.label;
  const hookText = comparing ? compareHook(line) : presetInfo.hook;
  const focusItem = focusKey ? byKey.get(focusKey) ?? null : null;

  // ---- Which view: 3D unless reduced motion, no WebGL or ?view=list.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const params = new URLSearchParams(window.location.search);
    const forced = params.get("view");
    const gl = webglOk();
    setCanGl(gl);
    const next: Mode = forced === "list" || (forced !== "3d" && reduce) || !gl ? "list" : "3d";
    setMode(next);
    setMutedState(isMuted());
    // ?vs= on any page opens that comparison.
    if (!vs.length && params.get("vs")) {
      void loadSizeItems().then((all) => {
        const keys = parseVs(params.get("vs"), (k) => all.some((i) => i.key === k && i.kind !== "ref"));
        if (compareOk(keys.length)) {
          setCompareKeys(keys);
          setCompareOpen(true);
          pendingRef.current = { overview: true };
          setSpec((s) => ({ ...s, vs: keys, extra: [] }));
        }
      }).catch(() => undefined);
    }
    if (next === "3d") {
      const deep = !!focus || vs.length > 0 || !!params.get("vs");
      autoplayRef.current = shouldAutoPlay({ store: localStore(), reducedMotion: reduce, deepLink: deep });
      if (autoplayRef.current) markIntroSeen(localStore());
    }
    return onMuteChange(setMutedState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // List view on a Pokémon's own link: bring its row into view.
  useEffect(() => {
    if (mode !== "list" || !focus) return;
    const el = document.getElementById(`size-${focus}`);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.classList.add("sz-list-hit");
  }, [mode, focus]);

  // Lock the page behind the full-screen stage.
  useEffect(() => {
    if (mode === "list") return;
    window.scrollTo(0, 0);
    document.documentElement.classList.add("sz-locked");
    return () => document.documentElement.classList.remove("sz-locked");
  }, [mode]);

  // ---- Data.
  useEffect(() => {
    if (mode !== "3d" || items) return;
    let alive = true;
    loadSizeItems().then((all) => alive && setItems(all), () => alive && setMode("list"));
    return () => { alive = false; };
  }, [mode, items]);

  // ---- Sound: loaded on the first press or key, started from inside that gesture.
  useEffect(() => {
    if (mode !== "3d") return;
    let alive = true;
    const onGesture = () => {
      if (audioRef.current) { audioRef.current.gesture(); return; }
      void import("./audio").then(({ createSizesAudio }) => {
        if (!alive || audioRef.current) return;
        audioRef.current = createSizesAudio();
        if (ctl.current.kind === "play") audioRef.current.music(true);
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

  // ---- Camera control.
  const startBlend = useCallback((dur: number) => {
    const c = ctl.current;
    if (c.last) c.blend = { from: c.last, t0: c.now, dur };
  }, []);

  const toExplore = useCallback((blend = 0.7) => {
    const c = ctl.current;
    c.lastInput = performance.now();
    if (c.kind === "explore") return;
    const wasPlaying = c.kind === "play";
    if (c.last) {
      c.x = c.target = c.last.x;
      // Leaving Compare's overview, the explore camera starts as far back as the overview stood (Play and its finale keep the visitor's own zoom).
      const fr = frRef.current;
      if (c.kind === "overview" && fr) {
        c.lz = c.lzT = Math.log(clampZoom(effectiveZoom(fr.at(c.last.x), c.last.d)));
        c.tilt = c.tiltT = 0;
        c.orbit = c.orbitT = 0;
      }
    }
    c.vel = c.vTilt = c.vOrbit = 0;
    c.flight = null;
    c.play = null;
    c.kind = "explore";
    setKind("explore");
    startBlend(blend);
    if (wasPlaying) { setCaption(null); setHook(null); audioRef.current?.music(false); }
  }, [startBlend]);

  /**
   * Zooms by a log factor (positive is closer). With `anchorX` (px from the
   * stage's left), the spot under the pointer stays about where it is.
   */
  const zoomBy = useCallback((dlz: number, anchorX?: number) => {
    const c = ctl.current;
    const fr = frRef.current;
    if (!fr || recordingRef.current) return;
    if (c.kind !== "explore") toExplore(0.5);
    c.lastInput = performance.now();
    // Over the giants the distance cap holds the camera: a zoom left further out (from smaller figures) starts back from there.
    const lo = Math.log(zoomFloorAt(fr.at(c.target)));
    const from = Math.max(lo, Math.min(LZ_MAX, c.lzT));
    const next = Math.max(lo, Math.min(LZ_MAX, from + dlz));
    const w = sizeRef.current.w;
    if (anchorX !== undefined && c.last && !c.flight && next !== from) c.target += 0.7 * zoomAnchorShift(anchorX - w / 2, w, c.last.d, Math.exp(next - from), lensRef.current);
    c.lzT = next;
  }, [toExplore]);

  /** Back to the automatic framing, level and square on (a comparison goes back to its overview). */
  const resetView = useCallback(() => {
    const c = ctl.current;
    if (recordingRef.current) return;
    c.lastInput = performance.now();
    c.vTilt = c.vOrbit = c.vel = 0;
    c.lzT = 0;
    c.tiltT = 0;
    c.orbitT = 0;
    if (comparingRef.current) {
      // Stopping a glide also stops its music and captions.
      if (c.kind === "play") toExplore(0.3);
      c.lz = c.tilt = c.orbit = 0;
      c.play = null;
      c.flight = null;
      c.kind = "overview";
      setKind("overview");
      startBlend(0.9);
      return;
    }
    if (c.kind !== "explore") toExplore(0.6);
  }, [startBlend, toExplore]);

  const startPlay = useCallback((showHook: boolean) => {
    const placed = placedRef.current;
    if (!placed.length) return;
    const c = ctl.current;
    const plan = planPlay(placed, lensRef.current);
    c.play = { plan, t: 0, stop: null, finale: false };
    c.flight = null;
    c.kind = "play";
    setKind("play");
    setCaption(null);
    startBlend(1.1);
    if (showHook) setHook(hookText);
    audioRef.current?.music(true);
  }, [startBlend, hookText]);

  /** Flies along the line to a figure; `frame` (a search) also brings a wide view back in so the figure is seen. */
  const flyTo = useCallback((key: string, frame = false) => {
    const placed = placedRef.current;
    const i = placed.findIndex((p) => p.key === key);
    if (i < 0) return false;
    const c = ctl.current;
    if (c.kind !== "explore") toExplore(0.5);
    const d = c.last?.d ?? 2;
    const from = c.x;
    c.flight = { from, to: placed[i].x, t0: c.flightNow, dur: flightSeconds(from, placed[i].x, 2 * d * Math.tan((lensRef.current.vfov * Math.PI) / 360) * lensRef.current.aspect) };
    c.vel = 0;
    if (frame && c.lzT < Math.log(0.7)) c.lzT = 0;
    if (Math.abs(placed[i].x - from) > 0.5) audioRef.current?.whoosh(0.8);
    return true;
  }, [toExplore]);

  const showOverview = useCallback(() => {
    const c = ctl.current;
    c.play = null;
    c.flight = null;
    c.kind = "overview";
    setKind("overview");
    startBlend(1.2);
    audioRef.current?.music(false);
    audioRef.current?.whoosh(1);
  }, [startBlend]);

  // ---- The scene: three.js loads only here.
  useEffect(() => {
    if (mode !== "3d" || !items || !hostRef.current) return;
    let alive = true;
    const host = hostRef.current;
    import("./scene").then(async ({ createSizesScene }) => {
      if (!alive) return;
      try {
        const pinned = qualityParam();
        qualityPinnedRef.current = pinned !== null;
        const q = pinned ?? initialQuality();
        // The human is built when it first comes near the camera: by then the player's own trainer has usually loaded.
        const scene = createSizesScene(host, { quality: q, urls: SCENE_URLS, trainer: () => trainerFigure(trainerRef.current)() });
        sceneRef.current = scene;
        setQualityState(q);
        await scene.ready;
        if (!alive) return;
        setReady(true);
      } catch {
        if (alive) setMode("list");
      }
    }, () => alive && setMode("list"));
    return () => {
      alive = false;
      sceneRef.current?.dispose();
      sceneRef.current = null;
      setReady(false);
    };
  }, [mode, items]);

  // ---- The line: rebuilt when the lineup changes.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!ready || !scene || !items) return;
    lineRef.current = line;
    byKeyRef.current = new Map(line.map((i) => [i.key, i]));
    const { placed } = scene.setLine(line.map(toSceneItem));
    placedRef.current = placed;
    frRef.current = framer(placed, lensRef.current);
    const c = ctl.current;
    const pending = pendingRef.current;
    pendingRef.current = null;
    c.blend = null;
    c.flight = null;
    // A new lineup starts on the automatic framing.
    c.lz = c.lzT = c.tilt = c.tiltT = c.orbit = c.orbitT = 0;
    c.vel = c.vTilt = c.vOrbit = 0;
    const at = pending?.focus ? placed.find((p) => p.key === pending.focus) : undefined;
    c.x = c.target = at ? at.x : placed[0]?.x ?? 0;
    c.last = null;
    if (pending?.overview && compareOk(spec.vs.length)) {
      c.kind = "overview";
      setKind("overview");
    } else if (pending?.play || (autoplayRef.current && !at)) {
      autoplayRef.current = false;
      startPlay(true);
    } else {
      c.kind = "explore";
      c.play = null;
      setKind("explore");
    }
    // Every figure shader compiles now, before the first frame, instead of mid-glide.
    try { scene.warm(); } catch { /* drawing will compile them instead */ }
    // The first view is built before it is shown (and the glide waits for it): nothing pops in on arrival.
    let alive = true;
    setShown(false);
    shownRef.current = false;
    const v = c.kind === "overview" ? overviewView(placed, lensRef.current) : exploreView(c.x, frRef.current, scene.heightAt);
    scene.setView(v);
    void scene.settle(5000).then(() => {
      if (!alive) return;
      shownRef.current = true;
      setShown(true);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, line]);

  // ---- Size: the scene, the badge layer and the lens follow the stage.
  useEffect(() => {
    if (!ready || !hostRef.current) return;
    const host = hostRef.current;
    const fit = () => {
      const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
      sizeRef.current = { w, h };
      sceneRef.current?.resize(w, h);
      const cv = overlayRef.current;
      if (cv) {
        // The badges are text: drawn at the screen's own density (phones are 3×), so they stay crisp.
        const dpr = Math.min(3, window.devicePixelRatio || 1);
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
        badgesRef.current?.invalidate();
      }
      lensRef.current = { vfov: w / h < 0.8 ? 46 : 35, aspect: w / h };
      if (placedRef.current.length) frRef.current = framer(placedRef.current, lensRef.current);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    return () => ro.disconnect();
  }, [ready]);

  // ---- The frame loop.
  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    let last = performance.now();
    let lastFocus: string | null = null, lastFocusAt = 0, lastThumb = -1, lastProgress = "", lastPublish = 0, lastLook = "", hookShown = false, ahead = 0;
    // Adaptive quality: frame-time average, the display's own frame interval, and how long frames have been slow or comfortable.
    let ftEma = 1000 / 60, refresh = 1000 / 60, slowFor = 0, calmFor = 0, warm = 0, raisedAt = -1e9, ceiling = LADDER.length - 1;
    const font = getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim() || "sans-serif";
    const badges = new BadgeLayer(font);
    badgesRef.current = badges;
    /** The views the camera will reach over the next seconds (and, while it rests, further along both ways), soonest first: the scene builds what they need ahead. */
    const futureViews = (view: View, scene: SizesScene, fr: Framer, placed: Placed[]): FutureView[] => {
      const c = ctl.current;
      const out: FutureView[] = [];
      if (c.kind === "play" && c.play) {
        const end = c.play.plan.glide.duration + 0.5;
        for (const tau of [0.3, 0.6, 1, 1.5, 2.1, 2.8, 3.6, 4.6, 5.8, 7.2, 9, 11.5, 14]) {
          if (c.play.t + tau > end) break;
          out.push({ view: playAt(c.play.plan, c.play.t + tau, scene.heightAt).view, dt: tau });
        }
        return out;
      }
      if (c.kind !== "explore") return out;
      const look = { zoom: Math.exp(c.lz), tilt: c.tilt, orbit: c.orbit };
      const first = placed[0], lastP = placed[placed.length - 1];
      const at = (x: number) => exploreView(clampX(x, first, lastP), fr, scene.heightAt, look);
      if (c.flight) {
        for (const tau of [0.2, 0.45, 0.8, 1.2, 1.7, 2.3, 3]) {
          const f = flightAt(c.flight, c.flightNow + tau);
          out.push({ view: at(f.x), dt: tau });
          if (f.done) break;
        }
      } else if (Math.abs(c.vel) > 1e-3 || Math.abs(c.target - c.x) > 1e-3 * Math.max(0.05, view.d)) {
        for (const tau of [0.15, 0.4, 0.8, 1.3, 2]) out.push({ view: at(viewAhead(c.x, c.target, c.vel, tau)), dt: tau });
      }
      // The next stretch either way, nearest first (it only loads while nothing sooner is waiting).
      const w = viewWidth(view.d, lensRef.current);
      for (let k = 1; k <= 6; k++) for (const dir of [1, -1]) out.push({ view: at(view.x + dir * k * w * 0.55), dt: 1.2 + k * 0.7 + (dir < 0 ? 0.35 : 0) });
      return out;
    };
    // A web font that arrives late changes every badge's measurements.
    const onFonts = () => badges.reset(font);
    document.fonts?.addEventListener?.("loadingdone", onFonts);
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const scene = sceneRef.current;
      const fr = frRef.current;
      const placed = placedRef.current;
      if (!scene || !fr || !placed.length || recordingRef.current) { last = performance.now(); return; }
      const now = performance.now();
      const raw = now - last;
      // Time moves on with the clock (a slow device still finishes a flight in about its time), capped after a hidden tab.
      const dt = Math.min(0.25, raw / 1000);
      last = now;
      const c = ctl.current;
      c.now += dt;
      const lens = lensRef.current;
      // Loading behind the camera: ease off (quickly), and back up (gently) once it has caught up; never for more than a few seconds at a time.
      const lag = shownRef.current ? scene.pending() : 1;
      const easing = lag > 0.04 && c.easedFor < 3;
      c.easedFor = easing ? c.easedFor + dt : Math.max(0, c.easedFor - dt * 0.5);
      c.ease = shownRef.current ? damp(c.ease, easing ? Math.max(0.12, 1 - lag * 1.6) : 1, easing ? 7 : 2.2, dt) : 0;
      const mdt = dt * c.ease;
      c.flightNow += mdt;
      let view: View;
      let focusNow: string | null = null;
      if (c.kind === "play" && c.play) {
        c.play.t += mdt;
        const pt = c.play.t;
        const pf = playAt(c.play.plan, pt, scene.heightAt);
        view = pf.view;
        focusNow = pf.focus;
        const stop = c.play.plan.glide.stops.find((s) => pt >= s.t0 && pt <= s.t1) ?? null;
        const stopKey = stop?.key ?? null;
        if (stopKey !== c.play.stop) {
          c.play.stop = stopKey;
          if (stop) {
            const item = byKeyRef.current.get(stop.key);
            const text = stop.finale ? spanFact(lineRef.current) ?? (item ? factFor(item, lineRef.current) : null) : item ? factFor(item, lineRef.current) : null;
            setCaption(text ? { key: stop.key, text } : null);
            if (stop.finale) audioRef.current?.swell();
            else audioRef.current?.whoosh(0.6);
          } else setCaption(null);
        }
        if (pt > 2.6 && hookRef.current) setHook(null);
        const p = Math.min(1, pt / c.play.plan.glide.duration).toFixed(3);
        if (progressRef.current && p !== lastProgress) {
          lastProgress = p;
          progressRef.current.style.transform = `scaleX(${p})`;
        }
        if (pf.state.done) {
          // The finale holds until the next input.
          c.kind = "hold";
          c.play = null;
          setKind("hold");
          audioRef.current?.music(false);
        }
      } else if (c.kind === "hold" && c.last) {
        view = c.last;
        focusNow = lastFocus;
      } else if (c.kind === "overview") {
        view = overviewView(placed, lens);
        focusNow = placed.reduce((a, b) => (b.h > a.h ? b : a)).key;
      } else {
        // Explore: the visitor's camera, every part easing towards its target at a rate that doesn't depend on the frame rate.
        const first = placed[0], lastP = placed[placed.length - 1];
        if (c.flight) {
          const f = flightAt(c.flight, c.flightNow);
          c.x = c.target = f.x;
          if (f.done) c.flight = null;
        } else {
          if (!c.dragging) ({ target: c.target, vel: c.vel } = coast(c.target, c.vel, FRICTION.x, mdt));
          const t = clampX(c.target, first, lastP);
          if (t !== c.target) { c.target = t; c.vel = 0; }
          c.x = damp(c.x, c.target, (c.dragging ? RATE_DRAG : RATE.x) * Math.max(0.2, c.ease), dt);
        }
        c.x = clampX(c.x, first, lastP);
        if (!c.dragging) {
          ({ target: c.tiltT, vel: c.vTilt } = coast(c.tiltT, c.vTilt, FRICTION.tilt, dt));
          ({ target: c.orbitT, vel: c.vOrbit } = coast(c.orbitT, c.vOrbit, FRICTION.orbit, dt));
        }
        c.lzT = Math.max(LZ_MIN, Math.min(LZ_MAX, c.lzT));
        c.lz = damp(c.lz, c.lzT, RATE.zoom, dt);
        const zoom = Math.exp(c.lz);
        const h = scene.heightAt(c.x);
        const tiltT = clampTilt(c.tiltT, h, zoom);
        if (tiltT !== c.tiltT) { c.tiltT = tiltT; c.vTilt = 0; }
        const orbitT = clampOrbit(c.orbitT);
        if (orbitT !== c.orbitT) { c.orbitT = orbitT; c.vOrbit = 0; }
        c.tilt = damp(c.tilt, c.tiltT, c.dragging ? RATE_DRAG : RATE.tilt, dt);
        c.orbit = damp(c.orbit, c.orbitT, c.dragging ? RATE_DRAG : RATE.orbit, dt);
        view = exploreView(c.x, fr, scene.heightAt, { zoom, tilt: c.tilt, orbit: c.orbit });
        focusNow = placed[Math.max(0, nearestIndex(placed, c.x))].key;
      }
      if (c.blend) {
        const k = (c.now - c.blend.t0) / c.blend.dur;
        if (k >= 1) c.blend = null;
        else view = blendViews(c.blend.from, view, k);
      }
      c.last = view;
      scene.setView(view);
      // Where the camera is going, so the figures it will need are built ahead (a few times a second is plenty).
      if (++ahead % 4 === 0) scene.prefetch(futureViews(view, scene, fr, placed));
      scene.render(c.now, dt);
      const zoomNow = effectiveZoom(fr.at(view.x), view.d);
      // Badges: fewer and a little smaller as the view widens; the title card has the screen to itself.
      const cv = overlayRef.current;
      if (cv) {
        const g = cv.getContext("2d");
        const { w, h } = sizeRef.current;
        if (g && !hookRef.current) {
          hookShown = false;
          const phone = w < 640;
          // The finale is the giant's alone.
          let max = view.rise > 0.3 ? 1 : phone ? 2 : 4;
          let scale = phone ? 1.15 : 1;
          if (c.kind === "explore") {
            max = Math.min(max, badgeBudget(zoomNow, phone));
            scale *= badgeScaleFor(zoomNow);
          }
          badges.draw(g, scene.anchors(), focusNow, byKeyRef.current, w, h, cv.width / w, { scale, max, top: phone ? 104 : 72, bottom: phone ? 128 : 104 });
        } else if (g && !hookShown) {
          hookShown = true;
          g.setTransform(1, 0, 0, 1, 0, 0);
          g.clearRect(0, 0, cv.width, cv.height);
          badges.invalidate();
        }
      }
      // Where we are on the line (only written when it moves to another figure).
      if (thumbRef.current && placed.length > 1) {
        const i = Math.max(0, nearestIndex(placed, view.x));
        if (i !== lastThumb) {
          lastThumb = i;
          thumbRef.current.style.left = `${((i / (placed.length - 1)) * 100).toFixed(3)}%`;
        }
      }
      // React hears about the framed figure at most a few times a second while the camera moves, and at once when it settles.
      const settled = !c.dragging && !c.gesturing && !c.flight && !c.blend && Math.abs(c.vel) < 1e-3 && Math.abs(c.target - c.x) < 1e-3 * Math.max(0.05, view.d);
      if (focusNow !== lastFocus && (settled || now - lastFocusAt > 160 || c.kind !== "explore")) {
        lastFocus = focusNow;
        lastFocusAt = now;
        setFocusKey(focusNow);
      }
      // The zoom on screen, for tests and tools (an attribute, not React state).
      if (now - lastPublish > 120 && stageRef.current) {
        lastPublish = now;
        const z = zoomNow.toFixed(3), tilt = ((view.pitch * 180) / Math.PI).toFixed(1), orbit = ((view.orbit * 180) / Math.PI).toFixed(1);
        const look = `${z} ${tilt} ${orbit}`;
        if (look !== lastLook) {
          lastLook = look;
          const ds = stageRef.current.dataset;
          ds.zoom = z;
          ds.tilt = tilt;
          ds.orbit = orbit;
        }
      }
      // Adaptive quality: down after half a second of slow frames, up only after several calm seconds with nothing moving.
      if (qualityPinnedRef.current || !LADDER.includes(scene.quality)) return;
      const work = performance.now() - now;
      if (warm < 24 || raw > 400) { warm++; return; }
      ftEma = ftEma * 0.85 + raw * 0.15;
      refresh = Math.min(34, Math.max(6, Math.min(raw, refresh + 0.005)));
      // Slow: dropping frames steadily (under about 46 fps on a 60 Hz screen; a 120 Hz one may settle at 60).
      const slow = ftEma > Math.max(refresh * 1.3, SLOW_MS);
      slowFor = slow ? slowFor + raw : Math.max(0, slowFor - raw * 0.5);
      const level = LADDER.indexOf(scene.quality);
      if (slowFor > 500 && level > 0) {
        // Raised a moment ago and it couldn't keep up: don't try that level again this visit.
        if (now - raisedAt < 10_000) ceiling = level - 1;
        scene.setQuality(LADDER[level - 1]);
        setQualityState(scene.quality);
        slowFor = calmFor = 0;
        warm = 0;
        ftEma = refresh;
        return;
      }
      const busy = c.dragging || c.gesturing || now - c.lastInput < 2500 || !!c.flight || !!c.blend || c.kind === "play";
      const calm = !busy && ftEma < refresh * 1.12 && raw < refresh * 1.6 && work < refresh * 0.4;
      calmFor = calm ? calmFor + raw : 0;
      if (calmFor > 6000 && level < ceiling) {
        scene.setQuality(LADDER[level + 1]);
        setQualityState(scene.quality);
        raisedAt = now;
        slowFor = calmFor = 0;
        warm = 0;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      document.fonts?.removeEventListener?.("loadingdone", onFonts);
      badgesRef.current = null;
    };
  }, [ready]);

  // ---- Input: drags, the wheel, trackpad gestures and keys explore; any of them stops Play.
  useEffect(() => {
    if (!ready || !hostRef.current || !stageRef.current) return;
    const host = hostRef.current;
    const stage = stageRef.current;
    const cam = ctl.current;
    const pts = new Map<number, { x: number; y: number; type: string }>();
    // pan: one finger or the left button (sideways moves along the line, up and down tilts); look: right button, or shift/ctrl and drag (turns round the figure and tilts); pinch: two fingers.
    let mode: "pan" | "look" | "pinch" | null = null;
    let lock: "x" | "y" | null = null;
    let sx = 0, sy = 0, lx = 0, ly = 0;
    let pinch: { spread: number; angle: number; lz: number; orbit: number; mx: number } | null = null;
    let trail: { t: number; x: number; tilt: number; orbit: number }[] = [];
    let gesture: { lz: number; orbit: number } | null = null;
    const here = () => {
      const c = ctl.current;
      return { h: sceneRef.current?.heightAt(c.x) ?? 1, zoom: Math.exp(c.lz) };
    };
    const record = (now: number) => {
      const c = ctl.current;
      trail.push({ t: now, x: c.target, tilt: c.tiltT, orbit: c.orbitT });
      if (trail.length > 12) trail.shift();
    };
    const pair = () => {
      const [a, b] = [...pts.values()];
      return { spread: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2 };
    };
    const startPan = (x: number, y: number) => {
      mode = "pan";
      lock = null;
      sx = lx = x;
      sy = ly = y;
      trail = [];
    };
    const down = (e: PointerEvent) => {
      if (recordingRef.current) return;
      if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 2) return;
      setPresetMenu(false);
      toExplore();
      const c = ctl.current;
      c.flight = null;
      c.vel = c.vTilt = c.vOrbit = 0;
      c.dragging = true;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
      try { host.setPointerCapture(e.pointerId); } catch { /* a synthetic or already-ended pointer */ }
      if (pts.size === 1) {
        startPan(e.clientX, e.clientY);
        if (e.pointerType === "mouse" && (e.button === 2 || e.shiftKey || e.ctrlKey)) mode = "look";
      } else if (pts.size === 2) {
        const p = pair();
        pinch = { spread: p.spread, angle: p.angle, lz: c.lzT, orbit: c.orbitT, mx: p.mx };
        mode = "pinch";
      }
    };
    const move = (e: PointerEvent) => {
      const p = pts.get(e.pointerId);
      const c = ctl.current;
      if (!p || !c.last) return;
      p.x = e.clientX;
      p.y = e.clientY;
      const now = performance.now();
      const w = sizeRef.current.w;
      c.lastInput = now;
      if (mode === "pinch" && pinch && pts.size >= 2) {
        const q = pair();
        const { h } = here();
        const fr = frRef.current;
        const lo = fr ? Math.log(zoomFloorAt(fr.at(c.target))) : LZ_MIN;
        c.lzT = Math.max(lo, Math.min(LZ_MAX, pinchZoom(pinch.lz, pinch.spread, q.spread)));
        // A twist turns the camera round the figure (clockwise fingers, clockwise scene).
        c.orbitT = clampOrbit(pinch.orbit - softDead(angleDelta(pinch.angle, q.angle), TWIST_DEAD));
        c.tiltT = clampTilt(c.tiltT, h, Math.exp(c.lzT));
        c.target += dragMetres(q.mx - pinch.mx, w, c.last.d, lensRef.current);
        pinch.mx = q.mx;
        return;
      }
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      const { h, zoom } = here();
      if (mode === "look") {
        c.orbitT = clampOrbit(c.orbitT + dx * ORBIT_PER_PX);
        c.tiltT = clampTilt(c.tiltT + dy * TILT_PER_PX, h, zoom);
      } else if (mode === "pan") {
        // The first few pixels decide: mostly sideways moves along the line, mostly up or down tilts.
        if (!lock) {
          const tx = e.clientX - sx, ty = e.clientY - sy;
          if (tx * tx + ty * ty > 36) lock = Math.abs(ty) > Math.abs(tx) * 1.15 ? "y" : "x";
        }
        if (lock === "y") c.tiltT = clampTilt(c.tiltT + dy * TILT_PER_PX, h, zoom);
        else c.target += dragMetres(dx, w, c.last.d, lensRef.current);
      }
      record(now);
    };
    const up = (e: PointerEvent) => {
      if (!pts.delete(e.pointerId)) return;
      const c = ctl.current;
      if (mode === "pinch") {
        pinch = null;
        // Lifting one of two fingers carries on as a one-finger drag.
        if (pts.size === 1) {
          const [p] = [...pts.values()];
          startPan(p.x, p.y);
          return;
        }
      }
      if (pts.size) return;
      const now = performance.now();
      // A flick carries on and slows to a stop.
      if (mode === "pan" && lock !== "y") {
        const v = releaseVelocity(trail.map((p) => ({ t: p.t, v: p.x })), now);
        const cap = 6 * (c.last ? 2 * c.last.d * Math.tan((lensRef.current.vfov * Math.PI) / 360) * lensRef.current.aspect : 10);
        c.vel = Math.max(-cap, Math.min(cap, v));
      }
      if (mode === "look" || lock === "y") {
        c.vTilt = Math.max(-3, Math.min(3, releaseVelocity(trail.map((p) => ({ t: p.t, v: p.tilt })), now)));
        if (mode === "look") c.vOrbit = Math.max(-3, Math.min(3, releaseVelocity(trail.map((p) => ({ t: p.t, v: p.orbit })), now)));
      }
      c.dragging = false;
      c.lastInput = now;
      mode = null;
      trail = [];
    };
    // Scrolling: up and down zooms, sideways moves along the line; a trackpad pinch arrives as ctrl + wheel (Chrome, Firefox, Edge).
    const wheel = (e: WheelEvent) => {
      if (recordingRef.current) return;
      // Lists in the page's panels scroll as usual (but a pinch over them still mustn't zoom the page).
      if (!e.ctrlKey && (e.target as HTMLElement).closest?.("[data-sz-scroll]")) return;
      e.preventDefault();
      if (gesture) return;
      const c = ctl.current;
      toExplore();
      if (!c.last) return;
      const { w, h } = sizeRef.current;
      let zy = wheelPixels(e.deltaY, e.deltaMode, h);
      let px = wheelPixels(e.deltaX, e.deltaMode, w);
      // Shift + wheel scrolls sideways on a mouse.
      if (e.shiftKey && !px) { px = zy; zy = 0; }
      if (zy) zoomBy(wheelZoom(zy, e.ctrlKey), e.clientX);
      if (px && !e.ctrlKey) {
        c.flight = null;
        c.target += dragMetres(-px, w, c.last.d, lensRef.current);
        c.vel = 0;
      }
    };
    // Safari: a trackpad pinch (and twist) arrives as gesture events.
    type Gesture = Event & { scale: number; rotation: number; clientX?: number };
    const gstart = (e: Event) => {
      e.preventDefault();
      if (recordingRef.current || [...pts.values()].some((p) => p.type === "touch")) return;
      toExplore();
      const c = ctl.current;
      gesture = { lz: c.lzT, orbit: c.orbitT };
      c.gesturing = true;
    };
    const gchange = (e: Event) => {
      e.preventDefault();
      if (!gesture) return;
      const g = e as Gesture;
      const c = ctl.current;
      zoomBy(gesture.lz + Math.log(Math.max(0.05, g.scale || 1)) - c.lzT, g.clientX);
      c.orbitT = clampOrbit(gesture.orbit - softDead(((g.rotation || 0) * Math.PI) / 180, TWIST_DEAD));
      c.lastInput = performance.now();
    };
    const gend = (e: Event) => {
      e.preventDefault();
      gesture = null;
      ctl.current.gesturing = false;
      ctl.current.lastInput = performance.now();
    };
    const menu = (e: Event) => e.preventDefault();
    host.addEventListener("pointerdown", down);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerup", up);
    host.addEventListener("pointercancel", up);
    host.addEventListener("contextmenu", menu);
    stage.addEventListener("wheel", wheel, { passive: false });
    stage.addEventListener("gesturestart", gstart);
    stage.addEventListener("gesturechange", gchange);
    stage.addEventListener("gestureend", gend);
    return () => {
      host.removeEventListener("pointerdown", down);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerup", up);
      host.removeEventListener("pointercancel", up);
      host.removeEventListener("contextmenu", menu);
      stage.removeEventListener("wheel", wheel);
      stage.removeEventListener("gesturestart", gstart);
      stage.removeEventListener("gesturechange", gchange);
      stage.removeEventListener("gestureend", gend);
      cam.dragging = false;
      cam.gesturing = false;
    };
  }, [ready, toExplore, zoomBy]);

  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.metaKey || e.ctrlKey || recordingRef.current || videoOpen) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
        if (e.key === "Escape") { setSearchOpen(false); (e.target as HTMLElement).blur(); }
        return;
      }
      const placed = placedRef.current;
      if (!placed.length) return;
      const c = ctl.current;
      const here = Math.max(0, nearestIndex(placed, c.last?.x ?? c.x));
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const dir = (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 10 : 1);
        flyTo(placed[stepIndex(here, dir, placed.length)].key);
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        flyTo(placed[e.key === "Home" ? 0 : placed.length - 1].key);
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomBy(ZOOM_STEP_KEY);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomBy(-ZOOM_STEP_KEY);
      } else if (e.key === "0") {
        e.preventDefault();
        resetView();
      } else if (e.key === " " && (e.target as HTMLElement).closest?.("button,a") == null) {
        e.preventDefault();
        if (c.kind === "play") toExplore(); else startPlay(false);
      } else if (e.key === "/") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "Escape") {
        setSearchOpen(false);
        setPresetMenu(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, flyTo, startPlay, toExplore, zoomBy, resetView, videoOpen]);

  useEffect(() => { if (searchOpen) searchRef.current?.focus(); }, [searchOpen]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => { if (stageRef.current) stageRef.current.dataset.q = quality; }, [quality]);

  // ---- Lineups, comparisons and search.
  const replaceUrl = (path: string) => {
    try { history.replaceState(history.state, "", path); } catch { /* ignore */ }
  };

  const choosePreset = (id: string) => {
    setPresetMenu(false);
    setCompareOpen(false);
    setCompareKeys([]);
    pendingRef.current = { play: true };
    setSpec({ preset: id, vs: [], extra: [] });
    replaceUrl(presetPath(id));
  };

  const applyCompare = (keys: string[]) => {
    setCompareKeys(keys);
    if (compareOk(keys.length)) {
      pendingRef.current = { overview: true };
      setSpec((s) => ({ ...s, vs: keys, extra: [] }));
      replaceUrl(comparePath(keys));
    } else if (compareOk(spec.vs.length)) {
      setSpec((s) => ({ ...s, vs: [] }));
      replaceUrl(presetPath(spec.preset));
    }
  };

  const openCompare = () => {
    setCompareOpen(true);
    setPresetMenu(false);
    if (!compareKeys.length && focusItem && focusItem.kind !== "ref") setCompareKeys([focusItem.key]);
    setSearchOpen(true);
  };

  const closeCompare = () => {
    setCompareOpen(false);
    setCompareKeys([]);
    if (compareOk(spec.vs.length)) {
      setSpec((s) => ({ ...s, vs: [] }));
      replaceUrl(presetPath(spec.preset));
    }
  };

  const results = useMemo(() => (items && query.trim() ? searchItems(items, query, 8) : []), [items, query]);

  const pick = (item: SizeItem) => {
    setQuery("");
    if (compareOpen) {
      applyCompare(pushCompare(compareKeys, item.key));
      return;
    }
    setSearchOpen(false);
    if (flyTo(item.key, true)) return;
    // Not on this line: the full line (with the form, when it's a form), flown there.
    pendingRef.current = { focus: item.key };
    setSpec({ preset: DEFAULT_PRESET.id, vs: [], extra: item.kind === "pokemon" ? [] : [item.key] });
    replaceUrl(itemPath(item.key));
  };

  const share = async () => {
    const url = window.location.href;
    const text = comparing ? `${compareHook(line)} Real sizes, side by side in 3D` : focusItem && focusItem.kind !== "ref" ? `How big is ${focusItem.name}? ${sizeLine(focusItem)}` : `${hookText} in 3D`;
    if (typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
      try { await navigator.share({ title: "PokéIQ Sizes", text, url }); return; } catch { /* closed, or not allowed: copy instead */ }
    }
    if (await copyText(url)) setToast("Link copied");
  };

  const toggleMute = () => {
    const next = !isMuted();
    setMuted(next);
    setMutedState(next);
  };

  const scrubTo = (clientX: number, el: HTMLElement) => {
    const placed = placedRef.current;
    if (!placed.length) return;
    const r = el.getBoundingClientRect();
    const i = Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (placed.length - 1));
    toExplore(0.4);
    const c = ctl.current;
    c.flight = null;
    c.vel = 0;
    c.x = c.target = placed[i].x;
  };

  const chip = "sz-chip pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-md border border-white/15 bg-[#0b1226]/70 px-3 font-display text-[11px] font-semibold uppercase tracking-[0.12em] text-white/85 backdrop-blur-md transition-colors hover:border-white/35 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffd84a] disabled:opacity-50";
  const smallest = line.find((i) => i.kind !== "ref");
  const largest = [...line].reverse().find((i) => i.kind !== "ref");
  const playing = kind === "play";

  return (
    <>
      <style>{SIZES_CSS}</style>
      <noscript><style>{`.sz-stage{display:none!important}`}</style></noscript>
      <div>
        {mode === "list" && canGl && (
          <div className="mb-4 flex justify-end">
            <button type="button" onClick={() => setMode("3d")} className="rounded-md border bg-card px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:border-screen/60 hover:text-foreground" data-testid="sizes-3d-view">
              Open the 3D view
            </button>
          </div>
        )}
        {children}
      </div>
      {mode !== "list" && (
        <div
          ref={stageRef}
          className="sz-stage fixed left-0 !mt-0 w-screen bottom-[calc(3.5rem+env(safe-area-inset-bottom))] top-14 z-40 overflow-hidden lg:bottom-0"
          data-testid="sizes-stage"
          data-ready={ready ? "1" : "0"}
          data-shown={shown ? "1" : "0"}
          data-kind={kind}
          data-focus={focusKey ?? ""}
          data-count={line.length}
          data-recording={recording ? "1" : "0"}
        >
          <div
            ref={hostRef}
            className={cn("sz-host absolute inset-0 cursor-grab touch-none select-none transition-opacity duration-500 active:cursor-grabbing", !shown && "opacity-0")}
            data-testid="sizes-scene"
            role="application"
            aria-label="Pokémon to scale in 3D, smallest to largest. Drag sideways or use the arrow keys to move along the line, scroll or pinch to zoom (+ and − keys too), drag up and down to tilt, right-drag or shift-drag to turn; 0 resets the view and Space plays the glide."
          />
          <canvas ref={overlayRef} className="sz-overlay h-full w-full" aria-hidden />
          <div className="sz-shade-top" aria-hidden />
          <div className="sz-shade-bottom" aria-hidden />

          {(!ready || !shown) && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-white" aria-hidden data-testid="sizes-loading">
              <Scale className="h-8 w-8 animate-pulse text-[#ffd84a]" />
              <div className="font-pixel text-[10px] uppercase tracking-[0.3em]">{ready ? "Lining them up…" : "Building Lumiose City…"}</div>
            </div>
          )}

          {/* Title card: the lineup's hook, as the glide begins. */}
          <AnimatePresence>
            {hook && shown && (
              <motion.div
                key={hook}
                className="pointer-events-none absolute inset-x-0 top-[24%] z-[5] flex flex-col items-center px-6 text-center"
                initial={{ opacity: 0, scale: 1.15 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.55, ease: [0.2, 0.8, 0.2, 1] }}
                data-testid="sizes-hook"
              >
                <p className="sz-hook text-4xl sm:text-7xl">{hook.replace(/\s*\p{Extended_Pictographic}+$/u, "")}</p>
                {smallest && largest && (
                  <p className="sz-caption mt-3 text-base uppercase tracking-[0.18em] sm:text-xl">
                    {formatMetres(smallest.m)} to {formatMetres(largest.m)}{largest.min ? "+" : ""}
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Fun fact while the glide pauses. */}
          <AnimatePresence>
            {caption && (
              <motion.div
                key={caption.key}
                className="pointer-events-none absolute inset-x-0 bottom-[8.5rem] z-[5] flex justify-center px-4 sm:bottom-[7.5rem]"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.35 }}
                data-testid="sizes-caption"
              >
                <p className="sz-caption max-w-xl rounded-xl bg-[#0a101e]/60 px-4 py-2 text-center text-base backdrop-blur-sm sm:text-xl">{caption.text}</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Top bar. */}
          <div className="sz-ui pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3 sm:p-4">
            <div className="flex min-w-0 items-center gap-2">
              <Link href="/pokedex" className={cn(chip, "px-2.5")} aria-label="Back to the Pokédex" data-testid="sizes-back">
                <ArrowLeft className="h-4 w-4" aria-hidden />
              </Link>
              <div className="relative min-w-0">
                <button type="button" className={cn(chip, "max-w-[calc(100vw-13rem)] sm:max-w-none")} onClick={() => { setPresetMenu((v) => !v); setSearchOpen(false); }} aria-expanded={presetMenu} aria-haspopup="menu" data-testid="sizes-lineup">
                  <span className="truncate">{lineTitle}</span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                </button>
                {presetMenu && (
                  <div className="pointer-events-auto absolute left-0 top-11 w-64 overflow-hidden rounded-lg border border-white/15 bg-[#0b1226]/95 p-1 shadow-2xl backdrop-blur-xl" role="menu" data-testid="sizes-presets" data-sz-scroll>
                    {PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={!comparing && p.id === spec.preset}
                        onClick={() => choosePreset(p.id)}
                        className={cn("block w-full rounded-md px-3 py-2 text-left font-display text-[13px] font-semibold uppercase tracking-wide text-white/80 hover:bg-white/10 hover:text-white", !comparing && p.id === spec.preset && "bg-white/10 text-[#ffd84a]")}
                        data-testid={`sizes-preset-${p.id}`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" className={cn(chip, "px-2.5")} onClick={() => { setSearchOpen((v) => !v); setPresetMenu(false); }} aria-label="Search for a Pokémon" aria-expanded={searchOpen} data-testid="sizes-search-toggle">
                <Search className="h-4 w-4" aria-hidden />
              </button>
              <button type="button" className={cn(chip, "px-2.5")} onClick={toggleMute} aria-label={muted ? "Turn the music on" : "Turn the music off"} data-testid="sizes-mute">
                {muted ? <VolumeX className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
              </button>
              <button type="button" className={cn(chip, "px-2.5 sm:px-3")} onClick={() => setMode("list")} data-testid="sizes-list-view" aria-label="List view">
                <List className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">List</span>
              </button>
            </div>
          </div>

          {/* Zoom and reset: the wheel, a pinch and the keys do the same. */}
          <div className="sz-ui pointer-events-none absolute right-3 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-2 sm:right-4" data-testid="sizes-view-controls">
            <button type="button" className={cn(chip, "h-10 w-10 justify-center px-0")} onClick={() => zoomBy(ZOOM_STEP_BUTTON)} disabled={!ready} aria-label="Zoom in" title="Zoom in (+)" data-testid="sizes-zoom-in">
              <ZoomIn className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" className={cn(chip, "h-10 w-10 justify-center px-0")} onClick={() => zoomBy(-ZOOM_STEP_BUTTON)} disabled={!ready} aria-label="Zoom out" title="Zoom out (−)" data-testid="sizes-zoom-out">
              <ZoomOut className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" className={cn(chip, "h-10 w-10 justify-center px-0")} onClick={resetView} disabled={!ready} aria-label="Reset the view" title="Reset the view (0)" data-testid="sizes-reset-view">
              <RotateCcw className="h-4 w-4" aria-hidden />
            </button>
          </div>

          {/* Search (also adds to a comparison). */}
          {searchOpen && (
            <div className="sz-ui pointer-events-auto absolute right-3 top-[3.75rem] z-20 w-[min(22rem,calc(100%-1.5rem))] sm:right-4">
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && results[0]) pick(results[0]); }}
                placeholder={compareOpen ? "Add a Pokémon to compare…" : "Fly to a Pokémon…"}
                aria-label={compareOpen ? "Add a Pokémon to compare" : "Search for a Pokémon"}
                className="h-11 w-full rounded-lg border border-white/20 bg-[#0b1226]/90 px-3 font-display text-sm text-white placeholder:text-white/45 shadow-2xl outline-none backdrop-blur-xl focus:border-[#ffd84a]"
                data-testid="sizes-search"
              />
              {results.length > 0 && (
                <ul className="mt-1 max-h-[50vh] overflow-y-auto rounded-lg border border-white/15 bg-[#0b1226]/95 p-1 shadow-2xl backdrop-blur-xl" role="listbox" data-sz-scroll>
                  {results.map((r) => (
                    <li key={r.key}>
                      <button type="button" onClick={() => pick(r)} className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-white/10" data-testid="sizes-search-result" data-key={r.key}>
                        <span className="min-w-0">
                          <span className="block truncate font-display text-sm font-semibold uppercase tracking-wide text-white">{r.name}</span>
                          <span className="block font-pixel text-[9px] uppercase tracking-wider text-white/50">{dexTag(r.species)}</span>
                        </span>
                        <span className="shrink-0 font-display text-sm font-bold tabular-nums text-[#ffd84a]">{formatMetres(r.m)}{r.min ? "+" : ""}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Comparison tray. */}
          {compareOpen && (
            <div className="sz-ui pointer-events-none absolute inset-x-0 bottom-[5.25rem] z-10 flex justify-center px-3 sm:bottom-[5.5rem]" data-testid="sizes-compare-tray">
              <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-[#0b1226]/80 p-1.5 backdrop-blur-xl">
                {compareKeys.map((k) => {
                  const it = byKey.get(k);
                  return (
                    <span key={k} className="inline-flex h-8 items-center gap-1 rounded-md bg-white/10 pl-2.5 pr-1 font-display text-[11px] font-semibold uppercase tracking-wide text-white" data-testid="sizes-compare-chip">
                      {it ? badgeName(it.name) : k}
                      <button type="button" onClick={() => applyCompare(compareKeys.filter((x) => x !== k))} className="rounded p-1 text-white/60 hover:text-white" aria-label={`Remove ${it?.name ?? k}`}><X className="h-3.5 w-3.5" /></button>
                    </span>
                  );
                })}
                {compareKeys.length < COMPARE_MAX && (
                  <button type="button" onClick={() => setSearchOpen(true)} className="inline-flex h-8 items-center gap-1 rounded-md border border-dashed border-white/30 px-2.5 font-display text-[11px] font-semibold uppercase tracking-wide text-white/75 hover:text-white" data-testid="sizes-compare-add">
                    <Plus className="h-3.5 w-3.5" aria-hidden /> {compareKeys.length < COMPARE_MIN ? `Add ${COMPARE_MIN - compareKeys.length} more` : "Add"}
                  </button>
                )}
                {comparing && kind !== "overview" && (
                  <button type="button" onClick={showOverview} className="inline-flex h-8 items-center gap-1 rounded-md px-2 font-display text-[11px] font-semibold uppercase tracking-wide text-white/75 hover:text-white" data-testid="sizes-compare-overview">
                    <Scale className="h-3.5 w-3.5" aria-hidden /> All
                  </button>
                )}
                <button type="button" onClick={closeCompare} className="rounded-md p-1.5 text-white/60 hover:text-white" aria-label="Close the comparison" data-testid="sizes-compare-close"><X className="h-4 w-4" /></button>
              </div>
            </div>
          )}

          {/* Bottom: where on the line, and the actions. */}
          <div className="sz-ui pointer-events-none absolute inset-x-0 bottom-0 z-10 space-y-2.5 px-3 pb-3 sm:px-5 sm:pb-4">
            <div
              className="pointer-events-auto relative h-2.5 cursor-pointer touch-none rounded-full border border-white/20 bg-[#0b1226]/60 backdrop-blur"
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrubTo(e.clientX, e.currentTarget); }}
              onPointerMove={(e) => { if (e.buttons) scrubTo(e.clientX, e.currentTarget); }}
              role="slider"
              aria-label="Position on the line"
              aria-valuemin={1}
              aria-valuemax={line.length}
              aria-valuenow={Math.max(1, line.findIndex((i) => i.key === focusKey) + 1)}
              aria-valuetext={focusItem ? `${focusItem.name}, ${sizeLine(focusItem)}` : undefined}
              tabIndex={0}
              data-testid="sizes-scrubber"
            >
              {playing && <div ref={progressRef} className="sz-progress absolute inset-0 origin-left rounded-full opacity-80" style={{ transform: "scaleX(0)" }} />}
              <div ref={thumbRef} className="sz-thumb absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => (playing ? toExplore() : startPlay(kind !== "hold"))}
                  className="sz-play pointer-events-auto inline-flex h-11 items-center gap-2 rounded-lg px-4 font-display text-sm font-bold uppercase tracking-wider disabled:opacity-50 sm:px-5"
                  disabled={!ready}
                  aria-pressed={playing}
                  data-testid="sizes-play"
                >
                  {playing ? <Square className="h-4 w-4 fill-current" aria-hidden /> : <Play className="h-4 w-4 fill-current" aria-hidden />}
                  {playing ? "Stop" : kind === "hold" ? "Replay" : "Play"}
                </button>
                <button type="button" onClick={() => (compareOpen ? closeCompare() : openCompare())} className={cn(chip, "h-11", compareOpen && "border-[#ffd84a]/70 text-[#ffd84a]")} aria-pressed={compareOpen} disabled={!ready} data-testid="sizes-compare">
                  <Scale className="h-4 w-4" aria-hidden /> <span className="hidden min-[370px]:inline">Compare</span>
                </button>
              </div>
              <div className="hidden min-w-0 flex-1 truncate text-center font-display text-sm font-semibold uppercase tracking-wide text-white/90 md:block" aria-live="off">
                {focusItem && (
                  <>
                    {focusItem.kind !== "ref" && <span className="mr-2 font-pixel text-[10px] text-white/55">{dexTag(focusItem.species)}</span>}
                    {focusItem.name} <span className="text-[#ffd84a]">{sizeLine(focusItem)}</span>
                    {focusItem.length && <span className="ml-1 text-white/55">(Length)</span>}
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={share} className={cn(chip, "h-11 px-3")} aria-label="Share" data-testid="sizes-share">
                  <Share2 className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Share</span>
                </button>
                <button type="button" onClick={() => { toExplore(); setVideoOpen(true); }} className={cn(chip, "h-11 border-[#ffd84a]/50 text-white")} disabled={!ready} data-testid="sizes-video">
                  <Clapperboard className="h-4 w-4 text-[#ffd84a]" aria-hidden /> <span className="sm:hidden">Video</span><span className="hidden sm:inline">Make a video</span>
                </button>
              </div>
            </div>
          </div>

          <AnimatePresence>
            {toast && (
              <motion.div className="pointer-events-none absolute inset-x-0 top-16 z-30 flex justify-center" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="status">
                <span className="rounded-md bg-[#0b1226]/90 px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider text-white">{toast}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {videoOpen && items && (
            <Suspense fallback={null}>
              <MakeVideo
                items={items}
                line={line}
                hook={hookText}
                slug={comparing ? spec.vs.join("-vs-") : spec.preset}
                lineLabel={lineTitle}
                trainer={myTrainer}
                onRecording={setRecording}
                onClose={() => setVideoOpen(false)}
              />
            </Suspense>
          )}
        </div>
      )}
    </>
  );
}
