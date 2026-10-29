import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { BALLS, HAIR_BANGS, colorHex, eyeHex, hairHex, skinHex, type TrainerConfig, type TrainerFacing, type TrainerPose } from "@/lib/trainer/config";
import { drawEmblem, faceTexture } from "./faces";
import { MOVES } from "./moves";
import type { TauntId } from "@/lib/trainer/taunts";

/**
 * The chibi trainer, built from three.js primitives (no downloaded models,
 * so nothing to license and nothing to load): a big round head with a
 * drawn face, a small body, swappable hair, hats, clothes, capes, bags and
 * accessories, and our own Poké Ball in the right hand. Toon shading with
 * soft outlines (an inverted hull pushed out in view space). Poses are
 * joint angles blended every frame.
 *
 * Units: the trainer is about 2.2 tall, feet on y = 0, facing +z.
 */

export interface TrainerModel {
  root: THREE.Group;
  /**
   * Advances the animation to time `t` (seconds), easing towards `pose`, or
   * towards a taunt (a dance or emote) `act.t` seconds in.
   */
  update(t: number, dt: number, pose: TrainerPose, act?: TauntAct | null): void;
  dispose(): void;
}

/** A taunt being played: which, and how far in (seconds). */
export interface TauntAct {
  id: TauntId;
  t: number;
}

const HEAD_R = 0.46;
const HEAD_Y = 0.38; // head centre above the neck pivot
const TAU = Math.PI * 2;
type V3 = [number, number, number];

// ---------------------------------------------------------------------------
// Materials and helpers
// ---------------------------------------------------------------------------

let toonRamp: THREE.DataTexture | null = null;
/** Three soft bands of light (shared by every trainer, never disposed). */
function ramp(): THREE.DataTexture {
  if (toonRamp) return toonRamp;
  const data = new Uint8Array([120, 120, 120, 255, 196, 196, 196, 255, 255, 255, 255, 255]);
  toonRamp = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  toonRamp.minFilter = toonRamp.magFilter = THREE.NearestFilter;
  toonRamp.generateMipmaps = false;
  toonRamp.needsUpdate = true;
  return toonRamp;
}

const OUTLINE_VS = `uniform float width;
void main() {
  vec3 n = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  mv.xyz += n * width * -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const OUTLINE_FS = `uniform vec3 color;
void main() { gl_FragColor = vec4(color, 1.0); }`;

interface MeshOpts {
  /** Skip the outline (tiny parts, open shells, decals). */
  bare?: boolean;
}

class Kit {
  private mats = new Map<string, THREE.Material>();
  private lines = new Map<string, THREE.ShaderMaterial>();
  private geos: THREE.BufferGeometry[] = [];
  private texs: THREE.Texture[] = [];
  private extra: THREE.Material[] = [];

  mat(hex: string, extra?: THREE.MeshToonMaterialParameters & { key?: string }): THREE.MeshToonMaterial {
    const key = `${hex}:${extra?.key ?? ""}:${extra?.side ?? ""}:${extra?.transparent ?? ""}`;
    let m = this.mats.get(key) as THREE.MeshToonMaterial | undefined;
    if (!m) {
      const { key: _k, ...params } = extra ?? {};
      void _k;
      m = new THREE.MeshToonMaterial({ color: new THREE.Color(hex), gradientMap: ramp(), ...params });
      m.userData.hex = hex;
      this.mats.set(key, m);
    }
    return m;
  }

  /** A soft outline: the part's own colour, much darker. */
  line(hex: string): THREE.ShaderMaterial {
    let m = this.lines.get(hex);
    if (!m) {
      const c = new THREE.Color(hex).lerp(new THREE.Color("#140d18"), 0.72);
      m = new THREE.ShaderMaterial({ uniforms: { color: { value: c }, width: { value: 0.0026 } }, vertexShader: OUTLINE_VS, fragmentShader: OUTLINE_FS, side: THREE.BackSide });
      this.lines.set(hex, m);
    }
    return m;
  }

  geo<G extends THREE.BufferGeometry>(g: G): G {
    this.geos.push(g);
    return g;
  }

  tex<T extends THREE.Texture>(t: T): T {
    this.texs.push(t);
    return t;
  }

  /** A one-off material, disposed with the rest. */
  own<M extends THREE.Material>(m: M): M {
    this.extra.push(m);
    return m;
  }

  mesh(g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, pos?: V3, rot?: V3, scale?: V3 | number, opts?: MeshOpts): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geo(g), m);
    if (pos) mesh.position.set(...pos);
    if (rot) mesh.rotation.set(...rot);
    if (typeof scale === "number") mesh.scale.setScalar(scale);
    else if (scale) mesh.scale.set(...scale);
    parent.add(mesh);
    const hex = m.userData.hex as string | undefined;
    if (hex && !opts?.bare && m.side !== THREE.DoubleSide && !m.transparent) mesh.add(new THREE.Mesh(g, this.line(hex)));
    return mesh;
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats.values()) m.dispose();
    for (const m of this.lines.values()) m.dispose();
    for (const t of this.texs) t.dispose();
    for (const m of this.extra) m.dispose();
  }
}

const group = (parent: THREE.Object3D, pos: V3 = [0, 0, 0], rot?: V3) => {
  const g = new THREE.Group();
  g.position.set(...pos);
  if (rot) g.rotation.set(...rot);
  parent.add(g);
  return g;
};

/** A colour a step lighter or darker (for trims and soles). */
function shade(hex: string, amount: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amount)));
  return `#${c.getHexString()}`;
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// Lathe profiles: [radius, y] from the bottom up.
const lathe = (points: [number, number][], phiStart = 0, phiLength = TAU, segments = 40) =>
  new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
    phiStart,
    phiLength,
  );

/**
 * A tube along a smooth curve whose thickness follows `radius(t)` (t from
 * 0 at the root to 1 at the tip): hair locks, spikes, tails and ribbons.
 * `flat` squashes it towards `from` (locks lie flat on the head).
 */
function taper(points: THREE.Vector3[], radius: (t: number) => number, opts: { flat?: number; from?: THREE.Vector3; seg?: number; radial?: number } = {}): THREE.BufferGeometry {
  const seg = opts.seg ?? 18;
  const radial = opts.radial ?? 10;
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
  const geo = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const c = new THREE.Vector3();
  const f = new THREE.Vector3();
  const flat = opts.flat ?? 1;
  for (let i = 0; i <= seg; i++) {
    curve.getPointAt(i / seg, c);
    const r = Math.max(0.002, radius(i / seg));
    if (opts.from) f.copy(c).sub(opts.from).normalize();
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      p.fromBufferAttribute(pos, k).sub(c);
      n.fromBufferAttribute(nor, k);
      if (flat !== 1 && opts.from) {
        p.addScaledVector(f, -(1 - flat) * p.dot(f));
        n.addScaledVector(f, (1 / flat - 1) * n.dot(f)).normalize();
      }
      p.multiplyScalar(r).add(c);
      pos.setXYZ(k, p.x, p.y, p.z);
      nor.setXYZ(k, n.x, n.y, n.z);
    }
  }
  return geo;
}

/** Thick at the root, a point at the tip. */
const spike = (r0: number, tip = 0.05) => (t: number) => r0 * (1 - t * (1 - tip)) * (t < 0.15 ? 0.75 + (t / 0.15) * 0.25 : 1);
/** A lock that swells a little then thins to a point. */
const lockR = (r0: number) => (t: number) => r0 * Math.sin(Math.min(1, 0.25 + t * 0.95) * Math.PI) * (1 - t * 0.35) + 0.004;

// ---------------------------------------------------------------------------
// The Poké Ball (ours: red and white halves, black band, button)
// ---------------------------------------------------------------------------

function buildBall(kit: Kit, kind: TrainerConfig["ball"], r = 0.12, outline = true): THREE.Group {
  const ball = new THREE.Group();
  const look = BALLS.find((b) => b.id === kind) ?? BALLS[0];
  const o = { bare: !outline };
  const bare = { bare: true };
  const premier = kind === "premier";
  const band = premier ? "#d8262f" : kind === "luxury" ? "#e0b33a" : "#1b1b1f";
  kit.mesh(new THREE.SphereGeometry(r, 28, 14, 0, TAU, 0, Math.PI / 2), kit.mat(look.top), ball, undefined, undefined, undefined, o);
  kit.mesh(new THREE.SphereGeometry(r, 28, 14, 0, TAU, Math.PI / 2, Math.PI / 2), kit.mat(look.bottom), ball, undefined, undefined, undefined, o);
  kit.mesh(new THREE.CylinderGeometry(r * 1.012, r * 1.012, r * 0.16, 28), kit.mat(band), ball, undefined, undefined, undefined, bare);
  // The button faces +z.
  kit.mesh(new THREE.CylinderGeometry(r * 0.34, r * 0.34, r * 0.16, 20), kit.mat(premier ? "#d8262f" : kind === "luxury" ? "#e0b33a" : "#1b1b1f"), ball, [0, 0, r * 0.96], [Math.PI / 2, 0, 0], undefined, bare);
  kit.mesh(new THREE.CylinderGeometry(r * 0.22, r * 0.22, r * 0.2, 20), kit.mat("#ffffff"), ball, [0, 0, r * 1.0], [Math.PI / 2, 0, 0], undefined, bare);
  /** A ring round the ball at height y (a fraction of r). */
  const ring = (y: number, hex: string, w = 0.07) => kit.mesh(new THREE.TorusGeometry(r * Math.sqrt(1 - y * y) * 1.005, r * w, 6, 32), kit.mat(hex), ball, [0, r * y, 0], [Math.PI / 2, 0, 0], undefined, bare);
  /** An arc over the top, from the band up and down the other side, turned by `yaw`. */
  const arc = (yaw: number, hex: string, w = 0.08, span = Math.PI) => kit.mesh(new THREE.TorusGeometry(r * 1.004, r * w, 6, 28, span), kit.mat(hex), ball, undefined, [0, yaw, (Math.PI - span) / 2], undefined, bare);
  /** A flat spot on the surface, at polar angle `pol` from the top and azimuth `az` from the button. */
  const spot = (pol: number, az: number, size: number, hex: string) => {
    const m = kit.mesh(new THREE.SphereGeometry(r * size, 12, 8), kit.mat(hex), ball, [r * Math.sin(pol) * Math.sin(az) * 0.93, r * Math.cos(pol) * 0.93, r * Math.sin(pol) * Math.cos(az) * 0.93], undefined, [1, 0.32, 1], bare);
    m.rotation.set(pol, az, 0, "YXZ");
  };
  switch (kind) {
    case "great":
      for (const s of [-1, 1]) kit.mesh(new THREE.SphereGeometry(r * 0.42, 14, 8), kit.mat("#e3262f"), ball, [s * r * 0.62, r * 0.55, 0], [0, 0, s * 0.9], [0.55, 0.35, 1], bare);
      break;
    case "ultra":
      for (const s of [-1, 1]) kit.mesh(new THREE.TorusGeometry(r * 1.0, r * 0.1, 8, 24, Math.PI / 2.3), kit.mat("#f2c230"), ball, [s * r * 0.45, 0, 0], [0, Math.PI / 2, Math.PI / 2 - 0.2 + (s > 0 ? 0.4 : 0)], undefined, bare);
      break;
    case "master":
      for (const s of [-1, 1]) kit.mesh(new THREE.SphereGeometry(r * 0.26, 14, 8), kit.mat("#ef6fb0"), ball, [s * r * 0.62, r * 0.66, r * 0.25], undefined, undefined, bare);
      kit.mesh(new THREE.TorusGeometry(r * 0.22, r * 0.05, 6, 16, Math.PI), kit.mat("#ffffff"), ball, [0, r * 0.6, r * 0.8], [-0.6, 0, 0], undefined, bare);
      break;
    case "heal":
      ring(0.5, "#ffd0e4", 0.09);
      break;
    case "quick":
      // Yellow bands crossing over the blue top.
      arc(0, "#f5d132", 0.13);
      arc(Math.PI / 2, "#f5d132", 0.13);
      break;
    case "timer":
      arc(Math.PI / 4, "#d8262f", 0.1);
      arc(-Math.PI / 4, "#d8262f", 0.1);
      ring(0.82, "#1b1b1f", 0.06);
      break;
    case "dusk":
      ring(0.42, "#5bc04d", 0.08);
      arc(0, "#5bc04d", 0.06);
      break;
    case "luxury":
      ring(0.5, "#d8262f", 0.12);
      ring(0.24, "#e0b33a", 0.04);
      break;
    case "love":
      // A heart on the top half, over the button.
      for (const s of [-1, 1]) spot(0.5, s * 0.24, 0.24, "#e8336f");
      kit.mesh(new THREE.ConeGeometry(r * 0.36, r * 0.38, 3), kit.mat("#e8336f"), ball, [0, r * 0.6, r * 0.78], [Math.PI - 0.9, 0, 0], [1, 1, 0.35], bare);
      break;
    case "safari":
      for (const [pol, az, size] of [[0.4, 0.3, 0.3], [0.9, 2.2, 0.32], [1.05, -1.6, 0.3], [0.3, 3.6, 0.26], [1.15, 0.7, 0.22], [1.0, 4.4, 0.24]] as const) spot(pol, az, size, "#4e6b2a");
      break;
    case "beast":
      ring(0.55, "#f2c230", 0.05);
      ring(-0.55, "#f2c230", 0.05);
      arc(Math.PI / 2, "#f2c230", 0.05, TAU);
      break;
    case "cherish":
      ring(0.5, "#f27b7b", 0.06);
      ring(0.78, "#f27b7b", 0.05);
      for (const az of [0.9, -0.9, Math.PI]) spot(0.95, az, 0.16, "#f27b7b");
      break;
  }
  return ball;
}

// ---------------------------------------------------------------------------
// The trainer
// ---------------------------------------------------------------------------

type Sleeve = "none" | "short" | "long";
interface TopSpec {
  /** The torso's own layer (shirt) colour. */
  inner: string;
  /** Bare midriff below this height (crop tops). */
  crop?: number;
  /** Outer shell: front gap (radians), extension below the waist, flare. */
  shell?: { gap: number; extend?: number; flare?: number; hemGap?: number };
  sleeves: Sleeve;
  sleeve: string;
  cuff?: string;
  collar?: "ring" | "stand" | "points" | "lapels" | "fur" | "hood" | "none";
  emblem?: boolean;
  belt: boolean;
}

export function buildTrainer(cfg: TrainerConfig): TrainerModel {
  const kit = new Kit();
  const skin = skinHex(cfg.skin);
  const hairC = hairHex(cfg.hairColor);
  const top = colorHex(cfg.topColor);
  const topTrim = colorHex(cfg.topTrim);
  const accent = colorHex(cfg.accent);
  const bottomsC = colorHex(cfg.bottomsColor);
  const bottomsTrim = colorHex(cfg.bottomsTrim);
  const shoesC = colorHex(cfg.shoesColor);
  const shoesTrim = colorHex(cfg.shoesTrim);
  const glovesC = colorHex(cfg.glovesColor);
  const packC = colorHex(cfg.packColor);
  const packTrim = colorHex(cfg.packTrim);
  const accC = colorHex(cfg.accColor);
  const slim = cfg.body === "slim";

  const mSkin = kit.mat(skin);
  const mHair = kit.mat(hairC);
  const mTop = kit.mat(top);
  const mTopTrim = kit.mat(topTrim);
  const mAccent = kit.mat(accent);
  const mBottoms = kit.mat(bottomsC);
  const mDark = kit.mat("#2b2a30");
  const mGold = kit.mat("#d9b54a");
  const mAcc = kit.mat(accC);

  const root = new THREE.Group();
  const body = group(root);
  const hips = group(body, [0, 0.52, 0]);
  const torso = group(hips, [0, 0.12, 0]);
  const neck = group(torso, [0, 0.5, 0]);
  const head = group(neck);

  // ---- the top ----
  const w = slim ? 0.93 : 1;
  const torsoProfile: [number, number][] = [
    [0.255 * (slim ? 0.97 : 1), 0],
    [0.27 * (slim ? 0.96 : 1), 0.08],
    [0.285 * w, 0.24],
    [0.272 * w, 0.36],
    [0.232 * w, 0.44],
    [0.14, 0.5],
    [0.001, 0.53],
  ];
  const flat: V3 = [1, 1, 0.82];
  const open = !cfg.closed;
  const spec = topSpec(cfg, top, topTrim, accent, open);
  // The body itself, split at the crop line (skin below it).
  const cut = spec.crop ?? 0;
  const upper = torsoProfile.filter(([, y]) => y > cut);
  kit.mesh(lathe([[cut ? 0.27 * w : torsoProfile[0][0], cut], ...upper]), kit.mat(spec.inner), torso, undefined, undefined, flat);
  if (cut) kit.mesh(lathe([...torsoProfile.filter(([, y]) => y < cut), [0.27 * w, cut + 0.005]]), mSkin, torso, undefined, undefined, flat);

  if (spec.shell) {
    const { gap, extend = 0, flare = 0, hemGap } = spec.shell;
    const pts = torsoProfile.slice(0, -1).map(([r, y]) => [r + 0.02, y] as [number, number]);
    const shellMat = kit.mat(top, { side: THREE.DoubleSide });
    kit.mesh(lathe(pts, gap, TAU - gap * 2), shellMat, torso, [0, -0.005, 0], undefined, [1, 1, 0.84]);
    if (extend) {
      // Coat tails: a flared skirt below the waist, open at the front.
      const g = hemGap ?? gap;
      const tail = lathe(
        [
          [0.3 + flare, -extend],
          [0.29 + flare * 0.6, -extend * 0.6],
          [0.285, -extend * 0.25],
          [0.28, 0.02],
        ],
        g,
        TAU - g * 2,
      );
      kit.mesh(tail, shellMat, torso, undefined, undefined, [1, 1, 0.84]);
      if (cfg.top === "longcoat") kit.mesh(new THREE.TorusGeometry(0.31 + flare, 0.035, 8, 40, TAU - g * 2), mTopTrim, torso, [0, -extend, 0], [Math.PI / 2, 0, Math.PI / 2 - (TAU - g * 2) / 2 + Math.PI], [1, 0.84, 1]);
    }
    if (!open || cfg.top === "suit") {
      // Done up: a zip or a row of buttons down the front.
      const zip = cfg.top === "jacket" || cfg.top === "vest" || cfg.top === "hoodie";
      if (zip) kit.mesh(new THREE.BoxGeometry(0.016, 0.42, 0.016), kit.mat(shade(top, 0.14)), torso, [0, 0.22, 0.244], [-0.05, 0, 0], undefined, { bare: true });
    }
    // Edges of the opening.
    if (open && (cfg.top === "jacket" || cfg.top === "coat" || cfg.top === "labcoat" || cfg.top === "shirt")) {
      for (const s of [-1, 1]) kit.mesh(new THREE.BoxGeometry(0.022, 0.42, 0.022), cfg.top === "jacket" ? mTopTrim : kit.mat(shade(top, -0.06)), torso, [s * Math.sin(gap) * 0.3, 0.23, Math.cos(gap) * 0.25], [-0.05, 0, s * 0.04], undefined, { bare: true });
    }
  }

  // Collars.
  const shirtCollar = (mat: THREE.Material, spread = 0.07) => {
    for (const s of [-1, 1]) {
      const c = kit.mesh(new THREE.ConeGeometry(0.075, 0.13, 3), mat, torso, [s * spread, 0.455, 0.15], [0.5, 0, s * 2.4], [1, 1, 0.4]);
      c.rotateY(s * 0.4);
    }
  };
  switch (spec.collar) {
    case "ring":
      kit.mesh(new THREE.TorusGeometry(0.125, 0.022, 8, 24), mTopTrim, torso, [0, 0.47, 0.01], [Math.PI / 2 - 0.2, 0, 0], [1, 0.8, 1], { bare: true });
      break;
    case "stand":
      kit.mesh(new THREE.TorusGeometry(0.15, 0.045, 10, 24, Math.PI * 1.4), mTopTrim, torso, [0, 0.46, -0.01], [Math.PI / 2 - 0.25, 0, Math.PI * 0.8], [1, 0.82, 1]);
      break;
    case "points":
      kit.mesh(new THREE.TorusGeometry(0.135, 0.03, 8, 24, Math.PI * 1.3), cfg.top === "labcoat" ? mAccent : mTop, torso, [0, 0.465, -0.01], [Math.PI / 2 - 0.25, 0, Math.PI * 0.85], [1, 0.82, 1]);
      shirtCollar(cfg.top === "labcoat" ? mAccent : mTop);
      break;
    case "lapels": {
      shirtCollar(mAccent, 0.05);
      const lapel = kit.mat(shade(top, cfg.top === "labcoat" ? -0.04 : -0.07));
      for (const s of [-1, 1]) {
        kit.mesh(new THREE.BoxGeometry(0.075, 0.26, 0.02), lapel, torso, [s * 0.1, 0.36, 0.228], [-0.32, s * 0.35, s * -0.32]);
        if (cfg.top === "suit") kit.mesh(new THREE.SphereGeometry(0.018, 10, 8), kit.mat(topTrim), torso, [s * 0.13, 0.36, 0.25], undefined, undefined, { bare: true });
      }
      break;
    }
    case "fur":
      kit.mesh(new THREE.TorusGeometry(0.16, 0.06, 10, 26), mTopTrim, torso, [0, 0.45, -0.005], [Math.PI / 2 - 0.25, 0, 0], [1, 0.84, 1]);
      // The V of the neckline.
      kit.mesh(new THREE.ConeGeometry(0.07, 0.16, 3), mAccent, torso, [0, 0.38, 0.215], [Math.PI, 0, 0], [1, 1, 0.3], { bare: true });
      break;
    case "hood":
      kit.mesh(new THREE.TorusGeometry(0.17, 0.075, 12, 24), mTop, torso, [0, 0.47, -0.1], [Math.PI / 2 - 0.5, 0, 0], [1, 0.9, 1]);
      for (const s of [-1, 1]) kit.mesh(new THREE.CapsuleGeometry(0.011, 0.1, 4, 8), kit.mat("#f4f4f0"), torso, [s * 0.05, 0.36, 0.232], [0.2, 0, 0], undefined, { bare: true });
      break;
  }

  // Details per top.
  const front = (x: number) => ({ x, z: Math.sqrt(Math.max(0, (0.28 * w) ** 2 - x * x)) * 0.82 + 0.01 });
  if (cfg.top === "longtee" && topTrim !== top)
    for (const s of [-1, 1]) {
      kit.mesh(new THREE.BoxGeometry(0.018, 0.4, 0.018), mTopTrim, torso, [s * 0.1, 0.25, front(0.1).z + 0.012], [-0.1, 0, s * 0.12], undefined, { bare: true });
      kit.mesh(new THREE.BoxGeometry(0.15, 0.018, 0.018), mTopTrim, torso, [s * 0.17, 0.43, front(0.17).z - 0.03], [-0.5, s * -0.55, s * -0.35], undefined, { bare: true });
    }
  if (cfg.top === "hoodie") kit.mesh(new RoundedBoxGeometry(0.3, 0.12, 0.06, 3, 0.03), kit.mat(shade(top, -0.06)), torso, [0, 0.12, 0.215], [0.12, 0, 0]);
  if (cfg.top === "track") kit.mesh(new THREE.BoxGeometry(0.018, 0.4, 0.02), mAccent, torso, [0, 0.24, 0.232], [-0.06, 0, 0], undefined, { bare: true });
  if (cfg.top === "vest") for (const s of [-1, 1]) kit.mesh(new RoundedBoxGeometry(0.1, 0.08, 0.04, 2, 0.015), kit.mat(shade(top, -0.08)), torso, [s * 0.15, 0.12, 0.2], [0.05, s * 0.45, 0]);
  if (cfg.top === "labcoat") for (const s of [-1, 1]) kit.mesh(new RoundedBoxGeometry(0.11, 0.1, 0.03, 2, 0.012), kit.mat(shade(top, -0.04)), torso, [s * 0.2, -0.12, 0.23], [0, s * 0.35, 0]);
  if (cfg.top === "shirt" && !open) for (const y of [0.34, 0.24, 0.14]) kit.mesh(new THREE.SphereGeometry(0.012, 8, 6), mTopTrim, torso, [0, y, front(0).z], undefined, undefined, { bare: true });
  if (cfg.top === "suit" || cfg.top === "labcoat") for (const y of [0.14, 0.04]) kit.mesh(new THREE.SphereGeometry(0.016, 8, 6), kit.mat(shade(top, -0.2)), torso, [0.075, y, 0.238], undefined, undefined, { bare: true });
  if (cfg.top === "dress") {
    const skirt = kit.mat(top, { side: THREE.DoubleSide });
    kit.mesh(new THREE.CylinderGeometry(0.262, 0.42, 0.36, 32, 1, true), skirt, hips, [0, -0.12, 0], undefined, [1, 1, 0.86]);
    kit.mesh(new THREE.TorusGeometry(0.42, 0.018, 6, 40), mTopTrim, hips, [0, -0.3, 0], [Math.PI / 2, 0, 0], [1, 0.86, 1], { bare: true });
  }
  if (spec.emblem && cfg.emblem !== "none") {
    const big = cfg.top === "uniform";
    const size = big ? 0.2 : 0.11;
    const tex = kit.tex(new THREE.CanvasTexture(drawEmblem(cfg.emblem, topTrim, top)));
    tex.colorSpace = THREE.SRGBColorSpace;
    const r = 0.287 * w;
    const arc = size / r;
    const decal = new THREE.CylinderGeometry(r, r, size, 16, 1, true, big ? -arc / 2 : -0.55 - arc / 2, arc);
    const y = big ? 0.32 : 0.34;
    kit.mesh(decal, kit.mat("#ffffff", { map: tex, transparent: true, depthWrite: false, key: "emblem" }), torso, [0, y, 0], undefined, [1, 1, 0.84], { bare: true });
  }

  // ---- belt with Poké Balls ----
  if (spec.belt) {
    kit.mesh(new THREE.TorusGeometry(0.265 * (slim ? 0.97 : 1), 0.03, 10, 40), mDark, torso, [0, 0.035, 0], [Math.PI / 2, 0, 0], [1, 0.82, 1]);
    kit.mesh(new RoundedBoxGeometry(0.08, 0.06, 0.03, 2, 0.01), mGold, torso, [0, 0.035, 0.224], undefined, undefined, { bare: true });
    if (cfg.pack !== "pouch")
      for (const a of [1.15, 1.55, 1.95]) {
        const b = buildBall(kit, "poke", 0.045, false);
        b.position.set(Math.sin(a) * 0.278, 0.03, Math.cos(a) * 0.238);
        b.rotation.y = a;
        torso.add(b);
      }
  }

  // ---- neck and head ----
  kit.mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.12, 16), mSkin, neck, [0, 0.0, 0], undefined, undefined, { bare: true });
  kit.mesh(new THREE.SphereGeometry(HEAD_R, 40, 32), mSkin, head, [0, HEAD_Y, 0], undefined, [1, 0.95, 0.96]);
  for (const s of [-1, 1]) kit.mesh(new THREE.SphereGeometry(0.085, 16, 12), mSkin, head, [s * HEAD_R * 0.97, HEAD_Y - 0.03, 0.0], undefined, [0.55, 1, 0.8]);
  buildFace(kit, head, cfg, skin, hairC);
  const hatCover = cfg.hat === "none" || cfg.hat === "headband" ? 0 : cfg.hat === "visor" ? 0.5 : 1;
  const sway = buildHair(kit, head, cfg, mHair, hatCover);
  if (cfg.hat !== "none") buildHat(kit, head, cfg);
  buildHeadExtras(kit, head, cfg, mAcc, accC);

  // ---- neckwear ----
  buildNeck(kit, torso, cfg, mAcc, accC);

  // ---- arms ----
  const handMat = cfg.gloves === "full" || cfg.gloves === "long" ? kit.mat(glovesC) : mSkin;
  const sleeveMat = kit.mat(spec.sleeve);
  const arms = ([1, -1] as const).map((s) => {
    const shoulder = group(torso, [s * (slim ? 0.27 : 0.285), 0.4, 0]);
    kit.mesh(new THREE.SphereGeometry(0.085, 16, 12), spec.sleeves === "none" ? mSkin : sleeveMat, shoulder);
    kit.mesh(new THREE.CapsuleGeometry(0.068, 0.11, 6, 14), spec.sleeves === "long" ? sleeveMat : mSkin, shoulder, [0, -0.11, 0]);
    if (spec.sleeves === "short") kit.mesh(new THREE.CylinderGeometry(0.088, 0.096, 0.13, 16), sleeveMat, shoulder, [0, -0.05, 0]);
    if (spec.sleeves === "none" && cfg.top !== "croptop" && cfg.top !== "dress") kit.mesh(new THREE.TorusGeometry(0.075, 0.018, 6, 16), kit.mat(spec.inner), shoulder, [0, 0.0, 0], [0, 0, Math.PI / 2], [1, 1.1, 1], { bare: true });
    if (cfg.top === "track") kit.mesh(new THREE.BoxGeometry(0.02, 0.2, 0.03), mAccent, shoulder, [s * 0.068, -0.1, 0], undefined, undefined, { bare: true });
    const elbow = group(shoulder, [0, -0.2, 0]);
    const forearm = cfg.gloves === "long" ? kit.mat(glovesC) : spec.sleeves === "long" ? sleeveMat : mSkin;
    kit.mesh(new THREE.CapsuleGeometry(0.062, 0.1, 6, 14), forearm, elbow, [0, -0.08, 0]);
    if (cfg.top === "track") kit.mesh(new THREE.BoxGeometry(0.02, 0.15, 0.03), mAccent, elbow, [s * 0.062, -0.07, 0], undefined, undefined, { bare: true });
    if (cfg.gloves === "long") kit.mesh(new THREE.CylinderGeometry(0.074, 0.07, 0.05, 16), kit.mat(shade(glovesC, 0.06)), elbow, [0, 0.0, 0]);
    else if (spec.sleeves === "long") kit.mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.045, 16), kit.mat(spec.cuff ?? spec.sleeve), elbow, [0, -0.16, 0]);
    const hand = group(elbow, [0, -0.215, 0]);
    // A mitten with a thumb.
    kit.mesh(new THREE.SphereGeometry(0.08, 18, 14), handMat, hand, [0, -0.012, 0.004], undefined, [0.86, 1.08, 0.74]);
    kit.mesh(new THREE.CapsuleGeometry(0.026, 0.045, 4, 10), handMat, hand, [-s * 0.035, 0.0, 0.05], [0.5, 0, -s * 0.55]);
    if (cfg.gloves === "fingerless") {
      kit.mesh(new THREE.CylinderGeometry(0.08, 0.074, 0.075, 16), kit.mat(glovesC), hand, [0, 0.02, 0]);
      kit.mesh(new THREE.CylinderGeometry(0.073, 0.077, 0.035, 16), mDark, hand, [0, 0.07, 0], undefined, undefined, { bare: true });
    }
    if (cfg.gloves === "full") kit.mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.045, 16), kit.mat(shade(glovesC, -0.08)), hand, [0, 0.07, 0]);
    if (cfg.wrist !== "none" && cfg.gloves !== "long") {
      if (cfg.wrist === "bands") kit.mesh(new THREE.CylinderGeometry(0.074, 0.074, 0.07, 16), mAcc, elbow, [0, -0.16, 0]);
      if (cfg.wrist === "bracelets") for (const y of [-0.15, -0.12]) kit.mesh(new THREE.TorusGeometry(0.068, 0.014, 6, 18), mAcc, elbow, [0, y, 0], [Math.PI / 2, 0, 0], undefined, { bare: true });
      if (cfg.wrist === "watch" && s > 0) {
        kit.mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.04, 16), mDark, elbow, [0, -0.16, 0], undefined, undefined, { bare: true });
        kit.mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 14), mAcc, elbow, [0, -0.16, 0.066], [Math.PI / 2, 0, 0]);
      }
    }
    return { shoulder, elbow, hand };
  });
  const [armL, armR] = arms;

  // ---- hips, legs and shoes ----
  const trunk: [number, number][] = [
    [0.001, -0.08],
    [0.19, -0.07],
    [0.25, -0.02],
    [0.26 * (slim ? 0.97 : 1), 0.08],
    [0.258 * (slim ? 0.97 : 1), 0.15],
  ];
  kit.mesh(lathe(trunk), mBottoms, hips, undefined, undefined, flat);
  if (cfg.bottoms === "skirt" && cfg.top !== "dress") {
    kit.mesh(new THREE.CylinderGeometry(0.262, 0.39, 0.26, 32, 1, true), kit.mat(bottomsC, { side: THREE.DoubleSide }), hips, [0, -0.07, 0], undefined, [1, 1, 0.86]);
    kit.mesh(new THREE.TorusGeometry(0.263, 0.026, 8, 36), kit.mat(shade(bottomsC, -0.06)), hips, [0, 0.05, 0], [Math.PI / 2, 0, 0], [1, 0.86, 1]);
  }
  const covered = cfg.bottoms === "pants" || cfg.bottoms === "joggers" || cfg.bottoms === "flared" || cfg.bottoms === "overalls";
  const shorts = cfg.bottoms === "shorts" || cfg.bottoms === "suspenders";
  const legMat = covered ? mBottoms : cfg.legwear === "tights" ? kit.mat(bottomsTrim) : mSkin;
  const legs = ([1, -1] as const).map((s) => {
    const leg = group(hips, [s * 0.125, 0, 0]);
    kit.mesh(new THREE.CapsuleGeometry(0.092, 0.3, 6, 14), legMat, leg, [0, -0.2, 0]);
    if (shorts) kit.mesh(new THREE.CylinderGeometry(0.118, 0.124, 0.17, 18), mBottoms, leg, [0, -0.07, 0]);
    if (cfg.bottoms === "joggers") {
      kit.mesh(new THREE.CylinderGeometry(0.098, 0.098, 0.05, 18), kit.mat(shade(bottomsC, -0.07)), leg, [0, -0.39, 0]);
      kit.mesh(new THREE.BoxGeometry(0.02, 0.36, 0.03), kit.mat(bottomsTrim), leg, [s * 0.088, -0.2, 0], undefined, undefined, { bare: true });
    }
    if (cfg.bottoms === "flared") kit.mesh(new THREE.CylinderGeometry(0.096, 0.135, 0.18, 18, 1, true), kit.mat(bottomsC, { side: THREE.DoubleSide }), leg, [0, -0.36, 0.01]);
    if (!covered && cfg.legwear !== "none" && cfg.legwear !== "tights") {
      const len = { socks: 0.07, knee: 0.22, thigh: 0.36 }[cfg.legwear];
      kit.mesh(new THREE.CylinderGeometry(0.097, 0.095, len, 18), kit.mat(bottomsTrim), leg, [0, -0.43 + len / 2, 0], undefined, undefined, { bare: true });
    }
    const foot = group(leg, [0, -0.43, 0]);
    buildShoe(kit, foot, cfg, shoesC, shoesTrim);
    return { leg, foot };
  });
  const [legL, legR] = legs;

  // Suspenders and overalls.
  if (cfg.bottoms === "suspenders" || cfg.bottoms === "overalls") {
    const strap = cfg.bottoms === "overalls" ? mBottoms : kit.mat(bottomsTrim);
    if (cfg.bottoms === "overalls") {
      kit.mesh(new RoundedBoxGeometry(0.3, 0.22, 0.05, 3, 0.02), mBottoms, torso, [0, 0.13, 0.215], [-0.04, 0, 0]);
      for (const s of [-1, 1]) kit.mesh(new THREE.SphereGeometry(0.018, 8, 6), kit.mat(bottomsTrim), torso, [s * 0.11, 0.22, 0.245], undefined, undefined, { bare: true });
    }
    for (const s of [-1, 1]) {
      kit.mesh(new THREE.BoxGeometry(0.045, 0.44, 0.02), strap, torso, [s * 0.12, 0.25, 0.236 * w], [-0.12, 0, 0]);
      kit.mesh(new THREE.BoxGeometry(0.045, 0.02, 0.44), strap, torso, [s * 0.13, 0.465, 0.0], [0, 0, 0]);
      kit.mesh(new THREE.BoxGeometry(0.045, 0.44, 0.02), strap, torso, [s * 0.12, 0.25, -0.236 * w], [0.12, 0, 0]);
    }
  }

  // ---- bags ----
  const packDark = kit.mat(shade(packTrim, -0.06));
  const mPack = kit.mat(packC);
  if (cfg.pack === "classic" || cfg.pack === "explorer") {
    const big = cfg.pack === "explorer";
    const pack = group(torso, [0, 0.24, -0.27]);
    kit.mesh(new RoundedBoxGeometry(big ? 0.46 : 0.4, big ? 0.48 : 0.42, big ? 0.24 : 0.18, 4, 0.07), mPack, pack, [0, 0, -0.05]);
    kit.mesh(new RoundedBoxGeometry(big ? 0.44 : 0.38, 0.17, big ? 0.25 : 0.19, 3, 0.06), packDark, pack, [0, 0.14, -0.05]);
    kit.mesh(new RoundedBoxGeometry(0.24, 0.13, 0.06, 3, 0.03), kit.mat(shade(packC, 0.06)), pack, [0, -0.1, big ? -0.19 : -0.16]);
    kit.mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.06, 10), mGold, pack, [0, 0.06, big ? -0.18 : -0.15], [Math.PI / 2, 0, 0], undefined, { bare: true });
    if (big) {
      kit.mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.52, 20), mAccent, pack, [0, 0.29, -0.06], [0, 0, Math.PI / 2]);
      for (const s of [-1, 1]) kit.mesh(new THREE.TorusGeometry(0.098, 0.012, 6, 20), mDark, pack, [s * 0.15, 0.29, -0.06], [0, Math.PI / 2, 0], undefined, { bare: true });
    }
    const strap = kit.mat(shade(packTrim, -0.15));
    for (const s of [-1, 1]) {
      kit.mesh(new RoundedBoxGeometry(0.06, 0.36, 0.03, 2, 0.012), strap, torso, [s * 0.155, 0.27, 0.242 * w], [-0.2, 0, 0]);
      kit.mesh(new RoundedBoxGeometry(0.06, 0.03, 0.42, 2, 0.012), strap, torso, [s * 0.155, 0.46, 0.0], [0, 0, 0]);
      kit.mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.07, 10), mGold, torso, [s * 0.155, 0.22, 0.255 * w], [0, 0, Math.PI / 2], undefined, { bare: true });
    }
  } else if (cfg.pack === "satchel" || cfg.pack === "shoulder") {
    const round = cfg.pack === "shoulder";
    kit.mesh(new THREE.TorusGeometry(0.3, 0.018, 8, 48), kit.mat(shade(packTrim, -0.15)), torso, [0, 0.24, 0], [Math.PI / 2, 0.75, 0], [0.98, 0.82, 1]);
    const bag = group(torso, [-0.31, -0.06, 0.06]);
    bag.rotation.y = -1.1;
    if (round) {
      kit.mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.13, 24), mPack, bag, [0, 0, 0], [0, 0, Math.PI / 2]);
      for (const s of [-1, 1]) kit.mesh(new THREE.TorusGeometry(0.12, 0.014, 6, 24), packDark, bag, [s * 0.066, 0, 0], [0, Math.PI / 2, 0], undefined, { bare: true });
      kit.mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.14, 14), kit.mat(shade(packC, 0.12)), bag, [0, 0, 0], [0, 0, Math.PI / 2], undefined, { bare: true });
    } else {
      kit.mesh(new RoundedBoxGeometry(0.27, 0.21, 0.1, 3, 0.04), mPack, bag);
      kit.mesh(new RoundedBoxGeometry(0.27, 0.12, 0.105, 3, 0.04), packDark, bag, [0, 0.05, 0.004]);
      kit.mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.03, 10), mGold, bag, [0, 0.0, 0.06], [Math.PI / 2, 0, 0], undefined, { bare: true });
    }
  } else if (cfg.pack === "pouch") {
    const pouch = group(torso, [-0.2, 0.0, 0.17]);
    pouch.rotation.y = -0.65;
    kit.mesh(new RoundedBoxGeometry(0.15, 0.13, 0.08, 3, 0.03), mPack, pouch);
    kit.mesh(new RoundedBoxGeometry(0.155, 0.06, 0.085, 3, 0.025), packDark, pouch, [0, 0.04, 0.002]);
  }

  // ---- cape ----
  const cape = cfg.cape === "none" ? null : buildCape(kit, torso, cfg, cfg.pack === "classic" || cfg.pack === "explorer");

  // ---- the Poké Ball in the right hand ----
  const ball = buildBall(kit, cfg.ball, 0.115);
  root.add(ball);

  // ---- animation ----
  const cur = { ...poseAt("idle", 0) };
  const tmp = new THREE.Vector3();
  let lastToss = 0;
  const release = new THREE.Vector3();

  function update(t: number, dt: number, pose: TrainerPose, act?: TauntAct | null) {
    const target = act ? { ...MOVE_BASE, ...MOVES[act.id](act.t) } : poseAt(pose, t);
    const k = 1 - Math.exp(-dt * (act ? 20 : pose === "throw" ? 14 : 7));
    for (const key of Object.keys(cur) as (keyof Joints)[]) cur[key] += (target[key] - cur[key]) * k;
    if (act) pose = "idle";

    const breathe = Math.sin(t * 2.1) * (act ? 0.3 : 1);
    const fight = pose === "fight";
    const wave = pose === "wave";
    const bounce = fight ? Math.abs(Math.sin(t * 4.2)) * 0.035 : wave ? Math.abs(Math.sin(t * 3)) * 0.02 : pose === "victory" ? Math.abs(Math.sin(t * 3.4)) * 0.06 : 0;

    body.position.set(cur.bx, cur.drop + cur.by + bounce + breathe * 0.004, cur.bz);
    body.rotation.y = cur.spin;
    hips.rotation.set(0, cur.twist * 0.4, cur.sway);
    torso.rotation.set(cur.lean + breathe * 0.012, cur.twist * 0.6, 0);
    torso.scale.set(1 + breathe * 0.006, 1 + breathe * 0.01, 1 + breathe * 0.006);
    neck.rotation.set(-cur.lean * 0.6 + cur.nod + Math.sin(t * 0.7) * 0.03, -cur.twist + Math.sin(t * 0.45) * 0.08 * (fight ? 0.2 : 1), cur.headTilt + Math.sin(t * 0.9) * 0.035);

    armL.shoulder.rotation.set(cur.lsX + breathe * 0.02, cur.lsY, cur.lsZ + breathe * 0.02);
    armL.elbow.rotation.set(cur.leX, 0, cur.leZ + (wave ? Math.sin(t * 8) * 0.38 : 0));
    armR.shoulder.rotation.set(cur.rsX + breathe * 0.02, cur.rsY, cur.rsZ - breathe * 0.02);
    armR.elbow.rotation.set(cur.reX + (fight ? Math.sin(t * 4.2) * 0.06 : 0), 0, cur.reZ);
    armL.hand.rotation.set(0, 0, wave ? 0.2 : 0);

    // Legs stay under the body when the hips sway; feet stay flat unless a move tips them.
    const lx = cur.legX + cur.llX;
    const lz = cur.legZ + cur.llZ - cur.sway;
    const rx = -cur.legX * 0.6 + cur.rlX;
    const rz = -cur.legZ + cur.rlZ - cur.sway;
    legL.leg.rotation.set(lx, 0, lz);
    legR.leg.rotation.set(rx, 0, rz);
    legL.foot.rotation.set(-lx + cur.lfX, 0, -lz);
    legR.foot.rotation.set(-rx + cur.rfX, 0, -rz);

    for (const s of sway) s.node.rotation.set(s.rest.x + Math.sin(t * 2.2 + s.phase) * 0.06 * s.amount - bounce * 2 * s.amount + cur.lean * 0.5 * s.amount, s.rest.y, s.rest.z + Math.sin(t * 1.6 + s.phase) * 0.05 * s.amount);
    if (cape) cape.rotation.set(-0.05 - cur.lean * 0.6 - bounce * 1.5 - Math.max(0, Math.sin(t * 1.9)) * (fight || pose === "victory" ? 0.1 : 0.035), 0, Math.sin(t * 1.3) * 0.02);

    // The ball sits in the right hand; idle tosses it up now and then, throw lets it fly.
    root.updateMatrixWorld(true);
    armR.hand.getWorldPosition(tmp);
    root.worldToLocal(tmp);
    ball.position.copy(tmp);
    ball.position.y += 0.08;
    ball.position.z += 0.06;
    ball.scale.setScalar(1);
    if (act?.id === "ballspin") {
      // Balanced on a fingertip, spinning.
      ball.position.y += 0.1;
      ball.rotation.set(0.35, act.t * 15, 0);
      return;
    }
    if (act?.id === "balltoss") {
      const p = (act.t % BALL_TOSS_PERIOD) / BALL_TOSS_PERIOD;
      if (p < 0.72) {
        const u = p / 0.72;
        ball.position.y += Math.sin(u * Math.PI) * 0.95;
        ball.rotation.set(-u * TAU * 2, 0, 0);
      }
      return;
    }
    if (pose === "idle" && !act) {
      const period = 3.4;
      const phase = (t % period) / period;
      if (phase < 0.32) {
        const u = phase / 0.32;
        ball.position.y += Math.sin(u * Math.PI) * 0.42;
        ball.rotation.set(-u * TAU * 1.5, 0, 0);
        lastToss = t;
        return;
      }
    }
    if (pose === "throw") {
      const p = (t % THROW_PERIOD) / THROW_PERIOD;
      if (p <= 0.52) release.copy(ball.position);
      else if (p < 0.95) {
        const u = (p - 0.52) / 0.43;
        ball.position.set(release.x - u * 1.0, release.y + Math.sin(u * Math.PI) * 0.3 - u * 0.5, release.z + u * 1.1);
        ball.rotation.set(u * TAU * 3, 0, 0);
        ball.scale.setScalar(Math.max(0.001, 1 - Math.max(0, u - 0.7) / 0.3));
        return;
      }
      if (p >= 0.95) ball.scale.setScalar((p - 0.95) / 0.05);
    }
    const settle = Math.max(0, 1 - (t - lastToss) * 3);
    ball.rotation.set(0, Math.sin(t * 1.3) * 0.5, Math.sin(t * 2) * 0.08 * (1 - settle));
  }

  update(0, 10, "idle");

  return {
    root,
    update,
    dispose: () => kit.dispose(),
  };
}

/** How each top is put together. */
function topSpec(cfg: TrainerConfig, top: string, trim: string, accent: string, open: boolean): TopSpec {
  const belt = !["dress", "longcoat", "labcoat", "suit", "uniform"].includes(cfg.top);
  switch (cfg.top) {
    case "tee":
      return { inner: top, sleeves: "short", sleeve: top, collar: "ring", emblem: true, belt };
    case "longtee":
      return { inner: top, sleeves: "long", sleeve: top, cuff: trim, collar: "ring", emblem: true, belt };
    case "tank":
      return { inner: top, sleeves: "none", sleeve: top, collar: "ring", emblem: true, belt };
    case "croptop":
      return { inner: top, crop: 0.15, sleeves: "none", sleeve: top, collar: "ring", emblem: true, belt };
    case "uniform":
      return { inner: top, crop: 0.17, sleeves: "long", sleeve: top, cuff: top, collar: "points", emblem: true, belt };
    case "dress":
      return { inner: top, sleeves: "none", sleeve: top, collar: "ring", emblem: true, belt };
    case "shirt":
      return open ? { inner: accent, shell: { gap: 0.42 }, sleeves: "long", sleeve: top, cuff: top, collar: "points", belt } : { inner: top, sleeves: "long", sleeve: top, cuff: top, collar: "points", belt };
    case "jacket":
      return { inner: accent, shell: { gap: open ? 0.36 : 0.03 }, sleeves: "long", sleeve: top, cuff: trim, collar: "stand", belt };
    case "vest":
      return { inner: accent, shell: { gap: open ? 0.42 : 0.03 }, sleeves: "short", sleeve: accent, collar: open ? "none" : "stand", belt };
    case "hoodie":
      return { inner: top, sleeves: "long", sleeve: top, cuff: shade(top, -0.07), collar: "hood", belt };
    case "track":
      return { inner: top, sleeves: "long", sleeve: top, cuff: accent, collar: "stand", belt };
    case "suit":
      return { inner: accent, shell: { gap: open ? 0.4 : 0.26, extend: 0.14 }, sleeves: "long", sleeve: top, cuff: accent, collar: "lapels", belt };
    case "labcoat":
      return { inner: accent, shell: { gap: open ? 0.36 : 0.12, extend: 0.62, flare: 0.08 }, sleeves: "long", sleeve: top, cuff: top, collar: "lapels", belt };
    case "longcoat":
      return { inner: open ? accent : top, shell: { gap: open ? 0.36 : 0.02, extend: 0.86, flare: 0.16, hemGap: 0.5 }, sleeves: "long", sleeve: top, cuff: trim, collar: "fur", belt };
    case "coat":
      return { inner: accent, shell: { gap: open ? 0.36 : 0.03, extend: 0.36 }, sleeves: "long", sleeve: top, cuff: trim, collar: "stand", belt };
  }
}

// ---------------------------------------------------------------------------
// Shoes and capes
// ---------------------------------------------------------------------------

function buildShoe(kit: Kit, foot: THREE.Group, cfg: TrainerConfig, main: string, trim: string) {
  const m = kit.mat(main);
  const t = kit.mat(trim);
  const sole = kit.mat(cfg.shoes === "boots" || cfg.shoes === "tallboots" ? shade(main, -0.22) : trim);
  switch (cfg.shoes) {
    case "formal":
      kit.mesh(new THREE.SphereGeometry(1, 20, 14), m, foot, [0, -0.02, 0.04], undefined, [0.1, 0.07, 0.165]);
      kit.mesh(new THREE.CylinderGeometry(1, 1, 1, 22), kit.mat(shade(main, -0.15)), foot, [0, -0.065, 0.04], undefined, [0.104, 0.03, 0.168], { bare: true });
      return;
    case "boots":
    case "tallboots": {
      const h = cfg.shoes === "tallboots" ? 0.26 : 0.16;
      kit.mesh(new THREE.CylinderGeometry(0.106, 0.11, h, 18), m, foot, [0, h / 2 - 0.04, 0]);
      kit.mesh(new THREE.TorusGeometry(0.106, 0.02, 8, 20), cfg.shoes === "tallboots" ? t : kit.mat(shade(main, -0.12)), foot, [0, h - 0.04, 0], [Math.PI / 2, 0, 0], undefined, { bare: true });
      kit.mesh(new THREE.SphereGeometry(1, 20, 14), m, foot, [0, -0.01, 0.045], undefined, [0.112, 0.085, 0.165]);
      kit.mesh(new THREE.CylinderGeometry(1, 1, 1, 22), sole, foot, [0, -0.065, 0.04], undefined, [0.118, 0.035, 0.172], { bare: true });
      return;
    }
    default: {
      if (cfg.shoes === "hightops") {
        kit.mesh(new THREE.CylinderGeometry(0.106, 0.11, 0.12, 18), m, foot, [0, 0.03, 0]);
        kit.mesh(new THREE.TorusGeometry(0.106, 0.016, 8, 20), t, foot, [0, 0.09, 0], [Math.PI / 2, 0, 0], undefined, { bare: true });
      }
      kit.mesh(new THREE.SphereGeometry(1, 20, 14), m, foot, [0, -0.005, 0.04], undefined, [0.114, 0.088, 0.168]);
      kit.mesh(new THREE.CylinderGeometry(1, 1, 1, 22), sole, foot, [0, -0.06, 0.04], undefined, [0.12, 0.042, 0.175], { bare: true });
      kit.mesh(new THREE.SphereGeometry(1, 14, 10), sole, foot, [0, -0.032, 0.155], undefined, [0.075, 0.045, 0.055], { bare: true });
      // Laces.
      for (const z of [0.07, 0.11]) kit.mesh(new THREE.BoxGeometry(0.07, 0.012, 0.016), t, foot, [0, 0.06 - (z - 0.07) * 0.6, z], [0.5, 0, 0], undefined, { bare: true });
    }
  }
}

/** The cape hangs from the shoulders; its group swings in the wind. */
function buildCape(kit: Kit, torso: THREE.Group, cfg: TrainerConfig, overPack: boolean): THREE.Group {
  const main = colorHex(cfg.capeColor);
  const trim = colorHex(cfg.capeTrim);
  const kind = cfg.cape;
  const cape = group(torso, [0, 0.47, overPack ? -0.1 : -0.02]);
  const len = kind === "short" ? 0.62 : 1.18;
  const r0 = overPack ? 0.32 : 0.27;
  const r1 = kind === "royal" ? 0.58 : kind === "short" ? 0.42 : 0.52;
  const span = 2.9;
  const geo = () => new THREE.CylinderGeometry(r0, r1, len, 36, 4, true, Math.PI - span / 2, span);
  let lining: THREE.Material = kit.mat(kind === "royal" ? shade(main, -0.1) : trim, { side: THREE.BackSide });
  if (kind === "royal") {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
      g.fillStyle = (i + j) % 2 ? shade(main, -0.14) : shade(main, 0.02);
      g.fillRect(i * 8, j * 8, 8, 8);
    }
    const tex = kit.tex(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    tex.magFilter = THREE.NearestFilter;
    lining = kit.mat("#ffffff", { side: THREE.BackSide, map: tex, key: "checker" });
  }
  kit.mesh(geo(), kit.mat(main), cape, [0, -len / 2, 0], undefined, [1, 1, 0.8]);
  kit.mesh(geo(), lining, cape, [0, -len / 2, 0], undefined, [0.995, 1, 0.795], { bare: true });
  if (kind === "royal") {
    // Fur collar and hems.
    kit.mesh(new THREE.TorusGeometry(0.26, 0.085, 10, 30), kit.mat(trim), cape, [0, 0.0, 0.02], [Math.PI / 2 - 0.15, 0, 0], [1, 0.85, 1]);
    for (const s of [-1, 1]) {
      const edge = taper([v3(s * r0 * 0.99, 0, -0.1), v3(s * r1 * 0.85, -len * 0.5, -0.12), v3(s * r1 * 0.99, -len, -0.08)], () => 0.035);
      kit.mesh(edge, kit.mat(trim), cape, [0, 0, 0], undefined, [1, 1, 0.8]);
    }
  }
  if (kind === "collar") {
    // A tall standing collar, lined.
    const collar = () => new THREE.CylinderGeometry(0.5, 0.2, 0.5, 28, 1, true, Math.PI - 2.0, 4.0);
    kit.mesh(collar(), kit.mat(main), cape, [0, 0.17, 0.06]);
    kit.mesh(collar(), kit.mat(trim, { side: THREE.BackSide }), cape, [0, 0.17, 0.06], undefined, [0.99, 1, 0.99], { bare: true });
    for (const s of [-1, 1]) kit.mesh(new THREE.SphereGeometry(0.03, 10, 8), kit.mat("#c9cbd2"), cape, [s * 0.14, 0.0, 0.18], undefined, undefined, { bare: true });
  }
  return cape;
}

// ---------------------------------------------------------------------------
// Face, neck, hair, hats and head accessories
// ---------------------------------------------------------------------------

/** The face is a canvas texture on a shell over the front of the head. */
function buildFace(kit: Kit, head: THREE.Group, cfg: TrainerConfig, skin: string, hairC: string) {
  const tex = kit.tex(new THREE.CanvasTexture(faceTexture({ eyes: cfg.eyes, expr: cfg.expr, iris: eyeHex(cfg.eyeColor), skin, brow: shade(hairC, hairC === "#f1e8d2" || hairC === "#ecc76d" ? -0.25 : -0.08) })));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const geo = new THREE.SphereGeometry(HEAD_R * 1.004, 48, 32, Math.PI / 2 - FACE_SPAN.x, FACE_SPAN.x * 2, FACE_SPAN.top, FACE_SPAN.h);
  kit.mesh(geo, kit.own(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })), head, [0, HEAD_Y, 0], undefined, [1, 0.95, 0.96], { bare: true }).renderOrder = 1;
  // Eyewear (unless the sunglasses are up on a sun hat).
  if (cfg.eyewear !== "none" && !(cfg.eyewear === "sunglasses" && cfg.hat === "sunhat")) buildGlasses(kit, head, cfg, [0, HEAD_Y - 0.06, HEAD_R * 0.98]);
}
/** The angles the face texture covers (see faces.ts). */
const FACE_SPAN = { x: 1.0, top: 0.95, h: 1.3 };

function buildGlasses(kit: Kit, parent: THREE.Object3D, cfg: TrainerConfig, at: V3, scale = 1): THREE.Group {
  const g = group(parent, at);
  g.scale.setScalar(scale);
  const frame = kit.mat(colorHex(cfg.accColor));
  const sun = cfg.eyewear === "sunglasses";
  const round = cfg.eyewear === "round";
  for (const s of [-1, 1]) {
    const lens = group(g, [s * 0.15, 0, 0], [0, s * 0.32, 0]);
    lens.scale.set(round ? 1 : 1.18, round ? 1 : 0.84, 1);
    kit.mesh(new THREE.TorusGeometry(0.085, sun ? 0.016 : 0.011, 6, 24), frame, lens, undefined, undefined, undefined, { bare: true });
    if (sun) kit.mesh(new THREE.CircleGeometry(0.084, 24), kit.mat("#1d2230"), lens, [0, 0, -0.003], undefined, undefined, { bare: true });
    else kit.mesh(new THREE.CircleGeometry(0.084, 24), kit.own(new THREE.MeshBasicMaterial({ color: "#dff2ff", transparent: true, opacity: 0.18, depthWrite: false })), lens, undefined, undefined, undefined, { bare: true });
    // Arm back to the ear.
    kit.mesh(new THREE.BoxGeometry(0.012, 0.012, 0.3), frame, g, [s * 0.245, 0.02, -0.17], [0, s * 0.35, 0], undefined, { bare: true });
  }
  kit.mesh(new THREE.TorusGeometry(0.03, 0.01, 6, 10, Math.PI), frame, g, [0, 0.01, 0.02], undefined, undefined, { bare: true });
  return g;
}

function buildNeck(kit: Kit, torso: THREE.Group, cfg: TrainerConfig, m: THREE.Material, hex: string) {
  const at = (y: number) => 0.5 - y;
  switch (cfg.neck) {
    case "scarf": {
      kit.mesh(new THREE.TorusGeometry(0.135, 0.06, 10, 24), m, torso, [0, at(0.0), 0.0], [Math.PI / 2 - 0.15, 0, 0], [1, 0.9, 1]);
      const from = v3(0, 0.3, 0);
      kit.mesh(taper([v3(0.06, at(0.02), 0.15), v3(0.14, at(0.12), 0.24), v3(0.2, at(0.3), 0.27), v3(0.22, at(0.42), 0.26)], () => 0.05, { flat: 0.35, from }), m, torso);
      kit.mesh(taper([v3(-0.02, at(0.02), -0.15), v3(-0.12, at(0.1), -0.27), v3(-0.18, at(0.34), -0.32), v3(-0.2, at(0.56), -0.32)], () => 0.05, { flat: 0.35, from }), m, torso);
      return;
    }
    case "pendant":
      kit.mesh(new THREE.TorusGeometry(0.15, 0.007, 4, 32), kit.mat("#3a3036"), torso, [0, at(0.12), 0.1], [-0.55, 0, 0], [1, 1.5, 1], { bare: true });
      kit.mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.02, 20), m, torso, [0, at(0.31), 0.245], [Math.PI / 2 - 0.15, 0, 0]);
      kit.mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.024, 14), kit.mat(shade(hex, -0.3)), torso, [0.012, at(0.305), 0.252], [Math.PI / 2 - 0.15, 0, 0], undefined, { bare: true });
      return;
    case "cravat":
      kit.mesh(new THREE.SphereGeometry(0.06, 14, 10), m, torso, [0, at(0.07), 0.17], undefined, [1.1, 0.8, 0.8]);
      kit.mesh(new THREE.SphereGeometry(0.07, 14, 10), m, torso, [0, at(0.15), 0.2], [0.3, 0, 0], [0.9, 1.25, 0.6]);
      kit.mesh(new THREE.SphereGeometry(0.016, 8, 6), kit.mat("#d9dde4"), torso, [0, at(0.13), 0.245], undefined, undefined, { bare: true });
      return;
    case "tie":
      kit.mesh(new THREE.SphereGeometry(0.03, 10, 8), m, torso, [0, at(0.06), 0.17]);
      kit.mesh(taper([v3(0, at(0.07), 0.18), v3(0, at(0.2), 0.235), v3(0, at(0.32), 0.245)], (t) => 0.028 + t * 0.022, { flat: 0.3, from: v3(0, at(0.2), 0) }), m, torso);
      return;
    case "choker":
      kit.mesh(new THREE.TorusGeometry(0.093, 0.016, 6, 24), m, torso, [0, at(-0.03), 0.0], [Math.PI / 2 - 0.1, 0, 0], undefined, { bare: true });
      kit.mesh(new THREE.SphereGeometry(0.02, 10, 8), kit.mat("#d9dde4"), torso, [0, at(0.0), 0.095], undefined, undefined, { bare: true });
      return;
  }
}

interface Sway {
  node: THREE.Object3D;
  rest: THREE.Euler;
  amount: number;
  phase: number;
}

/** A point on the head (hair-group space): polar from +y, azimuth from +z towards +x. */
function onHead(polar: number, azimuth: number, lift = 0): THREE.Vector3 {
  const d = v3(Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth));
  return d.multiplyScalar(HEAD_R + lift);
}

/** Returns the parts that sway (tails, long hair). */
function buildHair(kit: Kit, head: THREE.Group, cfg: TrainerConfig, m: THREE.Material, hatCover: number): Sway[] {
  const hairGroup = group(head, [0, HEAD_Y, 0]);
  const R = HEAD_R;
  const sway: Sway[] = [];
  const hatted = hatCover > 0;
  const swing = (node: THREE.Object3D, amount: number, phase = 0) => sway.push({ node, rest: node.rotation.clone(), amount, phase });
  const centre = v3(0, 0, 0);
  const lock = (pts: THREE.Vector3[], r: number | ((t: number) => number), flat = 1, parent: THREE.Object3D = hairGroup) =>
    kit.mesh(taper(pts, typeof r === "number" ? lockR(r) : r, { flat, from: centre }), m, parent);

  // The cap of hair (thin for a buzz cut).
  const buzz = cfg.hair === "buzz";
  kit.mesh(new THREE.SphereGeometry(buzz ? R * 1.025 : R * 1.06, 40, 24, 0, TAU, 0, buzz ? 1.65 : 1.82), m, hairGroup, [0, 0.01, 0], [-0.52, 0, 0], [1, 0.97, 0.98]);

  const sides = (low: number, size = 0.12) => {
    for (const s of [-1, 1]) kit.mesh(new THREE.SphereGeometry(size, 16, 12), m, hairGroup, [s * R * 0.9, -low, 0.05], undefined, [0.45, 1.1, 0.75]);
  };
  /** A sheet of hair down the back, from the crown to `low` below the head centre. */
  const back = (low: number, width: number, depth = 0.25) => {
    const g = group(hairGroup, [0, 0.05, -R * 0.55]);
    const n = 5;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1) - 0.5) * width;
      lock([v3(x * 0.45, 0.18, 0.1), v3(x * 0.8, -0.15, -depth * 0.55), v3(x * 1.0, -low * 0.6, -depth * 0.7), v3(x * 1.05, -low, -depth * 0.55)], (t) => 0.14 * (1 - t * 0.65) + 0.02, 0.6, g);
    }
    swing(g, 0.6);
    return g;
  };
  /** Locks falling down in front of the shoulders. */
  const frontLocks = (low: number, r = 0.075) => {
    for (const s of [-1, 1]) {
      const g = group(hairGroup, [s * R * 0.8, -0.05, 0.08]);
      lock([v3(0, 0.15, -0.02), v3(s * 0.06, -0.15, 0.02), v3(s * 0.07, -low * 0.7, 0.06), v3(s * 0.04, -low, 0.07)], (t) => r * (1 - t * 0.6) + 0.012, 0.65, g);
      swing(g, 0.3, s);
    }
  };
  const spikesFrom = (list: [number, number, number][], lean: THREE.Vector3, r = 0.1, minPolar = 0) => {
    for (const [polar, az, len] of list) {
      if (hatCover >= 1 && polar < 1.05) continue;
      if (polar < minPolar) continue;
      const p = onHead(polar, az, -0.05);
      const d = p.clone().normalize().add(lean).normalize();
      const side = v3(-d.z, 0, d.x).multiplyScalar(0.04);
      kit.mesh(taper([p, p.clone().addScaledVector(d, len * 0.5).add(side), p.clone().addScaledVector(d, len).addScaledVector(lean, len * 0.25)], spike(r), { radial: 8, seg: 10 }), m, hairGroup);
    }
  };

  switch (cfg.hair) {
    case "short":
      sides(0.05);
      break;
    case "buzz":
      break;
    case "spiky":
      spikesFrom(
        [
          [0.35, 0.2, 0.3],
          [0.6, -0.9, 0.32],
          [0.6, 0.9, 0.32],
          [0.85, Math.PI - 0.5, 0.36],
          [0.85, Math.PI + 0.5, 0.36],
          [1.25, Math.PI, 0.34],
          [1.2, Math.PI - 1.2, 0.32],
          [1.2, Math.PI + 1.2, 0.32],
          [1.55, Math.PI - 0.6, 0.3],
          [1.55, Math.PI + 0.6, 0.3],
          [1.4, 1.75, 0.27],
          [1.4, -1.75, 0.27],
        ],
        v3(0, -0.25, -0.55),
        0.11,
      );
      sides(0.06);
      break;
    case "spikyup":
      spikesFrom(
        [
          [0.15, 0, 0.36],
          [0.5, 0.35, 0.36],
          [0.5, -0.35, 0.36],
          [0.55, 1.2, 0.36],
          [0.55, -1.2, 0.36],
          [0.55, Math.PI, 0.36],
          [0.6, Math.PI - 1.2, 0.36],
          [0.6, Math.PI + 1.2, 0.36],
          [0.95, 0.8, 0.3],
          [0.95, -0.8, 0.3],
          [1.0, 1.65, 0.3],
          [1.0, -1.65, 0.3],
          [1.05, Math.PI - 0.7, 0.3],
          [1.05, Math.PI + 0.7, 0.3],
          [1.35, Math.PI, 0.24],
        ],
        v3(0, 0.4, -0.5),
        0.12,
      );
      sides(0.04, 0.1);
      break;
    case "quiff": {
      // Volume rising off the forehead and swept back over the crown into points.
      if (!hatted)
        for (const [x, lift, flare] of [
          [0, 0.16, 0],
          [0.24, 0.08, 0.1],
          [-0.24, 0.08, -0.1],
        ] as const) {
          const pts = [v3(x * 0.85, R * 0.48, R * 0.8), v3(x, R * 1.0 + lift, R * 0.42), v3(x * 1.1 + flare, R * 1.02 + lift * 0.8, -R * 0.35), v3(x * 1.25 + flare * 2.2, R * 0.8 + lift, -R * 1.05)];
          kit.mesh(taper(pts, spike(0.19, 0.06), { flat: 0.62, from: v3(0, -0.1, 0), radial: 12, seg: 22 }), m, hairGroup);
        }
      spikesFrom(
        [
          [0.75, Math.PI - 0.35, 0.3],
          [0.75, Math.PI + 0.35, 0.3],
          [1.15, 1.85, 0.26],
          [1.15, -1.85, 0.26],
          [1.3, Math.PI, 0.22],
        ],
        v3(0, 0.15, -0.75),
        0.11,
      );
      sides(0.04, 0.1);
      break;
    }
    case "swept": {
      const sp = v3(0.12, 0.42, 0.9).normalize().multiplyScalar(R * 0.98);
      const swoop = kit.mesh(new THREE.SphereGeometry(0.22, 24, 16), m, hairGroup, [sp.x, sp.y, sp.z], undefined, [1.45, 0.55, 0.6]);
      swoop.quaternion.setFromUnitVectors(v3(0, 0, 1), sp.clone().normalize());
      swoop.rotateZ(-0.35);
      sides(0.05);
      if (!hatted) kit.mesh(new THREE.SphereGeometry(0.18, 16, 12), m, hairGroup, [0.05, R * 0.98, -0.05], [0.3, 0, -0.4], [1.3, 0.6, 1.2]);
      break;
    }
    case "bob":
    case "long":
    case "flowing": {
      const g = 0.82;
      const lower = cfg.hair === "bob" ? 2.25 : 2.5;
      kit.mesh(new THREE.SphereGeometry(R * 1.1, 40, 24, Math.PI / 2 + g, TAU - 2 * g, 0.25, lower - 0.25), kit.mat((m as THREE.MeshToonMaterial).userData.hex, { side: THREE.DoubleSide }), hairGroup, [0, 0, -0.01]);
      if (cfg.hair === "bob") {
        for (const s of [-1, 1]) lock([v3(s * R * 0.92, 0.05, 0.12), v3(s * R * 0.98, -0.2, 0.14), v3(s * R * 0.9, -0.36, 0.12)], 0.085, 0.6);
      }
      if (cfg.hair === "long") {
        back(0.95, 0.78);
        frontLocks(0.5, 0.05);
      }
      if (cfg.hair === "flowing") {
        back(1.3, 1.05, 0.42);
        frontLocks(0.62, 0.045);
      }
      break;
    }
    case "ponytail": {
      sides(0.04);
      const tail = group(hairGroup, [0, 0.12, -R * 0.98], [-0.35, 0, 0]);
      kit.mesh(new THREE.TorusGeometry(0.06, 0.025, 8, 16), kit.mat(colorHex(cfg.accColor)), tail, [0, 0, -0.02], [0.3, 0, 0]);
      lock([v3(0, 0, -0.02), v3(0, -0.1, -0.16), v3(0, -0.32, -0.2), v3(0, -0.5, -0.14)], 0.12, 0.85, tail);
      swing(tail, 1);
      break;
    }
    case "sidetail": {
      sides(0.05);
      // A spiky tail high on the left side, flicking up and out.
      const tail = group(hairGroup, [R * 0.66, R * 0.6, -R * 0.35], [0, 0, -0.35]);
      tail.scale.setScalar(1.45);
      kit.mesh(new THREE.TorusGeometry(0.05, 0.022, 8, 16), kit.mat(colorHex(cfg.accColor)), tail, [0, 0, 0], [0, Math.PI / 2, 0.5]);
      for (const [dx, dy, dz, len] of [
        [0.9, 0.7, -0.1, 0.36],
        [1.0, 0.25, -0.15, 0.34],
        [0.7, 0.95, -0.35, 0.3],
        [0.95, -0.05, 0.1, 0.28],
      ] as const) {
        const d = v3(dx, dy, dz).normalize();
        kit.mesh(taper([v3(0, 0, 0), d.clone().multiplyScalar(len * 0.5).add(v3(0, 0.05, 0)), d.clone().multiplyScalar(len).add(v3(0.04, -0.06, 0))], spike(0.07), { radial: 8 }), m, tail);
      }
      swing(tail, 0.5);
      break;
    }
    case "twintails": {
      sides(0.04);
      for (const s of [-1, 1]) {
        const tail = group(hairGroup, [s * R * 0.9, 0.08, -0.1], [0, 0, s * 0.2]);
        kit.mesh(new THREE.TorusGeometry(0.05, 0.022, 8, 16), kit.mat(colorHex(cfg.accColor)), tail, [0, 0, 0], [0, Math.PI / 2, 0]);
        lock([v3(0, 0, 0), v3(s * 0.1, -0.12, -0.04), v3(s * 0.12, -0.4, -0.04), v3(s * 0.08, -0.62, 0)], 0.1, 0.8, tail);
        swing(tail, 0.6, s);
      }
      break;
    }
    case "volume": {
      // A huge mane swept back and out to one side, ending in a hook.
      kit.mesh(new THREE.SphereGeometry(R * 1.14, 32, 20), m, hairGroup, [0.03, 0.12, -0.2], [-0.3, 0, 0], [1.1, 0.95, 1.0]);
      const mane = group(hairGroup, [0, 0.0, 0]);
      kit.mesh(
        taper([v3(0.0, 0.32, 0.0), v3(0.4, 0.38, -0.32), v3(0.78, 0.12, -0.5), v3(0.95, -0.38, -0.48), v3(0.78, -0.86, -0.36), v3(0.5, -0.9, -0.3), v3(0.4, -0.7, -0.3), v3(0.5, -0.6, -0.3)], (t) => 0.42 * (1 - t) ** 0.9 + 0.022, { radial: 14, seg: 48 }),
        m,
        mane,
      );
      lock([v3(-0.2, 0.3, -0.1), v3(-0.45, 0.2, -0.4), v3(-0.5, -0.15, -0.55), v3(-0.35, -0.4, -0.6)], 0.2, 0.8);
      for (const s of [-1, 1]) lock([v3(s * R * 0.9, 0.1, 0.0), v3(s * R * 1.05, -0.15, -0.15), v3(s * R * 0.9, -0.42, -0.25)], 0.12, 0.7);
      swing(mane, 0.25);
      break;
    }
    case "buns": {
      sides(0.05);
      if (hatCover < 1) {
        for (const s of [-1, 1]) {
          const p = onHead(0.62, s * 1.25, 0.06);
          kit.mesh(new THREE.SphereGeometry(0.16, 20, 16), m, hairGroup, [p.x, p.y, p.z - 0.05]);
          kit.mesh(new THREE.TorusGeometry(0.1, 0.025, 8, 16), kit.mat(colorHex(cfg.accColor)), hairGroup, [p.x * 0.88, p.y * 0.88, p.z * 0.88 - 0.05], [Math.PI / 2 + 0.6, s * 0.6, 0], undefined, { bare: true });
        }
      }
      break;
    }
    case "curly": {
      const n = 46;
      for (let i = 0; i < n; i++) {
        const polar = Math.acos(1 - ((i + 0.5) / n) * 1.45);
        const az = i * 2.39996;
        if (Math.cos(az) > 0.35 && polar > 1.05) continue;
        if (hatted && polar < 1.1) continue;
        const p = onHead(polar, az, 0).applyAxisAngle(v3(1, 0, 0), -0.3);
        kit.mesh(new THREE.SphereGeometry(0.11, 12, 10), m, hairGroup, [p.x, p.y, p.z], undefined, undefined, { bare: i % 2 === 1 });
      }
      break;
    }
  }

  buildBangs(kit, hairGroup, cfg, m, hatCover, lock);
  return sway;
}

function buildBangs(kit: Kit, g: THREE.Group, cfg: TrainerConfig, m: THREE.Material, hatCover: number, lock: (pts: THREE.Vector3[], r: number | ((t: number) => number), flat?: number) => THREE.Mesh) {
  const R = HEAD_R;
  const bangs = cfg.bangs === "auto" ? HAIR_BANGS[cfg.hair] : cfg.bangs;
  const hatted = hatCover > 0;
  /** A point on the head's front: x across, y up (unit sphere), pushed out by `lift`. */
  const at = (x: number, y: number, lift = 0.02) => {
    const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    return v3(x, y, z).multiplyScalar(R + lift);
  };
  switch (bangs) {
    case "tufts": {
      const count = cfg.hair === "curly" ? 5 : 4;
      const y = hatted ? 0.25 : 0.27;
      for (let i = 0; i < count; i++) {
        const x = (i / (count - 1) - 0.5) * 0.72;
        const sp = v3(x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y))).normalize().multiplyScalar(R);
        const tuft = kit.mesh(new THREE.SphereGeometry(hatted ? 0.11 : 0.13, 16, 12), m, g, [sp.x, sp.y, sp.z], undefined, [1, hatted ? 0.7 : 0.8, 0.55]);
        tuft.quaternion.setFromUnitVectors(v3(0, 0, 1), sp.clone().normalize());
        tuft.rotateZ(x * 1.2);
      }
      return;
    }
    case "blunt":
      // A straight-cut fringe: a band of the cap down to the brows.
      kit.mesh(new THREE.SphereGeometry(R * 1.075, 36, 10, Math.PI / 2 - 1.0, 2.0, 0.45, 0.82), kit.mat((m as THREE.MeshToonMaterial).userData.hex, { side: THREE.DoubleSide }), g, [0, 0.0, 0.0], [-0.08, 0, 0], [1, 0.95, 1]);
      kit.mesh(new THREE.TorusGeometry(R * 1.0, 0.022, 6, 36, 2.0), m, g, [0, 0.12, 0.0], [Math.PI / 2 - 0.12, 0, Math.PI / 2 - 1.0 + Math.PI], [1.07, 1.03, 1], { bare: true });
      return;
    case "side":
      lock([at(0.25, 0.55), at(-0.05, 0.42, 0.04), at(-0.38, 0.12, 0.05), at(-0.52, -0.2, 0.03), at(-0.5, -0.42, 0.0)], (t) => 0.12 * (1 - t * 0.75) + 0.01, 0.42);
      lock([at(0.1, 0.55), at(0.35, 0.35, 0.03), at(0.55, 0.1, 0.02)], (t) => 0.08 * (1 - t * 0.7) + 0.01, 0.45);
      return;
    case "parted":
      for (const s of [-1, 1]) lock([at(s * 0.04, 0.62), at(s * 0.25, 0.46, 0.04), at(s * 0.52, 0.22, 0.04), at(s * 0.66, -0.02, 0.02)], (t) => 0.1 * (1 - t * 0.7) + 0.012, 0.45);
      return;
    case "spiky":
      for (const x of [-0.22, 0.02, 0.24]) {
        const a = at(x, hatted ? 0.36 : 0.42, 0.0);
        const b = at(x * 1.15 + 0.03, hatted ? 0.1 : 0.12, 0.05);
        kit.mesh(taper([a, a.clone().lerp(b, 0.5).add(v3(0, 0, 0.03)), b], spike(0.08), { radial: 8, seg: 8 }), m, g);
      }
      return;
    case "open":
      return;
  }
}

function buildHat(kit: Kit, head: THREE.Group, cfg: TrainerConfig) {
  // Hats sit high on the big head so the brim stays clear of the eyes.
  const hat = group(head, [0, HEAD_Y + 0.07, 0]);
  const R = HEAD_R * 1.1;
  const kind = cfg.hat;
  const mainHex = colorHex(cfg.hatColor);
  const trimHex = colorHex(cfg.hatTrim);
  const m = kit.mat(mainHex);
  const trim = kit.mat(trimHex);
  const gold = kit.mat("#e9b526");
  const white = kit.mat("#f6f6f2");
  const crownGeo = () => new THREE.SphereGeometry(R, 40, 20, 0, TAU, 0, Math.PI / 2);
  const frontDir = v3(0, 0.55, 0.83).normalize();
  const onFront = (lift: number, up = 0) => v3(0, 0.08 + frontDir.y * R * 0.9 + up, frontDir.z * R + lift);

  if (kind === "cap" || kind === "backcap" || kind === "ace" || kind === "champion" || kind === "league" || kind === "ballcap" || kind === "twotone" || kind === "crown") {
    const cap = group(hat);
    if (kind === "backcap") cap.rotation.y = Math.PI;
    kit.mesh(crownGeo(), m, cap, [0, 0.08, -0.02], [-0.22, 0, 0], [1, 0.9, 1]);
    const brimMat = kind === "ace" ? trim : kind === "champion" ? kit.mat(shade(mainHex, -0.1)) : kind === "twotone" ? trim : m;
    kit.mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 36), brimMat, cap, [0, 0.1, R * 0.92], [0.22, 0, 0], [1, 1, 0.78]);
    if (kind === "champion") kit.mesh(new THREE.TorusGeometry(0.3, 0.016, 8, 40, Math.PI), gold, cap, [0, 0.1, R * 0.92], [Math.PI / 2 + 0.22, 0, 0], [1, 0.78, 1], { bare: true });
    // Front panel.
    const panelMat = kind === "champion" ? kit.mat("#1d1e22") : kind === "ballcap" || kind === "crown" || kind === "twotone" ? null : white;
    // Two-tone: a band of the trim colour round the crown, matching the brim.
    if (kind === "twotone") kit.mesh(new THREE.TorusGeometry(R * 0.985, 0.045, 8, 40), trim, cap, [0, 0.1, -0.02], [Math.PI / 2 - 0.22, 0, 0]);
    if (panelMat) {
      const panel = kit.mesh(new THREE.SphereGeometry(0.17, 24, 16), panelMat, cap, [frontDir.x * R * 0.95, 0.08 + frontDir.y * R * 0.85, frontDir.z * R * 0.95 - 0.02]);
      panel.quaternion.setFromUnitVectors(v3(0, 0, 1), frontDir);
      panel.scale.set(1, 0.72, 0.3);
    }
    const logoRot: V3 = [Math.PI / 2 - 0.55, 0, 0];
    const logoPos = onFront(0.03, 0.005);
    if (kind === "league") {
      // An open arc, like a big C lying on its side.
      kit.mesh(new THREE.TorusGeometry(0.062, 0.016, 8, 24, Math.PI * 1.35), trim, cap, [logoPos.x, logoPos.y, logoPos.z], [-0.55, 0, -Math.PI * 0.2], undefined, { bare: true });
    } else if (kind === "ballcap") {
      kit.mesh(new THREE.TorusGeometry(0.075, 0.014, 8, 28), trim, cap, [logoPos.x, logoPos.y, logoPos.z - 0.01], [-0.55, 0, 0], undefined, { bare: true });
      kit.mesh(new THREE.BoxGeometry(0.15, 0.014, 0.014), trim, cap, [logoPos.x, logoPos.y, logoPos.z - 0.008], [-0.55, 0, 0], undefined, { bare: true });
      kit.mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.02, 16), trim, cap, [logoPos.x, logoPos.y, logoPos.z - 0.005], logoRot, undefined, { bare: true });
    } else if (kind === "crown") {
      // A zigzag crown across the front.
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6 - 0.5) * 1.5;
        const hgt = i % 2 ? 0.2 : 0.02;
        const d = v3(Math.sin(a), 0, Math.cos(a)).multiplyScalar(Math.cos(hgt + 0.25)).add(v3(0, Math.sin(hgt + 0.25), 0)).normalize();
        d.applyAxisAngle(v3(1, 0, 0), -0.22);
        pts.push(d.multiplyScalar(R * 1.01).add(v3(0, 0.08, -0.02)));
      }
      kit.mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.05), 60, 0.018, 6, false), trim, cap, undefined, undefined, [1, 0.9, 1], { bare: true });
    } else {
      kit.mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 20), kind === "champion" ? gold : trim, cap, [logoPos.x, logoPos.y, logoPos.z], logoRot, undefined, { bare: true });
    }
    if (kind === "ace") kit.mesh(new THREE.TorusGeometry(R * 0.98, 0.03, 8, 40, Math.PI), trim, cap, [0, 0.08, -0.02], [0, Math.PI / 2, 0], [1, 0.92, 1], { bare: true });
    kit.mesh(new THREE.SphereGeometry(0.04, 12, 10), kind === "champion" ? gold : kind === "twotone" ? trim : m, cap, [0, 0.08 + R * 0.86, -0.17], undefined, undefined, { bare: true });
    return;
  }
  switch (kind) {
    case "beanie": {
      kit.mesh(new THREE.SphereGeometry(R, 40, 20, 0, TAU, 0, Math.PI / 2 + 0.05), m, hat, [0, 0.08, -0.02], [-0.22, 0, 0], [1, 1.08, 1]);
      kit.mesh(new THREE.TorusGeometry(R * 0.98, 0.07, 12, 40), kit.mat(shade(mainHex, -0.06)), hat, [0, 0.07, -0.02], [Math.PI / 2 - 0.22, 0, 0]);
      kit.mesh(new THREE.SphereGeometry(0.1, 16, 12), trim, hat, [0, 0.1 + R * 1.05, -0.16]);
      // A half-ball mark on the side of the crown.
      const mark = group(hat, [R * 0.55, 0.32, R * 0.62]);
      mark.lookAt(v3(R * 1.5, 0.6, R * 1.7).add(hat.position));
      kit.mesh(new THREE.TorusGeometry(0.075, 0.016, 6, 24), trim, mark, undefined, undefined, undefined, { bare: true });
      kit.mesh(new THREE.CircleGeometry(0.075, 24, 0, Math.PI), trim, mark, [0, 0, 0.004], undefined, undefined, { bare: true });
      return;
    }
    case "beret":
      kit.mesh(new THREE.SphereGeometry(R * 1.12, 36, 16), m, hat, [0.06, 0.2, -0.06], [-0.3, 0, -0.18], [1, 0.36, 1]);
      kit.mesh(new THREE.TorusGeometry(R * 0.96, 0.03, 8, 40), trim, hat, [0, 0.12, -0.03], [Math.PI / 2 - 0.25, 0, 0], undefined, { bare: true });
      kit.mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.06, 10), m, hat, [0.04, 0.38, -0.08], undefined, undefined, { bare: true });
      return;
    case "sunhat": {
      kit.mesh(new THREE.CylinderGeometry(R * 0.86, R * 0.98, 0.26, 36), m, hat, [0, 0.24, -0.04], [-0.2, 0, 0]);
      kit.mesh(new THREE.SphereGeometry(R * 0.86, 36, 10, 0, TAU, 0, Math.PI / 2), m, hat, [0, 0.37, -0.065], [-0.2, 0, 0], [1, 0.3, 1]);
      kit.mesh(new THREE.CylinderGeometry(R * 1.0, R * 1.0, 0.07, 36), trim, hat, [0, 0.15, -0.025], [-0.2, 0, 0]);
      kit.mesh(new THREE.CylinderGeometry(R * 1.0, R * 1.42, 0.07, 44, 1, true), kit.mat(mainHex, { side: THREE.DoubleSide }), hat, [0, 0.09, -0.01], [-0.2, 0, 0]);
      kit.mesh(new THREE.TorusGeometry(R * 1.42, 0.018, 6, 48), kit.mat(shade(mainHex, -0.08)), hat, [0, 0.055, -0.0], [Math.PI / 2 - 0.2, 0, 0], undefined, { bare: true });
      if (cfg.eyewear !== "none") buildGlasses(kit, hat, cfg, [0, 0.26, R * 0.95], 0.75).rotation.x = -0.35;
      return;
    }
    case "bucket":
      kit.mesh(new THREE.SphereGeometry(R, 40, 20, 0, TAU, 0, Math.PI / 2), m, hat, [0, 0.08, -0.02], [-0.22, 0, 0], [1, 0.85, 1]);
      kit.mesh(new THREE.CylinderGeometry(R * 0.98, R * 1.4, 0.12, 40, 1, true), kit.mat(mainHex, { side: THREE.DoubleSide }), hat, [0, 0.05, -0.02], [-0.22, 0, 0]);
      kit.mesh(new THREE.CylinderGeometry(R * 1.0, R * 1.0, 0.06, 40, 1, true), kit.mat(trimHex, { side: THREE.DoubleSide }), hat, [0, 0.14, -0.035], [-0.22, 0, 0]);
      return;
    case "visor":
      kit.mesh(new THREE.TorusGeometry(R * 0.95, 0.045, 10, 40), m, hat, [0, 0.18, -0.03], [Math.PI / 2 - 0.22, 0, 0]);
      kit.mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 36), trim, hat, [0, 0.16, R * 0.92], [0.22, 0, 0], [1, 1, 0.78]);
      return;
    case "headband":
      kit.mesh(new THREE.TorusGeometry(R * 0.93, 0.05, 10, 40), m, hat, [0, 0.12, -0.04], [Math.PI / 2 - 0.3, 0, 0], [1, 1, 0.75]);
      kit.mesh(new THREE.SphereGeometry(0.06, 12, 10), trim, hat, [R * 0.75, 0.2, -R * 0.45], undefined, [1, 0.8, 0.8]);
      for (const s of [-1, 1]) kit.mesh(taper([v3(R * 0.8, 0.2, -R * 0.45), v3(R * 0.85 + 0.04, 0.05 + s * 0.04, -R * 0.65), v3(R * 0.82 + 0.06, -0.12 + s * 0.05, -R * 0.75)], () => 0.025, { flat: 0.4, from: v3(0, 0.1, 0) }), m, hat);
      return;
    case "safari":
      kit.mesh(new THREE.CylinderGeometry(R * 0.82, R * 1.0, 0.3, 36), m, hat, [0, 0.24, -0.04], [-0.2, 0, 0]);
      kit.mesh(new THREE.SphereGeometry(R * 0.82, 36, 12, 0, TAU, 0, Math.PI / 2), m, hat, [0, 0.39, -0.07], [-0.2, 0, 0], [1, 0.45, 1]);
      kit.mesh(new THREE.CylinderGeometry(R * 1.02, R * 1.02, 0.07, 36), trim, hat, [0, 0.14, -0.02], [-0.2, 0, 0]);
      kit.mesh(new THREE.CylinderGeometry(R * 1.6, R * 1.6, 0.03, 48), kit.mat(shade(mainHex, -0.06)), hat, [0, 0.1, -0.02], [-0.2, 0, 0]);
      return;
  }
}

/** Earrings and hair accessories. */
function buildHeadExtras(kit: Kit, head: THREE.Group, cfg: TrainerConfig, m: THREE.Material, hex: string) {
  const g = group(head, [0, HEAD_Y, 0]);
  const R = HEAD_R;
  if (cfg.ears !== "none")
    for (const s of [-1, 1]) {
      const at = v3(s * R * 1.0, -0.12, 0.0);
      if (cfg.ears === "studs") kit.mesh(new THREE.SphereGeometry(0.022, 10, 8), m, g, [at.x, at.y, at.z], undefined, undefined, { bare: true });
      if (cfg.ears === "drops") {
        kit.mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 6), kit.mat("#c9cbd2"), g, [at.x, at.y - 0.03, at.z], undefined, undefined, { bare: true });
        kit.mesh(new THREE.SphereGeometry(0.045, 14, 10), m, g, [at.x, at.y - 0.085, at.z]);
      }
      if (cfg.ears === "hoops") kit.mesh(new THREE.TorusGeometry(0.045, 0.008, 6, 20), m, g, [at.x, at.y - 0.05, at.z], [0, Math.PI / 2, 0], undefined, { bare: true });
    }
  switch (cfg.hairAcc) {
    case "clips":
      for (const s of [-1, 1]) kit.mesh(new RoundedBoxGeometry(0.11, 0.03, 0.03, 2, 0.01), m, g, [s * R * 0.62, R * 0.5, R * 0.68], [0, s * 0.6, s * 0.5]);
      return;
    case "ornaments":
      for (const s of [-1, 1]) {
        const o = group(g, [s * R * 1.14, R * 0.42, -0.06], [0, 0, s * -0.3]);
        kit.mesh(new THREE.SphereGeometry(0.15, 18, 14), m, o, [s * 0.03, 0, 0], undefined, [0.55, 1, 1.05]);
        kit.mesh(new THREE.SphereGeometry(0.1, 14, 10), m, o, [s * 0.05, 0.15, -0.06], undefined, [0.5, 0.9, 1.3]);
        kit.mesh(new THREE.TorusGeometry(0.1, 0.016, 6, 18), kit.mat(shade(hex, 0.3)), o, [s * 0.09, 0, 0], [0, Math.PI / 2, 0], undefined, { bare: true });
      }
      return;
    case "ribbons": {
      const hairM = kit.mat(hairHex(cfg.hairColor));
      for (const s of [-1, 1]) {
        const base = onHead(0.62, s * 0.75, -0.03);
        const tip = base.clone().add(v3(s * 0.12, 0.26, -0.04));
        kit.mesh(taper([base, base.clone().lerp(tip, 0.5).add(v3(s * 0.03, 0, 0)), tip], spike(0.09, 0.15), { radial: 8 }), hairM, g);
        const bow = group(g, [base.x * 1.2, base.y * 1.14, base.z * 1.12]);
        bow.lookAt(base.clone().multiplyScalar(3).add(g.position));
        for (const t of [-1, 1]) kit.mesh(new THREE.SphereGeometry(0.05, 12, 8), m, bow, [t * 0.05, 0, 0], [0, 0, t * 0.3], [1.1, 0.6, 0.4]);
        kit.mesh(taper([v3(0, 0, 0), v3(s * 0.03, -0.1, -0.02), v3(s * 0.01, -0.22, -0.03)], () => 0.018, { flat: 0.4, from: v3(0, 0, -1) }), m, bow);
      }
      return;
    }
    case "bow": {
      const bow = group(g, [0, R * 0.55, -R * 0.82]);
      bow.rotation.x = -0.5;
      for (const t of [-1, 1]) kit.mesh(new THREE.SphereGeometry(0.1, 14, 10), m, bow, [t * 0.1, 0, 0], [0, 0, t * 0.3], [1.1, 0.65, 0.45]);
      kit.mesh(new THREE.SphereGeometry(0.04, 10, 8), kit.mat(shade(hex, -0.15)), bow);
      return;
    }
    case "flower": {
      const f = group(g, [R * 0.72, R * 0.5, R * 0.42]);
      f.lookAt(v3(R * 2, R * 1.2, R * 1.4).add(g.position));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU;
        kit.mesh(new THREE.SphereGeometry(0.04, 10, 8), m, f, [Math.cos(a) * 0.045, Math.sin(a) * 0.045, 0], undefined, [1, 1, 0.5], { bare: true });
      }
      kit.mesh(new THREE.SphereGeometry(0.03, 10, 8), kit.mat("#f6d24a"), f, [0, 0, 0.015], undefined, undefined, { bare: true });
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Poses
// ---------------------------------------------------------------------------

export interface Joints {
  drop: number;
  lean: number;
  twist: number;
  headTilt: number;
  nod: number;
  lsX: number;
  lsY: number;
  lsZ: number;
  leX: number;
  leZ: number;
  rsX: number;
  rsY: number;
  rsZ: number;
  reX: number;
  reZ: number;
  legX: number;
  legZ: number;
  /** For moves: each leg's own swing (forward is -X, outward is +Z on the left, -Z on the right) and foot tip (+: on the toes). */
  llX: number;
  llZ: number;
  rlX: number;
  rlZ: number;
  lfX: number;
  rfX: number;
  /** The whole body: slide, hop, turn; and the hips' side sway. */
  bx: number;
  by: number;
  bz: number;
  spin: number;
  sway: number;
}

const THROW_PERIOD = 1.9;
/** Ball Toss: one toss and catch. */
export const BALL_TOSS_PERIOD = 1.3;

const IDLE: Joints = {
  drop: 0,
  lean: 0,
  twist: 0,
  headTilt: 0.03,
  nod: 0,
  lsX: 0.05,
  lsY: 0,
  lsZ: 0.16,
  leX: -0.2,
  leZ: 0,
  rsX: -0.18,
  rsY: 0,
  rsZ: -0.14,
  reX: -1.0,
  reZ: 0.1,
  legX: 0,
  legZ: 0.03,
  llX: 0,
  llZ: 0,
  rlX: 0,
  rlZ: 0,
  lfX: 0,
  rfX: 0,
  bx: 0,
  by: 0,
  bz: 0,
  spin: 0,
  sway: 0,
};

/** Where every move starts from: standing tall, arms loose. */
const MOVE_BASE: Joints = { ...IDLE, lsZ: 0.14, leX: -0.25, rsX: -0.1, rsZ: -0.14, reX: -0.5, reZ: 0, legZ: 0.05 };

const POSES: Record<Exclude<TrainerPose, "throw">, Joints> = {
  idle: IDLE,
  wave: { ...IDLE, headTilt: 0.12, lsX: -0.4, lsZ: 1.7, leX: 0, leZ: 1.25, rsX: -0.15, rsZ: -0.14, reX: -0.9 },
  fight: { ...IDLE, drop: -0.035, lean: 0.16, twist: -0.3, headTilt: -0.04, nod: 0, lsX: -1.45, lsY: 0, lsZ: 0.18, leX: -0.15, leZ: 0, rsX: 0.35, rsY: 0, rsZ: -1.95, reX: 0, reZ: -1.15, legX: 0.05, legZ: 0.3 },
  victory: { ...IDLE, drop: 0, lean: -0.08, headTilt: -0.06, nod: -0.12, lsX: -0.25, lsZ: 0.75, leX: -2.0, leZ: 0, rsX: -0.35, rsZ: -2.35, reX: -0.2, reZ: -0.25, legZ: 0.12 },
  think: { ...IDLE, headTilt: 0.18, nod: 0.08, lsX: -1.2, lsY: 0, lsZ: -0.55, leX: -2.35, leZ: 0.35, rsX: -0.55, rsZ: 0.32, reX: -1.35, reZ: 0.4, legZ: 0.02 },
};

/** The joint targets for a pose at time t (the throw is a loop: wind up, release, follow through). */
function poseAt(pose: TrainerPose, t: number): Joints {
  if (pose !== "throw") return POSES[pose];
  const p = (t % THROW_PERIOD) / THROW_PERIOD;
  const wind = { rsX: 0.9, rsZ: -2.5, reX: -1.4, lean: -0.12, twist: 0.35 };
  const release = { rsX: -1.7, rsZ: -0.6, reX: -0.1, lean: 0.22, twist: -0.4 };
  const k = p < 0.4 ? 0 : p < 0.55 ? (p - 0.4) / 0.15 : p < 0.85 ? 1 : 1 - (p - 0.85) / 0.15;
  const mix = (a: number, b: number) => a + (b - a) * k;
  return {
    ...IDLE,
    drop: -0.04,
    lean: mix(wind.lean, release.lean),
    twist: mix(wind.twist, release.twist),
    headTilt: 0,
    lsX: -0.9,
    lsZ: 0.5,
    leX: -0.4,
    rsX: mix(wind.rsX, release.rsX),
    rsZ: mix(wind.rsZ, release.rsZ),
    reX: mix(wind.reX, release.reX),
    reZ: 0,
    legX: 0.25,
    legZ: 0.18,
  };
}

/** The root's turn for each facing (the model faces +z). */
export const FACING_YAW: Record<TrainerFacing, number> = { front: 0.3, left: -0.62, right: 0.62 };
