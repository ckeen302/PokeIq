import * as THREE from "three";
import { STREET, boulevardEnd, wrap, type WorldPlan } from "@/lib/sizes/world";
import { Buckets, Geo, rng } from "../geo";
import { cutaway, groundVariation, plazaPattern, type Shared } from "../shaders";
import type { CityQuality, CityTex } from "../kit";
import { ATLAS, BAY_M, FLOOR_M, GROUND_M, NEON, SIGNS, facadeAtlas, signSheet, towerTexture } from "./facade";

/**
 * Nimbasa's streets: the main promenade with its two street walls of
 * modern buildings (pale panels and glass, lit windows, bright shopfronts
 * under neon bands, blade signs and rooftop signs), the ring of lower
 * buildings round the great plaza, the city beyond in blocks (towers rising
 * behind the Ferris wheel, lower on the camera's side so nothing stands in
 * the finale's way), and the ground: the promenade's pale stone with the
 * line's band, roads and pavements, the plaza's patterned paving with the
 * giants' ring promenade, lit fountains. At night: lamps with pools of
 * light under them and trees strung with fairy lights. Built once per line
 * as merged meshes in chunks; venues (the stadium, the court, the theater,
 * the station and the amusement park) are built by venues.ts and kept clear
 * here through `keepOut`.
 */

const CHUNK = 240;
const WALLS = ["#ffffff", "#ffe6ef", "#e4f1ff", "#fff1d6", "#ece4ff", "#e2fbef", "#f2f2f2", "#ffd9c7"].map((c) => new THREE.Color(c));
const WHITE = new THREE.Color(1, 1, 1);
/** The tallest a street-wall building gets (floors over the ground floor): under the Lumiose roofline the camera's tilt is set for. */
const MAX_STREET_FLOORS = 6;

/** Places the city keeps clear for a venue: circles and thick segments on the ground. */
export interface KeepOut {
  circles: { x: number; z: number; r: number }[];
  segments: { ax: number; az: number; bx: number; bz: number; r: number }[];
}

export const keptOut = (k: KeepOut, x: number, z: number, pad = 0) =>
  k.circles.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + pad) ||
  k.segments.some((s) => {
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / Math.max(1e-6, dx * dx + dz * dz)));
    return Math.hypot(x - (s.ax + dx * t), z - (s.az + dz * t)) < s.r + pad;
  });

interface Spot { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; d: THREE.Vector3; uv: [number, number, number, number, number, number, number, number] }

/** What the street walls leave for the instanced props: sign quads and where the light falls. */
interface Extras {
  signs: Spot[];
  pools: { x: number; z: number; r: number; color: THREE.Color }[];
}

function facadeQuad(g: Geo, o: THREE.Vector3, dir: THREE.Vector3, u0: number, u1: number, y0: number, y1: number, reg: { u0: number; u1: number; v0: number; v1: number }, tint: THREE.Color) {
  const a = o.clone().addScaledVector(dir, u0).setY(y0);
  const b = o.clone().addScaledVector(dir, u1).setY(y0);
  const c = o.clone().addScaledVector(dir, u1).setY(y1);
  const d = o.clone().addScaledVector(dir, u0).setY(y1);
  g.quad(a, b, c, d, [reg.u0, reg.v0, reg.u1, reg.v0, reg.u1, reg.v1, reg.u0, reg.v1], tint);
}

/** One building: shopfronts and upper floors on its front, plain floors round the rest, a flat roof with a parapet, maybe signs. */
function building(B: Buckets, X: Extras, o: THREE.Vector3, dir: THREE.Vector3, n: THREE.Vector3, bays: number, depth: number, floors: number, key: number, opts: { shops: boolean; signs: boolean; poolSide: number }) {
  const r = rng(key);
  const tint = WALLS[Math.floor(r() * WALLS.length)];
  const len = bays * BAY_M;
  const cx = o.x + dir.x * len / 2, cz = o.z + dir.z * len / 2;
  const fac = B.at("facade", cx, cz);
  const H = GROUND_M + floors * FLOOR_M;
  const column = Math.floor(r() * ATLAS.COLUMNS);
  const flip = r() < 0.5;
  // Front.
  for (let k = 0; k < bays; k++) {
    const shop = opts.shops ? Math.floor(r() * ATLAS.SHOPS) : 7;
    facadeQuad(fac, o, dir, k * BAY_M, (k + 1) * BAY_M, 0, GROUND_M, ATLAS.shop(shop), opts.shops ? WHITE : tint);
    facadeQuad(fac, o, dir, k * BAY_M, (k + 1) * BAY_M, GROUND_M, H, ATLAS.upper(column, floors, flip), tint);
  }
  // Back and ends: the same floors down to the ground.
  const back = o.clone().addScaledVector(n, -depth).addScaledVector(dir, len);
  const backDir = dir.clone().negate();
  const whole = (H / FLOOR_M);
  for (let k = 0; k < bays; k++) facadeQuad(fac, back, backDir, k * BAY_M, (k + 1) * BAY_M, 0, H, ATLAS.upper((column + 1) % 4, whole, flip), tint);
  const sideBays = Math.max(1, Math.round(depth / BAY_M)), sideW = depth / sideBays;
  for (const end of [0, 1]) {
    const e = end ? o.clone().addScaledVector(dir, len) : o.clone().addScaledVector(n, -depth);
    const sDir = end ? n.clone().negate() : n.clone();
    for (let k = 0; k < sideBays; k++) facadeQuad(fac, e, sDir, k * sideW, (k + 1) * sideW, 0, H, ATLAS.upper((column + 2) % 4, whole, k % 2 === 0), tint);
  }
  // Flat roof, a parapet, the canopy over the shops with its neon edge.
  const yaw = Math.atan2(n.x, n.z);
  const mid = o.clone().addScaledVector(dir, len / 2).addScaledVector(n, -depth / 2);
  B.at("roof", cx, cz).box(mid.x, H - 0.05, mid.z, len, 0.05, depth, yaw, WHITE, 3, 0b010000);
  const trim = B.at("trim", cx, cz);
  const edge = (u: THREE.Vector3, w: number, d: number, yy: number, h: number) => trim.box(u.x, yy, u.z, w, h, d, yaw, tint, 2, 0b011111);
  edge(o.clone().addScaledVector(dir, len / 2).addScaledVector(n, -0.25), len, 0.5, H, 0.9);
  edge(o.clone().addScaledVector(dir, len / 2).addScaledVector(n, -depth + 0.25), len, 0.5, H, 0.9);
  if (opts.shops) {
    const cmid = o.clone().addScaledVector(dir, len / 2).addScaledVector(n, 0.7);
    trim.box(cmid.x, GROUND_M - 0.05, cmid.z, len - 0.4, 0.28, 1.4, yaw, new THREE.Color("#3c3f52"), 2);
    const neon = new THREE.Color(NEON[Math.floor(r() * NEON.length)]);
    const nmid = o.clone().addScaledVector(dir, len / 2).addScaledVector(n, 1.42);
    B.at("neon", cx, cz).box(nmid.x, GROUND_M - 0.02, nmid.z, len - 0.4, 0.14, 0.06, yaw, neon, 1, 0b111111);
    // Its light on the pavement.
    if (opts.poolSide) {
      for (let u = BAY_M; u < len; u += BAY_M * 2) {
        const p = o.clone().addScaledVector(dir, u).addScaledVector(n, 3.2);
        X.pools.push({ x: p.x, z: p.z, r: 4.6, color: neon.clone().lerp(new THREE.Color("#ffd9a0"), 0.5) });
      }
    }
  }
  if (!opts.signs) return;
  // A blade sign at one end of the front, over the canopy.
  if (r() < 0.55 && floors >= 2) {
    const u = r() < 0.5 ? 0.9 : len - 0.9;
    const base = o.clone().addScaledVector(dir, u);
    const y0 = GROUND_M + 0.6, y1 = Math.min(H - 0.8, y0 + 7 + r() * 3);
    const out = 2.4;
    const p0 = base.clone().addScaledVector(n, 0.3), p1 = base.clone().addScaledVector(n, 0.3 + out);
    const reg = SIGNS.blade(Math.floor(r() * SIGNS.BLADES));
    const uv: Spot["uv"] = [reg.u0, reg.v0, reg.u1, reg.v0, reg.u1, reg.v1, reg.u0, reg.v1];
    // Both faces (each reads the right way round).
    X.signs.push({ a: p0.clone().setY(y0), b: p1.clone().setY(y0), c: p1.clone().setY(y1), d: p0.clone().setY(y1), uv });
    X.signs.push({ a: p1.clone().setY(y0), b: p0.clone().setY(y0), c: p0.clone().setY(y1), d: p1.clone().setY(y1), uv });
  }
  // A sign on the roof, facing the street, on a steel frame.
  if (r() < 0.42 && len > 9) {
    const w = Math.min(len - 2, 8 + r() * 6), h = w * 0.5;
    const u0 = (len - w) / 2 + (r() - 0.5) * (len - w) * 0.6;
    const p = o.clone().addScaledVector(dir, u0).addScaledVector(n, -1.6);
    const q = p.clone().addScaledVector(dir, w);
    const y0 = H + 1.6;
    const reg = SIGNS.wide(Math.floor(r() * SIGNS.WIDE));
    X.signs.push({ a: p.clone().setY(y0), b: q.clone().setY(y0), c: q.clone().setY(y0 + h), d: p.clone().setY(y0 + h), uv: [reg.u0, reg.v0, reg.u1, reg.v0, reg.u1, reg.v1, reg.u0, reg.v1] });
    const frameCol = new THREE.Color("#2a2d3a");
    for (const f of [0.15, 0.85]) {
      const leg = p.clone().addScaledVector(dir, w * f).addScaledVector(n, -0.4);
      trim.box(leg.x, H, leg.z, 0.3, 1.6 + h * 0.9, 0.3, yaw, frameCol, 1);
    }
    const back2 = p.clone().addScaledVector(dir, w / 2).addScaledVector(n, -0.12);
    trim.box(back2.x, y0, back2.z, w, h, 0.18, yaw, frameCol, 1, 0b111110);
  }
}

/** A run of buildings from a to b along a street (outward normal n). */
function streetWall(B: Buckets, X: Extras, a: THREE.Vector3, b: THREE.Vector3, n: THREE.Vector3, depth: number, seed: number, opts: { shops: boolean; signs: boolean; maxFloors: number; minFloors: number; poolSide: number }) {
  const total = a.distanceTo(b);
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  const r = rng(seed);
  let u = 0, idx = 0;
  while (u + BAY_M * 2 <= total + 0.01) {
    let bays = 3 + Math.floor(r() * 5);
    bays = Math.min(bays, Math.floor((total - u) / BAY_M + 0.01));
    if (bays < 2) break;
    const floors = opts.minFloors + Math.floor(r() * (opts.maxFloors - opts.minFloors + 1));
    building(B, X, a.clone().addScaledVector(dir, u), dir, n, bays, depth, floors, seed * 977 + idx, opts);
    u += bays * BAY_M;
    idx++;
  }
}

/** A block of the city beyond: a box (or a stepped tower) with a window grid, a flat roof, sometimes a sign or a light on top. */
function block(T: Buckets, X: Extras, x: number, z: number, w: number, d: number, h: number, yaw: number, seed: number, tops: THREE.Vector3[]) {
  const r = rng(seed);
  const tint = WALLS[Math.floor(r() * WALLS.length)].clone().lerp(new THREE.Color("#b9c2e0"), 0.35);
  // UVs in tiles of 7.2 m (two windows by two floors), so the grid keeps its size whatever the block's.
  T.at("tower", x, z).box(x, 0, z, w, h, d, yaw, tint, 7.2, 0b001111);
  T.at("roof", x, z).box(x, 0, z, w, h, d, yaw, WHITE, 3, 0b010000);
  if (h > 34) {
    // A setback crown on the taller ones.
    const h2 = h * (0.12 + r() * 0.12);
    T.at("tower", x, z).box(x, h, z, w * 0.72, h2, d * 0.72, yaw, tint, 7.2, 0b001111);
    T.at("roof", x, z).box(x, h, z, w * 0.72, h2, d * 0.72, yaw, WHITE, 3, 0b010000);
    tops.push(new THREE.Vector3(x, h + h2 + 1.2, z));
  }
  void X;
}

/** Trees strung with fairy lights: a round crown of dark leaves on a trunk, bulbs scattered over it. */
function lightTrees(at: { x: number; z: number }[], detail: number, out: THREE.Object3D[], own: { dispose(): void }[], shared: Shared) {
  if (!at.length) return;
  const crownGeo = new THREE.IcosahedronGeometry(3.4, detail >= 0.7 ? 1 : 0).scale(1, 0.9, 1).translate(0, 7.4, 0);
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 5.6, 6).translate(0, 2.8, 0);
  const bulbGeo = new THREE.OctahedronGeometry(0.16, 0);
  const crownMat = new THREE.MeshStandardMaterial({ color: "#2f4a3a", roughness: 0.9, flatShading: true });
  const trunkMat = new THREE.MeshStandardMaterial({ color: "#4a3a30", roughness: 0.9 });
  const time = { value: 0 };
  const bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffe2a0").multiplyScalar(2.6), toneMapped: true });
  bulbMat.onBeforeCompile = (s) => {
    s.uniforms.uTw = time;
    s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTw;\nvarying float vTw;").replace("#include <begin_vertex>", "#include <begin_vertex>\n  float ph = float(gl_InstanceID) * 1.618;\n  vTw = 0.45 + 0.55 * smoothstep(-0.3, 1.0, sin(uTw * (1.1 + mod(ph, 1.7)) + ph));");
    s.fragmentShader = s.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vTw;").replace("#include <opaque_fragment>", "outgoingLight *= vTw;\n#include <opaque_fragment>");
  };
  bulbMat.customProgramCacheKey = () => "nimbasa-fairy";
  cutaway(crownMat, shared);
  cutaway(trunkMat, shared);
  own.push(crownGeo, trunkGeo, bulbGeo, crownMat, trunkMat, bulbMat);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, at.length);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, at.length);
  const per = detail >= 0.7 ? 14 : 7;
  const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, at.length * per);
  const r = rng(808);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  let b = 0;
  at.forEach((t, i) => {
    const sc = 0.85 + r() * 0.3;
    m4.compose(p.set(t.x, 0, t.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28), s.set(sc, sc, sc));
    crowns.setMatrixAt(i, m4);
    trunks.setMatrixAt(i, m4);
    for (let k = 0; k < per; k++) {
      const u = r() * 2 - 1, th = r() * Math.PI * 2, rr = 3.5 * sc;
      bulbs.setMatrixAt(b++, new THREE.Matrix4().makeTranslation(t.x + Math.sqrt(1 - u * u) * Math.cos(th) * rr, 7.4 * sc + u * rr * 0.9, t.z + Math.sqrt(1 - u * u) * Math.sin(th) * rr));
    }
  });
  bulbs.count = b;
  crowns.castShadow = trunks.castShadow = true;
  crowns.receiveShadow = trunks.receiveShadow = true;
  for (const m of [crowns, trunks, bulbs]) { m.computeBoundingSphere(); out.push(m); }
  return time;
}

/** A soft round pool of light on the ground (additive), for lamps and shopfronts. */
function poolTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.7, "rgba(255,255,255,0.15)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export interface NimbasaCity {
  group: THREE.Group;
  update(camera: THREE.Vector3, shadowRange: number): void;
  tick(t: number): void;
  dispose(): void;
}

export function buildNimbasaCity(plan: WorldPlan, shared: Shared, tex: CityTex, quality: CityQuality, keep: KeepOut, station: { x0: number; x1: number } | null): NimbasaCity {
  const group = new THREE.Group();
  group.name = "nimbasa-city";
  const B = new Buckets(CHUNK);
  const X: Extras = { signs: [], pools: [] };
  const F = STREET.facade, D = STREET.depth;
  const C = { x: plan.plaza.cx, z: plan.plaza.cz };
  const R = plan.plaza.r;
  const own: { dispose(): void }[] = [];
  const out: THREE.Object3D[] = [];

  // ---- The promenade's street walls, broken by side streets (and, on the far side, by Gear Station).
  const crossEvery = 120, crossW = 16;
  for (const [side, seedBase] of [[1, 1], [-1, 2]] as const) {
    if (side < 0 && plan.open) continue;
    const z = side * F;
    const xEnd = boulevardEnd(plan, z, 12) - 3;
    const n = new THREE.Vector3(0, 0, -side);
    let x = plan.x0, k = 0;
    while (x < xEnd - 10) {
      let xe = Math.min(xEnd, x + crossEvery - crossW);
      let xs = x;
      if (side > 0 && station) {
        // Leave the station's frontage open.
        if (xs < station.x1 && xe > station.x0) {
          if (xs < station.x0 - BAY_M * 2) xe = station.x0 - 2;
          else if (xe > station.x1 + BAY_M * 2) xs = station.x1 + 2;
          else { x += crossEvery; k++; continue; }
        }
      }
      const a = new THREE.Vector3(side > 0 ? xe : xs, 0, z), b = new THREE.Vector3(side > 0 ? xs : xe, 0, z);
      if (xe - xs > BAY_M * 3) streetWall(B, X, a, b, n, D, seedBase * 1000 + k, { shops: true, signs: true, maxFloors: MAX_STREET_FLOORS, minFloors: 2, poolSide: 1 });
      x += crossEvery;
      k++;
    }
  }

  // ---- The plaza's ring of buildings, open where the promenade and the avenues leave. Lower here: the venues and towers show over them.
  const ringR = R + 12;
  {
    const gaps: [number, number][] = [];
    const half = F + D + 4;
    const sHi = Math.max(-1, Math.min(1, (half - C.z) / ringR)), sLo = Math.max(-1, Math.min(1, (-half - C.z) / ringR));
    gaps.push([wrap(Math.PI - Math.asin(sHi)), wrap(Math.PI - Math.asin(sLo))]);
    for (const av of plan.avenues.slice(1)) { const h = Math.asin(Math.min(1, 24 / ringR)); gaps.push([wrap(av - h), wrap(av + h)]); }
    const sorted = gaps.map(([a, b]) => [a, b < a ? b + Math.PI * 2 : b] as [number, number]).sort((p, q) => p[0] - q[0]);
    for (let i = 0; i < sorted.length; i++) {
      const a0 = sorted[i][1];
      let a1 = sorted[(i + 1) % sorted.length][0];
      while (a1 <= a0) a1 += Math.PI * 2;
      const segs = Math.max(2, Math.round(((a1 - a0) * ringR) / 24));
      for (let sg = 0; sg < segs; sg++) {
        const t0 = a0 + ((a1 - a0) * sg) / segs, t1 = a0 + ((a1 - a0) * (sg + 1)) / segs;
        const e = 0.6 / ringR;
        const p0 = new THREE.Vector3(C.x + Math.cos(t0 - e) * ringR, 0, C.z + Math.sin(t0 - e) * ringR);
        const p1 = new THREE.Vector3(C.x + Math.cos(t1 + e) * ringR, 0, C.z + Math.sin(t1 + e) * ringR);
        const mid = p0.clone().add(p1).multiplyScalar(0.5);
        const n = new THREE.Vector3(C.x - mid.x, 0, C.z - mid.z).normalize();
        streetWall(B, X, p0, p1, n, D, 9000 + i * 31 + sg, { shops: true, signs: true, maxFloors: 4, minFloors: 1, poolSide: 1 });
      }
    }
  }

  // ---- The city beyond: blocks on a grid round the plaza, out past the promenade's far end. Tall behind the wheel, low on the camera's side.
  const T = new Buckets(640);
  const tops: THREE.Vector3[] = [];
  const ring0 = ringR + D + 22;
  const rMax = Math.max(ringR + 760, Math.hypot(C.x - plan.x0, C.z) + 200) * (0.55 + 0.45 * quality.blocks);
  const corridor = F + D + 14;
  const near = plan.open ? plan.open + 14 : corridor;
  const cell = 92, street = 20;
  const avenueClear = (x: number, z: number) => plan.avenues.slice(1).some((a) => {
    const dx = x - C.x, dz = z - C.z;
    const along = dx * Math.cos(a) + dz * Math.sin(a);
    return along > 0 && Math.abs(-dx * Math.sin(a) + dz * Math.cos(a)) < 34;
  });
  {
    const r = rng(31337);
    let seed = 1;
    const gx0 = Math.floor((C.x - rMax) / cell), gx1 = Math.ceil((C.x + rMax) / cell);
    const gz0 = Math.floor((C.z - rMax) / cell), gz1 = Math.ceil((C.z + rMax) / cell);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const bx = gx * cell + cell / 2, bz = gz * cell + cell / 2;
        const dist = Math.hypot(bx - C.x, bz - C.z);
        if (dist > rMax || dist < ring0 + cell * 0.55) continue;
        const size = cell - street;
        // The promenade's corridor (and the open esplanade on the camera's side).
        if (bz - size / 2 < corridor + 2 && bz + size / 2 > -near - 2 && bx - size / 2 < C.x + 10 && bx + size / 2 > plan.x0 - 60) continue;
        if (avenueClear(bx, bz)) continue;
        if (keptOut(keep, bx, bz, size * 0.6)) continue;
        const ang = Math.atan2(bz - C.z, bx - C.x);
        // Tall where the camera never goes: north of the wheel, away from the giants' ring and the finale's arc.
        const tall = bz - C.z > 24 && ang > 0.7;
        const far = dist > 1300;
        const parts = far ? 1 : 1 + Math.floor(r() * 3);
        for (let p = 0; p < parts; p++) {
          const w = parts === 1 ? size : size * (0.42 + r() * 0.12);
          const d = parts === 1 ? size : size * (0.42 + r() * 0.12);
          const ox = parts === 1 ? 0 : (p % 2 ? 1 : -1) * (size - w) / 2;
          const oz = parts === 1 ? 0 : (p < 2 ? -1 : 1) * (size - d) / 2;
          const h = tall ? 30 + Math.pow(r(), 1.6) * 80 * Math.max(0.5, 1 - (dist - 400) / 2600) : 10 + r() * 12;
          block(T, X, bx + ox, bz + oz, w, d, h, 0, seed++, tops);
        }
      }
    }
  }

  // ---- Materials.
  const atlas = facadeAtlas(quality.facadeScale, quality.anisotropy);
  const towers = towerTexture(quality.anisotropy);
  own.push(atlas, towers);
  const facade = new THREE.MeshStandardMaterial({ map: atlas.map, emissiveMap: atlas.emissive, emissive: "#ffffff", emissiveIntensity: 1.25, vertexColors: true, roughness: 0.72, metalness: 0.05 });
  const tower = new THREE.MeshStandardMaterial({ map: towers.map, emissiveMap: towers.emissive, emissive: "#ffffff", emissiveIntensity: 1.1, vertexColors: true, roughness: 0.6, metalness: 0.1 });
  const roof = new THREE.MeshStandardMaterial({ color: "#3b3d4a", roughness: 0.9 });
  const trim = new THREE.MeshStandardMaterial({ color: "#e8e8ee", vertexColors: true, roughness: 0.6, metalness: 0.15 });
  const neon = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(3.2), vertexColors: true, toneMapped: true });
  const signTex = signSheet(quality.anisotropy);
  own.push(signTex);
  const sign = new THREE.MeshBasicMaterial({ map: signTex, color: new THREE.Color(1, 1, 1).multiplyScalar(2.1), toneMapped: true, side: THREE.FrontSide });
  const mats: Record<string, THREE.Material> = { facade, tower, roof, trim, neon, sign };
  for (const m of [facade, tower, roof, trim]) cutaway(m, shared);
  own.push(...Object.values(mats));
  // Signs into their own bucket.
  for (const s of X.signs) B.at("sign", s.a.x, s.a.z).quad(s.a, s.b, s.c, s.d, s.uv, WHITE);
  for (const mesh of B.meshes(mats, { cast: (m) => m !== "neon" && m !== "sign", receive: (m) => m !== "neon" && m !== "sign" })) out.push(mesh);
  const shadowCasters: THREE.Mesh[] = [];
  for (const mesh of T.meshes(mats)) { out.push(mesh); shadowCasters.push(mesh); }
  // Red lights on the tall towers' tops, blinking slowly.
  const time = { value: 0 };
  if (tops.length) {
    const g = new THREE.SphereGeometry(0.9, 6, 4);
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ff2a3a").multiplyScalar(4), toneMapped: true });
    m.onBeforeCompile = (s) => {
      s.uniforms.uBl = time;
      s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nuniform float uBl;\nvarying float vBl;").replace("#include <begin_vertex>", "#include <begin_vertex>\n  vBl = 0.15 + 0.85 * step(0.55, fract(uBl * 0.5 + float(gl_InstanceID) * 0.37));");
      s.fragmentShader = s.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vBl;").replace("#include <opaque_fragment>", "outgoingLight *= vBl;\n#include <opaque_fragment>");
    };
    m.customProgramCacheKey = () => "nimbasa-beacon";
    own.push(g, m);
    const im = new THREE.InstancedMesh(g, m, tops.length);
    tops.forEach((p, i) => im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
    im.computeBoundingSphere();
    out.push(im);
  }

  // ---- Ground.
  const ground = buildGround(plan, shared, tex, quality, own, out, X);

  // ---- Lamps along the promenade, the pavements and round the plaza: a slim post, a glowing head, a pool of light.
  {
    const lamps: { x: number; z: number; h: number }[] = [];
    const endAt = (z: number) => boulevardEnd(plan, z) - 6;
    const lineIn = plan.ring ? plan.ring.s0 : endAt(STREET.promenade);
    for (let x = plan.x0 + 12; x < lineIn - 4; x += 24) lamps.push({ x, z: STREET.promenade - 0.4, h: 6.5 });
    for (const side of plan.open ? [1] : [1, -1]) for (let x = plan.x0 + 6; x < endAt(side * STREET.roadOut); x += 24) lamps.push({ x, z: side * (STREET.roadOut + 0.8), h: 8 });
    const edgeR = R - 3;
    const n = Math.round((Math.PI * 2 * edgeR) / 26);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const x = C.x + Math.cos(a) * edgeR, z = C.z + Math.sin(a) * edgeR;
      if (Math.abs(z) < STREET.facade && x < C.x) continue;
      lamps.push({ x, z, h: 8 });
    }
    const postGeo = new THREE.CylinderGeometry(0.09, 0.13, 1, 6).translate(0, 0.5, 0);
    const armGeo = new THREE.BoxGeometry(1.4, 0.1, 0.1).translate(0.55, 0, 0);
    const headGeo = new THREE.SphereGeometry(0.34, 8, 6);
    const postMat = new THREE.MeshStandardMaterial({ color: "#2e3142", roughness: 0.5, metalness: 0.6 });
    const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#fff1d0").multiplyScalar(3.4), toneMapped: true });
    cutaway(postMat, shared);
    own.push(postGeo, armGeo, headGeo, postMat, headMat);
    const posts = new THREE.InstancedMesh(postGeo, postMat, lamps.length);
    const arms = new THREE.InstancedMesh(armGeo, postMat, lamps.length);
    const heads = new THREE.InstancedMesh(headGeo, headMat, lamps.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    lamps.forEach((l, i) => {
      // The arm reaches towards the promenade (or the plaza's middle).
      const yaw = Math.abs(l.z) < 30 && l.x < C.x - 10 ? (l.z > 0 ? Math.PI / 2 : -Math.PI / 2) : Math.atan2(-(C.z - l.z), C.x - l.x);
      posts.setMatrixAt(i, m4.compose(p.set(l.x, 0, l.z), q.identity(), s.set(1, l.h, 1)));
      arms.setMatrixAt(i, m4.compose(p.set(l.x, l.h - 0.1, l.z), q.setFromAxisAngle(up, yaw), s.set(1, 1, 1)));
      const hx = l.x + Math.cos(yaw) * 1.2, hz = l.z - Math.sin(yaw) * 1.2;
      heads.setMatrixAt(i, m4.compose(p.set(hx, l.h - 0.35, hz), q.identity(), s.set(1, 1, 1)));
      X.pools.push({ x: hx, z: hz, r: 7, color: new THREE.Color("#ffe0b0") });
    });
    posts.castShadow = arms.castShadow = true;
    for (const m of [posts, arms, heads]) { m.computeBoundingSphere(); out.push(m); }
  }

  // ---- Trees with fairy lights along the pavements, round the plaza and down the avenues.
  let treeTime: { value: number } | undefined;
  if (quality.trees) {
    const at: { x: number; z: number }[] = [];
    const endAt = (z: number) => boulevardEnd(plan, z) - 6;
    for (const side of plan.open ? [1] : [1, -1]) for (let x = plan.x0 + 4; x < endAt(side * STREET.trees); x += quality.blocks > 0.7 ? 12 : 16) at.push({ x, z: side * STREET.trees });
    for (const a of plan.avenues.slice(1)) {
      const c = Math.cos(a), sn = Math.sin(a);
      for (let d = R + 40; d < R + 600; d += 16) for (const off of [-16, 16]) {
        const x = C.x + c * d - sn * off, z = C.z + sn * d + c * off;
        if (!keptOut(keep, x, z, 4)) at.push({ x, z });
      }
    }
    treeTime = lightTrees(at, quality.blocks, out, own, shared);
  }

  // ---- Pools of light (additive, on the ground).
  {
    const pt = poolTexture();
    const pm = new THREE.MeshBasicMaterial({ map: pt, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.32, toneMapped: true });
    pm.polygonOffset = true;
    pm.polygonOffsetFactor = -3;
    const pg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    own.push(pt, pm, pg);
    const pools = new THREE.InstancedMesh(pg, pm, X.pools.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    X.pools.forEach((l, i) => { pools.setMatrixAt(i, m4.compose(p.set(l.x, 0.03, l.z), q, s.set(l.r * 2, 1, l.r * 2))); pools.setColorAt(i, l.color); });
    pools.renderOrder = 0.5;
    pools.computeBoundingSphere();
    out.push(pools);
  }

  for (const o of out) { o.matrixAutoUpdate = false; o.updateMatrix(); group.add(o); }
  const centre = new THREE.Vector3();
  return {
    group,
    update(camera, shadowRange) {
      for (const m of shadowCasters) {
        const bs = m.geometry.boundingSphere!;
        m.castShadow = centre.copy(bs.center).distanceTo(camera) - bs.radius < shadowRange;
      }
    },
    tick(t) {
      time.value = t;
      if (treeTime) treeTime.value = t;
      ground.tick(t);
    },
    dispose() {
      group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
      for (const o of own) o.dispose();
    },
  };
}

/** The ground: the promenade and its band for the line, roads and pavements, the plaza's paving, the giants' ring, lit fountains. */
function buildGround(plan: WorldPlan, shared: Shared, tex: CityTex, quality: CityQuality, own: { dispose(): void }[], out: THREE.Object3D[], X: Extras): { tick(t: number): void } {
  const strip = (name: string, mat: THREE.Material, x0: number, x1: number, z0: number, z1: number, y: number, tile: number) => {
    if (x1 <= x0) return;
    const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / tile, -pos.getZ(i) / tile);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.receiveShadow = true;
    out.push(mesh);
  };
  const mk = (name: string, tile: number, opts?: { color?: string; bright?: number }) => {
    const m = new THREE.MeshStandardMaterial(tex.pbr(name, tile, opts));
    if (opts?.bright) m.color.multiplyScalar(opts.bright);
    groundVariation(m);
    own.push(m);
    return m;
  };
  const prom = mk("granite_tile", 2.3, { color: "#e9e4ee", bright: 1.25 });
  const asphalt = mk("asphalt_02", 3, { color: "#5c5c66" });
  const walk = mk("large_grey_tiles", 3, { color: "#c9c3d2" });
  // The line's band: rose-tinted stone down the middle of the promenade, round the ring.
  const band = mk("large_grey_tiles", 1.6, { color: "#e7c6d4", bright: 1.15 });
  band.polygonOffset = true;
  band.polygonOffsetFactor = -1;
  band.polygonOffsetUnits = -2;
  const curb = new THREE.MeshStandardMaterial({ color: "#bdb8c8", roughness: 0.8 });
  own.push(curb);
  const { x0, x1 } = plan;
  const R = plan.plaza.r, cx = plan.plaza.cx, cz = plan.plaza.cz;
  const ring = plan.ring;
  const lineIn = ring ? ring.s0 : x1;
  const far = 7000;
  strip("ground-base", asphalt, Math.min(x0, cx - R) - far, cx + R + far, cz - R - far, cz + R + far, -0.05, 3);
  strip("promenade", prom, x0, lineIn + 6, -STREET.promenade, STREET.promenade, -0.006, 2.3);
  strip("band", band, x0, lineIn + (ring ? 0.5 : 4), -STREET.promenade + 1.4, STREET.promenade - 1.4, 0, 1.6);
  if (plan.open) strip("esplanade", walk, x0 - 40, boulevardEnd(plan, -STREET.facade), -plan.open, -STREET.facade - 0.6, 0.06, 3);
  for (const s of [1, -1]) {
    const lo = (a: number, b: number) => [Math.min(s * a, s * b), Math.max(s * a, s * b)] as const;
    const [p0, p1] = lo(STREET.roadOut + 0.3, STREET.facade + 0.6);
    strip("pavement", walk, x0, boulevardEnd(plan, s * STREET.facade), p0, p1, 0.12, 3);
    const [t0, t1] = lo(STREET.promenade, STREET.roadIn);
    strip("allee", walk, x0, boulevardEnd(plan, s * STREET.roadIn), t0, t1, 0.12, 3);
    for (const zk of [STREET.roadIn, STREET.roadOut]) {
      const xe = boulevardEnd(plan, s * zk);
      const geo = new THREE.BoxGeometry(xe - x0, 0.14, 0.3);
      geo.translate((x0 + xe) / 2, 0.07, s * zk);
      const m = new THREE.Mesh(geo, curb);
      m.receiveShadow = true;
      out.push(m);
    }
  }
  // Lit edging along the band: a thin glowing line each side, in the city's pink.
  const edgeGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ff7ab8").multiplyScalar(1.8), toneMapped: true });
  own.push(edgeGlow);
  for (const s of [1, -1]) {
    const geo = new THREE.BoxGeometry(lineIn + (ring ? 0.5 : 4) - x0, 0.05, 0.12);
    geo.translate((x0 + lineIn + (ring ? 0.5 : 4)) / 2, 0.02, s * (STREET.promenade - 1.25));
    out.push(new THREE.Mesh(geo, edgeGlow));
  }
  // Lane markings.
  const dash = new THREE.MeshStandardMaterial({ color: "#e8e6f0", roughness: 0.6 });
  own.push(dash);
  const dashGeo = new THREE.PlaneGeometry(3, 0.15).rotateX(-Math.PI / 2);
  own.push(dashGeo);
  const dashes = new THREE.InstancedMesh(dashGeo, dash, Math.ceil((x1 - x0) / 9) * 4 + 4);
  let di = 0;
  const m4 = new THREE.Matrix4();
  for (const s of [1, -1]) for (const lane of [16, 20]) for (let x = x0; x < boulevardEnd(plan, s * lane) - 6; x += 9) { m4.makeTranslation(x, 0.01, s * lane); dashes.setMatrixAt(di++, m4); }
  dashes.count = di;
  dashes.receiveShadow = true;
  out.push(dashes);
  const flat = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number, tile: number, at: { x: number; z: number } = { x: cx, z: cz }) => {
    geo.rotateX(-Math.PI / 2);
    geo.translate(at.x, y, at.z);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / tile, -pos.getZ(i) / tile);
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    out.push(m);
    return m;
  };
  const arc = (r0: number, r1: number, a0: number, a1: number, segs: number) => new THREE.RingGeometry(r0, r1, segs, 1, -a1, a1 - a0);
  // The plaza: patterned paving with neon-coloured inlays round its rim.
  flat(new THREE.CircleGeometry(R + STREET.facade - 10, 160), walk, -0.035, 3);
  const plazaStone = mk("granite_tile", 2.3, { color: "#ece6f2", bright: 1.3 });
  plazaPattern(plazaStone, new THREE.Vector2(cx, cz), R - 4, { entry: plan.districts[0]?.a0 ?? 0, colors: NEON.slice(0, 5).map((c) => new THREE.Color(c)) });
  flat(new THREE.CircleGeometry(R - 4, 160), plazaStone, -0.022, 2.3);
  flat(new THREE.RingGeometry(R - 1, R + 8.2, 240, 1), asphalt, -0.03, 3);
  const rr = ring?.r ?? Math.max(60, R - 120);
  if (ring) {
    const span = (plan.lineEnd - ring.s0) / ring.r;
    const a0 = -Math.PI / 2 - 0.08, a1 = -Math.PI / 2 + span + 0.25;
    flat(arc(rr - 17, rr + 17, a0 - 0.05, a1 + 0.05, 160), prom, -0.012, 2.3);
    const bandArc = flat(arc(rr - 9.6, rr + 9.6, -Math.PI / 2, a1, 160), band, 0, 1.6);
    bandArc.name = "ring-band";
    for (const off of [-9.75, 9.75]) {
      const g = arc(rr + off - 0.06, rr + off + 0.06, -Math.PI / 2, a1, 160);
      flat(g, edgeGlow, 0.02, 1);
    }
  }
  // Round the wheel: a pale apron, and four lit fountains between the wheel and the ring.
  const apron = 52;
  flat(new THREE.CircleGeometry(apron, 64), prom, 0.04, 2.3);
  const inner = rr - 20;
  const basinM = new THREE.MeshStandardMaterial({ color: "#dcd8e6", roughness: 0.6 });
  const water = new THREE.MeshStandardMaterial({ color: "#123a5a", roughness: 0.05, metalness: 0.2, emissive: "#1a7fd0", emissiveIntensity: 0.9 });
  const time = { value: 0 };
  const spray = new THREE.MeshBasicMaterial({ color: new THREE.Color("#9fe4ff").multiplyScalar(1.6), transparent: true, opacity: 0.55, depthWrite: false, toneMapped: true });
  spray.onBeforeCompile = (s) => {
    s.uniforms.uFt = time;
    s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nuniform float uFt;\nvarying vec3 vHue;").replace("#include <begin_vertex>", "#include <begin_vertex>\n  float h = fract(uFt * 0.06 + position.y * 0.02);\n  vHue = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);");
    s.fragmentShader = s.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vHue;").replace("#include <opaque_fragment>", "outgoingLight *= mix(vec3(1.0), vHue * 1.6, 0.6);\n#include <opaque_fragment>");
  };
  spray.customProgramCacheKey = () => "nimbasa-spray";
  own.push(basinM, water, spray);
  cutaway(basinM, shared);
  const fountain = (fx: number, fz: number, size: number) => {
    flat(new THREE.CircleGeometry(size * 1.5, 48), prom, 0.05, 2.3, { x: fx, z: fz });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(size, size * 0.06, 8, 48).rotateX(Math.PI / 2).translate(fx, size * 0.06, fz), basinM);
    rim.castShadow = rim.receiveShadow = true;
    out.push(rim);
    flat(new THREE.CircleGeometry(size, 48), water, size * 0.05, 4, { x: fx, z: fz });
    const jet = new THREE.Mesh(new THREE.ConeGeometry(size * 0.16, size * 0.9, 16, 6, true).rotateX(Math.PI).translate(fx, size * 0.5, fz), spray);
    out.push(jet);
    X.pools.push({ x: fx, z: fz, r: size * 1.7, color: new THREE.Color("#7fd0ff") });
  };
  if (inner - apron > 26) for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const fr = (apron + inner) / 2;
    fountain(cx + Math.cos(a) * fr, cz + Math.sin(a) * fr, Math.min(9, (inner - apron) * 0.22));
  }
  void quality;
  for (const m of out) { m.matrixAutoUpdate = false; m.updateMatrix(); }
  return { tick(t) { time.value = t; } };
}
