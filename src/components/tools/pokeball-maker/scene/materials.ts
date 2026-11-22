import * as THREE from "three";
import { PATTERN_GLSL } from "@/lib/pokeball-maker/patterns";
import { MAX_STICKERS, patternScale, patternRot, stickerAngles, stickerSize, FINISHES, type Design, type Finish, type PatternLayer, type RGB } from "@/lib/pokeball-maker/design";
import { ATLAS_GRID } from "@/lib/pokeball-maker/glyphs";

/**
 * The ball's materials: three.js's physical material for the light, with the part's colour, its half's pattern,
 * its finish's surface (wood grain, stone, carbon weave, spun metal) and the stickers computed per pixel from the
 * point's place on the ball. The same colour function bakes into textures for the GLB download.
 */

/** Uniforms every part shares: the time, the sticker atlas and the stickers. */
export interface Shared {
  uTime: { value: number };
  uGlyphs: { value: THREE.Texture | null };
  uStickN: { value: number };
  uStickA: { value: THREE.Vector4[] };
  uStickB: { value: THREE.Vector4[] };
  uStickC: { value: THREE.Color[] };
}

export function sharedUniforms(): Shared {
  return {
    uTime: { value: 0 },
    uGlyphs: { value: null },
    uStickN: { value: 0 },
    uStickA: { value: Array.from({ length: MAX_STICKERS }, () => new THREE.Vector4()) },
    uStickB: { value: Array.from({ length: MAX_STICKERS }, () => new THREE.Vector4()) },
    uStickC: { value: Array.from({ length: MAX_STICKERS }, () => new THREE.Color()) },
  };
}

/** Puts a design's stickers into the shared uniforms. */
export function setStickers(sh: Shared, d: Design) {
  const n = Math.min(MAX_STICKERS, d.stickers.length);
  sh.uStickN.value = n;
  for (let i = 0; i < n; i++) {
    const s = d.stickers[i];
    const { az, pol } = stickerAngles(s);
    const dir = new THREE.Vector3(Math.sin(pol) * Math.sin(az), Math.cos(pol), Math.sin(pol) * Math.cos(az));
    sh.uStickA.value[i].set(dir.x, dir.y, dir.z, stickerSize(s.size));
    sh.uStickB.value[i].set(s.glyph % ATLAS_GRID, Math.floor(s.glyph / ATLAS_GRID), (s.rot / 256) * Math.PI * 2, 1);
    lin(sh.uStickC.value[i], s.colour);
  }
}

/** An sRGB byte colour as three.js's linear working colour. */
export function lin(c: THREE.Color, rgb: RGB): THREE.Color {
  return c.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
}

export const FINISH_ID: Record<Finish, number> = Object.fromEntries(FINISHES.map((f, i) => [f, i])) as Record<Finish, number>;

/** The per-pixel colour: the part's colour, its pattern, its finish's surface and the stickers (linear RGB). */
export const ALBEDO_GLSL = /* glsl */ `
uniform vec3 uBase, uC1, uC2, uC3;
uniform float uPat, uPatS, uPatR, uHalf, uFin, uTime, uStickOn;
uniform float uStickN;
uniform vec4 uStickA[${MAX_STICKERS}];
uniform vec4 uStickB[${MAX_STICKERS}];
uniform vec3 uStickC[${MAX_STICKERS}];
uniform sampler2D uGlyphs;
varying vec3 vPbmObj;
${PATTERN_GLSL}
vec3 pbmSurface(vec3 c, vec3 pos) {
  float az = atan(pos.x, pos.z);
  if (uFin == 2.0) {
    // Spun metal: fine rings round the axis.
    float n = pbmNoise(vec3(pos.y * 3.2, 0.5, 0.5)) * 0.6 + pbmNoise(vec3(pos.y * 11.0, 2.0, 0.0)) * 0.4;
    return c * (0.9 + 0.18 * n);
  }
  if (uFin == 7.0) {
    // Wood: planks round the ball with a grain that wanders.
    float g = pbmFbm(pos * vec3(0.05, 0.35, 0.05) + vec3(az * 0.6, 0.0, 0.0));
    float rings = fract(pos.y * 0.55 + g * 3.2);
    float grain = smoothstep(0.0, 0.55, abs(rings - 0.5) * 2.0);
    float plank = abs(fract(az / PBM_TAU * 14.0) - 0.5);
    float seam = smoothstep(0.47, 0.5, plank);
    return c * (0.72 + 0.36 * grain) * (1.0 - 0.35 * seam);
  }
  if (uFin == 8.0) {
    // Stone: mottled, with flecks.
    float n = pbmFbm(pos * 0.16 + 4.0);
    float f = pbmHash3(floor(pos * 2.2));
    float fleck = step(0.94, f) * 0.35 - step(f, 0.04) * 0.3;
    return c * (0.68 + 0.5 * n + fleck);
  }
  if (uFin == 9.0) {
    // Carbon fibre: a 2×2 twill weave.
    float a = (az / PBM_TAU) * 150.0, b = pos.y * 2.4;
    float k = mod(floor(a) + floor(b), 4.0);
    bool across = k < 2.0;
    float fib = across ? sin(fract(b) * PBM_PI) : sin(fract(a) * PBM_PI);
    return c * (0.32 + 0.75 * (0.35 + 0.65 * fib) * (across ? 1.0 : 0.72));
  }
  return c;
}
vec3 pbmStickers(vec3 q, vec3 col) {
  for (int k = 0; k < ${MAX_STICKERS}; k++) {
    if (float(k) >= uStickN) break;
    vec3 d = uStickA[k].xyz;
    float sz = uStickA[k].w;
    if (dot(q, d) < 0.55) continue;
    vec3 t1 = normalize(abs(d.y) > 0.98 ? cross(vec3(0.0, 0.0, 1.0), d) : cross(vec3(0.0, 1.0, 0.0), d));
    vec3 t2 = cross(d, t1);
    vec2 l = pbmRot(vec2(dot(q, t1), dot(q, t2)) / sz, uStickB[k].z);
    if (abs(l.x) > 1.0 || abs(l.y) > 1.0) continue;
    vec2 uv = (uStickB[k].xy + (l * vec2(0.5, -0.5) + 0.5)) / ${ATLAS_GRID}.0;
    uv.y = 1.0 - uv.y;
    float a = texture2D(uGlyphs, uv).a;
    col = mix(col, uStickC[k], a);
  }
  return col;
}
vec3 pbmAlbedo(vec3 pos) {
  vec3 q = normalize(pos);
  vec3 col = uBase;
  if (uHalf != 0.0 && uPat > 0.5) {
    vec3 h = q;
    if (uHalf < 0.0) h.y = -h.y;
    vec3 w = pbmPattern(int(uPat + 0.5), h, uPatS, uPatR);
    col = mix(col, uC1, w.x);
    col = mix(col, uC2, w.y);
    col = mix(col, uC3, w.z);
  }
  col = pbmSurface(col, pos);
  if (uStickN > 0.5 && uStickOn > 0.5) col = pbmStickers(q, col);
  return col;
}
`;

export interface PartUniforms {
  uBase: { value: THREE.Color };
  uC1: { value: THREE.Color };
  uC2: { value: THREE.Color };
  uC3: { value: THREE.Color };
  uPat: { value: number };
  uPatS: { value: number };
  uPatR: { value: number };
  uHalf: { value: number };
  uFin: { value: number };
  uStickOn: { value: number };
}

export function partUniforms(): PartUniforms {
  return {
    uBase: { value: new THREE.Color() },
    uC1: { value: new THREE.Color() },
    uC2: { value: new THREE.Color() },
    uC3: { value: new THREE.Color() },
    uPat: { value: 0 },
    uPatS: { value: 1 },
    uPatR: { value: 0 },
    uHalf: { value: 0 },
    uFin: { value: 0 },
    uStickOn: { value: 0 },
  };
}

/** Fills a part's uniforms from its colour, finish and (on a shell) its half's pattern. */
export function setPart(u: PartUniforms, colour: RGB, finish: Finish, half: 0 | 1 | -1, layer: PatternLayer | null) {
  lin(u.uBase.value, colour);
  u.uFin.value = FINISH_ID[finish];
  u.uHalf.value = half;
  if (layer && layer.id > 0) {
    u.uPat.value = layer.id;
    lin(u.uC1.value, layer.colours[0]);
    lin(u.uC2.value, layer.colours[1]);
    lin(u.uC3.value, layer.colours[2]);
    u.uPatS.value = patternScale(layer.scale);
    u.uPatR.value = patternRot(layer.rot);
  } else u.uPat.value = 0;
}

/** How each finish catches the light. */
function finishParams(f: Finish, glass: boolean): THREE.MeshPhysicalMaterialParameters {
  switch (f) {
    case "gloss":
      return { roughness: 0.17, clearcoat: 1, clearcoatRoughness: 0.06 };
    case "matte":
      return { roughness: 0.78, sheen: 0.35, sheenRoughness: 0.8 };
    case "metal":
      return { metalness: 1, roughness: 0.3 };
    case "pearl":
      return { roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.12, iridescence: 0.6, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 520], sheen: 0.6, sheenRoughness: 0.4 };
    case "holo":
      return { metalness: 0.55, roughness: 0.2, iridescence: 1, iridescenceIOR: 1.9, iridescenceThicknessRange: [120, 900], clearcoat: 1, clearcoatRoughness: 0.05 };
    case "glitter":
      return { metalness: 0.65, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.04 };
    case "glass":
      return glass
        ? { transmission: 1, roughness: 0.06, thickness: 3, ior: 1.45, attenuationDistance: 24, clearcoat: 1, clearcoatRoughness: 0.02 }
        : { roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03, transparent: true, opacity: 0.55, depthWrite: false };
    case "wood":
      return { roughness: 0.62, clearcoat: 0.25, clearcoatRoughness: 0.45 };
    case "stone":
      return { roughness: 0.92 };
    case "carbon":
      return { metalness: 0.2, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.03 };
    case "glow":
      return { roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.2 };
  }
}

export interface PartMaterial {
  material: THREE.MeshPhysicalMaterial;
  u: PartUniforms;
  finish: Finish;
}

/**
 * A part's material. `glass`: this device draws real glass (transmission); otherwise glass is see-through plastic.
 * `flat`: faceted shading (the Origin-style shape).
 */
export function partMaterial(finish: Finish, shared: Shared, o: { glass: boolean; flat: boolean; side?: THREE.Side }): PartMaterial {
  const u = partUniforms();
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, ...finishParams(finish, o.glass), flatShading: o.flat, side: o.side ?? THREE.FrontSide });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, shared);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vPbmObj;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPbmObj = position;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\n${ALBEDO_GLSL}`)
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb = pbmAlbedo(vPbmObj);")
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        if (uFin == 5.0) {
          vec3 cell = floor(vPbmObj * 1.7);
          vec3 flake = vec3(pbmHash3(cell), pbmHash3(cell + 3.7), pbmHash3(cell + 9.1)) - 0.5;
          normal = normalize(normal + flake * 0.95);
        }`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        if (uFin == 10.0) totalEmissiveRadiance += diffuseColor.rgb * 2.6;
        if (uFin == 4.0) {
          float f = dot(normal, normalize(vViewPosition));
          vec3 rb = 0.5 + 0.5 * cos(6.2831853 * (vec3(0.0, 0.33, 0.67) + f * 1.6 + vPbmObj.y * 0.025 + uTime * 0.05));
          totalEmissiveRadiance += rb * 0.16;
        }
        if (uFin == 5.0) {
          float h = pbmHash3(floor(vPbmObj * 1.7) + 1.3);
          totalEmissiveRadiance += vec3(step(0.9, h) * (0.5 + 0.5 * sin(uTime * 3.0 + h * 40.0)) * 0.5);
        }`
      );
  };
  m.customProgramCacheKey = () => `pbm-${finish}-${o.glass ? 1 : 0}`;
  u.uFin.value = FINISH_ID[finish];
  if (finish === "glow") m.emissive.set(0x000000);
  return { material: m, u, finish };
}

/** The baking pass for the GLB: a part's colour written into its UV layout, sRGB. */
export function bakeMaterial(u: PartUniforms, shared: Shared): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...u, ...shared },
    vertexShader: /* glsl */ `
      varying vec3 vPbmObj;
      void main() {
        vPbmObj = position;
        gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${ALBEDO_GLSL}
      void main() {
        vec3 c = clamp(pbmAlbedo(vPbmObj), 0.0, 1.0);
        vec3 s = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
        gl_FragColor = vec4(s, 1.0);
      }`,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
}
