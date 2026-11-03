import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { buildReliefMesh, type ReliefMap } from "@/lib/sizes/relief";
import type { ReliefJob, ReliefResult } from "./relief-worker";
import type { RefKind } from "@/lib/sizes/types";
import { figureLook } from "./shaders";

/**
 * The figures on the line. Each Pokémon is built by a FigureProvider:
 *
 * - Tier 1 (all of them): the Pokémon HOME render on a relief mesh. The
 *   front surface follows a depth estimate of the render, a rounded back
 *   gives it volume, so it catches the sun, casts a real shadow and holds
 *   up as the camera moves around it.
 * - Tier 2 (any figure, later): a real 3D model listed in a manifest
 *   (art id → GLB url) replaces the relief figure for that Pokémon.
 *
 * Figures are streamed: built well before they come near the camera (a
 * detailed mesh near the focus, a lighter one around it; far ones are the
 * crowd's low-detail reliefs, see crowd.ts), dropped when they are far
 * behind. Relief meshes are built in a worker, so a figure streaming in
 * never stalls a frame.
 */

export interface SceneItem {
  key: string;
  name: string;
  kind: string;
  /** PokéAPI id of the HOME render (0 for references). */
  art: number;
  species: number;
  m: number;
  length: boolean;
  min: boolean;
  /** World size (m) of the figure's box. */
  w: number;
  h: number;
  /** The render's visible box [x, y, w, h, image size]. */
  box: [number, number, number, number, number];
  types: string[];
  ref?: RefKind;
}

export type Lod = 0 | 1 | 2; // 0 hero relief, 1 relief, 2 flat cut-out (kept for other scenes: /pokedex/sizes draws far figures as the crowd's 3D reliefs)

export interface FigureHandle {
  object: THREE.Object3D;
  /** Front-to-back extent (m) after scaling, for the contact shadow. */
  depth: number;
  lod: Lod;
  materials: THREE.Material[];
  /** Its own materials (a model), not the shared relief look: its shaders need compiling. */
  custom?: boolean;
  /** Relief figures: the dissolve uniform (1 drawn whole; see DITHER_GLSL in shaders.ts). */
  fade?: { value: number };
  dispose(): void;
}

/** How soon a figure is needed: "high" ones are fetched ahead of everything else. */
export interface LoadOptions {
  priority?: "high" | "low";
}

export interface FigureProvider {
  /** Whether this provider has a figure for the item. */
  has(item: SceneItem): boolean;
  load(item: SceneItem, lod: Lod, signal: AbortSignal, opts?: LoadOptions): Promise<FigureHandle>;
}

export interface FigureUrls {
  /** The HOME render at a size (px). */
  art(id: number, size: 128 | 256 | 512): string;
  /** The baked relief map. */
  relief(id: number): string;
}

const SEGMENTS: Record<Lod, number> = { 0: 120, 1: 72, 2: 0 };

async function fetchBitmap(url: string, signal: AbortSignal, priority?: "high" | "low"): Promise<ImageBitmap> {
  const res = await fetch(url, priority ? ({ signal, priority } as RequestInit) : { signal });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const blob = await res.blob();
  return createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

let pixelCanvas: CanvasRenderingContext2D | null = null;
/** A decoded map's bytes (relief maps are small, 128 px on the long side: one shared CPU canvas does). */
function bitmapPixels(bmp: ImageBitmap): ReliefMap & { data: Uint8ClampedArray } {
  if (!pixelCanvas) pixelCanvas = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  const cv = pixelCanvas.canvas;
  if (cv.width < bmp.width || cv.height < bmp.height) {
    cv.width = Math.max(cv.width, bmp.width);
    cv.height = Math.max(cv.height, bmp.height);
  }
  pixelCanvas.clearRect(0, 0, bmp.width, bmp.height);
  pixelCanvas.drawImage(bmp, 0, 0);
  const img = pixelCanvas.getImageData(0, 0, bmp.width, bmp.height);
  return { w: bmp.width, h: bmp.height, data: img.data, channels: 4 };
}

interface MeshArrays {
  position: Float32Array;
  normal: Float32Array;
  /** Flipped for textures uploaded without flipY. */
  uv: Float32Array;
  index: Uint32Array | Uint16Array;
  height: number;
  zMin: number;
  zMax: number;
  sphere?: [number, number, number, number];
}

let worker: Worker | null | undefined;
let nextJob = 1;
const jobs = new Map<number, (r: ReliefResult | null) => void>();

function reliefWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = typeof Worker === "undefined" ? null : new Worker(new URL("./relief-worker.ts", import.meta.url));
  } catch {
    worker = null;
  }
  if (worker) {
    worker.onmessage = (e: MessageEvent<ReliefResult>) => {
      const done = jobs.get(e.data.id);
      jobs.delete(e.data.id);
      done?.(e.data.ok ? e.data : null);
    };
    worker.onerror = () => {
      // A broken worker: everything waiting (and everything after) is built on the main thread.
      for (const done of jobs.values()) done(null);
      jobs.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

/** The mesh, built off the main thread when a worker is available (the pixels are handed over, not copied). */
function buildInWorker(map: ReliefMap & { data: Uint8ClampedArray }, box: { x: number; y: number; w: number; h: number; size: number }, segments: number): Promise<MeshArrays | null> {
  const w = reliefWorker();
  if (!w) return Promise.resolve(null);
  return new Promise((resolve) => {
    const id = nextJob++;
    jobs.set(id, (r) => resolve(r && r.position && r.normal && r.uv && r.index ? { position: r.position, normal: r.normal, uv: r.uv, index: r.index, height: r.height ?? 1, zMin: r.zMin ?? 0, zMax: r.zMax ?? 0, sphere: r.sphere } : null));
    const job: ReliefJob = { id, w: map.w, h: map.h, data: map.data, box, segments };
    w.postMessage(job, [map.data.buffer]);
  });
}

function buildHere(map: ReliefMap, box: { x: number; y: number; w: number; h: number; size: number }, segments: number): MeshArrays {
  const mesh = buildReliefMesh(map, box, segments);
  const uv = new Float32Array(mesh.uv.length);
  for (let i = 0; i < uv.length; i += 2) { uv[i] = mesh.uv[i]; uv[i + 1] = 1 - mesh.uv[i + 1]; }
  return { position: mesh.position, normal: mesh.normal, uv, index: mesh.index, height: mesh.height, zMin: mesh.zMin, zMax: mesh.zMax };
}

function textureFrom(bmp: ImageBitmap, anisotropy: number): THREE.Texture {
  const t = new THREE.Texture(bmp as unknown as HTMLImageElement);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

/** Tier 1: HOME render + relief map. */
export class ReliefProvider implements FigureProvider {
  /** Alpha to coverage: smooth cut-out edges with multisampling; without it, a plain cut is crisper (no speckled fringe). */
  private coverage: boolean;
  constructor(private urls: FigureUrls, private opts: { anisotropy: number; sharpen: number; texSize: 256 | 512; coverage?: boolean; segments?: number }) {
    this.coverage = opts.coverage ?? true;
  }
  /** Figures built from now on use alpha to coverage or not (the quality's multisampling changed). */
  setCoverage(on: boolean) { this.coverage = on; }
  has(item: SceneItem) { return item.art > 0; }
  /** A relief figure's mesh and materials (also used to compile their shaders before the first figure arrives). */
  dress(geo: THREE.BufferGeometry, tex: THREE.Texture, texSize: number) {
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, alphaToCoverage: this.coverage, roughness: 0.62, metalness: 0, envMapIntensity: 0.8 });
    const fade = { value: 1 };
    figureLook(mat, texSize, this.opts.sharpen, fade);
    const obj = new THREE.Mesh(geo, mat);
    obj.castShadow = true;
    obj.receiveShadow = true;
    obj.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.5 });
    return { mat, obj, fade };
  }
  async load(item: SceneItem, lod: Lod, signal: AbortSignal, opts: LoadOptions = {}): Promise<FigureHandle> {
    const [bx, by, bw, bh, size] = item.box;
    const L = Math.max(bw, bh);
    if (lod === 2) {
      // A flat cut-out (far away): no relief needed.
      const bmp = await fetchBitmap(this.urls.art(item.art, 128), signal);
      const tex = textureFrom(bmp, this.opts.anisotropy);
      tex.flipY = false;
      const geo = new THREE.PlaneGeometry(bw / L, bh / L);
      geo.translate(0, bh / L / 2, 0);
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i), v = uv.getY(i);
        uv.setXY(i, (bx + u * bw) / size, (by + (1 - v) * bh) / size);
      }
      const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.6, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.5 });
      const s = item.h / (bh / L);
      mesh.scale.setScalar(s);
      return {
        object: mesh,
        depth: item.w * 0.15,
        lod,
        materials: [mat],
        dispose() { geo.dispose(); mat.dispose(); tex.dispose(); bmp.close(); (mesh.customDepthMaterial as THREE.Material).dispose(); },
      };
    }
    // The hero (a figure filling the screen) always gets the full 512 px render: there are only ever one or two.
    const texSize = lod === 0 ? 512 : this.opts.texSize;
    const [artBmp, reliefBmp] = await Promise.all([fetchBitmap(this.urls.art(item.art, texSize), signal, opts.priority), fetchBitmap(this.urls.relief(item.art), signal, opts.priority)]);
    // UVs address the full render; the texture may be a smaller copy of it (same framing).
    const box = { x: bx, y: by, w: bw, h: bh, size };
    let mesh: MeshArrays | null;
    try {
      const segments = lod === 1 && this.opts.segments ? this.opts.segments : SEGMENTS[lod];
      mesh = (await buildInWorker(bitmapPixels(reliefBmp), box, segments)) ?? buildHere(bitmapPixels(reliefBmp), box, segments);
    } finally {
      reliefBmp.close();
    }
    if (signal.aborted) {
      artBmp.close();
      throw new DOMException("aborted", "AbortError");
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(mesh.position, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(mesh.normal, 3));
    // Bitmaps upload with flipY off, so v runs down the image (the builder already flipped the mesh's v).
    geo.setAttribute("uv", new THREE.BufferAttribute(mesh.uv, 2));
    geo.setIndex(new THREE.BufferAttribute(mesh.index, 1));
    // Measured in the worker when it built the mesh (a pass over every vertex the main thread is spared).
    if (mesh.sphere) geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(mesh.sphere[0], mesh.sphere[1], mesh.sphere[2]), mesh.sphere[3]);
    else geo.computeBoundingSphere();
    const tex = textureFrom(artBmp, this.opts.anisotropy);
    const { mat, obj, fade } = this.dress(geo, tex, artBmp.width);
    const s = item.h / mesh.height;
    obj.scale.setScalar(s);
    return {
      object: obj,
      depth: (mesh.zMax - mesh.zMin) * s,
      lod,
      materials: [mat],
      fade,
      dispose() { geo.dispose(); mat.dispose(); tex.dispose(); artBmp.close(); (obj.customDepthMaterial as THREE.Material).dispose(); },
    };
  }
}

/** Tier 2: real 3D models from a manifest (art id → GLB url), when one exists. */
export class ModelProvider implements FigureProvider {
  private manifest: Record<string, string> = {};
  constructor(manifest: Record<string, string>) { this.manifest = manifest; }
  has(item: SceneItem) { return !!this.manifest[String(item.art)]; }
  async load(item: SceneItem, lod: Lod, signal: AbortSignal): Promise<FigureHandle> {
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const url = this.manifest[String(item.art)];
    const gltf = await new GLTFLoader().loadAsync(url);
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    const root = gltf.scene;
    // Normalise: feet on y = 0, centred, height = the documented size.
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const s = item.h / Math.max(1e-6, size.y);
    const holder = new THREE.Group();
    root.position.set(-(box.min.x + size.x / 2), -box.min.y, -(box.min.z + size.z / 2));
    holder.add(root);
    holder.scale.setScalar(s);
    const materials: THREE.Material[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = m.receiveShadow = true; materials.push(...(Array.isArray(m.material) ? m.material : [m.material])); }
    });
    return {
      object: holder,
      depth: size.z * s,
      lod,
      materials,
      custom: true,
      dispose() { root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); }); materials.forEach((m) => m.dispose()); },
    };
  }
}

// ---------------------------------------------------------------------------
// Real-world scale references (procedural, in the scene's style)
// ---------------------------------------------------------------------------

export interface RefBuilders {
  /** The player's (or a default) 3D trainer, ~1 unit tall, feet at 0, facing +z. */
  trainer?: () => Promise<{ object: THREE.Object3D; update?(t: number, dt: number): void; dispose(): void }>;
}

/** A side profile (x along the length, y up, metres) extruded across `width`, centred on z, with softly rounded edges. */
function profileBody(outline: THREE.Shape, width: number, bevel: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(outline, { depth: Math.max(0.01, width - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.6, bevelSegments: 2, curveSegments: 10 });
  g.translate(0, 0, -(width - 2 * bevel) / 2);
  return g;
}

/** An outline from points, with wheel arches cut into its bottom edge (each [centre x, centre y, radius]) as it runs from back to front. */
function archedOutline(top: [number, number][], bottomY: number, back: number, front: number, arches: [number, number, number][]): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(back, bottomY);
  for (const [cx, cy, r] of [...arches].sort((a, b) => a[0] - b[0])) {
    s.lineTo(cx - r, bottomY);
    s.lineTo(cx - r, cy);
    s.absarc(cx, cy, r, Math.PI, 0, true);
    s.lineTo(cx + r, bottomY);
  }
  s.lineTo(front, bottomY);
  for (const [x, y] of top) s.lineTo(x, y);
  s.closePath();
  return s;
}

/**
 * The car and the bus, side-on, front towards +x: a body extruded from its
 * side profile with arches over the wheels, a glasshouse with its pillars,
 * lamps, bumpers, tyres and hubs. The car is a red saloon, the bus a
 * yellow school bus with a short hood, its windows and warning lamps
 * (plain liveries, no logos or lettering). Returns the vehicle's width.
 */
function vehicle(kind: "car" | "bus", L: number, add: (geo: THREE.BufferGeometry, m: THREE.Material | THREE.Material[]) => THREE.Mesh, mat: (p: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial, materials: THREE.Material[]): number {
  const glass = mat({ color: "#3a4d60", roughness: 0.07, metalness: 0.3, envMapIntensity: 1.8 });
  const tyre = mat({ color: "#161616", roughness: 0.92 });
  const hub = mat({ color: "#c9ccd1", roughness: 0.3, metalness: 0.85 });
  const trim = mat({ color: "#2a2c30", roughness: 0.6, metalness: 0.2 });
  const head = mat({ color: "#fff6e0", emissive: "#fff1cc", emissiveIntensity: 0.6, roughness: 0.2 });
  const tail = mat({ color: "#b3121b", emissive: "#d0101a", emissiveIntensity: 0.5, roughness: 0.3 });
  const half = L / 2;
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => add(new THREE.BoxGeometry(w, h, d).translate(x, y, z), m);
  const wheels = (xs: number[], r: number, W: number) => {
    for (const x of xs) for (const side of [1, -1]) {
      add(new THREE.CylinderGeometry(r, r, 0.24, 20).rotateX(Math.PI / 2).translate(x, r, side * (W / 2 - 0.11)), tyre);
      add(new THREE.CylinderGeometry(r * 0.58, r * 0.58, 0.25, 16).rotateX(Math.PI / 2).translate(x, r, side * (W / 2 - 0.105)), hub);
    }
  };
  if (kind === "car") {
    const W = 1.78, r = 0.33, wf = half - 0.9, wb = -half + 0.95;
    const paint = new THREE.MeshPhysicalMaterial({ color: "#c0262d", roughness: 0.28, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.08 });
    materials.push(paint);
    // The body: boot, waistline, bonnet and nose, arches over the wheels.
    const body = archedOutline([[half, 0.3], [half + 0.01, 0.56], [half - 0.22, 0.72], [half - 1.25, 0.84], [-half + 1.05, 0.86], [-half + 0.22, 0.8], [-half, 0.62]], 0.2, -half, half, [[wb, r, r + 0.07], [wf, r, r + 0.07]]);
    add(profileBody(body, W, 0.07), paint);
    // The glasshouse: windscreen, side windows and rear window, a little narrower than the body; the roof over it.
    const gh = new THREE.Shape([new THREE.Vector2(-half + 1.02, 0.82), new THREE.Vector2(half - 1.22, 0.82), new THREE.Vector2(half - 1.92, 1.33), new THREE.Vector2(-half + 1.62, 1.35)]);
    add(profileBody(gh, W * 0.86, 0.03), glass);
    const roof = new THREE.Shape([new THREE.Vector2(-half + 1.6, 1.32), new THREE.Vector2(half - 1.9, 1.31), new THREE.Vector2(half - 1.97, 1.39), new THREE.Vector2(-half + 1.66, 1.41)]);
    add(profileBody(roof, W * 0.84, 0.04), paint);
    // Pillars: the slanted ones along the windscreen and rear window, an upright one between the doors.
    for (const side of [1, -1]) {
      const z = side * W * 0.43;
      const pillar = (x0: number, y0: number, x1: number, y1: number, t: number) => {
        const len = Math.hypot(x1 - x0, y1 - y0);
        add(new THREE.BoxGeometry(t, len, 0.05).rotateZ(-Math.atan2(x1 - x0, y1 - y0)).translate((x0 + x1) / 2, (y0 + y1) / 2, z), paint);
      };
      pillar(half - 1.22, 0.84, half - 1.9, 1.32, 0.07);
      pillar(-half + 1.04, 0.84, -half + 1.62, 1.33, 0.16);
      pillar(-0.35, 0.84, -0.35, 1.33, 0.09);
      // Mirror, lamps.
      box(0.16, 0.1, 0.12, half - 1.3, 0.95, side * (W / 2 + 0.05), paint);
      box(0.06, 0.13, 0.36, half + 0.0, 0.62, side * 0.56, head);
      box(0.06, 0.12, 0.34, -half - 0.01, 0.68, side * 0.6, tail);
    }
    box(0.14, 0.17, W * 0.94, half - 0.02, 0.3, 0, trim);
    box(0.14, 0.17, W * 0.94, -half + 0.02, 0.32, 0, trim);
    wheels([wb, wf], r, W);
    return W;
  }
  // The school bus (a conventional one, as the reference's Blue Bird Vision): school-bus yellow with a short hood before the windscreen,
  // a white roof (3.25 m to its top, as documented), black rub rails down the side, a row of windows, warning lamps at the roof's corners.
  const W = 2.44, r = 0.5, wf = half - 1.05, wb = -half + 3.4;
  const yellow = new THREE.MeshPhysicalMaterial({ color: "#f5b400", roughness: 0.3, metalness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.1 });
  materials.push(yellow);
  const roofM = mat({ color: "#f4f2ea", roughness: 0.5 });
  const amber = mat({ color: "#ffb21c", emissive: "#ff9a00", emissiveIntensity: 0.7, roughness: 0.3 });
  const red = mat({ color: "#c4161c", emissive: "#d0101a", emissiveIntensity: 0.6, roughness: 0.3 });
  const hood = half - 1.72;
  const body = archedOutline([[half, 0.42], [half + 0.02, 1.38], [half - 0.3, 1.52], [hood + 0.05, 1.6], [hood - 0.1, 2.92], [hood - 0.32, 3.04], [-half + 0.12, 3.04], [-half, 2.9]], 0.36, -half, half, [[wb, r, r + 0.1], [wf, r, r + 0.1]]);
  add(profileBody(body, W, 0.08), yellow);
  box(L - 2.2, 0.16, W - 0.12, -1.0, 3.1, 0, roofM);
  // Windows down the side, a yellow pillar between each; the windscreen over the hood.
  const x0 = -half + 0.45, x1 = hood - 0.55;
  box(x1 - x0, 0.86, W + 0.03, (x0 + x1) / 2, 2.2, 0, glass);
  const panes = Math.max(1, Math.round((x1 - x0) / 0.92));
  for (let k = 0; k <= panes; k++) box(0.13, 0.88, W + 0.06, x0 + (k * (x1 - x0)) / panes, 2.2, 0, yellow);
  add(new THREE.BoxGeometry(0.05, 1.12, W - 0.3).rotateZ(-0.1).translate(hood - 0.02, 2.24, 0), glass);
  // Rub rails and bumpers, black; the grille.
  for (const y of [0.8, 1.16, 1.52]) box(L - 1.9, 0.08, W + 0.05, -0.95, y, 0, trim);
  box(0.06, 0.62, W * 0.6, half + 0.03, 1.0, 0, trim);
  box(0.2, 0.26, W * 0.98, half + 0.06, 0.48, 0, trim);
  box(0.2, 0.26, W * 0.98, -half - 0.06, 0.5, 0, trim);
  for (const side of [1, -1]) {
    box(0.06, 0.18, 0.3, half + 0.04, 1.1, side * 0.9, head);
    box(0.06, 0.24, 0.2, -half - 0.03, 1.05, side * 0.95, red);
    // Warning lamps over the windscreen and at the back.
    box(0.08, 0.16, 0.2, hood - 0.3, 2.98, side * 0.55, amber);
    box(0.08, 0.16, 0.2, hood - 0.3, 2.98, side * 0.85, red);
    box(0.08, 0.16, 0.2, -half - 0.02, 2.75, side * 0.55, amber);
    box(0.08, 0.16, 0.2, -half - 0.02, 2.75, side * 0.85, red);
    box(0.08, 0.28, 0.12, hood + 0.25, 2.0, side * (W / 2 + 0.16), trim);
  }
  wheels([wb, wf], r, W);
  return W;
}

export async function buildRef(item: SceneItem, builders: RefBuilders): Promise<FigureHandle & { update?(t: number, dt: number): void }> {
  const kind = item.ref!;
  const materials: THREE.Material[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const g = new THREE.Group();
  const mat = (p: THREE.MeshStandardMaterialParameters) => { const m = new THREE.MeshStandardMaterial(p); materials.push(m); return m; };
  const add = (geo: THREE.BufferGeometry, m: THREE.Material | THREE.Material[]) => { geos.push(geo); const mesh = new THREE.Mesh(geo, m); mesh.castShadow = mesh.receiveShadow = true; g.add(mesh); return mesh; };
  if ((kind === "human" || kind === "trainer") && builders.trainer) {
    try {
      const t = await builders.trainer();
      const box = new THREE.Box3().setFromObject(t.object);
      const size = box.getSize(new THREE.Vector3());
      const s = item.h / Math.max(1e-6, size.y);
      t.object.scale.multiplyScalar(s);
      t.object.position.y -= box.min.y * s;
      t.object.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = m.receiveShadow = true; materials.push(...(Array.isArray(m.material) ? m.material : [m.material])); } });
      g.add(t.object);
      return { object: g, depth: size.z * s, lod: 1, materials, update: t.update, dispose: () => t.dispose() };
    } catch {
      // Fall through to the plain figure.
    }
  }
  if (kind === "human" || kind === "trainer") {
    // A plain mannequin, 1.71 m.
    const skin = mat({ color: "#d9b38c", roughness: 0.6 });
    const cloth = mat({ color: "#3d5a80", roughness: 0.8 });
    const dark = mat({ color: "#2b2d33", roughness: 0.8 });
    const H = item.h;
    const leg = new THREE.CapsuleGeometry(0.065 * H, 0.4 * H, 4, 10);
    add(leg.clone().translate(-0.055 * H, 0.27 * H, 0), dark);
    add(leg.translate(0.055 * H, 0.27 * H, 0), dark);
    add(new THREE.CapsuleGeometry(0.13 * H, 0.22 * H, 4, 12).translate(0, 0.66 * H, 0), cloth);
    const arm = new THREE.CapsuleGeometry(0.04 * H, 0.28 * H, 4, 8);
    add(arm.clone().translate(-0.17 * H, 0.63 * H, 0), cloth);
    add(arm.translate(0.17 * H, 0.63 * H, 0), cloth);
    add(new THREE.SphereGeometry(0.075 * H, 20, 16).translate(0, 0.9 * H, 0), skin);
  } else if (kind === "car" || kind === "bus") {
    const Wd = vehicle(kind, item.m, add, mat, materials);
    // Side-on to the camera, its length along the line (a figure's x runs across the screen), heading down the line towards the giants.
    g.rotation.y = Math.PI;
    const holder = new THREE.Group();
    holder.add(g);
    return { object: holder, depth: Wd, lod: 1, materials, dispose() { geos.forEach((x) => x.dispose()); materials.forEach((m) => m.dispose()); } };
  } else if (kind === "house") {
    // A two-storey house with a hipped slate roof (6.2 m to its ridge, as documented): rendered walls on a stone plinth,
    // framed windows with green shutters and sills, a front door under a little canopy, a chimney.
    const wall = mat({ color: "#efe4cf", roughness: 0.92 });
    const stoneM = mat({ color: "#cdbf9f", roughness: 0.9 });
    const roofM = mat({ color: "#5f6874", roughness: 0.7, metalness: 0.1 });
    const frame = mat({ color: "#f7f4ec", roughness: 0.6 });
    const win = mat({ color: "#24313d", roughness: 0.08, metalness: 0.5, envMapIntensity: 1.3 });
    const shutter = mat({ color: "#2f6a4b", roughness: 0.7 });
    const doorM = mat({ color: "#3a2a1e", roughness: 0.6 });
    const W = item.w, H = item.h, D = W * 0.7, wallH = H * 0.64, eave = 0.35;
    add(new THREE.BoxGeometry(W, wallH, D).translate(0, wallH / 2, 0), wall);
    add(new THREE.BoxGeometry(W + 0.12, 0.45, D + 0.12).translate(0, 0.225, 0), stoneM);
    add(new THREE.BoxGeometry(W + 0.1, 0.18, D + 0.1).translate(0, wallH * 0.5, 0), stoneM);
    // The hipped roof: four slopes from the eaves to a short ridge.
    {
      const hw = W / 2 + eave, hd = D / 2 + eave, ridge = Math.max(0.2, hw - hd);
      const p = [[-hw, wallH, hd], [hw, wallH, hd], [hw, wallH, -hd], [-hw, wallH, -hd], [-ridge, H, 0], [ridge, H, 0]];
      const tri = [0, 1, 5, 0, 5, 4, 2, 3, 4, 2, 4, 5, 1, 2, 5, 3, 0, 4];
      const pos = tri.flatMap((i) => p[i]);
      const roofGeo = new THREE.BufferGeometry();
      roofGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      roofGeo.computeVertexNormals();
      add(roofGeo, roofM);
      add(new THREE.BoxGeometry(W + eave * 2, 0.16, D + eave * 2).translate(0, wallH - 0.02, 0), frame);
      // The chimney stack, its top level with the ridge.
      add(new THREE.BoxGeometry(0.7, 1.6, 0.6).translate(W * 0.28, H - 0.8, -D * 0.12), stoneM);
    }
    const zf = D / 2;
    const windowAt = (x: number, y: number, w: number, h: number) => {
      add(new THREE.BoxGeometry(w + 0.16, h + 0.16, 0.06).translate(x, y, zf + 0.02), frame);
      add(new THREE.BoxGeometry(w, h, 0.06).translate(x, y, zf + 0.04), win);
      add(new THREE.BoxGeometry(w + 0.3, 0.08, 0.2).translate(x, y - h / 2 - 0.1, zf + 0.08), stoneM);
      for (const s of [-1, 1]) add(new THREE.BoxGeometry(w * 0.5, h + 0.06, 0.05).translate(x + s * (w * 0.75 + 0.1), y, zf + 0.04), shutter);
    };
    const ww = W * 0.13, wh = wallH * 0.24;
    for (const x of [-0.3, 0.3]) windowAt(x * W, wallH * 0.28, ww, wh);
    for (const x of [-0.3, 0, 0.3]) windowAt(x * W, wallH * 0.74, ww, wh);
    add(new THREE.BoxGeometry(W * 0.13 + 0.16, wallH * 0.42 + 0.08, 0.06).translate(0, 0.45 + wallH * 0.21, zf + 0.02), frame);
    add(new THREE.BoxGeometry(W * 0.13, wallH * 0.42, 0.08).translate(0, 0.45 + wallH * 0.21, zf + 0.04), doorM);
    add(new THREE.BoxGeometry(W * 0.22, 0.08, 0.7).translate(0, 0.45 + wallH * 0.44, zf + 0.35), roofM);
  } else if (kind === "building") {
    // A Lumiose apartment house, ten storeys of 3.1 m (the reference's documented height to the roof's ridge):
    // eight in cream stone (a rusticated ground floor, wrought-iron balconies on the second and fifth, a deep
    // cornice) and two in a slate mansard with dormers and a zinc top.
    const W = item.w, H = item.h, D = W * 0.8;
    const fh = H / 10, stoneH = fh * 8, bays = Math.max(3, Math.round(W / 3));
    const bayW = W / bays;
    const cv = document.createElement("canvas");
    cv.width = 512;
    cv.height = 1024;
    const c = cv.getContext("2d")!;
    const px = cv.width / W, py = cv.height / stoneH;
    c.fillStyle = "#eee2c6";
    c.fillRect(0, 0, cv.width, cv.height);
    // Stone courses, deeper on the ground floor.
    for (let y = 0; y < stoneH; y += 0.52) {
      const ground = y > stoneH - fh;
      c.fillStyle = ground ? "rgba(120,96,60,0.32)" : "rgba(140,118,80,0.14)";
      c.fillRect(0, cv.height - (y + 0.05) * py, cv.width, ground ? 3 : 1.5);
    }
    const win = (x: number, y: number, w: number, h: number, arch: boolean, lit: boolean) => {
      // Surround, glass (warm where a room is lit), frame and glazing bars.
      c.fillStyle = "#e3d3b0";
      c.fillRect(x - 6, y - 8, w + 12, h + 12);
      const gl = c.createLinearGradient(0, y, 0, y + h);
      gl.addColorStop(0, lit ? "#8a6d45" : "#3e4c5a");
      gl.addColorStop(1, lit ? "#4b3a26" : "#24303b");
      c.fillStyle = gl;
      c.beginPath();
      if (arch) { c.moveTo(x, y + h); c.lineTo(x, y + w / 2); c.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0); c.lineTo(x + w, y + h); }
      else c.rect(x, y, w, h);
      c.fill();
      c.strokeStyle = "#f6f1e6";
      c.lineWidth = 3;
      c.stroke();
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x + w / 2, y + (arch ? w / 2 : 0));
      c.lineTo(x + w / 2, y + h);
      for (let k = 1; k < 3; k++) { c.moveTo(x, y + (h * k) / 3); c.lineTo(x + w, y + (h * k) / 3); }
      c.stroke();
    };
    const rnd = (k: number) => { const v = Math.sin(k * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
    for (let f = 0; f < 8; f++) {
      const top = cv.height - (f + 1) * fh * py;
      for (let b = 0; b < bays; b++) {
        const x0 = b * bayW * px;
        if (f === 0) {
          // Arcades on the ground floor; the middle one is the entrance.
          win(x0 + bayW * px * 0.16, top + fh * py * 0.12, bayW * px * 0.68, fh * py * 0.82, true, b !== Math.floor(bays / 2));
        } else {
          const ww = bayW * px * 0.44, wh = fh * py * 0.66;
          win(x0 + (bayW * px - ww) / 2, top + fh * py * 0.2, ww, wh, false, rnd(f * 31 + b) < 0.18);
          // A carved lintel (a little pediment on the second floor).
          c.fillStyle = "#e6d6b4";
          if (f === 1) { c.beginPath(); c.moveTo(x0 + (bayW * px - ww) / 2 - 10, top + fh * py * 0.2 - 8); c.lineTo(x0 + bayW * px / 2, top + fh * py * 0.04); c.lineTo(x0 + (bayW * px + ww) / 2 + 10, top + fh * py * 0.2 - 8); c.fill(); }
          else c.fillRect(x0 + (bayW * px - ww) / 2 - 10, top + fh * py * 0.2 - 14, ww + 20, 7);
        }
      }
      // String course under each floor.
      c.fillStyle = "rgba(160,136,96,0.35)";
      c.fillRect(0, top + fh * py - 4, cv.width, 4);
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    const stone = mat({ map: t, roughness: 0.82, metalness: 0 });
    const plain = mat({ color: "#eadcbe", roughness: 0.85 });
    const slate = mat({ color: "#5d6673", roughness: 0.62, metalness: 0.12 });
    const zinc = mat({ color: "#a7b0ba", roughness: 0.45, metalness: 0.35 });
    const body = new THREE.BoxGeometry(W, stoneH, D);
    // Sides keep the bays' width (the box maps the whole picture onto every face).
    const uv = body.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < 8; i++) uv.setX(i, uv.getX(i) * (D / W));
    add(body.translate(0, stoneH / 2, 0), [stone, stone, plain, plain, stone, stone]);
    // Cornice, the course over the ground floor, and the balconies (a slab and a wrought-iron rail).
    add(new THREE.BoxGeometry(W + 1.2, 0.7, D + 1.2).translate(0, stoneH - 0.35, 0), plain);
    add(new THREE.BoxGeometry(W + 0.4, 0.35, D + 0.4).translate(0, fh, 0), plain);
    const rail = document.createElement("canvas");
    rail.width = 256;
    rail.height = 64;
    const rg = rail.getContext("2d")!;
    rg.strokeStyle = rg.fillStyle = "#151617";
    rg.fillRect(0, 0, 256, 6);
    rg.fillRect(0, 58, 256, 6);
    rg.lineWidth = 3;
    for (let x = 4; x < 256; x += 12) { rg.beginPath(); rg.moveTo(x, 5); rg.lineTo(x, 59); rg.stroke(); }
    for (let x = 10; x < 256; x += 24) { rg.beginPath(); rg.arc(x, 32, 7, 0, Math.PI * 2); rg.stroke(); }
    const railTex = new THREE.CanvasTexture(rail);
    railTex.colorSpace = THREE.SRGBColorSpace;
    railTex.wrapS = THREE.RepeatWrapping;
    railTex.repeat.set((W - 0.5) / 1.5, 1);
    const railM = mat({ map: railTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6 });
    for (const f of [2, 5]) {
      // Within the facade's width (the corners stay clean), the rail on the slab's edge.
      const y = f * fh;
      add(new THREE.BoxGeometry(W - 0.5, 0.18, 0.95).translate(0, y - 0.09, D / 2 + 0.47), plain);
      add(new THREE.PlaneGeometry(W - 0.5, 1.0).translate(0, y + 0.5, D / 2 + 0.92), railM);
    }
    // The mansard: a steep slate slope with a dormer per bay (the ninth storey), a shallow zinc slope over the tenth up to the ridge at H.
    const inset = 1.4, kneeY = stoneH + fh * 1.45;
    const roof = new THREE.BufferGeometry();
    const pos: number[] = [];
    const quad = (a: number[], b: number[], cc: number[], d: number[]) => pos.push(...a, ...b, ...cc, ...a, ...cc, ...d);
    const hw = W / 2, hd = D / 2;
    const lo = [[-hw, stoneH, hd], [hw, stoneH, hd], [hw, stoneH, -hd], [-hw, stoneH, -hd]];
    const mid = [[-hw + inset, kneeY, hd - inset], [hw - inset, kneeY, hd - inset], [hw - inset, kneeY, -hd + inset], [-hw + inset, kneeY, -hd + inset]];
    for (let k = 0; k < 4; k++) quad(lo[k], lo[(k + 1) % 4], mid[(k + 1) % 4], mid[k]);
    roof.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    roof.computeVertexNormals();
    add(roof, slate);
    const top = new THREE.BufferGeometry();
    const tp: number[] = [];
    const ridge = [[-hw + inset + (hd - inset), H, 0], [hw - inset - (hd - inset), H, 0]];
    const tq = (a: number[], b: number[], cc: number[], d: number[]) => tp.push(...a, ...b, ...cc, ...a, ...cc, ...d);
    tq(mid[0], mid[1], ridge[1], ridge[0]);
    tq(mid[2], mid[3], ridge[0], ridge[1]);
    tp.push(...mid[1], ...mid[2], ...ridge[1], ...mid[3], ...mid[0], ...ridge[0]);
    top.setAttribute("position", new THREE.Float32BufferAttribute(tp, 3));
    top.computeVertexNormals();
    add(top, zinc);
    // Dormers on the front and back slopes: a stone face with a window, a little pediment.
    const dormerFace = mat({ color: "#e9dcbf", roughness: 0.8 });
    const glass = mat({ color: "#2c3742", roughness: 0.12, metalness: 0.5 });
    for (const side of [1, -1]) {
      for (let b = 0; b < bays; b++) {
        const x = -hw + (b + 0.5) * bayW;
        const zf = side * (hd - 0.15);
        const dw = Math.min(1.5, bayW * 0.5), dh = fh * 0.95;
        add(new THREE.BoxGeometry(dw, dh, 1.1).translate(x, stoneH + 0.35 + dh / 2, zf - side * 0.45), dormerFace);
        add(new THREE.PlaneGeometry(dw * 0.62, dh * 0.7).rotateY(side > 0 ? 0 : Math.PI).translate(x, stoneH + 0.35 + dh * 0.47, zf + side * 0.11), glass);
        // Its little pitched roof: a triangular prism along the dormer, apex up.
        const pr = (dw + 0.25) / Math.sqrt(3);
        add(new THREE.CylinderGeometry(pr, pr, 1.25, 3).rotateX(-Math.PI / 2).scale(1, 0.55, 1).translate(x, stoneH + 0.35 + dh + pr * 0.27, zf - side * 0.45), slate);
      }
    }
    } else if (kind === "phone") {
    const body = mat({ color: "#2b2e33", roughness: 0.3, metalness: 0.8 });
    const screen = mat({ color: "#0b0d10", roughness: 0.05, metalness: 0.2, emissive: "#20324a", emissiveIntensity: 0.4 });
    add(new RoundedBoxGeometry(item.w, item.h, 0.0078, 2, 0.003).translate(0, item.h / 2, 0), body);
    add(new THREE.PlaneGeometry(item.w * 0.92, item.h * 0.95).translate(0, item.h / 2, 0.0041), screen);
    g.rotation.x = -0.12;
  }
  return { object: g, depth: item.w * 0.5, lod: 1, materials, dispose() { geos.forEach((x) => x.dispose()); materials.forEach((m) => { (m as THREE.MeshStandardMaterial).map?.dispose(); m.dispose(); }); } };
}

/** A soft round shadow texture for contact shadows under figures. */
export function contactShadowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  // A dark core where the feet meet the ground, fading softly outwards.
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(0,0,0,0.7)");
  grad.addColorStop(0.3, "rgba(0,0,0,0.45)");
  grad.addColorStop(0.62, "rgba(0,0,0,0.14)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
}
