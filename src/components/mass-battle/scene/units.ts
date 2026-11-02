import * as THREE from "three";
import { BOB, FLOAT, cycleHz, motionFor, type Motion } from "@/lib/mass-battle/gait";
import { figureSize } from "@/lib/mass-battle/stats";
import type { MBSpecies } from "@/lib/mass-battle/types";
import type { SpeciesAsset } from "./assets";

/**
 * The armies: every Pokémon is a solid 3D relief figure of its HOME render
 * (front surface from a depth estimate, a rounded back), lit by the sun.
 * One instanced draw per species and detail level, however many there are:
 * near figures use the detailed relief, far ones coarser reliefs (still 3D,
 * never a flat card). Each frame the figures are placed from the
 * simulation, turned to face the camera (a relief reads best from the
 * front; it turns round to face the way it fights), bob with their gait,
 * lunge when they attack, flash when hit, and when they faint, drop and
 * vanish into a red Poké Ball beam.
 */

/** Seconds a fainted figure takes to drop and be recalled. */
export const RECALL = 0.95;

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
  depth: THREE.InstancedBufferAttribute;
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
  texture: THREE.Texture;
}

const UNIT_KEY = "mb-unit-v1";

/** Places, turns and animates each instance (and its hit flash and recall) in the standard material. */
function unitPatch(m: THREE.MeshStandardMaterial) {
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute vec4 aPose;
attribute vec4 aLook;
attribute float aDepth;
varying float vFlash;
varying float vRecall;
vec3 mbPlace(vec3 p) {
  vec3 q = vec3(p.x * aDepth, p.yz) * aLook.x;
  float cr = cos(aLook.y), sr = sin(aLook.y);
  q = vec3(q.x * cr - q.y * sr, q.x * sr + q.y * cr, q.z);
  float cy = cos(aPose.w), sy = sin(aPose.w);
  return vec3(q.x * cy + q.z * sy, q.y, -q.x * sy + q.z * cy) + aPose.xyz;
}
vec3 mbTurn(vec3 n) {
  n = normalize(vec3(n.x / max(aDepth, 0.05), n.y, n.z));
  float cr = cos(aLook.y), sr = sin(aLook.y);
  n = vec3(n.x * cr - n.y * sr, n.x * sr + n.y * cr, n.z);
  float cy = cos(aPose.w), sy = sin(aPose.w);
  return vec3(n.x * cy + n.z * sy, n.y, -n.x * sy + n.z * cy);
}`
      )
      .replace("#include <beginnormal_vertex>", "vec3 objectNormal = mbTurn(vec3(normal));\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(tangent.xyz);\n#endif")
      .replace("#include <begin_vertex>", "vec3 transformed = mbPlace(position);\nvFlash = aLook.z;\nvRecall = aLook.w;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vFlash;\nvarying float vRecall;")
      .replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.16, 0.2), clamp(vRecall * 1.4, 0.0, 0.85));")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.95, 0.85) * vFlash * 0.7 + vec3(1.0, 0.12, 0.16) * vRecall * 1.6;");
  };
  m.customProgramCacheKey = () => UNIT_KEY;
}

/** The blob of shade under each figure. */
function shadowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uStrength: { value: 0.5 } },
    vertexShader: `
attribute vec4 aShade;
varying vec2 vUv;
varying float vA;
void main() {
  vUv = uv;
  vA = aShade.w;
  vec3 p = vec3(position.x * aShade.z, 0.0, position.y * aShade.z * 0.8) + vec3(aShade.x, 0.02, aShade.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`,
    fragmentShader: `
uniform float uStrength;
varying vec2 vUv;
varying float vA;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.15, d) * uStrength * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(0.02, 0.03, 0.05, a);
}`,
  });
}

export interface UnitsOptions {
  /** Projected heights (px) above which the more detailed levels are used (one fewer than the levels). */
  lodPx: number[];
  anisotropy: number;
}

export class UnitsLayer {
  readonly group = new THREE.Group();
  private draws: SpeciesDraw[] = [];
  private shadow: { mesh: THREE.Mesh; attr: THREE.InstancedBufferAttribute; geo: THREE.InstancedBufferGeometry; mat: THREE.ShaderMaterial };
  private phase: Float32Array;
  private speed: Float32Array;
  private lastX: Float32Array;
  private lastZ: Float32Array;
  private flip: Float32Array;
  private frustum = new THREE.Frustum();
  private projScreen = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  private camRight = new THREE.Vector3();
  opts: UnitsOptions;
  /** Debugging: one unit's per-frame values. */
  debugUnit = -1;
  debugLog: { t: number; roll: number; yaw: number; flip: number; scale: number; y: number; recall: number; li: number }[] = [];
  /** Triangles and instances drawn last frame (for the stats overlay and tests). */
  drawn = { instances: 0, triangles: 0, calls: 0 };

  constructor(species: MBSpecies[], assets: Map<number, SpeciesAsset>, view: Pick<UnitsView, "n" | "sp" | "draw">, opts: UnitsOptions) {
    this.opts = opts;
    const counts = new Array(species.length).fill(0);
    for (let i = 0; i < view.n; i++) if (view.draw[i]) counts[view.sp[i]]++;
    species.forEach((s, k) => {
      const asset = assets.get(s.id);
      if (!asset) throw new Error(`no figure for ${s.name}`);
      const tex = new THREE.Texture(asset.art as unknown as HTMLImageElement);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false;
      tex.anisotropy = opts.anisotropy;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.needsUpdate = true;
      const material = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.62, metalness: 0, side: THREE.FrontSide });
      unitPatch(material);
      const size = figureSize(s);
      const cap = Math.max(1, counts[k]);
      const levels: Level[] = asset.levels.map((lv) => {
        const geo = new THREE.InstancedBufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(lv.position, 3));
        geo.setAttribute("normal", new THREE.BufferAttribute(lv.normal, 3));
        geo.setAttribute("uv", new THREE.BufferAttribute(lv.uv, 2));
        geo.setIndex(new THREE.BufferAttribute(lv.index, 1));
        const pose = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
        const look = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
        pose.setUsage(THREE.DynamicDrawUsage);
        look.setUsage(THREE.DynamicDrawUsage);
        const depth = new THREE.InstancedBufferAttribute(new Float32Array(cap).fill(1), 1);
        depth.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute("aPose", pose);
        geo.setAttribute("aLook", look);
        geo.setAttribute("aDepth", depth);
        geo.instanceCount = 0;
        const mesh = new THREE.Mesh(geo, material);
        mesh.frustumCulled = false;
        mesh.name = `${s.slug}-lod`;
        this.group.add(mesh);
        return { geo, mesh, pose, look, depth, count: 0, triangles: lv.triangles };
      });
      this.draws.push({
        species: s,
        motion: motionFor(s),
        w: size.w,
        h: size.h,
        scale: asset.levels.map((lv) => size.h / Math.max(1e-6, lv.height)),
        levels,
        material,
        texture: tex,
      });
    });
    // Shade blobs for every figure, one draw.
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
    for (let i = 0; i < view.n; i++) this.phase[i] = ((i * 2654435761) % 1000) / 1000 * Math.PI * 2;
    this.speed = new Float32Array(view.n);
    this.lastX = new Float32Array(view.n).fill(NaN);
    this.lastZ = new Float32Array(view.n).fill(NaN);
    this.flip = new Float32Array(view.n);
  }

  /** Every material, for compiling before the battle starts. */
  materials(): THREE.Material[] {
    return [...this.draws.map((d) => d.material), this.shadow.mat];
  }

  textures(): THREE.Texture[] {
    return this.draws.map((d) => d.texture);
  }

  /** Lays out this frame's instances. `dt` is real seconds (for smoothing), `view.t` the battle clock. */
  update(view: UnitsView, camera: THREE.PerspectiveCamera, viewportH: number, dt: number) {
    const { n, sp, x, z, draw } = view;
    const t = view.t;
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
    for (let i = 0; i < n; i++) {
      if (!draw[i]) continue;
      const fa = view.faintAt[i];
      const age = fa >= 0 ? t - fa : -1;
      if (age >= RECALL) continue;
      const d = this.draws[sp[i]];
      const xi = x[i], zi = z[i];
      // Speed (for the gait), smoothed.
      let v = 0;
      if (!Number.isNaN(this.lastX[i]) && dt > 0) v = Math.min(30, Math.hypot(xi - this.lastX[i], zi - this.lastZ[i]) / Math.max(dt, 1e-3));
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
      // Gait.
      const hz = cycleHz(d.motion, sv, h, d.species.shape);
      this.phase[i] += hz * dt * Math.PI * 2;
      const stride = Math.min(1, sv / 4);
      let y = FLOAT[d.motion] * h + Math.abs(Math.sin(this.phase[i])) * BOB[d.motion] * h * (d.motion === "hover" ? 1 : stride);
      if (d.motion === "hover" || d.motion === "fly") y += Math.sin(t * 1.7 + i) * 0.03 * h;
      // A positive roll tilts the figure toward its foe (it faces the foe on screen, flipped or not).
      // Lean into the run.
      let roll = Math.min(0.16, sv * 0.02);
      let ox = 0, oz = 0;
      // Lunge at the foe on an attack.
      const aa = t - view.attackAt[i];
      if (view.attackAt[i] >= 0 && aa >= 0 && aa < 0.32 && !Number.isNaN(fx)) {
        const k = Math.sin((aa / 0.32) * Math.PI) * Math.min(1.2, d.w * 0.35 + 0.15);
        const dd = Math.hypot(fx - xi, fz - zi) || 1;
        ox = ((fx - xi) / dd) * k;
        oz = ((fz - zi) / dd) * k;
        roll += 0.2 * Math.sin((aa / 0.32) * Math.PI);
      }
      // Hit: a flash and a flinch.
      const ha = t - view.hitAt[i];
      let flash = 0;
      if (view.hitAt[i] >= 0 && ha >= 0 && ha < 0.3) {
        const k = 1 - ha / 0.3;
        flash = k * Math.min(1, 0.06 + view.hitPower[i] * 3);
        roll -= 0.22 * k * Math.min(1, 0.3 + view.hitPower[i] * 4);
      }
      let scale = d.scale[li];
      let recall = 0;
      if (age >= 0) {
        // Faint: drop and tip over, then the red recall beam takes it.
        const drop = Math.min(1, age / 0.25);
        y = Math.max(0, y * (1 - drop));
        roll -= 0.9 * drop;
        recall = Math.min(1, Math.max(0, (age - 0.15) / 0.35));
        const shrink = Math.max(0, (age - 0.4) / (RECALL - 0.4));
        scale *= Math.max(0.001, 1 - shrink * shrink);
        y += h * 0.35 * shrink;
        flash = 0;
      }
      // The turn: the figure narrows to nothing and opens out facing the other way (a relief never shows its edge).
      const f = this.flip[i];
      const yaw = Math.atan2(cx - xi, cz - zi) + (f < 0.5 ? 0 : Math.PI);
      const squeeze = Math.abs(Math.cos(f * Math.PI));
      const o = lv.count * 4;
      const pose = lv.pose.array as Float32Array, look = lv.look.array as Float32Array;
      pose[o] = xi + ox;
      pose[o + 1] = y;
      pose[o + 2] = zi + oz;
      pose[o + 3] = yaw;
      look[o] = scale;
      look[o + 1] = roll;
      look[o + 2] = flash;
      look[o + 3] = recall;
      (lv.depth.array as Float32Array)[lv.count] = squeeze;
      if (this.debugUnit === i) this.debugLog.push({ t: view.t, roll, yaw, flip: this.flip[i], scale, y, recall, li });
      void squeeze;
      lv.count++;
      instances++;
      triangles += lv.triangles;
      if (age < 0) {
        const so = shades * 4;
        shadeArr[so] = xi + ox;
        shadeArr[so + 1] = zi + oz;
        shadeArr[so + 2] = Math.max(0.15, d.w * 0.55);
        shadeArr[so + 3] = Math.max(0.25, 1 - y / Math.max(0.1, h) * 0.8);
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
          lv.pose.clearUpdateRanges();
          lv.pose.addUpdateRange(0, lv.count * 4);
          lv.pose.needsUpdate = true;
          lv.look.clearUpdateRanges();
          lv.look.addUpdateRange(0, lv.count * 4);
          lv.look.needsUpdate = true;
          lv.depth.clearUpdateRanges();
          lv.depth.addUpdateRange(0, lv.count);
          lv.depth.needsUpdate = true;
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
        const pose = lv.pose.array as Float32Array, look = lv.look.array as Float32Array;
        pose.set([at.x, 0, at.z, 0], 0);
        look.set([d.scale[0] * 0.001, 0, 0, 0], 0);
        (lv.depth.array as Float32Array)[0] = 1;
        lv.depth.needsUpdate = true;
        lv.geo.instanceCount = 1;
        lv.mesh.visible = true;
        lv.pose.needsUpdate = true;
        lv.look.needsUpdate = true;
      }
    }
  }

  dispose() {
    for (const d of this.draws) {
      for (const lv of d.levels) lv.geo.dispose();
      d.material.dispose();
      d.texture.dispose();
    }
    this.shadow.geo.dispose();
    this.shadow.mat.dispose();
  }
}
