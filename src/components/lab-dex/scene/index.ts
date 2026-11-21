import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ReliefProvider, contactShadowTexture, type FigureUrls } from "@/components/sizes/scene/figures";
import { createPost, type Post } from "@/components/sizes/scene/post";
import { watchContext } from "@/lib/gl/context-loss";
import { PODS, mod, podSlots } from "@/lib/lab-dex/wheel";
import type { LabMon } from "@/lib/lab-dex/types";
import { holoScan, type HoloScan, type LabTime } from "./holo";
import { createMirror, type Mirror } from "./mirror";
import { ROOM, buildCables, buildRoom, type FloorUniforms } from "./room";
import { TABLE_TOP, buildPod, buildTable, holoTint, type Pod } from "./lab";
import { drawIndex, type LabFonts } from "./screens";
import { typeParticles } from "./particles";
import { FigureStream, type Fig, type Want } from "./stream";
import { TIERS, type Tier } from "./quality";

/**
 * The Professor's Lab: a 3D Pokédex. A round research lab, a ring of twelve
 * capsule pods round a holo-table, the chosen Pokémon standing on the table.
 *
 * The ring is a window on the whole sequence (every Pokémon, filtered and
 * sorted): the wheel's position says which twelve the pods hold, and a pod
 * passing the back of the ring takes the next one on. Figures stream in as
 * they're needed (see stream.ts), each pod showing a hologram until its
 * figure arrives, which then dissolves in. The figure on the table is a
 * detailed one: the old one dissolves away, the new one is scanned in under
 * a line of light, then turns slowly. The lab's light, the floor's inlays
 * and the particles round the table re-tint to the Pokémon's type.
 *
 * Figures are /pokedex/sizes' own (the HOME render on a relief mesh), drawn
 * through its post chain (HDR, MSAA, depth of field, bloom, filmic tone
 * mapping), at a quality tier the page picks and adjusts (quality.ts).
 */

export interface WheelState {
  /** Position in slots (unbounded). */
  p: number;
  v: number;
  /** Where it will rest (null while dragged). */
  target: number | null;
  dragging: boolean;
}

export interface LabSceneOptions {
  fonts: LabFonts;
  urls: FigureUrls;
  tier: Tier;
  phone: boolean;
  reducedMotion: boolean;
  /** The WebGL context was lost for good: the page builds the scene again. */
  onContextGone?: () => void;
}

export interface LabSceneStats {
  tier: Tier;
  /** Pods holding a Pokémon whose figure isn't on show (yet). */
  blankPods: number;
  /** The table has the chosen Pokémon's figure. */
  heroShown: boolean;
  heroId: number | null;
  geometries: number;
  textures: number;
  programs: number;
  calls: number;
  stream: ReturnType<FigureStream["stats"]>;
}

export interface LabScene {
  canvas: HTMLCanvasElement;
  /** The room is built and its shaders compiled. */
  ready: Promise<void>;
  /** The sequence changed (filters, sort, forms): the pods dissolve and refill. */
  setSequence(len: number, monAt: (pos: number) => LabMon, version: number): void;
  /** Draws a frame for the wheel's state. */
  frame(w: WheelState, dt: number, t: number): void;
  /** The pointer over the stage (-1..1 each way), for a touch of parallax. */
  pointer(nx: number, ny: number): void;
  /** The slot (unbounded) of the pod under a point (CSS px in the canvas), if any. */
  pick(x: number, y: number): number | null;
  resize(w: number, h: number): void;
  setTier(t: Tier): void;
  stats(): LabSceneStats;
  dispose(): void;
}

const STEP = (Math.PI * 2) / PODS;
/** The camera looks from this azimuth; the chosen pod sits half a slot to its right, its neighbour half a slot left, the table framed between them. */
const CAM_AZ = 0;

interface Shot {
  dist: number;
  y: number;
  ty: number;
  fov: number;
  aperture: number;
}

const HERO: Shot = { dist: 11.2, y: 1.25, ty: 2.0, fov: 29, aperture: 8 };
const SPIN: Shot = { dist: 14.6, y: 4.9, ty: 0.85, fov: 44, aperture: 2.5 };

/** The lab as seen in reflections: a dark drum, its ring lamps, the screens' cyan, a warm lamp or two. */
function labEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const env = new THREE.Scene();
  const add = (geo: THREE.BufferGeometry, color: THREE.Color, side: THREE.Side = THREE.FrontSide) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, side }));
    env.add(m);
    return m;
  };
  add(new THREE.SphereGeometry(40, 32, 16), new THREE.Color(0.01, 0.014, 0.025), THREE.BackSide);
  add(new THREE.TorusGeometry(7.6, 0.25, 8, 64).rotateX(Math.PI / 2).translate(0, 8, 0), new THREE.Color(5, 5.6, 6.5));
  add(new THREE.TorusGeometry(11.6, 0.2, 8, 64).rotateX(Math.PI / 2).translate(0, 8, 0), new THREE.Color(0.6, 1.7, 2.2));
  add(new THREE.CircleGeometry(1.6, 32).rotateX(Math.PI / 2).translate(0, 7, 0), new THREE.Color(5, 4.6, 4.2));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const p = add(new THREE.PlaneGeometry(5, 2.5), new THREE.Color(0.25, 0.85, 1.2));
    p.position.set(Math.sin(a) * 15, 3.6, Math.cos(a) * 15);
    p.lookAt(0, 3.6, 0);
  }
  const k1 = add(new THREE.PlaneGeometry(8, 5), new THREE.Color(3.2, 3.4, 3.8));
  k1.position.set(-9, 7, 9);
  k1.lookAt(0, 1, 0);
  const k2 = add(new THREE.PlaneGeometry(6, 3), new THREE.Color(2.4, 1.5, 0.9));
  k2.position.set(10, 4, -8);
  k2.lookAt(0, 1, 0);
  add(new THREE.CircleGeometry(3, 32).rotateX(-Math.PI / 2).translate(0, 0.1, 0), new THREE.Color(0.5, 1.4, 1.8));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.03);
  pmrem.dispose();
  env.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
  return rt.texture;
}

/** Dust in the air (lit where the lamps' shafts are) and motes round the table in the type's colour. */
function motes(color: THREE.Color, count: number, around: { r: number; y0: number; y1: number }, size: number, seed: number, strength: number, time: LabTime): THREE.Points {
  const pos = new Float32Array(count * 3);
  const sz = new Float32Array(count);
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(rnd()) * around.r, a = rnd() * Math.PI * 2;
    pos[i * 3] = Math.sin(a) * r;
    pos[i * 3 + 1] = around.y0 + rnd() * (around.y1 - around.y0);
    pos[i * 3 + 2] = Math.cos(a) * r;
    sz[i] = size * (0.4 + rnd() * rnd() * 1.6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("size", new THREE.BufferAttribute(sz, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uScale: { value: 600 }, uStrength: { value: strength }, uTime: time, uSpan: { value: around.y1 - around.y0 }, uY0: { value: around.y0 } },
    vertexShader: /* glsl */ `
      attribute float size; uniform float uScale, uTime, uSpan, uY0; varying float vFade;
      void main() {
        vec3 p = position;
        // A slow drift upward, wrapping round the band, and a little sway.
        float y = fract((p.y - uY0) / uSpan + uTime * 0.004 * (1.0 + fract(p.x * 7.13))) * uSpan + uY0;
        p.y = y;
        p.x += sin(uTime * 0.21 + p.z) * 0.08;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = size * uScale / max(0.5, -mv.z);
        vFade = smoothstep(0.3, 1.5, -mv.z) * smoothstep(0.0, 0.08, (y - uY0) / uSpan) * smoothstep(1.0, 0.9, (y - uY0) / uSpan);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uStrength; varying float vFade;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = pow(max(0.0, 1.0 - d), 2.2) * vFade;
        gl_FragColor = vec4(uColor * a * uStrength, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.renderOrder = 5;
  return p;
}

interface Shown {
  fig: Fig;
  /** 0 hidden … 1 whole (drawn through the dither in between). */
  a: number;
}

interface PodState {
  pod: Pod;
  slot: number | null;
  mon: LabMon | null;
  version: number;
  cur: Shown | null;
  old: Shown[];
  /** Seconds before it starts filling (the refill's wave round the ring). */
  delay: number;
  holo: number;
}

interface HeroShown {
  fig: Fig;
  scan: HoloScan;
  phase: "in" | "show" | "out";
  t: number;
}

const EMPTY_POD = new THREE.Color("#2a3a4c");
const FOCUS_AT = new THREE.Vector3(0, HERO.ty, 0);
const TINTS = new Map<string, THREE.Color>();
/** A type's hologram colour (cached: read every frame). */
function typeTint(type: string): THREE.Color {
  let c = TINTS.get(type);
  if (!c) TINTS.set(type, (c = holoTint(type)));
  return c;
}

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));

function setFade(f: Fig, a: number) {
  const v = a >= 0.999 ? 1 : Math.max(0, a);
  if (f.handle.fade) f.handle.fade.value = v;
  f.blobMat.opacity = 0.75 * Math.max(0, Math.min(1, a));
  f.root.visible = a > 0.001;
}

export function createLabScene(host: HTMLElement, opts: LabSceneOptions): LabScene {
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.setAttribute("aria-hidden", "true");
  host.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance", stencil: false });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const ctxWatch = watchContext(canvas, opts.onContextGone);
  let tier: Tier = opts.tier;
  let spec = TIERS[tier];
  let W = Math.max(1, host.clientWidth), H = Math.max(1, host.clientHeight);
  let pr = Math.min(window.devicePixelRatio || 1, spec.dpr);
  renderer.setPixelRatio(pr);
  renderer.setSize(W, H, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0.006, 0.008, 0.016);
  scene.fog = new THREE.FogExp2(new THREE.Color(0.012, 0.017, 0.03), 0.026);
  const camera = new THREE.PerspectiveCamera(HERO.fov, W / H, 0.1, 80);
  const time: LabTime = { value: 0 };
  scene.environment = labEnvironment(renderer);
  scene.environmentIntensity = 0.55;

  // ---- The tint: the chosen Pokémon's type colour, eased.
  const tint = new THREE.Color("#7ee8ff");
  const tintTarget = tint.clone();
  const white = new THREE.Color(1, 1, 1);

  // ---- The room, the table, the ring.
  const floorUniforms: FloorUniforms = {
    tRefl: { value: null },
    uMirror: { value: new THREE.Matrix4() },
    uReflOn: { value: 0 },
    uRingPhase: { value: 0 },
    uSel: { value: 0 },
    uSelCol: { value: tint.clone() },
    uPodCol: { value: Array.from({ length: PODS }, () => new THREE.Color("#2a3a4c")) },
  };
  const room = buildRoom(scene, opts.fonts, time, floorUniforms, CAM_AZ + Math.PI);
  const cableRing = new THREE.Group();
  scene.add(cableRing);
  const cables = buildCables(cableRing, Array.from({ length: PODS }, (_, k) => k * STEP));
  const table = buildTable(time, opts.fonts);
  scene.add(table.group);
  const pods: PodState[] = Array.from({ length: PODS }, (_, k) => {
    const pod = buildPod(k, time, opts.fonts);
    scene.add(pod.group);
    pod.show(null);
    return { pod, slot: null, mon: null, version: -1, cur: null, old: [], delay: 0, holo: 0 };
  });

  // ---- Light: a warm key from the front left, a cyan rim behind left, a rim in the type's colour behind right, the table's glow.
  const polar = (az: number, r: number, y: number) => new THREE.Vector3(Math.sin(az) * r, y, Math.cos(az) * r);
  scene.add(new THREE.HemisphereLight(0x8fb0ff, 0x06080d, 0.45));
  const fill = new THREE.SpotLight("#cfe0ff", 30, 0, 0.45, 1, 2);
  fill.position.copy(polar(CAM_AZ + 0.35, 6.5, 2.4));
  fill.target.position.set(0, 1.5, 0);
  scene.add(fill, fill.target);
  const key = new THREE.SpotLight("#ffe9d6", 115, 0, 0.36, 0.75, 2);
  key.position.copy(polar(CAM_AZ - 1.05, 7.2, 7.0));
  key.target.position.set(0, 1.6, 0);
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.02;
  key.shadow.camera.near = 3;
  key.shadow.camera.far = 20;
  scene.add(key, key.target);
  const rimA = new THREE.SpotLight("#59d4ff", 260, 0, 0.5, 0.6, 2);
  rimA.position.copy(polar(CAM_AZ + Math.PI - 1.05, 5.2, 4.6));
  rimA.target.position.set(0, 1.7, 0);
  rimA.shadow.mapSize.set(1024, 1024);
  rimA.shadow.bias = -0.0004;
  scene.add(rimA, rimA.target);
  const rimB = new THREE.SpotLight(tint.clone(), 140, 0, 0.5, 0.6, 2);
  rimB.position.copy(polar(CAM_AZ + Math.PI + 1.1, 5.0, 3.4));
  rimB.target.position.set(0, 1.5, 0);
  scene.add(rimB, rimB.target);
  const under = new THREE.PointLight(tint.clone(), 2, 6, 2);
  under.position.copy(polar(CAM_AZ, 1.9, TABLE_TOP + 0.35));
  scene.add(under);
  const down = new THREE.SpotLight("#fff3e6", 60, 0, 0.32, 0.8, 2);
  down.position.set(0, ROOM.height - 1.5, 0);
  down.target.position.set(0, 0, 0);
  scene.add(down, down.target);

  // ---- Haze, motes, particles.
  const dust = motes(new THREE.Color(0.7, 0.85, 1.0), 1400, { r: 13, y0: 0.2, y1: 7.5 }, 0.022, 7, 0.55, time);
  const tableMoteCol = tint.clone();
  const tableMotes = motes(tableMoteCol, 140, { r: 1.6, y0: TABLE_TOP + 0.1, y1: 3.8 }, 0.035, 11, 1.4, time);
  scene.add(dust, tableMotes);
  const particles = typeParticles(time, new THREE.Vector3(0, TABLE_TOP, 0));
  scene.add(particles.points);

  // ---- Quality-dependent parts: shadows, the floor's mirror, the post chain.
  let mirror: Mirror | null = null;
  let post: Post | null = null;
  const applyTier = () => {
    spec = TIERS[tier];
    pr = Math.min(window.devicePixelRatio || 1, spec.dpr);
    renderer.setPixelRatio(pr);
    renderer.setSize(W, H, false);
    key.castShadow = spec.shadow > 0;
    rimA.castShadow = spec.shadow > 0 && spec.rimShadow;
    if (spec.shadow > 0 && key.shadow.mapSize.x !== spec.shadow) {
      key.shadow.mapSize.set(spec.shadow, spec.shadow);
      key.shadow.map?.dispose();
      key.shadow.map = null;
    }
    renderer.shadowMap.enabled = spec.shadow > 0;
    renderer.shadowMap.needsUpdate = true;
    mirror?.dispose();
    mirror = null;
    if (spec.mirror > 0) {
      mirror = createMirror(Math.max(2, Math.round(W * pr * spec.mirror)), Math.max(2, Math.round(H * pr * spec.mirror)));
      floorUniforms.tRefl.value = mirror.texture;
    }
    floorUniforms.uReflOn.value = mirror ? 1 : 0;
    post?.dispose();
    post = createPost(renderer, scene, camera, W, H, { msaa: spec.msaa, ao: false, aoSamples: 8, dof: spec.dof, dofSamples: spec.dofSamples, bloom: spec.bloom });
    post.setSize(W, H);
    for (const p of post.composer.passes) {
      if (p instanceof UnrealBloomPass) {
        p.strength = 0.45;
        p.radius = 0.5;
        p.threshold = 1.0;
      }
      const fin = (p as unknown as { finish?: THREE.ShaderMaterial }).finish;
      if (fin) {
        fin.uniforms.vignette.value = 0.42;
        fin.uniforms.saturation.value = 1.08;
        fin.uniforms.warmth.value = 0.02;
      }
    }
    const pc = opts.reducedMotion ? 0 : spec.particles;
    particles.setCount(pc);
    dust.geometry.setDrawRange(0, spec.motes);
    tableMotes.visible = !opts.reducedMotion || spec.motes > 0;
    // Materials that were built for a different multisampling.
    podRelief.setCoverage(spec.msaa > 0);
    heroRelief.setCoverage(spec.msaa > 0);
    stream?.setCaps(spec.caps);
    sizeScales();
    // Every material's program depends on the shadow setup: rebuild them.
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
      else if (m) m.needsUpdate = true;
    });
  };

  // ---- Figures.
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const podRelief = new ReliefProvider(opts.urls, { anisotropy: Math.min(8, maxAniso), sharpen: 0.5, texSize: 256, coverage: spec.msaa > 0, segments: TIERS[opts.tier].podSegments });
  // The hero fills the screen: the full 512 px render, every bit of anisotropic filtering, a firmer unsharp mask.
  const heroRelief = new ReliefProvider(opts.urls, { anisotropy: Math.min(16, maxAniso), sharpen: 0.95, texSize: 512, coverage: spec.msaa > 0 });
  const shadowTex = contactShadowTexture();
  const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  let stream: FigureStream | null = null;
  stream = new FigureStream({ pod: podRelief, hero: heroRelief, caps: TIERS[opts.tier].caps, concurrency: opts.phone ? 3 : 4, blob: { geo: blobGeo, tex: shadowTex } });
  const scanned = new WeakSet<Fig>();
  const heroTurn = new THREE.Group();
  heroTurn.position.set(0, TABLE_TOP, 0);
  scene.add(heroTurn);
  let heroes: HeroShown[] = [];

  const sizeScales = () => {
    const vfov = (camera.fov * Math.PI) / 180;
    const proj = (H * pr) / (2 * Math.tan(vfov / 2));
    (particles.points.material as THREE.ShaderMaterial).uniforms.uScale.value = proj;
    (dust.material as THREE.ShaderMaterial).uniforms.uScale.value = 600 * pr;
    (tableMotes.material as THREE.ShaderMaterial).uniforms.uScale.value = 600 * pr;
  };

  applyTier();

  // Compile the figures' shaders before the first one arrives (a dummy of each kind, kept hidden so its program stays alive).
  const dummyTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  dummyTex.needsUpdate = true;
  const dummies: THREE.Mesh[] = [];
  {
    const g = new THREE.PlaneGeometry(0.01, 0.01);
    const a = podRelief.dress(g, dummyTex, 256).obj;
    const b = heroRelief.dress(g, dummyTex, 512);
    holoScan(b.mat, { color: { value: tint }, feetY: { value: 0 }, scanY: { value: 0 }, amount: { value: 1 }, band: { value: 0 } }, time);
    for (const d of [a, b.obj]) {
      d.position.set(0, -5, 0);
      scene.add(d);
      dummies.push(d);
    }
  }
  const ready = new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      try {
        renderer.setRenderTarget(post!.target);
        renderer.compile(scene, camera);
        renderer.setRenderTarget(null);
      } catch {
        // A failed compile shows up on the first frame instead.
      }
      for (const d of dummies) d.visible = false;
      resolve();
    });
  });

  // ---- The sequence.
  let len = 0;
  let monAt: (pos: number) => LabMon = () => { throw new Error("no sequence"); };
  let version = 0;
  let refill = false;

  // ---- The camera.
  const camPos = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  let spinAmt = 0;
  const ptr = new THREE.Vector2();
  const ptrS = new THREE.Vector2();
  let focus = HERO.dist;
  let aperture = HERO.aperture;

  const placeCamera = (t: number, dt: number, wheel: WheelState) => {
    // Pull back to see the ring while it's turned by hand or flung far; push in on the table when it settles.
    const far = wheel.dragging || (wheel.target !== null && Math.abs(wheel.target - wheel.p) > 1.6) || Math.abs(wheel.v) > 5;
    spinAmt = damp(spinAmt, far ? 1 : 0, far ? 3.2 : 1.9, dt);
    const s = ease(spinAmt);
    const lerp = (a: number, b: number) => a + (b - a) * s;
    // Portrait screens need more room either side of the table.
    const aspect = W / H;
    const fit = aspect < 1.2 ? Math.min(1.9, 1.2 / Math.max(0.45, aspect)) : 1;
    const shot = { dist: lerp(HERO.dist, SPIN.dist), y: lerp(HERO.y, SPIN.y), ty: lerp(HERO.ty, SPIN.ty), fov: lerp(HERO.fov * fit, SPIN.fov * Math.min(1.35, fit)), aperture: lerp(HERO.aperture, SPIN.aperture) };
    const calm = opts.reducedMotion ? 0 : 1;
    ptrS.x = damp(ptrS.x, ptr.x, 3, dt);
    ptrS.y = damp(ptrS.y, ptr.y, 3, dt);
    const az = CAM_AZ + calm * (Math.sin(t * 0.11) * 0.035 + ptrS.x * 0.045);
    const y = shot.y + calm * (Math.sin(t * 0.17 + 1) * 0.06 - ptrS.y * 0.12);
    camPos.set(Math.sin(az) * shot.dist, y, Math.cos(az) * shot.dist);
    camTarget.set(0, shot.ty + (aspect < 1.2 ? -0.15 : 0), 0);
    camera.position.copy(camPos);
    camera.lookAt(camTarget);
    if (Math.abs(camera.fov - Math.min(60, shot.fov)) > 1e-3) {
      camera.fov = Math.min(60, shot.fov);
      camera.updateProjectionMatrix();
      sizeScales();
    }
    focus = camPos.distanceTo(FOCUS_AT);
    aperture = shot.aperture;
  };

  // ---- Streaming: what to fetch, nearest first (only recomputed when the wheel's slot, rest or sequence changes).
  let wantSig = "";
  const updateWants = (wheel: WheelState) => {
    if (!stream || len === 0) {
      if (wantSig !== "none") { wantSig = "none"; stream?.want([]); }
      return;
    }
    const rest = wheel.target ?? Math.round(wheel.p);
    const fast = wheel.dragging ? Math.abs(wheel.v) > 6 : Math.abs(wheel.v) > 8;
    const c = Math.round(wheel.p);
    const sig = `${version}|${rest}|${fast ? "f" : c}|${wheel.dragging ? 1 : 0}`;
    if (sig === wantSig) return;
    wantSig = sig;
    const list: Want[] = [];
    if (!wheel.dragging) list.push({ mon: monAt(rest), lod: "hero", priority: 0 });
    // Where it will land: the pods round there.
    const reach = Math.min(len >= PODS ? 5 : Math.floor(len / 2), 6);
    for (let d = -reach; d <= reach; d++) list.push({ mon: monAt(rest + d), lod: "pod", priority: 1 + Math.abs(d) * 0.5 });
    if (!fast) {
      // The pods on show now.
      for (const s of podSlots(wheel.p, len)) if (s !== null) list.push({ mon: monAt(s), lod: "pod", priority: 2 + Math.abs(s - wheel.p) * 0.4 });
      // The table's next Pokémon either way, ready for an arrow press.
      if (!wheel.dragging && len > 1) {
        list.push({ mon: monAt(rest + 1), lod: "hero", priority: 3.2 });
        list.push({ mon: monAt(rest - 1), lod: "hero", priority: 3.4 });
        if (!opts.phone && len > 3) {
          list.push({ mon: monAt(rest + 2), lod: "hero", priority: 6 });
          list.push({ mon: monAt(rest - 2), lod: "hero", priority: 6.2 });
        }
      }
    }
    stream.want(list);
  };

  // ---- The wall's specimen index (redrawn when the wheel moves on a slot, at most a few times a second).
  let indexAt = NaN;
  let indexClock = 0;
  const redrawIndex = (c: number, dt: number) => {
    indexClock -= dt;
    if (c === indexAt || indexClock > 0 || len === 0) return;
    indexAt = c;
    indexClock = 0.15;
    const rows = Array.from({ length: Math.min(12, len) }, (_, k) => monAt(c - 3 + k));
    drawIndex(room.index.canvas, rows, Math.min(3, len - 1), opts.fonts);
    room.index.texture.needsUpdate = true;
  };

  const heroWanted = (w: WheelState): LabMon | null => {
    if (len === 0 || w.dragging || w.target === null) return null;
    if (Math.abs(w.p - w.target) > 0.6) return null;
    return monAt(w.target);
  };

  let tableMon: number | null = null;
  const updateHero = (w: WheelState, dt: number) => {
    const want = heroWanted(w);
    const live = heroes.find((h) => h.phase !== "out");
    if (live && live.fig.id !== want?.id) {
      live.phase = "out";
      live.t = 0;
    }
    if (want && !heroes.some((h) => h.phase !== "out" && h.fig.id === want.id)) {
      const fig = stream?.get(want.id, "hero");
      if (fig) {
        if (fig.root.parent) fig.root.removeFromParent();
        // The same figure may still be dissolving out (back and forth quickly): take it over.
        for (const h of heroes) if (h.fig === fig) fig.inUse--;
        heroes = heroes.filter((h) => h.fig !== fig);
        const scan: HoloScan = { color: { value: tint.clone() }, feetY: { value: TABLE_TOP }, scanY: { value: TABLE_TOP }, amount: { value: 1 }, band: { value: 1 } };
        if (!scanned.has(fig)) {
          scanned.add(fig);
          for (const m of fig.handle.materials) holoScan(m, scan, time);
          fig.root.userData.scan = scan;
        }
        const s = (fig.root.userData.scan as HoloScan) ?? scan;
        s.band.value = 1;
        s.scanY.value = TABLE_TOP;
        heroTurn.add(fig.root);
        fig.inUse++;
        setFade(fig, 0);
        heroes.push({ fig, scan: s, phase: "in", t: 0 });
        if (tableMon !== want.id) {
          tableMon = want.id;
          table.caption(want);
        }
      }
    }
    const dIn = opts.reducedMotion ? 0.3 : 1.15;
    const dOut = opts.reducedMotion ? 0.15 : 0.32;
    for (const h of heroes) {
      h.t += dt;
      h.scan.color.value.copy(tint);
      if (h.phase === "in") {
        const f = h.t / dIn;
        setFade(h.fig, Math.min(1, h.t / 0.18));
        h.scan.scanY.value = TABLE_TOP - 0.05 + ease(f) * (h.fig.h + 0.25);
        h.scan.band.value = f < 1 ? 1 : Math.max(0, 1 - (f - 1) * 4);
        if (f >= 1.25) { h.phase = "show"; h.scan.band.value = 0; }
      } else if (h.phase === "out") {
        setFade(h.fig, 1 - h.t / dOut);
        h.scan.band.value = 0;
      }
    }
    for (const h of heroes) {
      if (h.phase === "out" && h.t >= dOut) {
        h.fig.root.removeFromParent();
        h.fig.inUse--;
        setFade(h.fig, 1);
      }
    }
    heroes = heroes.filter((h) => !(h.phase === "out" && h.t >= dOut));
    // Scanning in: the column brightens.
    const scanning = heroes.some((h) => h.phase === "in") || (want !== null && !heroes.some((h) => h.fig.id === want.id));
    colK = damp(colK, scanning ? 0.32 : 0.12, 4, dt);
    table.column(colK);
    // The figure faces the camera, turning slowly a little either way.
    const face = Math.atan2(camPos.x, camPos.z) * 0.72;
    heroTurn.rotation.y = face + (opts.reducedMotion ? 0 : Math.sin(clock * 0.22) * 0.32);
  };
  let colK = 0.12;
  let clock = 0;

  const placeOnPod = (ps: PodState, fig: Fig) => {
    if (fig.root.parent) fig.root.removeFromParent();
    ps.pod.stand.add(fig.root);
    fig.inUse++;
  };
  const unplace = (s: Shown) => {
    s.fig.root.removeFromParent();
    s.fig.inUse--;
    setFade(s.fig, 1);
  };

  const updatePods = (w: WheelState, dt: number) => {
    const slots = podSlots(w.p, len);
    const c = Math.round(w.p);
    const heroId = heroes.find((h) => h.phase !== "out")?.fig.id ?? null;
    const heroIn = heroes.find((h) => h.phase === "show" || (h.phase === "in" && h.t > 0.5))?.fig.id ?? null;
    const fadeK = opts.reducedMotion ? 10 : 5;
    for (let k = 0; k < PODS; k++) {
      const ps = pods[k];
      const slot = slots[k];
      const mon = slot === null ? null : monAt(slot);
      // Placed on the ring: pod k at its slot's angle.
      const a = CAM_AZ + (k - w.p + 0.5) * STEP;
      const g = ps.pod.group;
      g.position.set(Math.sin(a) * ROOM.ringR, 0, Math.cos(a) * ROOM.ringR);
      g.rotation.y = a;
      ps.pod.centre.copy(g.position);
      ps.pod.turn.rotation.y = Math.atan2(camPos.x - g.position.x, camPos.z - g.position.z) - a;
      if (mon !== ps.mon || ps.version !== version) {
        const changed = mon?.id !== ps.mon?.id || ps.version !== version;
        ps.version = version;
        ps.slot = slot;
        if (changed) {
          if (ps.cur) ps.old.push(ps.cur);
          ps.cur = null;
          ps.mon = mon;
          ps.pod.show(mon);
          ps.delay = refill && slot !== null ? 0.05 + 0.045 * Math.abs(slot - c) : 0;
        } else ps.mon = mon;
      }
      ps.slot = slot;
      ps.delay = Math.max(0, ps.delay - dt);
      // Its figure: placed when it's arrived (after the refill's wave), dissolving in; hidden while it stands on the table.
      if (ps.mon && !ps.cur && ps.delay === 0) {
        const fig = stream?.get(ps.mon.id, "pod");
        if (fig && fig.inUse === 0) {
          placeOnPod(ps, fig);
          ps.cur = { fig, a: 0 };
        }
      }
      if (ps.cur) {
        const onTable = heroIn !== null && ps.cur.fig.id === heroIn && slot === w.target;
        ps.cur.a = Math.min(1, Math.max(0, ps.cur.a + (onTable ? -dt * 3 : dt * fadeK * 0.5)));
        setFade(ps.cur.fig, ps.cur.a);
      }
      for (const o of ps.old) {
        o.a -= dt * fadeK;
        setFade(o.fig, o.a);
      }
      for (const o of ps.old) if (o.a <= 0) unplace(o);
      ps.old = ps.old.filter((o) => o.a > 0);
      // The hologram stands in until the figure has dissolved in (not while it's the one on the table).
      const onTableNow = ps.mon !== null && heroId === ps.mon.id && slot === w.target;
      const wantHolo = ps.mon !== null && !onTableNow && (!ps.cur || ps.cur.a < 0.6) ? 1 : 0;
      ps.holo = damp(ps.holo, wantHolo, 6, dt);
      ps.pod.holo(ps.holo);
      // The chosen pod glows in the tint.
      const sel = slot === null ? 0 : Math.max(0, 1 - Math.abs(slot - w.p) * 1.6);
      ps.pod.select(sel, tint);
      (floorUniforms.uPodCol.value[k] as THREE.Color).copy(ps.mon ? typeTint(ps.mon.types[0]) : EMPTY_POD);
    }
    refill = false;
    floorUniforms.uRingPhase.value = CAM_AZ + (0.5 - w.p) * STEP;
    floorUniforms.uSel.value = mod(Math.round(w.p), PODS);
    cableRing.rotation.y = CAM_AZ + (0.5 - w.p) * STEP;
  };

  const updateTint = (w: WheelState, dt: number) => {
    if (len > 0) {
      const m = monAt(w.target ?? Math.round(w.p));
      tintTarget.copy(typeTint(m.types[0]));
      particles.setType(m.types[0], tintTarget);
    }
    tint.lerp(tintTarget, 1 - Math.exp(-dt * (opts.reducedMotion ? 10 : 2.6)));
    floorUniforms.uSelCol.value.copy(tint);
    table.tint(tint);
    rimB.color.copy(tint).lerp(white, 0.15);
    under.color.copy(tint);
    tableMoteCol.copy(tint).lerp(white, 0.3);
  };

  const raycaster = new THREE.Raycaster();
  let lastWheel: WheelState = { p: 0, v: 0, target: 0, dragging: false };

  return {
    canvas,
    ready,
    setSequence(n, at, ver) {
      len = n;
      monAt = (i) => at(mod(i, n));
      version = ver;
      refill = true;
      wantSig = "";
      indexAt = NaN;
    },
    frame(w, dt, t) {
      lastWheel = w;
      clock = t;
      time.value = t;
      if (ctxWatch.lost || !post) return;
      placeCamera(t, dt, w);
      updateWants(w);
      updateTint(w, dt);
      updateHero(w, dt);
      updatePods(w, dt);
      particles.update(dt);
      redrawIndex(Math.round(w.p), dt);
      if (mirror) {
        mirror.update(renderer, scene, camera, [room.floor]);
        floorUniforms.uMirror.value.copy(mirror.matrix);
      }
      post.frame(camera, focus, aperture * pr, 0.1);
      post.render();
    },
    pointer(nx, ny) {
      ptr.set(Math.max(-1, Math.min(1, nx)), Math.max(-1, Math.min(1, ny)));
    },
    pick(x, y) {
      raycaster.setFromCamera(new THREE.Vector2((x / W) * 2 - 1, -(y / H) * 2 + 1), camera);
      let best: { d: number; slot: number } | null = null;
      for (const ps of pods) {
        if (ps.slot === null) continue;
        const hit = raycaster.intersectObjects(ps.pod.hit, false)[0];
        if (hit && (!best || hit.distance < best.d)) best = { d: hit.distance, slot: ps.slot };
      }
      return best?.slot ?? null;
    },
    resize(w, h) {
      W = Math.max(1, w);
      H = Math.max(1, h);
      renderer.setSize(W, H, false);
      post?.setSize(W, H);
      mirror?.setSize(Math.max(2, Math.round(W * pr * spec.mirror)), Math.max(2, Math.round(H * pr * spec.mirror)));
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      sizeScales();
    },
    setTier(t) {
      if (t === tier) return;
      tier = t;
      applyTier();
    },
    stats() {
      const w = lastWheel;
      let blank = 0;
      for (const ps of pods) {
        if (!ps.mon) continue;
        const onTable = heroes.some((h) => h.phase !== "out" && h.fig.id === ps.mon!.id) && ps.slot === w.target;
        if (!onTable && (!ps.cur || ps.cur.a < 0.99)) blank++;
      }
      const hero = heroes.find((h) => h.phase === "show" || h.phase === "in");
      return {
        tier,
        blankPods: blank,
        heroShown: !!hero,
        heroId: hero?.fig.id ?? null,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        programs: renderer.info.programs?.length ?? 0,
        calls: renderer.info.render.calls,
        stream: stream!.stats(),
      };
    },
    dispose() {
      ctxWatch.dispose();
      stream?.dispose();
      stream = null;
      pods.forEach((p) => p.pod.dispose());
      particles.dispose();
      for (const m of [dust, tableMotes]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
      for (const d of dummies) { d.geometry.dispose(); (d.material as THREE.Material).dispose(); (d.customDepthMaterial as THREE.Material | undefined)?.dispose(); }
      dummyTex.dispose();
      table.dispose();
      room.dispose();
      cables.dispose();
      mirror?.dispose();
      post?.dispose();
      shadowTex.dispose();
      blobGeo.dispose();
      (scene.environment as THREE.Texture | null)?.dispose();
      key.shadow.map?.dispose();
      rimA.shadow.map?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
