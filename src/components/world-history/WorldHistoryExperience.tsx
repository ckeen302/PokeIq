"use client";

import Link from "next/link";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { usePathname } from "next/navigation";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { ArrowDown, ArrowLeft, BookOpen, Clapperboard, Eye, List, Minus, Pause, Play, Plus, RotateCcw, Share2, Volume2, VolumeX, X } from "lucide-react";
import { isMuted, onMuteChange, setMuted } from "@/lib/sound";
import { LAB_PATH } from "@/lib/lab";
import { copyText } from "@/lib/share";
import { CHAPTERS, HISTORY, filmBeats, filmLine, sourceOf } from "@/lib/world-history/data";
import { HISTORY_PATH, chapterFromPath, chapterPath } from "@/lib/world-history/deeplink";
import { basisTag, sourceLine } from "@/lib/world-history/types";
import { blendPose, clampOrbit, orbitBy, orbitFrom, orbitPose, wheelFactor, zoomBy, type Orbit, type OrbitLimits, type Pose } from "@/lib/world-history/camera";
import { animToFilm, buildFilm, chapterAtFilm, chapterStart, cueAt, filmAt, filmToScroll, followScroll, sameCue, scrollToFilm, stepStop, trackHeight, PROLOGUE, type Cue } from "@/lib/world-history/timing";
import type { HistoryScene, Quality } from "./scene";
import type { HistoryAudio } from "./audio";
import { WH_STAGE_CSS } from "./stage-css";
import { FilmWords } from "./FilmWords";
import { cn } from "@/lib/utils";

const MakeHistoryVideo = lazy(() => import("./MakeHistoryVideo"));

type Mode = "boot" | "3d" | "list";

function webglOk() {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    // Give the probe's context back at once: browsers cap live contexts and drop the oldest.
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return !!gl;
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
/** A lost WebGL context that isn't restored within this long gets a new scene (ms). */
const LOST_REBUILD_MS = 2500;
const HEADER_PX = 56;
/** A phone's toolbars coming and going change the stage's height by less than this (px): the scroll mapping keeps its height through them. */
const TOOLBAR_PX = 160;
/** How long a path the film wrote to the address counts as its own (ms): a change to it then is the film's, not a link or back/forward. */
const OWN_PATH_MS = 1500;
/** A timeline drag that stops moving this long (ms) builds the chapter it's on. */
const DRAG_SETTLE_MS = 250;

function reducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
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

/** What the page writes over the picture: the cue (chapter, caption, title card) for the frame on screen, and its state. */
interface Ui extends Cue {
  /** This cue came by a jump: the words before it go at once instead of fading. */
  jumped: boolean;
  loading: boolean;
  /** The WebGL context is lost (restoring). */
  lost: boolean;
  progress: number;
}

export function WorldHistoryExperience({ initialChapter, children }: { initialChapter: string | null; children: React.ReactNode }) {
  const film = useMemo(() => buildFilm(), []);
  const [mode, setMode] = useState<Mode>("boot");
  const [canGl, setCanGl] = useState(false);
  const [ready, setReady] = useState(false);
  /** Bumped to build the scene again (after a lost context that never came back). */
  const [sceneGen, setSceneGen] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [free, setFree] = useState(false);
  const [canLook, setCanLook] = useState(false);
  const [muted, setMutedState] = useState(true);
  const [quality, setQualityState] = useState<Quality>("medium");
  const [ui, setUi] = useState<Ui>({ kind: "hall", chapter: 0, beat: -1, title: "prologue", jumped: false, loading: true, lost: false, progress: 0 });
  const [railOpen, setRailOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [trackH, setTrackH] = useState(0);

  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLElement>(null);
  const dipRef = useRef<HTMLDivElement>(null);
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
    /** Play's speed (0..1): it eases in when Play starts or a held chapter is ready, and out into a hold, so the camera never lurches. */
    rate: 0,
    /** When the timeline was last dragged (ms): while a drag is moving, no chapters are built or dropped. */
    dragAt: -1e9,
    free: null as Orbit | null,
    limits: null as OrbitLimits | null,
    blend: null as { from: Pose; t0: number } | null,
    last: null as Pose | null,
    /** Programmatic scrolls in flight (their scroll events must not move the target). */
    syncing: 0,
    frozen: false,
    /** Frames drawn since a frozen moment's chapter was ready (a frozen film stops drawing once it has settled). */
    frozenFrames: 0,
    /** A jump the next frame shows: 1 a plain cut (dragging the timeline), 2 a cut that dips through black. */
    cut: 0,
    /** Where the playhead was before that jump. */
    cutFrom: 0,
    /** The stage height the scroll ↔ film mapping uses (kept through a phone's toolbars). */
    mapH: 0,
    /** The film has opened on its first moment (its deep link, or ?t=). */
    opened: false,
    /** The stage is on screen (not scrolled away into the text below). */
    onStage: true,
    lastPath: "",
    /** Paths the film itself wrote to the address, and when. */
    wrote: [] as { path: string; at: number }[],
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
    let w0 = -1;
    const fit = () => {
      const s = show.current, h = stageH(), w = window.innerWidth;
      // A phone's toolbars sliding in and out as you scroll: keep the mapping, so the film doesn't move under your finger.
      if (s.mapH && w === w0 && Math.abs(h - s.mapH) < TOOLBAR_PX) return;
      w0 = w;
      s.mapH = h;
      setTrackH(trackHeight(film, h));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [mode, film, stageH]);
  const mapH = useCallback(() => show.current.mapH || stageH(), [stageH]);

  /** Where the track starts in the document (px), and how far the page is into it. */
  const trackTop = useCallback(() => {
    const el = trackRef.current;
    if (!el) return 0;
    return el.getBoundingClientRect().top + window.scrollY - HEADER_PX;
  }, []);
  const scrollFilm = useCallback((t: number) => {
    const y = trackTop() + filmToScroll(film, t, mapH());
    show.current.syncing++;
    window.scrollTo({ top: y, behavior: "instant" as ScrollBehavior });
    requestAnimationFrame(() => { show.current.syncing = Math.max(0, show.current.syncing - 1); });
  }, [film, trackTop, mapH]);

  // ---- Scrolling drives the film (and slides the stage away past its end).
  useEffect(() => {
    if (mode !== "3d") return;
    const onScroll = () => {
      const el = trackRef.current, stage = stageRef.current;
      if (!el || !stage) return;
      const r = el.getBoundingClientRect();
      const h = stage.clientHeight;
      const into = HEADER_PX - r.top;
      const s = show.current;
      // Scroll positions are whole pixels: one that is already where the film is (a jump landed on a caption's
      // or a chapter's exact start) keeps that exact moment, instead of rounding back into the one before.
      if (!s.syncing && !s.free && Math.abs(filmToScroll(film, s.target, mapH()) - into) > 1.5) s.target = scrollToFilm(film, into, mapH());
      const over = into - (r.height - h);
      show.current.onStage = over <= 0;
      stage.style.transform = over > 0 ? `translate3d(0,${-over}px,0)` : "";
      stage.style.visibility = over > h + 10 ? "hidden" : "visible";
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [mode, film, trackH, mapH]);

  // ---- A deep link opens on its chapter (once); a new track height (a rotated phone, a resized window) keeps the moment on screen.
  useLayoutEffect(() => {
    if (mode !== "3d" || !trackH) return;
    const s = show.current;
    if (!s.opened) {
      s.opened = true;
      // The address first: back and forward return to the chapter the film had reached (it keeps the address on it), not the page's first one.
      const id = chapterFromPath(window.location.pathname) ?? initialChapter;
      const i = id ? CHAPTERS.findIndex((c) => c.id === id) : -1;
      s.playhead = s.target = Math.min(film.duration, timeParam() ?? (i >= 0 ? chapterStart(film, i) : 0));
      s.cut = Math.max(s.cut, 1);
      s.lastPath = i >= 0 ? chapterPath(id) : HISTORY_PATH;
    } else if (!s.onStage) return;
    scrollFilm(s.target);
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
  }, [mode, film, sceneGen]);

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
  /**
   * Goes straight to a moment: a cut, never a fast-forward through the parts
   * between. The playhead lands exactly there, so the next frame draws it
   * and writes its words together (dip: through black, for a deliberate jump).
   */
  const seek = useCallback((t: number, dip = true) => {
    const s = show.current;
    if (s.free) exitFree();
    // Free look's glide home belongs to the old moment's camera.
    s.blend = null;
    if (!s.cut) s.cutFrom = s.playhead;
    s.playhead = s.target = Math.max(0, Math.min(film.duration, t));
    s.cut = Math.max(s.cut, dip ? 2 : 1);
    scrollFilm(s.playhead);
  }, [exitFree, film, scrollFilm]);
  const togglePlay = useCallback(() => {
    const s = show.current;
    if (s.free) exitFree();
    if (s.playhead >= film.duration - 0.05) seek(0);
    s.playing = !s.playing;
    s.rate = 0;
    setPlaying(s.playing);
    audioRef.current?.gesture();
  }, [exitFree, film, seek]);

  // ---- The address leads too: a link to another chapter, back and forward (the film's own address changes are skipped).
  const pathname = usePathname();
  useEffect(() => {
    const s = show.current;
    if (mode !== "3d" || !s.opened || !pathname || pathname === s.lastPath) return;
    const now = performance.now();
    if (s.wrote.some((w) => w.path === pathname && now - w.at < OWN_PATH_MS)) return;
    const id = chapterFromPath(pathname);
    if (!id && pathname !== HISTORY_PATH) return;
    s.lastPath = pathname;
    seek(id ? chapterStart(film, CHAPTERS.findIndex((c) => c.id === id)) : 0);
  }, [pathname, mode, film, seek]);

  /** A dip through black over the picture (the words stay on top): a cut that reads as one, or a chapter appearing once built. */
  const dip = useCallback((from: number, ms: number) => {
    const el = dipRef.current;
    if (!el || reducedMotion() || typeof el.animate !== "function") return;
    // A dip already running goes on from where it is (darker if this one starts darker): rapid jumps never flash back to light.
    const running = el.getAnimations();
    const cur = running.length ? Number(getComputedStyle(el).opacity) || 0 : 0;
    for (const a of running) a.cancel();
    el.animate([{ opacity: Math.max(from, cur) }, { opacity: 0 }], { duration: ms, easing: "cubic-bezier(.25,.6,.3,1)" });
  }, []);
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
    let prev: Ui = { kind: "hall", chapter: -1, beat: -2, title: "none", jumped: false, loading: true, lost: false, progress: -1 };
    let lostSince = 0;
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
        // Play holds (in the hall, a few steps from the doorway, or at the chapter's start) until the chapter ahead is built.
        const ahead = state0.kind === "chapter" ? state0.index : state0.hall.to < film.chapters.length && state0.k > 0.55 ? state0.hall.to : -1;
        const waiting = scene.lost || (ahead >= 0 && !scene.isReady(ahead));
        if (!s.frozen) {
          if (s.playing && !s.free) {
            // A held chapter: the clock can't run into a chapter that isn't built, but slows into a hold in the hall.
            s.rate = waiting ? (state0.kind === "chapter" ? 0 : s.rate * Math.exp(-dt * 9)) : Math.min(1, s.rate + dt * 2.2);
            if (s.rate > 0.002) s.playhead = Math.min(film.duration, s.playhead + dt * (s.rate < 1 ? s.rate * s.rate * (3 - 2 * s.rate) : 1));
            s.target = s.playhead;
            if (now - lastSync > 120) { lastSync = now; scrollFilm(s.playhead); }
            if (s.playhead >= film.duration) { s.playing = false; setPlaying(false); }
          } else if (!s.free) {
            // Scrolling: a short way glides, a long way (the scrollbar, a fling, End) is a cut.
            const f = followScroll(s.playhead, s.target, dt);
            if (f.cut && !s.cut) s.cutFrom = s.playhead;
            if (f.cut) s.cut = 2;
            s.playhead = f.t;
          }
        }
        const state = filmAt(film, s.playhead);
        // Chapters: built in order of need (the one on screen, the next two, the previous one), one
        // after another so the nearest is never slowed by the rest; only these stay built.
        const cur = chapterAtFilm(film, s.playhead, state);
        const next = state.kind === "hall" ? state.hall.to : cur + 1;
        const lookahead = scene.quality === "low" || scene.quality === "draft" ? 1 : 2;
        const order = solo ? [cur] : state.kind === "hall" ? [state.hall.to, state.hall.from, ...Array.from({ length: lookahead }, (_, j) => next + 1 + j)] : [cur, ...Array.from({ length: lookahead }, (_, j) => next + j), cur - 1];
        const want = [...new Set(order.filter((i) => i >= 0 && i < film.chapters.length))];
        // Dragging along the timeline: build nothing for the moments it only passes through (a pause in the drag counts as a stop).
        if (now - s.dragAt > DRAG_SETTLE_MS) {
          for (const i of want) {
            void scene.prepare(i);
            if (!scene.isReady(i)) break;
          }
          scene.retain(want);
        }
        // The camera: free look, or gliding back to the film from it (one draw a frame: the blend is worked out first).
        let lookPose: Pose | null = null;
        if (s.free && state.kind === "chapter") lookPose = orbitPose(s.free);
        else if (s.blend) {
          const k = (now / 1000 - s.blend.t0) / 0.8;
          const filmPose = scene.poseAt(state);
          if (k >= 1 || !filmPose) s.blend = null;
          else lookPose = blendPose(s.blend.from, filmPose, k);
        }
        const info = scene.frame({ state, ambient: now / 1000, look: lookPose });
        const pose = info.pose;
        s.last = pose;
        s.limits = info.orbit?.limits ?? null;
        if (s.free && s.limits) s.free = clampOrbit(s.free, s.limits);
        if (s.free && state.kind !== "chapter") { s.free = null; setFree(false); document.documentElement.classList.remove("wh-locked"); }
        audioRef.current?.update({ state, playing: s.playing, dt });
        // The words: from the playhead this frame drew (the one source of truth), written before the
        // browser paints it, so a jump changes the picture and its words in the same frame.
        const cut = s.cut;
        s.cut = 0;
        const nextUi: Ui = { ...cueAt(film, s.playhead, state), jumped: cut > 0, loading: !info.complete || (s.playing && waiting), lost: !!info.lost, progress: Math.round((s.playhead / film.duration) * 400) / 400 };
        const moved = !sameCue(nextUi, prev);
        if (moved || nextUi.loading !== prev.loading || nextUi.lost !== prev.lost) {
          if (!moved) nextUi.jumped = prev.jumped;
          flushSync(() => {
            setUi(nextUi);
            setCanLook(!!info.orbit);
          });
        }
        // A jump dips through black (deeper into another chapter); a chapter that was still building fades up.
        if (cut === 2 && Math.abs(s.playhead - s.cutFrom) > 0.25) dip(nextUi.chapter !== prev.chapter || nextUi.kind !== prev.kind ? 0.95 : 0.55, nextUi.chapter !== prev.chapter ? 520 : 320);
        else if (prev.loading && !nextUi.loading && !nextUi.lost) dip(1, 520);
        // A lost context the browser doesn't give back: start the scene again on a new canvas.
        if (info.lost) {
          if (!lostSince) lostSince = now;
          else if (now - lostSince > LOST_REBUILD_MS) { lostSince = 0; setSceneGen((g) => g + 1); }
        } else lostSince = 0;
        if (barRef.current) barRef.current.style.transform = `scaleX(${(s.playhead / film.duration).toFixed(4)})`;
        prev = nextUi;
        // The address follows the chapter.
        const path = s.playhead < PROLOGUE * 0.6 ? HISTORY_PATH : chapterPath(CHAPTERS[cur].id);
        if (path !== s.lastPath) {
          s.lastPath = path;
          s.wrote = [...s.wrote.filter((w) => now - w.at < OWN_PATH_MS), { path, at: now }];
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
      // Frames while a chapter builds (decoding, compiling) say nothing about the device.
      if (scene.busy() || scene.lost) { slowFor = fastFor = 0; return; }
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
    const checks = {
      setQuality(q: Quality) { sceneRef.current?.setQuality(q); setQualityState(q); },
      probe: () => sceneRef.current?.probe() ?? null,
      seek(t: number, freeze = false) { show.current.playhead = show.current.target = t; show.current.cut = Math.max(show.current.cut, 1); show.current.blend = null; show.current.frozen = freeze; show.current.frozenFrames = 0; },
      chapterStart: (i: number) => chapterStart(film, i),
      beatTime: (i: number, beat: number) => { const c = film.chapters[i]; return c.start + (c.beats[beat] ? animToFilm(c, c.beats[beat].anim) : 0); },
      state() {
        const s = show.current;
        const st = filmAt(film, s.playhead);
        return { t: s.playhead, anim: st.kind === "chapter" ? st.anim : null, duration: film.duration, kind: st.kind, chapter: chapterAtFilm(film, s.playhead), playing: s.playing, free: !!s.free, dist: s.free?.dist ?? null, quality: sceneRef.current?.quality ?? null, stats: sceneRef.current?.stats() ?? null, prof: { ...s.prof } };
      },
    };
    const w = window as unknown as { __wh?: unknown };
    w.__wh = checks;
    return () => {
      cancelAnimationFrame(raf);
      // A film that's gone (a page change, a rebuilt scene) leaves nothing for checks to read.
      if (w.__wh === checks) delete w.__wh;
    };
  }, [ready, film, scrollFilm, dip]);

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
  /** Words go up only over the picture they belong to: not while a chapter is still being built (the stage says which). */
  const words = ready && !ui.loading;
  const scrubAt = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width))) * film.duration;
  };

  return (
    <MotionConfig reducedMotion="user">
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
          data-title={ui.title}
          data-recording={recording ? "1" : "0"}
        >
          <div ref={hostRef} className="absolute inset-0 cursor-grab select-none active:cursor-grabbing" data-testid="wh-scene" role="application" aria-label="The History of the Pokémon World in 3D. Scroll to move through the film; drag to look around; pinch or scroll with ctrl to zoom." />
          <div ref={dipRef} className="wh-dip" aria-hidden />
          <div className="wh-shade-top" aria-hidden />
          <div className="wh-shade-bottom" aria-hidden />

          {(!ready || ui.loading) && (
            <div className="wh-loading pointer-events-none absolute inset-0 z-[5] flex flex-col items-center justify-center gap-4 text-white" aria-live="polite">
              <div className="wh-load-ring" aria-hidden />
              <p className="wh-title-k text-[10px] uppercase text-white/80" data-testid="wh-loading">{!ready ? "Opening the museum…" : ui.lost ? "Restoring the picture…" : `Opening ${chapter?.region ?? "the exhibit"}…`}</p>
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
          <AnimatePresence custom={ui.jumped}>
            {ready && ui.title === "prologue" && (
              <FilmWords key="pro" kind="prologue" jumped={ui.jumped} className="wh-pro pointer-events-none absolute inset-x-0 top-[18%] z-[6] flex flex-col items-center px-6 text-center text-white" testId="wh-prologue">
                <p className="wh-title-k wh-tk text-[10px] uppercase text-[#f2c96b] sm:text-xs">PokéIQ 3D Lab · In-universe history</p>
                <h1 className="wh-serif wh-title mt-3 max-w-4xl text-5xl font-semibold leading-[0.95] sm:text-7xl lg:text-8xl">The History of the Pokémon World</h1>
                <p className="wh-cap-lead mt-4 max-w-xl text-sm text-white/80 sm:text-base">The story of the Pokémon world, as the games themselves tell it. Every line is sourced.</p>
                <p className="wh-hint mt-6 inline-flex items-center gap-2 font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-white/75">Scroll, or press play <ArrowDown className="h-3.5 w-3.5" aria-hidden /></p>
              </FilmWords>
            )}
          </AnimatePresence>

          {/* A chapter's title card. */}
          <AnimatePresence custom={ui.jumped}>
            {words && ui.title === "chapter" && chapter && (
              <FilmWords key={`t-${chapter.id}`} kind="title" jumped={ui.jumped} className="pointer-events-none absolute inset-x-0 top-[20%] z-[6] flex flex-col items-center px-6 text-center text-white" testId="wh-title-card">
                <p className="wh-title-k wh-tk text-[10px] uppercase sm:text-xs" style={{ color: chapter.accent }}>{chapter.numeral} · {chapter.region}</p>
                <i className="wh-rule" style={{ ["--wh-accent" as string]: chapter.accent }} aria-hidden />
                <h2 className="wh-serif wh-title mt-2 text-5xl font-semibold leading-none sm:text-7xl" aria-label={chapter.title}>
                  <TitleWords text={chapter.title} />
                </h2>
                <p className="wh-serif wh-cap-lead wh-when mt-3 text-lg italic text-white/85 sm:text-2xl">{chapter.when}</p>
              </FilmWords>
            )}
          </AnimatePresence>

          {/* The end. */}
          <AnimatePresence custom={ui.jumped}>
            {ui.title === "end" && (
              <FilmWords key="end" kind="end" jumped={ui.jumped} className="absolute inset-x-0 top-[16%] z-[7] flex flex-col items-center px-6 text-center text-white" testId="wh-end">
                <p className="wh-title-k text-[10px] uppercase text-[#f2c96b] sm:text-xs">The story so far</p>
                <h2 className="wh-serif wh-title mt-3 max-w-3xl text-4xl font-semibold leading-none sm:text-6xl">The History of the Pokémon World</h2>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  <button type="button" onClick={() => { seek(0); show.current.playing = true; setPlaying(true); }} className="wh-chip h-11" data-testid="wh-again"><RotateCcw className="h-4 w-4" aria-hidden /> Watch again</button>
                  <button type="button" onClick={() => setVideoOpen(true)} className="wh-chip h-11" data-testid="wh-end-video"><Clapperboard className="h-4 w-4 text-[#f2c96b]" aria-hidden /> Make a video</button>
                  <button type="button" onClick={toText} className="wh-chip h-11"><BookOpen className="h-4 w-4" aria-hidden /> Read it, with sources</button>
                </div>
              </FilmWords>
            )}
          </AnimatePresence>

          {/* Caption. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-[4.9rem] z-[6] px-4 sm:bottom-[5.6rem] sm:px-8 lg:right-48" aria-live="polite" data-testid="wh-caption-area">
            <div className="relative">
              <AnimatePresence custom={ui.jumped}>
                {words && beat && chapter && source && (
                  <FilmWords key={`${chapter.id}-${beat.id}`} kind="caption" jumped={ui.jumped} as="figure" className="wh-lower absolute bottom-0 left-0 w-full max-w-[46rem] text-white" style={{ ["--wh-accent" as string]: chapter.accent }} testId="wh-caption">
                    {beat.lead && <p className="wh-cap-lead wh-lead-in mb-2 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-white/80 sm:text-xs">{beat.lead}</p>}
                    <blockquote className={cn("wh-cap-q wh-wipe whitespace-pre-line text-[1.45rem] sm:text-3xl lg:text-[2.15rem]", !beat.quote && "not-italic")}>
                      {beat.quote ? `“${filmLine(beat)}”` : filmLine(beat)}
                    </blockquote>
                    <figcaption className="wh-cap-src mt-2.5 flex flex-wrap items-center gap-2 text-[11px] text-white/70 sm:text-xs">
                      {tag && <span className="wh-tag" style={{ color: chapter.accent }}>{tag}</span>}
                      <cite className="not-italic" data-testid="wh-source">{sourceLine(source)}</cite>
                    </figcaption>
                  </FilmWords>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Bottom bar: play, the scrubber, look around and zoom, video, share. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-3 pb-3 sm:px-5 sm:pb-4">
            <div className="wh-scrub pointer-events-auto mb-2" role="slider" aria-label="Film position" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ui.progress * 100)} tabIndex={-1}
              onPointerDown={(e) => {
                try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ }
                pause();
                seek(scrubAt(e));
              }}
              onPointerUp={() => { show.current.dragAt = -1e9; }}
              onPointerCancel={() => { show.current.dragAt = -1e9; }}
              onLostPointerCapture={() => { show.current.dragAt = -1e9; }}
              onPointerMove={(e) => {
                // Dragging along the timeline: the picture and its words follow the finger, cut by cut, without dips.
                let held = false;
                try { held = e.currentTarget.hasPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ }
                if (!held) return;
                show.current.dragAt = performance.now();
                seek(scrubAt(e), false);
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
    </MotionConfig>
  );
}

/** A title whose words rise out of a mask one after another, then a light sweeps across them (motion in stage-css). */
function TitleWords({ text }: { text: string }) {
  const words = text.split(" ");
  return (
    <span className="wh-words">
      {words.map((w, i) => (
        <span key={i}>
          <span className="wh-w" aria-hidden><span style={{ ["--i" as string]: i }}>{w}</span></span>
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
      <span className="wh-sweep" aria-hidden>{text}</span>
    </span>
  );
}
