import * as THREE from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { CSM } from "three/examples/jsm/csm/CSM.js";
import { layoutLine } from "@/lib/sizes/types";
import { planWorld, type WorldPlan } from "@/lib/sizes/world";
import { FACING, poseFor, type View } from "@/lib/sizes/camera";
import { buildCity, type City } from "./city";
import { buildProps, type Props } from "./props";
import { buildTower, type Tower } from "./tower";
import { ModelProvider, ReliefProvider, buildRef, contactShadowTexture, type FigureHandle, type FigureProvider, type FigureUrls, type Lod, type RefBuilders, type SceneItem } from "./figures";
import { createPost, type Post } from "./post";
import { sharedUniforms } from "./shaders";
import { SKY, createSky } from "./sky";

/**
 * The 3D scene behind /pokedex/sizes and its videos: a sunny Lumiose City
 * tribute with the line of figures down the boulevard. The page (or the
 * video recorder) owns the clock and the camera plan; the scene draws a
 * frame for a View and reports where each figure's badge belongs.
 * Loaded only on this page.
 */

export type Quality = "low" | "medium" | "high" | "export";

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
  trees: boolean;
  maxRelief: number;
  anisotropy: number;
}

export const QUALITY: Record<Quality, QualitySpec> = {
  low: { pr: 1, msaa: 0, ao: false, aoSamples: 8, dof: false, dofSamples: 16, bloom: false, shadow: 1024, cascades: 2, blocks: 0.45, facadeScale: 1, texSize: 256, trees: true, maxRelief: 10, anisotropy: 2 },
  medium: { pr: 1.25, msaa: 4, ao: false, aoSamples: 8, dof: true, dofSamples: 16, bloom: true, shadow: 2048, cascades: 3, blocks: 0.75, facadeScale: 1, texSize: 512, trees: true, maxRelief: 18, anisotropy: 4 },
  high: { pr: 1.5, msaa: 4, ao: true, aoSamples: 12, dof: true, dofSamples: 32, bloom: true, shadow: 2048, cascades: 3, blocks: 1, facadeScale: 1, texSize: 512, trees: true, maxRelief: 28, anisotropy: 8 },
  export: { pr: 1, msaa: 4, ao: true, aoSamples: 24, dof: true, dofSamples: 32, bloom: true, shadow: 4096, cascades: 4, blocks: 1, facadeScale: 2, texSize: 512, trees: true, maxRelief: 40, anisotropy: 8 },
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

export interface SizesScene {
  canvas: HTMLCanvasElement;
  setLine(items: SceneItem[]): { placed: Placed[]; plan: WorldPlan };
  /** Height of the figures around a point on the line (smoothed, m). */
  heightAt(x: number): number;
  setView(v: View): void;
  /** Draw a frame (t: seconds of scene time, for idle motion). */
  render(t: number, dt: number): void;
  /** Wait until every figure the current view needs is built (exports, screenshots). */
  settle(timeoutMs?: number): Promise<void>;
  anchors(): Anchor[];
  resize(w: number, h: number): void;
  /** Ready to draw (environment loaded). */
  ready: Promise<void>;
  stats(): { figures: number; loading: number; calls: number; tris: number };
  dispose(): void;
}

const SUN_ELEVATION = (41 * Math.PI) / 180;

export function createSizesScene(host: HTMLElement, opts: SceneOptions): SizesScene {
  const Q = QUALITY[opts.quality];
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  host.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance", stencil: false });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
  const yawToCam = FACING; // figures face the camera
  // The sun stands in front of the figures and to the camera's left, as in the classic size-comparison videos:
  // faces and the facades behind them are lit, shadows fall back and to the right.
  const az = yawToCam - Math.PI * 0.25;
  const sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(SUN_ELEVATION), Math.sin(SUN_ELEVATION), Math.cos(az) * Math.cos(SUN_ELEVATION)).normalize();
  const sky = createSky(sunDir);
  scene.add(sky.mesh);
  scene.fog = new THREE.FogExp2(SKY.haze.clone().convertSRGBToLinear(), 0.00019);
  const hemi = new THREE.HemisphereLight(0xdfeaff, 0xb9ab92, 0.35);
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
    lightIntensity: 3.7,
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
  for (const l of csm.lights) l.color.set("#fff3e2");
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
  const ready = new RGBELoader().loadAsync(opts.urls.hdr).then((hdr) => {
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
  const loadTex = (name: string, map: "diff" | "nor" | "rough", tile: number) => {
    const key = `${name}:${map}`;
    let t = texCache.get(key);
    if (!t) {
      t = loader.load(opts.urls.tex(name, map));
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = maxAniso;
      t.colorSpace = map === "diff" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texCache.set(key, t);
    }
    void tile;
    return t;
  };
  const pbr = (name: string, tile: number, o: { color?: string; normalScale?: number } = {}): THREE.MeshStandardMaterialParameters => ({
    map: loadTex(name, "diff", tile),
    normalMap: loadTex(name, "nor", tile),
    roughnessMap: loadTex(name, "rough", tile),
    normalScale: new THREE.Vector2(o.normalScale ?? 1, o.normalScale ?? 1),
    color: o.color ?? "#ffffff",
    roughness: 1,
    metalness: 0,
  });

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
    grad.addColorStop(0, "rgba(220,250,255,0.9)");
    grad.addColorStop(0.25, "rgba(140,225,255,0.35)");
    grad.addColorStop(1, "rgba(120,210,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }));
    s.scale.setScalar(60);
    return s;
  })();

  // ---- Figures.
  const providers: FigureProvider[] = [];
  if (opts.models && Object.keys(opts.models).length) providers.push(new ModelProvider(opts.models));
  providers.push(new ReliefProvider(opts.urls, { anisotropy: maxAniso, sharpen: opts.quality === "export" ? 0.55 : 0.45, texSize: Q.texSize }));
  interface Slot { item: SceneItem; x: number; w: number; h: number; handle: FigureHandle | null; loading: Lod | null; abort: AbortController | null; want: Lod | -1; shadow: THREE.Mesh | null; phase: number; update?: (t: number, dt: number) => void; lastSeen: number }
  let slots: Slot[] = [];
  let companion: Slot | null = null;
  const figureGroup = new THREE.Group();
  scene.add(figureGroup);
  const shadowTex = contactShadowTexture();
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, color: 0x000000, opacity: 0.55 });
  shadowMat.polygonOffset = true;
  shadowMat.polygonOffsetFactor = -2;
  const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  let logH: number[] = [];
  let xs: number[] = [];
  let loadingCount = 0;
  let frameNo = 0;

  function setLine(items: SceneItem[]) {
    for (const s of slots) dropSlot(s);
    if (companion) dropSlot(companion);
    companion = null;
    const placed = layoutLine(items.map((i) => ({ m: i.m, length: i.length, bw: i.box[2], bh: i.box[3] })));
    slots = items.map((item, i) => ({ item: { ...item, w: placed[i].w, h: placed[i].h }, x: placed[i].x, w: placed[i].w, h: placed[i].h, handle: null, loading: null, abort: null, want: -1, shadow: null, phase: (i * 2.399) % (Math.PI * 2), lastSeen: 0 }));
    xs = slots.map((s) => s.x);
    // Smoothed log heights (same idea as the camera's distance), for aiming.
    const raw = slots.map((s) => Math.log(Math.max(0.02, s.h)));
    logH = raw.map((_, i) => {
      let sum = 0, n = 0;
      for (let k = -3; k <= 3; k++) { const j = i + k; if (j < 0 || j >= raw.length) continue; const wt = Math.exp(-(k * k) / 4); sum += raw[j] * wt; n += wt; }
      return Math.max(sum / n, raw[i] - 0.05);
    });
    plan = planWorld(slots.map((s) => ({ x: s.x, w: s.w, h: s.h })));
    rebuildWorld();
    // A companion at the start: tiny figures stand at a person's feet.
    const human = items.find((i) => i.ref === "human" || i.ref === "trainer");
    if (human && slots.length && slots[0].h < 0.6) {
      const x = slots[0].x - slots[0].w / 2 - 0.55;
      companion = { item: { ...human, key: "companion" }, x, w: human.w, h: human.h, handle: null, loading: null, abort: null, want: 1, shadow: null, phase: 1, lastSeen: 0 };
    }
    return { placed: slots.map((s) => ({ key: s.item.key, x: s.x, w: s.w, h: s.h })), plan };
  }

  function rebuildWorld() {
    city?.dispose();
    props?.dispose();
    tower?.dispose();
    worldGroup.clear();
    city = buildCity(plan, shared, { pbr }, { facadeScale: Q.facadeScale, anisotropy: maxAniso, blocks: Q.blocks });
    props = buildProps(plan, shared, { bark: pbr("bark_brown_02", 1.5) }, { trees: Q.trees });
    tower = buildTower(plan.tower.x, plan.tower.z);
    worldGroup.add(city.group, props.group, tower.group);
    halo.position.copy(tower.crown);
    worldGroup.add(halo);
    setupTree(worldGroup);
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

  function dropSlot(s: Slot) {
    s.abort?.abort();
    s.abort = null;
    s.loading = null;
    if (s.handle) { figureGroup.remove(s.handle.object); s.handle.dispose(); s.handle = null; }
    if (s.shadow) { figureGroup.remove(s.shadow); s.shadow = null; }
    s.update = undefined;
  }

  function place(s: Slot, h: FigureHandle) {
    const o = h.object;
    o.position.set(s.x, 0, 0);
    o.rotation.y = FACING;
    figureGroup.add(o);
    h.materials.forEach(setupMat);
    if (!s.shadow) {
      s.shadow = new THREE.Mesh(shadowGeo, shadowMat);
      s.shadow.renderOrder = 1;
      figureGroup.add(s.shadow);
    }
    s.shadow.position.set(s.x, 0.004 + s.h * 0.0005, 0);
    s.shadow.rotation.y = FACING;
    s.shadow.scale.set(s.w * 1.05, 1, Math.max(h.depth * 1.8, s.w * 0.35));
  }

  function startLoad(s: Slot, lod: Lod) {
    s.abort?.abort();
    const ac = new AbortController();
    s.abort = ac;
    s.loading = lod;
    loadingCount++;
    const item = s.item;
    const job = item.ref
      ? buildRef(item, { trainer: opts.trainer })
      : (providers.find((p) => p.has(item)) ?? providers[providers.length - 1]).load(item, lod, ac.signal);
    job.then((h) => {
      if (ac.signal.aborted) { h.dispose(); return; }
      if (s.handle) { figureGroup.remove(s.handle.object); s.handle.dispose(); }
      s.handle = h;
      s.update = (h as { update?: (t: number, dt: number) => void }).update;
      place(s, h);
    }).catch(() => {
      // A figure that can't load (offline, missing art) is left out.
    }).finally(() => {
      loadingCount--;
      if (s.abort === ac) { s.abort = null; s.loading = null; }
    });
  }

  // ---- Camera.
  const target = new THREE.Vector3();
  function applyView() {
    const p = poseFor(view);
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
      const texel = (cam.right - cam.left) / Q.shadow;
      l.shadow.normalBias = texel * 1.6;
      l.shadow.bias = -0.0002;
      cam.updateProjectionMatrix();
    }
    shared.uniforms.uCutA.value.copy(camera.position);
    shared.uniforms.uCutB.value.copy(target);
    // Above the rooftops in the finale nothing is in the way.
    shared.uniforms.uCutR.value = view.rise > 0.25 ? 0 : Math.max(0.25, Math.max(view.h, 0.6 * view.d * 0.6) * 0.55);
    city?.update(camera.position, csm.maxFar * 1.3);
  }

  // ---- Streaming: which figures to build, and how detailed.
  const tmpV = new THREE.Vector3();
  const projScale = () => (renderer.domElement.height / renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  function wanted(): void {
    const ps = projScale();
    if (!slots.length) return;
    let lo = 0, hi = slots.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= view.x) lo = mid; else hi = mid; }
    const centre = lo;
    const ranked: { s: Slot; sh: number }[] = [];
    for (let i = Math.max(0, centre - (view.rise > 0 ? 700 : 60)); i < Math.min(slots.length, centre + 420); i++) {
      const s = slots[i];
      tmpV.set(s.x, s.h / 2, 0);
      const dist = tmpV.distanceTo(camera.position);
      const sh = (s.h / Math.max(0.01, dist)) * ps;
      tmpV.project(camera);
      const inView = tmpV.z < 1 && Math.abs(tmpV.x) < 1.25 + (s.w / Math.max(0.01, dist)) * 2 && tmpV.y > -1.6 && tmpV.y < 2.2;
      s.want = !inView || sh < 5 ? -1 : sh > 260 && Math.abs(i - centre) <= 2 ? 0 : sh > 34 ? 1 : 2;
      if (s.want !== -1) { ranked.push({ s, sh }); s.lastSeen = frameNo; }
    }
    // Cap the detailed ones: the biggest on screen get relief.
    ranked.sort((a, b) => b.sh - a.sh);
    ranked.forEach((r, k) => { if (k >= Q.maxRelief && r.s.want !== 2) r.s.want = 2; });
    if (companion) companion.want = 1;
  }
  function stream(budget: number) {
    let started = 0;
    const all = companion ? [companion, ...slots] : slots;
    // Biggest wants first.
    const order = all.filter((s) => s.want !== -1).sort((a, b) => (a.want as number) - (b.want as number));
    for (const s of order) {
      if (started >= budget || loadingCount >= 8) break;
      const want = s.want as Lod;
      const have = s.handle?.lod ?? null;
      if (have === want || s.loading === want) continue;
      // References are built once; a figure never swaps down while it's on screen.
      if (s.item.ref && (s.handle || s.loading !== null)) continue;
      if (have !== null && have < want) continue;
      startLoad(s, want);
      started++;
    }
    // Drop what has been out of view for a while.
    for (const s of slots) if (s.want === -1 && (s.handle || s.loading !== null) && frameNo - s.lastSeen > 90) dropSlot(s);
  }

  // ---- Post.
  const post: Post = createPost(renderer, scene, camera, W, H, { msaa: Q.msaa, ao: Q.ao, aoSamples: Q.aoSamples, dof: Q.dof, dofSamples: Q.dofSamples, bloom: Q.bloom });
  post.setSize(W, H);

  function render(t: number, dt: number) {
    frameNo++;
    applyView();
    csm.update();
    if (frameNo % 3 === 1 || opts.quality === "export") { wanted(); stream(opts.quality === "export" ? 99 : 4); }
    shared.uniforms.uTime.value = t;
    sky.update(camera, t);
    // Idle: a slow breath (and the trainer's own idle).
    for (const s of slots) {
      const o = s.handle?.object;
      if (!o) continue;
      const k = Math.sin(t * 1.9 + s.phase);
      o.scale.y = o.scale.x * (1 + 0.011 * k) / (1 + 0.004 * k);
      s.update?.(t, dt);
    }
    if (companion?.handle) companion.update?.(t, dt);
    if (tower) tower.glow.emissiveIntensity = 2.4 + 0.5 * Math.sin(t * 1.3);
    const aperture = Math.min(12, 6 * Math.pow(1.6 / Math.max(0.15, focusD), 0.45)) * (H / 900);
    post.frame(camera, focusD, Math.max(1.2, aperture), Math.min(4, Math.max(0.03, focusD * 0.09)));
    post.render();
  }

  function anchors(): Anchor[] {
    const out: Anchor[] = [];
    const ps = projScale();
    slots.forEach((s, index) => {
      if (!s.handle || s.handle.lod === 2 && s.h / Math.max(0.01, camera.position.distanceTo(tmpV.set(s.x, s.h / 2, 0))) * ps < 40) return;
      const top = new THREE.Vector3(s.x, s.h, 0).project(camera);
      const bot = new THREE.Vector3(s.x, 0, 0).project(camera);
      if (top.z > 1 || bot.z > 1) return;
      const dist = camera.position.distanceTo(tmpV.set(s.x, s.h / 2, 0));
      const x = (top.x * 0.5 + 0.5) * W, y = (1 - (top.y * 0.5 + 0.5)) * H;
      const by = (1 - (bot.y * 0.5 + 0.5)) * H;
      out.push({ index, item: s.item, x, y, sh: Math.abs(by - y), dist, by });
    });
    return out;
  }

  async function settle(timeoutMs = 20000) {
    const t0 = performance.now();
    applyView();
    wanted();
    for (;;) {
      stream(99);
      const all = companion ? [companion, ...slots] : slots;
      const pending = all.some((s) => s.want !== -1 && s.loading !== null);
      const missing = all.some((s) => s.want !== -1 && !s.handle && s.loading === null);
      if (!pending && !missing && loadingCount === 0) break;
      if (performance.now() - t0 > timeoutMs) break;
      await new Promise((r) => setTimeout(r, 30));
    }
  }

  function resize(w: number, h: number) {
    W = w;
    H = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 0.8 ? 46 : 35;
    camera.updateProjectionMatrix();
    post.setSize(w, h);
  }

  return {
    canvas,
    setLine,
    heightAt,
    setView(v) { view = v; },
    render,
    settle,
    anchors,
    resize,
    ready,
    stats: () => ({ figures: slots.filter((s) => s.handle).length, loading: loadingCount, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
    dispose() {
      for (const s of slots) dropSlot(s);
      if (companion) dropSlot(companion);
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
    },
  };
}
