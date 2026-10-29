import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { colorHex, hairHex, skinHex, type TrainerConfig, type TrainerFacing, type TrainerPose } from "@/lib/trainer/config";

/**
 * The chibi trainer, built from three.js primitives (no downloaded models,
 * so nothing to license and nothing to load): a big round head, a small
 * body, swappable hair, hats, clothes and bags, and our own Poké Ball in the
 * right hand. Poses are joint angles blended every frame.
 *
 * Units: the trainer is about 2.1 tall, feet on y = 0, facing +z.
 */

export interface TrainerModel {
  root: THREE.Group;
  /** Advances the animation to time `t` (seconds), easing towards `pose`. */
  update(t: number, dt: number, pose: TrainerPose): void;
  dispose(): void;
}

const HEAD_R = 0.46;
const HEAD_Y = 0.38; // head centre above the neck pivot
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Materials and helpers
// ---------------------------------------------------------------------------

class Kit {
  private mats = new Map<string, THREE.Material>();
  private geos: THREE.BufferGeometry[] = [];

  mat(hex: string, rough = 0.78, extra?: Partial<THREE.MeshStandardMaterialParameters>): THREE.Material {
    const key = `${hex}:${rough}:${extra ? JSON.stringify(extra) : ""}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: rough, metalness: 0, ...extra });
      this.mats.set(key, m);
    }
    return m;
  }

  geo<G extends THREE.BufferGeometry>(g: G): G {
    this.geos.push(g);
    return g;
  }

  mesh(g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, pos?: [number, number, number], rot?: [number, number, number], scale?: [number, number, number] | number): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geo(g), m);
    if (pos) mesh.position.set(...pos);
    if (rot) mesh.rotation.set(...rot);
    if (typeof scale === "number") mesh.scale.setScalar(scale);
    else if (scale) mesh.scale.set(...scale);
    parent.add(mesh);
    return mesh;
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats.values()) m.dispose();
  }
}

const group = (parent: THREE.Object3D, pos: [number, number, number] = [0, 0, 0]) => {
  const g = new THREE.Group();
  g.position.set(...pos);
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

/** A point on the head's surface (head-local), `lift` out from it, and its outward normal. */
function onHead(x: number, y: number, lift = 0): { p: THREE.Vector3; n: THREE.Vector3 } {
  const n = new THREE.Vector3(x, y, Math.sqrt(Math.max(0.0001, 1 - x * x - y * y))).normalize();
  const p = n.clone().multiplyScalar(HEAD_R + lift);
  p.y *= 0.95;
  p.y += HEAD_Y;
  return { p, n };
}

function lookAlong(obj: THREE.Object3D, n: THREE.Vector3) {
  obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
}

// Lathe profiles: [radius, y] from the bottom up.
const lathe = (points: [number, number][], phiStart = 0, phiLength = TAU, segments = 40) =>
  new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
    phiStart,
    phiLength,
  );

// ---------------------------------------------------------------------------
// The Poké Ball (ours: red and white halves, black band, button)
// ---------------------------------------------------------------------------

function buildBall(kit: Kit, kind: TrainerConfig["ball"], r = 0.12): THREE.Group {
  const ball = new THREE.Group();
  const top = { poke: "#e3262f", great: "#2f6fe0", ultra: "#24252b", master: "#7b3fc6" }[kind];
  const gloss = { roughness: 0.32 } as const;
  kit.mesh(new THREE.SphereGeometry(r, 32, 16, 0, TAU, 0, Math.PI / 2), kit.mat(top, 0.32), ball);
  kit.mesh(new THREE.SphereGeometry(r, 32, 16, 0, TAU, Math.PI / 2, Math.PI / 2), kit.mat("#f6f6f2", 0.35), ball);
  kit.mesh(new THREE.CylinderGeometry(r * 1.012, r * 1.012, r * 0.16, 32), kit.mat("#1b1b1f", 0.5), ball);
  // The button faces +z.
  kit.mesh(new THREE.CylinderGeometry(r * 0.34, r * 0.34, r * 0.16, 24), kit.mat("#1b1b1f", 0.5), ball, [0, 0, r * 0.96], [Math.PI / 2, 0, 0]);
  kit.mesh(new THREE.CylinderGeometry(r * 0.22, r * 0.22, r * 0.2, 24), kit.mat("#ffffff", 0.25, gloss), ball, [0, 0, r * 1.0], [Math.PI / 2, 0, 0]);
  if (kind === "great") {
    for (const s of [-1, 1]) kit.mesh(new THREE.SphereGeometry(r * 0.42, 16, 8), kit.mat("#e3262f", 0.35), ball, [s * r * 0.62, r * 0.55, 0], [0, 0, s * 0.9], [0.55, 0.35, 1]);
  } else if (kind === "ultra") {
    for (const s of [-1, 1]) {
      kit.mesh(new THREE.TorusGeometry(r * 1.0, r * 0.1, 8, 24, Math.PI / 2.3), kit.mat("#f2c230", 0.35), ball, [s * r * 0.45, 0, 0], [0, Math.PI / 2, Math.PI / 2 - 0.2 + (s > 0 ? 0.4 : 0)], [1, 1, 1]);
    }
  } else if (kind === "master") {
    for (const s of [-1, 1]) kit.mesh(new THREE.SphereGeometry(r * 0.26, 16, 8), kit.mat("#ef6fb0", 0.35), ball, [s * r * 0.62, r * 0.66, r * 0.25]);
    kit.mesh(new THREE.TorusGeometry(r * 0.22, r * 0.05, 6, 16, Math.PI), kit.mat("#ffffff", 0.35), ball, [0, r * 0.6, r * 0.8], [-0.6, 0, 0]);
  }
  return ball;
}

// ---------------------------------------------------------------------------
// The trainer
// ---------------------------------------------------------------------------

export function buildTrainer(cfg: TrainerConfig): TrainerModel {
  const kit = new Kit();
  const skin = skinHex(cfg.skin);
  const hairC = hairHex(cfg.hairColor);
  const top = colorHex(cfg.topColor);
  const accent = colorHex(cfg.accent);
  const bottomsC = colorHex(cfg.bottomsColor);
  const shoesC = colorHex(cfg.shoesColor);
  const hatC = colorHex(cfg.hatColor);
  const packC = colorHex(cfg.packColor);
  const slim = cfg.body === "slim";

  const mSkin = kit.mat(skin, 0.7);
  const mHair = kit.mat(hairC, 0.55);
  const mTop = kit.mat(top, 0.82);
  const mAccent = kit.mat(accent, 0.8);
  const mBottoms = kit.mat(bottomsC, 0.85);
  const mShoes = kit.mat(shoesC, 0.6);
  const mSole = kit.mat("#f4f2ec", 0.7);
  const mDark = kit.mat("#2b2a30", 0.6);
  const mHat = kit.mat(hatC, 0.75);
  const mPack = kit.mat(packC, 0.75);

  const root = new THREE.Group();
  const body = group(root);
  const hips = group(body, [0, 0.42, 0]);
  const torso = group(hips, [0, 0.12, 0]);
  const neck = group(torso, [0, 0.5, 0]);
  const head = group(neck);

  // ---- torso and top ----
  const w = slim ? 0.92 : 1;
  const torsoProfile: [number, number][] = [
    [0.255 * (slim ? 0.97 : 1), 0],
    [0.27 * (slim ? 0.96 : 1), 0.08],
    [0.285 * w, 0.24],
    [0.272 * w, 0.36],
    [0.232 * w, 0.44],
    [0.14, 0.5],
    [0.001, 0.53],
  ];
  const torsoGeo = () => lathe(torsoProfile);
  const shell = (gap: number, extend = 0): THREE.BufferGeometry => {
    const pts = torsoProfile.slice(0, -1).map(([r, y]) => [r + 0.018, y] as [number, number]);
    if (extend) pts.unshift([0.34, -extend], [0.3, -extend * 0.5]);
    return lathe(pts, gap, TAU - gap * 2);
  };
  const flat: [number, number, number] = [1, 1, 0.82];

  const fullTop = cfg.top === "hoodie" || cfg.top === "track" || cfg.top === "tee";
  kit.mesh(torsoGeo(), fullTop ? mTop : mAccent, torso, undefined, undefined, flat);
  if (cfg.top === "jacket" || cfg.top === "vest" || cfg.top === "coat") {
    kit.mesh(shell(cfg.top === "vest" ? 0.42 : 0.36, cfg.top === "coat" ? 0.36 : 0), mTop, torso, [0, cfg.top === "coat" ? 0 : -0.01, 0], undefined, [1, 1, 0.84]).material = kit.mat(top, 0.82, { side: THREE.DoubleSide });
    // Collar.
    if (cfg.top !== "vest") kit.mesh(new THREE.TorusGeometry(0.15, 0.045, 10, 24, Math.PI * 1.4), mTop, torso, [0, 0.46, -0.01], [Math.PI / 2 - 0.25, 0, Math.PI * 0.8], [1, 0.82, 1]);
  }
  if (cfg.top === "tee") {
    kit.mesh(new THREE.TorusGeometry(0.12, 0.022, 8, 24), mAccent, torso, [0, 0.47, 0.01], [Math.PI / 2 - 0.2, 0, 0], [1, 0.8, 1]);
    // A small round badge on the chest.
    const b = onTorso(0.12, 0.33);
    kit.mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 20), mAccent, torso, [b.x, 0.33, b.z], [Math.PI / 2, 0, -0.35]);
  }
  if (cfg.top === "hoodie") {
    kit.mesh(new THREE.TorusGeometry(0.17, 0.075, 12, 24), mTop, torso, [0, 0.47, -0.1], [Math.PI / 2 - 0.5, 0, 0], [1, 0.9, 1]);
    kit.mesh(new RoundedBoxGeometry(0.3, 0.12, 0.06, 3, 0.03), kit.mat(shade(top, -0.06), 0.85), torso, [0, 0.12, 0.215], [0.12, 0, 0]);
    for (const s of [-1, 1]) kit.mesh(new THREE.CapsuleGeometry(0.011, 0.1, 4, 8), kit.mat("#f4f4f0"), torso, [s * 0.05, 0.36, 0.225], [0.2, 0, 0]);
  }
  if (cfg.top === "track") {
    kit.mesh(new THREE.BoxGeometry(0.018, 0.4, 0.02), mAccent, torso, [0, 0.24, 0.232], [-0.06, 0, 0]);
    kit.mesh(new THREE.TorusGeometry(0.135, 0.04, 10, 24), mAccent, torso, [0, 0.46, 0], [Math.PI / 2 - 0.2, 0, 0], [1, 0.84, 1]);
  }
  if (cfg.top === "jacket" || cfg.top === "coat") {
    // Zip edges down the open front.
    for (const s of [-1, 1]) kit.mesh(new THREE.BoxGeometry(0.02, 0.4, 0.02), kit.mat(shade(top, 0.12)), torso, [s * 0.085, 0.23, 0.228], [-0.04, 0, s * 0.03]);
  }
  if (cfg.top === "vest") {
    for (const s of [-1, 1]) kit.mesh(new RoundedBoxGeometry(0.1, 0.08, 0.04, 2, 0.015), kit.mat(shade(top, -0.08)), torso, [s * 0.15, 0.12, 0.2], [0.05, s * 0.45, 0]);
  }

  function onTorso(x: number, y: number) {
    // Approximate front surface of the torso at height y (local), for decals.
    const r = 0.28 * w;
    return { x, z: Math.sqrt(Math.max(0, r * r - x * x)) * 0.82 + 0.008, y };
  }

  // ---- belt with Poké Balls ----
  kit.mesh(new THREE.TorusGeometry(0.262 * (slim ? 0.97 : 1), 0.032, 10, 40), mDark, torso, [0, 0.035, 0], [Math.PI / 2, 0, 0], [1, 0.82, 1]);
  kit.mesh(new RoundedBoxGeometry(0.08, 0.06, 0.03, 2, 0.01), kit.mat("#d9b54a", 0.4), torso, [0, 0.035, 0.222]);
  for (const a of [1.15, 1.55, 1.95]) {
    const b = buildBall(kit, "poke", 0.045);
    b.position.set(Math.sin(a) * 0.275, 0.03, Math.cos(a) * 0.235);
    b.rotation.y = a;
    torso.add(b);
  }

  // ---- neck and head ----
  kit.mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.1, 16), mSkin, neck, [0, 0.0, 0]);
  kit.mesh(new THREE.SphereGeometry(HEAD_R, 40, 32), mSkin, head, [0, HEAD_Y, 0], undefined, [1, 0.95, 0.96]);
  for (const s of [-1, 1]) kit.mesh(new THREE.SphereGeometry(0.085, 16, 12), mSkin, head, [s * HEAD_R * 0.97, HEAD_Y - 0.03, 0.0], undefined, [0.55, 1, 0.8]);
  buildFace(kit, head, cfg, hairC);
  const hatted = cfg.hat !== "none";
  const ponytail = buildHair(kit, head, cfg, mHair, hatted);
  if (hatted) buildHat(kit, head, cfg, mHat, mAccent);

  // ---- arms ----
  const longSleeves = cfg.top !== "tee" && cfg.top !== "vest";
  const sleeveMat = cfg.top === "vest" ? mAccent : mTop;
  const handMat = cfg.gloves === "full" ? mAccent : mSkin;
  const arms = ([1, -1] as const).map((s) => {
    const shoulder = group(torso, [s * (slim ? 0.27 : 0.285), 0.4, 0]);
    kit.mesh(new THREE.SphereGeometry(0.085, 16, 12), longSleeves || cfg.top === "tee" || cfg.top === "vest" ? sleeveMat : mSkin, shoulder);
    kit.mesh(new THREE.CapsuleGeometry(0.07, 0.11, 6, 14), longSleeves ? sleeveMat : mSkin, shoulder, [0, -0.11, 0]);
    if (!longSleeves) kit.mesh(new THREE.CylinderGeometry(0.088, 0.096, 0.13, 16), sleeveMat, shoulder, [0, -0.05, 0]);
    if (cfg.top === "track") kit.mesh(new THREE.BoxGeometry(0.02, 0.2, 0.03), mAccent, shoulder, [s * 0.068, -0.1, 0]);
    const elbow = group(shoulder, [0, -0.2, 0]);
    kit.mesh(new THREE.CapsuleGeometry(0.064, 0.1, 6, 14), longSleeves ? sleeveMat : mSkin, elbow, [0, -0.08, 0]);
    if (cfg.top === "track") kit.mesh(new THREE.BoxGeometry(0.02, 0.15, 0.03), mAccent, elbow, [s * 0.062, -0.07, 0]);
    if (longSleeves) kit.mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.04, 16), cfg.top === "hoodie" ? kit.mat(shade(top, -0.07)) : mAccent, elbow, [0, -0.16, 0]);
    const hand = group(elbow, [0, -0.215, 0]);
    kit.mesh(new THREE.SphereGeometry(0.082, 18, 14), handMat, hand, undefined, undefined, [0.95, 1.05, 0.85]);
    // Thumb.
    kit.mesh(new THREE.SphereGeometry(0.032, 10, 8), handMat, hand, [-s * 0.01, 0.0, 0.07]);
    if (cfg.gloves === "fingerless") kit.mesh(new THREE.CylinderGeometry(0.086, 0.08, 0.08, 16), mAccent, hand, [0, 0.025, 0]);
    if (cfg.gloves !== "none") kit.mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.04, 16), mDark, hand, [0, 0.07, 0]);
    return { shoulder, elbow, hand };
  });
  const [armL, armR] = arms;

  // ---- hips, legs and shoes ----
  const trunk: [number, number][] = [
    [0.001, -0.07],
    [0.19, -0.06],
    [0.25, -0.01],
    [0.26 * (slim ? 0.97 : 1), 0.08],
    [0.255 * (slim ? 0.97 : 1), 0.15],
  ];
  kit.mesh(lathe(trunk), mBottoms, hips, undefined, undefined, flat);
  if (cfg.bottoms === "skirt") {
    kit.mesh(new THREE.CylinderGeometry(0.255, 0.37, 0.24, 32, 1, true), kit.mat(bottomsC, 0.85, { side: THREE.DoubleSide }), hips, [0, -0.06, 0], undefined, [1, 1, 0.86]);
  }
  const legs = ([1, -1] as const).map((s) => {
    const leg = group(hips, [s * 0.125, 0, 0]);
    const covered = cfg.bottoms === "pants" || cfg.bottoms === "joggers";
    kit.mesh(new THREE.CapsuleGeometry(0.092, 0.2, 6, 14), covered ? mBottoms : mSkin, leg, [0, -0.16, 0]);
    if (cfg.bottoms === "shorts") kit.mesh(new THREE.CylinderGeometry(0.118, 0.122, 0.15, 18), mBottoms, leg, [0, -0.06, 0]);
    if (cfg.bottoms === "joggers") kit.mesh(new THREE.CylinderGeometry(0.098, 0.098, 0.05, 18), kit.mat(shade(bottomsC, -0.07)), leg, [0, -0.29, 0]);
    if (!covered && cfg.shoes !== "boots") kit.mesh(new THREE.CylinderGeometry(0.096, 0.094, 0.07, 18), kit.mat("#f5f5f2"), leg, [0, -0.28, 0]);
    const foot = group(leg, [0, -0.33, 0]);
    if (cfg.shoes === "boots") {
      kit.mesh(new THREE.CylinderGeometry(0.108, 0.112, 0.17, 18), mShoes, foot, [0, 0.04, 0]);
      kit.mesh(new THREE.TorusGeometry(0.108, 0.018, 8, 20), kit.mat(shade(shoesC, -0.12)), foot, [0, 0.12, 0], [Math.PI / 2, 0, 0]);
    }
    if (cfg.shoes === "hightops") kit.mesh(new THREE.CylinderGeometry(0.106, 0.11, 0.11, 18), mShoes, foot, [0, 0.03, 0]);
    kit.mesh(new THREE.SphereGeometry(1, 20, 14), mShoes, foot, [0, -0.005, 0.04], undefined, [0.112, 0.082, 0.165]);
    kit.mesh(new THREE.CylinderGeometry(1, 1, 1, 22), cfg.shoes === "boots" ? kit.mat("#3a2a20") : mSole, foot, [0, -0.06, 0.04], undefined, [0.118, 0.04, 0.172]);
    if (cfg.shoes !== "boots") kit.mesh(new THREE.SphereGeometry(1, 14, 10), mSole, foot, [0, -0.03, 0.15], undefined, [0.07, 0.04, 0.05]);
    return { leg, foot };
  });
  const [legL, legR] = legs;

  // ---- bags ----
  if (cfg.pack === "classic" || cfg.pack === "explorer") {
    const big = cfg.pack === "explorer";
    const pack = group(torso, [0, 0.24, -0.27]);
    kit.mesh(new RoundedBoxGeometry(big ? 0.46 : 0.4, big ? 0.48 : 0.42, big ? 0.24 : 0.18, 4, 0.07), mPack, pack, [0, 0, -0.05]);
    kit.mesh(new RoundedBoxGeometry(big ? 0.44 : 0.38, 0.17, big ? 0.25 : 0.19, 3, 0.06), kit.mat(shade(packC, -0.08)), pack, [0, 0.14, -0.05]);
    kit.mesh(new RoundedBoxGeometry(0.24, 0.13, 0.06, 3, 0.03), kit.mat(shade(packC, 0.06)), pack, [0, -0.1, big ? -0.19 : -0.16]);
    kit.mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.06, 10), kit.mat("#d9b54a", 0.4), pack, [0, 0.06, big ? -0.18 : -0.15], [Math.PI / 2, 0, 0]);
    if (big) {
      kit.mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.52, 20), mAccent, pack, [0, 0.29, -0.06], [0, 0, Math.PI / 2]);
      for (const s of [-1, 1]) kit.mesh(new THREE.TorusGeometry(0.098, 0.012, 6, 20), mDark, pack, [s * 0.15, 0.29, -0.06], [0, Math.PI / 2, 0]);
    }
    // Shoulder straps over the front.
    const strap = kit.mat(shade(packC, -0.15), 0.7);
    for (const s of [-1, 1]) {
      kit.mesh(new RoundedBoxGeometry(0.06, 0.36, 0.03, 2, 0.012), strap, torso, [s * 0.155, 0.27, 0.238 * w], [-0.2, 0, 0]);
      kit.mesh(new RoundedBoxGeometry(0.06, 0.03, 0.42, 2, 0.012), strap, torso, [s * 0.155, 0.46, 0.0], [0, 0, 0]);
      kit.mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.07, 10), kit.mat("#d9b54a", 0.4), torso, [s * 0.155, 0.22, 0.25 * w], [0, 0, Math.PI / 2]);
    }
  } else if (cfg.pack === "satchel") {
    kit.mesh(new THREE.TorusGeometry(0.3, 0.02, 8, 48), kit.mat(shade(packC, -0.15)), torso, [0, 0.24, 0], [Math.PI / 2, 0.75, 0], [0.98, 0.82, 1]);
    const bag = group(torso, [-0.3, -0.04, 0.08]);
    bag.rotation.y = -0.9;
    kit.mesh(new RoundedBoxGeometry(0.27, 0.21, 0.1, 3, 0.04), mPack, bag);
    kit.mesh(new RoundedBoxGeometry(0.27, 0.12, 0.105, 3, 0.04), kit.mat(shade(packC, -0.08)), bag, [0, 0.05, 0.004]);
    kit.mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.03, 10), kit.mat("#d9b54a", 0.4), bag, [0, 0.0, 0.06], [Math.PI / 2, 0, 0]);
  }

  // ---- the Poké Ball in the right hand ----
  const ball = buildBall(kit, cfg.ball, 0.115);
  root.add(ball);

  // ---- animation ----
  const P = poseTargets();
  const cur = { ...P.idle };
  const tmp = new THREE.Vector3();
  let lastToss = 0;

  function update(t: number, dt: number, pose: TrainerPose) {
    const target = P[pose];
    const k = 1 - Math.exp(-dt * 7);
    for (const key of Object.keys(cur) as (keyof Joints)[]) cur[key] += (target[key] - cur[key]) * k;

    const breathe = Math.sin(t * 2.1);
    const fight = pose === "fight";
    const wave = pose === "wave";
    const bounce = fight ? Math.abs(Math.sin(t * 4.2)) * 0.035 : wave ? Math.abs(Math.sin(t * 3)) * 0.02 : 0;

    body.position.y = cur.drop + bounce + breathe * 0.004;
    hips.rotation.y = cur.twist * 0.4;
    torso.rotation.set(cur.lean + breathe * 0.012, cur.twist * 0.6, 0);
    torso.scale.set(1 + breathe * 0.006, 1 + breathe * 0.01, 1 + breathe * 0.006);
    neck.rotation.set(-cur.lean * 0.6 + Math.sin(t * 0.7) * 0.03, -cur.twist + Math.sin(t * 0.45) * 0.08 * (fight ? 0.2 : 1), cur.headTilt + Math.sin(t * 0.9) * 0.035);

    armL.shoulder.rotation.set(cur.lsX + breathe * 0.02, cur.lsY, cur.lsZ + breathe * 0.02);
    armL.elbow.rotation.set(cur.leX, 0, cur.leZ + (wave ? Math.sin(t * 8) * 0.38 : 0));
    armR.shoulder.rotation.set(cur.rsX + breathe * 0.02, cur.rsY, cur.rsZ - breathe * 0.02);
    armR.elbow.rotation.set(cur.reX + (fight ? Math.sin(t * 4.2) * 0.06 : 0), 0, cur.reZ);
    armL.hand.rotation.set(0, 0, wave ? 0.2 : 0);

    legL.leg.rotation.set(cur.legX, 0, cur.legZ);
    legR.leg.rotation.set(-cur.legX * 0.6, 0, -cur.legZ);
    legL.foot.rotation.set(-cur.legX, 0, -cur.legZ);
    legR.foot.rotation.set(cur.legX * 0.6, 0, cur.legZ);

    if (ponytail) ponytail.rotation.set(-0.35 + Math.sin(t * 2.2) * 0.08 - bounce * 2, 0, Math.sin(t * 1.6) * 0.1);

    // The ball sits in the right hand; idle tosses it up now and then.
    root.updateMatrixWorld(true);
    armR.hand.getWorldPosition(tmp);
    root.worldToLocal(tmp);
    ball.position.copy(tmp);
    ball.position.y += 0.1;
    ball.position.z += 0.05;
    const period = 3.4;
    const phase = (t % period) / period;
    if (pose === "idle" && phase < 0.32) {
      const u = phase / 0.32;
      ball.position.y += Math.sin(u * Math.PI) * 0.42;
      ball.rotation.set(-u * TAU * 1.5, 0, 0);
      lastToss = t;
    } else {
      const settle = Math.max(0, 1 - (t - lastToss) * 3);
      ball.rotation.set(0, Math.sin(t * 1.3) * 0.5, Math.sin(t * 2) * 0.08 * (1 - settle));
    }
  }

  update(0, 10, "idle");

  return {
    root,
    update,
    dispose: () => kit.dispose(),
  };
}

// ---------------------------------------------------------------------------
// Face, hair and hats
// ---------------------------------------------------------------------------

function buildFace(kit: Kit, head: THREE.Group, cfg: TrainerConfig, hairC: string) {
  const iris = kit.mat("#2a1c18", 0.3);
  const white = kit.mat("#ffffff", 0.2);
  const ex = 0.33;
  const ey = -0.09;
  for (const s of [-1, 1]) {
    const { p, n } = onHead(s * ex, ey, -0.012);
    if (cfg.eyes === "happy") {
      const arc = kit.mesh(new THREE.TorusGeometry(0.05, 0.016, 8, 18, Math.PI), iris, head, [p.x, p.y + 0.0, p.z + 0.005]);
      lookAlong(arc, n);
    } else {
      const eye = new THREE.Group();
      eye.position.copy(p);
      lookAlong(eye, n);
      head.add(eye);
      const tall = cfg.eyes === "focused" ? 0.92 : 1.22;
      kit.mesh(new THREE.SphereGeometry(0.068, 20, 16), iris, eye, [0, 0, 0], undefined, [0.82, tall, 0.38]);
      kit.mesh(new THREE.SphereGeometry(0.022, 10, 8), white, eye, [-0.018 * s + 0.0, 0.03, 0.022]);
      kit.mesh(new THREE.SphereGeometry(0.011, 8, 6), white, eye, [0.016 * s, -0.026, 0.022]);
    }
    // Brows.
    const b = onHead(s * 0.32, 0.12, 0.0);
    const brow = kit.mesh(new THREE.CapsuleGeometry(0.012, 0.07, 4, 8), kit.mat(shade(hairC, -0.05), 0.6), head, [b.p.x, b.p.y, b.p.z]);
    lookAlong(brow, b.n);
    brow.rotateZ(Math.PI / 2 + s * (cfg.eyes === "focused" ? 0.35 : -0.12));
    // Blush.
    const c = onHead(s * 0.5, -0.2, -0.004);
    const blush = kit.mesh(new THREE.CircleGeometry(0.06, 20), kit.mat("#ff8f8f", 0.9, { transparent: true, opacity: 0.45, depthWrite: false }), head, [c.p.x, c.p.y, c.p.z], undefined, [1.3, 0.75, 1]);
    lookAlong(blush, c.n);
    blush.scale.set(1.3, 0.75, 1);
  }
  const m = onHead(0, -0.28, -0.004);
  const mouth = kit.mesh(new THREE.TorusGeometry(0.04, 0.011, 6, 14, Math.PI), kit.mat("#7a2f2c", 0.5), head, [m.p.x, m.p.y + 0.02, m.p.z]);
  lookAlong(mouth, m.n);
  mouth.rotateZ(Math.PI);
  if (cfg.eyes === "focused") mouth.scale.set(0.8, 0.5, 1);
}

/** Returns the ponytail's pivot (it sways). */
function buildHair(kit: Kit, head: THREE.Group, cfg: TrainerConfig, m: THREE.Material, hatted: boolean): THREE.Group | null {
  const hairGroup = group(head, [0, HEAD_Y, 0]);
  const R = HEAD_R;
  const capR = cfg.hair === "buzz" ? R * 1.025 : R * 1.06;
  const theta = cfg.hair === "buzz" ? 1.65 : 1.82;
  const cap = kit.mesh(new THREE.SphereGeometry(capR, 40, 24, 0, TAU, 0, theta), m, hairGroup, [0, 0, 0], [-0.52, 0, 0], [1, 0.97, 0.98]);
  cap.position.y = 0.01;

  const out = (polar: number, azimuth: number, lift: number) => {
    // Direction from the head centre: polar from +y, azimuth from +z towards +x.
    const d = new THREE.Vector3(Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth));
    return { d, p: d.clone().multiplyScalar(R + lift) };
  };
  const fringe = (count: number, spread: number, size: number, high = 0.27) => {
    // Under a hat the fringe sits lower, peeking out below the brim.
    const y = hatted ? Math.min(high, 0.25) : high;
    for (let i = 0; i < count; i++) {
      const x = (i / (count - 1) - 0.5) * spread;
      const sp = new THREE.Vector3(x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y))).normalize().multiplyScalar(R * 1.0);
      const lock = kit.mesh(new THREE.SphereGeometry(hatted ? size * 0.85 : size, 16, 12), m, hairGroup, [sp.x, sp.y, sp.z], undefined, [1, hatted ? 0.7 : 0.8, 0.55]);
      lookAlong(lock, sp.clone().normalize());
      lock.rotateZ(x * 1.2);
    }
  };
  const sides = (low: number) => {
    for (const s of [-1, 1]) kit.mesh(new THREE.SphereGeometry(0.12, 16, 12), m, hairGroup, [s * R * 0.9, -low, 0.05], undefined, [0.45, 1.1, 0.75]);
  };

  let tail: THREE.Group | null = null;
  switch (cfg.hair) {
    case "short":
      fringe(4, 0.7, 0.13);
      sides(0.05);
      break;
    case "buzz":
      break;
    case "spiky": {
      const spikes: [number, number, number][] = [
        // polar, azimuth, length
        [0.35, 0.2, 0.3],
        [0.6, -0.9, 0.3],
        [0.6, 0.9, 0.3],
        [0.85, Math.PI - 0.5, 0.34],
        [0.85, Math.PI + 0.5, 0.34],
        [1.25, Math.PI, 0.32],
        [1.2, Math.PI - 1.2, 0.3],
        [1.2, Math.PI + 1.2, 0.3],
        [1.55, Math.PI - 0.6, 0.28],
        [1.55, Math.PI + 0.6, 0.28],
        [1.35, 1.75, 0.24],
        [1.35, -1.75, 0.24],
      ];
      for (const [polar, az, len] of spikes) {
        if (hatted && polar < 1.0) continue;
        const { d, p } = out(polar, az, -0.02);
        // Lean every spike back and a little down, like wind-swept hair.
        const dir = d.clone().add(new THREE.Vector3(0, -0.25, -0.55)).normalize();
        const cone = kit.mesh(new THREE.ConeGeometry(0.11, len, 10), m, hairGroup, [p.x + dir.x * len * 0.4, p.y + dir.y * len * 0.4, p.z + dir.z * len * 0.4]);
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      }
      // Bangs: three points over the forehead.
      for (const x of [-0.22, 0.02, 0.24]) {
        const sp = new THREE.Vector3(x, hatted ? 0.3 : 0.33, 0.9).normalize().multiplyScalar(R * 1.02);
        const cone = kit.mesh(new THREE.ConeGeometry(0.085, hatted ? 0.17 : 0.24, 10), m, hairGroup, [sp.x, sp.y - 0.03, sp.z + 0.02]);
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x * 0.6, -1, 0.35).normalize());
      }
      sides(0.06);
      break;
    }
    case "swept": {
      const sp = new THREE.Vector3(0.12, 0.42, 0.9).normalize().multiplyScalar(R * 0.98);
      const swoop = kit.mesh(new THREE.SphereGeometry(0.22, 24, 16), m, hairGroup, [sp.x, sp.y, sp.z], undefined, [1.45, 0.55, 0.6]);
      lookAlong(swoop, sp.clone().normalize());
      swoop.rotateZ(-0.35);
      sides(0.05);
      if (!hatted) kit.mesh(new THREE.SphereGeometry(0.18, 16, 12), m, hairGroup, [0.05, R * 0.98, -0.05], [0.3, 0, -0.4], [1.3, 0.6, 1.2]);
      break;
    }
    case "bob":
    case "long": {
      const g = 0.8;
      const lower = cfg.hair === "long" ? 2.55 : 2.25;
      kit.mesh(new THREE.SphereGeometry(R * 1.1, 40, 24, Math.PI / 2 + g, TAU - 2 * g, 0.25, lower - 0.25), kit.mat((m as THREE.MeshStandardMaterial).color.getStyle(), 0.55, { side: THREE.DoubleSide }), hairGroup, [0, 0, -0.01], undefined, [1, 1, 1]);
      fringe(5, 0.78, 0.12, 0.3);
      if (cfg.hair === "long") {
        kit.mesh(new THREE.CapsuleGeometry(0.2, 0.22, 8, 16), m, hairGroup, [0, -0.55, -0.24], [0.25, 0, 0], [1.35, 1, 0.55]);
      }
      break;
    }
    case "ponytail": {
      fringe(4, 0.7, 0.125);
      sides(0.04);
      tail = group(hairGroup, [0, 0.12, -R * 0.98]);
      kit.mesh(new THREE.TorusGeometry(0.06, 0.025, 8, 16), kit.mat(colorHex(cfg.accent), 0.6), tail, [0, 0, -0.02], [0.3, 0, 0]);
      kit.mesh(new THREE.CapsuleGeometry(0.1, 0.22, 8, 14), m, tail, [0, -0.18, -0.1], [0.45, 0, 0], [1, 1, 0.85]);
      kit.mesh(new THREE.SphereGeometry(0.09, 12, 10), m, tail, [0, -0.36, -0.17]);
      break;
    }
    case "buns": {
      fringe(4, 0.7, 0.12);
      sides(0.05);
      if (!hatted || cfg.hat === "visor") {
        for (const s of [-1, 1]) {
          const { p } = out(0.62, s * 1.25, 0.06);
          kit.mesh(new THREE.SphereGeometry(0.16, 20, 16), m, hairGroup, [p.x, p.y, p.z - 0.05]);
          kit.mesh(new THREE.TorusGeometry(0.1, 0.025, 8, 16), kit.mat(colorHex(cfg.accent), 0.6), hairGroup, [p.x * 0.88, p.y * 0.88, p.z * 0.88 - 0.05], [Math.PI / 2 + 0.6, s * 0.6, 0]);
        }
      }
      break;
    }
    case "curly": {
      const n = 46;
      for (let i = 0; i < n; i++) {
        const polar = Math.acos(1 - (i + 0.5) / n * 1.45);
        const az = i * 2.39996;
        // Skip the face.
        const front = Math.cos(az) > 0.35 && polar > 1.05;
        if (front) continue;
        if (hatted && polar < 1.1) continue;
        const { p } = out(polar, az, 0.0);
        const tilt = new THREE.Vector3(p.x, p.y, p.z).applyAxisAngle(new THREE.Vector3(1, 0, 0), -0.3);
        kit.mesh(new THREE.SphereGeometry(0.11, 12, 10), m, hairGroup, [tilt.x, tilt.y, tilt.z]);
      }
      fringe(5, 0.75, 0.1, 0.33);
      break;
    }
  }
  return tail;
}

function buildHat(kit: Kit, head: THREE.Group, cfg: TrainerConfig, m: THREE.Material, accent: THREE.Material) {
  // Hats sit high on the big head so the brim stays clear of the eyes.
  const hat = group(head, [0, HEAD_Y + 0.07, 0]);
  const R = HEAD_R * 1.1;
  const kind = cfg.hat;
  const gold = kit.mat("#e9b526", 0.35);
  const white = kit.mat("#f6f6f2", 0.7);

  const dome = (scaleY = 0.9, extra = 0) => kit.mesh(new THREE.SphereGeometry(R, 40, 20, 0, TAU, 0, Math.PI / 2 + extra), m, hat, [0, 0.08, -0.02], [-0.22, 0, 0], [1, scaleY, 1]);

  if (kind === "cap" || kind === "backcap" || kind === "ace" || kind === "champion") {
    const cap = group(hat);
    if (kind === "backcap") cap.rotation.y = Math.PI;
    kit.mesh(new THREE.SphereGeometry(R, 40, 20, 0, TAU, 0, Math.PI / 2), m, cap, [0, 0.08, -0.02], [-0.22, 0, 0], [1, 0.9, 1]);
    const brimMat = kind === "ace" ? accent : kind === "champion" ? kit.mat(shade((m as THREE.MeshStandardMaterial).color.getStyle(), -0.1)) : m;
    kit.mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 36), brimMat, cap, [0, 0.1, R * 0.92], [0.22, 0, 0], [1, 1, 0.78]);
    if (kind === "champion") kit.mesh(new THREE.TorusGeometry(0.3, 0.016, 8, 40, Math.PI), gold, cap, [0, 0.1, R * 0.92], [Math.PI / 2 + 0.22, 0, 0], [1, 0.78, 1]);
    // Front panel with a round emblem.
    const front = new THREE.Vector3(0, 0.55, 0.83).normalize();
    const panel = kit.mesh(new THREE.SphereGeometry(0.17, 24, 16), kind === "champion" ? kit.mat("#1d1e22", 0.6) : white, cap, [front.x * R * 0.95, 0.08 + front.y * R * 0.85, front.z * R * 0.95 - 0.02], undefined, [1, 0.72, 0.3]);
    lookAlong(panel, front);
    panel.scale.set(1, 0.72, 0.3);
    kit.mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 20), kind === "champion" ? gold : accent, cap, [front.x * R, 0.08 + front.y * R * 0.9 + 0.005, front.z * R + 0.03], [Math.PI / 2 - 0.55, 0, 0]);
    if (kind === "ace") kit.mesh(new THREE.TorusGeometry(R * 0.98, 0.03, 8, 40, Math.PI), accent, cap, [0, 0.08, -0.02], [0, Math.PI / 2, 0], [1, 0.92, 1]);
    kit.mesh(new THREE.SphereGeometry(0.04, 12, 10), kind === "champion" ? gold : m, cap, [0, 0.08 + R * 0.86, -0.17]);
    return;
  }
  if (kind === "beanie") {
    dome(1.05, 0.05);
    kit.mesh(new THREE.TorusGeometry(R * 0.98, 0.065, 12, 40), kit.mat(shade((m as THREE.MeshStandardMaterial).color.getStyle(), -0.08)), hat, [0, 0.07, -0.02], [Math.PI / 2 - 0.22, 0, 0]);
    kit.mesh(new THREE.SphereGeometry(0.1, 16, 12), accent, hat, [0, 0.08 + R * 1.02, -0.14]);
    return;
  }
  if (kind === "bucket") {
    dome(0.85);
    kit.mesh(new THREE.CylinderGeometry(R * 0.98, R * 1.4, 0.12, 40, 1, true), kit.mat((m as THREE.MeshStandardMaterial).color.getStyle(), 0.75, { side: THREE.DoubleSide }), hat, [0, 0.05, -0.02], [-0.22, 0, 0]);
    kit.mesh(new THREE.CylinderGeometry(R * 1.0, R * 1.0, 0.06, 40, 1, true), kit.mat(colorHex(cfg.accent), 0.75, { side: THREE.DoubleSide }), hat, [0, 0.14, -0.035], [-0.22, 0, 0]);
    return;
  }
  if (kind === "visor") {
    kit.mesh(new THREE.TorusGeometry(R * 0.95, 0.045, 10, 40), m, hat, [0, 0.18, -0.03], [Math.PI / 2 - 0.22, 0, 0]);
    kit.mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 36), accent, hat, [0, 0.16, R * 0.92], [0.22, 0, 0], [1, 1, 0.78]);
    return;
  }
  if (kind === "safari") {
    kit.mesh(new THREE.CylinderGeometry(R * 0.82, R * 1.0, 0.3, 36), m, hat, [0, 0.24, -0.04], [-0.2, 0, 0]);
    kit.mesh(new THREE.SphereGeometry(R * 0.82, 36, 12, 0, TAU, 0, Math.PI / 2), m, hat, [0, 0.39, -0.07], [-0.2, 0, 0], [1, 0.45, 1]);
    kit.mesh(new THREE.CylinderGeometry(R * 1.02, R * 1.02, 0.07, 36), accent, hat, [0, 0.14, -0.02], [-0.2, 0, 0]);
    kit.mesh(new THREE.CylinderGeometry(R * 1.6, R * 1.6, 0.03, 48), kit.mat(shade((m as THREE.MeshStandardMaterial).color.getStyle(), -0.06)), hat, [0, 0.1, -0.02], [-0.2, 0, 0]);
    return;
  }
}

// ---------------------------------------------------------------------------
// Poses
// ---------------------------------------------------------------------------

interface Joints {
  drop: number;
  lean: number;
  twist: number;
  headTilt: number;
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
}

function poseTargets(): Record<TrainerPose, Joints> {
  const idle: Joints = {
    drop: 0,
    lean: 0,
    twist: 0,
    headTilt: 0.03,
    lsX: 0.05,
    lsY: 0,
    lsZ: 0.16,
    leX: -0.2,
    leZ: 0,
    rsX: -0.3,
    rsY: 0,
    rsZ: -0.12,
    reX: -1.25,
    reZ: 0.1,
    legX: 0,
    legZ: 0.03,
  };
  return {
    idle,
    wave: {
      ...idle,
      headTilt: 0.12,
      lsX: -0.4,
      lsZ: 1.7,
      leX: 0,
      leZ: 1.25,
      rsX: -0.15,
      rsZ: -0.14,
      reX: -0.9,
    },
    fight: {
      drop: -0.035,
      lean: 0.16,
      twist: -0.3,
      headTilt: -0.04,
      lsX: -1.45,
      lsY: 0,
      lsZ: 0.18,
      leX: -0.15,
      leZ: 0,
      rsX: 0.35,
      rsY: 0,
      rsZ: -1.95,
      reX: 0,
      reZ: -1.15,
      legX: 0.05,
      legZ: 0.3,
    },
  };
}

/** The root's turn for each facing (the model faces +z). */
export const FACING_YAW: Record<TrainerFacing, number> = { front: 0.2, left: -0.62, right: 0.62 };
