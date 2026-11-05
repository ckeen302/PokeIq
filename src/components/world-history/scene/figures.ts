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
 *
 * Opt-in (all 0 by default, so a figure looks exactly as before until a
 * chapter asks): life (breathing, a slow weight shift, and secondary motion
 * in the thin outer parts: ears, tails, wings, fins, lagging behind the
 * body), an action curve (anticipation squash, follow-through stretch), a
 * hit reaction (recoil and a shudder), extra depth (thicker figures that
 * read as solid from the side), a darker back, and a soft contact shadow
 * on the ground. The motion runs on FIGURE_CLOCK (the film's free-running
 * clock, set by the scene before each draw), and the shadow pass deforms
 * the same way, so cast shadows breathe with their figure.
 */

/** The free-running clock every figure's idle motion follows (set by the scene each frame). */
export const FIGURE_CLOCK = { value: 0 };

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
  /** Idle life: breathing, weight shift and secondary motion (0 still … 1 alive; more exaggerates). */
  uAlive: { value: number };
  /** Extra secondary motion in the thin outer parts (0 … 1, on top of uAlive's). */
  uFlex: { value: number };
  /** An action: −1 crouched in anticipation … 0 rest … +1 stretched in follow-through (see actionCurve). */
  uAct: { value: number };
  /** A hit reaction (0 … 1, see hitCurve): recoil away from the lens and a shudder. */
  uHit: { value: number };
  /** Lean (radians, + to the figure's right): a weight shift or a turn into a move. */
  uLean: { value: number };
  /** Depth scale (1 as baked; 1.3–1.5 reads more solid from the side). */
  uDepthK: { value: number };
  /** Back side: 0 as the front … 1 darker and less saturated, as a body's far side. */
  uBack: { value: number };
  /** A per-figure phase, so a crowd doesn't breathe in step. */
  uPhase: { value: number };
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
  /** A soft contact shadow on the ground at world height `groundY` (default: where the figure stands now); k 0 removes it. It fades as the figure rises. */
  setContact(k: number, groundY?: number): void;
  /** Casts a shadow from a chapter's shadow light (see light.ts). */
  castShadow(on: boolean): void;
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

const FIGURE_VERT = /* glsl */ `
varying vec3 vFigLocal; varying float vFigBack;
attribute vec2 aFig;
uniform float uClock, uAlive, uFlex, uAct, uHit, uLean, uDepthK, uPhase;
uniform vec3 uFigBox;
vec3 figAnimate(vec3 p){
  float H = uFigBox.x, Wd = uFigBox.y, zMid = uFigBox.z;
  float hn = clamp(p.y / max(H, 1e-4), 0.0, 1.0);
  p.z = zMid + (p.z - zMid) * uDepthK;
  if (uAlive + uFlex + abs(uAct) + uHit + abs(uLean) > 0.0) {
    float t = uClock + uPhase;
    // Breathing: the chest swells, the top rises a little.
    float br = sin(t * 1.9) * 0.5 + 0.5;
    float chestD = (hn - 0.55) / 0.25;
    float chest = exp(-chestD * chestD);
    p.x *= 1.0 + uAlive * 0.022 * br * chest;
    p.z = zMid + (p.z - zMid) * (1.0 + uAlive * 0.05 * br * chest);
    p.y += uAlive * 0.009 * H * br * hn;
    // Weight shift: a slow sway about the feet, and any lean the chapter asks for.
    float sway = uAlive * 0.014 * sin(t * 0.55) + uLean;
    p.x += sway * p.y;
    // Secondary motion: thin parts far from the body's core trail behind it.
    vec2 rel = vec2(p.x / max(Wd * 0.5, 1e-4), (p.y - H * 0.5) / max(H * 0.5, 1e-4));
    float far = length(rel);
    float thin = aFig.x;
    float flexW = smoothstep(0.35, 1.0, far) * (0.35 + 0.65 * thin);
    float lag = far * 1.6;
    float amp = (uAlive * 0.5 + uFlex) * flexW * H;
    p.z += amp * 0.05 * sin(t * 2.6 - lag);
    p.x += amp * 0.02 * sin(t * 2.1 - lag + 1.3) * sign(p.x);
    p.y += amp * 0.015 * sin(t * 2.6 - lag + 0.7);
    // Action: squash down into the anticipation, stretch up into the follow-through (volume kept).
    float a = clamp(uAct, -1.0, 1.0);
    p.y *= 1.0 + a * 0.07;
    p.x *= 1.0 - a * 0.035;
    p.z = zMid + (p.z - zMid) * (1.0 - a * 0.035);
    // A hit: the top snaps back away from the lens, with a shudder.
    p.z -= uHit * 0.08 * H * hn;
    p.x += uHit * 0.025 * H * sin(uClock * 57.0) * hn;
  }
  return p;
}
`;
const FIGURE_FRAG = /* glsl */ `
varying vec3 vFigLocal;
uniform vec3 uRimColor; uniform float uRim;
uniform vec3 uGlowColor; uniform float uGlow;
uniform float uDissolve; uniform vec3 uEdgeColor;
uniform float uShadow; uniform float uStone; uniform float uTime; uniform float uBack;
varying float vFigBack;
float figHash(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float figNoise(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(figHash(i), figHash(i + vec3(1,0,0)), f.x), mix(figHash(i + vec3(0,1,0)), figHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(figHash(i + vec3(0,0,1)), figHash(i + vec3(1,0,1)), f.x), mix(figHash(i + vec3(0,1,1)), figHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float figDissolveNoise(){ return 0.62 * figNoise(vFigLocal * 9.0) + 0.38 * figNoise(vFigLocal * 23.0 + 7.1); }
`;

/** Patches a figure's standard material with the film effects. */
function figureLook(mat: THREE.MeshStandardMaterial, u: FigureUniforms, box: Record<string, { value: unknown }>) {
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u, box);
    s.vertexShader = s.vertexShader
      .replace("#include <common>", `#include <common>\n${FIGURE_VERT}`)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFigLocal = position; vFigBack = aFig.y; transformed = figAnimate(transformed);");
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
          if (uBack > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(l) * 0.55, uBack * vFigBack * 0.7);
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
    uAlive: { value: 0 },
    uFlex: { value: 0 },
    uAct: { value: 0 },
    uHit: { value: 0 },
    uLean: { value: 0 },
    uDepthK: { value: 1 },
    uBack: { value: 0 },
    uPhase: { value: 0 },
  };
}

/**
 * An action over time: anticipation before `at` (a crouch, −1 at its
 * deepest just before), the release, a follow-through stretch after (+1)
 * that overshoots and settles. Pure in t, for scrubbing.
 */
export function actionCurve(t: number, at: number, o: { pre?: number; post?: number } = {}): number {
  const pre = o.pre ?? 0.45, post = o.post ?? 0.9;
  if (t < at - pre || t > at + post * 2.2) return 0;
  if (t < at) {
    const k = (t - (at - pre)) / pre;
    return -(Math.sin(k * Math.PI * 0.5) ** 2);
  }
  const d = (t - at) / post;
  return Math.exp(-d * 2.2) * Math.sin(Math.min(d * 2.6, Math.PI * 3)) * 1.15 - Math.exp(-d * 30) * (1 - Math.min(1, d * 6));
}

/** A hit at `at`: a fast snap to 1, then a damped settle (with a small rebound). */
export function hitCurve(t: number, at: number, dur = 0.9): number {
  if (t < at || t > at + dur * 2) return 0;
  const d = (t - at) / dur;
  return d < 0.06 ? d / 0.06 : Math.exp(-(d - 0.06) * 4.5) * Math.cos((d - 0.06) * 9);
}

const CONTACT_VERT = /* glsl */ `
uniform float uGround, uLift;
varying vec2 vC; varying float vFade;
void main(){
  vC = position.xz;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float above = modelMatrix[3].y - uGround;
  wp.y = uGround + 0.02;
  vFade = clamp(1.0 - above / max(uLift, 1e-3), 0.0, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const CONTACT_FRAG = /* glsl */ `
uniform float uK; varying vec2 vC; varying float vFade;
void main(){
  float r = length(vC);
  float a = smoothstep(1.0, 0.0, r);
  a *= a * (0.55 + 0.45 * smoothstep(0.55, 0.0, r));
  gl_FragColor = vec4(0.0, 0.0, 0.0, a * uK * vFade);
}`;

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
      // Per vertex: how thin the figure is there (0 thickest … 1 a sheet: ears, tails, wings), and which side (0 front, 1 back).
      {
        const pos = arrays.position, nv = pos.length / 6;
        const fig = new Float32Array(nv * 4);
        let maxT = 1e-6;
        for (let i = 0; i < nv; i++) maxT = Math.max(maxT, pos[i * 3 + 2] - pos[(i + nv) * 3 + 2]);
        for (let i = 0; i < nv; i++) {
          const thin = 1 - Math.min(1, Math.max(0, (pos[i * 3 + 2] - pos[(i + nv) * 3 + 2]) / maxT));
          fig[i * 2] = thin; fig[i * 2 + 1] = 0;
          fig[(i + nv) * 2] = thin; fig[(i + nv) * 2 + 1] = 1;
        }
        geo.setAttribute("aFig", new THREE.BufferAttribute(fig, 2));
      }
      geo.computeBoundingSphere();
      // Room for the motion and the extra depth.
      if (geo.boundingSphere) geo.boundingSphere.radius *= 1.15;
      const tex = new THREE.Texture(artBmp.src as unknown as HTMLImageElement);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = opts.anisotropy;
      tex.flipY = false;
      tex.needsUpdate = true;
      renderer.initTexture(tex);
      const u = figureUniforms();
      const box = { uFigBox: { value: new THREE.Vector3(arrays.height, arrays.width, (arrays.zMin + arrays.zMax) / 2) }, uClock: FIGURE_CLOCK };
      u.uPhase.value = (art * 0.618) % 1 * 6.283;
      const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.55, metalness: 0, envMapIntensity: 0.6 });
      figureLook(mat, u, box);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = true;
      // The shadow pass: the same cut-out, dissolve and motion.
      const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.5 });
      depthMat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, u, box);
        sh.vertexShader = sh.vertexShader
          .replace("#include <common>", `#include <common>\n${FIGURE_VERT}`)
          .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFigLocal = position; vFigBack = aFig.y; transformed = figAnimate(transformed);");
        sh.fragmentShader = sh.fragmentShader
          .replace("#include <common>", `#include <common>\n${FIGURE_FRAG}`)
          .replace("#include <alphatest_fragment>", "#include <alphatest_fragment>\nif (uDissolve < 0.999 && figDissolveNoise() > uDissolve) discard;\nif (uShadow > 0.98) discard;");
      };
      depthMat.customProgramCacheKey = () => "wh-figure-depth";
      mesh.customDepthMaterial = depthMat;
      const group = new THREE.Group();
      group.add(mesh);
      let contact: THREE.Mesh | null = null;
      const contactU = { uGround: { value: 0 }, uLift: { value: arrays.height }, uK: { value: 0 } };
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
        setContact(k, groundY) {
          if (!contact) {
            if (k <= 0) return;
            const w = arrays.width * 0.62, d = Math.max(arrays.zMax - arrays.zMin, arrays.width * 0.3) * 1.4;
            const cg = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2).scale(w, 1, d);
            // Unit radius in the shader: positions are scaled back into it via vC / extent.
            const pa = cg.getAttribute("position");
            for (let i = 0; i < pa.count; i++) pa.setXYZ(i, pa.getX(i), 0, pa.getZ(i));
            const cm = new THREE.ShaderMaterial({
              uniforms: contactU,
              vertexShader: CONTACT_VERT.replace("vC = position.xz;", `vC = position.xz / vec2(${w.toFixed(4)}, ${d.toFixed(4)});`),
              fragmentShader: CONTACT_FRAG,
              transparent: true,
              depthWrite: false,
            });
            contact = new THREE.Mesh(cg, cm);
            contact.renderOrder = -1;
            contact.frustumCulled = false;
            group.add(contact);
          }
          contactU.uK.value = k;
          contactU.uGround.value = groundY ?? group.position.y;
          contactU.uLift.value = Math.max(0.5, arrays.height * group.scale.y * 1.2);
          contact.visible = k > 0;
        },
        castShadow(on) {
          mesh.castShadow = on;
        },
        dispose() {
          geo.dispose();
          mat.dispose();
          depthMat.dispose();
          if (contact) { contact.geometry.dispose(); (contact.material as THREE.Material).dispose(); }
          tex.dispose();
          artBmp.close();
        },
      };
      return fig;
    },
  };
}
