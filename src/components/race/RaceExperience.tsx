"use client";

import Link from "next/link";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Clapperboard, Flag, Info, List, Minus, Play, Plus, RotateCcw, Share2, SkipForward, Trophy, Volume2, VolumeX, X } from "lucide-react";
import { isMuted, onMuteChange, setMuted } from "@/lib/sound";
import { copyText } from "@/lib/share";
import { fromRow, type Entrant, type EntrantRow } from "@/lib/race/types";
import { PRESET_BY_ID, DEFAULT_PRESET } from "@/lib/race/presets";
import { fieldFor, specFor, type RaceSpec } from "@/lib/race/lineup";
import { makeRace, displayTimes, formatGap, formatTime, leaderAt, spotsAt, type Race } from "@/lib/race/race";
import { excitementAt, photoWindow, planShow, raceTimeAt, shotAt, shotProgress, type Phase, type PhotoFrame, type ShowPlan } from "@/lib/race/broadcast";
import { blendPose, cameraFor, leader as leaderSpot, pack, type CamPose, type Spot, type Vec3 } from "@/lib/race/director";
import { clampZoom, orbitBy, orbitFrom, orbitPose, wheelFactor, zoomBy, zoomFov, type Orbit } from "@/lib/race/orbit";
import { parseDistance, parseSeed, parseVs, presetPath, presetRunPath, vsOk, vsPath } from "@/lib/race/deeplink";
import { X0, type Distance } from "@/lib/race/track";
import type { Quality, RaceScene } from "./scene";
import { RACE_URLS } from "./urls";
import type { RaceAudio } from "./audio";
import { drawClockBug, drawFastForward, drawLaneIntro, drawNameTags, drawPhotoFinish, drawReplayBug, drawStartCall } from "./graphics";
import { RACE_CSS } from "./race-css";
import { RaceInfo } from "./RaceInfo";
import { RacePicker } from "./RacePicker";
import { RaceBracket } from "./RaceBracket";
import { cn } from "@/lib/utils";

const MakeRaceVideo = lazy(() => import("./MakeRaceVideo"));

type Mode = "boot" | "3d" | "list";
export type CamMode = "broadcast" | "headon" | "overhead" | "free";
type UiPhase = Phase | "loading";

let rowsPromise: Promise<Entrant[]> | null = null;
/** Every runner (fetched once per page load; static and cached by the CDN). */
export function loadEntrants(): Promise<Entrant[]> {
  rowsPromise ??= fetch("/api/race")
    .then((r) => {
      if (!r.ok) throw new Error(`race ${r.status}`);
      return r.json() as Promise<EntrantRow[]>;
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

export interface RaceExperienceProps {
  preset: string;
  vs?: string[];
  distance?: Distance | null;
  seed?: number | null;
  children: React.ReactNode;
}

/**
 * /pokedex/race: Pokémon sprint races at night in PokéIQ Stadium, as a
 * broadcast. The crane shot, lane-by-lane introductions, "On your marks…
 * Set…" and the gun; the race from the rail camera, the infield and the
 * head-on telephoto; the slow-motion replay, the photo finish and the
 * results. Then a free camera (drag to orbit, wheel or pinch to zoom).
 * Pick any field, run a preset or the knockout of every Pokémon, share it
 * or make a vertical video. The server-rendered results underneath are the
 * page for search engines, reduced motion and browsers without WebGL.
 */
export function RaceExperience({ preset, vs = [], distance = null, seed = null, children }: RaceExperienceProps) {
  const [mode, setMode] = useState<Mode>("boot");
  const [canGl, setCanGl] = useState(false);
  const [all, setAll] = useState<Entrant[] | null>(null);
  const [spec, setSpec] = useState<RaceSpec>(() => specFor(preset, vs, distance, seed));
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(0);
  const [phase, setPhase] = useState<UiPhase>("loading");
  const [cam, setCam] = useState<CamMode>("broadcast");
  const [muted, setMutedState] = useState(true);
  const [picker, setPicker] = useState(false);
  const [bracket, setBracket] = useState(false);
  const [info, setInfo] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(true);
  const [photo, setPhoto] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [quality, setQualityState] = useState<Quality>("medium");
  const [runId, setRunId] = useState(0);

  const stageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<RaceScene | null>(null);
  const audioRef = useRef<RaceAudio | null>(null);
  const sizeRef = useRef({ w: 1, h: 1 });
  const recordingRef = useRef(false);
  recordingRef.current = recording;
  const quickRef = useRef(false);

  const field = useMemo(() => (all ? fieldFor(spec, all) : null), [all, spec]);
  const race = useMemo<Race | null>(() => (field && field.entrants.length >= 1 ? makeRace(field.entrants, spec.distance) : null), [field, spec.distance]);
  const byKey = useMemo(() => new Map((all ?? []).map((e) => [e.key, e])), [all]);
  const times = useMemo(() => (race ? displayTimes(race) : new Map()), [race]);
  const presetInfo = PRESET_BY_ID.get(spec.preset) ?? DEFAULT_PRESET;
  const custom = spec.vs.length > 0;
  const title = field?.title ?? presetInfo.label;
  const raceLabel = `${spec.distance} m · ${custom ? (title.length <= 24 ? title : "Custom race") : presetInfo.label}`;

  /** Mutable show state, read by the frame loop. */
  const show = useRef({
    plan: null as ShowPlan | null,
    race: null as Race | null,
    t: 0,
    cam: "broadcast" as CamMode,
    zoom: 1,
    orbit: null as Orbit | null,
    autoOrbit: false,
    yaw0: 0,
    heard: -1,
    /** Main-thread time spent in the frame loop (ms), for the perf checks. */
    prof: { n: 0, sum: 0, max: 0 },
    blend: null as { from: CamPose; t0: number; dur: number } | null,
    last: null as CamPose | null,
    phase: "loading" as UiPhase,
    gun: false,
    roar: false,
    beep: false,
    pf: null as ReturnType<RaceScene["photoFinish"]> | null,
    pfImg: null as HTMLCanvasElement | null,
    pfWin: { from: 0, to: 1, top: 0.2, bottom: 0.4 } as PhotoFrame,
    starts: [] as Spot[],
    title: "",
    /** Checks and screenshots can hold the show clock still. */
    frozen: false,
  });

  // ---- Which view.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const params = new URLSearchParams(window.location.search);
    const forced = params.get("view");
    const gl = webglOk();
    setCanGl(gl);
    setMode(forced === "list" || (forced !== "3d" && reduce) || !gl ? "list" : "3d");
    setMutedState(isMuted());
    // ?vs=, ?run=, ?d= and ?seed= on any race page.
    const rawVs = params.get("vs");
    const rawRun = params.get("run");
    const d = parseDistance(params.get("d"));
    const sd = parseSeed(params.get("seed"));
    if ((rawVs && !vs.length) || (rawRun && rawRun !== preset) || (d && d !== distance) || (sd && sd !== seed)) {
      void loadEntrants().then((list) => {
        const keys = parseVs(rawVs, (k) => list.some((e) => e.key === k));
        const p = rawRun && PRESET_BY_ID.has(rawRun) ? rawRun : preset;
        setSpec(specFor(p, vsOk(keys.length) ? keys : vs, d ?? distance, sd ?? seed));
      }).catch(() => undefined);
    }
    return onMuteChange(setMutedState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mode === "list") return;
    window.scrollTo(0, 0);
    document.documentElement.classList.add("rc-locked");
    return () => document.documentElement.classList.remove("rc-locked");
  }, [mode]);

  // ---- Data.
  useEffect(() => {
    if (mode !== "3d" || all) return;
    let alive = true;
    loadEntrants().then((list) => alive && setAll(list), () => alive && setMode("list"));
    return () => { alive = false; };
  }, [mode, all]);

  // ---- Sound: built on the first press or key, started inside that gesture.
  useEffect(() => {
    if (mode !== "3d") return;
    let alive = true;
    const onGesture = () => {
      if (audioRef.current) { audioRef.current.gesture(); return; }
      void import("./audio").then(({ createRaceAudio }) => {
        if (!alive || audioRef.current) return;
        audioRef.current = createRaceAudio();
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

  // ---- The scene (three.js loads only here).
  useEffect(() => {
    if (mode !== "3d" || !all || !hostRef.current) return;
    let alive = true;
    const host = hostRef.current;
    const font = getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim() || "sans-serif";
    import("./scene").then(async ({ createRaceScene }) => {
      if (!alive) return;
      try {
        await document.fonts?.load(`700 40px ${font}`).catch(() => undefined);
        const q = qualityParam() ?? initialQuality();
        const scene = createRaceScene(host, { quality: q, urls: RACE_URLS, font });
        sceneRef.current = scene;
        setQualityState(q);
        await scene.ready;
        if (alive) setReady(true);
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
  }, [mode, all]);

  // ---- A race: load its runners, then start the broadcast.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!ready || !scene || !race) return;
    const ac = new AbortController();
    const s = show.current;
    s.phase = "loading";
    setPhase("loading");
    setLoaded(0);
    setPhoto(null);
    setResultsOpen(true);
    scene.setRace(race, ac.signal, setLoaded).then(() => {
      if (ac.signal.aborted) return;
      s.race = race;
      s.plan = planShow(race, { quick: quickRef.current });
      quickRef.current = false;
      s.t = 0;
      s.gun = s.roar = s.beep = false;
      s.pf = null;
      s.pfImg = null;
      s.pfWin = photoWindow(race);
      s.starts = spotsAt(race, 0);
      s.blend = null;
      s.autoOrbit = false;
      if (s.cam === "free") s.orbit = null;
      s.phase = s.plan.shots[0].phase;
      setPhase(s.phase);
    }).catch(() => undefined);
    return () => ac.abort();
  }, [ready, race, runId]);

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

  const setCamMode = useCallback((m: CamMode) => {
    const s = show.current;
    if (s.last) s.blend = { from: s.last, t0: performance.now() / 1000, dur: 0.55 };
    if (m === "free" && s.last) s.orbit = orbitFrom(s.last);
    if (m !== "free") s.zoom = 1;
    s.autoOrbit = false;
    s.cam = m;
    setCam(m);
  }, []);

  // ---- The frame loop: the director (or the free camera), the scene, the graphics.
  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    let last = performance.now();
    let ftEma = FRAME_BUDGET_MS, slowFor = 0, fastFor = 0, warm = 0;
    const font = getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim() || "sans-serif";
    let lastPhase: UiPhase = "loading";
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const scene = sceneRef.current;
      const s = show.current;
      const now = performance.now();
      const raw = now - last;
      last = now;
      if (!scene || recordingRef.current) return;
      try { frame(scene, now, raw); } finally {
        const ms = performance.now() - now;
        s.prof.n++;
        s.prof.sum += ms;
        s.prof.max = Math.max(s.prof.max, ms);
      }
    };
    const frame = (scene: RaceScene, now: number, raw: number) => {
      const s = show.current;
      const dt = Math.min(0.1, raw / 1000);
      const { w, h } = sizeRef.current;
      const race = s.race, plan = s.plan;
      if (!race || !plan || s.phase === "loading") {
        // Before the runners are in: a slow crane over the empty stadium.
        const a = now / 1000;
        scene.frame({ raceT: 0, showT: a, pose: { pos: [Math.sin(a * 0.05) * 140, 70, Math.cos(a * 0.05) * 140], target: [0, 0, 0], fov: w / h < 0.8 ? 62 : 44 }, pre: "idle", excitement: 0.3, clock: "0.00", replay: 0, screen: null });
        clearOverlay();
        return;
      }
      if (!s.frozen) s.t += dt;
      const t = s.t;
      const shot = shotAt(plan, t);
      const atEnd = t >= plan.end;
      const ph: Phase = atEnd ? "results" : shot.phase;
      if (ph !== lastPhase) {
        lastPhase = ph;
        s.phase = ph;
        setPhase(ph);
        if (ph === "results" && s.cam === "broadcast" && s.last) {
          // Hand over to the free camera: a slow drift over the run-out until it's touched.
          const sp = spotsAt(race, raceTimeAt(plan, t));
          s.orbit = orbitFrom(cameraFor("results", 0, sp, { distance: race.distance, aspect: w / h, starts: s.starts }));
          s.yaw0 = s.orbit.yaw;
          s.blend = { from: s.last, t0: now / 1000, dur: 1.6 };
          s.cam = "free";
          s.autoOrbit = true;
          setCam("free");
        }
      }
      const raceT = raceTimeAt(plan, t);
      const spots = spotsAt(race, raceT);
      const aspect = w / h;
      const ctx = { distance: race.distance, aspect, lane: shot.lane, starts: s.starts };
      // The camera.
      let pose: CamPose;
      if (s.cam === "broadcast") {
        pose = cameraFor(atEnd ? "results" : shot.camera, atEnd ? Math.min(1, (t - plan.end) / 20) : shotProgress(shot, t), spots, ctx);
        pose = { ...pose, fov: zoomFov(pose.fov, s.zoom) };
      } else if (s.cam === "headon") {
        const l = leaderSpot(spots);
        if (race.distance === 100 || l.x > -X0 || l.z > 0) pose = cameraFor("headon", 0, spots, ctx);
        else {
          const c = pack(spots, 10);
          const cx = c.reduce((a, b) => a + b.x, 0) / c.length, cz = c.reduce((a, b) => a + b.z, 0) / c.length;
          pose = { pos: [l.x + l.dx * 26, 1.6, l.z + l.dz * 26], target: [cx, 0.6, cz], fov: 22 };
        }
        pose = { ...pose, fov: zoomFov(pose.fov, s.zoom) };
      } else if (s.cam === "overhead") {
        const c = pack(spots, 12);
        const cx = c.reduce((a, b) => a + b.x, 0) / c.length, cz = c.reduce((a, b) => a + b.z, 0) / c.length;
        const height = 46 / s.zoom + 6;
        pose = { pos: [cx - 0.01, height, cz + height * 0.18], target: [cx, 0, cz], fov: aspect < 0.8 ? 60 : 42 };
      } else {
        if (!s.orbit) s.orbit = orbitFrom(s.last ?? cameraFor("marks", 0, spots, ctx));
        // The free camera follows the pack during the race; afterwards it stays put (and drifts until you touch it).
        if (raceT > 0 && raceT < race.last + 2 && !atEnd) {
          const c = pack(spots, 10);
          const tx = c.reduce((a, b) => a + b.x, 0) / c.length, tz = c.reduce((a, b) => a + b.z, 0) / c.length;
          const k = 1 - Math.exp(-dt * 4);
          const tg = s.orbit.target;
          s.orbit = { ...s.orbit, target: [tg[0] + (tx - tg[0]) * k, tg[1] + (0.6 - tg[1]) * k, tg[2] + (tz - tg[2]) * k] as Vec3 };
        }
        // An idle drift (back and forth, so it never wanders into the stands) until the camera is touched.
        if (s.autoOrbit) s.orbit = { ...s.orbit, yaw: s.yaw0 + 0.22 * Math.sin((t - plan.end) * 0.16) };
        pose = orbitPose(s.orbit);
      }
      if (s.blend) {
        const k = (now / 1000 - s.blend.t0) / s.blend.dur;
        if (k >= 1) s.blend = null;
        else pose = blendPose(s.blend.from, pose, k);
      }
      s.last = pose;
      const pre = ph === "marks" ? "marks" : ph === "set" ? "set" : raceT > 0 ? "race" : "idle";
      const excitement = excitementAt(plan, race, Math.min(t, plan.end - 0.01));
      const clock = raceT <= 0 ? "0.00" : formatTime(Math.min(raceT, race.first), raceT < race.first ? (raceT < 10 ? 2 : 1) : 2);
      const lead = leaderAt(race, raceT);
      const screen = raceT > 0 && raceT < race.last + 1.5 ? cameraFor("chase", 0.5, spots, { ...ctx, aspect: 16 / 9, lane: lead.lane }) : ph === "intro" ? cameraFor("intro", shotProgress(shot, t), spots, { ...ctx, aspect: 16 / 9 }) : null;
      const steps = scene.frame({ raceT, showT: t, pose, pre, excitement, clock, replay: ph === "replay" ? 1 : 0, screen, focus: ph === "intro" && s.cam === "broadcast" ? shot.lane : undefined });
      // Sound.
      const au = audioRef.current;
      if (au) {
        if (Math.abs(excitement - s.heard) > 0.015) { s.heard = excitement; au.crowd(excitement); }
        for (const st of steps) au.footfall(st.kg, st.dist);
      }
      if (!s.gun && raceT > 0 && ph !== "replay") { s.gun = true; au?.gun(); }
      if (!s.roar && raceT >= race.first && ph !== "replay") {
        s.roar = true;
        au?.roar();
        const w = race.order[0];
        scene.setCard(`${w.entrant.name} wins`, `${formatTime(w.time)} s · ${race.distance} m`);
      }
      // Photo finish: developed during the replay, a few columns a frame.
      if ((ph === "replay" || ph === "photo" || ph === "results") && !s.pfImg) {
        s.pf ??= scene.photoFinish(s.pfWin);
        if (s.pf.step()) {
          s.pfImg = s.pf.result();
          if (s.pfImg) setPhoto(s.pfImg.toDataURL("image/png"));
        }
      }
      if (ph === "photo" && !s.beep) { s.beep = true; au?.beep(); }
      drawOverlay(ph, t, raceT, shot.rate, shot.lane, font);
      // Adaptive quality, both ways.
      if (warm < 30 || raw > 400) warm++;
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

    const clearOverlay = () => {
      const cv = overlayRef.current;
      if (!cv) return;
      const g = cv.getContext("2d")!;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, cv.width, cv.height);
    };

    const drawOverlay = (ph: Phase, t: number, raceT: number, rate: number, lane: number | undefined, font: string) => {
      const cv = overlayRef.current;
      const scene = sceneRef.current;
      const s = show.current;
      const race = s.race;
      if (!cv || !scene || !race || !s.plan) return;
      const g = cv.getContext("2d")!;
      const { w, h } = sizeRef.current;
      const dpr = cv.width / w;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, cv.width, cv.height);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const phone = w < 640;
      const o = { font, scale: phone ? 1 : 1.1 };
      // Under the top bar (and, on phones, under the camera presets).
      const top = phone ? 104 : 76;
      const bottom = phone ? 132 : 96;
      const shot = shotAt(s.plan, t);
      const k = shotProgress(shot, t);
      if (ph === "crane") {
        const a = Math.min(1, k * 3, (1 - k) * 5);
        g.save();
        g.globalAlpha = Math.max(0, a);
        g.textAlign = "center";
        g.textBaseline = "middle";
        const big = Math.min(w * 0.09, 64);
        const fill = g.createLinearGradient(0, h * 0.4 - big, 0, h * 0.4 + big);
        fill.addColorStop(0, "#fff27a");
        fill.addColorStop(1, "#ffb000");
        g.font = `800 ${big}px ${font}`;
        const words = s.title.toUpperCase();
        const px = Math.min(big, (big * w * 0.9) / Math.max(1, g.measureText(words).width));
        g.font = `800 ${px}px ${font}`;
        g.lineJoin = "round";
        g.strokeStyle = "#0d1626";
        g.lineWidth = px * 0.18;
        g.strokeText(words, w / 2, h * 0.36);
        g.fillStyle = fill;
        g.fillText(words, w / 2, h * 0.36);
        g.font = `800 ${Math.min(w * 0.04, 22)}px ${font}`;
        g.fillStyle = "#9fd8ff";
        g.fillText(`${race.distance} M · POKÉIQ STADIUM`, w / 2, h * 0.36 + px * 0.95);
        g.restore();
      } else if (ph === "intro" && lane != null) {
        const r = race.lanes.find((x) => x.lane === lane);
        if (r) drawLaneIntro(g, w, h, r, k, { ...o, bottom });
      } else if (ph === "marks" || ph === "set") {
        drawStartCall(g, w, h, ph === "marks" ? "ON YOUR MARKS" : "SET", k, o);
      }
      if (ph === "race" || ph === "fast") {
        const lead = leaderAt(race, raceT);
        const st = lead.profile ? raceT : 0;
        void st;
        drawClockBug(g, w, h, { ...o, top, title: raceLabel, time: formatTime(Math.min(raceT, race.first), 2), leader: raceT < race.first ? { name: lead.entrant.name, v: Math.max(0, lead.profile ? spotsAt(race, raceT).find((x) => x.lane === lead.lane)?.v ?? 0 : 0) } : null, live: raceT < race.first });
        if (ph === "fast") {
          const r = race.lanes.find((x) => x.lane === shot.lane);
          const caption = r ? (raceT > race.first ? `Meanwhile, ${r.entrant.name}…` : `${r.entrant.name} leads`) : "";
          drawFastForward(g, w, h, rate, caption, { ...o, top: top + (phone ? 70 : 84) });
        }
        // Name tags while the runners are big enough on screen.
        if (s.cam !== "overhead") {
          const heads = scene.heads().filter((a) => a.visible && a.by - a.y > 20);
          if (heads.length) {
            drawNameTags(g, heads.map((a) => {
              const r = race.lanes.find((x) => x.lane === a.lane)!;
              return { lane: a.lane, name: r.entrant.name, x: a.x, y: a.y, lead: r.lane === lead.lane };
            }), { ...o, scale: phone ? 0.85 : 1 });
          }
        }
        if (raceT >= race.first && raceT < race.first + 3) {
          const win = race.order[0];
          g.save();
          g.globalAlpha = Math.min(1, (raceT - race.first) * 3);
          drawStartCall(g, w, h, `${win.entrant.name.toUpperCase()} ${formatTime(win.time)}`, 0.5, { ...o, scale: o.scale * 0.8 });
          g.restore();
        }
      } else if (ph === "replay") {
        drawReplayBug(g, w, h, { ...o, top });
      } else if (ph === "photo") {
        if (s.pfImg) drawPhotoFinish(g, w, h, s.pfImg, race, s.pfWin, k, { ...o, top, bottom });
        else drawStartCall(g, w, h, "PHOTO FINISH…", 0.5, o);
      }
    };

    raf = requestAnimationFrame(tick);
    // For automated checks and screenshots: jump the show clock, read where it is.
    (window as unknown as { __race?: unknown }).__race = {
      seek(t: number, freeze = false) { show.current.t = t; show.current.frozen = freeze; },
      state() {
        const s = show.current;
        return { t: s.t, phase: s.phase, gun: s.plan?.gun ?? null, end: s.plan?.end ?? null, shots: s.plan?.shots.map((x) => [x.phase, x.camera, x.t0, x.t1]) ?? [], quality: sceneRef.current?.quality ?? null, stats: sceneRef.current?.stats() ?? null, camera: { mode: s.cam, fov: s.last?.fov ?? null, pos: s.last?.pos ?? null, dist: s.orbit?.dist ?? null, zoom: s.zoom }, prof: { ...s.prof } };
      },
    };
    return () => cancelAnimationFrame(raf);
  }, [ready, raceLabel]);

  useEffect(() => { show.current.title = field?.title ?? ""; }, [field]);
  useEffect(() => { if (stageRef.current) stageRef.current.dataset.q = quality; }, [quality]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- Input: drag to orbit, wheel / pinch / gesture to zoom, keys.
  const zoom = useCallback((factor: number) => {
    const s = show.current;
    s.autoOrbit = false;
    if (s.cam === "free") {
      if (!s.orbit && s.last) s.orbit = orbitFrom(s.last);
      if (s.orbit) s.orbit = zoomBy(s.orbit, factor);
    } else {
      s.zoom = clampZoom(s.zoom * factor);
    }
  }, []);

  useEffect(() => {
    if (!ready || !hostRef.current) return;
    const host = hostRef.current;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch0 = 0;
    const toFree = () => {
      const s = show.current;
      if (s.cam !== "free") {
        if (s.last) s.orbit = orbitFrom(s.last);
        s.cam = "free";
        s.blend = null;
        setCam("free");
      }
      s.autoOrbit = false;
    };
    const down = (e: PointerEvent) => {
      if (recordingRef.current) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { host.setPointerCapture(e.pointerId); } catch { /* a synthetic or already-released pointer */ }
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const move = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch0 > 0 && d > 0) zoom(d / pinch0);
        pinch0 = d;
        return;
      }
      if (Math.abs(dx) + Math.abs(dy) < 0.5) return;
      toFree();
      const s = show.current;
      if (s.orbit) s.orbit = orbitBy(s.orbit, dx, dy, sizeRef.current.h);
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch0 = 0;
    };
    const wheel = (e: WheelEvent) => {
      if (recordingRef.current) return;
      e.preventDefault();
      zoom(wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey));
    };
    // Safari's trackpad pinch.
    let gs = 1;
    const gStart = (e: Event) => { e.preventDefault(); gs = (e as unknown as { scale: number }).scale || 1; };
    const gChange = (e: Event) => {
      e.preventDefault();
      const sc = (e as unknown as { scale: number }).scale || 1;
      zoom(sc / gs);
      gs = sc;
    };
    host.addEventListener("pointerdown", down);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerup", up);
    host.addEventListener("pointercancel", up);
    host.addEventListener("wheel", wheel, { passive: false });
    host.addEventListener("gesturestart", gStart as EventListener, { passive: false } as AddEventListenerOptions);
    host.addEventListener("gesturechange", gChange as EventListener, { passive: false } as AddEventListenerOptions);
    return () => {
      host.removeEventListener("pointerdown", down);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerup", up);
      host.removeEventListener("pointercancel", up);
      host.removeEventListener("wheel", wheel);
      host.removeEventListener("gesturestart", gStart as EventListener);
      host.removeEventListener("gesturechange", gChange as EventListener);
    };
  }, [ready, zoom]);

  const skipIntro = useCallback(() => {
    const s = show.current;
    if (!s.plan) return;
    const marks = s.plan.shots.find((x) => x.phase === "marks");
    if (marks && s.t < marks.t0) s.t = marks.t0;
  }, []);

  const replay = useCallback((quick: boolean) => {
    const s = show.current;
    if (!s.plan || !s.race) return;
    if (quick) {
      s.plan = planShow(s.race, { quick: true });
    } else {
      s.plan = planShow(s.race);
    }
    s.t = 0;
    s.gun = s.roar = s.beep = false;
    s.phase = s.plan.shots[0].phase;
    setPhase(s.phase);
    setResultsOpen(true);
    if (s.cam === "free") { s.cam = "broadcast"; setCam("broadcast"); s.zoom = 1; }
  }, []);

  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.metaKey || e.ctrlKey || recordingRef.current || videoOpen || picker || bracket) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const s = show.current;
      if (e.key === "+" || e.key === "=") { e.preventDefault(); zoom(1.2); }
      else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoom(1 / 1.2); }
      else if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        if (s.cam !== "free") { if (s.last) s.orbit = orbitFrom(s.last); s.cam = "free"; setCam("free"); }
        if (s.orbit) s.orbit = orbitBy(s.orbit, e.key === "ArrowLeft" ? -40 : e.key === "ArrowRight" ? 40 : 0, e.key === "ArrowUp" ? 30 : e.key === "ArrowDown" ? -30 : 0, sizeRef.current.h);
        s.autoOrbit = false;
      } else if (e.key === "Escape") { setInfo(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, zoom, videoOpen, picker, bracket]);

  // ---- Races and links.
  const replaceUrl = (path: string) => {
    try { history.replaceState(history.state, "", path); } catch { /* ignore */ }
  };
  const sharePath = () => (custom ? vsPath(spec.vs, spec.distance) : spec.distance !== presetInfo.distance || (presetInfo.tournament && spec.seed !== 2026) ? presetRunPath(spec.preset, spec.distance, presetInfo.tournament ? spec.seed : undefined) : presetPath(spec.preset));

  const runCustom = (keys: string[], d: Distance) => {
    setPicker(false);
    setSpec((s) => ({ ...s, vs: keys, distance: d }));
    replaceUrl(vsPath(keys, d));
  };
  const runPreset = (id: string, d?: Distance) => {
    setPicker(false);
    setBracket(false);
    const next = specFor(id, [], d, spec.seed);
    setSpec(next);
    replaceUrl(d && d !== next.distance ? presetRunPath(id, d) : presetPath(id));
  };
  const redraw = () => {
    const seed = Math.floor(Math.random() * 1e6);
    setSpec((s) => ({ ...s, seed }));
    replaceUrl(presetRunPath(spec.preset, spec.distance, seed));
  };

  const share = async () => {
    const url = `${window.location.origin}${sharePath()}`;
    const winner = race?.order[0];
    const text = winner ? `${title}: ${winner.entrant.name} wins in ${formatTime(winner.time)}` : title;
    if (typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
      try { await navigator.share({ title: "PokéIQ Race", text, url }); return; } catch { /* closed: copy instead */ }
    }
    if (await copyText(url)) setToast("Link copied");
  };

  const toggleMute = () => {
    const next = !isMuted();
    setMuted(next);
    setMutedState(next);
    if (!next) audioRef.current?.gesture();
  };

  const chip = "rc-chip pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-md border border-white/15 bg-[#0b1226]/75 px-3 font-display text-[11px] font-semibold uppercase tracking-[0.12em] text-white/85 backdrop-blur-md transition-colors hover:border-white/35 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffd84a] disabled:opacity-50";
  const pre = phase === "crane" || phase === "intro";
  const after = phase === "results";

  return (
    <>
      <style>{RACE_CSS}</style>
      <noscript><style>{`.rc-stage{display:none!important}`}</style></noscript>
      <div>
        {mode === "list" && canGl && (
          <div className="mb-4 flex justify-end">
            <button type="button" onClick={() => setMode("3d")} className="rounded-md border bg-card px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:border-screen/60 hover:text-foreground" data-testid="race-3d-view">
              Watch it in 3D
            </button>
          </div>
        )}
        {children}
      </div>
      {mode !== "list" && (
        <div
          ref={stageRef}
          className="rc-stage fixed left-0 !mt-0 w-screen bottom-[calc(3.5rem+env(safe-area-inset-bottom))] top-14 z-40 overflow-hidden lg:bottom-0"
          data-testid="race-stage"
          data-ready={ready ? "1" : "0"}
          data-phase={phase}
          data-cam={cam}
          data-count={race?.lanes.length ?? 0}
          data-distance={spec.distance}
          data-winner={race?.order[0]?.entrant.key ?? ""}
          data-photo={photo ? "1" : "0"}
          data-recording={recording ? "1" : "0"}
        >
          <div ref={hostRef} className="rc-host absolute inset-0 cursor-grab touch-none select-none active:cursor-grabbing" data-testid="race-scene" role="application" aria-label="A Pokémon race in 3D. Drag to orbit the camera, scroll or pinch to zoom." />
          <canvas ref={overlayRef} className="rc-overlay h-full w-full" aria-hidden />
          <div className="rc-shade-top" aria-hidden />
          <div className="rc-shade-bottom" aria-hidden />

          {(!ready || phase === "loading") && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-white" aria-live="polite">
              <Flag className="h-8 w-8 animate-pulse text-[#ffd84a]" aria-hidden />
              <div className="font-pixel text-[10px] uppercase tracking-[0.3em]" data-testid="race-loading">
                {!ready ? "Building PokéIQ Stadium…" : `Runners warming up… ${Math.round(loaded * (race?.lanes.length ?? 0))}/${race?.lanes.length ?? 0}`}
              </div>
            </div>
          )}

          {/* Top bar. */}
          <div className="rc-ui pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3 sm:p-4">
            <div className="flex min-w-0 items-center gap-2">
              <Link href="/pokedex" className={cn(chip, "px-2.5")} aria-label="Back to the Pokédex" data-testid="race-back">
                <ArrowLeft className="h-4 w-4" aria-hidden />
              </Link>
              <button type="button" className={cn(chip, "min-w-0 max-w-[44vw] sm:max-w-none")} onClick={() => setPicker(true)} disabled={!all} data-testid="race-title">
                <span className="truncate">{title}</span>
                <span className="shrink-0 text-[#ffd84a]">{spec.distance} m</span>
              </button>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" className={cn(chip, "px-2.5")} onClick={() => setInfo((v) => !v)} aria-label="How the race works" aria-expanded={info} data-testid="race-info-toggle">
                <Info className="h-4 w-4" aria-hidden />
              </button>
              <button type="button" className={cn(chip, "px-2.5")} onClick={toggleMute} aria-label={muted ? "Turn the sound on" : "Turn the sound off"} data-testid="race-mute">
                {muted ? <VolumeX className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
              </button>
              <button type="button" className={cn(chip, "px-2.5 sm:px-3")} onClick={() => setMode("list")} aria-label="Results list" data-testid="race-list-view">
                <List className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">List</span>
              </button>
            </div>
          </div>

          {/* Camera: presets and zoom (always available). */}
          <div className="rc-ui pointer-events-none absolute right-3 top-[3.6rem] z-10 flex flex-col items-end gap-2 sm:right-4 sm:top-[4.1rem]">
            <div className="rc-seg pointer-events-auto flex overflow-hidden rounded-md border border-white/15 bg-[#0b1226]/75 backdrop-blur-md" role="group" aria-label="Camera">
              {(["broadcast", "headon", "overhead", "free"] as CamMode[]).map((m) => (
                <button key={m} type="button" aria-pressed={cam === m} onClick={() => setCamMode(m)} className="border-l border-white/10 px-2 py-1.5 font-display text-[10px] font-semibold uppercase tracking-wider text-white/75 first:border-l-0 hover:text-white sm:px-2.5 sm:text-[11px]" data-testid={`race-cam-${m}`}>
                  {m === "headon" ? "Head-on" : m[0].toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
            <div className="pointer-events-auto flex flex-col overflow-hidden rounded-md border border-white/15 bg-[#0b1226]/75 backdrop-blur-md">
              <button type="button" onClick={() => zoom(1.25)} className="p-2 text-white/80 hover:text-white" aria-label="Zoom in" data-testid="race-zoom-in"><Plus className="h-4 w-4" /></button>
              <button type="button" onClick={() => zoom(0.8)} className="border-t border-white/10 p-2 text-white/80 hover:text-white" aria-label="Zoom out" data-testid="race-zoom-out"><Minus className="h-4 w-4" /></button>
            </div>
          </div>

          {/* How it works. */}
          <AnimatePresence>
            {info && (
              <motion.div className="rc-ui pointer-events-auto absolute left-3 right-3 top-[3.6rem] z-30 max-h-[70%] overflow-y-auto rounded-xl border border-white/15 bg-[#0b1226]/95 p-4 text-white/85 shadow-2xl backdrop-blur-xl sm:left-4 sm:right-auto sm:w-[30rem]" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} data-testid="race-info-panel">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="font-display text-sm font-bold uppercase tracking-wider text-white">How the race works</h2>
                  <button type="button" onClick={() => setInfo(false)} className="rounded p-1 text-white/60 hover:text-white" aria-label="Close"><X className="h-4 w-4" /></button>
                </div>
                <RaceInfo compact />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Results. */}
          {after && race && resultsOpen && (
            <div className="rc-ui pointer-events-auto absolute inset-x-3 bottom-[7.2rem] z-20 max-h-[min(26rem,calc(100%-12rem))] overflow-y-auto rounded-xl border border-white/15 p-3 text-white shadow-2xl backdrop-blur-xl sm:inset-x-auto sm:bottom-24 sm:right-4 sm:w-[27rem] rc-results" data-testid="race-results">
              <div className="mb-1 flex items-center justify-between gap-2">
                <h2 className="font-display text-sm font-bold uppercase tracking-wider"><Trophy className="mr-1.5 inline h-4 w-4 text-[#ffd84a]" aria-hidden />Results · {spec.distance} m</h2>
                <button type="button" onClick={() => setResultsOpen(false)} className="rounded p-1 text-white/60 hover:text-white" aria-label="Hide the results" data-testid="race-results-close"><X className="h-4 w-4" /></button>
              </div>
              {photo && (
                <figure className="mb-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo} alt="Photo finish: the finish line scanned over time" className="h-24 w-full rounded-md border border-white/15 object-cover sm:h-28" data-testid="race-photo" />
                  <figcaption className="mt-1 text-[11px] text-white/50">Photo finish: the line scanned over time, left to right.</figcaption>
                </figure>
              )}
              <table>
                <thead><tr><th>#</th><th>Lane</th><th>Pokémon</th><th className="text-right">Time</th><th className="text-right">Gap</th><th className="text-right">Spe</th></tr></thead>
                <tbody>
                  {race.order.map((r) => (
                    <tr key={r.lane} className={r.place === 1 ? "win" : undefined} data-testid="race-result-row">
                      <td className="font-display font-bold">{r.place}</td>
                      <td className="text-white/60">{r.lane}</td>
                      <td className="max-w-[9rem] truncate font-display font-semibold uppercase tracking-wide">{r.entrant.name}</td>
                      <td className="text-right font-display font-bold">{times.get(r)}</td>
                      <td className="text-right text-white/55">{formatGap(r.gap)}</td>
                      <td className="text-right text-[#9fd8ff]">{r.entrant.stats.spe}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Bottom actions. */}
          <div className="rc-ui pointer-events-none absolute inset-x-0 bottom-0 z-10 px-3 pb-3 sm:px-5 sm:pb-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {pre ? (
                  <button type="button" onClick={skipIntro} className="rc-go pointer-events-auto inline-flex h-11 items-center gap-2 rounded-lg px-4 font-display text-sm font-bold uppercase tracking-wider" data-testid="race-skip">
                    <SkipForward className="h-4 w-4" aria-hidden /> <span className="hidden min-[400px]:inline">To the start</span><span className="min-[400px]:hidden">Start</span>
                  </button>
                ) : (
                  <button type="button" onClick={() => replay(!after)} disabled={phase === "loading"} className="rc-go pointer-events-auto inline-flex h-11 items-center gap-2 rounded-lg px-4 font-display text-sm font-bold uppercase tracking-wider disabled:opacity-50" data-testid="race-replay">
                    {after ? <RotateCcw className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4 fill-current" aria-hidden />}
                    {after ? "Watch again" : "Restart"}
                  </button>
                )}
                <button type="button" onClick={() => setPicker(true)} disabled={!all} className={cn(chip, "h-11")} data-testid="race-new">
                  <Flag className="h-4 w-4" aria-hidden /> <span className="hidden whitespace-nowrap min-[420px]:inline">New race</span>
                </button>
                {field?.tournament && (
                  <button type="button" onClick={() => setBracket(true)} className={cn(chip, "h-11")} data-testid="race-bracket-open">
                    <Trophy className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Bracket</span>
                  </button>
                )}
                {after && !resultsOpen && (
                  <button type="button" onClick={() => setResultsOpen(true)} className={cn(chip, "h-11")} data-testid="race-results-open">
                    <Trophy className="h-4 w-4 text-[#ffd84a]" aria-hidden /> <span className="hidden sm:inline">Results</span>
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={share} className={cn(chip, "h-11 px-3")} aria-label="Share" data-testid="race-share">
                  <Share2 className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Share</span>
                </button>
                <button type="button" onClick={() => setVideoOpen(true)} className={cn(chip, "h-11 border-[#ffd84a]/50 text-white")} disabled={!race || phase === "loading"} data-testid="race-video">
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

          {picker && all && (
            <RacePicker all={all} keys={spec.vs.length >= 2 ? spec.vs : (field?.entrants ?? []).map((e) => e.key)} distance={spec.distance} onRun={runCustom} onPreset={runPreset} onClose={() => setPicker(false)} />
          )}
          {bracket && field?.tournament && (
            <RaceBracket t={field.tournament} byKey={byKey} onClose={() => setBracket(false)} onWatchFinal={() => { setBracket(false); quickRef.current = false; setRunId((x) => x + 1); }} onRedraw={redraw} />
          )}
          {videoOpen && race && field && (
            <Suspense fallback={null}>
              <MakeRaceVideo race={race} hook={field.hook} title={title} slug={custom ? spec.vs.join("-vs-") : spec.preset} link={sharePath()} onRecording={setRecording} onClose={() => setVideoOpen(false)} />
            </Suspense>
          )}
        </div>
      )}
    </>
  );
}
