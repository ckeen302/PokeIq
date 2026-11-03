import * as THREE from "three";
import type { ArenaId, MBSpecies } from "@/lib/mass-battle/types";
import { figureSize } from "@/lib/mass-battle/stats";
import { buildArena, type Arena } from "./arena";
import { loadAll } from "./assets";
import { Effects, effectCaps, typeLook } from "./effects";
import { lookFor, normTime, normWeather, type Look, type TimeOfDay, type Weather } from "./look";
import { createPost, type Post } from "./post";
import { UNIT_LIGHT, UnitsLayer, type UnitsView } from "./units";
import { buildWeather, type WeatherLayer } from "./weather";

/**
 * The Mass Battle's 3D scene: an arena under its sky and weather, the
 * armies as instanced 3D relief figures with real shadows, the move
 * effects, and the camera, drawn through an HDR finishing pass (bloom,
 * grade, the camera punch on huge hits). Everything (terrain, every
 * species' figures at every detail level, every shader, the shadow and
 * post passes) is loaded, built and compiled in `deploy`, behind the
 * "deploying armies" screen, so nothing pops in or stutters once the
 * battle starts. The page owns the clock and the camera's path; the scene
 * draws a frame for them.
 */

/** "draft" is for automated checks on machines without a GPU; "export" renders videos. */
export type Quality = "draft" | "low" | "medium" | "high" | "export";

export interface QualitySpec {
  pr: number;
  /** MSAA samples on the HDR target (0 none). */
  msaa: number;
  /** Most units drawn (the rest of a bigger army still fights; the view shows a representative share). */
  cap: number;
  /** Relief detail levels (segments on the figure's long side), most detailed first. */
  segments: number[];
  /** A boss (a side of three or fewer) gets the hero relief. */
  bossSegments: number[];
  /** Projected heights (px) where the detail steps down. */
  lodPx: number[];
  particles: number;
  props: number;
  anisotropy: number;
  /** Sun shadow map size (0: contact shadows only). */
  shadow: number;
  /** Bloom mips (0 none). */
  bloom: number;
  /** Grass blades on the plains. */
  grass: number;
  /** Through the HDR finishing pass (draft draws straight to the screen). */
  post: boolean;
  /** Share of the weather's particles. */
  weather: number;
  /** Effects pieces per frame. */
  fxBudget: number;
}

export const QUALITY: Record<Quality, QualitySpec> = {
  draft: { pr: 1, msaa: 0, cap: 1500, segments: [24, 10], bossSegments: [48, 16], lodPx: [70], particles: 900, props: 0.25, anisotropy: 1, shadow: 0, bloom: 0, grass: 0, post: false, weather: 0.3, fxBudget: 120 },
  low: { pr: 1, msaa: 0, cap: 1500, segments: [32, 12], bossSegments: [72, 24], lodPx: [70], particles: 1800, props: 0.5, anisotropy: 2, shadow: 0, bloom: 4, grass: 5000, post: true, weather: 0.5, fxBudget: 220 },
  medium: { pr: 1.25, msaa: 4, cap: 5000, segments: [56, 28, 12], bossSegments: [96, 40, 16], lodPx: [170, 48], particles: 3600, props: 0.8, anisotropy: 4, shadow: 2048, bloom: 5, grass: 18000, post: true, weather: 0.8, fxBudget: 420 },
  high: { pr: 1.75, msaa: 4, cap: 10000, segments: [72, 32, 16], bossSegments: [120, 56, 24], lodPx: [150, 40], particles: 5400, props: 1, anisotropy: 8, shadow: 4096, bloom: 5, grass: 32000, post: true, weather: 1, fxBudget: 640 },
  export: { pr: 1, msaa: 4, cap: 10000, segments: [72, 32, 16], bossSegments: [120, 56, 24], lodPx: [120, 32], particles: 5400, props: 1, anisotropy: 8, shadow: 4096, bloom: 5, grass: 32000, post: true, weather: 1, fxBudget: 640 },
};

/** The lightest first; the live adaptive ladder. */
export const LADDER: Quality[] = ["low", "medium", "high"];

export interface CameraPose {
  /** What the camera looks at. */
  tx: number;
  ty: number;
  tz: number;
  /** Heading round the target (radians; 0 looks along −z), pitch down (radians), distance (m). */
  yaw: number;
  pitch: number;
  dist: number;
  fov: number;
  /** Camera shake (m). */
  shake: number;
}

export interface DeployInput {
  arena: ArenaId;
  radius: number;
  species: MBSpecies[];
  /** Species shown with the hero relief, an aura and footsteps. */
  bosses: Set<number>;
  view: Pick<UnitsView, "n" | "sp" | "draw" | "side">;
  /** What the sky is doing (any of the battle's names for it), and when. */
  weather?: unknown;
  time?: unknown;
}

export interface SceneOptions {
  quality: Quality;
  /** Fixed drawing size (videos); otherwise the host's size. */
  size?: { w: number; h: number };
  tex(name: string, map: "diff" | "nor" | "rough"): string;
}

export interface BattleScene {
  canvas: HTMLCanvasElement;
  readonly quality: Quality;
  setQuality(q: Quality): void;
  resize(w: number, h: number): void;
  deploy(input: DeployInput, onProgress: (p: number, label: string) => void, signal?: AbortSignal): Promise<void>;
  readonly effects: Effects;
  readonly camera: THREE.PerspectiveCamera;
  setCamera(pose: CameraPose): void;
  /** Draws a frame: `dt` real seconds since the last, `bt` battle seconds (slow motion makes it smaller). */
  render(view: UnitsView | null, dt: number, bt?: number): void;
  /** A huge moment at a world point: the camera punches (radial blur, split colours), the screen flashes, the crowd roars. */
  punch(x: number, y: number, z: number, strength: number, type?: string): void;
  /** A world point on screen (CSS px), or null behind the camera. */
  project(x: number, y: number, z: number): { x: number; y: number } | null;
  heightAt(x: number, z: number): number;
  stats(): { calls: number; triangles: number; instances: number };
  /** The armies' layer (debugging). */
  units(): UnitsLayer | null;
  /** The look in use (the weather and time it shows). */
  readonly env: { weather: Weather; time: TimeOfDay; look: Look | null };
  /** A boss's footfall, a lightning strike (for the sound). */
  onStep: ((x: number, z: number, size: number) => void) | null;
  onThunder: ((strength: number) => void) | null;
  dispose(): void;
}

export const TEX_URL = (name: string, map: "diff" | "nor" | "rough") => `/sizes/tex/${name}_${map}.webp`;

export function createBattleScene(host: HTMLElement, opts: SceneOptions): BattleScene {
  let quality = opts.quality;
  let Q = QUALITY[quality];
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.setAttribute("aria-hidden", "true");
  host.appendChild(canvas);
  const usePost = Q.post;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !usePost && quality !== "draft", alpha: false, powerPreference: "high-performance", stencil: false, preserveDrawingBuffer: !!opts.size });
  // Counted per frame (shadow, scene and finishing passes together), not per pass.
  renderer.info.autoReset = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Real shadows from the first quality on up; turning them on later would recompile every shader mid-battle.
  const shadowsOn = Q.shadow > 0;
  renderer.shadowMap.enabled = shadowsOn;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const sizeOf = () => opts.size ?? { w: Math.max(1, host.clientWidth), h: Math.max(1, host.clientHeight) };
  let { w: W, h: H } = sizeOf();
  const pixelRatio = () => (opts.size ? 1 : Math.min(window.devicePixelRatio || 1, Q.pr));
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(W, H, false);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 6000);
  const effects = new Effects(effectCaps(Math.max(Q.particles, QUALITY.medium.particles)));
  effects.density = quality === "draft" ? 0.5 : quality === "low" ? 0.7 : 1;
  effects.setBudget(Q.fxBudget);
  effects.marksOn = quality !== "draft";
  scene.add(effects.group);
  let post: Post | null = null;
  // The finishing pass is made once: remaking it for a new quality would recompile its shaders mid-battle.
  const makePost = () => {
    if (!usePost || post) return;
    const pr = renderer.getPixelRatio();
    post = createPost(renderer, Math.round(W * pr), Math.round(H * pr), { msaa: Q.msaa, bloomMips: Q.bloom });
    if (look) applyGrade(look);
  };
  let arena: Arena | null = null;
  let arenaKey = "";
  let weatherLayer: WeatherLayer | null = null;
  let units: UnitsLayer | null = null;
  let look: Look | null = null;
  const env: BattleScene["env"] = { weather: "none", time: "day", look: null };
  let shake = 0;
  const shakeSeed = Math.random() * 100;
  let clock = 0;
  let kick = 0;
  let lastPunch = -10;
  let tremor = 0;
  const focus = new THREE.Vector3();
  let bossUnits: { i: number; type: string; h: number; w: number }[] = [];
  let auraAt = -1;
  let radius = 60;

  const applyGrade = (l: Look) => {
    if (!post) return;
    Object.assign(post.grade, { saturation: l.saturation, contrast: l.contrast, warmth: l.warmth, vignette: l.vignette, bloom: l.bloom, threshold: l.threshold });
  };

  const setCamera = (p: CameraPose) => {
    camera.fov = p.fov * (1 - kick * 0.08);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
    camera.position.set(p.tx + Math.sin(p.yaw) * cp * p.dist, p.ty + sp * p.dist, p.tz + Math.cos(p.yaw) * cp * p.dist);
    shake = p.shake + tremor * Math.min(1, p.dist * 0.05);
    if (shake > 0) {
      const k = clock * 37 + shakeSeed;
      camera.position.x += Math.sin(k * 1.3) * shake;
      camera.position.y += Math.sin(k * 1.7 + 1) * shake * 0.6;
      camera.position.z += Math.sin(k * 1.1 + 2) * shake;
    }
    const floor = (arena?.heightAt(camera.position.x, camera.position.z) ?? 0) + 0.25;
    if (camera.position.y < floor) camera.position.y = floor;
    camera.lookAt(p.tx, p.ty, p.tz);
    focus.set(p.tx, p.ty, p.tz);
  };

  // The sun's shadow follows what the camera looks at, sized to the view, snapped to its texels so it doesn't shimmer.
  const lightRight = new THREE.Vector3(), lightUp = new THREE.Vector3(), tmp = new THREE.Vector3();
  const fitShadow = () => {
    if (!arena || !shadowsOn) return;
    const sun = arena.sun;
    const d = Math.max(1, camera.position.distanceTo(focus));
    const extent = Math.min(radius * 1.8, Math.max(10, d * 0.62));
    const size = sun.shadow.mapSize.x;
    const texel = (extent * 2) / size;
    const dir = arena.sunDir;
    lightRight.crossVectors(tmp.set(0, 1, 0), dir).normalize();
    if (lightRight.lengthSq() < 1e-6) lightRight.set(1, 0, 0);
    lightUp.crossVectors(dir, lightRight).normalize();
    const fx = Math.round(focus.dot(lightRight) / texel) * texel;
    const fy = Math.round(focus.dot(lightUp) / texel) * texel;
    const fz = focus.dot(dir);
    const c = tmp.copy(lightRight).multiplyScalar(fx).addScaledVector(lightUp, fy).addScaledVector(dir, fz);
    const cam = sun.shadow.camera;
    const reach = extent * 2 + 40;
    sun.target.position.copy(c);
    sun.position.copy(c).addScaledVector(dir, reach);
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.near = 1;
    cam.far = reach * 2;
    cam.updateProjectionMatrix();
    sun.shadow.normalBias = texel * 1.2;
    sun.shadow.bias = -0.0004;
    sun.target.updateMatrixWorld();
  };

  async function deploy(input: DeployInput, onProgress: (p: number, label: string) => void, signal?: AbortSignal) {
    onProgress(0, "Preparing the battlefield");
    radius = input.radius;
    const weather = normWeather(input.weather);
    const time = normTime(input.time);
    env.weather = weather;
    env.time = time;
    // The arena (rebuilt only when it changes).
    const key = `${input.arena}|${Math.round(input.radius)}|${weather}|${time}|${quality === "draft" ? "d" : "f"}`;
    if (key !== arenaKey || !arena) {
      if (arena) {
        scene.remove(arena.group);
        arena.dispose();
      }
      if (weatherLayer) {
        scene.remove(weatherLayer.group);
        weatherLayer.dispose();
      }
      look = lookFor(input.arena, time, weather);
      env.look = look;
      arena = buildArena(input.arena, { radius: input.radius, props: Q.props, grass: Q.grass, anisotropy: Q.anisotropy, tex: opts.tex, look });
      scene.add(arena.group);
      weatherLayer = buildWeather(input.arena, weather, { density: Q.weather, radius: input.radius, night: time === "night" });
      scene.add(weatherLayer.group);
      weatherLayer.onFlash = (x, z, s) => {
        effects.lightning(x, z, radius * 1.2, effects.time.value);
        post?.flash(new THREE.Color(0.55, 0.62, 0.8), s * 0.6);
        self.onThunder?.(s);
      };
      arenaKey = key;
      const sun = arena.sun;
      if (shadowsOn) {
        sun.castShadow = true;
        sun.shadow.mapSize.set(Q.shadow, Q.shadow);
        sun.shadow.radius = 2;
      }
      scene.fog = new THREE.FogExp2(look.fog, look.fogDensity / (input.radius * 4.2));
      scene.background = new THREE.Color(look.fog);
      renderer.toneMappingExposure = look.exposure;
      // The figures' rim light and the effects' lighting follow the look.
      UNIT_LIGHT.uRim.value.set(look.rim).multiplyScalar(look.rimStrength);
      effects.light.uSun.value.copy(arena.sunDir);
      effects.light.uSunColor.value.set(look.sun).multiplyScalar(look.sunIntensity * 0.45);
      effects.light.uSky.value.set(look.hemiSky).multiplyScalar(look.hemiIntensity * 0.55);
      effects.light.uGround.value.set(look.hemiGround).multiplyScalar(look.hemiIntensity * 0.5);
      makePost();
      applyGrade(look);
    }
    camera.far = input.radius * 14 + 600;
    effects.clear();
    // The figures.
    onProgress(0.02, "Deploying armies");
    const assets = await loadAll(
      input.species.map((s) => ({ s, segments: input.bosses.has(s.id) ? Q.bossSegments : Q.segments, artSize: input.bosses.has(s.id) ? (512 as const) : (256 as const) })),
      (p) => onProgress(0.02 + p * 0.76, "Deploying armies"),
      signal
    );
    await arena!.ready;
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    units?.dispose();
    if (units) scene.remove(units.group);
    units = new UnitsLayer(input.species, assets, input.view, { lodPx: Q.lodPx, anisotropy: Q.anisotropy, shadows: shadowsOn, bosses: input.bosses });
    scene.add(units.group);
    const a = arena!;
    units.hooks = {
      step: (x, z, size) => {
        effects.step(x, z, size, a.dust, null);
        tremor = Math.max(tremor, Math.min(0.25, size * 0.025));
        self.onStep?.(x, z, size);
      },
      dust: (x, z, size) => effects.dust(x, z, size, a.dust),
    };
    bossUnits = [];
    for (let i = 0; i < input.view.n; i++) {
      const s = input.species[input.view.sp[i]];
      if (s && input.bosses.has(s.id) && input.view.draw[i]) {
        const sz = figureSize(s);
        bossUnits.push({ i, type: s.types[0] ? s.types[0][0].toUpperCase() + s.types[0].slice(1) : "Normal", h: sz.h, w: sz.w });
      }
    }
    auraAt = -1;
    // Compile every shader and upload every texture and buffer now, with one of each figure and effect on screen,
    // for the target they are drawn into (the HDR target: compiled for the screen they'd be the wrong programs).
    onProgress(0.82, "Warming up");
    for (const t of units.textures()) renderer.initTexture(t);
    units.primeAll(new THREE.Vector3(0, 0, 0));
    effects.primeAll();
    setCamera({ tx: 0, ty: 1, tz: 0, yaw: 0.6, pitch: 0.5, dist: input.radius * 1.2, fov: 40, shake: 0 });
    fitShadow();
    const was = renderer.getRenderTarget();
    try {
      if (post) renderer.setRenderTarget(post.target);
      await renderer.compileAsync(scene, camera).catch(() => undefined);
    } finally {
      renderer.setRenderTarget(was);
    }
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    onProgress(0.95, "Warming up");
    // One full frame (shadow pass, finishing pass) so their programs are ready too.
    drawFrame(0);
    effects.setTime(0);
    onProgress(1, "Ready");
  }

  function drawFrame(dt: number) {
    renderer.info.reset();
    if (shadowsOn) fitShadow();
    if (post) post.render(renderer, scene, camera, dt);
    else renderer.render(scene, camera);
  }

  function render(view: UnitsView | null, dt: number, bt = dt) {
    clock += dt;
    kick = Math.max(0, kick - dt * 3);
    tremor = Math.max(0, tremor - dt * 1.6);
    if (view) {
      units?.update(view, camera, H, dt, bt);
      // Bosses glow: motes rising round them, a disc of light under them.
      for (const b of bossUnits) {
        const fa = (view as UnitsView).faintAt[b.i];
        if (fa >= 0) continue;
        effects.aura(b.type, view.x[b.i], view.z[b.i], b.h, b.w, bt, view.t);
        if (view.t - auraAt > 0.45 || view.t < auraAt) effects.auraDisc(b.type, view.x[b.i], view.z[b.i], Math.max(1.2, b.w * 0.9), view.t);
      }
      if (bossUnits.length && (view.t - auraAt > 0.45 || view.t < auraAt)) auraAt = view.t;
      effects.setTime(view.t);
      arena?.update(view.t, focus, camera);
      weatherLayer?.update(view.t, camera, focus);
    } else {
      effects.setTime(clock);
      arena?.update(clock, focus, camera);
      weatherLayer?.update(clock, camera, focus);
    }
    drawFrame(dt);
    // The next frame's effects: a fresh budget, sized from this camera.
    effects.frame(camera, H);
  }

  const v3 = new THREE.Vector3();
  const self: BattleScene = {
    canvas,
    get quality() {
      return quality;
    },
    env,
    onStep: null,
    onThunder: null,
    setQuality(q) {
      quality = q;
      Q = QUALITY[q];
      renderer.setPixelRatio(pixelRatio());
      renderer.setSize(W, H, false);
      if (post) {
        makePost();
        const pr = renderer.getPixelRatio();
        post?.setSize(Math.round(W * pr), Math.round(H * pr));
      }
      if (units) units.opts.lodPx = Q.lodPx;
      effects.density = q === "draft" ? 0.5 : q === "low" ? 0.7 : 1;
      effects.setBudget(Q.fxBudget);
      if (arena && shadowsOn) {
        // Lighter qualities keep the shadows (no recompiling) at a smaller map.
        const size = Math.max(1024, Q.shadow || 1024);
        if (arena.sun.shadow.mapSize.x !== size) {
          arena.sun.shadow.mapSize.set(size, size);
          arena.sun.shadow.map?.dispose();
          (arena.sun.shadow as unknown as { map: THREE.WebGLRenderTarget | null }).map = null;
        }
      }
    },
    resize(w, h) {
      W = Math.max(1, w);
      H = Math.max(1, h);
      renderer.setSize(W, H, false);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      const pr = renderer.getPixelRatio();
      post?.setSize(Math.round(W * pr), Math.round(H * pr));
    },
    deploy,
    effects,
    camera,
    setCamera,
    render,
    punch(x, y, z, strength, type) {
      // At most one punch a second (a pile of hits on the boss is one big moment, not a strobe).
      if (clock - lastPunch < 0.9 && strength < 0.95) return;
      lastPunch = clock;
      const s = Math.min(1, Math.max(0, strength));
      kick = Math.max(kick, s);
      const p = v3.set(x, y, z).project(camera);
      if (p.z < 1 && p.z > -1) post?.punch(s, (p.x + 1) / 2, (p.y + 1) / 2);
      const L = typeLook(type ?? "Normal");
      post?.flash(L.glow, s * 0.18);
      arena?.cheer(0.5 + s * 0.5);
    },
    project(x, y, z) {
      const v = v3.set(x, y, z).project(camera);
      if (v.z > 1 || v.z < -1) return null;
      return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H };
    },
    heightAt: (x, z) => arena?.heightAt(x, z) ?? 0,
    units: () => units,
    stats() {
      const d = units?.drawn ?? { instances: 0, triangles: 0, calls: 0 };
      return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, instances: d.instances };
    },
    dispose() {
      units?.dispose();
      arena?.dispose();
      weatherLayer?.dispose();
      effects.dispose();
      post?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
  makePost();
  if (post) (post as Post).setSize(Math.round(W * renderer.getPixelRatio()), Math.round(H * renderer.getPixelRatio()));
  return self;
}
