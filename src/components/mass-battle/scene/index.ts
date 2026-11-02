import * as THREE from "three";
import type { ArenaId, MBSpecies } from "@/lib/mass-battle/types";
import { buildArena, type Arena } from "./arena";
import { loadAll } from "./assets";
import { Effects } from "./effects";
import { UnitsLayer, type UnitsView } from "./units";

/**
 * The Mass Battle's 3D scene: an arena, the armies as instanced 3D relief
 * figures, the move effects and the camera. Everything (terrain, every
 * species' figures at every detail level, every shader) is loaded, built
 * and compiled in `deploy`, behind the "deploying armies" screen, so
 * nothing pops in or stutters once the battle starts. The page owns the
 * clock and the camera's path; the scene draws a frame for them.
 */

/** "draft" is for automated checks on machines without a GPU; "export" renders videos. */
export type Quality = "draft" | "low" | "medium" | "high" | "export";

export interface QualitySpec {
  pr: number;
  aa: boolean;
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
}

export const QUALITY: Record<Quality, QualitySpec> = {
  draft: { pr: 1, aa: false, cap: 1500, segments: [24, 10], bossSegments: [48, 16], lodPx: [70], particles: 900, props: 0.25, anisotropy: 1 },
  low: { pr: 1, aa: false, cap: 1500, segments: [32, 12], bossSegments: [72, 24], lodPx: [70], particles: 1600, props: 0.5, anisotropy: 2 },
  medium: { pr: 1.25, aa: true, cap: 5000, segments: [56, 28, 12], bossSegments: [96, 40, 16], lodPx: [170, 48], particles: 3200, props: 0.8, anisotropy: 4 },
  high: { pr: 1.75, aa: true, cap: 10000, segments: [72, 32, 16], bossSegments: [120, 56, 24], lodPx: [150, 40], particles: 5000, props: 1, anisotropy: 8 },
  export: { pr: 1, aa: true, cap: 10000, segments: [72, 32, 16], bossSegments: [120, 56, 24], lodPx: [120, 32], particles: 5000, props: 1, anisotropy: 8 },
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
  /** Species shown with the hero relief. */
  bosses: Set<number>;
  view: Pick<UnitsView, "n" | "sp" | "draw">;
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
  render(view: UnitsView | null, dt: number): void;
  /** A world point on screen (CSS px), or null behind the camera. */
  project(x: number, y: number, z: number): { x: number; y: number } | null;
  heightAt(x: number, z: number): number;
  stats(): { calls: number; triangles: number; instances: number };
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
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.aa, alpha: false, powerPreference: "high-performance", stencil: false, preserveDrawingBuffer: !!opts.size });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const sizeOf = () => opts.size ?? { w: Math.max(1, host.clientWidth), h: Math.max(1, host.clientHeight) };
  let { w: W, h: H } = sizeOf();
  const applyPr = () => renderer.setPixelRatio(opts.size ? 1 : Math.min(window.devicePixelRatio || 1, Q.pr));
  applyPr();
  renderer.setSize(W, H, false);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 6000);
  const effects = new Effects(Q.particles);
  effects.density = quality === "draft" ? 0.5 : quality === "low" ? 0.7 : 1;
  scene.add(effects.group);
  let arena: Arena | null = null;
  let units: UnitsLayer | null = null;
  let shake = 0;
  const shakeSeed = Math.random() * 100;
  let clock = 0;
  const focus = new THREE.Vector3();

  const setCamera = (p: CameraPose) => {
    camera.fov = p.fov;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
    camera.position.set(p.tx + Math.sin(p.yaw) * cp * p.dist, p.ty + sp * p.dist, p.tz + Math.cos(p.yaw) * cp * p.dist);
    shake = p.shake;
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

  async function deploy(input: DeployInput, onProgress: (p: number, label: string) => void, signal?: AbortSignal) {
    onProgress(0, "Preparing the battlefield");
    // The arena.
    if (arena) {
      scene.remove(arena.group);
      arena.dispose();
    }
    arena = buildArena(input.arena, { radius: input.radius, props: Q.props, anisotropy: Q.anisotropy, tex: opts.tex });
    scene.add(arena.group);
    const look = arena.look;
    scene.fog = new THREE.Fog(look.fog, input.radius * look.fogNear, input.radius * look.fogFar + 120);
    scene.background = new THREE.Color(look.fog);
    renderer.toneMappingExposure = look.exposure;
    camera.far = input.radius * 12 + 400;
    // The figures.
    onProgress(0.02, "Deploying armies");
    const assets = await loadAll(
      input.species.map((s) => ({ s, segments: input.bosses.has(s.id) ? Q.bossSegments : Q.segments, artSize: input.bosses.has(s.id) ? (512 as const) : (256 as const) })),
      (p) => onProgress(0.02 + p * 0.78, "Deploying armies"),
      signal
    );
    await arena.ready;
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    units?.dispose();
    if (units) scene.remove(units.group);
    units = new UnitsLayer(input.species, assets, input.view, { lodPx: Q.lodPx, anisotropy: Q.anisotropy });
    scene.add(units.group);
    // Compile every shader and upload every texture and buffer now, with one of each figure on screen.
    onProgress(0.84, "Warming up");
    for (const t of units.textures()) renderer.initTexture(t);
    units.primeAll(new THREE.Vector3(0, 0, 0));
    setCamera({ tx: 0, ty: 1, tz: 0, yaw: 0.6, pitch: 0.5, dist: input.radius * 1.2, fov: 40, shake: 0 });
    await renderer.compileAsync(scene, camera).catch(() => undefined);
    onProgress(0.96, "Warming up");
    renderer.render(scene, camera);
    onProgress(1, "Ready");
  }

  function render(view: UnitsView | null, dt: number) {
    clock += dt;
    if (view) {
      units?.update(view, camera, H, dt);
      effects.setTime(view.t);
      arena?.update(view.t, focus);
    } else {
      effects.setTime(clock);
      arena?.update(clock, focus);
    }
    renderer.render(scene, camera);
  }

  return {
    canvas,
    get quality() {
      return quality;
    },
    setQuality(q) {
      quality = q;
      Q = QUALITY[q];
      applyPr();
      renderer.setSize(W, H, false);
      if (units) units.opts.lodPx = Q.lodPx;
      effects.density = q === "low" ? 0.7 : 1;
    },
    resize(w, h) {
      W = Math.max(1, w);
      H = Math.max(1, h);
      renderer.setSize(W, H, false);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
    },
    deploy,
    effects,
    camera,
    setCamera,
    render,
    project(x, y, z) {
      const v = new THREE.Vector3(x, y, z).project(camera);
      if (v.z > 1 || v.z < -1) return null;
      return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H };
    },
    heightAt: (x, z) => arena?.heightAt(x, z) ?? 0,
    stats() {
      const d = units?.drawn ?? { instances: 0, triangles: 0, calls: 0 };
      return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, instances: d.instances };
    },
    dispose() {
      units?.dispose();
      arena?.dispose();
      effects.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
