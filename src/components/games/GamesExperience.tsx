"use client";

import Link from "next/link";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Clapperboard, CloudRain, Dices, Info, List, Medal, Play, RotateCcw, Share2, SkipForward, Trophy, Users, Volume2, VolumeX, X } from "lucide-react";
import { isMuted, onMuteChange, setMuted } from "@/lib/sound";
import { copyText } from "@/lib/share";
import { fromAthleteRow, type Athlete, type AthleteRow } from "@/lib/games/athlete";
import { eventOf, formatMark, type EventId } from "@/lib/games/events";
import { buildNations, medalTable, runEvent, runGames, type EventOutcome, type GamesResult, type NationSpec } from "@/lib/games/games";
import { GAMES_PATH, eventRunPath, h2hQuestion, parseField, parseGamesSeed, parseNations, parseRain, playPath } from "@/lib/games/deeplink";
import { newSeed } from "@/lib/games/seed";
import { orbitBy, orbitFrom, orbitPose, wheelFactor, zoomBy, type Orbit } from "@/lib/race/orbit";
import { RACE_URLS } from "@/components/race/urls";
import { RACE_CSS } from "@/components/race/race-css";
import type { GamesScene, Quality } from "./scene";
import type { GamesAudio } from "./audio";
import { drawOverlay, drawSprint, type Gfx } from "./graphics";
import { eventShow } from "./show/build";
import { gamesShow, type GamesShow } from "./show/games";
import type { Sequence } from "./show/sequence";
import type { SprintExtras } from "./show/sprint";
import type { Show } from "./show/types";
import { GamesInfo } from "./GamesInfo";
import { GamesPicker } from "./GamesPicker";
import { NationsPicker } from "./NationsPicker";
import { cn } from "@/lib/utils";

const MakeGamesVideo = lazy(() => import("./MakeGamesVideo"));

/** Warms the HTTP cache with a show's figures (HOME renders and relief maps) ahead of its turn. */
function prefetchAthletes(seq: Sequence, q: Quality) {
  const size = q === "draft" || q === "low" ? 256 : 512;
  const seen = new Set<string>();
  for (const e of [...seq.athletes.map((a) => a.entrant), ...(seq.race?.lanes.map((l) => l.entrant) ?? [])]) {
    if (seen.has(e.key)) continue;
    seen.add(e.key);
    for (const url of [RACE_URLS.art(e.art, size), RACE_URLS.relief(e)]) void fetch(url, { priority: "low" } as RequestInit).catch(() => undefined);
  }
}

let rowsPromise: Promise<Athlete[]> | null = null;
/** Every athlete (fetched once per page load; static and cached by the CDN). */
export function loadAthletes(): Promise<Athlete[]> {
  rowsPromise ??= fetch("/api/games")
    .then((r) => { if (!r.ok) throw new Error(`games ${r.status}`); return r.json() as Promise<AthleteRow[]>; })
    .then((rows) => rows.map(fromAthleteRow))
    .catch((e) => { rowsPromise = null; throw e; });
  return rowsPromise;
}

function webglOk() {
  try { return !!document.createElement("canvas").getContext("webgl2"); } catch { return false; }
}
function initialQuality(): Quality {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const short = Math.min(window.screen.width, window.screen.height);
  if ((coarse && short < 820) || (nav.deviceMemory ?? 8) <= 2) return "low";
  return "medium";
}
const fullIntro = () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("intro") === "full";

function qualityParam(): Quality | null {
  try {
    const q = new URLSearchParams(window.location.search).get("q");
    return q === "draft" || q === "low" || q === "medium" || q === "high" ? q : null;
  } catch { return null; }
}
const LOWER: Record<Quality, Quality> = { export: "high", high: "medium", medium: "low", low: "low", draft: "draft" };
const HIGHER: Record<Quality, Quality> = { export: "export", high: "high", medium: "high", low: "medium", draft: "draft" };
const FRAME_BUDGET_MS = 1000 / 50;

export type GamesMode =
  | { mode: "event"; event: EventId; keys: string[]; defaults: string[]; seed: number; rain: boolean }
  | { mode: "games"; nations: NationSpec[]; candidates: Record<string, string[]>; seed: number; rain: boolean };

export interface GamesExperienceProps {
  init: GamesMode;
  children: React.ReactNode;
}

type UiPhase = "loading" | "show" | "end";

/**
 * The PokéIQ Games in 3D: a single event (up to eight Pokémon, or two in
 * a head to head) or the whole Games (up to eight nations of three, every
 * event in order with a live medal table), played as a broadcast in PokéIQ
 * Stadium, the indoor arena and the aquatics centre. The server-rendered
 * results underneath are the page for search engines, reduced motion and
 * browsers without WebGL.
 */
export function GamesExperience({ init, children }: GamesExperienceProps) {
  const [view, setView] = useState<"boot" | "3d" | "list">("boot");
  const [canGl, setCanGl] = useState(false);
  const [all, setAll] = useState<Athlete[] | null>(null);
  const [spec, setSpec] = useState<GamesMode>(init);
  const [ready, setReady] = useState(false);
  const [sceneGen, setSceneGen] = useState(0);
  const [loaded, setLoaded] = useState(0);
  const [phase, setPhase] = useState<UiPhase>("loading");
  const [partIdx, setPartIdx] = useState(0);
  const [muted, setMutedState] = useState(true);
  const [picker, setPicker] = useState(false);
  const [info, setInfo] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [panel, setPanel] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [quality, setQualityState] = useState<Quality>("medium");
  const [runId, setRunId] = useState(0);
  const [photo, setPhoto] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<GamesScene | null>(null);
  const audioRef = useRef<GamesAudio | null>(null);
  const sizeRef = useRef({ w: 1, h: 1 });
  const recordingRef = useRef(false);
  recordingRef.current = recording;

  const byKey = useMemo(() => new Map((all ?? []).map((a) => [a.key, a])), [all]);
  const event: EventId = spec.mode === "event" ? spec.event : "100m";

  // ---- The competition and its broadcast.
  const field = useMemo(() => {
    if (spec.mode !== "event" || !all) return [];
    const keys = spec.keys.length ? spec.keys : spec.defaults;
    return keys.map((k) => byKey.get(k)).filter((a): a is Athlete => !!a);
  }, [spec, all, byKey]);
  const outcome = useMemo<EventOutcome | null>(() => (spec.mode === "event" && field.length >= (event === "wrestling" || event === "all-around" ? 2 : 1) ? runEvent(event, field, spec.seed, { rain: spec.rain }) : null), [spec, field, event]);
  const games = useMemo<GamesResult | null>(() => {
    if (spec.mode !== "games" || !all) return null;
    const nations = buildNations(spec.nations, byKey, spec.candidates);
    return nations.length >= 2 ? runGames(nations, spec.seed, { rain: spec.rain }) : null;
  }, [spec, all, byKey]);
  const isH2H = spec.mode === "event" && field.length === 2;
  const budget = typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches ? 60 : 72;
  /** The playlist: one sequence for an event; the Games' events one by one. */
  const playlist = useMemo<Sequence[]>(() => {
    // The long opening (every lane introduced) stays behind ?intro=full.
    if (outcome) return [eventShow(outcome, byKey, { budget, lineup: fullIntro() })];
    if (games) return gamesShow(games, byKey, { budget: 34 }).parts;
    return [];
  }, [outcome, games, byKey, budget]);
  const current = playlist[Math.min(partIdx, playlist.length - 1)] ?? null;
  const idleVenue = current?.venue ?? "stadium";
  const title = spec.mode === "games" ? "The PokéIQ Games" : isH2H ? h2hQuestion(event, field[0].name, field[1].name) : `${eventOf(event).name}`;

  const show = useRef({
    seq: null as Sequence | null,
    t: 0,
    frozen: false,
    cueAt: 0,
    heard: -1,
    orbit: null as Orbit | null,
    free: false,
    last: null as import("@/lib/race/director").CamPose | null,
    pf: null as ReturnType<GamesScene["photoFinish"]> | null,
    pfImg: null as HTMLCanvasElement | null,
    prof: { n: 0, sum: 0, max: 0 },
    phase: "loading" as UiPhase,
  });

  // ---- Which view.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const params = new URLSearchParams(window.location.search);
    const forced = params.get("view");
    const gl = webglOk();
    setCanGl(gl);
    setView(forced === "list" || (forced !== "3d" && reduce) || !gl ? "list" : "3d");
    setMutedState(isMuted());
    return onMuteChange(setMutedState);
  }, []);

  useEffect(() => {
    if (view === "list") return;
    window.scrollTo(0, 0);
    document.documentElement.classList.add("rc-locked");
    return () => document.documentElement.classList.remove("rc-locked");
  }, [view]);

  // ---- Data (the URL's field, if any, once the athletes are known).
  useEffect(() => {
    if (view === "boot" || all) return;
    let alive = true;
    loadAthletes().then((list) => {
      if (!alive) return;
      setAll(list);
      const params = new URLSearchParams(window.location.search);
      const known = (k: string) => list.some((a) => a.key === k);
      const sd = parseGamesSeed(params.get("seed"));
      const rain = parseRain(params.get("rain"));
      if (init.mode === "event") {
        const keys = parseField(params.get("vs"), known);
        if (keys.length || sd != null || rain) setSpec({ ...init, keys: keys.length ? keys : init.keys, seed: sd ?? init.seed, rain: rain || init.rain });
      } else {
        const ns = parseNations(params.get("n"), known);
        if (ns.length || sd != null || rain) setSpec({ ...init, nations: ns.length >= 2 ? ns : init.nations, seed: sd ?? init.seed, rain: rain || init.rain });
      }
    }, () => alive && setView("list"));
    return () => { alive = false; };
  }, [view, all, init]);

  // ---- Sound: built on the first gesture.
  useEffect(() => {
    if (view !== "3d") return;
    let alive = true;
    const onGesture = () => {
      if (audioRef.current) { audioRef.current.gesture(); return; }
      void import("./audio").then(({ createGamesAudio }) => {
        if (!alive || audioRef.current) return;
        audioRef.current = createGamesAudio();
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
  }, [view]);

  // ---- The scene.
  useEffect(() => {
    if (view !== "3d" || !all || !hostRef.current) return;
    let alive = true;
    const host = hostRef.current;
    const font = getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim() || "sans-serif";
    import("./scene").then(async ({ createGamesScene }) => {
      if (!alive) return;
      try {
        await document.fonts?.load(`700 40px ${font}`).catch(() => undefined);
        const q = qualityParam() ?? initialQuality();
        sceneRef.current = createGamesScene(host, { quality: q, urls: RACE_URLS, font, onContextGone: () => alive && setSceneGen((g) => g + 1) });
        setQualityState(q);
        if (alive) setReady(true);
      } catch { if (alive) setView("list"); }
    }, () => alive && setView("list"));
    return () => {
      alive = false;
      sceneRef.current?.dispose();
      sceneRef.current = null;
      setReady(false);
    };
  }, [view, all, sceneGen]);

  // ---- A part of the show: load everyone it draws, then play it.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!ready || !scene || !current) return;
    const ac = new AbortController();
    const s = show.current;
    s.phase = "loading";
    setPhase("loading");
    setLoaded(0);
    setPhoto(null);
    s.pf = null;
    s.pfImg = null;
    scene.load({ athletes: current.athletes, race: current.race, falseRace: current.falseRace, venue: current.venue }, ac.signal, setLoaded).then(() => {
      if (ac.signal.aborted) return;
      s.seq = current;
      s.t = 0;
      s.cueAt = 0;
      s.free = false;
      s.orbit = null;
      s.phase = "show";
      setPhase("show");
      setPanel(true);
      scene.setCard(eventOf(current.event).name, current.headline);
      // The Games: fetch the next event's athletes while this one plays, so it starts at once.
      const next = spec.mode === "games" ? playlist[partIdx + 1] : null;
      if (next) prefetchAthletes(next, scene.quality);
    }).catch(() => undefined);
    return () => ac.abort();
  }, [ready, current, runId, spec.mode, playlist, partIdx]);

  // ---- Size.
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
    let ftEma = FRAME_BUDGET_MS, slowFor = 0, fastFor = 0, warm = 0;
    const pinned = qualityParam() !== null;
    const font = getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim() || "sans-serif";
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const scene = sceneRef.current;
      const now = performance.now();
      const raw = now - last;
      last = now;
      if (!scene || recordingRef.current) return;
      const s = show.current;
      try { frame(scene, now, raw); } finally {
        const ms = performance.now() - now;
        s.prof.n++; s.prof.sum += ms; s.prof.max = Math.max(s.prof.max, ms);
      }
    };
    const frame = (scene: GamesScene, now: number, raw: number) => {
      const s = show.current;
      const { w, h } = sizeRef.current;
      const aspect = w / h;
      const seq = s.seq;
      if (!seq || s.phase === "loading") {
        // Waiting: a slow drift over the venue.
        const a = now / 1000;
        scene.frame({ t: a, venue: idleVenue, pose: { pos: [Math.sin(a * 0.05) * 140, 70, Math.cos(a * 0.05) * 140], target: [0, 0, 0], fov: aspect < 0.8 ? 62 : 44 }, beat: { kind: "card", t0: 0, t1: 1, cam: "" }, k: 0, actors: [], props: { kind: "none" }, bursts: [], decals: [], excitement: 0.3, replay: 0, fade: 0, flash: 0, clock: "", screen: null });
        clear();
        return;
      }
      const dt = Math.min(0.1, raw / 1000);
      const prev = s.t;
      if (!s.frozen) s.t = Math.min(seq.end + 30, s.t + dt);
      const t = Math.min(s.t, seq.end);
      const fr = seq.at(t, aspect);
      if (s.free) {
        if (!s.orbit) s.orbit = orbitFrom(s.last ?? fr.pose);
        fr.pose = orbitPose(s.orbit);
      }
      s.last = fr.pose;
      const steps = scene.frame(fr);
      // Sound: cues as the clock passes them (forward only, and not after a jump).
      const au = audioRef.current;
      if (au) {
        if (Math.abs(fr.excitement - s.heard) > 0.015) { s.heard = fr.excitement; au.crowd(fr.excitement); }
        for (const st of steps) au.footfall(st.kg, st.dist);
        if (s.t - prev > 0 && s.t - prev < 0.5) for (const c of seq.cues) if (c.t > prev && c.t <= s.t) au.cue(c.kind, c.gain);
      }
      // The photo finish develops a few columns a frame once the race is run.
      const part = seq.partAt(t);
      const sp = part.show as Show & Partial<SprintExtras>;
      if (sp.racePlan && !s.pfImg && t - part.t0 > sp.pre! + sp.racePlan.gun + (sp.race?.first ?? 0)) {
        s.pf ??= scene.photoFinish(sp.photoFrame!);
        if (s.pf.step()) { s.pfImg = s.pf.result(); if (s.pfImg) setPhoto(s.pfImg.toDataURL("image/png")); }
      }
      draw(seq, t, font);
      const end = s.t >= seq.end;
      if (end && s.phase !== "end") {
        s.phase = "end";
        setPhase("end");
        if (spec.mode === "games" && partIdx < playlist.length - 1) setTimeout(() => setPartIdx((i) => i + 1), 400);
      }
      if (pinned) return;
      if (warm < 30 || raw > 400) warm++;
      else {
        ftEma = ftEma * 0.92 + raw * 0.08;
        slowFor = ftEma > FRAME_BUDGET_MS * 1.6 ? slowFor + raw : 0;
        fastFor = ftEma < FRAME_BUDGET_MS * 0.55 ? fastFor + raw : 0;
        if (slowFor > 1500 && scene.quality !== LOWER[scene.quality]) { scene.setQuality(LOWER[scene.quality]); setQualityState(scene.quality); slowFor = 0; warm = 10; }
        else if (fastFor > 6000 && scene.quality !== HIGHER[scene.quality] && !window.matchMedia("(pointer: coarse)").matches) { scene.setQuality(HIGHER[scene.quality]); setQualityState(scene.quality); fastFor = 0; warm = 10; }
      }
    };
    const clear = () => {
      const cv = overlayRef.current;
      if (!cv) return;
      const g = cv.getContext("2d")!;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, cv.width, cv.height);
    };
    const draw = (seq: Sequence, t: number, font: string) => {
      const cv = overlayRef.current, scene = sceneRef.current;
      if (!cv || !scene) return;
      const g = cv.getContext("2d")!;
      const { w, h } = sizeRef.current;
      const dpr = cv.width / w;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, cv.width, cv.height);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const phone = w < 640;
      const o: Gfx = { font, scale: phone ? 1 : 1.1, top: phone ? 104 : 76, bottom: phone ? 132 : 96, phone };
      const part = seq.partAt(t);
      const heads = scene.heads();
      const sp = part.show as Show & Partial<SprintExtras>;
      if (sp.racePlan) drawSprint(g, w, h, sp as Show & SprintExtras, t - part.t0, heads, show.current.pfImg, { ...o, title: `${eventOf(sp.event).name} · ${eventOf(sp.event).name === "100 m" ? "final" : "final"}` });
      else drawOverlay(g, w, h, seq.overlay(t), heads, byKey, o);
    };
    raf = requestAnimationFrame(tick);
    (window as unknown as { __games?: unknown }).__games = {
      seek(t: number, freeze = false) { show.current.t = t; show.current.frozen = freeze; },
      state() {
        const s = show.current;
        const seq = s.seq;
        const b = seq ? seq.beats.find((x) => s.t < x.t1) : null;
        return { t: s.t, end: seq?.end ?? null, phase: s.phase, beat: b ? [b.kind, b.cam, b.t0, b.t1] : null, beats: seq?.beats.map((x) => [x.kind, x.cam, x.t0, x.t1, x.title ?? ""]) ?? [], results: seq?.resultsAt ?? null, part: partIdx, parts: playlist.length, quality: sceneRef.current?.quality ?? null, stats: sceneRef.current?.stats() ?? null, prof: { ...s.prof }, venue: seq?.venue ?? null };
      },
      frame(t: number) {
        const seq = show.current.seq;
        if (!seq) return null;
        const f = seq.at(t, sizeRef.current.w / Math.max(1, sizeRef.current.h));
        return { pose: f.pose, props: f.props, beat: [f.beat.kind, f.beat.cam], actors: f.actors.map((a) => [a.key, a.pose.x, a.pose.y, a.pose.z, a.pose.visible]) };
      },
      next() { setPartIdx((i) => Math.min(playlist.length - 1, i + 1)); },
      part(i: number) { setPartIdx(Math.max(0, Math.min(playlist.length - 1, i))); },
    };
    return () => cancelAnimationFrame(raf);
  }, [ready, byKey, spec.mode, partIdx, playlist, idleVenue]);

  useEffect(() => { if (stageRef.current) stageRef.current.dataset.q = quality; }, [quality]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- Drag to orbit, wheel to zoom (a free camera).
  useEffect(() => {
    if (!ready || !hostRef.current) return;
    const host = hostRef.current;
    let down: { x: number; y: number } | null = null;
    const pd = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; try { host.setPointerCapture(e.pointerId); } catch { /* ignore */ } };
    const pm = (e: PointerEvent) => {
      if (!down || recordingRef.current) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      down = { x: e.clientX, y: e.clientY };
      if (Math.abs(dx) + Math.abs(dy) < 0.5) return;
      const s = show.current;
      if (!s.free) { s.free = true; s.orbit = s.last ? orbitFrom(s.last) : null; }
      if (s.orbit) s.orbit = orbitBy(s.orbit, dx, dy, sizeRef.current.h);
    };
    const pu = () => { down = null; };
    const wheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest?.("[data-rc-scroll], [role=dialog]") && !e.ctrlKey) return;
      e.preventDefault();
      const s = show.current;
      if (!s.free) { s.free = true; s.orbit = s.last ? orbitFrom(s.last) : null; }
      if (s.orbit) s.orbit = zoomBy(s.orbit, wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey));
    };
    host.addEventListener("pointerdown", pd);
    host.addEventListener("pointermove", pm);
    host.addEventListener("pointerup", pu);
    host.addEventListener("pointercancel", pu);
    host.addEventListener("wheel", wheel, { passive: false });
    return () => {
      host.removeEventListener("pointerdown", pd);
      host.removeEventListener("pointermove", pm);
      host.removeEventListener("pointerup", pu);
      host.removeEventListener("pointercancel", pu);
      host.removeEventListener("wheel", wheel);
    };
  }, [ready]);

  // ---- Actions.
  const replaceUrl = (path: string) => { try { history.replaceState(history.state, "", path); } catch { /* ignore */ } };
  const sharePath = () => (spec.mode === "event" ? eventRunPath(spec.event, { keys: spec.keys, seed: spec.seed, rain: spec.rain }) : playPath(spec.nations, spec.seed, spec.rain));
  const restart = useCallback(() => { const s = show.current; s.t = 0; s.cueAt = 0; s.free = false; s.orbit = null; s.phase = "show"; setPhase("show"); audioRef.current?.hush(); }, []);
  const skip = () => { const s = show.current; if (s.seq) { s.t = Math.max(s.t, s.seq.resultsAt); s.free = false; audioRef.current?.hush(); } };
  const again = () => {
    const seed = newSeed();
    setSpec((x) => ({ ...x, seed }));
    setPartIdx(0);
    if (spec.mode === "event") replaceUrl(eventRunPath(spec.event, { keys: spec.keys, seed, rain: spec.rain }));
    else replaceUrl(playPath(spec.nations, seed, spec.rain));
  };
  const toggleRain = () => {
    setSpec((x) => ({ ...x, rain: !x.rain }));
    setRunId((x) => x + 1);
  };
  const share = async () => {
    const url = `${window.location.origin}${sharePath()}`;
    const text = current ? `${title}: ${current.headline}` : title;
    if (typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
      try { await navigator.share({ title: "The PokéIQ Games", text, url }); return; } catch { /* closed */ }
    }
    if (await copyText(url)) setToast("Link copied");
  };
  const toggleMute = () => {
    const next = !isMuted();
    setMuted(next);
    setMutedState(next);
    if (!next) audioRef.current?.gesture();
  };
  const runField = (ev: EventId, keys: string[]) => {
    setPicker(false);
    const seed = spec.seed;
    setSpec({ mode: "event", event: ev, keys, defaults: spec.mode === "event" ? spec.defaults : [], seed, rain: spec.mode === "event" ? spec.rain : false });
    setPartIdx(0);
    replaceUrl(eventRunPath(ev, { keys, seed }));
  };
  const runNations = (nations: NationSpec[]) => {
    setPicker(false);
    if (spec.mode !== "games") return;
    setSpec({ ...spec, nations });
    setPartIdx(0);
    replaceUrl(playPath(nations, spec.seed, spec.rain));
  };

  const chip = "rc-chip pointer-events-auto inline-flex h-9 items-center gap-1.5 max-sm:min-h-10 max-sm:min-w-10 max-sm:justify-center rounded-md border border-white/15 bg-[#0b1226]/75 px-3 font-display text-[11px] font-semibold uppercase tracking-[0.12em] text-white/85 backdrop-blur-md transition-colors hover:border-white/35 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffd84a] disabled:opacity-50";
  const ended = phase === "end";
  const isSwim = spec.mode === "event" && eventOf(spec.event).kind === "swim";
  const table = games ? medalTable(games.nations, games.outcomes.slice(0, Math.min(partIdx + (ended ? 1 : 0), games.outcomes.length))) : null;
  const rows = outcome ? outcome.standings.map((k, i) => ({ key: k, place: i + 1, mark: outcome.event === "wrestling" ? "" : formatMark(outcome.event, outcome.marks.get(k)) })) : [];

  return (
    <>
      <style>{RACE_CSS}</style>
      <noscript><style>{`.rc-stage{display:none!important}`}</style></noscript>
      <div>
        {view === "list" && canGl && (
          <div className="mb-4 flex justify-end">
            <button type="button" onClick={() => setView("3d")} className="rounded-md border bg-card px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:border-screen/60 hover:text-foreground" data-testid="games-3d-view">Watch it in 3D</button>
          </div>
        )}
        {children}
      </div>
      {view !== "list" && (
        <div
          ref={stageRef}
          className="rc-stage gm-stage fixed left-0 !mt-0 w-screen bottom-[calc(3.5rem+env(safe-area-inset-bottom))] top-14 z-40 overflow-hidden lg:bottom-0"
          data-testid="games-stage"
          data-ready={ready ? "1" : "0"}
          data-phase={phase}
          data-event={spec.mode === "event" ? spec.event : current?.event ?? ""}
          data-part={partIdx}
          data-parts={playlist.length}
          data-venue={current?.venue ?? ""}
          data-winner={outcome?.podium.gold[0] ?? games?.champion ?? ""}
          data-photo={photo ? "1" : "0"}
          data-recording={recording ? "1" : "0"}
        >
          <div ref={hostRef} className="rc-host absolute inset-0 cursor-grab touch-none select-none active:cursor-grabbing" data-testid="games-scene" role="application" aria-label="The PokéIQ Games in 3D. Drag to look around, scroll to zoom." />
          <canvas ref={overlayRef} className="rc-overlay h-full w-full" aria-hidden />
          <div className="rc-shade-top" aria-hidden />
          <div className="rc-shade-bottom" aria-hidden />

          {(!ready || phase === "loading") && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-white" aria-live="polite">
              <Medal className="h-8 w-8 animate-pulse text-[#ffd84a]" aria-hidden />
              <div className="font-pixel text-[10px] uppercase tracking-[0.3em]" data-testid="games-loading">
                {!ready ? "Opening the venue…" : `${current ? eventOf(current.event).name : "Athletes"} · warming up… ${Math.round(loaded * 100)}%`}
              </div>
            </div>
          )}

          {/* Top bar. */}
          <div className="rc-ui pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3 sm:p-4">
            <div className="flex min-w-0 items-center gap-2">
              <Link href={GAMES_PATH} className={cn(chip, "px-2.5")} aria-label="Back to the Games" data-testid="games-back">
                <ArrowLeft className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Games</span>
              </Link>
              <button type="button" className={cn(chip, "min-w-0 max-w-[48vw] sm:max-w-none")} onClick={() => setPicker(true)} disabled={!all} data-testid="games-title">
                <span className="truncate">{title}</span>
                {spec.mode === "games" && current && <span className="shrink-0 text-[#ffd84a]">{eventOf(current.event).name}</span>}
              </button>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" className={cn(chip, "px-2.5")} onClick={() => setInfo((v) => !v)} aria-label="How it works" aria-expanded={info} data-testid="games-info-toggle"><Info className="h-4 w-4" aria-hidden /></button>
              <button type="button" className={cn(chip, "px-2.5")} onClick={toggleMute} aria-label={muted ? "Turn the sound on" : "Turn the sound off"} data-testid="games-mute">{muted ? <VolumeX className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}</button>
              <button type="button" className={cn(chip, "px-2.5 sm:px-3")} onClick={() => setView("list")} aria-label="Results list" data-testid="games-list-view"><List className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">List</span></button>
            </div>
          </div>

          <AnimatePresence>
            {info && (
              <motion.div className="rc-ui pointer-events-auto absolute left-3 right-3 top-[3.6rem] z-30 max-h-[70%] overflow-y-auto rounded-xl border border-white/15 bg-[#0b1226]/95 p-4 text-white/85 shadow-2xl backdrop-blur-xl sm:left-4 sm:right-auto sm:w-[32rem]" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} data-testid="games-info-panel" data-rc-scroll>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="font-display text-sm font-bold uppercase tracking-wider text-white">How it works · {eventOf(current?.event ?? event).name}</h2>
                  <button type="button" onClick={() => setInfo(false)} className="rounded p-1 text-white/60 hover:text-white" aria-label="Close"><X className="h-4 w-4" /></button>
                </div>
                <GamesInfo event={current?.event ?? event} compact athletes={spec.mode === "event" ? field : []} rain={spec.rain} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Results (an event) or the medal table (the Games). */}
          {ended && panel && (outcome || table) && (
            <div className="rc-ui rc-results pointer-events-auto absolute inset-x-3 bottom-[7.2rem] z-20 max-h-[min(26rem,calc(100%-14rem))] overflow-y-auto rounded-xl border border-white/15 p-3 text-white shadow-2xl backdrop-blur-xl sm:inset-x-auto sm:bottom-24 sm:right-4 sm:w-[27rem] sm:max-h-[min(31rem,calc(100%-12rem))]" data-testid="games-results" data-rc-scroll>
              <div className="mb-1 flex items-center justify-between gap-2">
                <h2 className="font-display text-sm font-bold uppercase tracking-wider"><Trophy className="mr-1.5 inline h-4 w-4 text-[#ffd84a]" aria-hidden />{table ? "Medal table" : `Results · ${eventOf(event).name}`}</h2>
                <button type="button" onClick={() => setPanel(false)} className="rounded p-1 text-white/60 hover:text-white" aria-label="Hide" data-testid="games-results-close"><X className="h-4 w-4" /></button>
              </div>
              {photo && !table && (
                <figure className="mb-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo} alt="Photo finish: the finish line scanned over time" className="h-24 w-full rounded-md border border-white/15 object-cover sm:h-28" data-testid="games-photo" />
                </figure>
              )}
              {table ? (
                <table data-testid="games-medal-table">
                  <thead><tr><th>#</th><th>Nation</th><th className="text-right">🥇</th><th className="text-right">🥈</th><th className="text-right">🥉</th></tr></thead>
                  <tbody>
                    {table.map((r) => (
                      <tr key={r.nation.id} className={r.rank === 1 ? "win" : undefined} data-testid="games-medal-row">
                        <td className="font-display font-bold">{r.rank}</td>
                        <td className="max-w-[11rem] truncate font-display font-semibold uppercase tracking-wide"><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: r.nation.color }} />{r.nation.name}</td>
                        <td className="text-right font-display font-bold">{r.gold}</td>
                        <td className="text-right">{r.silver}</td>
                        <td className="text-right">{r.bronze}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table>
                  <thead><tr><th>#</th><th>Pokémon</th><th className="text-right">{outcome?.event === "wrestling" ? "" : "Mark"}</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key} className={r.place === 1 ? "win" : undefined} data-testid="games-result-row">
                        <td className="font-display font-bold">{r.place}</td>
                        <td className="max-w-[12rem] truncate font-display font-semibold uppercase tracking-wide">{byKey.get(r.key)?.name ?? r.key}</td>
                        <td className="text-right font-display font-bold">{r.mark}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Bottom actions. */}
          <div className="rc-ui pointer-events-none absolute inset-x-0 bottom-0 z-10 px-3 pb-3 sm:px-5 sm:pb-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {!ended ? (
                  <button type="button" onClick={skip} disabled={phase === "loading"} className="rc-go pointer-events-auto inline-flex h-11 items-center gap-2 rounded-lg px-4 font-display text-sm font-bold uppercase tracking-wider disabled:opacity-50" data-testid="games-skip">
                    <SkipForward className="h-4 w-4" aria-hidden /> <span className="hidden min-[400px]:inline">Results</span>
                  </button>
                ) : (
                  <button type="button" onClick={restart} className="rc-go pointer-events-auto inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-lg px-4 font-display text-sm font-bold uppercase tracking-wider" aria-label="Watch again" data-testid="games-replay">
                    <RotateCcw className="h-4 w-4" aria-hidden /> <span className="hidden min-[420px]:inline">Watch again</span>
                  </button>
                )}
                <button type="button" onClick={() => setPicker(true)} disabled={!all} className={cn(chip, "h-11")} data-testid="games-new">
                  <Users className="h-4 w-4" aria-hidden /> <span className="hidden whitespace-nowrap min-[420px]:inline">{spec.mode === "games" ? "Nations" : "Line-up"}</span>
                </button>
                <button type="button" onClick={again} disabled={!all} className={cn(chip, "h-11 px-3")} aria-label="Another day: new form and reactions" data-testid="games-again">
                  <Dices className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Again</span>
                </button>
                {isSwim && (
                  <button type="button" onClick={toggleRain} aria-pressed={spec.mode === "event" && spec.rain} className={cn(chip, "h-11 px-3", spec.mode === "event" && spec.rain && "border-[#9fd8ff] text-[#9fd8ff]")} aria-label="Rain: Swift Swim doubles Speed" data-testid="games-rain">
                    <CloudRain className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Rain</span>
                  </button>
                )}
                {ended && !panel && (outcome || table) && (
                  <button type="button" onClick={() => setPanel(true)} className={cn(chip, "h-11")} data-testid="games-results-open"><Trophy className="h-4 w-4 text-[#ffd84a]" aria-hidden /></button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={share} className={cn(chip, "h-11 px-3")} aria-label="Share" data-testid="games-share"><Share2 className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Share</span></button>
                <button type="button" onClick={() => setVideoOpen(true)} className={cn(chip, "h-11 border-[#ffd84a]/50 text-white")} disabled={!current || phase === "loading"} data-testid="games-video">
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

          {picker && all && spec.mode === "event" && (
            <GamesPicker all={all} event={spec.event} keys={field.map((a) => a.key)} onRun={runField} onClose={() => setPicker(false)} />
          )}
          {picker && all && spec.mode === "games" && (
            <NationsPicker all={all} specs={spec.nations} onRun={runNations} onClose={() => setPicker(false)} />
          )}
          {videoOpen && (outcome || games) && (
            <Suspense fallback={null}>
              <MakeGamesVideo
                kind={spec.mode === "games" ? "games" : "event"}
                outcome={outcome}
                games={games}
                byKey={byKey}
                title={title}
                slug={spec.mode === "event" ? `${spec.event}-${field.map((a) => a.key).slice(0, 3).join("-")}` : "the-games"}
                link={sharePath()}
                h2h={isH2H}
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

export type { GamesShow };
void Play;
