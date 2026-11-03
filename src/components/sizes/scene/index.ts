import * as THREE from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { CSM } from "three/examples/jsm/csm/CSM.js";
import { layoutLine } from "@/lib/sizes/types";
import { ROOF_Y, planWorld, type WorldPlan } from "@/lib/sizes/world";
import { FACING, poseFor, type View } from "@/lib/sizes/camera";
import type { FarManifest } from "@/lib/sizes/far";
import FAR_MANIFEST from "@/data/sizes-far.json";
import { buildCity, type City } from "./city";
import { buildProps, type Props } from "./props";
import { buildTower, type Tower } from "./tower";
import { ModelProvider, ReliefProvider, buildRef, contactShadowTexture, type FigureHandle, type FigureProvider, type FigureUrls, type Lod, type RefBuilders, type SceneItem } from "./figures";
import { createPost, type Post } from "./post";
import { Crowd, type CrowdInstance } from "./crowd";
import { sharedUniforms } from "./shaders";
import { SKY, createSky } from "./sky";
import { createTrace, traceBare, type Drawn, type TraceFigure } from "./trace";

/**
 * The 3D scene behind /pokedex/sizes and its videos: a sunny Lumiose City
 * tribute, the line of figures walking down the Grand Boulevard and round
 * Prism Tower. The page (or the video recorder) owns the clock and the
 * camera plan; the scene draws a frame for a View and reports where each
 * figure's badge belongs.
 *
 * Every figure is always drawn in 3D. Far ones are the crowd's low-detail
 * reliefs (one instanced draw, from an atlas that arrives with the page);
 * near ones have their own relief mesh, built ahead of time: the page tells
 * the scene where the camera is going (prefetch) and the figures it will
 * need are fetched, decoded, built and uploaded seconds before they are
 * seen. A figure changing detail dissolves over a few frames; if the camera
 * outruns the loading anyway, pending() says so and the page eases the
 * camera instead of showing anything less. Loaded only on this page.
 */

/** "draft" is for automated checks (no shadows or post effects): never offered to people. */
export type Quality = "draft" | "low" | "medium" | "high" | "export";

interface QualitySpec {
  pr: number;
  msaa: number;
  ao: boolean;
  aoSamples: number;
  dof: boolean;
  dofSamples: 16 | 32;
  bloom: boolean;
  shadow: number;
  cascades: number;
  /** Share of the full city radius to build (phones build less). */
  blocks: number;
  facadeScale: 1 | 2;
  texSize: 256 | 512;
  /** Grid of a relief mesh (cells on the box's longest side): lighter on the light qualities, which draw more of them at once. */
  segments?: number;
  trees: boolean;
  /** Most figures drawn with their own relief mesh at once (the biggest on screen); the rest are the crowd's. */
  maxRelief: number;
  /** Most relief meshes kept built (on screen, coming up, or just passed). */
  resident: number;
  /** Most far figures drawn (the biggest on screen first), and whether they cast shadows into the cascades. */
  crowd: number;
  crowdShadows: boolean;
  anisotropy: number;
}

export const QUALITY: Record<Quality, QualitySpec> = {
  draft: { pr: 1, msaa: 0, ao: false, aoSamples: 8, dof: false, dofSamples: 16, bloom: false, shadow: 512, cascades: 1, blocks: 0.2, facadeScale: 1, texSize: 256, segments: 56, trees: false, maxRelief: 4, resident: 24, crowd: 400, crowdShadows: false, anisotropy: 1 },
  low: { pr: 1, msaa: 0, ao: false, aoSamples: 8, dof: false, dofSamples: 16, bloom: false, shadow: 1024, cascades: 2, blocks: 0.45, facadeScale: 1, texSize: 256, segments: 56, trees: true, maxRelief: 16, resident: 64, crowd: 650, crowdShadows: false, anisotropy: 2 },
  medium: { pr: 1.25, msaa: 4, ao: false, aoSamples: 8, dof: true, dofSamples: 16, bloom: true, shadow: 2048, cascades: 3, blocks: 0.75, facadeScale: 1, texSize: 512, trees: true, maxRelief: 18, resident: 64, crowd: 1000, crowdShadows: true, anisotropy: 4 },
  high: { pr: 1.5, msaa: 4, ao: true, aoSamples: 12, dof: true, dofSamples: 32, bloom: true, shadow: 2048, cascades: 3, blocks: 1, facadeScale: 1, texSize: 512, trees: true, maxRelief: 28, resident: 80, crowd: 1200, crowdShadows: true, anisotropy: 8 },
  export: { pr: 1, msaa: 4, ao: true, aoSamples: 24, dof: true, dofSamples: 32, bloom: true, shadow: 4096, cascades: 4, blocks: 1, facadeScale: 2, texSize: 512, trees: true, maxRelief: 40, resident: 100, crowd: 1200, crowdShadows: true, anisotropy: 8 },
};

export interface SceneUrls extends FigureUrls {
  tex(name: string, map: "diff" | "nor" | "rough"): string;
  hdr: string;
}

export interface SceneOptions {
  quality: Quality;
  urls: SceneUrls;
  trainer?: RefBuilders["trainer"];
  /** Tier 2 models (art id → GLB url). */
  models?: Record<string, string>;
  /** Fixed drawing size (exports); otherwise the host's size. */
  size?: { w: number; h: number };
  /** The far atlas (src/data/sizes-far.json by default). */
  far?: FarManifest;
}

export interface Placed {
  key: string;
  x: number;
  w: number;
  h: number;
}

export interface Anchor {
  index: number;
  item: SceneItem;
  /** Badge point (top centre of the figure), CSS pixels. */
  x: number;
  y: number;
  /** Screen height of the figure (px) and its distance (m). */
  sh: number;
  dist: number;
  /** Bottom of the figure on screen (px). */
  by: number;
}

/** A view the camera will reach `dt` seconds from now. */
export interface FutureView {
  view: View;
  dt: number;
}

export interface SizesScene {
  canvas: HTMLCanvasElement;
  setLine(items: SceneItem[]): { placed: Placed[]; plan: WorldPlan };
  /** Height of the figures around a point on the line (smoothed, m). */
  heightAt(x: number): number;
  setView(v: View): void;
  /** Where the camera is going: the figures those views need are built ahead of time, the soonest first. */
  prefetch(views: FutureView[]): void;
  /**
   * How far the loading is behind the camera: 0 when every figure on
   * screen has the detail it needs, up to 1 when a big one is still
   * waiting for it (the page eases the camera meanwhile).
   */
  pending(): number;
  /** Draw a frame (t: seconds of scene time, for idle motion). */
  render(t: number, dt: number): void;
  /** Wait until every figure the current view needs is built (exports, screenshots). */
  settle(timeoutMs?: number): Promise<void>;
  /** Compile every figure shader now (before the first frame), so none compiles mid-glide. */
  warm(): void;
  anchors(): Anchor[];
  resize(w: number, h: number): void;
  /** Adaptive quality: pixel ratio, post effects and figure detail (the city and shadow maps keep what they were built with). */
  setQuality(q: Quality): void;
  readonly quality: Quality;
  /** Ready to draw (environment and the far atlas loaded). */
  ready: Promise<void>;
  stats(): { figures: number; relief: number; crowd: number; loading: number; calls: number; tris: number };
  /** The three.js objects behind the scene, for profiling and debugging tools. */
  internals(): { scene: THREE.Scene; renderer: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera; world: THREE.Group; figures: THREE.Group; sky: THREE.Object3D };
  dispose(): void;
}

const SUN_ELEVATION = (41 * Math.PI) / 180;

/** On-screen heights (px) where a figure takes its own relief mesh (and gives it back below the second, so it never flickers), and its hero mesh. */
const NEAR_IN = 52, NEAR_OUT = 40, HERO_IN = 300, HERO_OUT = 240;
/** A figure coming up this big (px) within the look-ahead is built ahead of time. */
const NEED_PX = NEAR_IN * 0.8;
/** Dissolve length between levels of detail (seconds). */
const FADE_S = 0.3;
/** Figures loading at once (each is two small files). */
const MAX_LOADS = 10;

type Level = 0 | 1 | 2 | 3; // nothing, crowd, relief, hero

interface Slot {
  index: number;
  item: SceneItem;
  /** Distance along the line. */
  x: number;
  /** Feet in the world and the direction the figure faces. */
  wx: number;
  wz: number;
  yaw: number;
  /** Sideways step off the line (the companion). */
  z?: number;
  w: number;
  h: number;
  /** Built meshes: [hero, relief] by Lod. */
  mesh: [FigureHandle | null, FigureHandle | null];
  /** On the GPU (texture uploaded): may be drawn. */
  up: [boolean, boolean];
  loading: [AbortController | null, AbortController | null];
  /** Its relief couldn't load (offline, missing art): it stays the crowd's. */
  failed: boolean;
  phase: number;
  update?: (t: number, dt: number) => void;
  /** This frame: on screen, and how tall (px). */
  inView: boolean;
  sh: number;
  /** Seconds until the camera needs its relief mesh (Infinity: not coming up). */
  need: number;
  /** What is drawn, and what is dissolving out (with the dissolve's progress 0..1). */
  draw: Level;
  from: Level;
  t: number;
  /** In view on the last frame (a figure already on screen dissolves in rather than appearing). */
  seen: boolean;
  /** Trace: when its relief became ready, and when it was first needed in view. */
  readyAt: number;
  neededAt: number;
  lastNear: number;
}

export function createSizesScene(host: HTMLElement, opts: SceneOptions): SizesScene {
  let quality: Quality = opts.quality;
  let Q = QUALITY[quality];
  const Q0 = Q;
  const exporting = opts.quality === "export";
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  host.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance", stencil: false });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.97;
  renderer.shadowMap.enabled = opts.quality !== "draft";
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Shadow maps are redrawn when the camera or the figures change, and only every few frames while all is still (see render).
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  const sizeOf = () => opts.size ?? { w: Math.max(1, host.clientWidth), h: Math.max(1, host.clientHeight) };
  let { w: W, h: H } = sizeOf();
  const pr = opts.size ? 1 : Math.min(window.devicePixelRatio || 1, Q.pr);
  renderer.setPixelRatio(pr);
  renderer.setSize(W, H, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(W / H < 0.8 ? 46 : 35, W / H, 0.05, 9000);
  const shared = sharedUniforms();
  const maxAniso = Math.min(Q.anisotropy, renderer.capabilities.getMaxAnisotropy());

  // ---- Sun, sky and haze.
  const yawToCam = FACING; // figures on the boulevard face the camera
  // The sun stands in front of the figures and to the camera's left, as in the classic size-comparison videos:
  // faces and the facades behind them are lit, shadows fall back and to the right. The line only ever turns
  // away from the camera (round the tower), so the sun stays in front of every figure.
  const az = yawToCam - Math.PI * 0.25;
  const sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(SUN_ELEVATION), Math.sin(SUN_ELEVATION), Math.cos(az) * Math.cos(SUN_ELEVATION)).normalize();
  const sky = createSky(sunDir);
  scene.add(sky.mesh);
  scene.fog = new THREE.FogExp2(SKY.haze.clone().convertSRGBToLinear(), 0.0003);
  const hemi = new THREE.HemisphereLight(0xdcE8ff, 0xc2ab88, 0.38);
  scene.add(hemi);

  // Camera state (read by the shadow cascades' split callback).
  let view: View = { x: 0, d: 2, h: 1, orbit: 0, pitch: 0.07, rise: 0 };
  let focusD = 2;

  const csm = new CSM({
    camera,
    parent: scene,
    cascades: Q.cascades,
    maxFar: 400,
    mode: "custom",
    shadowMapSize: Q.shadow,
    lightDirection: sunDir.clone().negate(),
    lightIntensity: 3.75,
    lightNear: 1,
    lightFar: 6000,
    lightMargin: 120,
    customSplitsCallback: (n: number, near: number, far: number, breaks: number[]) => {
      // First cascade hugs the framed figure, the rest spread to the far limit.
      const first = Math.min(0.5, (focusD * 4) / far);
      breaks.length = 0;
      for (let i = 1; i <= n; i++) breaks.push(i === 1 ? first : first + (1 - first) * Math.pow((i - 1) / (n - 1), 1.6));
      void near;
    },
  });
  csm.fade = true;
  // Warm late-morning sun.
  for (const l of csm.lights) l.color.set("#fff0d9");
  const csmMaterials = new Set<THREE.Material>();
  const setupMat = (m: THREE.Material) => {
    if (csmMaterials.has(m) || !(m as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
    const prev = m.onBeforeCompile;
    csm.setupMaterial(m);
    const csmFn = m.onBeforeCompile;
    m.onBeforeCompile = (s, r) => { csmFn.call(m, s, r); prev?.call(m, s, r); };
    csmMaterials.add(m);
  };
  const setupTree = (o: THREE.Object3D) => o.traverse((c) => { const mm = (c as THREE.Mesh).material; if (mm) (Array.isArray(mm) ? mm : [mm]).forEach(setupMat); });

  // ---- Environment (sky light and reflections from a CC0 HDRI), aligned to our sun.
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envTex: THREE.Texture | null = null;
  const envReady = new RGBELoader().loadAsync(opts.urls.hdr).then((hdr) => {
    // Find the HDRI's sun (brightest texel) to turn the map so it agrees with ours.
    const img = hdr.image as unknown as { data: Uint16Array | Float32Array; width: number; height: number };
    let best = 0, bi = 0;
    const isHalf = img.data instanceof Uint16Array;
    for (let i = 0; i < img.width * img.height; i++) {
      const r = isHalf ? THREE.DataUtils.fromHalfFloat(img.data[i * 4]) : img.data[i * 4];
      if (r > best) { best = r; bi = i; }
    }
    const u = (bi % img.width) / img.width;
    // Equirect lookup: u = atan2(dir.z, dir.x) / 2π + 0.5.
    const hdrAz = (u - 0.5) * Math.PI * 2;
    const ourAz = Math.atan2(sunDir.z, sunDir.x);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    envTex = pmrem.fromEquirectangular(hdr).texture;
    hdr.dispose();
    scene.environment = envTex;
    scene.environmentIntensity = 0.62;
    scene.environmentRotation.set(0, ourAz - hdrAz, 0);
  }).catch(() => {
    // No HDRI: the sky and hemisphere light still light the scene.
  });

  // ---- Texture sets.
  const loader = new THREE.TextureLoader();
  const texCache = new Map<string, THREE.Texture>();
  const loadTex = (name: string, map: "diff" | "nor" | "rough") => {
    const key = `${name}:${map}`;
    let t = texCache.get(key);
    if (!t) {
      t = loader.load(opts.urls.tex(name, map));
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = maxAniso;
      t.colorSpace = map === "diff" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texCache.set(key, t);
    }
    return t;
  };
  const pbr = (name: string, tile: number, o: { color?: string; normalScale?: number } = {}): THREE.MeshStandardMaterialParameters => {
    void tile;
    return {
      map: loadTex(name, "diff"),
      normalMap: loadTex(name, "nor"),
      roughnessMap: loadTex(name, "rough"),
      normalScale: new THREE.Vector2(o.normalScale ?? 1, o.normalScale ?? 1),
      color: o.color ?? "#ffffff",
      roughness: 1,
      metalness: 0,
    };
  };

  // ---- World.
  const worldGroup = new THREE.Group();
  scene.add(worldGroup);
  let city: City | null = null, props: Props | null = null, tower: Tower | null = null;
  let plan: WorldPlan = planWorld([]);
  const halo = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(230,253,255,1)");
    grad.addColorStop(0.2, "rgba(140,228,255,0.55)");
    grad.addColorStop(0.5, "rgba(110,205,255,0.16)");
    grad.addColorStop(1, "rgba(100,200,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }));
    s.scale.setScalar(118);
    return s;
  })();

  // ---- Figures.
  const providers: FigureProvider[] = [];
  if (opts.models && Object.keys(opts.models).length) providers.push(new ModelProvider(opts.models));
  const relief = new ReliefProvider(opts.urls, { anisotropy: maxAniso, sharpen: opts.quality === "export" ? 0.55 : 0.45, texSize: Q.texSize, coverage: Q.msaa > 0, segments: Q.segments });
  providers.push(relief);
  let slots: Slot[] = [];
  let companion: Slot | null = null;
  /** The line and its companion, as one list (kept, not rebuilt every frame). */
  let everyone: Slot[] = [];
  const figureGroup = new THREE.Group();
  scene.add(figureGroup);
  const shadowTex = contactShadowTexture();
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, color: 0x000000, opacity: 0.6 });
  shadowMat.polygonOffset = true;
  shadowMat.polygonOffsetFactor = -2;
  const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  // Far figures: the crowd of low-detail reliefs (one instanced draw).
  const crowd = new Crowd(renderer, opts.far ?? (FAR_MANIFEST as FarManifest));
  crowd.setCoverage(Q.msaa > 0);
  figureGroup.add(crowd.mesh);
  // Contact shadows under every figure drawn, whatever its detail (one instanced draw).
  const BLOBS = 1400;
  const blobs = new THREE.InstancedMesh(shadowGeo, shadowMat, BLOBS);
  blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  blobs.count = 0;
  blobs.frustumCulled = false;
  blobs.renderOrder = 1;
  figureGroup.add(blobs);
  const ready = Promise.all([envReady, Promise.race([crowd.ready, new Promise((r) => setTimeout(r, 12000))])]).then(() => undefined);
  // Built figures wait here for their turn on the GPU: a few per frame, each compiled before it's shown.
  const toUpload: { s: Slot; lod: 0 | 1; h: FigureHandle }[] = [];
  let compiling = 0;
  // The shadow maps need redrawing (a figure came or went, the quality or size changed).
  let shadowsDirty = true;
  let logH: number[] = [];
  let xs: number[] = [];
  let loadingCount = 0;
  let frameNo = 0;
  let lastDt = 1 / 60;

  const newSlot = (item: SceneItem, index: number, x: number, w: number, h: number, z = 0): Slot => {
    const at = plan.path.at(x);
    // The path's frame: along it is local x, its right (away from the camera) local z.
    const wx = at.x - Math.sin(at.heading) * z, wz = at.z + Math.cos(at.heading) * z;
    return { index, item, x, wx, wz, yaw: FACING - at.heading, z, w, h, mesh: [null, null], up: [false, false], loading: [null, null], failed: false, phase: (index * 2.399) % (Math.PI * 2), inView: false, sh: 0, need: Infinity, draw: 0, from: 0, t: 1, seen: false, readyAt: 0, neededAt: 0, lastNear: -1e9 };
  };

  function setLine(items: SceneItem[]) {
    for (const s of slots) dropSlot(s);
    if (companion) dropSlot(companion);
    companion = null;
    const placed = layoutLine(items.map((i) => ({ m: i.m, length: i.length, bw: i.box[2], bh: i.box[3] })));
    plan = planWorld(placed);
    // The ten-storey building stands a step off the giants' ring on the camera's side (on the paving short of the parterres): on the ring itself it would hide Prism Tower's legs and the giant after it.
    const aside = (item: SceneItem, i: number) => (item.ref === "building" && plan.ring && placed[i].x > plan.ring.s0 ? -Math.min(22, placed[i].w * 1.6) : 0);
    slots = items.map((item, i) => newSlot({ ...item, w: placed[i].w, h: placed[i].h }, i, placed[i].x, placed[i].w, placed[i].h, aside(item, i)));
    xs = slots.map((s) => s.x);
    // Smoothed log heights (same idea as the camera's distance), for aiming.
    const raw = slots.map((s) => Math.log(Math.max(0.02, s.h)));
    logH = raw.map((_, i) => {
      let sum = 0, n = 0;
      // Bilateral, like the camera's distance: a giant next door must not lift the aim off a human-sized figure.
      for (let k = -3; k <= 3; k++) { const j = i + k; if (j < 0 || j >= raw.length) continue; const dl = raw[j] - raw[i]; const wt = Math.exp(-(k * k) / 4) * Math.exp(-(dl * dl) / 0.18); sum += raw[j] * wt; n += wt; }
      return Math.max(sum / n, raw[i] - 0.05);
    });
    rebuildWorld();
    traceFigs = [];
    // A companion at the start: tiny figures stand at a person's feet.
    const humanAt = items.findIndex((i) => i.ref === "human" || i.ref === "trainer");
    const human = humanAt >= 0 ? items[humanAt] : undefined;
    // Not when the line's own human already stands near the start (a comparison).
    if (human && slots.length && slots[0].h < 0.6 && humanAt > 4) {
      // A step to the side and behind the line: a person in the background, not a wall beside the lens.
      companion = newSlot({ ...human, key: "companion" }, -1, slots[0].x - slots[0].w / 2 - 1.1, human.w, human.h, 0.9);
    }
    everyone = companion ? [companion, ...slots] : slots;
    return { placed: slots.map((s) => ({ key: s.item.key, x: s.x, w: s.w, h: s.h })), plan };
  }

  function rebuildWorld() {
    city?.dispose();
    props?.dispose();
    tower?.dispose();
    worldGroup.clear();
    city = buildCity(plan, shared, { pbr }, { facadeScale: Q.facadeScale, anisotropy: maxAniso, blocks: Q.blocks });
    props = buildProps(plan, shared, { bark: pbr("bark_brown_02", 1.5) }, { trees: Q.trees, coverage: Q.msaa > 0 });
    tower = buildTower(plan.tower.x, plan.tower.z);
    worldGroup.add(city.group, props.group, tower.group);
    halo.position.copy(tower.crown);
    worldGroup.add(halo);
    setupTree(worldGroup);
    if (traceBare()) worldGroup.visible = false;
  }

  function heightAt(x: number): number {
    if (!xs.length) return 1;
    if (x <= xs[0]) return Math.exp(logH[0]);
    const last = xs.length - 1;
    if (x >= xs[last]) return Math.exp(logH[last]);
    let lo = 0, hi = last;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
    const f = (x - xs[lo]) / Math.max(1e-9, xs[hi] - xs[lo]);
    return Math.exp(logH[lo] + (logH[hi] - logH[lo]) * f);
  }

  /** Removes a built mesh from the slot (and the scene). */
  function dropMesh(s: Slot, lod: 0 | 1) {
    s.loading[lod]?.abort();
    s.loading[lod] = null;
    const h = s.mesh[lod];
    if (!h) return;
    if (h.object.parent) { figureGroup.remove(h.object); shadowsDirty = true; }
    h.dispose();
    s.mesh[lod] = null;
    s.up[lod] = false;
    const lvl: Level = lod === 0 ? 3 : 2;
    if (s.draw === lvl) { s.draw = 0; s.t = 1; }
    if (s.from === lvl) s.from = 0;
  }

  function dropSlot(s: Slot) {
    dropMesh(s, 0);
    dropMesh(s, 1);
    s.update = undefined;
    s.draw = s.from = 0;
  }

  function startLoad(s: Slot, lod: 0 | 1, urgent: boolean) {
    const ac = new AbortController();
    s.loading[lod] = ac;
    loadingCount++;
    const item = s.item;
    const job = item.ref
      ? buildRef(item, { trainer: opts.trainer })
      : (providers.find((p) => p.has(item)) ?? providers[providers.length - 1]).load(item, lod as Lod, ac.signal, { priority: urgent ? "high" : "low" });
    job.then((h) => {
      loadingCount--;
      if (ac.signal.aborted || s.loading[lod] !== ac) { h.dispose(); return; }
      s.loading[lod] = null;
      s.mesh[lod]?.dispose();
      s.mesh[lod] = h;
      s.up[lod] = false;
      const o = h.object;
      o.position.set(s.wx, 0, s.wz);
      o.rotation.y = s.yaw;
      h.materials.forEach(setupMat);
      toUpload.push({ s, lod, h });
    }, () => {
      // A figure that can't load (offline, missing art) stays the crowd's.
      loadingCount--;
      if (s.loading[lod] === ac) {
        s.loading[lod] = null;
        if (lod === 1) s.failed = true;
      }
    });
  }

  /** Puts built figures on the GPU, a few per frame (all at once in `sync`): textures uploaded, custom shaders compiled first. */
  function uploadSome(budgetMs: number, sync = false) {
    const t0 = performance.now();
    while (toUpload.length && (sync || performance.now() - t0 < budgetMs)) {
      // The soonest needed first.
      let bi = 0;
      for (let i = 1; i < toUpload.length; i++) if (toUpload[i].s.need < toUpload[bi].s.need) bi = i;
      const { s, lod, h } = toUpload.splice(bi, 1)[0];
      if (s.mesh[lod] !== h) continue;
      for (const m of h.materials) { const map = (m as THREE.MeshStandardMaterial).map; if (map) renderer.initTexture(map); }
      const done = () => {
        if (s.mesh[lod] !== h) return;
        s.up[lod] = true;
        s.readyAt = performance.now();
        s.update = (h as { update?: (t: number, dt: number) => void }).update ?? s.update;
      };
      // Relief figures share the shaders warm() compiled; references and models bring their own, compiled before they're shown.
      if (sync || (!s.item.ref && !h.custom)) { done(); continue; }
      compiling++;
      compileFor(h.object).then(done, done).finally(() => { compiling--; });
      if (!sync) break;
    }
  }

  // ---- Camera.
  const target = new THREE.Vector3();
  /** The frame the camera draws (the finale composes Prism Tower for it). */
  const lens = { vfov: 35, aspect: 1 };
  const lensNow = () => { lens.vfov = camera.fov; lens.aspect = camera.aspect; return lens; };
  function applyView() {
    const p = poseFor(view, plan.path, lensNow());
    camera.position.set(...p.position);
    target.set(...p.target);
    camera.lookAt(target);
    focusD = camera.position.distanceTo(target);
    camera.near = Math.max(0.01, Math.min(4, focusD * 0.035));
    camera.far = 9000;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    csm.maxFar = Math.max(260, focusD * 9);
    csm.lightMargin = Math.max(90, view.h * 3);
    csm.updateFrustums();
    for (const l of csm.lights) {
      l.shadow.camera.far = csm.lightMargin * 2 + csm.maxFar * 3;
      const cam = l.shadow.camera;
      const texel = (cam.right - cam.left) / Q0.shadow;
      l.shadow.normalBias = texel * 1.6;
      l.shadow.bias = -0.0002;
      cam.updateProjectionMatrix();
    }
    shared.uniforms.uCutA.value.copy(camera.position);
    shared.uniforms.uCutB.value.copy(target);
    // Above the rooftops (the giants, the finale) nothing is in the way: cutting would only punch holes in the roofs.
    shared.uniforms.uCutR.value = view.rise > 0.25 || camera.position.y > ROOF_Y + 2 ? 0 : Math.max(0.25, Math.max(view.h, 0.6 * view.d * 0.6) * 0.55);
    city?.update(camera.position, csm.maxFar * 1.3);
  }

  // ---- What is on screen, and how big.
  const tmpV = new THREE.Vector3();
  const projScale = (cam: THREE.PerspectiveCamera, hPx: number) => hPx / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
  /** On screen in this camera, and how tall (px): -1 when not. */
  function screenHeight(s: Slot, cam: THREE.PerspectiveCamera, ps: number): number {
    tmpV.set(s.wx, s.h / 2, s.wz);
    const dist = tmpV.distanceTo(cam.position);
    tmpV.project(cam);
    const half = (Math.max(s.w, s.h) / Math.max(0.01, dist)) * 1.6;
    if (!(tmpV.z < 1 && Math.abs(tmpV.x) < 1.05 + half && tmpV.y > -1.05 - half && tmpV.y < 1.05 + half)) return -1;
    return (s.h / Math.max(0.01, dist)) * ps;
  }
  let centre = 0;
  function scan() {
    const ps = projScale(camera, H);
    let lo = 0, hi = slots.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= view.x) lo = mid; else hi = mid; }
    centre = lo;
    const all = everyone;
    for (const s of all) {
      const sh = screenHeight(s, camera, ps);
      s.inView = sh >= 2;
      s.sh = Math.max(0, sh);
    }
  }

  // ---- Look-ahead: which figures the coming views need, and how soon.
  const futureCam = new THREE.PerspectiveCamera();
  let futures: FutureView[] = [];
  let needsAt = -1;
  function computeNeeds() {
    const all = everyone;
    for (const s of all) s.need = Infinity;
    futureCam.fov = camera.fov;
    futureCam.aspect = camera.aspect;
    futureCam.near = 0.05;
    futureCam.far = 9000;
    futureCam.updateProjectionMatrix();
    const ps = projScale(futureCam, H);
    // Now, then each view the page says is coming.
    const list: FutureView[] = [{ view, dt: 0 }, ...futures];
    for (const f of list) {
      const p = poseFor(f.view, plan.path, lensNow());
      futureCam.position.set(...p.position);
      futureCam.lookAt(tmpV.set(...p.target));
      futureCam.updateMatrixWorld();
      // Only figures within reach of that view: bigger ones ahead show from further off.
      const reach = 2 * f.view.d * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * Math.max(1, camera.aspect) * 3 + 40;
      let a = 0, b = slots.length;
      { let l = 0, h = slots.length; while (l < h) { const m = (l + h) >> 1; if (xs[m] < f.view.x - reach) l = m + 1; else h = m; } a = l; }
      { let l = a, h = slots.length; while (l < h) { const m = (l + h) >> 1; if (xs[m] <= f.view.x + reach * 4) l = m + 1; else h = m; } b = l; }
      for (let i = a; i < b; i++) {
        const s = slots[i];
        if (s.need <= f.dt) continue;
        const sh = screenHeight(s, futureCam, ps);
        if (sh >= NEED_PX || (s.item.ref && sh >= 2)) s.need = f.dt;
      }
      if (companion && companion.need > f.dt && screenHeight(companion, futureCam, ps) >= 2) companion.need = f.dt;
    }
  }

  /** Starts the loads the look-ahead asks for, soonest first; drops built figures nobody needs when over budget. */
  function pump() {
    const all = everyone;
    const want: Slot[] = [];
    let built = 0;
    for (const s of slots) if (s.mesh[1] || s.loading[1]) built++;
    for (const s of all) if (s.need < Infinity && !s.mesh[1] && !s.loading[1] && !s.failed && (s.item.ref || s.item.art)) want.push(s);
    want.sort((a, b) => a.need - b.need || b.sh - a.sh);
    for (const s of want) {
      if (loadingCount >= MAX_LOADS) break;
      // Over the memory budget only what is needed soon still starts (what is no longer coming up makes room below).
      if (built >= Q.resident && s.need > 1.2) break;
      startLoad(s, 1, s.need < 0.8);
      built++;
    }
    // Heroes: the framed figure when it fills the screen.
    for (let k = Math.max(0, centre - 2); k <= Math.min(slots.length - 1, centre + 3); k++) {
      const s = slots[k];
      if (!s.item.ref && s.inView && s.sh >= HERO_IN && !s.mesh[0] && !s.loading[0] && loadingCount < MAX_LOADS + 2) startLoad(s, 0, true);
    }
    // Over budget: let go of what is furthest from the camera and not coming up.
    if (built > Q.resident) {
      const spare = slots.filter((s) => (s.mesh[1] || s.loading[1]) && !s.item.ref && s.need === Infinity && !s.inView && s.draw < 2 && s.from < 2);
      spare.sort((a, b) => Math.abs(b.x - view.x) - Math.abs(a.x - view.x));
      for (const s of spare.slice(0, built - Q.resident)) dropMesh(s, 1);
    }
    for (const s of slots) if (s.mesh[0] && !s.inView && s.draw !== 3 && s.from !== 3 && frameNo - s.lastNear > 120) dropMesh(s, 0);
  }

  // ---- Levels of detail and the dissolves between them.
  let lastPending = 0;
  /** The biggest on screen get their own meshes, up to the quality's cap (those already drawn so keep a head start). */
  function nearSet(cands: Slot[]): Set<Slot> {
    cands.sort((a, b) => (b.draw >= 2 ? b.sh * 1.3 : b.sh) - (a.draw >= 2 ? a.sh * 1.3 : a.sh));
    return new Set(cands.slice(0, Math.max(1, Q.maxRelief)));
  }
  function decide(dt: number) {
    const all = everyone;
    const nearOk: Slot[] = [];
    let pend = 0;
    for (const s of all) {
      if (!s.inView) {
        // Off screen: nothing drawn (no dissolve needed).
        if (s.draw || s.from) { s.draw = 0; s.from = 0; s.t = 1; }
        s.seen = false;
        continue;
      }
      const wantNear = s.item.ref ? true : s.sh >= (s.draw >= 2 ? NEAR_OUT : NEAR_IN);
      if (wantNear && !s.failed && (s.item.ref || s.item.art)) {
        s.lastNear = frameNo;
        if (!s.neededAt) s.neededAt = performance.now();
        nearOk.push(s);
      } else s.neededAt = 0;
    }
    const allowed = nearSet(nearOk);
    // Seen big (or a reference not built yet) and still without its own mesh: the camera has outrun the loading.
    for (const s of allowed) if (!s.up[1]) pend = Math.max(pend, s.item.ref ? 0.6 : Math.min(1, s.sh / (H * 0.35)));
    for (const s of all) {
      if (!s.inView) continue;
      let to: Level = 0;
      if (allowed.has(s) && s.up[1]) {
        to = !s.item.ref && s.up[0] && s.sh >= (s.draw === 3 ? HERO_OUT : HERO_IN) && Math.abs(s.index - centre) <= 2 ? 3 : 2;
      } else if (!s.item.ref && crowd.loaded && crowd.has(s.item.art)) to = 1;
      if (to !== s.draw) {
        // Trace: how long before it was needed its relief was ready (negative: the camera got there first).
        if (trace && to >= 2 && s.draw < 2 && s.neededAt && s.readyAt && !s.item.ref) (trace.extra.lead ??= []).push(Math.round(s.neededAt - s.readyAt));
        if (exporting || (!s.seen && s.draw === 0)) {
          // Coming into the frame (or a video frame): drawn as it is.
          s.from = 0;
          s.t = 1;
        } else {
          s.from = s.draw;
          s.t = 0;
        }
        s.draw = to;
        shadowsDirty = true;
      }
      if (s.t < 1) {
        s.t = Math.min(1, s.t + dt / FADE_S);
        if (s.t >= 1) { s.from = 0; shadowsDirty = true; }
      }
      s.seen = true;
    }
    lastPending = pend;
  }

  const levelFade = (s: Slot, lvl: Level): number => (s.draw === lvl ? (s.t < 1 ? s.t : 1) : s.from === lvl ? -1 - s.t : 0);
  let blobHash = 0;
  const bm = new THREE.Matrix4(), bq = new THREE.Quaternion(), bp = new THREE.Vector3(), bs = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0);
  /** Puts this frame's figures in the scene: own meshes in and out, the crowd's instances, and a contact shadow under each. */
  /** This frame's far figures, reusing last frame's objects (hundreds a frame would otherwise be garbage). */
  const crowdPool: CrowdInstance[] = [];
  const crowdList: CrowdInstance[] = [];
  function present() {
    const all = everyone;
    const list = crowdList;
    list.length = 0;
    let nb = 0, hash = 7;
    for (const s of all) {
      for (const lod of [0, 1] as const) {
        const h = s.mesh[lod];
        if (!h) continue;
        const lvl: Level = lod === 0 ? 3 : 2;
        const f = levelFade(s, lvl);
        const on = f !== 0 && s.up[lod];
        if (on && !h.object.parent) { figureGroup.add(h.object); shadowsDirty = true; }
        else if (!on && h.object.parent) { figureGroup.remove(h.object); shadowsDirty = true; }
        if (on) {
          if (h.fade) h.fade.value = f;
          // The shadow switches over halfway through a dissolve.
          const cast = f >= 0 ? f >= 0.5 : -f - 1 < 0.5;
          if (h.object.castShadow !== cast) { h.object.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = cast; }); shadowsDirty = true; }
        }
      }
      const fc = levelFade(s, 1);
      if (fc !== 0) {
        const it = crowdPool[list.length] ?? (crowdPool[list.length] = { x: 0, z: 0, yaw: 0, w: 0, h: 0, art: 0, box: s.item.box, fade: 1 });
        it.x = s.wx; it.z = s.wz; it.yaw = s.yaw; it.w = s.w; it.h = s.h; it.art = s.item.art; it.box = s.item.box; it.fade = fc; it.sh = s.sh;
        list.push(it);
      }
      if ((s.draw || s.from) && nb < BLOBS) {
        // One soft shadow under the figure's feet, as wide as it is and as deep as its relief.
        const L = s.h * Math.max(1, s.item.box[2] / Math.max(1, s.item.box[3]));
        const deep = Math.max(s.w * 0.32, (s.mesh[1]?.depth ?? L * 0.3) * 1.7);
        bp.set(s.wx, 0.004 + s.h * 0.0005, s.wz);
        bq.setFromAxisAngle(yAxis, s.yaw);
        bs.set(s.w * 1.04, 1, deep);
        blobs.setMatrixAt(nb++, bm.compose(bp, bq, bs));
        hash = (Math.imul(hash, 31) + s.index * 13 + Math.round(s.wx * 16) + Math.round(deep * 8)) | 0;
      }
    }
    // Over the quality's cap (a wide view over hundreds), the biggest on screen are drawn.
    if (list.length > Q.crowd) { list.sort((a, b) => (b.sh ?? 0) - (a.sh ?? 0)); list.length = Q.crowd; }
    // Tiny far figures' shadows are hardly seen: the light quality (and any very wide view) leaves them out of the shadow maps.
    const crowdCasts = Q.crowdShadows && list.length < 420;
    if (crowd.mesh.castShadow !== crowdCasts) { crowd.mesh.castShadow = crowdCasts; shadowsDirty = true; }
    if (crowd.set(list)) shadowsDirty = true;
    blobs.count = nb;
    if (hash !== blobHash || nb === 0) {
      blobHash = hash;
      blobs.instanceMatrix.clearUpdateRanges();
      blobs.instanceMatrix.addUpdateRange(0, Math.max(1, nb) * 16);
      blobs.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Compiles an object's shaders for the target the scene is drawn into (an
   * HDR target, so no tone mapping and linear output: compiled for the
   * screen they would be the wrong programs), without blocking where the
   * browser compiles in parallel.
   */
  function compileFor(o: THREE.Object3D): Promise<unknown> {
    const was = renderer.getRenderTarget();
    renderer.setRenderTarget(post.target);
    try {
      return renderer.compileAsync(o, camera, scene);
    } finally {
      renderer.setRenderTarget(was);
    }
  }

  // The stand-ins' materials stay alive: three.js deletes a program when the last material using it is disposed, and the next figure would compile it all over again.
  let warmed: { mat: THREE.Material; depth: THREE.Material; geo: THREE.BufferGeometry; tex: THREE.Texture } | null = null;
  /** Compiles the figures' shaders (relief, contact shadow and crowd, with their shadow variants) by drawing stand-ins once, before the first frame. */
  function warm() {
    applyView();
    if (!warmed) {
      const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      const geo = new THREE.PlaneGeometry(1, 1);
      const { mat, obj } = relief.dress(geo, tex, Q.texSize);
      setupMat(mat);
      warmed = { mat, depth: obj.customDepthMaterial as THREE.Material, geo, tex };
    }
    const fig = new THREE.Mesh(warmed.geo, warmed.mat);
    fig.castShadow = fig.receiveShadow = true;
    fig.customDepthMaterial = warmed.depth;
    fig.position.copy(target);
    fig.scale.setScalar(Math.max(0.05, view.h * 0.2));
    figureGroup.add(fig);
    setupMat(crowd.material);
    const crowdWas = crowd.mesh.count, blobsWas = blobs.count;
    crowd.mesh.count = Math.max(1, crowdWas);
    blobs.count = Math.max(1, blobsWas);
    const was = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(post.target);
      renderer.compile(scene, camera);
      renderer.setRenderTarget(was);
      csm.update();
      renderer.shadowMap.needsUpdate = true;
      post.frame(camera, focusD, 1.2, 0.1);
      post.render();
    } finally {
      renderer.setRenderTarget(was);
      shadowsDirty = true;
      figureGroup.remove(fig);
      crowd.mesh.count = crowdWas;
      blobs.count = blobsWas;
    }
  }

  // ---- Post.
  const postFor = (q: QualitySpec) => { const p = createPost(renderer, scene, camera, W, H, { msaa: q.msaa, ao: q.ao, aoSamples: q.aoSamples, dof: q.dof, dofSamples: q.dofSamples, bloom: q.bloom }); p.setSize(W, H); return p; };
  let post: Post = postFor(Q);

  function setQuality(next: Quality) {
    if (next === quality) return;
    quality = next;
    Q = QUALITY[next];
    if (!opts.size) renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pr));
    renderer.setSize(W, H, false);
    post.dispose();
    post = postFor(Q);
    const coverage = Q.msaa > 0;
    relief.setCoverage(coverage);
    crowd.setCoverage(coverage);
    props?.setCoverage(coverage);
    shadowsDirty = true;
    if (warmed && (warmed.mat as THREE.MeshStandardMaterial).alphaToCoverage !== coverage) {
      // The figures' other shader variant, compiled now rather than when the next one streams in.
      warmed.mat.dispose();
      warmed.depth.dispose();
      warmed.geo.dispose();
      warmed.tex.dispose();
      warmed = null;
      try { warm(); } catch { /* drawing will compile it instead */ }
    }
  }

  /** One step of streaming: what's on screen, what's coming, what to load, what to upload, what to draw. */
  function stream(dt: number) {
    scan();
    // The look-ahead is worked out a few times a second (and at once when the page sends new views).
    if (frameNo - needsAt >= 6 || exporting) { computeNeeds(); needsAt = frameNo; }
    pump();
    uploadSome(exporting ? 1000 : 5, exporting);
    decide(dt);
    present();
  }

  const lastCam = new THREE.Vector3(Infinity, 0, 0), lastAim = new THREE.Vector3();
  function render(t: number, dt: number) {
    frameNo++;
    lastDt = dt;
    applyView();
    csm.update();
    // The shadow cascades follow the camera: redrawn when it moves or a figure comes or goes, otherwise every third frame (for the idle motion).
    const moved = camera.position.distanceToSquared(lastCam) > 1e-12 || target.distanceToSquared(lastAim) > 1e-12;
    lastCam.copy(camera.position);
    lastAim.copy(target);
    stream(dt);
    renderer.shadowMap.needsUpdate = moved || shadowsDirty || frameNo % 3 === 0 || exporting;
    shadowsDirty = false;
    shared.uniforms.uTime.value = t;
    sky.update(camera, t);
    // Idle: a slow breath (and the trainer's own idle).
    const all = everyone;
    for (const s of all) {
      if (!s.draw && !s.from) continue;
      for (const h of s.mesh) {
        const o = h?.object;
        if (!o || !o.parent) continue;
        const k = Math.sin(t * 1.9 + s.phase);
        o.scale.y = o.scale.x * (1 + 0.011 * k) / (1 + 0.004 * k);
      }
      s.update?.(t, dt);
    }
    if (tower) tower.tick(t);
    // A gentle depth of field: macro-like for the smallest, the city still readable behind.
    const aperture = Math.min(7, 3.6 * Math.pow(1.6 / Math.max(0.15, focusD), 0.45)) * (H / 900);
    post.frame(camera, focusD, Math.max(1.2, aperture), Math.min(4, Math.max(0.03, focusD * 0.09)));
    post.render();
    if (trace) {
      if (!traceFigs.length && slots.length) traceFigs = slots.map((q) => ({ key: q.item.key, x: q.wx, z: q.wz, yaw: q.yaw, s: q.x, w: q.w, h: q.h }));
      trace.frame(performance.now(), camera, W, H, traceFigs, (i) => drawnAs(slots[i]), view.x, NEAR_IN);
    }
  }
  const drawnAs = (q: Slot | undefined): Drawn => {
    if (!q) return 0;
    if (q.draw >= 2 || (q.from >= 2 && q.t < 1)) return 3;
    return q.draw === 1 || (q.from === 1 && q.t < 1) ? 2 : 0;
  };
  const trace = createTrace();
  let traceFigs: TraceFigure[] = [];

  function anchors(): Anchor[] {
    const out: Anchor[] = [];
    const ps = projScale(camera, H);
    const top = new THREE.Vector3(), bot = new THREE.Vector3();
    slots.forEach((s, index) => {
      if (!s.draw) return;
      const dist = camera.position.distanceTo(tmpV.set(s.wx, s.h / 2, s.wz));
      if (s.draw === 1 && (s.h / Math.max(0.01, dist)) * ps < 6) return;
      top.set(s.wx, s.h, s.wz).project(camera);
      bot.set(s.wx, 0, s.wz).project(camera);
      if (top.z > 1 || bot.z > 1) return;
      const x = (top.x * 0.5 + 0.5) * W, y = (1 - (top.y * 0.5 + 0.5)) * H;
      // A figure standing off the frame gets no badge (it would be clamped in, over someone else).
      if (x < -W * 0.04 || x > W * 1.04) return;
      const by = (1 - (bot.y * 0.5 + 0.5)) * H;
      out.push({ index, item: s.item, x, y, sh: Math.abs(by - y), dist, by });
    });
    return out;
  }

  async function settle(timeoutMs = 20000) {
    const t0 = performance.now();
    applyView();
    for (;;) {
      scan();
      computeNeeds();
      needsAt = frameNo;
      pump();
      uploadSome(1000, true);
      const all = everyone;
      // Everything on screen that gets its own mesh (within the cap) has it, and the crowd is in.
      const cands = all.filter((s) => s.inView && !s.failed && (s.item.ref || (s.item.art && s.sh >= NEAR_IN)));
      const missing = [...nearSet(cands)].some((s) => !s.up[1]);
      const busy = toUpload.length > 0 || compiling > 0;
      if (!missing && !busy && (crowd.loaded || performance.now() - t0 > 12000)) break;
      if (performance.now() - t0 > timeoutMs) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    decide(0);
    // Settled: everything shown as it is, no dissolves under way.
    for (const s of slots) { s.from = 0; s.t = 1; }
    if (companion) { companion.from = 0; companion.t = 1; }
    present();
  }

  function resize(w: number, h: number) {
    W = w;
    H = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 0.8 ? 46 : 35;
    camera.updateProjectionMatrix();
    post.setSize(w, h);
    shadowsDirty = true;
  }

  return {
    canvas,
    setLine,
    heightAt,
    setView(v) { view = v; },
    prefetch(views) {
      futures = views.filter((f) => f.dt > 0).sort((a, b) => a.dt - b.dt).slice(0, 24);
    },
    pending: () => lastPending,
    render,
    settle,
    anchors,
    resize,
    setQuality,
    get quality() { return quality; },
    ready,
    warm,
    stats: () => ({ figures: slots.filter((s) => s.draw).length, relief: slots.filter((s) => s.draw >= 2).length, crowd: crowd.mesh.count, loading: loadingCount, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
    internals: () => ({ scene, renderer, camera, world: worldGroup, figures: figureGroup, sky: sky.mesh }),
    dispose() {
      for (const s of slots) dropSlot(s);
      if (companion) dropSlot(companion);
      toUpload.length = 0;
      crowd.dispose();
      blobs.dispose();
      if (warmed) { warmed.mat.dispose(); warmed.depth.dispose(); warmed.geo.dispose(); warmed.tex.dispose(); warmed = null; }
      city?.dispose();
      props?.dispose();
      tower?.dispose();
      sky.dispose();
      post.dispose();
      csm.dispose();
      envTex?.dispose();
      pmrem.dispose();
      texCache.forEach((t) => t.dispose());
      shadowTex.dispose();
      shadowMat.dispose();
      shadowGeo.dispose();
      renderer.dispose();
      canvas.remove();
      void lastDt;
    },
  };
}
