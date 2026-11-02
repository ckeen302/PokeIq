import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { buildReliefMesh, type ReliefMap } from "@/lib/sizes/relief";
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
 * Figures are streamed: built when they come near the camera (a detailed
 * mesh near the focus, a flat cut-out far away), dropped when they leave.
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

export type Lod = 0 | 1 | 2; // 0 hero relief, 1 relief, 2 flat cut-out

export interface FigureHandle {
  object: THREE.Object3D;
  /** Front-to-back extent (m) after scaling, for the contact shadow. */
  depth: number;
  lod: Lod;
  materials: THREE.Material[];
  dispose(): void;
}

export interface FigureProvider {
  /** Whether this provider has a figure for the item. */
  has(item: SceneItem): boolean;
  load(item: SceneItem, lod: Lod, signal: AbortSignal): Promise<FigureHandle>;
}

export interface FigureUrls {
  /** The HOME render at a size (px). */
  art(id: number, size: 128 | 256 | 512): string;
  /** The baked relief map. */
  relief(id: number): string;
}

const SEGMENTS: Record<Lod, number> = { 0: 120, 1: 72, 2: 0 };

async function fetchBitmap(url: string, signal: AbortSignal): Promise<ImageBitmap> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const blob = await res.blob();
  return createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

function bitmapPixels(bmp: ImageBitmap): ReliefMap {
  const cv = document.createElement("canvas");
  cv.width = bmp.width;
  cv.height = bmp.height;
  const g = cv.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  const img = g.getImageData(0, 0, bmp.width, bmp.height);
  return { w: bmp.width, h: bmp.height, data: img.data, channels: 4 };
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
  constructor(private urls: FigureUrls, private opts: { anisotropy: number; sharpen: number; texSize: 256 | 512 }) {}
  has(item: SceneItem) { return item.art > 0; }
  async load(item: SceneItem, lod: Lod, signal: AbortSignal): Promise<FigureHandle> {
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
    const [artBmp, reliefBmp] = await Promise.all([fetchBitmap(this.urls.art(item.art, this.opts.texSize), signal), fetchBitmap(this.urls.relief(item.art), signal)]);
    const map = bitmapPixels(reliefBmp);
    reliefBmp.close();
    // UVs address the full render; the texture may be a smaller copy of it (same framing).
    const mesh = buildReliefMesh(map, { x: bx, y: by, w: bw, h: bh, size }, SEGMENTS[lod]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(mesh.position, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(mesh.normal, 3));
    // Bitmaps upload with flipY off, so v runs down the image: undo the mesh's WebGL flip.
    const uv = new Float32Array(mesh.uv.length);
    for (let i = 0; i < uv.length; i += 2) { uv[i] = mesh.uv[i]; uv[i + 1] = 1 - mesh.uv[i + 1]; }
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(mesh.index, 1));
    geo.computeBoundingSphere();
    const tex = textureFrom(artBmp, this.opts.anisotropy);
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, alphaToCoverage: true, roughness: 0.62, metalness: 0, envMapIntensity: 0.8 });
    figureLook(mat, artBmp.width, this.opts.sharpen);
    const obj = new THREE.Mesh(geo, mat);
    obj.castShadow = true;
    obj.receiveShadow = true;
    obj.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.5 });
    const s = item.h / mesh.height;
    obj.scale.setScalar(s);
    return {
      object: obj,
      depth: (mesh.zMax - mesh.zMin) * s,
      lod,
      materials: [mat],
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

export async function buildRef(item: SceneItem, builders: RefBuilders): Promise<FigureHandle & { update?(t: number, dt: number): void }> {
  const kind = item.ref!;
  const materials: THREE.Material[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const g = new THREE.Group();
  const mat = (p: THREE.MeshStandardMaterialParameters) => { const m = new THREE.MeshStandardMaterial(p); materials.push(m); return m; };
  const add = (geo: THREE.BufferGeometry, m: THREE.Material) => { geos.push(geo); const mesh = new THREE.Mesh(geo, m); mesh.castShadow = mesh.receiveShadow = true; g.add(mesh); return mesh; };
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
    const L = item.m, Hh = kind === "car" ? 1.435 : 3.25;
    const paint = new THREE.MeshPhysicalMaterial({ color: kind === "car" ? "#c62828" : "#f2b705", roughness: 0.3, metalness: 0.45, clearcoat: 0.9 });
    materials.push(paint);
    const glass = mat({ color: "#1a2129", roughness: 0.08, metalness: 0.6 });
    const tyre = mat({ color: "#151515", roughness: 0.9 });
    const Wd = kind === "car" ? 1.78 : 2.55;
    if (kind === "car") {
      add(new RoundedBoxGeometry(L, Hh * 0.52, Wd, 3, 0.2).translate(0, Hh * 0.45, 0), paint);
      add(new RoundedBoxGeometry(L * 0.55, Hh * 0.4, Wd * 0.88, 3, 0.16).translate(-L * 0.05, Hh * 0.82, 0), glass);
    } else {
      add(new RoundedBoxGeometry(L, Hh * 0.82, Wd, 3, 0.3).translate(0, Hh * 0.5, 0), paint);
      add(new RoundedBoxGeometry(L * 0.94, Hh * 0.28, Wd * 1.02, 2, 0.1).translate(0, Hh * 0.68, 0), glass);
    }
    const wr = kind === "car" ? 0.33 : 0.52;
    for (const [x, z] of [[0.32, 0.45], [0.32, -0.45], [-0.32, 0.45], [-0.32, -0.45]]) {
      add(new THREE.CylinderGeometry(wr, wr, 0.25, 16).rotateX(Math.PI / 2).translate(x * L, wr, z * Wd * 1.0), tyre);
    }
    g.rotation.y = Math.PI / 2; // side-on to the camera
    const holder = new THREE.Group();
    holder.add(g);
    return { object: holder, depth: Wd, lod: 1, materials, dispose() { geos.forEach((x) => x.dispose()); materials.forEach((m) => m.dispose()); } };
  } else if (kind === "house") {
    const wall = mat({ color: "#e8dcc6", roughness: 0.9 });
    const roofM = mat({ color: "#8c3b2b", roughness: 0.8 });
    const win = mat({ color: "#2d3a46", roughness: 0.1, metalness: 0.5 });
    const W = item.w, H = item.h, wallH = H * 0.66;
    add(new THREE.BoxGeometry(W, wallH, W * 0.7).translate(0, wallH / 2, 0), wall);
    const roofGeo = new THREE.CylinderGeometry(0.01, (W * 0.75) / Math.SQRT2 * 1.1, H - wallH, 4, 1);
    roofGeo.rotateY(Math.PI / 4);
    roofGeo.scale(1, 1, 0.7);
    add(roofGeo.translate(0, wallH + (H - wallH) / 2, 0), roofM);
    for (const [x, y] of [[-0.25, 0.3], [0.25, 0.3], [-0.25, 0.72], [0.25, 0.72]]) add(new THREE.BoxGeometry(W * 0.16, wallH * 0.2, 0.05).translate(x * W, y * wallH, W * 0.35 + 0.01), win);
  } else if (kind === "building") {
    const W = item.w, H = item.h;
    const cv = document.createElement("canvas");
    cv.width = 64; cv.height = 128;
    const c = cv.getContext("2d")!;
    c.fillStyle = "#cfd4da"; c.fillRect(0, 0, 64, 128);
    for (let f = 0; f < 10; f++) for (let k = 0; k < 4; k++) { c.fillStyle = "#33414f"; c.fillRect(4 + k * 15, 4 + f * 12.6, 11, 8); }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    const m = mat({ map: t, roughness: 0.6, metalness: 0.2 });
    add(new THREE.BoxGeometry(W, H, W * 0.8).translate(0, H / 2, 0), m);
  } else if (kind === "phone") {
    const body = mat({ color: "#2b2e33", roughness: 0.3, metalness: 0.8 });
    const screen = mat({ color: "#0b0d10", roughness: 0.05, metalness: 0.2, emissive: "#20324a", emissiveIntensity: 0.4 });
    add(new RoundedBoxGeometry(item.w, item.h, 0.0078, 2, 0.003).translate(0, item.h / 2, 0), body);
    add(new THREE.PlaneGeometry(item.w * 0.92, item.h * 0.95).translate(0, item.h / 2, 0.0041), screen);
    g.rotation.x = -0.12;
  }
  return { object: g, depth: item.w * 0.5, lod: 1, materials, dispose() { geos.forEach((x) => x.dispose()); materials.forEach((m) => m.dispose()); } };
}

/** A soft round shadow texture for contact shadows under figures. */
export function contactShadowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(0,0,0,0.62)");
  grad.addColorStop(0.45, "rgba(0,0,0,0.32)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
}
