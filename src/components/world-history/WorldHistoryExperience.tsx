"use client";

import Link from "next/link";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowLeft, BookOpen, Clapperboard, Eye, List, Minus, Pause, Play, Plus, RotateCcw, Share2, Volume2, VolumeX, X } from "lucide-react";
import { isMuted, onMuteChange, setMuted } from "@/lib/sound";
import { LAB_PATH } from "@/lib/lab";
import { copyText } from "@/lib/share";
import { CHAPTERS, HISTORY, filmBeats, filmLine, sourceOf } from "@/lib/world-history/data";
import { HISTORY_PATH, chapterPath } from "@/lib/world-history/deeplink";
import { basisTag, sourceLine } from "@/lib/world-history/types";
import { blendPose, clampOrbit, orbitBy, orbitFrom, orbitPose, wheelFactor, zoomBy, type Orbit, type OrbitLimits, type Pose } from "@/lib/world-history/camera";
import { animToFilm, buildFilm, chapterAtFilm, chapterStart, easePlayhead, filmAt, filmToScroll, scrollToFilm, stepStop, trackHeight, PROLOGUE, TITLE_HOLD } from "@/lib/world-history/timing";
import type { HistoryScene, Quality } from "./scene";
import type { HistoryAudio } from "./audio";
import { WH_STAGE_CSS } from "./stage-css";
import { cn } from "@/lib/utils";

const MakeHistoryVideo = lazy(() => import("./MakeHistoryVideo"));

type Mode = "boot" | "3d" | "list";

function webglOk() {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

/** Phones start on the light render, everything else on the middle one; the frame-time monitor adapts both ways. */
function initialQuality(): Quality {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const short = Math.min(window.screen.width, window.screen.height);
  if ((coarse && short < 820) || (nav.deviceMemory ?? 8) <= 2) return "low";
  return "medium";
}
function qualityParam(): Quality | null {
  try {
    const q = new URLSearchParams(window.location.search).get("q");
    return q === "draft" || q === "low" || q === "medium" || q === "high" ? q : null;
  } catch {
    return null;
  }
}
const LOWER: Record<Quality, Quality> = { export: "high", high: "medium", medium: "low", low: "low", draft: "draft" };
const HIGHER: Record<Quality, Quality> = { export: "export", high: "high", medium: "high", low: "medium", draft: "draft" };
const FRAME_BUDGET_MS = 1000 / 50;
const HEADER_PX = 56;
/** Stills of each chapter for the hall's doorways (public/lab/world-history/<id>.webp). */
const HAS_STILLS = true;

/** ?t=<seconds>: open the film at a moment (a shared moment, checks and screenshots). */
function timeParam(): number | null {
  try {
    const t = Number(new URLSearchParams(window.location.search).get("t"));
    return Number.isFinite(t) && t > 0 ? t : null;
  } catch {
    return null;
  }
}

/** ?solo=1: build only the chapter on screen, not its neighbours (checks and screenshots on slow machines). */
function soloParam(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("solo") === "1";
  } catch {
    return false;
  }
}

interface Ui {
  kind: "chapter" | "hall";
  chapter: number;
  beat: number;
  /** The title card: the chapter's start, or the prologue's title. */
  title: "none" | "prologue" | "chapter" | "end";
  loading: boolean;
  progress: number;
}

export function WorldHistoryExperience({ initialChapter, children }: { initialChapter: string | null; children: React.ReactNode }) {
  const film = useMemo(() => buildFilm(), []);
  const [mode, setMode] = useState<Mode>("boot");
  const [canGl, setCanGl] = useState(false);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [free, setFree] = useState(false);
  const [canLook, setCanLook] = useState(false);
  const [muted, setMutedState] = useState(true);
  const [quality, setQualityState] = useState<Quality>("medium");
  const [ui, setUi] = useState<Ui>({ kind: "hall", chapter: 0, beat: -1, title: "prologue", loading: true, progress: 0 });
  const [railOpen, setRailOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [trackH, setTrackH] = useState(0);

  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLElement>(null);
  const sceneRef = useRef<HistoryScene | null>(null);
  const audioRef = useRef<HistoryAudio | null>(null);
  const sizeRef = useRef({ w: 1, h: 1 });
  const recordingRef = useRef(false);
  recordingRef.current = recording;

  /** Mutable film state, read by the frame loop. */
  const show = useRef({
    playhead: 0,
    target: 0,
    playing: false,
    free: null as Orbit | null,
    limits: null as OrbitLimits | null,
    blend: null as { from: Pose; t0: number } | null,
    last: null as Pose | null,
    /** Programmatic scrolls in flight (their scroll events must not move the target). */
    syncing: 0,
    frozen: false,
    /** Frames drawn since a frozen moment's chapter was ready (a frozen film stops drawing once it has settled). */
    frozenFrames: 0,
    jumped: false,
    lastPath: "",
    prof: { n: 0, sum: 0, max: 0 },
  });

  // ---- Which view.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const forced = new URLSearchParams(window.location.search).get("view");
    const gl = webglOk();
    setCanGl(gl);
    setMode(forced === "list" || (forced !== "3d" && reduce) || !gl ? "list" : "3d");
    setMutedState(isMuted());
    return onMuteChange(setMutedState);
  }, []);

  // ---- The scroll track's height, the stage's size.
  const stageH = useCallback(() => stageRef.current?.clientHeight ?? Math.max(300, window.innerHeight - HEADER_PX), []);
  useEffect(() => {
    if (mode !== "3d") return;
    const fit = () => setTrackH(trackHeight(film, stageH()));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [mode, film, stageH]);

  /** Where the track starts in the document (px), and how far the page is into it. */
  const trackTop = useCallback(() => {
    const el = trackRef.current;
    if (!el) return 0;
    return el.getBoundingClientRect().top + window.scrollY - HEADER_PX;
  }, []);
  const scrollFilm = useCallback((t: number) => {
    const y = trackTop() + filmToScroll(film, t, stageH());
    show.current.syncing++;
    window.scrollTo({ top: y, behavior: "instant" as ScrollBehavior });
    requestAnimationFrame(() => { show.current.syncing = Math.max(0, show.current.syncing - 1); });
  }, [film, trackTop, stageH]);

  // ---- Scrolling drives the film (and slides the stage away past its end).
  useEffect(() => {
    if (mode !== "3d") return;
    const onScroll = () => {
      const el = trackRef.current, stage = stageRef.current;
      if (!el || !stage) return;
      const r = el.getBoundingClientRect();
      const h = stage.clientHeight;
      const into = HEADER_PX - r.top;
      if (!show.current.syncing && !show.current.free) show.current.target = scrollToFilm(film, into, h);
      const over = into - (r.height - h);
      stage.style.transform = over > 0 ? `translate3d(0,${-over}px,0)` : "";
      stage.style.visibility = over > h + 10 ? "hidden" : "visible";
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [mode, film, trackH]);

  // ---- A deep link opens on its chapter.
  useEffect(() => {
    if (mode !== "3d" || !trackH) return;
    const i = initialChapter ? CHAPTERS.findIndex((c) => c.id === initialChapter) : -1;
    const t = Math.min(film.duration, timeParam() ?? (i >= 0 ? chapterStart(film, i) : 0));
    show.current.playhead = show.current.target = t;
    show.current.lastPath = i >= 0 ? chapterPath(initialChapter) : HISTORY_PATH;
    scrollFilm(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, trackH]);

  // ---- Sound: built on the first press or key, started inside that gesture.
  useEffect(() => {
    if (mode !== "3d") return;
    let alive = true;
    const onGesture = () => {
      if (isMuted()) return;
      if (audioRef.current) { audioRef.current.gesture(); return; }
      void import("./audio").then(({ createHistoryAudio }) => {
        if (!alive || audioRef.current || isMuted()) return;
        audioRef.current = createHistoryAudio(film);
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
  }, [mode, film]);
  useEffect(() => { audioRef.current?.setMuted(muted); }, [muted]);

  // ---- The scene (three.js loads only here).
  useEffect(() => {
    if (mode !== "3d" || !hostRef.current) return;
    let alive = true;
    const host = hostRef.current;
    import("./scene").then(async ({ createHistoryScene }) => {
      if (!alive) return;
      try {
        const font = getComputedStyle(host).getPropertyValue("--font-wh-serif").trim() || "Georgia";
        await document.fonts?.load(`600 40px ${font}`).catch(() => undefined);
        const q = qualityParam() ?? initialQuality();
        const scene = createHistoryScene(host, { quality: q, film, chapters: CHAPTERS, font, poster: HAS_STILLS ? (id) => `/lab/world-history/${id}.webp` : undefined });
        sceneRef.current = scene;
        setQualityState(q);
        await scene.ready;
        if (alive) setReady(true);
      } catch (e) {
        console.error("[world-history]", e);
        if (alive) setMode("list");
      }
    }, () => alive && setMode("list"));
    return () => {
      alive = false;
      sceneRef.current?.dispose();
      sceneRef.current = null;
      setReady(false);
    };
  }, [mode, film]);

  // ---- Size.
  useEffect(() => {
    if (!ready || !hostRef.current) return;
    const host = hostRef.current;
    const fit = () => {
      const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
      sizeRef.current = { w, h };
      sceneRef.current?.resize(w, h);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    return () => ro.disconnect();
  }, [ready]);

  // ---- Free look.
  const enterFree = useCallback(() => {
    const s = show.current;
    if (s.free || !s.last || !s.limits) return s.free;
    s.free = orbitFrom(s.last, s.limits);
    s.playing = false;
    setPlaying(false);
    setFree(true);
    document.documentElement.classList.add("wh-locked");
    return s.free;
  }, []);
  const exitFree = useCallback(() => {
    const s = show.current;
    if (!s.free) return;
    s.blend = { from: orbitPose(s.free), t0: performance.now() / 1000 };
    s.free = null;
    setFree(false);
    document.documentElement.classList.remove("wh-locked");
  }, []);
  const zoom = useCallback((factor: number) => {
    const s = show.current;
    const o = s.free ?? enterFree();
    if (o && s.limits) s.free = zoomBy(o, factor, s.limits);
  }, [enterFree]);
  useEffect(() => () => document.documentElement.classList.remove("wh-locked"), []);

  // ---- Play and seek.
  const togglePlay = useCallback(() => {
    const s = show.current;
    if (s.free) exitFree();
    if (s.playhead >= film.duration - 0.05) { s.playhead = s.target = 0; scrollFilm(0); }
    s.playing = !s.playing;
    setPlaying(s.playing);
    audioRef.current?.gesture();
  }, [exitFree, film, scrollFilm]);
  const seek = useCallback((t: number) => {
    const s = show.current;
    if (s.free) exitFree();
    s.target = t;
    if (Math.abs(t - s.playhead) > 20) { s.playhead = t - 0.4; s.jumped = true; }
    scrollFilm(t);
  }, [exitFree, scrollFilm]);
  const pause = useCallback(() => {
    if (!show.current.playing) return;
    show.current.playing = false;
    setPlaying(false);
  }, []);

  // ---- The frame loop.
  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    let last = performance.now();
    let ftEma = FRAME_BUDGET_MS, slowFor = 0, fastFor = 0, warm = 0;
    const pinned = qualityParam() !== null;
    const solo = soloParam();
    let prev: Ui = { kind: "hall", chapter: -1, beat: -2, title: "none", loading: true, progress: -1 };
    let lastSync = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const scene = sceneRef.current;
      const now = performance.now();
      const raw = now - last;
      last = now;
      if (!scene || recordingRef.current) return;
      const s = show.current;
      if (s.frozen) {
        // A frozen moment keeps drawing until its chapter is built, then a few frames more, then rests.
        if (!scene.isReady(chapterAtFilm(film, s.playhead))) s.frozenFrames = 0;
        else if (s.frozenFrames > 6) return;
        s.frozenFrames++;
      }
      try {
        const dt = Math.min(0.1, raw / 1000);
        // The clock: Play advances it (holding while a chapter loads); otherwise it eases toward the scroll.
        const state0 = filmAt(film, s.playhead);
        const waiting = state0.kind === "chapter" && !scene.isReady(state0.index);
        if (!s.frozen) {
          if (s.playing && !s.free) {
            if (!waiting) s.playhead = Math.min(film.duration, s.playhead + dt);
            s.target = s.playhead;
            if (now - lastSync > 120) { lastSync = now; scrollFilm(s.playhead); }
            if (s.playhead >= film.duration) { s.playing = false; setPlaying(false); }
          } else if (!s.free) {
            s.playhead = easePlayhead(s.playhead, s.target, dt);
          }
        }
        const state = filmAt(film, s.playhead);
        // Chapters: the current one and its neighbours are kept built.
        const cur = chapterAtFilm(film, s.playhead);
        const near = solo ? [cur] : state.kind === "hall" ? [state.hall.from, state.hall.to, cur] : [cur, cur + 1, cur - 1];
        const want = [...new Set(near.filter((i) => i >= 0 && i < film.chapters.length))];
        for (const i of want) void scene.prepare(i);
        scene.retain((solo ? want : [...want, cur + 1]).filter((i) => i >= 0 && i < film.chapters.length));
        // The camera: free look, or blending back to the film from it.
        let lookPose: Pose | null = null;
        if (s.free && state.kind === "chapter") lookPose = orbitPose(s.free);
        const info = scene.frame({ state, ambient: now / 1000, look: lookPose });
        let pose = info.pose;
        if (!s.free && s.blend && state.kind === "chapter") {
          const k = (now / 1000 - s.blend.t0) / 0.8;
          if (k >= 1) s.blend = null;
          else pose = blendPose(s.blend.from, pose, k);
          if (s.blend) scene.frame({ state, ambient: now / 1000, look: pose });
        }
        s.last = pose;
        s.limits = info.orbit?.limits ?? null;
        if (s.free && s.limits) s.free = clampOrbit(s.free, s.limits);
        if (s.free && state.kind !== "chapter") { s.free = null; setFree(false); document.documentElement.classList.remove("wh-locked"); }
        audioRef.current?.update({ state, playing: s.playing, dt });
        // The UI: only when something changed.
        const ct = state.kind === "chapter" ? film.chapters[state.index] : null;
        const beat = ct && state.kind === "chapter" ? beatAt(ct.beats, state.anim) : -1;
        const title: Ui["title"] = state.kind === "hall" ? (state.hall.from < 0 && state.k < 0.62 ? "prologue" : state.hall.to >= film.chapters.length && state.k > 0.4 ? "end" : "none") : state.anim < TITLE_HOLD - 0.15 ? "chapter" : "none";
        const next: Ui = { kind: state.kind, chapter: cur, beat, title, loading: !info.complete, progress: Math.round((s.playhead / film.duration) * 400) / 400 };
        if (next.kind !== prev.kind || next.chapter !== prev.chapter || next.beat !== prev.beat || next.title !== prev.title || next.loading !== prev.loading) {
          setUi(next);
          setCanLook(!!info.orbit);
        }
        if (barRef.current) barRef.current.style.transform = `scaleX(${(s.playhead / film.duration).toFixed(4)})`;
        prev = next;
        // The address follows the chapter.
        const path = s.playhead < PROLOGUE * 0.6 ? HISTORY_PATH : chapterPath(CHAPTERS[cur].id);
        if (path !== s.lastPath) {
          s.lastPath = path;
          try { history.replaceState(history.state, "", path); } catch { /* ignore */ }
        }
      } finally {
        const ms = performance.now() - now;
        s.prof.n++;
        s.prof.sum += ms;
        s.prof.max = Math.max(s.prof.max, ms);
      }
      // Adaptive quality, both ways.
      if (pinned) return;
      if (warm < 40 || raw > 400) warm++;
      else {
        ftEma = ftEma * 0.92 + raw * 0.08;
        slowFor = ftEma > FRAME_BUDGET_MS * 1.6 ? slowFor + raw : 0;
        fastFor = ftEma < FRAME_BUDGET_MS * 0.55 ? fastFor + raw : 0;
        if (slowFor > 1500 && scene.quality !== LOWER[scene.quality]) {
          scene.setQuality(LOWER[scene.quality]);
          setQualityState(scene.quality);
          slowFor = 0;
          warm = 10;
        } else if (fastFor > 6000 && scene.quality !== HIGHER[scene.quality] && !window.matchMedia("(pointer: coarse)").matches) {
          scene.setQuality(HIGHER[scene.quality]);
          setQualityState(scene.quality);
          fastFor = 0;
          warm = 10;
        }
      }
    };
    raf = requestAnimationFrame(tick);
    // For automated checks and screenshots: move the film clock, read where it is.
    (window as unknown as { __wh?: unknown }).__wh = {
      seek(t: number, freeze = false) { show.current.playhead = show.current.target = t; show.current.frozen = freeze; show.current.frozenFrames = 0; },
      chapterStart: (i: number) => chapterStart(film, i),
      beatTime: (i: number, beat: number) => { const c = film.chapters[i]; return c.start + (c.beats[beat] ? animToFilm(c, c.beats[beat].anim) : 0); },
      state() {
        const s = show.current;
        const st = filmAt(film, s.playhead);
        return { t: s.playhead, anim: st.kind === "chapter" ? st.anim : null, duration: film.duration, kind: st.kind, chapter: chapterAtFilm(film, s.playhead), playing: s.playing, free: !!s.free, dist: s.free?.dist ?? null, quality: sceneRef.current?.quality ?? null, stats: sceneRef.current?.stats() ?? null, prof: { ...s.prof } };
      },
    };
    return () => cancelAnimationFrame(raf);
  }, [ready, film, scrollFilm]);

  useEffect(() => { if (stageRef.current) stageRef.current.dataset.q = quality; }, [quality]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- Input on the stage: drag to look around, wheel / pinch / gesture to zoom.
  useEffect(() => {
    if (!ready || !hostRef.current || !stageRef.current) return;
    const host = hostRef.current;
    const stage = stageRef.current;
    const pointers = new Map<number, { x: number; y: number; x0: number; y0: number; touch: boolean }>();
    let pinch0 = 0;
    let dragging = false;
    const down = (e: PointerEvent) => {
      if (recordingRef.current) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, touch: e.pointerType === "touch" });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const move = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      pointers.set(e.pointerId, { ...p, x: e.clientX, y: e.clientY });
      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch0 > 0 && d > 0) zoom(d / pinch0);
        pinch0 = d;
        return;
      }
      const s = show.current;
      if (!s.free) {
        // A touch that moves mostly up or down is a scroll; anything else starts looking around.
        const tx = e.clientX - p.x0, ty = e.clientY - p.y0;
        if (Math.hypot(tx, ty) < 8) return;
        if (p.touch && Math.abs(ty) > Math.abs(tx)) { pointers.delete(e.pointerId); return; }
        if (!enterFree()) return;
        dragging = true;
        try { host.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      }
      if (s.free && s.limits) s.free = orbitBy(s.free, dx, dy, sizeRef.current.h, s.limits);
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch0 = 0;
      if (!pointers.size) dragging = false;
    };
    let gs: number | null = null;
    const wheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest?.("[data-wh-scroll], [role=dialog]") && !e.ctrlKey) return;
      if (show.current.free || e.ctrlKey) {
        e.preventDefault();
        if (recordingRef.current || gs !== null) return;
        zoom(wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey));
        return;
      }
      pause();
    };
    const gStart = (e: Event) => {
      e.preventDefault();
      if (recordingRef.current || [...pointers.values()].some((p) => p.touch)) return;
      gs = (e as unknown as { scale: number }).scale || 1;
    };
    const gChange = (e: Event) => {
      e.preventDefault();
      if (gs === null) return;
      const sc = (e as unknown as { scale: number }).scale || 1;
      zoom(sc / gs);
      gs = sc;
    };
    const gEnd = (e: Event) => { e.preventDefault(); gs = null; };
    const touchScroll = () => pause();
    const opts = { passive: false } as AddEventListenerOptions;
    host.addEventListener("pointerdown", down);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerup", up);
    host.addEventListener("pointercancel", up);
    stage.addEventListener("wheel", wheel, opts);
    stage.addEventListener("gesturestart", gStart, opts);
    stage.addEventListener("gesturechange", gChange, opts);
    stage.addEventListener("gestureend", gEnd, opts);
    stage.addEventListener("touchmove", touchScroll, { passive: true });
    void dragging;
    return () => {
      host.removeEventListener("pointerdown", down);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerup", up);
      host.removeEventListener("pointercancel", up);
      stage.removeEventListener("wheel", wheel);
      stage.removeEventListener("gesturestart", gStart);
      stage.removeEventListener("gesturechange", gChange);
      stage.removeEventListener("gestureend", gEnd);
      stage.removeEventListener("touchmove", touchScroll);
    };
  }, [ready, zoom, enterFree, pause]);

  // ---- Keys: space plays, ← → step through the captions, + − zoom, arrows look around in free look.
  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.metaKey || e.ctrlKey || recordingRef.current || videoOpen) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const s = show.current;
      const onStage = (() => { const r = stageRef.current?.getBoundingClientRect(); return !!r && r.bottom > window.innerHeight * 0.5; })();
      if (!onStage) return;
      if (e.key === " " || e.key === "k" || e.key === "K") { e.preventDefault(); togglePlay(); return; }
      if (e.key === "Escape") { if (s.free) exitFree(); setRailOpen(false); return; }
      if (e.key === "+" || e.key === "=") { e.preventDefault(); zoom(1.2); return; }
      if (e.key === "-" || e.key === "_") { e.preventDefault(); zoom(1 / 1.2); return; }
      if (s.free && s.limits && e.key.startsWith("Arrow")) {
        e.preventDefault();
        s.free = orbitBy(s.free, e.key === "ArrowLeft" ? -40 : e.key === "ArrowRight" ? 40 : 0, e.key === "ArrowUp" ? 30 : e.key === "ArrowDown" ? -30 : 0, sizeRef.current.h, s.limits);
        return;
      }
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        pause();
        seek(stepStop(film, s.target, e.key === "ArrowRight" ? 1 : -1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, film, videoOpen, togglePlay, exitFree, zoom, seek, pause]);

  const toggleMute = () => {
    const next = !isMuted();
    setMuted(next);
    setMutedState(next);
    if (!next) {
      if (!audioRef.current) {
        void import("./audio").then(({ createHistoryAudio }) => {
          if (audioRef.current || isMuted()) return;
          audioRef.current = createHistoryAudio(film);
          audioRef.current.gesture();
        });
      } else audioRef.current.gesture();
    }
  };

  const share = async () => {
    const id = CHAPTERS[ui.chapter]?.id;
    const url = `${window.location.origin}${show.current.playhead < PROLOGUE * 0.6 ? HISTORY_PATH : chapterPath(id)}`;
    const c = CHAPTERS[ui.chapter];
    const text = show.current.playhead < PROLOGUE * 0.6 || !c ? HISTORY.title : `${c.title} (${c.region}) · ${HISTORY.title}`;
    if (typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
      try { await navigator.share({ title: HISTORY.title, text, url }); return; } catch { /* closed: copy instead */ }
    }
    if (await copyText(url)) setToast("Link copied");
  };

  const toText = () => {
    pause();
    if (show.current.free) exitFree();
    const el = document.querySelector("[data-testid=wh-text]");
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const chapter = CHAPTERS[ui.chapter];
  const fb = chapter ? filmBeats(chapter) : [];
  const beat = ui.kind === "chapter" && ui.beat >= 0 ? fb[ui.beat] : null;
  const source = beat && chapter ? sourceOf(chapter, beat) : null;
  const tag = beat && chapter ? basisTag(beat.basis, chapter.tag) : null;
  const ticks = film.chapters.map((c) => c.start / film.duration);

  return (
    <>
      <style>{WH_STAGE_CSS}</style>
      <noscript><style>{`.wh-stage,.wh-track{display:none!important}`}</style></noscript>
      {mode !== "list" && <div ref={trackRef} className="wh-track -mt-8" style={{ height: trackH ? `${trackH}px` : "400vh" }} aria-hidden data-testid="wh-track" />}
      {mode === "list" && canGl && (
        <div className="mb-4 flex justify-end">
          <button type="button" onClick={() => setMode("3d")} className="rounded-md border bg-card px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:border-screen/60 hover:text-foreground" data-testid="wh-3d-view">
            Watch the film in 3D
          </button>
        </div>
      )}
      <div className={mode === "list" ? undefined : "relative z-[41] bg-background pt-8"}>{children}</div>
      {mode !== "list" && (
        <div
          ref={stageRef}
          className="wh-stage fixed inset-x-0 !mt-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] top-14 z-40 overflow-hidden lg:bottom-0"
          style={{ "--wh-accent": chapter?.accent ?? "#f2c96b" } as React.CSSProperties}
          data-testid="wh-stage"
          data-ready={ready ? "1" : "0"}
          data-kind={ui.kind}
          data-chapter={chapter?.id ?? ""}
          data-beat={ui.beat}
          data-playing={playing ? "1" : "0"}
          data-free={free ? "1" : "0"}
          data-loading={ui.loading ? "1" : "0"}
          data-recording={recording ? "1" : "0"}
        >
          <div ref={hostRef} className="absolute inset-0 cursor-grab select-none active:cursor-grabbing" data-testid="wh-scene" role="application" aria-label="The History of the Pokémon World in 3D. Scroll to move through the film; drag to look around; pinch or scroll with ctrl to zoom." />
          <div className="wh-shade-top" aria-hidden />
          <div className="wh-shade-bottom" aria-hidden />

          {(!ready || ui.loading) && (
            <div className="pointer-events-none absolute inset-0 z-[5] flex flex-col items-center justify-center gap-4 text-white" aria-live="polite">
              <div className="wh-load-ring" aria-hidden />
              <p className="wh-title-k text-[10px] uppercase text-white/80" data-testid="wh-loading">{!ready ? "Opening the museum…" : `Opening ${chapter?.region ?? "the exhibit"}…`}</p>
            </div>
          )}

          {/* Top bar. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3 sm:p-4">
            <div className="flex min-w-0 items-center gap-2">
              <Link href={LAB_PATH} className="wh-chip px-2.5" aria-label="Back to the 3D Lab" data-testid="wh-back">
                <ArrowLeft className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">3D Lab</span>
              </Link>
              <span className="wh-chip hidden min-w-0 md:inline-flex" aria-hidden><span className="truncate">The History of the Pokémon World</span></span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" className="wh-chip px-2.5" onClick={toggleMute} aria-label={muted ? "Turn the sound on" : "Turn the sound off"} data-testid="wh-mute">
                {muted ? <VolumeX className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
              </button>
              <button type="button" className="wh-chip px-2.5 lg:hidden" onClick={() => setRailOpen(true)} aria-label="Chapters" data-testid="wh-chapters-open">
                <List className="h-4 w-4" aria-hidden />
              </button>
              <button type="button" className="wh-chip px-2.5 sm:px-3" onClick={toText} aria-label="Read the history and its sources" data-testid="wh-to-text">
                <BookOpen className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Read</span>
              </button>
            </div>
          </div>

          {/* Chapter rail (desktop). */}
          <nav aria-label="Chapters" className="wh-rail pointer-events-none absolute right-4 top-1/2 z-10 hidden -translate-y-1/2 lg:block">
            <ol className="space-y-1">
              {CHAPTERS.map((c, i) => (
                <li key={c.id} style={{ "--wh-accent": c.accent } as React.CSSProperties}>
                  <button type="button" onClick={() => { pause(); seek(chapterStart(film, i)); }} aria-current={i === ui.chapter ? "true" : undefined} className={cn("pointer-events-auto group flex w-full items-center justify-end gap-2.5 rounded px-1.5 py-1 text-right", i === ui.chapter ? "text-white" : "text-white/45 hover:text-white/85")} data-testid={`wh-rail-${c.id}`}>
                    <span className={cn("font-display text-[11px] font-semibold uppercase tracking-[0.14em]", i === ui.chapter ? "" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100")}>
                      {c.region}
                    </span>
                    <span className="w-7 font-display text-[11px] font-semibold tabular-nums">{c.numeral}</span>
                    <span className="wh-rail-dot" aria-hidden />
                  </button>
                </li>
              ))}
            </ol>
          </nav>

          {/* The prologue's title. */}
          <AnimatePresence>
            {ready && ui.title === "prologue" && (
              <motion.div key="pro" className="wh-pro pointer-events-none absolute inset-x-0 top-[18%] z-[6] flex flex-col items-center px-6 text-center text-white" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, filter: "blur(6px)" }} transition={{ duration: 0.9 }} data-testid="wh-prologue">
                <p className="wh-title-k text-[10px] uppercase text-[#f2c96b] sm:text-xs">PokéIQ 3D Lab · In-universe history</p>
                <h1 className="wh-serif wh-title mt-3 max-w-4xl text-5xl font-semibold leading-[0.95] sm:text-7xl lg:text-8xl">The History of the Pokémon World</h1>
                <p className="wh-cap-lead mt-4 max-w-xl text-sm text-white/80 sm:text-base">The story of the Pokémon world, as the games themselves tell it. Every line is sourced.</p>
                <p className="wh-hint mt-6 inline-flex items-center gap-2 font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-white/75">Scroll, or press play <ArrowDown className="h-3.5 w-3.5" aria-hidden /></p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* A chapter's title card. */}
          <AnimatePresence>
            {ui.title === "chapter" && chapter && (
              <motion.div key={`t-${chapter.id}`} className="pointer-events-none absolute inset-x-0 top-[20%] z-[6] flex flex-col items-center px-6 text-center text-white" initial={{ opacity: 0, scale: 1.08, filter: "blur(10px)" }} animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }} exit={{ opacity: 0, y: -14, filter: "blur(6px)" }} transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }} data-testid="wh-title-card">
                <p className="wh-title-k text-[10px] uppercase sm:text-xs" style={{ color: chapter.accent }}>{chapter.numeral} · {chapter.region}</p>
                <h2 className="wh-serif wh-title mt-2 text-5xl font-semibold leading-none sm:text-7xl">{chapter.title}</h2>
                <p className="wh-serif wh-cap-lead mt-3 text-lg italic text-white/85 sm:text-2xl">{chapter.when}</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* The end. */}
          <AnimatePresence>
            {ui.title === "end" && (
              <motion.div key="end" className="absolute inset-x-0 top-[16%] z-[7] flex flex-col items-center px-6 text-center text-white" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 1 }} data-testid="wh-end">
                <p className="wh-title-k text-[10px] uppercase text-[#f2c96b] sm:text-xs">The story so far</p>
                <h2 className="wh-serif wh-title mt-3 max-w-3xl text-4xl font-semibold leading-none sm:text-6xl">The History of the Pokémon World</h2>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  <button type="button" onClick={() => { seek(0); show.current.playing = true; setPlaying(true); }} className="wh-chip h-11" data-testid="wh-again"><RotateCcw className="h-4 w-4" aria-hidden /> Watch again</button>
                  <button type="button" onClick={() => setVideoOpen(true)} className="wh-chip h-11" data-testid="wh-end-video"><Clapperboard className="h-4 w-4 text-[#f2c96b]" aria-hidden /> Make a video</button>
                  <button type="button" onClick={toText} className="wh-chip h-11"><BookOpen className="h-4 w-4" aria-hidden /> Read it, with sources</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Caption. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-[4.9rem] z-[6] px-4 sm:bottom-[5.6rem] sm:px-8 lg:right-48" aria-live="polite" data-testid="wh-caption-area">
            <AnimatePresence mode="wait">
              {beat && chapter && source && (
                <motion.figure key={`${chapter.id}-${beat.id}`} className="max-w-[46rem] text-white" initial={{ opacity: 0, y: 14, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -8, filter: "blur(4px)" }} transition={{ duration: 0.55, ease: [0.2, 0.8, 0.2, 1] }} data-testid="wh-caption">
                  {beat.lead && <p className="wh-cap-lead mb-2 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-white/80 sm:text-xs">{beat.lead}</p>}
                  <blockquote className={cn("wh-cap-q whitespace-pre-line text-[1.45rem] sm:text-3xl lg:text-[2.15rem]", !beat.quote && "not-italic")}>
                    {beat.quote ? `“${filmLine(beat)}”` : filmLine(beat)}
                  </blockquote>
                  <figcaption className="wh-cap-src mt-2.5 flex flex-wrap items-center gap-2 text-[11px] text-white/70 sm:text-xs">
                    {tag && <span className="wh-tag" style={{ color: chapter.accent }}>{tag}</span>}
                    <cite className="not-italic" data-testid="wh-source">{sourceLine(source)}</cite>
                  </figcaption>
                </motion.figure>
              )}
            </AnimatePresence>
          </div>

          {/* Bottom bar: play, the scrubber, look around and zoom, video, share. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-3 pb-3 sm:px-5 sm:pb-4">
            <div className="wh-scrub pointer-events-auto mb-2" role="slider" aria-label="Film position" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ui.progress * 100)} tabIndex={-1}
              onPointerDown={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                pause();
                seek(((e.clientX - r.left) / r.width) * film.duration);
              }}
              data-testid="wh-scrub">
              <div className="wh-bar"><i ref={barRef as React.RefObject<HTMLElement>} style={{ transform: "scaleX(0)" }} /></div>
              {ticks.map((x, i) => <span key={i} className="wh-tick" style={{ left: `${(x * 100).toFixed(2)}%` }} aria-hidden />)}
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <button type="button" onClick={togglePlay} disabled={!ready} className="wh-play disabled:opacity-60" aria-label={playing ? "Pause" : "Play"} data-testid="wh-play">
                  {playing ? <Pause className="h-4 w-4 fill-current" aria-hidden /> : <Play className="h-4 w-4 fill-current" aria-hidden />}
                  <span className="hidden min-[420px]:inline">{playing ? "Pause" : "Play"}</span>
                </button>
                <span className="wh-chip hidden max-w-[16rem] sm:inline-flex" aria-live="off" data-testid="wh-now">
                  <span className="shrink-0" style={{ color: chapter?.accent }}>{chapter?.numeral}</span>
                  <span className="truncate">{ui.kind === "hall" && ui.title === "prologue" ? "The museum" : chapter?.region}</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                {free ? (
                  <button type="button" onClick={exitFree} className="wh-chip h-11" aria-pressed data-testid="wh-look"><X className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Back to the film</span></button>
                ) : (
                  <button type="button" onClick={() => enterFree()} disabled={!canLook} className="wh-chip h-11" data-testid="wh-look"><Eye className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Look around</span></button>
                )}
                <div className="pointer-events-auto flex overflow-hidden rounded-md border border-white/15 bg-[#0a0816]/60 backdrop-blur-md">
                  <button type="button" onClick={() => zoom(1 / 1.25)} disabled={!canLook} className="h-11 px-2.5 text-white/80 hover:text-white disabled:opacity-40" aria-label="Zoom out" data-testid="wh-zoom-out"><Minus className="h-4 w-4" /></button>
                  <button type="button" onClick={() => zoom(1.25)} disabled={!canLook} className="h-11 border-l border-white/10 px-2.5 text-white/80 hover:text-white disabled:opacity-40" aria-label="Zoom in" data-testid="wh-zoom-in"><Plus className="h-4 w-4" /></button>
                </div>
                <button type="button" onClick={share} className="wh-chip h-11 px-3" aria-label="Share this chapter" data-testid="wh-share"><Share2 className="h-4 w-4" aria-hidden /></button>
                <button type="button" onClick={() => { pause(); setVideoOpen(true); }} disabled={!ready} className="wh-chip h-11 border-[#f2c96b]/50" data-testid="wh-video">
                  <Clapperboard className="h-4 w-4 text-[#f2c96b]" aria-hidden /> <span className="sm:hidden">Video</span><span className="hidden sm:inline">Make a video</span>
                </button>
              </div>
            </div>
          </div>

          {/* Chapters (phones). */}
          <AnimatePresence>
            {railOpen && (
              <motion.div className="wh-sheet absolute inset-x-0 bottom-0 z-30 max-h-[75%] overflow-y-auto rounded-t-2xl border-t border-white/15 p-4 text-white" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", damping: 30, stiffness: 300 }} role="dialog" aria-label="Chapters" data-wh-scroll data-testid="wh-chapters">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-display text-sm font-bold uppercase tracking-wider">Chapters</h2>
                  <button type="button" onClick={() => setRailOpen(false)} className="rounded p-1 text-white/60 hover:text-white" aria-label="Close"><X className="h-5 w-5" /></button>
                </div>
                <ol className="space-y-1">
                  {CHAPTERS.map((c, i) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => { setRailOpen(false); pause(); seek(chapterStart(film, i)); }} className={cn("flex w-full items-baseline gap-3 rounded-md px-2 py-2 text-left", i === ui.chapter ? "bg-white/10" : "hover:bg-white/5")} data-testid={`wh-sheet-${c.id}`}>
                        <span className="w-8 shrink-0 font-display text-xs font-semibold" style={{ color: c.accent }}>{c.numeral}</span>
                        <span className="min-w-0">
                          <span className="font-semibold">{c.region}</span> <span className="text-white/60">· {c.title}</span>
                          <span className="block text-xs text-white/50">{c.when}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {toast && (
              <motion.div className="pointer-events-none absolute inset-x-0 top-16 z-30 flex justify-center" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="status">
                <span className="rounded-md bg-[#0a0816]/90 px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider text-white">{toast}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {videoOpen && (
            <Suspense fallback={null}>
              <MakeHistoryVideo film={film} chapter={ui.chapter} onRecording={setRecording} onClose={() => setVideoOpen(false)} />
            </Suspense>
          )}
        </div>
      )}
    </>
  );
}

/** The caption up at an anim time (−1 during the title card). */
function beatAt(beats: { anim: number }[], anim: number): number {
  let i = -1;
  for (let k = 0; k < beats.length; k++) if (anim >= beats[k].anim) i = k;
  return i;
}
