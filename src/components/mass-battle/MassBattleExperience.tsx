"use client";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { track } from "@vercel/analytics";
import { Camera, Clapperboard, Expand, Info, Loader2, Minus, Pause, Play, Plus, RotateCcw, Share2, Swords, Trophy, Volume2, VolumeX, X } from "lucide-react";
import { Director, type Pose } from "@/lib/mass-battle/director";
import { EV, SPREAD_REACH } from "@/lib/mass-battle/constants";
import { bossDownLine, critLine, fmt, multiKoLine, noAnswerText, possessive, questionText, resultLine, resultTitle, sideName as armyLabel, spreadText, winRateText } from "@/lib/mass-battle/copy";
import { figureSize } from "@/lib/mass-battle/stats";
import { encodeBattle, encodePlayback, encodeQuestion, MASS_BATTLE_PATH, newSeed, questionKey, questionSpec, runsOf, thresholdOf, type SlugIndex } from "@/lib/mass-battle/share";
import { expandQuestion, expandSpec } from "@/lib/mass-battle/sets";
import { SOLVER, solve } from "@/lib/mass-battle/solver";
import type { BattleSpec, MBSpecies, PlaybackSpec, Question, Winner } from "@/lib/mass-battle/types";
import type { SimEnd } from "./protocol";
import { sliceRoster, specIds, questionIds } from "./protocol";
import { getRoster } from "./roster-client";
import { BattleView, summarize, type Hit } from "./view";
import { SimClient, SolverPool } from "./workers";
import { createBattleAudio, type BattleAudio } from "./audio";
import { MB_CSS } from "./mass-battle-css";
import type { BattleScene, Quality } from "./scene";
import { HowItWorksBody } from "./HowItWorks";
import { factsOfRow, SetupPanel } from "./SetupPanel";
import type { PickerMon } from "./PokemonPicker";
import { isMuted, onMuteChange, setMuted } from "@/lib/sound";
import { cn } from "@/lib/utils";

const MakeBattleVideo = lazy(() => import("./MakeBattleVideo"));

type Phase = "idle" | "solving" | "deploying" | "ready" | "playing" | "done" | "error";

export interface PresetCard {
  id: string;
  kind: "howmany" | "battle";
  title: string;
  hook: string;
  blurb: string;
  spec: BattleSpec;
  question: Question | null;
  answer: { n: number; spread: number; wins: number; runs: number; seed: number } | null;
  /** Names for the two sides on presets with many species. */
  labels: [string, string] | null;
}

export type Initial = { kind: "preset"; id: string } | { kind: "battle"; spec: BattleSpec } | { kind: "question"; q: Question } | null;

/** What's on the field. */
export interface BattleDesc {
  /** What the simulation plays (groups spelled out). */
  spec: BattleSpec;
  /** The battle as set up (with its groups), for links and the setup panel; `spec` when left out. */
  source?: BattleSpec;
  /** How it's shown (speed, camera, slow motion, damage numbers, HUD), for the live view and the video. */
  playback?: PlaybackSpec;
  names: [string, string];
  hook: string;
  /** A "how many?" answer battle: its question and answer. */
  question: Question | null;
  answer: { n: number; spread: number; wins: number; runs: number } | null;
  presetId: string | null;
  /** A fixed battle's "how many?" answer for its matchup, shown with the result. */
  bonus?: { question: Question; answer: { n: number; spread: number; wins: number; runs: number; seed: number } } | null;
}

interface FeedItem {
  id: number;
  text: string;
  tone: "a" | "b" | "gold";
}

interface Hud {
  left: [number, number];
  start: [number, number];
  boss: { name: string; hp: number; max: number; side: 0 | 1 } | null;
  t: number;
  shot: string;
}

interface Final {
  winner: Winner;
  title: string;
  line: string;
  mvp: string | null;
  big: string | null;
  seconds: number;
}

/** Phones, touch screens and low-memory devices start light; everything else on the middle quality. The monitor adapts from there. */
function initialQuality(): Quality {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const short = Math.min(window.screen.width, window.screen.height);
  if (window.matchMedia("(pointer: coarse)").matches || short < 600 || (nav.deviceMemory !== undefined && nav.deviceMemory <= 4)) return "low";
  return "medium";
}
/** ?q=draft (or low, medium, high) pins the render quality, for checks on machines without a GPU. */
function qualityParam(): Quality | null {
  try {
    const q = new URLSearchParams(window.location.search).get("q");
    return q === "draft" || q === "low" || q === "medium" || q === "high" ? q : null;
  } catch {
    return null;
  }
}
/** A pinned test quality stays on the address when the page rewrites it. */
const keepQuality = () => {
  const q = qualityParam();
  return q ? `&q=${q}` : "";
};
const LADDER: Quality[] = ["low", "medium", "high"];
const SLOW_MS = 18;

const damp = (cur: number, target: number, rate: number, dt: number) => target + (cur - target) * Math.exp(-rate * dt);

export function MassBattleExperience({ list, presets, initial, playback: initialPlayback }: { list: PickerMon[]; presets: PresetCard[]; initial: Initial; playback: PlaybackSpec }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<BattleScene | null>(null);
  const simRef = useRef<SimClient | null>(null);
  const poolRef = useRef<SolverPool | null>(null);
  const viewRef = useRef<BattleView | null>(null);
  const audioRef = useRef<BattleAudio | null>(null);
  const directorRef = useRef(new Director());
  const speciesRef = useRef<MBSpecies[]>([]);
  const heightsRef = useRef<number[]>([]);
  const phaseRef = useRef<Phase>("idle");
  const pausedRef = useRef(false);
  const speedRef = useRef(initialPlayback.speed);
  const camRef = useRef<"director" | "free">("director");
  const freeRef = useRef({ tx: 0, ty: 1, tz: 0, yaw: 0.6, pitch: 0.4, dist: 60, fov: 40, shake: 0, target: { tx: 0, tz: 0, yaw: 0.6, pitch: 0.4, dist: 60 } });
  const poseRef = useRef<Pose | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const qualityRef = useRef<Quality>("medium");
  const pinnedRef = useRef(false);
  const battleRef = useRef<BattleDesc | null>(null);
  const feedId = useRef(0);
  const endTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A video is being made: the live view stops drawing so the recorder has the device to itself. */
  const recordingRef = useRef(false);
  /** Worker milliseconds per simulation tick (smoothed), for the stats on the stage. */
  const tickMs = useRef(0);

  const [phase, setPhaseState] = useState<Phase>("idle");
  const [battle, setBattle] = useState<BattleDesc | null>(null);
  const [progress, setProgress] = useState<{ p: number; label: string }>({ p: 0, label: "" });
  const [solving, setSolving] = useState<{ n: number; wins: number; played: number; of: number; phase: string } | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [final, setFinal] = useState<Final | null>(null);
  const [cardHidden, setCardHidden] = useState(false);
  const [cam, setCam] = useState<"director" | "free">("director");
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(initialPlayback.speed);
  const [muted, setMutedState] = useState(true);
  const [showHow, setShowHow] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quality, setQuality] = useState<Quality>("medium");
  const [drawn, setDrawn] = useState<{ drawn: number; total: number } | null>(null);
  const [glOk, setGlOk] = useState(true);
  /** How the battle is shown; the setup panel and the stage's controls both change it, and links carry it. */
  const [playback, setPlaybackState] = useState<PlaybackSpec>(initialPlayback);
  const playbackRef = useRef(initialPlayback);
  const setPlayback = useCallback((p: PlaybackSpec) => {
    playbackRef.current = p;
    setPlaybackState(p);
    speedRef.current = p.speed;
    setSpeed(p.speed);
    if (battleRef.current) battleRef.current = { ...battleRef.current, playback: p };
  }, []);

  const setPhase = (p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };

  const byId = useMemo(() => new Map(list.map((p) => [p.id, p])), [list]);
  const facts = useMemo(() => list.map(factsOfRow), [list]);
  const slugs: SlugIndex = useMemo(() => {
    const bySlug = new Map(list.map((p) => [p.slug, p.id]));
    return { id: (s) => bySlug.get(s), slug: (id) => byId.get(id)?.slug };
  }, [list, byId]);
  const nameOf = useCallback((id: number) => byId.get(id)?.name ?? "?", [byId]);

  useEffect(() => {
    setMutedState(isMuted());
    return onMuteChange((m) => setMutedState(m));
  }, []);

  // ---- The scene (made once, on first use).
  const ensureScene = useCallback(async (): Promise<BattleScene | null> => {
    if (sceneRef.current) return sceneRef.current;
    const host = hostRef.current;
    if (!host) return null;
    const { createBattleScene, TEX_URL } = await import("./scene");
    const pinned = qualityParam();
    pinnedRef.current = pinned !== null;
    const q = pinned ?? initialQuality();
    qualityRef.current = q;
    setQuality(q);
    try {
      sceneRef.current = createBattleScene(host, { quality: q, tex: TEX_URL });
    } catch {
      setGlOk(false);
      return null;
    }
    return sceneRef.current;
  }, []);

  // ---- Feed and effects from the battle's hits.
  const pushFeed = useCallback((text: string, tone: FeedItem["tone"]) => {
    const id = ++feedId.current;
    setFeed((f) => [...f.slice(-3), { id, text, tone }]);
    setTimeout(() => setFeed((f) => f.filter((x) => x.id !== id)), 4200);
  }, []);

  const wireHits = useCallback((view: BattleView) => {
    const ready = view.ready;
    const sp = view.sp;
    const heights = heightsRef.current;
    const radius = ready.radius;
    let action = -1;
    let act = { actor: -1, move: "", type: "", kos: 0, target: -1, crit: false, bossHit: false, bossKo: false, x: 0, z: 0, h: 1 };
    let budget = 0, budgetAt = -1;
    const bossSide = ready.start[0] <= 3 && ready.start[1] >= 4 ? 0 : ready.start[1] <= 3 && ready.start[0] >= 4 ? 1 : -1;
    const name = (i: number) => speciesRef.current[sp[i]]?.name ?? "";
    const flush = () => {
      if (action < 0) return;
      const d = directorRef.current;
      const actorName = name(act.actor);
      const tone: FeedItem["tone"] = view.side[act.actor] === 0 ? "a" : "b";
      if (act.bossKo) {
        pushFeed(bossDownLine(actorName, act.move, name(act.target)), "gold");
        d.offer({ kind: "ko-boss", x: act.x, z: act.z, h: act.h, power: 1 });
        audioRef.current?.boom(1);
      } else if (act.kos >= 3) {
        pushFeed(multiKoLine(actorName, act.move, act.kos, name(act.target)), tone);
        if (act.kos >= 5) {
          d.offer({ kind: "multi", x: view.x[act.actor], z: view.z[act.actor], h: heights[sp[act.actor]], power: Math.min(1, act.kos / 20) });
          audioRef.current?.boom(Math.min(1, act.kos / 15));
        }
      } else if (act.crit && act.bossHit) {
        pushFeed(critLine(actorName, act.move, name(act.target)), "gold");
        d.offer({ kind: "crit", x: act.x, z: act.z, h: act.h, power: 0.6 });
      }
      action = -1;
    };
    view.onHit = (h: Hit) => {
      if (h.action !== action) {
        flush();
        action = h.action;
        const mv = h.slot >= 0 ? ready.moves[sp[h.actor]][h.slot] : null;
        act = { actor: h.actor, move: mv?.name ?? "", type: mv?.type ?? "Normal", kos: 0, target: h.target, crit: false, bossHit: false, bossKo: false, x: h.tx, z: h.tz, h: heights[sp[h.target]] };
      }
      const fx = sceneRef.current?.effects;
      const isBoss = bossSide >= 0 && view.side[h.target] === bossSide;
      if (h.flags & EV.KO) {
        act.kos++;
        if (isBoss) {
          act.bossKo = true;
          act.target = h.target;
          act.x = h.tx;
          act.z = h.tz;
          act.h = heights[sp[h.target]];
        }
      }
      if (h.flags & EV.CRIT) act.crit = true;
      if (isBoss && !(h.flags & (EV.MISS | EV.IMMUNE))) act.bossHit = true;
      // Effects, within a budget per moment of battle time (a huge clash stays smooth).
      if (h.t !== budgetAt) { budgetAt = h.t; budget = qualityRef.current === "low" || qualityRef.current === "draft" ? 24 : 70; }
      const drawnA = view.draw[h.actor], drawnT = view.draw[h.target];
      const ht = heights[sp[h.target]], ha = heights[sp[h.actor]];
      if (fx && (h.flags & EV.KO) && drawnT) fx.recall(h.tx, 0, h.tz, ht, h.t + 0.22);
      if (h.flags & EV.KO) audioRef.current?.recall();
      if (!fx || h.flags & EV.RECOIL || budget <= 0 || (!drawnA && !drawnT)) return;
      budget--;
      const mv = h.slot >= 0 ? ready.moves[sp[h.actor]][h.slot] : null;
      if (!mv) return;
      const first = h.target === act.target && act.kos <= 1;
      if (first) {
        if (mv.spread && h.flags & EV.SPREAD) fx.ring(mv.type, h.ax, h.az, radius[sp[h.actor]] + SPREAD_REACH + 0.4, 0.6, h.t);
        else if (!mv.contact) fx.beam(mv.type, { x: h.ax, y: ha * 0.6, z: h.az }, { x: h.tx, y: ht * 0.5, z: h.tz }, Math.min(0.6, Math.max(0.04, ha * 0.07)), 0.34, h.t);
        audioRef.current?.hit(mv.type, Math.min(1, h.damage / Math.max(1, ready.maxHp[sp[h.target]])), !!(h.flags & EV.CRIT));
      }
      if (h.flags & EV.MISS || h.flags & EV.IMMUNE) return;
      const share = Math.min(1, h.damage / Math.max(1, ready.maxHp[sp[h.target]]));
            const size = Math.min(1.6, Math.max(0.3, Math.min(ht, ha * 1.5) * 0.7));
      fx.burst(mv.type, h.tx, ht * 0.5, h.tz, 4 + share * 12, 1.2 + share * 4 + size, size, h.t);
      if (h.flags & EV.CRIT) fx.burst("Normal", h.tx, ht * 0.6, h.tz, 8, 3 + size * 2, size * 1.3, h.t);
      if (share > 0.35 && isBoss) directorRef.current.offer({ kind: "big", x: h.tx, z: h.tz, h: ht, power: share });
    };
  }, [pushFeed]);

  // ---- Deploying a battle.
  const deploy = useCallback(async (b: BattleDesc, autoplay: boolean) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    if (endTimer.current) clearTimeout(endTimer.current);
    setFinal(null);
    setCardHidden(false);
    setFeed([]);
    setError(null);
    setPaused(false);
    pausedRef.current = false;
    b = { ...b, playback: playbackRef.current };
    battleRef.current = b;
    setBattle(b);
    setPhase("deploying");
    setProgress({ p: 0, label: "Deploying armies" });
    try {
      const scene = await ensureScene();
      if (!scene) throw new Error("This browser can't draw the 3D battle (WebGL is off).");
      const roster = await getRoster();
      if (ac.signal.aborted) return;
      const slice = sliceRoster(roster, specIds(b.spec));
      simRef.current ??= new SimClient();
      const sim = simRef.current;
      const ready = await sim.init(slice, b.spec);
      if (ac.signal.aborted) return;
      const species = ready.species.map((id) => slice.species.find((s) => s.id === id)!);
      speciesRef.current = species;
      heightsRef.current = species.map((s) => figureSize(s).h);
      const view = new BattleView(ready, (await import("./scene")).QUALITY[qualityRef.current].cap);
      viewRef.current = view;
      setDrawn(view.drawn < view.n ? { drawn: view.drawn, total: view.n } : null);
      wireHits(view);
      sim.onFrames = (frames, end, ms) => {
        if (viewRef.current !== view) return;
        view.push(frames, end);
        if (frames.length) tickMs.current = tickMs.current * 0.9 + (ms / frames.length) * 0.1;
      };
      sim.onError = (m) => {
        setError(m);
        setPhase("error");
      };
      const counts = new Map<number, number>();
      for (let i = 0; i < ready.n; i++) counts.set(ready.side[i] * 10000 + ready.sp[i], (counts.get(ready.side[i] * 10000 + ready.sp[i]) ?? 0) + 1);
      const bosses = new Set<number>();
      for (let k = 0; k < species.length; k++) if (ready.start[0] <= 3 || ready.start[1] <= 3) {
        const total = (counts.get(k) ?? 0) + (counts.get(10000 + k) ?? 0);
        if (total <= 3) bosses.add(species[k].id);
      }
      await scene.deploy({ arena: b.spec.arena, radius: ready.arena, species, bosses, view }, (p, label) => setProgress({ p, label }), ac.signal);
      if (ac.signal.aborted) return;
      const aspect = hostRef.current ? hostRef.current.clientWidth / Math.max(1, hostRef.current.clientHeight) : 1.6;
      directorRef.current.reset(summarize(view, heightsRef.current, "deploy", aspect));
      if (/[?&]debug=1/.test(window.location.search)) (window as unknown as { __mb: unknown }).__mb = { scene, view, director: directorRef.current };
      camRef.current = "director";
      setCam("director");
      updateHud(view);
      setPhase("ready");
      if (autoplay) start();
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Something went wrong");
      setPhase("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ensureScene, wireHits]);

  const start = () => {
    const view = viewRef.current;
    if (!view || !battleRef.current) return;
    audioRef.current ??= createBattleAudio();
    audioRef.current.gesture();
    audioRef.current.start(battleRef.current.spec.arena);
    setPhase("playing");
    simRef.current?.step(6);
    track("mass_battle_start", { preset: battleRef.current.presetId ?? "custom", units: view.n });
  };

  const updateHud = (view: BattleView) => {
    let boss: Hud["boss"] = null;
    const start = view.ready.start;
    for (const s of [0, 1] as const) {
      if (start[s] <= 3 && start[1 - s] >= 4) {
        let hp = 0, max = 0, bi = -1;
        for (let i = 0; i < view.n; i++) if (view.side[i] === s) { hp += view.hp[i]; max += view.ready.maxHp[view.sp[i]]; if (bi < 0) bi = i; }
        if (phaseRef.current === "ready" || phaseRef.current === "deploying") hp = max;
        boss = { name: speciesRef.current[view.sp[bi]]?.name ?? "", hp, max, side: s };
      }
    }
    setHud({ left: [...view.left] as [number, number], start: [...start] as [number, number], boss, t: view.t, shot: camRef.current === "free" ? "free" : directorRef.current.shot });
  };

  const finish = useCallback((view: BattleView, end: SimEnd) => {
    const b = battleRef.current;
    if (!b) return;
    const o = end.outcome;
    const sp = view.sp;
    const mvp = end.stats.mvp >= 0 && end.stats.mvpKos >= 2 ? `${speciesRef.current[sp[end.stats.mvp]]?.name} · ${fmt(end.stats.mvpKos)} KOs` : null;
    const bh = end.stats.big;
    const big = bh ? `${possessive(speciesRef.current[sp[bh.actor]]?.name ?? "")} ${view.ready.moves[sp[bh.actor]][bh.slot]?.name ?? "hit"}: ${fmt(bh.damage)} damage${bh.crit ? " (critical hit)" : ""}` : null;
    setFinal({ winner: o.winner, title: resultTitle(o.winner, b.names, o.left), line: resultLine(o, b.names), mvp, big, seconds: o.seconds });
    audioRef.current?.swell();
    track("mass_battle_end", { preset: b.presetId ?? "custom", winner: o.winner });
  }, []);

  // ---- The render loop.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let hudAt = 0;
    let ftEma = 1000 / 60, refresh = 1000 / 60, slowFor = 0, calmFor = 0, warm = 0, raisedAt = -1e9, ceiling = LADDER.length - 1;
    let doneAt = -1;
    let wasSlow = false;
    let frameEma = 16.7, workEma = 2;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const start = performance.now();
      const raw = now - last;
      frameEma = frameEma * 0.95 + Math.min(250, raw) * 0.05;
      last = now;
      const dt = Math.min(0.1, raw / 1000);
      const scene = sceneRef.current;
      if (!scene || recordingRef.current) return;
      const view = viewRef.current;
      const phase = phaseRef.current;
      const host = hostRef.current;
      const aspect = host ? host.clientWidth / Math.max(1, host.clientHeight) : 1.6;
      const director = directorRef.current;
      if (view && (phase === "ready" || phase === "playing" || phase === "done")) {
        if (phase === "playing" && !pausedRef.current) {
          const slow = camRef.current === "director" ? director.timeScale : 1;
          const rate = speedRef.current * slow;
          if ((slow < 1) !== wasSlow) {
            wasSlow = slow < 1;
            audioRef.current?.slow(wasSlow);
          }
          view.advance(dt * rate);
          const sim = simRef.current;
          if (sim && !view.end && sim.inflight === 0 && view.head - view.t < 0.3 + dt * rate * 2) sim.step(Math.max(2, Math.min(24, Math.ceil((0.35 + dt * rate * 2) * 20))));
          const spent = view.takeSpent();
          if (spent.length) sim?.recycle(spent);
          if (view.ended && view.end) {
            if (doneAt < 0) doneAt = now;
            if (now - doneAt > 2600 && phaseRef.current === "playing") {
              setPhase("done");
              finish(view, view.end);
              audioRef.current?.slow(false);
            }
          }
        } else if (phase === "done" && !pausedRef.current) {
          view.advance(dt);
        }
        if (phase !== "playing") doneAt = phase === "done" ? doneAt : -1;
        const field = summarize(view, heightsRef.current, phase === "ready" ? "deploy" : view.ended ? "ended" : "battle", aspect);
        let pose: Pose;
        if (camRef.current === "director") {
          pose = director.update(field, dt);
          const f = freeRef.current;
          Object.assign(f, { tx: pose.tx, ty: pose.ty, tz: pose.tz, yaw: pose.yaw, pitch: pose.pitch, dist: pose.dist, fov: pose.fov });
          f.target = { tx: pose.tx, tz: pose.tz, yaw: pose.yaw, pitch: pose.pitch, dist: pose.dist };
        } else {
          const f = freeRef.current;
          const tg = f.target;
          f.tx = damp(f.tx, tg.tx, 10, dt);
          f.tz = damp(f.tz, tg.tz, 10, dt);
          f.yaw = damp(f.yaw, tg.yaw, 12, dt);
          f.pitch = damp(f.pitch, tg.pitch, 12, dt);
          f.dist = Math.exp(damp(Math.log(f.dist), Math.log(tg.dist), 10, dt));
          pose = { tx: f.tx, ty: f.ty, tz: f.tz, yaw: f.yaw, pitch: f.pitch, dist: f.dist, fov: f.fov, shake: 0 };
        }
        poseRef.current = pose;
        scene.setCamera(pose);
        scene.render(view, dt);
        workEma = workEma * 0.95 + (performance.now() - start) * 0.05;
        const stage = stageRef.current;
        if (now - hudAt > 120) {
          hudAt = now;
          updateHud(view);
          if (stage) {
            stage.dataset.t = view.t.toFixed(2);
            stage.dataset.dist = pose.dist.toFixed(2);
            stage.dataset.shot = camRef.current === "free" ? "free" : director.shot;
            stage.dataset.left = `${view.left[0]},${view.left[1]}`;
            const st = scene.stats();
            stage.dataset.calls = String(st.calls);
            stage.dataset.instances = String(st.instances);
            stage.dataset.frameMs = frameEma.toFixed(1);
            stage.dataset.workMs = workEma.toFixed(2);
            stage.dataset.tickMs = tickMs.current.toFixed(2);
          }
        }
      } else {
        // Idle: the empty arena (if any) turning slowly.
        const f = freeRef.current;
        f.yaw += dt * 0.05;
        scene.setCamera({ tx: 0, ty: 1, tz: 0, yaw: f.yaw, pitch: 0.42, dist: f.dist, fov: 40, shake: 0 });
        scene.render(null, dt);
      }
      // Adaptive quality: down after half a second of slow frames, up after several calm seconds.
      if (pinnedRef.current || !LADDER.includes(scene.quality)) return;
      if (warm < 30 || raw > 400) { warm++; return; }
      ftEma = ftEma * 0.85 + raw * 0.15;
      refresh = Math.min(34, Math.max(6, Math.min(raw, refresh + 0.005)));
      const slow = ftEma > Math.max(refresh * 1.3, SLOW_MS);
      slowFor = slow ? slowFor + raw : Math.max(0, slowFor - raw * 0.5);
      const level = LADDER.indexOf(scene.quality);
      if (slowFor > 500 && level > 0) {
        if (now - raisedAt < 10_000) ceiling = level - 1;
        scene.setQuality(LADDER[level - 1]);
        qualityRef.current = scene.quality;
        setQuality(scene.quality);
        slowFor = calmFor = 0;
        warm = 0;
        ftEma = refresh;
        return;
      }
      const calm = ftEma < refresh * 1.12 && raw < refresh * 1.6;
      calmFor = calm ? calmFor + raw : 0;
      if (calmFor > 6000 && level < ceiling) {
        scene.setQuality(LADDER[level + 1]);
        qualityRef.current = scene.quality;
        setQuality(scene.quality);
        raisedAt = now;
        slowFor = calmFor = 0;
        warm = 0;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Resize.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => sceneRef.current?.resize(host.clientWidth, host.clientHeight));
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // ---- Clean up.
  useEffect(() => () => {
    abortRef.current?.abort();
    simRef.current?.dispose();
    poolRef.current?.dispose();
    audioRef.current?.dispose();
    sceneRef.current?.dispose();
  }, []);

  // ---- Battles from presets, links and the setup panel.
  /** The answer battle of a question: `n` of its army (shared by its rows and groups) against the boss. */
  const answerBattle = useCallback((q: Question, answer: { n: number; spread: number; wins: number; runs: number }, seed: number, hook: string, presetId: string | null): BattleDesc => ({
    spec: questionSpec(expandQuestion(q, facts), answer.n, seed),
    names: [armyLabel(q.army, nameOf), armyLabel(q.boss, nameOf)],
    hook,
    question: q,
    answer: { n: answer.n, spread: answer.spread, wins: answer.wins, runs: answer.runs },
    presetId,
    playback: playbackRef.current,
  }), [facts, nameOf]);

  const presetBattle = useCallback((p: PresetCard): BattleDesc => {
    if (p.kind === "howmany" && p.question && p.answer) return answerBattle(p.question, p.answer, p.answer.seed, p.hook, p.id);
    const names = p.labels ?? ([armyLabel(p.spec.sides[0], nameOf), armyLabel(p.spec.sides[1], nameOf)] as [string, string]);
    return { spec: expandSpec(p.spec, facts), source: p.spec, names, hook: p.hook, question: null, answer: null, presetId: p.id, bonus: p.question && p.answer ? { question: p.question, answer: p.answer } : null, playback: playbackRef.current };
  }, [answerBattle, facts, nameOf]);

  const battleOf = useCallback((source: BattleSpec): BattleDesc => {
    const spec = expandSpec(source, facts);
    const names = [armyLabel(source.sides[0], nameOf), armyLabel(source.sides[1], nameOf)] as [string, string];
    const total = (s: 0 | 1) => spec.sides[s].units.reduce((a, u) => a + u.count, 0);
    return { spec, source, names, hook: `${fmt(total(0))} ${names[0]} vs ${fmt(total(1))} ${names[1]}`, question: null, answer: null, presetId: null, playback: playbackRef.current };
  }, [facts, nameOf]);

  const replaceUrl = (href: string) => {
    try { window.history.replaceState(null, "", href); } catch { /* sandboxed */ }
  };
  /** The playback part of a link (left out when it's all the defaults). */
  const viewParam = () => {
    const v = encodePlayback(playbackRef.current);
    return v ? `&v=${v}` : "";
  };

  const ask = useCallback(async (q: Question) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    audioRef.current ??= createBattleAudio();
    audioRef.current.gesture();
    setFinal(null);
    setError(null);
    replaceUrl(`${MASS_BATTLE_PATH}?ask=${encodeQuestion(q, slugs)}${viewParam()}${keepQuality()}`);
    const names: [string, string] = [armyLabel(q.army, nameOf), armyLabel(q.boss, nameOf)];
    const hook = questionText(names[0], names[1]);
    const qx = expandQuestion(q, facts);
    setBattle({ spec: questionSpec(qx, 1, 1), names, hook, question: q, answer: null, presetId: null, playback: playbackRef.current });
    setPhase("solving");
    setSolving({ n: 1, wins: 0, played: 0, of: SOLVER.quick, phase: "doubling" });
    void ensureScene();
    try {
      const roster = await getRoster();
      const slice = sliceRoster(roster, questionIds(qx));
      poolRef.current ??= new SolverPool();
      const t0 = performance.now();
      let phaseName = "doubling";
      const evaluate = poolRef.current.evaluator(slice, qx, (p) => setSolving({ ...p, phase: phaseName }), ac.signal);
      const res = await solve(questionKey(q, slugs), evaluate, (_s, ph) => { phaseName = ph; }, { signal: ac.signal, runs: runsOf(q), threshold: thresholdOf(q) });
      track("mass_battle_solve", { ms: Math.round(performance.now() - t0), answer: res.answer ?? -1 });
      setSolving(null);
      if (res.answer === null) {
        setError(noAnswerText(names[0], names[1], SOLVER.maxN));
        setPhase("error");
        return;
      }
      const b = answerBattle(q, { n: res.answer, spread: res.spread, wins: res.wins, runs: res.runs }, res.wonSeed ?? newSeed(), hook, null);
      await deploy(b, true);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      setSolving(null);
      setError(e instanceof Error ? e.message : "Something went wrong");
      setPhase("error");
    }
  }, [answerBattle, deploy, ensureScene, facts, nameOf, slugs]);

  const fight = useCallback((spec: BattleSpec) => {
    audioRef.current ??= createBattleAudio();
    audioRef.current.gesture();
    replaceUrl(`${MASS_BATTLE_PATH}?b=${encodeBattle(spec, slugs)}${viewParam()}${keepQuality()}`);
    void deploy(battleOf(spec), true);
  }, [battleOf, deploy, slugs]);

  // First load: the page's battle (a preset, a shared battle) waits on the field; a shared question is solved at once.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const canGl = (() => {
      try {
        const c = document.createElement("canvas");
        return !!(c.getContext("webgl2") || c.getContext("webgl"));
      } catch {
        return false;
      }
    })();
    if (!canGl) {
      setGlOk(false);
      return;
    }
    if (initial?.kind === "question") void ask(initial.q);
    else if (initial?.kind === "battle") void deploy(battleOf(initial.spec), false);
    else {
      const p = presets.find((x) => x.id === (initial?.kind === "preset" ? initial.id : presets[0]?.id));
      if (p) void deploy(presetBattle(p), false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Camera input: any drag, wheel or pinch takes the free camera; the Director button gives it back.
  const toFree = () => {
    if (camRef.current === "free") return;
    camRef.current = "free";
    setCam("free");
    const f = freeRef.current;
    if (poseRef.current) Object.assign(f, { tx: poseRef.current.tx, ty: poseRef.current.ty, tz: poseRef.current.tz, yaw: poseRef.current.yaw, pitch: poseRef.current.pitch, dist: poseRef.current.dist });
    f.target = { tx: f.tx, tz: f.tz, yaw: f.yaw, pitch: f.pitch, dist: f.dist };
  };
  const toDirector = () => {
    camRef.current = "director";
    setCam("director");
  };
  const zoomBy = (factor: number) => {
    toFree();
    const view = viewRef.current;
    const t = freeRef.current.target;
    const max = Math.max(60, (view?.ready.arena ?? 60) * 3.2);
    t.dist = Math.max(1.2, Math.min(max, t.dist * factor));
  };

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const pts = new Map<number, { x: number; y: number }>();
    let mode: "orbit" | "pan" | "pinch" | null = null;
    let last = { x: 0, y: 0 };
    let pinch: { spread: number; dist: number; mx: number; my: number } | null = null;
    let gesture: { dist: number } | null = null;
    const spreadOf = () => {
      const [a, b] = [...pts.values()];
      return { spread: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    };
    const pan = (dx: number, dy: number) => {
      const t = freeRef.current.target;
      const k = t.dist * 0.0016;
      const cy = Math.cos(t.yaw), sy = Math.sin(t.yaw);
      t.tx += (-dx * cy - dy * sy) * k;
      t.tz += (dx * sy - dy * cy) * k;
      const lim = (viewRef.current?.ready.arena ?? 80) * 1.2;
      const r = Math.hypot(t.tx, t.tz);
      if (r > lim) { t.tx *= lim / r; t.tz *= lim / r; }
    };
    const down = (e: PointerEvent) => {
      if (!viewRef.current) return;
      try { el.setPointerCapture?.(e.pointerId); } catch { /* a synthetic pointer */ }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      audioRef.current?.gesture();
      if (pts.size === 2) {
        const s = spreadOf();
        pinch = { spread: s.spread, dist: freeRef.current.target.dist, mx: s.mx, my: s.my };
        mode = "pinch";
      } else {
        mode = e.button === 2 || e.shiftKey || e.ctrlKey ? "pan" : "orbit";
        last = { x: e.clientX, y: e.clientY };
      }
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (mode === "pinch" && pinch && pts.size >= 2) {
        toFree();
        const s = spreadOf();
        const t = freeRef.current.target;
        const max = Math.max(60, (viewRef.current?.ready.arena ?? 60) * 3.2);
        t.dist = Math.max(1.2, Math.min(max, (pinch.dist * pinch.spread) / Math.max(10, s.spread)));
        pan(s.mx - pinch.mx, s.my - pinch.my);
        pinch.mx = s.mx;
        pinch.my = s.my;
        return;
      }
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      if (Math.abs(dx) + Math.abs(dy) < 0.5) return;
      toFree();
      const t = freeRef.current.target;
      if (mode === "pan") pan(dx, dy);
      else if (mode === "orbit") {
        t.yaw -= dx * 0.0055;
        t.pitch = Math.max(0.04, Math.min(1.45, t.pitch + dy * 0.0045));
      }
    };
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (!pts.size) mode = null;
    };
    const wheel = (e: WheelEvent) => {
      if (!viewRef.current) return;
      e.preventDefault();
      if (gesture) return;
      const px = Math.max(-240, Math.min(240, e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1)));
      zoomBy(Math.exp(px * (e.ctrlKey ? 0.011 : 0.0016)));
    };
    // Safari: a trackpad pinch arrives as gesture events.
    type GE = Event & { scale?: number };
    const gStart = (e: Event) => {
      e.preventDefault();
      toFree();
      gesture = { dist: freeRef.current.target.dist };
    };
    const gChange = (e: Event) => {
      e.preventDefault();
      if (!gesture) return;
      const t = freeRef.current.target;
      const max = Math.max(60, (viewRef.current?.ready.arena ?? 60) * 3.2);
      t.dist = Math.max(1.2, Math.min(max, gesture.dist / Math.max(0.05, (e as GE).scale || 1)));
    };
    const gEnd = (e: Event) => {
      e.preventDefault();
      gesture = null;
    };
    const ctx = (e: Event) => e.preventDefault();
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("gesturestart", gStart);
    el.addEventListener("gesturechange", gChange);
    el.addEventListener("gestureend", gEnd);
    el.addEventListener("contextmenu", ctx);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("gesturestart", gStart);
      el.removeEventListener("gesturechange", gChange);
      el.removeEventListener("gestureend", gEnd);
      el.removeEventListener("contextmenu", ctx);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (!viewRef.current) return;
      if (e.key === "+" || e.key === "=") zoomBy(1 / 1.3);
      else if (e.key === "-" || e.key === "_") zoomBy(1.3);
      else if (e.key === "0") toDirector();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePause = () => {
    if (phaseRef.current === "ready") return start();
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
  };
  const cycleSpeed = () => {
    const next = speed === 1 ? 2 : speed === 2 ? 0.5 : 1;
    speedRef.current = next;
    setSpeed(next);
  };
  const replay = () => {
    const b = battleRef.current;
    if (b) void deploy(b, true);
  };
  const toggleMute = () => {
    const next = !isMuted();
    setMuted(next);
    setMutedState(next);
    if (!next) audioRef.current?.gesture();
  };
  const shareHref = () => {
    const b = battleRef.current;
    if (!b) return `${window.location.origin}${MASS_BATTLE_PATH}`;
    const v = encodePlayback(playbackRef.current);
    if (b.presetId) return `${window.location.origin}${MASS_BATTLE_PATH}/${b.presetId}${v ? `?v=${v}` : ""}`;
    if (b.question) return `${window.location.origin}${MASS_BATTLE_PATH}?ask=${encodeQuestion(b.question, slugs)}${v ? `&v=${v}` : ""}`;
    return `${window.location.origin}${MASS_BATTLE_PATH}?b=${encodeBattle(b.source ?? b.spec, slugs)}${v ? `&v=${v}` : ""}`;
  };
  const share = async () => {
    const url = shareHref();
    const b = battleRef.current;
    const text = b?.hook ?? "Pokémon Mass Battle";
    if (typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
      try { await navigator.share({ title: "PokéIQ Mass Battle", text, url }); return; } catch { /* closed */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      setToast("Link copied");
    } catch {
      setToast(url);
    }
    setTimeout(() => setToast(null), 2400);
  };
  const fullscreen = () => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void el.requestFullscreen?.().catch(() => undefined);
  };

  const b = battle;
  const chip = "mb-chip pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-md border border-white/15 bg-[#0b1226]/70 px-2.5 font-display text-[11px] font-semibold uppercase tracking-[0.12em] text-white/85 backdrop-blur-md transition-colors hover:border-white/35 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffd84a] disabled:opacity-40 sm:px-3";
  const hideCount = !!b?.answer && phase !== "done";
  const sideName = (s: 0 | 1) => b?.names[s] ?? "";

  return (
    <div className="space-y-6">
      <style>{MB_CSS}</style>
      <div
        ref={stageRef}
        className="mb-stage dark-scope relative -mx-4 h-[68svh] min-h-[420px] overflow-hidden border-y border-white/10 text-white sm:mx-0 sm:h-[min(74vh,760px)] sm:min-h-[520px] sm:rounded-2xl sm:border"
        data-testid="mb-stage"
        data-phase={phase}
        data-cam={cam}
        data-quality={quality}
        data-winner={final ? String(final.winner) : ""}
        data-answer={b?.answer ? String(b.answer.n) : ""}
      >
        <div
          ref={hostRef}
          className="mb-host absolute inset-0 cursor-grab touch-none select-none active:cursor-grabbing"
          data-testid="mb-scene"
          role="application"
          aria-label="The battle in 3D. Drag to look around, right-drag or shift-drag to move, scroll or pinch to zoom (+ and − keys too); 0 hands the camera back to the director."
        />
        <div className="mb-shade-top" aria-hidden />
        <div className="mb-shade-bottom" aria-hidden />

        {/* HUD: armies, the boss, the kill feed. */}
        {hud && b && (phase === "ready" || phase === "playing" || phase === "done") && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-[3] p-3 sm:p-4" data-testid="mb-hud">
            <div className="flex items-start justify-between gap-3">
              {([0, 1] as const).map((s) => (
                <div key={s} className={cn("w-[42%] max-w-[300px] space-y-1", s === 1 && "text-right")} data-testid={`mb-army-${s}`}>
                  <div className={cn("flex items-baseline gap-2", s === 1 && "flex-row-reverse")}>
                    <span className="truncate font-display text-xs font-bold uppercase tracking-wide sm:text-sm">{sideName(s)}</span>
                    <span className="font-pixel text-[10px] tabular-nums text-white/75" data-testid={`mb-left-${s}`}>
                      {hideCount && s === 0 ? "?" : fmt(hud.left[s])}
                    </span>
                  </div>
                  <div className={cn("mb-bar", s === 1 && "scale-x-[-1]")}>
                    <i className={s === 0 ? "mb-a" : "mb-b"} style={{ transform: `scaleX(${hud.left[s] / Math.max(1, hud.start[s])})` }} />
                  </div>
                  <div className="font-pixel text-[9px] uppercase tracking-wider text-white/55">KOs {fmt(hud.start[1 - s] - hud.left[1 - s])}</div>
                </div>
              ))}
            </div>
            {hud.boss && phase !== "ready" && (
              <div className="mx-auto mt-2 w-[min(420px,70%)] space-y-1 text-center" data-testid="mb-boss">
                <div className="font-display text-sm font-bold uppercase tracking-wider sm:text-base">{hud.boss.name}</div>
                <div className="mb-bar mb-boss h-[10px]"><i style={{ transform: `scaleX(${hud.boss.hp / Math.max(1, hud.boss.max)})` }} /></div>
                <div className="font-pixel text-[9px] tabular-nums text-white/70">{fmt(hud.boss.hp)} / {fmt(hud.boss.max)} HP</div>
              </div>
            )}
            <ol className="mb-feed absolute right-3 top-24 hidden w-[min(340px,40%)] space-y-1.5 sm:block" aria-live="polite" data-testid="mb-feed">
              {feed.map((f) => (
                <li key={f.id} className={cn("rounded-md border bg-[#0b1226]/72 px-2.5 py-1.5 text-right font-display text-xs font-semibold backdrop-blur-sm", f.tone === "gold" ? "border-[#ffd84a]/70 text-[#ffe680]" : f.tone === "a" ? "border-[#4f9bff]/60" : "border-[#ff5a64]/60")}>
                  {f.text}
                </li>
              ))}
            </ol>
          </div>
        )}

        {drawn && (phase === "playing" || phase === "ready") && (
          <div className="pointer-events-none absolute bottom-16 left-3 z-[3] rounded bg-black/55 px-2 py-1 font-pixel text-[9px] uppercase tracking-wider text-white/80" data-testid="mb-drawn">
            Showing {fmt(drawn.drawn)} of {fmt(drawn.total)} · all {fmt(drawn.total)} fight
          </div>
        )}

        {/* Ready: the question or the matchup, and Start. */}
        {phase === "ready" && b && (
          <div className="absolute inset-x-0 top-[17%] z-[4] flex flex-col items-center gap-4 px-6 text-center sm:top-[16%]">
            <p className="mb-title max-w-4xl text-3xl sm:text-5xl lg:text-6xl" data-testid="mb-hook">{b.question ? questionText(b.names[0], b.names[1]) : b.hook.replace(/\s*\p{Extended_Pictographic}+$/u, "")}</p>
            <button type="button" onClick={start} className="mb-go pointer-events-auto inline-flex h-12 items-center gap-2 rounded-lg px-6 font-display text-sm font-bold uppercase tracking-wider" data-testid="mb-start">
              <Swords className="h-4 w-4" aria-hidden /> {b.question ? "Watch the answer" : "Start the battle"}
            </button>
          </div>
        )}

        {/* Solving: battles running in the background. */}
        {phase === "solving" && b?.question && (
          <div className="absolute inset-0 z-[4] flex flex-col items-center justify-center gap-4 bg-[#05070f]/55 px-6 text-center backdrop-blur-[2px]" data-testid="mb-solving">
            <div className="mb-loader-ball" aria-hidden />
            <p className="mb-title text-2xl sm:text-5xl">{questionText(b.names[0], b.names[1])}</p>
            <p className="font-display text-sm font-semibold uppercase tracking-wider text-white/85" data-testid="mb-solving-n">
              {solving ? `Testing ${fmt(solving.n)} ${b.names[0]} · won ${fmt(solving.wins)} of ${fmt(solving.played)}` : "Getting ready"}
            </p>
            <p className="max-w-md text-xs text-white/60">Every army size plays the same seeded battles, headless, on every spare core of this device.</p>
            <button type="button" onClick={() => { abortRef.current?.abort(); setPhase("idle"); setSolving(null); }} className={chip}>
              <X className="h-4 w-4" aria-hidden /> Cancel
            </button>
          </div>
        )}

        {/* Deploying: everything loads and builds before the battle starts. */}
        {phase === "deploying" && (
          <div className="absolute inset-0 z-[4] flex flex-col items-center justify-center gap-4 bg-[#05070f]/70 px-6 text-center" data-testid="mb-deploying">
            <div className="mb-loader-ball" aria-hidden />
            <p className="font-display text-lg font-bold uppercase tracking-[0.2em]">{progress.label || "Deploying armies"}</p>
            <div className="h-2 w-64 max-w-[70vw] overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.p * 100)} aria-label="Deploying armies">
              <div className="mb-progress h-full rounded-full" style={{ transform: `scaleX(${progress.p})` }} />
            </div>
            {b && <p className="text-sm text-white/65">{b.question ? questionText(b.names[0], b.names[1]) : b.hook.replace(/\s*\p{Extended_Pictographic}+$/u, "")}</p>}
          </div>
        )}

        {(phase === "idle" || phase === "error") && (
          <div className="absolute inset-0 z-[4] flex flex-col items-center justify-center gap-3 px-6 text-center">
            {!glOk ? (
              <p className="max-w-md text-white/80">This browser can&apos;t draw the 3D battle. The results of every ready-made battle are listed below.</p>
            ) : error ? (
              <>
                <p className="mb-title text-2xl sm:text-4xl">{error.startsWith("No army") ? error : "The battle stopped"}</p>
                {!error.startsWith("No army") && <p className="max-w-md text-sm text-white/70">{error}</p>}
              </>
            ) : (
              <p className="font-display text-lg uppercase tracking-wider text-white/70">Pick a battle below</p>
            )}
          </div>
        )}

        {/* The result. */}
        {phase === "done" && final && b && !cardHidden && (
          <div className="absolute inset-0 z-[7] flex items-center justify-center overflow-y-auto bg-[#05070f]/55 p-3 backdrop-blur-[2px] sm:p-4" data-testid="mb-final">
            <div className="my-auto w-full max-w-lg space-y-3 rounded-2xl border border-white/15 bg-[#0b1226]/90 p-4 text-center shadow-2xl sm:space-y-4 sm:p-7">
              {b.answer && b.question ? (
                <>
                  <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-white/60">{questionText(b.names[0], b.names[1])}</p>
                  <p className="mb-answer text-4xl sm:text-6xl" data-testid="mb-answer"><b>{fmt(b.answer.n)}</b> {b.names[0]}</p>
                  <p className="font-display text-sm font-semibold uppercase tracking-wider text-white/80" data-testid="mb-spread">{spreadText(b.answer.spread, b.answer.runs)}</p>
                  <p className="text-xs text-white/55">{winRateText(b.answer.wins, b.answer.runs, b.answer.n)}. This battle: {final.title}</p>
                </>
              ) : (
                <>
                  <p className="mb-answer text-4xl sm:text-5xl" data-testid="mb-result-title">{final.title}</p>
                  <p className="text-sm text-white/75">{final.line}</p>
                  {b.bonus && (
                    <button
                      type="button"
                      onClick={() => {
                        const bo = b.bonus!;
                        const q = bo.question;
                        void deploy(answerBattle(q, bo.answer, bo.answer.seed, questionText(armyLabel(q.army, nameOf), armyLabel(q.boss, nameOf)), null), true);
                      }}
                      className="w-full rounded-lg border border-[#ffd84a]/40 bg-[#ffd84a]/10 px-3 py-2 text-sm text-[#ffe680] hover:bg-[#ffd84a]/15"
                      data-testid="mb-bonus"
                    >
                      <span className="block">{questionText(armyLabel(b.bonus.question.army, nameOf), armyLabel(b.bonus.question.boss, nameOf))} <b>{fmt(b.bonus.answer.n)}</b> ({spreadText(b.bonus.answer.spread, b.bonus.answer.runs)})</span>
                      <span className="block font-display text-xs font-bold uppercase tracking-wider">Watch it →</span>
                    </button>
                  )}
                </>
              )}
              <dl className="grid grid-cols-2 gap-2 text-left text-xs">
                <div className="rounded-lg bg-white/5 p-2"><dt className="font-pixel text-[9px] uppercase text-white/50">Battle time</dt><dd className="font-display text-sm font-bold">{final.seconds.toFixed(1)} s</dd></div>
                <div className="rounded-lg bg-white/5 p-2"><dt className="font-pixel text-[9px] uppercase text-white/50">Left standing</dt><dd className="font-display text-sm font-bold">{hud ? `${fmt(hud.left[0])} · ${fmt(hud.left[1])}` : ""}</dd></div>
                {final.mvp && <div className="col-span-2 rounded-lg bg-white/5 p-2"><dt className="font-pixel text-[9px] uppercase text-white/50">Most KOs</dt><dd className="font-display text-sm font-bold">{final.mvp}</dd></div>}
                {final.big && <div className="col-span-2 rounded-lg bg-white/5 p-2"><dt className="font-pixel text-[9px] uppercase text-white/50">Biggest hit</dt><dd className="font-display text-sm font-bold">{final.big}</dd></div>}
              </dl>
              <div className="flex flex-wrap justify-center gap-2">
                <button type="button" onClick={replay} className={chip} data-testid="mb-replay"><RotateCcw className="h-4 w-4" aria-hidden /> Replay</button>
                <button type="button" onClick={() => setShowVideo(true)} className={chip} data-testid="mb-video-final"><Clapperboard className="h-4 w-4" aria-hidden /> Make a video</button>
                <button type="button" onClick={share} className={chip} data-testid="mb-share-final"><Share2 className="h-4 w-4" aria-hidden /> Share</button>
                <button type="button" onClick={() => { setCardHidden(true); toFree(); }} className={chip} data-testid="mb-look"><Camera className="h-4 w-4" aria-hidden /> Look around</button>
              </div>
            </div>
          </div>
        )}

        {/* Controls (the result card has its own). */}
        {(phase === "ready" || phase === "playing" || (phase === "done" && (!final || cardHidden))) && (
          <div className="absolute inset-x-0 bottom-0 z-[6] flex flex-wrap items-end justify-between gap-2 p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-1.5">
              {phase === "done" && cardHidden && (
                <button type="button" onClick={() => setCardHidden(false)} className={cn(chip, "border-[#ffd84a]/60 text-[#ffe680]")} data-testid="mb-show-result">
                  <Trophy className="h-4 w-4" aria-hidden /> Result
                </button>
              )}
              <button type="button" onClick={togglePause} className={chip} aria-label={phase === "ready" ? "Start" : paused ? "Play" : "Pause"} data-testid="mb-play" disabled={phase === "done"}>
                {phase === "playing" && !paused ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
              </button>
              <button type="button" onClick={replay} className={chip} aria-label="Replay" data-testid="mb-restart"><RotateCcw className="h-4 w-4" aria-hidden /></button>
              <button type="button" onClick={cycleSpeed} className={cn(chip, "tabular-nums")} aria-label={`Speed ${speed}×`} data-testid="mb-speed">{speed === 0.5 ? "½" : speed}×</button>
              <button type="button" onClick={cam === "free" ? toDirector : toFree} className={cn(chip, cam === "director" && "border-[#ffd84a]/60 text-[#ffe680]")} data-testid="mb-camera" aria-pressed={cam === "director"}>
                <Camera className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">{cam === "director" ? "Director" : "Free camera"}</span>
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <button type="button" onClick={() => zoomBy(1 / 1.45)} className={chip} aria-label="Zoom in" data-testid="mb-zoom-in"><Plus className="h-4 w-4" aria-hidden /></button>
              <button type="button" onClick={() => zoomBy(1.45)} className={chip} aria-label="Zoom out" data-testid="mb-zoom-out"><Minus className="h-4 w-4" aria-hidden /></button>
              <button type="button" onClick={toggleMute} className={chip} aria-label={muted ? "Sound on" : "Sound off"} data-testid="mb-sound">{muted ? <VolumeX className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}</button>
              <button type="button" onClick={() => setShowHow(true)} className={chip} aria-label="How it works" data-testid="mb-how"><Info className="h-4 w-4" aria-hidden /></button>
              <button type="button" onClick={share} className={chip} aria-label="Share" data-testid="mb-share"><Share2 className="h-4 w-4" aria-hidden /></button>
              <button type="button" onClick={() => setShowVideo(true)} className={chip} aria-label="Make a video" data-testid="mb-video"><Clapperboard className="h-4 w-4" aria-hidden /><span className="hidden lg:inline">Video</span></button>
              <button type="button" onClick={fullscreen} className={cn(chip, "hidden sm:inline-flex")} aria-label="Full screen"><Expand className="h-4 w-4" aria-hidden /></button>
            </div>
          </div>
        )}

        {toast && <div className="pointer-events-none absolute left-1/2 top-1/2 z-[8] -translate-x-1/2 rounded-md bg-black/80 px-3 py-2 font-display text-xs uppercase tracking-wider" role="status">{toast}</div>}

        {showHow && (
          <div className="absolute inset-0 z-[9] flex items-end justify-center bg-black/55 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="mb-how-title" data-testid="mb-how-panel">
            <div className="relative max-h-full w-full overflow-y-auto rounded-t-2xl border border-white/15 bg-[#0b1226] p-5 sm:max-w-2xl sm:rounded-2xl">
              <button type="button" onClick={() => setShowHow(false)} className="absolute right-3 top-3 rounded-md p-1.5 text-white/60 hover:text-white" aria-label="Close"><X className="h-5 w-5" /></button>
              <h2 id="mb-how-title" className="mb-3 font-display text-lg font-bold uppercase tracking-wider">How it works</h2>
              <HowItWorksBody />
            </div>
          </div>
        )}

        {showVideo && b && viewRef.current && (
          <Suspense fallback={<div className="absolute inset-0 z-[9] flex items-center justify-center bg-black/55"><Loader2 className="h-6 w-6 animate-spin" /></div>}>
            <MakeBattleVideo
              battle={b}
              species={speciesRef.current}
              onRecording={(on) => {
                recordingRef.current = on;
                if (on && phaseRef.current === "playing" && !pausedRef.current) {
                  pausedRef.current = true;
                  setPaused(true);
                }
              }}
              onClose={() => {
                recordingRef.current = false;
                setShowVideo(false);
              }}
            />
          </Suspense>
        )}
      </div>

      <SetupPanel
        list={list}
        presets={presets}
        busy={phase === "solving" || phase === "deploying"}
        current={b}
        playback={playback}
        onPlayback={setPlayback}
        onAsk={(q) => {
          stageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          void ask(q);
        }}
        onFight={(spec) => {
          stageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          fight(spec);
        }}
        onPreset={(p) => {
          audioRef.current ??= createBattleAudio();
          audioRef.current.gesture();
          replaceUrl(`${MASS_BATTLE_PATH}/${p.id}${`${viewParam()}${keepQuality()}`.replace("&", "?")}`);
          stageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          void deploy(presetBattle(p), true);
        }}
      />
    </div>
  );
}
