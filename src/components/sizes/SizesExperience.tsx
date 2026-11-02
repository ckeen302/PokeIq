"use client";

import Link from "next/link";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ChevronDown, Clapperboard, List, Play, Plus, Scale, Search, Share2, Square, Volume2, VolumeX, X } from "lucide-react";
import { isMuted, onMuteChange, setMuted } from "@/lib/sound";
import { copyText } from "@/lib/share";
import { fromRow, formatFeet, formatMetres, type SizeItem, type SizeRow } from "@/lib/sizes/types";
import { DEFAULT_PRESET, PRESETS, PRESET_BY_ID } from "@/lib/sizes/presets";
import { COMPARE_MAX, COMPARE_MIN, comparePath, compareOk, itemPath, parseVs, presetPath } from "@/lib/sizes/deeplink";
import { compareHook, lineFor, pushCompare, searchItems, type LineSpec } from "@/lib/sizes/lineup";
import { framer, type Framer, type Lens } from "@/lib/sizes/glide";
import { nearestIndex, planPlay, playAt, type PlayPlan } from "@/lib/sizes/play";
import { blendViews, clampX, dragMetres, exploreView, flightAt, flightSeconds, overviewView, stepIndex, wheelMetres, type Flight } from "@/lib/sizes/explore";
import { factFor, spanFact } from "@/lib/sizes/facts";
import { markIntroSeen, shouldAutoPlay } from "@/lib/sizes/intro";
import type { View } from "@/lib/sizes/camera";
import { badgeName, dexTag } from "@/lib/sizes/badges";
import type { Quality, SizesScene } from "./scene";
import type { SizesAudio } from "./audio";
import { drawBadges } from "./overlay";
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

/** Phones get the light render, small or modest machines the middle one; the frame-time monitor takes it from there. */
function initialQuality(): Quality {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const short = Math.min(window.screen.width, window.screen.height);
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const mem = nav.deviceMemory ?? 8;
  if ((coarse && short < 820) || mem <= 2) return "low";
  if (window.innerWidth < 1100 || (nav.hardwareConcurrency ?? 8) <= 4 || mem <= 4) return "medium";
  return "high";
}
const LOWER: Record<Quality, Quality> = { export: "high", high: "medium", medium: "low", low: "low", draft: "draft" };
const FRAME_BUDGET_MS = 1000 / 50;

const sizeLine = (i: SizeItem) => `${formatMetres(i.m)}${i.min ? "+" : ""} · ${formatFeet(i.m)}${i.min ? "+" : ""}`;

export interface SizesExperienceProps {
  /** The lineup the page opens on. */
  preset: string;
  /** A Pokémon's or form's own page: open there (no autoplay). */
  focus?: string | null;
  /** A comparison from the address (validated on the server). */
  vs?: string[];
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
export function SizesExperience({ preset, focus = null, vs = [], children }: SizesExperienceProps) {
  const [mode, setMode] = useState<Mode>("boot");
  const [canGl, setCanGl] = useState(false);
  const [items, setItems] = useState<SizeItem[] | null>(null);
  const [ready, setReady] = useState(false);
  const [spec, setSpec] = useState<LineSpec>(() => ({ preset, vs, extra: focus ? [focus] : [] }));
  const [kind, setKind] = useState<Kind>("explore");
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [caption, setCaption] = useState<{ key: string; text: string } | null>(null);
  const [hook, setHook] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(vs.length > 0);
  const [compareKeys, setCompareKeys] = useState<string[]>(vs);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [presetMenu, setPresetMenu] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [muted, setMutedState] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [quality, setQualityState] = useState<Quality>("high");
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
  const ctl = useRef({
    kind: "explore" as Kind,
    x: 0,
    target: 0,
    vel: 0,
    dragging: false,
    flight: null as Flight | null,
    play: null as { plan: PlayPlan; t0: number; stop: string | null; finale: boolean } | null,
    blend: null as { from: View; t0: number; dur: number } | null,
    last: null as View | null,
    now: 0,
  });

  const byKey = useMemo(() => new Map((items ?? []).map((i) => [i.key, i])), [items]);
  const line = useMemo(() => (items ? lineFor(spec, items) : []), [items, spec]);
  const presetInfo = PRESET_BY_ID.get(spec.preset) ?? DEFAULT_PRESET;
  const comparing = compareOk(spec.vs.length);
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
    if (c.kind === "explore") return;
    const wasPlaying = c.kind === "play";
    if (c.last) { c.x = c.target = c.last.x; }
    c.vel = 0;
    c.flight = null;
    c.play = null;
    c.kind = "explore";
    setKind("explore");
    startBlend(blend);
    if (wasPlaying) { setCaption(null); setHook(null); audioRef.current?.music(false); }
  }, [startBlend]);

  const startPlay = useCallback((showHook: boolean) => {
    const placed = placedRef.current;
    if (!placed.length) return;
    const c = ctl.current;
    const plan = planPlay(placed, lensRef.current);
    c.play = { plan, t0: c.now, stop: null, finale: false };
    c.flight = null;
    c.kind = "play";
    setKind("play");
    setCaption(null);
    startBlend(1.1);
    if (showHook) setHook(hookText);
    audioRef.current?.music(true);
  }, [startBlend, hookText]);

  const flyTo = useCallback((key: string) => {
    const placed = placedRef.current;
    const i = placed.findIndex((p) => p.key === key);
    if (i < 0) return false;
    const c = ctl.current;
    if (c.kind !== "explore") toExplore(0.5);
    const d = c.last?.d ?? 2;
    const from = c.x;
    c.flight = { from, to: placed[i].x, t0: c.now, dur: flightSeconds(from, placed[i].x, 2 * d * Math.tan((lensRef.current.vfov * Math.PI) / 360) * lensRef.current.aspect) };
    c.vel = 0;
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
        const q = initialQuality();
        const scene = createSizesScene(host, { quality: q, urls: SCENE_URLS, trainer: trainerFigure(trainerRef.current) });
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
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
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
    let ftEma = FRAME_BUDGET_MS, slowFor = 0, warm = 0, lastFocus: string | null = null;
    const font = getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim() || "sans-serif";
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const scene = sceneRef.current;
      const fr = frRef.current;
      const placed = placedRef.current;
      if (!scene || !fr || !placed.length || recordingRef.current) { last = performance.now(); return; }
      const now = performance.now();
      const raw = now - last;
      const dt = Math.min(0.1, raw / 1000);
      last = now;
      const c = ctl.current;
      c.now += dt;
      const lens = lensRef.current;
      let view: View;
      let focusNow: string | null = null;
      if (c.kind === "play" && c.play) {
        const pt = c.now - c.play.t0;
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
        if (pt > 2.6) setHook(null);
        const p = Math.min(1, pt / c.play.plan.glide.duration);
        if (progressRef.current) progressRef.current.style.transform = `scaleX(${p.toFixed(4)})`;
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
        if (c.flight) {
          const f = flightAt(c.flight, c.now);
          c.x = c.target = f.x;
          if (f.done) c.flight = null;
        } else if (!c.dragging) {
          c.target += c.vel * dt;
          c.vel *= Math.exp(-5 * dt);
          c.x += (c.target - c.x) * (1 - Math.exp(-dt * 8));
        }
        const first = placed[0], lastP = placed[placed.length - 1];
        c.target = clampX(c.target, first, lastP);
        c.x = clampX(c.x, first, lastP);
        view = exploreView(c.x, fr, scene.heightAt);
        focusNow = placed[Math.max(0, nearestIndex(placed, c.x))].key;
      }
      if (c.blend) {
        const k = (c.now - c.blend.t0) / c.blend.dur;
        if (k >= 1) c.blend = null;
        else view = blendViews(c.blend.from, view, k);
      }
      c.last = view;
      scene.setView(view);
      scene.render(c.now, dt);
      // Badges.
      const cv = overlayRef.current;
      if (cv) {
        const g = cv.getContext("2d")!;
        const { w, h } = sizeRef.current;
        const dpr = cv.width / w;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, cv.width, cv.height);
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        const phone = w < 640;
        // The finale is the giant's alone.
        const max = view.rise > 0.3 ? 1 : phone ? 2 : 4;
        drawBadges(g, scene.anchors(), focusNow, byKeyRef.current, w, h, { font, scale: phone ? 1.15 : 1, max, top: phone ? 104 : 72, bottom: phone ? 128 : 104 });
      }
      // Where we are on the line.
      if (thumbRef.current && placed.length > 1) {
        const i = Math.max(0, nearestIndex(placed, view.x));
        thumbRef.current.style.left = `${((i / (placed.length - 1)) * 100).toFixed(3)}%`;
      }
      if (focusNow !== lastFocus) {
        lastFocus = focusNow;
        setFocusKey(focusNow);
      }
      // Adaptive quality: step down when frames stay slow (never back up mid-visit).
      if (warm < 40 || raw > 500) warm++;
      else {
        ftEma = ftEma * 0.9 + raw * 0.1;
        slowFor = ftEma > FRAME_BUDGET_MS * 1.6 ? slowFor + raw : 0;
        if (slowFor > 1500 && scene.quality !== "low") {
          scene.setQuality(LOWER[scene.quality]);
          setQualityState(scene.quality);
          slowFor = 0;
          warm = 20;
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready]);

  // ---- Input: drag, wheel and keys explore; any of them stops Play.
  useEffect(() => {
    if (!ready || !hostRef.current) return;
    const host = hostRef.current;
    let lastX = 0, lastT = 0, id = -1;
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || recordingRef.current) return;
      setPresetMenu(false);
      toExplore();
      const c = ctl.current;
      c.dragging = true;
      c.flight = null;
      c.vel = 0;
      lastX = e.clientX;
      lastT = performance.now();
      id = e.pointerId;
      host.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      const c = ctl.current;
      if (!c.dragging || e.pointerId !== id || !c.last) return;
      const now = performance.now();
      const m = dragMetres(e.clientX - lastX, sizeRef.current.w, c.last.d, lensRef.current);
      c.x += m;
      c.target = c.x;
      const dtp = Math.max(1, now - lastT) / 1000;
      c.vel = c.vel * 0.6 + (m / dtp) * 0.4;
      lastX = e.clientX;
      lastT = now;
    };
    const up = (e: PointerEvent) => {
      const c = ctl.current;
      if (e.pointerId !== id) return;
      c.dragging = false;
      if (performance.now() - lastT > 120) c.vel = 0;
      id = -1;
    };
    const wheel = (e: WheelEvent) => {
      if (recordingRef.current) return;
      e.preventDefault();
      toExplore();
      const c = ctl.current;
      if (!c.last) return;
      c.flight = null;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      c.target += wheelMetres(delta * (e.deltaMode === 1 ? 16 : 1), c.last.d, lensRef.current);
    };
    host.addEventListener("pointerdown", down);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerup", up);
    host.addEventListener("pointercancel", up);
    host.addEventListener("wheel", wheel, { passive: false });
    return () => {
      host.removeEventListener("pointerdown", down);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerup", up);
      host.removeEventListener("pointercancel", up);
      host.removeEventListener("wheel", wheel);
    };
  }, [ready, toExplore]);

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
  }, [ready, flyTo, startPlay, toExplore, videoOpen]);

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
    if (flyTo(item.key)) return;
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
          className="sz-stage fixed left-0 !mt-0 w-screen bottom-[calc(4rem+env(safe-area-inset-bottom))] top-14 z-40 overflow-hidden lg:bottom-0"
          data-testid="sizes-stage"
          data-ready={ready ? "1" : "0"}
          data-kind={kind}
          data-focus={focusKey ?? ""}
          data-count={line.length}
          data-recording={recording ? "1" : "0"}
        >
          <div
            ref={hostRef}
            className="sz-host absolute inset-0 cursor-grab touch-none select-none active:cursor-grabbing"
            data-testid="sizes-scene"
            role="application"
            aria-label="Pokémon to scale in 3D, smallest to largest. Drag, scroll or use the arrow keys to move along the line; Space plays the glide."
          />
          <canvas ref={overlayRef} className="sz-overlay h-full w-full" aria-hidden />
          <div className="sz-shade-top" aria-hidden />
          <div className="sz-shade-bottom" aria-hidden />

          {!ready && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white" aria-hidden>
              <Scale className="h-8 w-8 animate-pulse text-[#ffd84a]" />
              <div className="font-pixel text-[10px] uppercase tracking-[0.3em]">Building Lumiose City…</div>
            </div>
          )}

          {/* Title card: the lineup's hook, as the glide begins. */}
          <AnimatePresence>
            {hook && (
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
                <button type="button" className={cn(chip, "max-w-[46vw] sm:max-w-none")} onClick={() => { setPresetMenu((v) => !v); setSearchOpen(false); }} aria-expanded={presetMenu} aria-haspopup="menu" data-testid="sizes-lineup">
                  <span className="truncate">{lineTitle}</span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                </button>
                {presetMenu && (
                  <div className="pointer-events-auto absolute left-0 top-11 w-64 overflow-hidden rounded-lg border border-white/15 bg-[#0b1226]/95 p-1 shadow-2xl backdrop-blur-xl" role="menu" data-testid="sizes-presets">
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
                <ul className="mt-1 max-h-[50vh] overflow-y-auto rounded-lg border border-white/15 bg-[#0b1226]/95 p-1 shadow-2xl backdrop-blur-xl" role="listbox">
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
                  <Scale className="h-4 w-4" aria-hidden /> <span className="hidden min-[400px]:inline">Compare</span>
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
                  <Clapperboard className="h-4 w-4 text-[#ffd84a]" aria-hidden /> <span className="hidden min-[400px]:inline">Make a video</span>
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
