import * as THREE from "three";
import { BOB, FLOAT, cycleHz, motionFor, type Motion } from "@/lib/mass-battle/gait";
import { figureSize } from "@/lib/mass-battle/stats";
import type { MBSpecies } from "@/lib/mass-battle/types";
import { HIT_TYPES } from "../view";
import type { SpeciesAsset } from "./assets";
import { typeLook } from "./effects";

/**
 * The armies: every Pokémon is a solid 3D relief figure of its HOME render
 * (front surface from a depth estimate, a rounded back), lit by the sun
 * and the sky, with a rim of light round its outline, darker where it
 * meets the ground, and a real shadow (the sun's shadow map draws the same
 * figures) plus a soft contact shadow under it. One instanced draw per
 * species and detail level, however many there are: near figures use the
 * detailed relief, far ones coarser reliefs (still 3D, never a flat card).
 *
 * Each frame the figures are placed from the simulation, turned to face
 * the camera (a relief reads best from the front; it turns round like a
 * card flip to face the way it fights), bob and lean with their gait,
 * lunge when they attack, flinch (squashed and knocked back) when hit,
 * with a flash in the colour of the move's type round their outline, and
 * when they faint, drop, glow red and shrink up into a Poké Ball's beam.
 * A boss (a side of three or fewer) glows with its type's aura and shakes
 * the ground as it walks. A figure right in front of the lens dissolves
 * (a screen-door fade, as games do) so it never blocks the shot.
 */

/** Seconds a fainted figure takes to drop and be recalled. */
export const RECALL = 1.1;
/** Where the Poké Ball that recalls a fainted figure hovers (m above the ground). */
export const ballHeight = (h: number) => Math.min(h * 1.1 + 0.45, h + 3);

export interface UnitsView {
  n: number;
  sp: Uint16Array;
  side: Uint8Array;
  /** 1 for units drawn (a representative share above the quality's cap). */
  draw: Uint8Array;
  /** Interpolated positions. */
  x: Float32Array;
  z: Float32Array;
  /** Where each unit is looking (its foe), or NaN. */
  fx: Float32Array;
  fz: Float32Array;
  /** Battle-time seconds of each unit's last hit taken, last attack and its faint (−1 none). */
  hitAt: Float32Array;
  /** The last hit's damage over max HP (a scratch barely flashes, a big hit lights the figure up). */
  hitPower: Float32Array;
  /** The last hit's move type (1 + its index in HIT_TYPES; 0 none). */
  hitType: Uint8Array;
  /** Each unit's form (scene/forms.ts), when its species has forms with figures of their own. */
  form?: Uint8Array;
  attackAt: Float32Array;
  faintAt: Float32Array;
  /** The battle clock (s). */
  t: number;
}

interface Level {
  geo: THREE.InstancedBufferGeometry;
  mesh: THREE.Mesh;
  pose: THREE.InstancedBufferAttribute;
  look: THREE.InstancedBufferAttribute;
  extra: THREE.InstancedBufferAttribute;
  fx: THREE.InstancedBufferAttribute;
  count: number;
  triangles: number;
}

interface SpeciesDraw {
  species: MBSpecies;
  motion: Motion;
  /** World size of the figure. */
  w: number;
  h: number;
  /** World units per mesh unit. */
  scale: number[];
  levels: Level[];
  material: THREE.MeshStandardMaterial;
  depth: THREE.MeshDepthMaterial;
  texture: THREE.Texture;
  boss: boolean;
  uniforms: { uAura: { value: THREE.Color }; uMeshH: { value: number } };
}

const UNIT_KEY = "mb-unit-v3";

/** The hit flash's colour per type (index as in `hitType`; 0 is a plain warm white). */
const FLASH_COLORS = [new THREE.Color(1, 0.95, 0.85), ...HIT_TYPES.map((t) => typeLook(t).color.clone().lerp(typeLook(t).glow, 0.35))];

/** The per-instance placement, shared by the figure and its shadow. */
const PLACE_GLSL = /* glsl */ `
attribute vec4 aPose;  // x, y, z, yaw
attribute vec4 aLook;  // scale, roll, flash, recall
attribute vec4 aExtra; // squeeze (the flip), squash, side + tint, pitch toward the camera
vec3 mbPlace(vec3 p) {
  float squash = aExtra.y;
  vec3 q = vec3(p.x * aExtra.x * (1.0 + squash * 0.6), p.y * (1.0 - squash), p.z) * aLook.x;
  float cr = cos(aLook.y), sr = sin(aLook.y);
  q = vec3(q.x * cr - q.y * sr, q.x * sr + q.y * cr, q.z);
  float cp = cos(aExtra.w), sp = sin(aExtra.w);
  q = vec3(q.x, q.y * cp - q.z * sp, q.y * sp + q.z * cp);
  float cy = cos(aPose.w), sy = sin(aPose.w);
  return vec3(q.x * cy + q.z * sy, q.y, -q.x * sy + q.z * cy) + aPose.xyz;
}
vec3 mbTurn(vec3 n) {
  float squash = aExtra.y;
  n = normalize(vec3(n.x / max(aExtra.x * (1.0 + squash * 0.6), 0.05), n.y / max(1.0 - squash, 0.3), n.z));
  float cr = cos(aLook.y), sr = sin(aLook.y);
  n = vec3(n.x * cr - n.y * sr, n.x * sr + n.y * cr, n.z);
  float cp = cos(aExtra.w), sp = sin(aExtra.w);
  n = vec3(n.x, n.y * cp - n.z * sp, n.y * sp + n.z * cp);
  float cy = cos(aPose.w), sy = sin(aPose.w);
  return vec3(n.x * cy + n.z * sy, n.y, -n.x * sy + n.z * cy);
}`;

/** The scene-wide light on the figures: rim colour (and strength), team tints, time for the aura's pulse. */
export const UNIT_LIGHT = {
  uRim: { value: new THREE.Color(0.9, 0.85, 0.75) },
  uTeamA: { value: new THREE.Color("#3e8bff") },
  uTeamB: { value: new THREE.Color("#ff4f5e") },
  uTime: { value: 0 },
};

/** Places, turns and animates each instance (hit flash, recall, rim light, aura) in the standard material. */
function unitPatch(m: THREE.MeshStandardMaterial, u: SpeciesDraw["uniforms"]) {
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, UNIT_LIGHT, u, { uFlashCols: { value: FLASH_COLORS } });
    s.vertexShader = s.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
${PLACE_GLSL}
uniform float uMeshH;
uniform vec3 uFlashCols[${FLASH_COLORS.length}];
attribute vec2 aFx; // fade (in front of the lens), the flash's type
varying float vFlash;
varying float vRecall;
varying float vH;
varying float vSide;
varying float vTint;
varying float vFade;
varying vec3 vFlashCol;`
      )
      .replace("#include <beginnormal_vertex>", "vec3 objectNormal = mbTurn(vec3(normal));\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(tangent.xyz);\n#endif")
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = mbPlace(position);
vFlash = aLook.z;
vRecall = aLook.w;
vH = position.y / max(uMeshH, 1e-4);
vSide = floor(aExtra.z);
vTint = fract(aExtra.z);
vFade = aFx.x;
vFlashCol = uFlashCols[int(aFx.y + 0.5)];`
      );
    s.fragmentShader = s.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform vec3 uRim;
uniform vec3 uTeamA;
uniform vec3 uTeamB;
uniform vec3 uAura;
uniform float uTime;
varying float vFlash;
varying float vRecall;
varying float vH;
varying float vSide;
varying float vTint;
varying float vFade;
varying vec3 vFlashCol;
// A 4×4 ordered dither for the screen-door fade.
float mbBayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float mbBayer4(vec2 a) { return mbBayer2(0.5 * a) * 0.25 + mbBayer2(a) + 1.0 / 32.0; }`
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
if (vFade > 0.004 && mbBayer4(gl_FragCoord.xy) < vFade) discard;`
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
// Darker where the figure meets the ground (contact occlusion), a touch of variety between units.
diffuseColor.rgb *= mix(0.5, 1.0, smoothstep(0.0, 0.2, vH)) * (0.95 + vTint * 0.1);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.16, 0.2), clamp(vRecall * 1.4, 0.0, 0.9));`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
float mbRim = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.5);
vec3 mbTeam = vSide < 0.5 ? uTeamA : uTeamB;
totalEmissiveRadiance += (uRim + mbTeam * 0.25) * mbRim * (0.35 + 0.65 * smoothstep(0.1, 0.6, vH));
// A boss's aura: its outline glows and pulses.
totalEmissiveRadiance += uAura * (mbRim * 1.7 + 0.04) * (0.75 + 0.25 * sin(uTime * 3.0 + vH * 6.0));
// A hit: a flash in the move's type's colour, strongest round the outline so the figure still reads.
totalEmissiveRadiance += vFlashCol * vFlash * (0.22 + 1.1 * mbRim) + vec3(1.0, 0.12, 0.16) * vRecall * 2.2;`
      );
  };
  m.customProgramCacheKey = () => UNIT_KEY;
}

/** The figure in the sun's shadow map: the same placement, cut out by the render's alpha. */
function depthMaterial(tex: THREE.Texture): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.5 });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace("#include <common>", `#include <common>\n${PLACE_GLSL}`).replace("#include <begin_vertex>", "vec3 transformed = mbPlace(position);");
  };
  m.customProgramCacheKey = () => `${UNIT_KEY}-depth`;
  return m;
}

/** The soft shade under each figure (contact shadow): darker and tighter right under it. */
function shadowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uStrength: { value: 0.55 } },
    vertexShader: `
attribute vec4 aShade;
varying vec2 vUv;
varying float vA;
void main() {
  vUv = uv;
  vA = aShade.w;
  vec3 p = vec3(position.x * aShade.z, 0.0, position.y * aShade.z * 0.8) + vec3(aShade.x, 0.025, aShade.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`,
    fragmentShader: `
uniform float uStrength;
varying vec2 vUv;
varying float vA;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = (smoothstep(1.0, 0.1, d) * 0.6 + smoothstep(0.55, 0.0, d) * 0.4) * uStrength * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(0.02, 0.025, 0.04, a);
}`,
  });
}

/** A form with a figure of its own, for a battle species (see forms.ts). */
export interface UnitForm {
  sp: number;
  form: number;
  species: MBSpecies;
  asset: SpeciesAsset;
}

export interface UnitsOptions {
  /** Projected heights (px) above which the more detailed levels are used (one fewer than the levels). */
  lodPx: number[];
  anisotropy: number;
  /** Figures cast real shadows (the sun's shadow map). */
  shadows: boolean;
  /** Species ids drawn as bosses (aura, footsteps). */
  bosses: Set<number>;
}

/** Hooks for the effects the figures make as they move. */
export interface UnitsHooks {
  /** A boss's footfall (ground cracks, dust, a tremor). */
  step?(x: number, z: number, size: number, i: number): void;
  /** Dust kicked up by a charging figure. */
  dust?(x: number, z: number, size: number): void;
}

/** Aura colours by type (a boss glows with its first type's). */
const AURA: Record<string, string> = {
  normal: "#ffe9b0", fire: "#ff6a1a", water: "#3a9bff", electric: "#ffe03a", grass: "#5adf4a", ice: "#9feaff", fighting: "#ff6a3a",
  poison: "#c05aff", ground: "#e0a050", flying: "#b8d0ff", psychic: "#ff5ab0", bug: "#b8e040", rock: "#d8b878", ghost: "#8a6aff",
  dragon: "#7a5aff", dark: "#a070ff", steel: "#d8e4ff", fairy: "#ff9ae0",
};

export class UnitsLayer {
  readonly group = new THREE.Group();
  private draws: SpeciesDraw[] = [];
  private shadow: { mesh: THREE.Mesh; attr: THREE.InstancedBufferAttribute; geo: THREE.InstancedBufferGeometry; mat: THREE.ShaderMaterial };
  private phase: Float32Array;
  private speed: Float32Array;
  private lastX: Float32Array;
  private lastZ: Float32Array;
  private flip: Float32Array;
  private stepCount: Float32Array;
  /** Draw index per (battle species × 16 + form) for forms with figures of their own. */
  private formDraw = new Map<number, number>();
  /** The form each unit was last drawn in (255 before its first frame), when it changed and the height it changed from. */
  private shownForm: Uint8Array;
  private formAt: Float32Array;
  private formFrom: Float32Array;
  private frustum = new THREE.Frustum();
  private projScreen = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  private camRight = new THREE.Vector3();
  private dustBudget = 0;
  private seed = 7;
  opts: UnitsOptions;
  hooks: UnitsHooks = {};
  /** Debugging: one unit's per-frame values. */
  debugUnit = -1;
  debugLog: { t: number; roll: number; yaw: number; flip: number; scale: number; y: number; recall: number; li: number }[] = [];
  /** Triangles and instances drawn last frame (for the stats overlay and tests). */
  drawn = { instances: 0, triangles: 0, calls: 0 };

  constructor(species: MBSpecies[], assets: Map<number, SpeciesAsset>, view: Pick<UnitsView, "n" | "sp" | "draw">, opts: UnitsOptions, forms: UnitForm[] = []) {
    this.opts = opts;
    const counts = new Array(species.length).fill(0);
    for (let i = 0; i < view.n; i++) if (view.draw[i]) counts[view.sp[i]]++;
    species.forEach((s, k) => {
      const asset = assets.get(s.id);
      if (!asset) throw new Error(`no figure for ${s.name}`);
      this.draws.push(this.makeDraw(s, asset, counts[k], opts.bosses.has(s.id), motionFor(s)));
    });
    // A form with a figure of its own (Blade Forme, School Form…): its own draw, as many slots as its species has units.
    for (const f of forms) {
      const base = species[f.sp];
      if (!base) continue;
      this.formDraw.set(f.sp * 16 + f.form, this.draws.length);
      this.draws.push(this.makeDraw(f.species, f.asset, counts[f.sp], opts.bosses.has(base.id), motionFor(base)));
    }
    // Contact shadows for every figure, one draw.
    const total = counts.reduce((a, b) => a + b, 0);
    const geo = new THREE.InstancedBufferGeometry();
    const plane = new THREE.PlaneGeometry(2, 2);
    geo.index = plane.index;
    geo.setAttribute("position", plane.getAttribute("position"));
    geo.setAttribute("uv", plane.getAttribute("uv"));
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, total) * 4), 4);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aShade", attr);
    geo.instanceCount = 0;
    const mat = shadowMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    this.group.add(mesh);
    this.shadow = { mesh, attr, geo, mat };
    this.phase = new Float32Array(view.n);
    for (let i = 0; i < view.n; i++) this.phase[i] = (((i * 2654435761) % 1000) / 1000) * Math.PI * 2;
    this.speed = new Float32Array(view.n);
    this.lastX = new Float32Array(view.n).fill(NaN);
    this.lastZ = new Float32Array(view.n).fill(NaN);
    this.flip = new Float32Array(view.n);
    this.stepCount = new Float32Array(view.n);
    this.shownForm = new Uint8Array(view.n).fill(255);
    this.formAt = new Float32Array(view.n).fill(-1);
    this.formFrom = new Float32Array(view.n);
  }

  /** One species' (or form's) figure: its texture, material and instanced mesh at every detail level. */
  private makeDraw(s: MBSpecies, asset: SpeciesAsset, count: number, boss: boolean, motion: Motion): SpeciesDraw {
    const opts = this.opts;
    const tex = new THREE.Texture(asset.art as unknown as HTMLImageElement);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.anisotropy = opts.anisotropy;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.needsUpdate = true;
    const uniforms = { uAura: { value: new THREE.Color(boss ? AURA[s.types[0]] ?? "#ffe9b0" : "#000000").multiplyScalar(boss ? 0.4 : 0) }, uMeshH: { value: asset.levels[0]?.height ?? 1 } };
    const material = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.55, metalness: 0, side: THREE.FrontSide });
    const draw: SpeciesDraw = { species: s, motion, w: 0, h: 0, scale: [], levels: [], material, depth: depthMaterial(tex), texture: tex, boss, uniforms };
    unitPatch(material, uniforms);
    const size = figureSize(s);
    const cap = Math.max(1, count);
    draw.levels = asset.levels.map((lv, li) => {
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(lv.position, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(lv.normal, 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(lv.uv, 2));
      geo.setIndex(new THREE.BufferAttribute(lv.index, 1));
      const pose = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      const look = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      const extra = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      const fx = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
      for (const a of [pose, look, extra, fx]) a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute("aPose", pose);
      geo.setAttribute("aLook", look);
      geo.setAttribute("aExtra", extra);
      geo.setAttribute("aFx", fx);
      geo.instanceCount = 0;
      const mesh = new THREE.Mesh(geo, material);
      mesh.frustumCulled = false;
      mesh.name = `${s.slug}-lod${li}`;
      // The coarsest level is only ever far away: its contact shadow is enough.
      mesh.castShadow = opts.shadows && (li < asset.levels.length - 1 || boss || asset.levels.length === 1);
      mesh.receiveShadow = opts.shadows;
      mesh.customDepthMaterial = draw.depth;
      this.group.add(mesh);
      return { geo, mesh, pose, look, extra, fx, count: 0, triangles: lv.triangles };
    });
    draw.w = size.w;
    draw.h = size.h;
    draw.scale = asset.levels.map((lv) => size.h / Math.max(1e-6, lv.height));
    return draw;
  }

  /** The draw for a unit's species in a form (its own figure when the form has one). */
  private drawFor(sp: number, form: number): SpeciesDraw {
    return this.draws[form ? this.formDraw.get(sp * 16 + form) ?? sp : sp];
  }

  /** Every material, for compiling before the battle starts. */
  materials(): THREE.Material[] {
    return [...this.draws.flatMap((d) => [d.material, d.depth]), this.shadow.mat];
  }

  textures(): THREE.Texture[] {
    return this.draws.map((d) => d.texture);
  }

  setShadows(on: boolean) {
    this.opts.shadows = on;
    for (const d of this.draws) d.levels.forEach((lv, li) => {
      lv.mesh.castShadow = on && (li < d.levels.length - 1 || d.boss || d.levels.length === 1);
      lv.mesh.receiveShadow = on;
    });
  }

  private rand() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /** Lays out this frame's instances. `dt` is real seconds (for smoothing), `view.t` the battle clock; `bt` the battle time passed this frame. */
  update(view: UnitsView, camera: THREE.PerspectiveCamera, viewportH: number, dt: number, bt = dt) {
    const { n, sp, x, z, draw } = view;
    const t = view.t;
    UNIT_LIGHT.uTime.value = t;
    camera.updateMatrixWorld();
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    this.camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const rx = this.camRight.x, rz = this.camRight.z;
    const pxPerM = viewportH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    for (const d of this.draws) for (const lv of d.levels) lv.count = 0;
    const shadeArr = this.shadow.attr.array as Float32Array;
    let shades = 0;
    let instances = 0, triangles = 0;
    const lodPx = this.opts.lodPx;
    const flipStep = dt * 5;
    const speedRate = 1 - Math.exp(-dt * 6);
    // Dust: a few puffs a moment from the charge, never a fog of them.
    this.dustBudget = Math.min(8, this.dustBudget + bt * 40);
    const hooks = this.hooks;
    for (let i = 0; i < n; i++) {
      if (!draw[i]) continue;
      const fa = view.faintAt[i];
      const age = fa >= 0 ? t - fa : -1;
      if (age >= RECALL) continue;
      // Its form: a change (Blade Forme, School Form…) grows or shrinks the new figure out of the old one, with a flash.
      const fm = view.form ? view.form[i] : 0;
      if (fm !== this.shownForm[i]) {
        if (this.shownForm[i] !== 255) {
          this.formFrom[i] = this.drawFor(sp[i], this.shownForm[i]).h;
          this.formAt[i] = t;
        }
        this.shownForm[i] = fm;
      }
      const d = this.drawFor(sp[i], fm);
      const xi = x[i], zi = z[i];
      // Speed (for the gait), smoothed, in battle time.
      let v = 0;
      if (!Number.isNaN(this.lastX[i]) && bt > 1e-4) v = Math.min(30, Math.hypot(xi - this.lastX[i], zi - this.lastZ[i]) / bt);
      else if (bt <= 1e-4) v = this.speed[i];
      this.lastX[i] = xi;
      this.lastZ[i] = zi;
      const sv = (this.speed[i] += (v - this.speed[i]) * speedRate);
      // Facing: toward the camera, turned round when its foe is to the right on screen.
      const fx = view.fx[i], fz = view.fz[i];
      if (!Number.isNaN(fx)) {
        // Turn to face the foe on screen, with some slack so a foe straight ahead doesn't make it spin.
        const side = (fx - xi) * rx + (fz - zi) * rz;
        const slack = 0.2 + d.w * 0.25;
        const want = side > slack ? 1 : side < -slack ? 0 : this.flip[i] > 0.5 ? 1 : 0;
        this.flip[i] = want > this.flip[i] ? Math.min(want, this.flip[i] + flipStep) : Math.max(want, this.flip[i] - flipStep);
      }
      const h = d.h;
      // Gait (runs on battle time, so slow motion slows the strides).
      const hz = cycleHz(d.motion, sv, h, d.species.shape);
      const before = this.phase[i];
      this.phase[i] += hz * bt * Math.PI * 2;
      if (sv > 0.4 && Math.floor(this.phase[i] / Math.PI) !== Math.floor(before / Math.PI) && (d.motion === "run" || d.motion === "gallop" || d.motion === "bounce" || d.motion === "flop")) {
        if (d.boss) hooks.step?.(xi, zi, Math.max(d.w, h), i);
        else if (sv > 1.5 && this.dustBudget >= 1 && this.rand() < 0.08) {
          this.dustBudget -= 1;
          hooks.dust?.(xi, zi, Math.max(0.25, Math.min(1.5, Math.max(d.w, h) * 0.5)));
        }
      }
      // Visible at all?
      this.sphere.center.set(xi, h * 0.5, zi);
      this.sphere.radius = Math.max(h, d.w) * 0.75 + 0.5;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const dist = Math.max(0.5, Math.hypot(xi - cx, h * 0.5 - cy, zi - cz));
      const px = (h * pxPerM) / dist;
      let li = lodPx.length;
      for (let k = 0; k < lodPx.length; k++) if (px >= lodPx[k]) { li = k; break; }
      li = Math.min(li, d.levels.length - 1);
      const lv = d.levels[li];
      const stride = Math.min(1, sv / 4);
      let y = FLOAT[d.motion] * h + Math.abs(Math.sin(this.phase[i])) * BOB[d.motion] * h * (d.motion === "hover" ? 1 : stride);
      if (d.motion === "hover" || d.motion === "fly") y += Math.sin(t * 1.7 + i) * 0.03 * h;
      // A positive roll tilts the figure toward its foe (it faces the foe on screen, flipped or not).
      // Lean into the run.
      let roll = Math.min(0.18, sv * 0.022) * (d.boss ? 0.5 : 1);
      let squash = d.motion === "bounce" || d.motion === "flop" ? -Math.sin(this.phase[i] * 2) * 0.05 * stride : 0;
      let ox = 0, oz = 0;
      // Lunge at the foe on an attack (the attack is timed so the lunge lands with the hit).
      const aa = t - view.attackAt[i];
      if (view.attackAt[i] >= 0 && aa >= 0 && aa < 0.36 && !Number.isNaN(fx)) {
        const k = Math.sin((aa / 0.36) * Math.PI);
        const reach = Math.min(1.4, d.w * 0.38 + 0.15) * k;
        const dd = Math.hypot(fx - xi, fz - zi) || 1;
        ox = ((fx - xi) / dd) * reach;
        oz = ((fz - zi) / dd) * reach;
        roll += 0.24 * k;
        squash -= 0.05 * k;
      }
      // Hit: a flash, a flinch back and a squash.
      const ha = t - view.hitAt[i];
      let flash = 0;
      let flashType = 0;
      if (view.hitAt[i] >= 0 && ha >= 0 && ha < 0.34) {
        flashType = view.hitType[i];
        const k = 1 - ha / 0.34;
        const p = Math.min(1, 0.3 + view.hitPower[i] * 4);
        // Bright at once, quickly gone (in slow motion it lasts three times as long on screen, so it must not linger).
        flash = k * k * Math.min(0.9, 0.12 + view.hitPower[i] * 2.5);
        roll -= 0.26 * k * p;
        squash += 0.12 * k * k * p;
        if (!Number.isNaN(fx)) {
          // Knocked back from the foe (on top of the simulation's knockback).
          const dd = Math.hypot(fx - xi, fz - zi) || 1;
          const kb = Math.min(0.5, h * 0.12) * k * p;
          ox -= ((fx - xi) / dd) * kb;
          oz -= ((fz - zi) / dd) * kb;
        }
      }
      let scale = d.scale[li];
      const fc = t - this.formAt[i];
      if (this.formAt[i] >= 0 && fc >= 0 && fc < 0.45) {
        const k = fc / 0.45;
        const from = this.formFrom[i] / Math.max(1e-3, d.h);
        scale *= from + (1 - from) * (1 - (1 - k) * (1 - k) * (1 - k));
        flash = Math.max(flash, (1 - k) * 0.8);
      }
      let recall = 0;
      if (age >= 0) {
        // Faint: drop and tip over, glow red, then shrink up into the Poké Ball's beam.
        const drop = Math.min(1, age / 0.25);
        y = Math.max(0, y * (1 - drop));
        roll -= 0.9 * drop;
        squash = 0.1 * drop;
        recall = Math.min(1, Math.max(0, (age - 0.2) / 0.3));
        const shrink = Math.max(0, (age - 0.45) / (RECALL - 0.45));
        scale *= Math.max(0.001, 1 - shrink * shrink);
        y += (ballHeight(h) - y - h * 0.2) * shrink * shrink;
        flash = 0;
      }
      // The turn: the figure narrows to nothing and opens out facing the other way (a relief never shows its edge).
      const f = this.flip[i];
      const yaw = Math.atan2(cx - xi, cz - zi) + (f < 0.5 ? 0 : Math.PI);
      const squeeze = Math.abs(Math.cos(f * Math.PI));
      // Seen from high above, figures lean back a little toward the camera so they still read.
      const camPitch = Math.atan2(cy - h * 0.5, Math.hypot(cx - xi, cz - zi));
      const pitch = Math.max(0, Math.min(0.42, (camPitch - 0.55) * 0.55));
      // In front of the lens: a figure filling most of the frame (or with the camera inside it) dissolves, so a crowd
      // round a low camera frames the action instead of hiding it. A boss never does: its shots are built round it.
      let fade = 0;
      if (!d.boss) {
        fade = Math.min(1, Math.max(0, (px / viewportH - 0.62) / 0.38));
        if (dist < Math.max(d.w, h) * 0.55) fade = 1;
      }
      if (fade >= 0.999) continue;
      const o = lv.count * 4;
      const pose = lv.pose.array as Float32Array, look = lv.look.array as Float32Array, extra = lv.extra.array as Float32Array;
      const fxa = lv.fx.array as Float32Array;
      fxa[lv.count * 2] = fade;
      fxa[lv.count * 2 + 1] = flash > 0 ? flashType : 0;
      pose[o] = xi + ox;
      pose[o + 1] = y;
      pose[o + 2] = zi + oz;
      pose[o + 3] = yaw;
      look[o] = scale;
      look[o + 1] = roll;
      look[o + 2] = flash;
      look[o + 3] = recall;
      extra[o] = squeeze;
      extra[o + 1] = Math.max(-0.12, Math.min(0.3, squash));
      extra[o + 2] = view.side[i] + (((i * 40503) % 997) / 997) * 0.98;
      extra[o + 3] = pitch;
      if (this.debugUnit === i) this.debugLog.push({ t: view.t, roll, yaw, flip: this.flip[i], scale, y, recall, li });
      lv.count++;
      instances++;
      triangles += lv.triangles;
      if (age < 0.4) {
        const so = shades * 4;
        shadeArr[so] = xi + ox;
        shadeArr[so + 1] = zi + oz;
        shadeArr[so + 2] = Math.max(0.15, d.w * 0.55);
        shadeArr[so + 3] = Math.max(0.2, 1 - (y / Math.max(0.1, h)) * 0.8) * (age < 0 ? 1 : 1 - age / 0.4);
        shades++;
      }
    }
    let calls = 1;
    for (const d of this.draws) {
      for (const lv of d.levels) {
        lv.geo.instanceCount = lv.count;
        lv.mesh.visible = lv.count > 0;
        if (lv.count) {
          calls++;
          for (const a of [lv.pose, lv.look, lv.extra, lv.fx]) {
            a.clearUpdateRanges();
            a.addUpdateRange(0, lv.count * a.itemSize);
            a.needsUpdate = true;
          }
        }
      }
    }
    this.shadow.geo.instanceCount = shades;
    this.shadow.mesh.visible = shades > 0;
    if (shades) {
      this.shadow.attr.clearUpdateRanges();
      this.shadow.attr.addUpdateRange(0, shades * 4);
      this.shadow.attr.needsUpdate = true;
    }
    this.drawn = { instances, triangles, calls };
  }

  /** Puts one instance of every level on screen (for compiling and uploading before the battle starts). */
  primeAll(at: THREE.Vector3) {
    for (const d of this.draws) {
      for (const lv of d.levels) {
        (lv.pose.array as Float32Array).set([at.x, 0, at.z, 0], 0);
        (lv.look.array as Float32Array).set([d.scale[0] * 0.001, 0, 0, 0], 0);
        (lv.extra.array as Float32Array).set([1, 0, 0, 0], 0);
        (lv.fx.array as Float32Array).set([0, 0], 0);
        for (const a of [lv.pose, lv.look, lv.extra, lv.fx]) {
          a.clearUpdateRanges();
          a.needsUpdate = true;
        }
        lv.geo.instanceCount = 1;
        lv.mesh.visible = true;
      }
    }
    this.shadow.geo.instanceCount = 1;
    this.shadow.mesh.visible = true;
  }

  dispose() {
    for (const d of this.draws) {
      for (const lv of d.levels) lv.geo.dispose();
      d.material.dispose();
      d.depth.dispose();
      d.texture.dispose();
    }
    this.shadow.geo.dispose();
    this.shadow.mat.dispose();
  }
}
