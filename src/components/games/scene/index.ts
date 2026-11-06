import * as THREE from "three";
import { watchContext } from "@/lib/gl/context-loss";
import { SAFE_HDR } from "@/lib/gl/safe-hdr";
import { PF_CAM, type PhotoFrame } from "@/lib/race/broadcast";
import type { CamPose } from "@/lib/race/director";
import type { Race } from "@/lib/race/race";
import type { Athlete } from "@/lib/games/athlete";
import type { Venue } from "@/lib/games/events";
import { buildCrowd, type Crowd } from "@/components/race/scene/crowd";
import { stadiumEnvironment } from "@/components/race/scene/post";
import { loadFigure, makeRunners, type Runners, type RunnerUrls } from "@/components/race/scene/runners";
import { LAYER, buildStadium, type Stadium, type StadiumUrls } from "@/components/race/scene/stadium";
import { createPost, type Post } from "@/components/world-history/scene/post";
import { BASE_LOOK, type Look, type Spec } from "@/components/world-history/scene/types";
import type { ShowFrame } from "../show/types";
import { blobShadows, loadActor, poseActor, type Actor } from "./actors";
import { makeConfetti, makeDecals, makeParticles, makeTrail, markTexture, type Particles } from "./fx";
import { buildInfield, type Infield } from "./venues/infield";
import { buildArena, type ArenaWorld } from "./venues/arena";
import { buildAquatics, type PoolWorld } from "./venues/pool";
import { buildProps, type GameProps } from "./props";

/**
 * The 3D world of the PokéIQ Games, one renderer for every event:
 *
 * - PokéIQ Stadium (the Race's stadium and crowd), with the field-event
 *   venues in its infield; the indoor arena (weightlifting platform,
 *   wrestling ring); the aquatics centre (an 8-lane 50 m pool with a water
 *   shader and caustics). One is drawn at a time.
 * - The athletes: for the sprints, the Race's own runners on the Race's
 *   track (start blocks, gait, dust, the dip, the photo finish); for every
 *   other event, the same articulated figures posed by the event's motions
 *   (scene/motions) from the show's frame.
 * - The film look of the World History engine (its post chain: filmic tone
 *   mapping, bloom, depth of field and camera motion blur on high), the
 *   broadcast grade cooler in the slow-motion replays.
 *
 * The page (or the video recorder) owns the show clock: each frame it asks
 * the show for the frame and hands it here.
 */

export type Quality = "draft" | "low" | "medium" | "high" | "export";

interface QSpec {
  pr: number;
  film: boolean;
  msaa: number;
  bloom: boolean;
  crowd: number;
  flashes: number;
  screenEvery: number;
  texSize: 256 | 512;
  segments: number;
  aniso: number;
  depth: boolean;
  lens: boolean;
  pf: { w: number; h: number; perFrame: number };
  particles: number;
}

export const QUALITY: Record<Quality, QSpec> = {
  draft: { pr: 1, film: false, msaa: 0, bloom: false, crowd: 0.2, flashes: 120, screenEvery: 0, texSize: 256, segments: 40, aniso: 1, depth: false, lens: false, pf: { w: 360, h: 200, perFrame: 90 }, particles: 0.3 },
  low: { pr: 1, film: false, msaa: 0, bloom: false, crowd: 0.4, flashes: 500, screenEvery: 0, texSize: 256, segments: 56, aniso: 2, depth: false, lens: false, pf: { w: 480, h: 240, perFrame: 40 }, particles: 0.5 },
  medium: { pr: 1.25, film: true, msaa: 4, bloom: true, crowd: 0.93, flashes: 1200, screenEvery: 3, texSize: 512, segments: 80, aniso: 4, depth: true, lens: false, pf: { w: 640, h: 300, perFrame: 40 }, particles: 0.8 },
  high: { pr: 1.6, film: true, msaa: 4, bloom: true, crowd: 0.93, flashes: 2000, screenEvery: 2, texSize: 512, segments: 110, aniso: 8, depth: true, lens: true, pf: { w: 800, h: 360, perFrame: 60 }, particles: 1 },
  export: { pr: 1, film: true, msaa: 4, bloom: true, crowd: 0.93, flashes: 2400, screenEvery: 1, texSize: 512, segments: 120, aniso: 8, depth: true, lens: true, pf: { w: 900, h: 400, perFrame: 900 }, particles: 1 },
};

export interface SceneUrls extends RunnerUrls, StadiumUrls {}

export interface SceneOptions {
  quality: Quality;
  urls: SceneUrls;
  font: string;
  size?: { w: number; h: number };
  onContextGone?: () => void;
}

export interface HeadAnchor {
  key: string;
  x: number;
  y: number;
  by: number;
  visible: boolean;
  dist: number;
}

export interface GamesScene {
  canvas: HTMLCanvasElement;
  /** Loads every athlete a show draws (and, for a sprint, the Race's runners on its race), then compiles every shader. */
  load(o: { athletes: Athlete[]; race?: Race; falseRace?: Race | null; venue: Venue }, signal: AbortSignal, onProgress?: (k: number) => void): Promise<void>;
  /** Draws a frame of a show; returns the heavy footfalls (sprints) for the sound. */
  frame(f: ShowFrame): { kg: number; dist: number }[];
  heads(): HeadAnchor[];
  photoFinish(frame: PhotoFrame): { step(): boolean; result(): HTMLCanvasElement | null; progress(): number };
  setCard(title: string, sub: string): void;
  resize(w: number, h: number): void;
  setQuality(q: Quality): void;
  readonly quality: Quality;
  stats(): { calls: number; tris: number; venue: Venue | null };
  internals(): { scene: THREE.Scene; renderer: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera };
  dispose(): void;
}

interface World {
  group: THREE.Group;
  env: THREE.Texture;
  fog: THREE.FogExp2;
  update(t: number, cam: THREE.Camera, excitement: number): void;
  dispose(): void;
}

export function createGamesScene(host: HTMLElement, opts: SceneOptions): GamesScene {
  let quality = opts.quality;
  let Q = QUALITY[quality];
  const Q0 = Q;
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  host.appendChild(canvas);
  const ctxWatch = watchContext(canvas, opts.onContextGone);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !Q.film && quality !== "draft", alpha: false, powerPreference: "high-performance", stencil: false, preserveDrawingBuffer: !!opts.size });
  const sizeOf = () => opts.size ?? { w: Math.max(1, host.clientWidth), h: Math.max(1, host.clientHeight) };
  let { w: W, h: H } = sizeOf();
  const prOf = () => (opts.size ? 1 : Math.min(window.devicePixelRatio || 1, Q.pr));
  renderer.setPixelRatio(prOf());
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x05070c);
  const toneFor = () => { renderer.toneMapping = Q.film ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1; };
  toneFor();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, W / H, 0.1, 6000);
  camera.layers.enable(LAYER.MAIN);
  camera.layers.enable(LAYER.SCREEN);
  camera.layers.enable(LAYER.CROWD);
  const screenCam = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 3000);
  screenCam.layers.enable(LAYER.MAIN);
  const pfCam = new THREE.PerspectiveCamera(36, 1, 0.1, 400);
  pfCam.layers.set(LAYER.BASE);
  pfCam.layers.enable(LAYER.PF);

  const spec = (q: QSpec): Spec => ({ pr: q.pr, msaa: q.msaa, bloom: q.bloom, rays: false, particles: q.particles, segments: q.segments, texSize: q.texSize, aniso: q.aniso, grid: 64, shadow: 0, depth: q.depth, lens: q.lens });
  let post: Post | null = Q.film ? createPost(renderer, W, H, prOf(), spec(Q)) : null;
  const aniso = Math.min(Q0.aniso, renderer.capabilities.getMaxAnisotropy());

  // ---- Worlds (built when first needed).
  const worlds = new Map<Venue, World>();
  let stadium: Stadium | null = null;
  let infield: Infield | null = null;
  let arena: ArenaWorld | null = null;
  let pool: PoolWorld | null = null;
  let crowd: Crowd | null = null;
  let current: Venue | null = null;
  // Big screens (stadium): the live feed or a still card.
  const card = document.createElement("canvas");
  card.width = 512;
  card.height = 288;
  const cardTex = new THREE.CanvasTexture(card);
  cardTex.colorSpace = THREE.SRGBColorSpace;
  const drawCard = (title: string, sub: string) => {
    const g = card.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 0, 288);
    grad.addColorStop(0, "#0b1a3a");
    grad.addColorStop(1, "#04070f");
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 288);
    g.fillStyle = "#ffd23f";
    g.fillRect(0, 252, 512, 6);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#ffffff";
    g.font = `700 50px ${opts.font}`;
    g.fillText("THE POKÉIQ GAMES", 256, 100, 480);
    g.font = `700 30px ${opts.font}`;
    g.fillStyle = "#ffd23f";
    g.fillText(title.toUpperCase(), 256, 164, 480);
    g.fillStyle = "#9fd8ff";
    g.font = `700 22px ${opts.font}`;
    g.fillText(sub.toUpperCase(), 256, 206, 480);
    cardTex.needsUpdate = true;
  };
  drawCard("Welcome", "");
  let screenRT: THREE.WebGLRenderTarget | null = null;
  const feedScreens = (on: boolean) => {
    if (on && !screenRT) { screenRT = new THREE.WebGLRenderTarget(512, 288, { type: THREE.HalfFloatType }); screenRT.texture.colorSpace = THREE.LinearSRGBColorSpace; }
    if (!on && screenRT) { screenRT.dispose(); screenRT = null; }
  };
  feedScreens(Q.screenEvery > 0);

  function stadiumWorld(): World {
    const g = new THREE.Group();
    const lights = new THREE.Group();
    lights.add(new THREE.HemisphereLight(0x9fb3e0, 0x5a2a22, 0.5));
    stadium = buildStadium({ urls: opts.urls, font: opts.font, q: { beams: false, liveScreens: Q0.screenEvery > 0, anisotropy: aniso }, upload: (t) => renderer.initTexture(t) });
    stadium.showFieldEvents(false);
    g.add(stadium.group);
    const lightAt = (m: THREE.Vector3, color: number, k: number) => {
      const l = new THREE.DirectionalLight(color, k);
      l.position.copy(m);
      l.target.position.set(m.x * 0.1, 0, m.z * 0.1);
      lights.add(l, l.target);
    };
    lightAt(stadium.masts[0], 0xfff2e2, 2.1);
    lightAt(stadium.masts[2], 0xe6edff, 1.4);
    lightAt(stadium.masts[1], 0xffffff, 0.75);
    lightAt(stadium.masts[3], 0xffffff, 0.6);
    g.add(lights);
    crowd = buildCrowd({ occupancy: Q0.crowd, flashes: Q0.flashes });
    g.add(crowd.group);
    infield = buildInfield({ urls: opts.urls, font: opts.font, aniso });
    g.add(infield.group);
    stadium.screenMaterial.map = cardTex;
    const env = stadiumEnvironment(renderer);
    const c = crowd;
    return {
      group: g,
      env,
      fog: new THREE.FogExp2(new THREE.Color(0.02, 0.025, 0.04), 0.0016),
      update(t, cam, ex) { stadium!.update(t, cam); c.update(t, ex); },
      dispose() { stadium?.dispose(); c.dispose(); infield?.dispose(); env.dispose(); },
    };
  }

  function world(v: Venue): World {
    let w = worlds.get(v);
    if (w) return w;
    if (v === "stadium") w = stadiumWorld();
    else if (v === "arena") {
      arena = buildArena({ renderer, font: opts.font, occupancy: Q0.crowd, flashes: Q0.flashes, aniso });
      const a = arena;
      w = { group: a.group, env: a.env, fog: a.fog, update: (t, cam, ex) => a.update(t, cam, ex), dispose: () => a.dispose() };
    } else {
      pool = buildAquatics({ renderer, font: opts.font, occupancy: Q0.crowd, flashes: Q0.flashes, aniso, quality: quality === "draft" || quality === "low" ? "low" : "high" });
      const p = pool;
      w = { group: p.group, env: p.env, fog: p.fog, update: (t, cam, ex) => p.update(t, cam, ex), dispose: () => p.dispose() };
    }
    w.group.visible = false;
    scene.add(w.group);
    worlds.set(v, w);
    return w;
  }

  function setVenue(v: Venue) {
    if (current === v) return;
    for (const [k, w] of worlds) w.group.visible = k === v;
    const w = world(v);
    w.group.visible = true;
    scene.environment = w.env;
    scene.environmentIntensity = v === "stadium" ? 0.9 : 1;
    scene.fog = w.fog;
    current = v;
  }

  // ---- Effects and props.
  const PN = (n: number) => Math.max(40, Math.round(n * Q0.particles));
  const sand = makeParticles(PN(420), { color: "#d9b77c", gravity: 9.81, drag: 2.2, grow: 0.6 });
  const dust = makeParticles(PN(220), { color: "#8a6a50", gravity: 0.4, drag: 2.6, grow: 1.6, opacity: 0.55 });
  const water = makeParticles(PN(700), { color: "#e6f6ff", gravity: 9.81, drag: 1.4, grow: 0.5, floor: -0.02 });
  const chalk = makeParticles(PN(160), { color: "#ffffff", gravity: 0.15, drag: 3, grow: 2.2, opacity: 0.6 });
  const clay = makeParticles(PN(240), { color: "#b98f63", gravity: 9.81, drag: 2.4, grow: 0.8 });
  const confetti = makeConfetti(quality === "draft" ? 200 : 700);
  const texSand = markTexture("sand"), texDivot = markTexture("divot"), texScuff = markTexture("scuff");
  const decalSand = makeDecals(24, texSand, "#ffffff", 0.9);
  const decalDivot = makeDecals(24, texDivot, "#ffffff", 0.95);
  const decalScuff = makeDecals(32, texScuff, "#ffffff", 0.8);
  const trail = makeTrail(40, new THREE.Color(1.6, 1.25, 0.5));
  const fx = new THREE.Group();
  for (const o of [sand.mesh, dust.mesh, water.mesh, chalk.mesh, clay.mesh, confetti.mesh, decalSand.mesh, decalDivot.mesh, decalScuff.mesh, trail.mesh]) fx.add(o);
  scene.add(fx);
  const props: GameProps = buildProps({ font: opts.font });
  scene.add(props.group);
  const shadows = blobShadows(24);
  scene.add(shadows.mesh);
  const born = new Set<string>();
  const placed = new Map<string, number>();
  let lastT = -1;

  function spawn(b: ShowFrame["bursts"][number]) {
    const r = (i: number) => { const x = Math.sin((i + 1) * 12.9898 + b.t0 * 78.233) * 43758.5453; return x - Math.floor(x); };
    const k = b.power;
    const rate = b.rate ?? 1;
    switch (b.kind) {
      case "sand": {
        const n = Math.round(Math.min(90, 26 + 30 * k) * Q0.particles);
        for (let i = 0; i < n; i++) {
          const a = r(i) * Math.PI * 2, s = 0.6 + r(i + 50) * 1.6;
          const fwd = (b.dx ?? 1) * (0.8 + r(i + 7) * 2.2) * k;
          sand.spawn(b.t0, b.x + (r(i + 3) - 0.5) * b.size * 0.4, b.y + 0.02, b.z + (r(i + 4) - 0.5) * b.size * 0.3, fwd + Math.cos(a) * s, (1.2 + r(i + 9) * 2.4) * Math.sqrt(k), Math.sin(a) * s, 0.04 + 0.08 * r(i + 11) * Math.min(3, b.size), 0.9 + r(i + 13) * 0.6, undefined, rate);
        }
        for (let i = 0; i < 6; i++) dust.spawn(b.t0, b.x + (r(i + 70) - 0.5) * b.size, b.y + 0.1, b.z + (r(i + 71) - 0.5) * b.size * 0.4, (b.dx ?? 1) * 0.6, 0.3, 0, 0.5 + b.size * 0.3, 1.8, "#d9b77c", rate);
        break;
      }
      case "dust":
      case "turf": {
        const n = Math.round(14 * Q0.particles) + 4;
        for (let i = 0; i < n; i++) {
          const a = r(i) * Math.PI * 2;
          dust.spawn(b.t0, b.x, b.y + 0.05, b.z, Math.cos(a) * (0.6 + k), 0.4 + r(i + 5) * 0.8 * k, Math.sin(a) * (0.6 + k), 0.2 + b.size * 0.4 * r(i + 6), 1.4 + r(i + 8), b.kind === "turf" ? "#5c4a30" : undefined, rate);
        }
        if (b.kind === "turf") for (let i = 0; i < 18; i++) clay.spawn(b.t0, b.x, b.y + 0.02, b.z, (r(i + 30) - 0.5) * 2 * k, 1 + r(i + 31) * 2 * k, (r(i + 32) - 0.5) * 2 * k, 0.03 + 0.03 * r(i), 0.8, "#4a3a22", rate);
        break;
      }
      case "clay": {
        for (let i = 0; i < Math.round(30 * Q0.particles) + 6; i++) {
          const a = r(i) * Math.PI * 2;
          clay.spawn(b.t0, b.x, b.y + 0.02, b.z, Math.cos(a) * (0.5 + k) + (b.dx ?? 0) * k, 0.4 + r(i + 1) * 1.2 * k, Math.sin(a) * (0.5 + k) + (b.dz ?? 0) * k, 0.03 + 0.05 * r(i + 2) * b.size, 1, undefined, rate);
        }
        break;
      }
      case "splash":
      case "spray": {
        const n = Math.round(Math.min(160, (b.kind === "splash" ? 40 : 12) + 40 * k) * Q0.particles) + 4;
        for (let i = 0; i < n; i++) {
          const a = r(i) * Math.PI * 2, s = (0.4 + r(i + 1) * 1.8) * Math.sqrt(k) * (b.kind === "splash" ? 1.6 : 0.8);
          water.spawn(b.t0, b.x + Math.cos(a) * b.size * 0.25, b.y, b.z + Math.sin(a) * b.size * 0.25, Math.cos(a) * s + (b.dx ?? 0) * 0.8, (1.5 + r(i + 2) * 3.5) * Math.sqrt(k) * (b.kind === "splash" ? 1 : 0.5), Math.sin(a) * s + (b.dz ?? 0) * 0.8, 0.03 + 0.07 * r(i + 3) * Math.min(4, 0.5 + b.size), 0.7 + r(i + 4) * 0.5, undefined, rate);
        }
        break;
      }
      case "chalk": {
        for (let i = 0; i < Math.round(20 * Q0.particles) + 4; i++) {
          const a = r(i) * Math.PI * 2;
          chalk.spawn(b.t0, b.x + Math.cos(a) * 0.1 * b.size, b.y, b.z + Math.sin(a) * 0.1 * b.size, Math.cos(a) * 0.5, 0.2 + r(i + 1) * 0.6, Math.sin(a) * 0.5, 0.08 + 0.2 * r(i + 2) * b.size, 1.6, undefined, rate);
        }
        break;
      }
      case "confetti":
        confetti.burst(b.t0, b.x, b.y, b.z, b.size, Math.round(b.t0 * 100) % 997);
        break;
    }
  }

  // ---- Athletes.
  const actors = new Map<string, Actor>();
  /** The Race's runners: the race, and the recalled start of a false start. */
  let runSets: { runners: Runners; race: Race }[] = [];
  const RO = () => ({ texSize: Q0.texSize, segments: Q0.segments, anisotropy: aniso });

  /** Compiles shaders for the HDR target the scene is drawn into, tolerating materials disposed while compiling (the Sizes fix). */
  function compile(): Promise<void> {
    const was = renderer.getRenderTarget();
    renderer.setRenderTarget(post?.target ?? null);
    let pending: Set<THREE.Material>;
    try { pending = renderer.compile(scene, camera); } finally { renderer.setRenderTarget(was); }
    return new Promise((resolve) => {
      const check = () => {
        for (const m of pending) {
          const program = (renderer.properties.get(m) as { currentProgram?: { isReady(): boolean } }).currentProgram;
          if (!program || program.isReady()) pending.delete(m);
        }
        if (pending.size === 0) resolve();
        else setTimeout(check, 10);
      };
      if (renderer.extensions.has("KHR_parallel_shader_compile")) check();
      else setTimeout(check, 10);
    });
  }

  async function load(o: { athletes: Athlete[]; race?: Race; falseRace?: Race | null; venue: Venue }, signal: AbortSignal, onProgress?: (k: number) => void) {
    setVenue(o.venue);
    const want = o.athletes.filter((a) => !actors.has(a.key));
    let done = o.athletes.length - want.length;
    const races = [o.race, o.falseRace].filter((r): r is Race => !!r);
    const total = Math.max(1, o.athletes.length + races.reduce((s, r) => s + r.lanes.length, 0));
    onProgress?.(done / total);
    const jobs = want.map((a) => loadActor(renderer, a, opts.urls, RO(), signal).then((x) => { done++; onProgress?.(done / total); return x; }));
    for (const j of jobs) {
      try { const act = await j; actors.set(act.athlete.key, act); scene.add(act.fig.root); act.fig.root.visible = false; } catch (e) { if (signal.aborted) throw e; }
    }
    for (const rs of runSets) { scene.remove(rs.runners.group, rs.runners.pfGroup); rs.runners.dispose(); }
    runSets = [];
    for (const race of races) {
      // The sprints run on the Race's own runners (their figures are the Race's, built for its lanes).
      const figs = [];
      for (const lane of race.lanes) {
        try { figs.push(await loadFigure(renderer, lane, opts.urls, RO(), signal)); } catch (e) { if (signal.aborted) throw e; }
        done++;
        onProgress?.(done / total);
      }
      if (signal.aborted) { figs.forEach((f) => f.dispose()); throw new DOMException("aborted", "AbortError"); }
      const runners = makeRunners(race, figs, stadium?.masts ?? [], null);
      scene.add(runners.group, runners.pfGroup);
      runners.update(0, 0, camera, "idle");
      runSets.push({ runners, race });
    }
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    // Everything visible once, so every shader compiles before the show starts.
    for (const a of actors.values()) a.fig.root.visible = true;
    props.warm();
    await compile().catch(() => undefined);
    for (const a of actors.values()) a.fig.root.visible = false;
  }

  // ---- Camera shake (sprints' heavy footfalls, landings).
  const impulses: { t: number; a: number }[] = [];
  const camPos = new THREE.Vector3();
  const prevVP = new THREE.Matrix4();
  let havePrev = false;
  let lastPose: CamPose | null = null;
  let frameNo = 0;

  function look(f: ShowFrame): Look {
    const r = f.replay;
    const lk: Look = {
      ...BASE_LOOK,
      exposure: 1.0,
      bloom: 0.55,
      bloomRadius: 0.5,
      bloomThreshold: 0.92,
      saturation: 1.1 - 0.18 * r,
      contrast: 1.04,
      vignette: 0.28 + 0.16 * r,
      gain: [1 - 0.04 * r, 1, 1 + 0.07 * r],
      lift: [0, 0, 0.006 * r],
      grain: 0.02 + 0.02 * r,
      tone: "filmic",
      hueKeep: 0.45,
      fringe: 0.12,
      flash: f.flash,
      fade: f.fade,
      flashHdr: true,
      bloomKnee: 0.4,
      bloomCap: 30,
    };
    if (f.dof && f.dof.k > 0) lk.dof = { focus: f.dof.focus, k: f.dof.k * 0.6 };
    lk.mblur = 0.7;
    return lk;
  }

  function frame(f: ShowFrame): { kg: number; dist: number }[] {
    if (ctxWatch.lost) return [];
    frameNo++;
    setVenue(f.venue);
    const { pose } = f;
    const jumped = !lastPose || Math.hypot(pose.pos[0] - lastPose.pos[0], pose.pos[1] - lastPose.pos[1], pose.pos[2] - lastPose.pos[2]) > 6 || Math.abs(pose.fov - lastPose.fov) > 8;
    lastPose = pose;
    camera.position.set(...pose.pos);
    camera.fov = pose.fov;
    camera.aspect = W / H;
    camera.near = Math.max(0.03, Math.min(1.5, camera.position.distanceTo(new THREE.Vector3(...pose.target)) * 0.02));
    camera.updateProjectionMatrix();
    camera.lookAt(...pose.target);
    camera.updateMatrixWorld();
    // A jump back on the show clock (a replay, a seek): every effect starts over.
    if (f.t < lastT - 1e-6) {
      born.clear();
      for (const p of [sand, dust, water, chalk, clay] as Particles[]) p.clear();
      confetti.clear();
      decalSand.clear(); decalDivot.clear(); decalScuff.clear();
      placed.clear();
    }
    lastT = f.t;
    for (const b of f.bursts) if (!born.has(b.id) && f.t >= b.t0) { born.add(b.id); spawn(b); }
    // Decals: a fixed slot per id (each kind keeps its newest marks).
    for (const d of f.decals) {
      const set = d.kind === "sand" ? decalSand : d.kind === "divot" ? decalDivot : decalScuff;
      let slot = placed.get(d.id);
      if (slot == null) {
        const n = (placed.get(`#${d.kind}`) ?? 0) + 1;
        placed.set(`#${d.kind}`, n);
        slot = (n - 1) % (d.kind === "scuff" ? 32 : 24);
        placed.set(d.id, slot);
      }
      set.place(slot, d.t0, d.x, d.y, d.z, d.w, d.l, d.angle);
    }
    // The sprints: the Race's runners.
    let steps: { x: number; z: number; kg: number }[] = [];
    runSets.forEach((rs, i) => {
      const on = !!f.race && (f.race.index ?? 0) === i;
      rs.runners.group.visible = rs.runners.pfGroup.visible = on;
      if (on) steps = rs.runners.update(f.race!.t, f.t, camera, f.race!.pre, f.race!.focus);
    });
    // Everyone else: posed from the frame.
    const shown = new Set<string>();
    let sh = 0;
    for (const { key, pose: p } of f.actors) {
      const act = actors.get(key);
      if (!act) continue;
      shown.add(key);
      poseActor(act, p, camera, f.t);
      if (p.visible && (p.shadow ?? 1) > 0 && sh < 24) {
        const lift = Math.max(0, p.y - (p.ground ?? 0));
        const k = (p.shadow ?? 1) * Math.max(0, 1 - lift / (act.h * 0.9 + 0.6));
        shadows.set(sh++, p.x, p.ground ?? 0, p.z, Math.max(0.25, act.w * 0.55), Math.max(0.25, act.w * 0.4), k);
      }
    }
    shadows.commit(sh);
    for (const [key, act] of actors) if (!shown.has(key)) act.fig.root.visible = false;
    // Props.
    props.update(f, camera);
    if (infield) {
      const p = f.props;
      infield.show(p.kind === "lj" ? "lj" : p.kind === "hj" ? "hj" : p.kind === "throw" ? (p.implement === "shot" ? "sp" : "jt") : null);
      if (p.kind === "lj") {
        infield.lj.setPit(p.pitFar);
        infield.lj.setFlag(p.flag, p.foul);
        infield.lj.setTape(p.tape);
        infield.lj.setLeader(p.leader);
      } else if (p.kind === "hj") {
        if (Math.abs((infield.hj.group.userData.h ?? -1) - p.bar) > 1e-6) { infield.hj.setHeight(p.bar, opts.font); infield.hj.group.userData.h = p.bar; }
        infield.hj.setBar({ bounce: p.bounce, spin: p.spin, fall: p.fall, side: p.side });
        infield.hj.setDent(p.dent[0], p.dent[1], p.dent[2], p.dent[3]);
      } else if (p.kind === "throw") {
        const v = p.implement === "shot" ? infield.sp : infield.jt;
        v.setTape(p.tape);
        v.setLeader(p.leader);
        trail.set(p.trail.map((q) => new THREE.Vector3(...q)), p.implement === "shot" ? 0.18 : 0.12, camera);
      }
      if (p.kind !== "throw") trail.set([], 0.1, camera);
    }
    arena?.setProps(f.props, f.t);
    pool?.setProps(f.props, f.t, camera);
    // Effects.
    for (const p of [sand, dust, water, chalk, clay] as Particles[]) p.update(f.t, camera);
    confetti.update(f.t);
    decalSand.update(f.t); decalDivot.update(f.t); decalScuff.update(f.t);
    // Shake from heavy steps and impacts.
    camera.getWorldPosition(camPos);
    const heard: { kg: number; dist: number }[] = [];
    for (const s of steps) {
      const d = Math.hypot(s.x - camPos.x, s.z - camPos.z);
      heard.push({ kg: s.kg, dist: d });
      const k = Math.sqrt(s.kg / 300);
      impulses.push({ t: f.t, a: Math.min(0.022, (0.0012 * k) / (1 + d / 30) + (0.0055 * k) / (1 + (d / 9) * (d / 9))) });
    }
    for (let k = impulses.length - 1; k >= 0; k--) if (f.t - impulses[k].t > 0.6 || f.t < impulses[k].t) impulses.splice(k, 1);
    let shake = 0;
    for (const im of impulses) shake += im.a * Math.exp(-(f.t - im.t) / 0.12);
    if (shake > 0) {
      camera.rotateX(shake * Math.sin(f.t * 83));
      camera.rotateY(shake * 0.6 * Math.sin(f.t * 71 + 1.3));
      camera.updateMatrixWorld();
    }
    const w = worlds.get(f.venue)!;
    w.update(f.t, camera, f.excitement);
    if (stadium && f.venue === "stadium") {
      stadium.clock.draw(f.clock || " ", "");
      if (screenRT && f.screen && Q.screenEvery > 0 && frameNo % Q.screenEvery === 0) {
        screenCam.position.set(...f.screen.pos);
        screenCam.fov = f.screen.fov;
        screenCam.updateProjectionMatrix();
        screenCam.lookAt(...f.screen.target);
        screenCam.updateMatrixWorld();
        renderer.setRenderTarget(screenRT);
        renderer.render(scene, screenCam);
        renderer.setRenderTarget(null);
        if (stadium.screenMaterial.map !== screenRT.texture) { stadium.screenMaterial.map = screenRT.texture; stadium.screenMaterial.needsUpdate = true; }
      } else if ((!f.screen || !screenRT) && stadium.screenMaterial.map !== cardTex) {
        stadium.screenMaterial.map = cardTex;
        stadium.screenMaterial.needsUpdate = true;
      }
    }
    if (post) {
      renderer.setRenderTarget(post.target);
      renderer.clear();
      renderer.render(scene, camera);
      const vp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      post.finish(look(f), null, f.t, { camera, prevViewProj: havePrev && !jumped && Q.lens ? prevVP.clone() : null });
      prevVP.copy(vp);
      havePrev = true;
    } else {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    }
    return heard;
  }

  const v = new THREE.Vector3(), b = new THREE.Vector3();
  function heads(): HeadAnchor[] {
    const out: HeadAnchor[] = [];
    const add = (key: string, x: number, y: number, z: number, h: number) => {
      v.set(x, y + h * 1.02, z).project(camera);
      b.set(x, y, z).project(camera);
      const sx = (v.x * 0.5 + 0.5) * W, sy = (1 - (v.y * 0.5 + 0.5)) * H;
      out.push({ key, x: sx, y: sy, by: (1 - (b.y * 0.5 + 0.5)) * H, visible: v.z < 1 && sx > -40 && sx < W + 40 && sy > -80 && sy < H + 40, dist: camera.position.distanceTo(new THREE.Vector3(x, y, z)) });
    };
    for (const rs of runSets) {
      if (!rs.runners.group.visible) continue;
      for (const h of rs.runners.heads()) {
        const lane = rs.race.lanes.find((l) => l.lane === h.lane);
        if (lane) add(lane.entrant.key, h.pos.x, h.pos.y - h.h * 1.02, h.pos.z, h.h);
      }
    }
    for (const [key, a] of actors) if (a.fig.root.visible) add(key, a.fig.root.position.x, a.fig.root.position.y, a.fig.root.position.z, a.h);
    return out;
  }

  function photoFinish(fr: PhotoFrame) {
    const { from, to } = fr;
    const { w: PW, h: PH, perFrame } = Q0.pf;
    const rt = new THREE.WebGLRenderTarget(PW, PH, { type: THREE.HalfFloatType });
    rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    pfCam.fov = THREE.MathUtils.radToDeg(fr.bottom - fr.top) * 1.06;
    pfCam.aspect = 1 / PH;
    pfCam.near = 0.5;
    pfCam.far = 400;
    pfCam.position.set(PF_CAM.x, PF_CAM.y, PF_CAM.z);
    pfCam.rotation.set(0, 0, 0);
    pfCam.rotateX(-(fr.top + fr.bottom) / 2);
    pfCam.updateProjectionMatrix();
    pfCam.updateMatrixWorld();
    let col = 0;
    let out: HTMLCanvasElement | null = null;
    const develop = () => {
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
        uniforms: { t: { value: rt.texture } },
        vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
        fragmentShader: /* glsl */ `uniform sampler2D t; varying vec2 vUv;
          ${SAFE_HDR}
          vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
          void main(){ vec3 c = glSafe(texture2D(t, vUv).rgb) * 1.3; c = aces(c);
            c = mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 1.08);
            c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); gl_FragColor = vec4(c, 1.0); }`,
        depthTest: false,
        depthWrite: false,
      }));
      const dst = new THREE.WebGLRenderTarget(PW, PH);
      const s = new THREE.Scene();
      s.add(quad);
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      renderer.setRenderTarget(dst);
      renderer.render(s, cam);
      const px = new Uint8Array(PW * PH * 4);
      renderer.readRenderTargetPixels(dst, 0, 0, PW, PH, px);
      renderer.setRenderTarget(null);
      const cv = document.createElement("canvas");
      cv.width = PW;
      cv.height = PH;
      const g = cv.getContext("2d")!;
      const img = g.createImageData(PW, PH);
      for (let y = 0; y < PH; y++) img.data.set(px.subarray((PH - 1 - y) * PW * 4, (PH - y) * PW * 4), y * PW * 4);
      g.putImageData(img, 0, 0);
      quad.geometry.dispose();
      (quad.material as THREE.Material).dispose();
      dst.dispose();
      rt.dispose();
      return cv;
    };
    return {
      step() {
        if (out) return true;
        const runners = runSets[0]?.runners;
        if (!runners) return false;
        const fogWas = scene.fog;
        scene.fog = null;
        const clear = renderer.getClearColor(new THREE.Color());
        renderer.setClearColor(0x14161c);
        const end = Math.min(PW, col + perFrame);
        for (; col < end; col++) {
          const t = from + ((col + 0.5) / PW) * (to - from);
          runners.posePhoto(t);
          rt.viewport.set(col, 0, 1, PH);
          rt.scissor.set(col, 0, 1, PH);
          rt.scissorTest = true;
          renderer.setRenderTarget(rt);
          renderer.render(scene, pfCam);
        }
        renderer.setRenderTarget(null);
        renderer.setClearColor(clear);
        scene.fog = fogWas;
        if (col >= PW) out = develop();
        return !!out;
      },
      result: () => out,
      progress: () => col / PW,
    };
  }

  function resize(w: number, h: number) {
    W = w;
    H = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    post?.setSize(w, h, prOf());
  }

  function setQuality(next: Quality) {
    if (next === quality) return;
    quality = next;
    Q = QUALITY[next];
    renderer.setPixelRatio(prOf());
    renderer.setSize(W, H, false);
    post?.dispose();
    post = Q.film ? createPost(renderer, W, H, prOf(), spec(Q)) : null;
    toneFor();
    feedScreens(Q.screenEvery > 0);
    havePrev = false;
  }

  return {
    canvas,
    load,
    frame,
    heads,
    photoFinish,
    setCard: drawCard,
    resize,
    setQuality,
    get quality() { return quality; },
    stats: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, venue: current }),
    internals: () => ({ scene, renderer, camera }),
    dispose() {
      ctxWatch.dispose();
      for (const rs of runSets) rs.runners.dispose();
      for (const a of actors.values()) a.fig.dispose();
      for (const w of worlds.values()) w.dispose();
      for (const p of [sand, dust, water, chalk, clay] as Particles[]) p.dispose();
      confetti.dispose();
      decalSand.dispose(); decalDivot.dispose(); decalScuff.dispose();
      texSand.dispose(); texDivot.dispose(); texScuff.dispose();
      trail.dispose();
      shadows.dispose();
      props.dispose();
      post?.dispose();
      screenRT?.dispose();
      cardTex.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
