import * as THREE from "three";
import { FAR, type FarManifest } from "@/lib/sizes/far";
import { DITHER_GLSL, figureLook } from "./shaders";

/**
 * The far figures, as one crowd of low-detail 3D reliefs. Every Pokémon too
 * small on screen for its own relief mesh is still a solid figure: a grid
 * shared by all of them is shaped on the GPU from the far atlas (each
 * figure's relief map, front and back, on one small sheet; its HOME render
 * on another), lit like the near figures, casting real shadows, all in one
 * instanced draw. Both sheets arrive with the page (two downloads for every
 * figure there is), so nothing ever stands in flat: a figure is 3D from the
 * first frame it is seen, and grows into its detailed relief (a quick
 * dissolve, see DITHER_GLSL) when it comes close.
 */

export interface CrowdInstance {
  x: number;
  z: number;
  /** World yaw of the figure (it faces the camera's side of the line). */
  yaw: number;
  w: number;
  h: number;
  art: number;
  /** The render's visible box [x, y, w, h, image size]. */
  box: [number, number, number, number, number];
  /** Dissolve: 1 drawn, 0 < f < 1 fading in, -1 - f fading out (see DITHER_GLSL). */
  fade: number;
  /** Its height on screen (px), for choosing which to draw when there are too many. */
  sh?: number;
}

/** Grid cells across a far figure (front and back). */
const SEG = FAR.segments;

function gridGeometry(): THREE.BufferGeometry {
  const n = SEG + 1;
  const pos = new Float32Array(n * n * 2 * 3);
  const idx: number[] = [];
  for (let side = 0; side < 2; side++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const o = (side * n * n + j * n + i) * 3;
        pos[o] = i / SEG;
        pos[o + 1] = j / SEG;
        pos[o + 2] = side ? -1 : 1;
      }
    }
  }
  for (let side = 0; side < 2; side++) {
    const b = side * n * n;
    for (let j = 0; j < SEG; j++) {
      for (let i = 0; i < SEG; i++) {
        const a = b + j * n + i, c = a + 1, d = a + n, e = a + n + 1;
        // Front faces +z (counter-clockwise seen from the front), the back the other way.
        if (side === 0) idx.push(a, c, e, a, e, d);
        else idx.push(a, e, c, a, d, e);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(pos.length), 3));
  g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  return g;
}

const VERTEX_PARS = /* glsl */ `
  attribute vec4 aArt;
  attribute vec4 aDep;
  attribute vec2 aWH;
  attribute float aFade;
  uniform sampler2D uDepthSheet;
  varying float vFade;
  float farZ(vec2 g, float side) {
    vec3 d = texture2D(uDepthSheet, aDep.xy + vec2(clamp(g.x, 0.0, 1.0), 1.0 - clamp(g.y, 0.0, 1.0)) * aDep.zw).rgb;
    return (side > 0.0 ? d.r : d.g) - 0.5;
  }
  void farRelief(out vec3 p, out vec3 n, out vec2 uvOut) {
    vec2 g = position.xy;
    float side = position.z;
    float z = farZ(g, side);
    float st = 1.0 / ${SEG.toFixed(1)};
    float dzdx = (farZ(g + vec2(st, 0.0), side) - farZ(g - vec2(st, 0.0), side)) / (2.0 * st * aWH.x);
    float dzdy = (farZ(g + vec2(0.0, st), side) - farZ(g - vec2(0.0, st), side)) / (2.0 * st * aWH.y);
    p = vec3((g.x - 0.5) * aWH.x, g.y * aWH.y, z);
    n = normalize(vec3(-dzdx * side, -dzdy * side, side));
    uvOut = aArt.xy + vec2(g.x, 1.0 - g.y) * aArt.zw;
    vFade = aFade;
  }
`;

/** Shapes a material's vertices into far reliefs (the colour material and the shadow's depth material alike). */
function farPatch(m: THREE.Material, depthSheet: { value: THREE.Texture | null }, colour: boolean) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (s, r) => {
    prev?.call(m, s, r);
    s.uniforms.uDepthSheet = depthSheet;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_PARS}`)
      .replace("#include <uv_vertex>", "#include <uv_vertex>\n  vec3 frPos; vec3 frNrm; vec2 frUv;\n  farRelief(frPos, frNrm, frUv);\n#ifdef USE_MAP\n  vMapUv = frUv;\n#endif")
      .replace("#include <begin_vertex>", "vec3 transformed = frPos;");
    if (colour) s.vertexShader = s.vertexShader.replace("#include <beginnormal_vertex>", "vec3 objectNormal = frNrm;");
    // Colour dissolves; the shadow switches over halfway (a dithered shadow map would only add noise).
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying float vFade;\n${DITHER_GLSL}`)
      .replace("#include <alphatest_fragment>", colour ? "#include <alphatest_fragment>\n  if (sizesDither(vFade)) discard;" : "#include <alphatest_fragment>\n  if (vFade >= 0.0 ? vFade < 0.5 : -vFade - 1.0 >= 0.5) discard;");
  };
  const prevKey = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => `${prevKey ? prevKey() : ""}|far${colour ? "c" : "d"}`;
}

export class Crowd {
  readonly mesh: THREE.InstancedMesh;
  readonly material: THREE.MeshStandardMaterial;
  private depthMaterial: THREE.MeshDepthMaterial;
  private artTex: THREE.Texture | null = null;
  private depthTex: THREE.Texture | null = null;
  private depthSheet = { value: null as THREE.Texture | null };
  private placeholder: THREE.DataTexture;
  private cell = new Map<number, number>();
  private aArt: THREE.InstancedBufferAttribute;
  private aDep: THREE.InstancedBufferAttribute;
  private aWH: THREE.InstancedBufferAttribute;
  private aFade: THREE.InstancedBufferAttribute;
  private hash = 0;
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpP = new THREE.Vector3();
  private tmpS = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  /** Resolves once both sheets are on the GPU (or failed: the crowd then stays empty). */
  readonly ready: Promise<void>;
  private ok = false;
  private aborter = new AbortController();

  constructor(private renderer: THREE.WebGLRenderer, private manifest: FarManifest, readonly capacity = 1200, /** When to fetch the sheets (at once by default). */ start: Promise<void> = Promise.resolve()) {
    manifest.ids.forEach((id, k) => this.cell.set(id, k));
    this.placeholder = new THREE.DataTexture(new Uint8Array([128, 128, 0, 255]), 1, 1);
    this.placeholder.needsUpdate = true;
    this.depthSheet.value = this.placeholder;
    const geo = gridGeometry();
    const attr = (size: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.aArt = attr(4);
    this.aDep = attr(4);
    this.aWH = attr(2);
    this.aFade = attr(1);
    geo.setAttribute("aArt", this.aArt);
    geo.setAttribute("aDep", this.aDep);
    geo.setAttribute("aWH", this.aWH);
    geo.setAttribute("aFade", this.aFade);
    this.material = new THREE.MeshStandardMaterial({ map: this.placeholder, alphaTest: 0.5, alphaToCoverage: true, roughness: 0.62, metalness: 0, envMapIntensity: 0.8 });
    figureLook(this.material, manifest.artW, 0.25);
    farPatch(this.material, this.depthSheet, true);
    this.depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: this.placeholder, alphaTest: 0.5 });
    farPatch(this.depthMaterial, this.depthSheet, false);
    this.mesh = new THREE.InstancedMesh(geo, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.customDepthMaterial = this.depthMaterial;
    this.mesh.name = "crowd";
    this.ready = start.then(() => this.load());
  }

  private async load() {
    const sheet = async (url: string, srgb: boolean) => {
      const res = await fetch(url, { signal: this.aborter.signal });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
      const t = new THREE.Texture(bmp as unknown as HTMLImageElement);
      t.flipY = false;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      if (srgb) {
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.anisotropy = 4;
      } else {
        t.generateMipmaps = false;
        t.minFilter = THREE.LinearFilter;
      }
      t.magFilter = THREE.LinearFilter;
      t.needsUpdate = true;
      return t;
    };
    try {
      const [art, depth] = await Promise.all([sheet(this.manifest.art, true), sheet(this.manifest.depth, false)]);
      this.artTex = art;
      this.depthTex = depth;
      // On the GPU now, during the loading screen, not mid-glide.
      this.renderer.initTexture(art);
      this.renderer.initTexture(depth);
      this.material.map = art;
      this.depthMaterial.map = art;
      this.depthSheet.value = depth;
      this.ok = true;
    } catch {
      // No atlas: far figures simply aren't drawn (near ones still are).
    }
  }

  /** Alpha to coverage (smooth cut-out edges) only where the frame is multisampled; a plain cut is crisper without. */
  setCoverage(on: boolean) {
    if (this.material.alphaToCoverage === on) return;
    this.material.alphaToCoverage = on;
    this.material.needsUpdate = true;
  }

  /** Whether the sheets are in (far figures can be drawn). */
  get loaded() {
    return this.ok;
  }

  /** Whether a figure has a cell in the atlas. */
  has(art: number) {
    return this.cell.has(art);
  }

  /** This frame's crowd; returns whether it differs from the last one. */
  set(list: CrowdInstance[]): boolean {
    if (!this.ok) {
      this.mesh.count = 0;
      return false;
    }
    const n = Math.min(list.length, this.capacity);
    const art = this.aArt.array as Float32Array, dep = this.aDep.array as Float32Array, wh = this.aWH.array as Float32Array, fd = this.aFade.array as Float32Array;
    const { artW, artH, depthW, depthH } = this.manifest;
    let k = 0, hash = 17;
    for (let i = 0; i < n; i++) {
      const it = list[i];
      const c = this.cell.get(it.art);
      if (c === undefined) continue;
      const [, , bw, bh] = it.box;
      const L = Math.max(bw, bh);
      const W = bw / L, H = bh / L;
      const s = it.h / H;
      hash = (Math.imul(hash, 31) + it.art * 7 + Math.round(it.x * 64) + Math.round(it.z * 64) + Math.round(it.fade * 255)) | 0;
      this.tmpP.set(it.x, 0, it.z);
      this.tmpQ.setFromAxisAngle(this.up, it.yaw);
      this.tmpS.set(s, s, s);
      this.mesh.setMatrixAt(k, this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS));
      const a = FAR.rect(c, bw, bh, FAR.art), d = FAR.rect(c, bw, bh, FAR.depth);
      art.set([a.x / artW, a.y / artH, a.w / artW, a.h / artH], k * 4);
      // Depth samples land on texel centres at the box's edges.
      dep.set([(d.x + 0.5) / depthW, (d.y + 0.5) / depthH, (d.w - 1) / depthW, (d.h - 1) / depthH], k * 4);
      wh[k * 2] = W;
      wh[k * 2 + 1] = H;
      fd[k] = it.fade;
      k++;
    }
    hash = (Math.imul(hash, 31) + k) | 0;
    const changed = hash !== this.hash;
    this.hash = hash;
    this.mesh.count = k;
    if (k && changed) {
      for (const [a, size] of [[this.mesh.instanceMatrix, 16], [this.aArt, 4], [this.aDep, 4], [this.aWH, 2], [this.aFade, 1]] as const) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, k * size);
        a.needsUpdate = true;
      }
    }
    return changed;
  }

  dispose() {
    this.aborter.abort();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.depthMaterial.dispose();
    this.artTex?.dispose();
    this.depthTex?.dispose();
    this.placeholder.dispose();
  }
}
