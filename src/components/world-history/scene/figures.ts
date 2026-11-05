import * as THREE from "three";
import { buildReliefMesh, type ReliefMap } from "@/lib/sizes/relief";
import { artUrl, figureAsset } from "@/lib/world-history/assets";
import type { ReliefJob, ReliefResult } from "./relief-worker";
import { samplePoints } from "./points";

/**
 * The legendaries as solid 3D figures, built exactly the way /pokedex/sizes
 * builds its figures: the Pokémon HOME render on a relief mesh from a baked
 * depth map (buildReliefMesh). Each figure gets its own material with a few
 * film effects on top of standard lighting: a rim light, a glow, a
 * dissolve that forms the figure out of light (or burns it away), a
 * silhouette (the Paradox shadows) and stone (the Loyal Three's statues).
 * These are always the 3D figure itself: no flat stand-ins.
 */

export interface FigureUniforms {
  uRimColor: { value: THREE.Color };
  uRim: { value: number };
  uGlowColor: { value: THREE.Color };
  uGlow: { value: number };
  /** 1 solid … 0 gone (a noise edge in between glows in uEdgeColor). */
  uDissolve: { value: number };
  uEdgeColor: { value: THREE.Color };
  /** 0 normal … 1 a dark silhouette. */
  uShadow: { value: number };
  /** 0 normal … 1 grey stone. */
  uStone: { value: number };
  uTime: { value: number };
}

export interface Figure {
  art: number;
  /** Scaled and placed by the chapter (the mesh inside stands on y = 0, centred, facing +z). */
  group: THREE.Group;
  mesh: THREE.Mesh;
  u: FigureUniforms;
  /** The figure's height in its own units, and width; depth (front to back). */
  height: number;
  width: number;
  depth: number;
  /** Points on its front surface (local units), for particles that form or leave it. */
  points: Float32Array;
  /** Sets the world height (scales the group). */
  setHeight(h: number): void;
  dispose(): void;
}

export interface FigureFactory {
  load(art: number, signal: AbortSignal): Promise<Figure>;
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
      for (const done of jobs.values()) done(null);
      jobs.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

/** A decoded image: an ImageBitmap where the browser can make one as asked, else an <img>. */
interface Pic {
  src: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
  close(): void;
}

async function decode(blob: Blob): Promise<Pic> {
  if (typeof createImageBitmap === "function") {
    // Unconverted, unpremultiplied first; some browsers refuse the options, so then without.
    for (const opts of [{ colorSpaceConversion: "none", premultiplyAlpha: "none" } as ImageBitmapOptions, undefined]) {
      try {
        const b = await (opts ? createImageBitmap(blob, opts) : createImageBitmap(blob));
        return { src: b, width: b.width, height: b.height, close: () => b.close() };
      } catch {
        /* the next way */
      }
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { src: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Fetches and decodes an image, trying again after a short wait (a dropped request shouldn't cost a chapter its figure). */
async function fetchPic(url: string, signal: AbortSignal): Promise<Pic> {
  let err: unknown = null;
  for (let i = 0; i < 3; i++) {
    if (i) await new Promise((r) => setTimeout(r, 400 * 3 ** (i - 1)));
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await decode(await res.blob());
    } catch (e) {
      if (signal.aborted) throw e;
      err = e;
    }
  }
  throw err;
}

let pixelCanvas: CanvasRenderingContext2D | null = null;
function bitmapPixels(bmp: Pic): ReliefMap & { data: Uint8ClampedArray } {
  if (!pixelCanvas) pixelCanvas = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  const cv = pixelCanvas.canvas;
  if (cv.width < bmp.width || cv.height < bmp.height) {
    cv.width = Math.max(cv.width, bmp.width);
    cv.height = Math.max(cv.height, bmp.height);
  }
  pixelCanvas.clearRect(0, 0, bmp.width, bmp.height);
  pixelCanvas.drawImage(bmp.src, 0, 0);
  const img = pixelCanvas.getImageData(0, 0, bmp.width, bmp.height);
  return { w: bmp.width, h: bmp.height, data: img.data, channels: 4 };
}

interface Arrays {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  index: Uint32Array | Uint16Array;
  width: number;
  height: number;
  zMin: number;
  zMax: number;
  points: Float32Array;
}

function buildArrays(map: ReliefMap & { data: Uint8ClampedArray }, box: ReliefJob["box"], segments: number, samples: number): Promise<Arrays> {
  const w = reliefWorker();
  const here = (): Arrays => {
    const m = buildReliefMesh(map, box, segments);
    const uv = new Float32Array(m.uv.length);
    for (let i = 0; i < uv.length; i += 2) { uv[i] = m.uv[i]; uv[i + 1] = 1 - m.uv[i + 1]; }
    return { position: m.position, normal: m.normal, uv, index: m.index, width: m.width, height: m.height, zMin: m.zMin, zMax: m.zMax, points: samplePoints(m.position, samples) };
  };
  if (!w) return Promise.resolve(here());
  const copy = new Uint8ClampedArray(map.data);
  return new Promise((resolve) => {
    const id = nextJob++;
    jobs.set(id, (r) => {
      if (r?.position && r.normal && r.uv && r.index && r.points) resolve({ position: r.position, normal: r.normal, uv: r.uv, index: r.index, width: r.width ?? 1, height: r.height ?? 1, zMin: r.zMin ?? 0, zMax: r.zMax ?? 0, points: r.points });
      else resolve(here());
    });
    const job: ReliefJob = { id, w: map.w, h: map.h, data: copy, box, segments, samples };
    w.postMessage(job, [copy.buffer]);
  });
}

const FIGURE_VERT = /* glsl */ `varying vec3 vFigLocal;`;
const FIGURE_FRAG = /* glsl */ `
varying vec3 vFigLocal;
uniform vec3 uRimColor; uniform float uRim;
uniform vec3 uGlowColor; uniform float uGlow;
uniform float uDissolve; uniform vec3 uEdgeColor;
uniform float uShadow; uniform float uStone; uniform float uTime;
float figHash(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float figNoise(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(figHash(i), figHash(i + vec3(1,0,0)), f.x), mix(figHash(i + vec3(0,1,0)), figHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(figHash(i + vec3(0,0,1)), figHash(i + vec3(1,0,1)), f.x), mix(figHash(i + vec3(0,1,1)), figHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float figDissolveNoise(){ return 0.62 * figNoise(vFigLocal * 9.0) + 0.38 * figNoise(vFigLocal * 23.0 + 7.1); }
`;

/** Patches a figure's standard material with the film effects. */
function figureLook(mat: THREE.MeshStandardMaterial, u: FigureUniforms) {
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace("#include <common>", `#include <common>\n${FIGURE_VERT}`)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFigLocal = position;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>\n${FIGURE_FRAG}`)
      .replace(
        "#include <alphatest_fragment>",
        `#include <alphatest_fragment>
        float figN = figDissolveNoise();
        if (uDissolve < 0.999 && figN > uDissolve) discard;`
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        {
          float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          vec3 stone = vec3(0.42, 0.41, 0.39) * (0.55 + 0.9 * l) * (0.85 + 0.3 * figNoise(vFigLocal * 40.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, stone, uStone);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.03, uShadow);
        }`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          vec3 fv = normalize(vViewPosition);
          float fres = pow(1.0 - clamp(abs(dot(normalize(normal), -fv)), 0.0, 1.0), 2.6);
          totalEmissiveRadiance += uRimColor * fres * uRim;
          totalEmissiveRadiance += uGlowColor * uGlow * (0.35 + 0.65 * dot(diffuseColor.rgb, vec3(0.333)));
          float figE = figDissolveNoise();
          if (uDissolve < 0.999) totalEmissiveRadiance += uEdgeColor * smoothstep(uDissolve - 0.09, uDissolve, figE) * 6.0;
        }`
      );
  };
  mat.customProgramCacheKey = () => "wh-figure";
}

export function figureUniforms(): FigureUniforms {
  return {
    uRimColor: { value: new THREE.Color(1, 1, 1) },
    uRim: { value: 0.6 },
    uGlowColor: { value: new THREE.Color(1, 1, 1) },
    uGlow: { value: 0 },
    uDissolve: { value: 1 },
    uEdgeColor: { value: new THREE.Color(1.0, 0.85, 0.5) },
    uShadow: { value: 0 },
    uStone: { value: 0 },
    uTime: { value: 0 },
  };
}

export function createFigureFactory(renderer: THREE.WebGLRenderer, opts: { segments: number; texSize: 256 | 512; anisotropy: number }): FigureFactory {
  return {
    async load(art, signal) {
      const asset = figureAsset(art);
      if (!asset) throw new Error(`world-history: no relief for ${art}`);
      const [bx, by, bw, bh, size] = asset.box;
      const got = await Promise.allSettled([fetchPic(artUrl(art, opts.texSize), signal), fetchPic(asset.relief, signal)]);
      if (got[0].status === "rejected" || got[1].status === "rejected") {
        for (const g of got) if (g.status === "fulfilled") g.value.close();
        throw got[0].status === "rejected" ? got[0].reason : (got[1] as PromiseRejectedResult).reason;
      }
      const [artBmp, reliefBmp] = [got[0].value, got[1].value];
      let arrays: Arrays;
      try {
        arrays = await buildArrays(bitmapPixels(reliefBmp), { x: bx, y: by, w: bw, h: bh, size }, opts.segments, 2400);
      } finally {
        reliefBmp.close();
      }
      if (signal.aborted) {
        artBmp.close();
        throw new DOMException("aborted", "AbortError");
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(arrays.position, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(arrays.normal, 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(arrays.uv, 2));
      geo.setIndex(new THREE.BufferAttribute(arrays.index, 1));
      geo.computeBoundingSphere();
      const tex = new THREE.Texture(artBmp.src as unknown as HTMLImageElement);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = opts.anisotropy;
      tex.flipY = false;
      tex.needsUpdate = true;
      renderer.initTexture(tex);
      const u = figureUniforms();
      const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.55, metalness: 0, envMapIntensity: 0.6 });
      figureLook(mat, u);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = true;
      const group = new THREE.Group();
      group.add(mesh);
      const fig: Figure = {
        art,
        group,
        mesh,
        u,
        height: arrays.height,
        width: arrays.width,
        depth: arrays.zMax - arrays.zMin,
        points: arrays.points,
        setHeight(h) {
          group.scale.setScalar(h / Math.max(1e-3, arrays.height));
        },
        dispose() {
          geo.dispose();
          mat.dispose();
          tex.dispose();
          artBmp.close();
        },
      };
      return fig;
    },
  };
}
