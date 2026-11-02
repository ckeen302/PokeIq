import * as THREE from "three";
import { CORNICE_Y, ROOF_Y, STREET, type WorldPlan } from "@/lib/sizes/world";
import { ATLAS, BALCONY_FLOORS, BAY_M, FLOORS_M, GROUND_M, UPPER_M, awningTexture, facadeAtlas, railingTexture, type FacadeMaps } from "./facade";
import { Buckets, rng, type Geo } from "./geo";
import { cutaway, groundVariation, lawnStripes, plazaPattern, type Shared } from "./shaders";

/**
 * The Lumiose City tribute: Haussmann street walls in cream and sandstone
 * along the boulevard (shopfronts and café awnings, wrought-iron balconies,
 * cornices, grey slate mansards with dormers and chimneys), city blocks with
 * courtyards behind them for the aerial finale, the central plaza's ring
 * with radial avenues, and the ground (stone promenade, asphalt, pavements,
 * fan-patterned cobbles, lawns). Built once per line as merged meshes in
 * chunks along the boulevard.
 */

const CHUNK = 240;
const TINTS = ["#f3e9d2", "#ecdcbd", "#f4ecdc", "#e4d3b4", "#efe2c8", "#e9dcc6", "#dfcfb2"].map((c) => new THREE.Color(c));
const WHITE = new THREE.Color(1, 1, 1);

export interface CityTextures {
  /** Loads a CC0 PBR set from /sizes/tex: name → { map, normalMap, roughnessMap }. */
  pbr(name: string, tileM: number, opts?: { color?: string; normalScale?: number }): THREE.MeshStandardMaterialParameters;
}

export interface City {
  group: THREE.Group;
  update(camera: THREE.Vector3, shadowRange: number): void;
  dispose(): void;
}

interface RowOpts {
  shops: boolean;
  details: boolean;
  awnings: boolean;
  seed: number;
}

/** A facade quad from u0 to u1 metres along `dir` and y0 to y1, with an atlas region. */
function facadeQuad(g: Geo, o: THREE.Vector3, dir: THREE.Vector3, u0: number, u1: number, y0: number, y1: number, reg: { u0: number; u1: number; v0: number; v1: number }, tint: THREE.Color, push = 0, n?: THREE.Vector3) {
  const off = n ? n.clone().multiplyScalar(push) : new THREE.Vector3();
  const a = o.clone().addScaledVector(dir, u0).add(off).setY(y0);
  const b = o.clone().addScaledVector(dir, u1).add(off).setY(y0);
  const c = o.clone().addScaledVector(dir, u1).add(off).setY(y1);
  const d = o.clone().addScaledVector(dir, u0).add(off).setY(y1);
  g.quad(a, b, c, d, [reg.u0, reg.v0, reg.u1, reg.v0, reg.u1, reg.v1, reg.u0, reg.v1], tint);
}

/** A horizontal ledge (cornice, string course or balcony slab) along a facade. */
function ledge(g: Geo, o: THREE.Vector3, dir: THREE.Vector3, n: THREE.Vector3, len: number, y: number, h: number, out: number, tint: THREE.Color) {
  const mid = o.clone().addScaledVector(dir, len / 2).addScaledVector(n, out / 2);
  const yaw = Math.atan2(n.x, n.z);
  // Every face but the one against the wall (the underside shows from the street).
  g.box(mid.x, y, mid.z, len + out * 0.6, h, out, yaw, tint, 2, 0b111101);
}

/** One building of a street wall: facade (shops + upper bays), roof, details. */
function building(B: Buckets, o: THREE.Vector3, dir: THREE.Vector3, n: THREE.Vector3, bays: number, depth: number, opts: RowOpts & { endL: boolean; endR: boolean; key: number }) {
  const r = rng(opts.key);
  const tint = TINTS[Math.floor(r() * TINTS.length)];
  const len = bays * BAY_M;
  const cx = o.x + dir.x * len / 2;
  const fac = B.at("facade", cx);
  const back = o.clone().addScaledVector(n, -depth);
  const backDir = dir.clone().negate();
  const backO = back.clone().addScaledVector(dir, len);
  // Front: shops (or plain rusticated stone) and the upper bays.
  for (let k = 0; k < bays; k++) {
    const shop = opts.shops ? Math.floor(r() * ATLAS.SHOPS) : 2 + 2 * Math.floor(r() * 2);
    facadeQuad(fac, o, dir, k * BAY_M, (k + 1) * BAY_M, 0, GROUND_M, ATLAS.shop(shop), tint);
    facadeQuad(fac, o, dir, k * BAY_M, (k + 1) * BAY_M, GROUND_M, GROUND_M + UPPER_M, ATLAS.upper(r() < 0.5 ? 0 : 1), tint);
    if (opts.awnings && opts.shops && shop % 3 !== 2 && r() < 0.55) awning(B, o, dir, n, k, Math.floor(r() * 4), cx);
  }
  // Back (courtyard side): upper bays only, down to the ground.
  for (let k = 0; k < bays; k++) {
    facadeQuad(fac, backO, backDir, k * BAY_M, (k + 1) * BAY_M, 0, GROUND_M, ATLAS.shop(3), tint);
    facadeQuad(fac, backO, backDir, k * BAY_M, (k + 1) * BAY_M, GROUND_M, GROUND_M + UPPER_M, ATLAS.upper(k % 2 ? 0 : 1), tint);
  }
  // Ends: windows on a corner, otherwise a party wall (only seen over a step in the roofline).
  const sideBays = Math.max(1, Math.round(depth / BAY_M));
  const sideW = depth / sideBays;
  for (const [end, isOpen] of [[0, opts.endL], [1, opts.endR]] as const) {
    const e = end ? o.clone().addScaledVector(dir, len) : back.clone();
    const sDir = end ? n.clone().negate() : n.clone();
    for (let k = 0; k < sideBays; k++) {
      if (isOpen) {
        facadeQuad(fac, e, sDir, k * sideW, (k + 1) * sideW, 0, GROUND_M, ATLAS.shop(3), tint);
        facadeQuad(fac, e, sDir, k * sideW, (k + 1) * sideW, GROUND_M, GROUND_M + UPPER_M, ATLAS.upper(k % 2 ? 1 : 0), tint);
      } else {
        const wall = B.at("stone", cx);
        const a = e.clone().addScaledVector(sDir, k * sideW), b = e.clone().addScaledVector(sDir, (k + 1) * sideW);
        wall.quad(a.clone().setY(0), b.clone().setY(0), b.clone().setY(CORNICE_Y), a.clone().setY(CORNICE_Y), [0, 0, sideW / 3, 0, sideW / 3, CORNICE_Y / 3, 0, CORNICE_Y / 3], tint);
      }
    }
  }
  // Cornice, the string course over the shops, and a plinth.
  const trim = B.at("stone", cx);
  ledge(trim, o, dir, n, len, CORNICE_Y - 0.5, 0.55, 0.6, tint);
  ledge(trim, o, dir, n, len, GROUND_M - 0.05, 0.32, 0.22, tint);
  if (opts.details) {
    // Continuous balconies with wrought-iron railings.
    let fy = GROUND_M;
    FLOORS_M.forEach((fh, floor) => {
      if (BALCONY_FLOORS.includes(floor)) {
        ledge(trim, o, dir, n, len, fy + 0.02, 0.16, 0.85, tint);
        const rail = B.at("rail", cx);
        const a = o.clone().addScaledVector(n, 0.82).addScaledVector(dir, -0.2);
        const b = a.clone().addScaledVector(dir, len + 0.4);
        rail.quad(a.clone().setY(fy + 0.17), b.clone().setY(fy + 0.17), b.clone().setY(fy + 1.17), a.clone().setY(fy + 1.17), [0, 0, (len + 0.4) / BAY_M, 0, (len + 0.4) / BAY_M, 1, 0, 1], WHITE);
      }
      fy += fh;
    });
  }
  // Mansard roof: a steep lower slope with dormers, a shallow upper slope.
  roof(B, o, dir, n, len, depth, cx, opts.details, r, tint, opts.endL, opts.endR);
}

function awning(B: Buckets, o: THREE.Vector3, dir: THREE.Vector3, n: THREE.Vector3, bay: number, style: number, cx: number) {
  const g = B.at("awning", cx);
  const u0 = bay * BAY_M + 0.25, u1 = (bay + 1) * BAY_M - 0.25;
  const top = GROUND_M - 0.55, low = GROUND_M - 1.35, out = 1.9;
  const A = (u: number, y: number, k: number) => o.clone().addScaledVector(dir, u).addScaledVector(n, k).setY(y);
  const v0 = 1 - (style + 1) / 4, v1 = 1 - style / 4;
  g.quad(A(u0, low, out), A(u1, low, out), A(u1, top, 0.02), A(u0, top, 0.02), [0, v0, 1, v0, 1, v1, 0, v1], WHITE);
  // Valance.
  g.quad(A(u0, low - 0.32, out), A(u1, low - 0.32, out), A(u1, low, out), A(u0, low, out), [0, v0, 1, v0, 1, v1, 0, v1], WHITE);
}

function roof(B: Buckets, o: THREE.Vector3, dir: THREE.Vector3, n: THREE.Vector3, len: number, depth: number, cx: number, details: boolean, r: () => number, tint: THREE.Color, endL: boolean, endR: boolean) {
  const g = B.at("roof", cx);
  const y0 = CORNICE_Y, y1 = CORNICE_Y + 3.3, y2 = ROOF_Y;
  const inset = 1.35;
  const P = (u: number, k: number, y: number) => o.clone().addScaledVector(dir, u).addScaledVector(n, -k).setY(y);
  const grey = new THREE.Color(0.93, 0.95, 1);
  const tile = 3;
  const slope = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, w: number, h: number) => g.quad(a, b, c, d, [0, 0, w / tile, 0, w / tile, h / tile, 0, h / tile], grey);
  // Front lower and upper slopes, back lower and upper slopes.
  slope(P(0, 0, y0), P(len, 0, y0), P(len, inset, y1), P(0, inset, y1), len, 3.6);
  slope(P(0, inset, y1), P(len, inset, y1), P(len, depth / 2, y2), P(0, depth / 2, y2), len, depth / 2);
  slope(P(len, depth, y0), P(0, depth, y0), P(0, depth - inset, y1), P(len, depth - inset, y1), len, 3.6);
  slope(P(len, depth - inset, y1), P(0, depth - inset, y1), P(0, depth / 2, y2), P(len, depth / 2, y2), len, depth / 2);
  // Gable ends (hipped look at row ends).
  for (const [u, open] of [[0, endL], [len, endR]] as const) {
    const s = u === 0 ? 1 : -1;
    const ii = open ? inset : 0;
    const a = P(u, 0, y0), b = P(u, depth, y0), c = P(u + s * ii, depth - inset, y1), d = P(u + s * ii, inset, y1), e = P(u + s * ii, depth / 2, y2);
    if (s > 0) {
      g.quad(b, a, d, c, [0, 0, depth / tile, 0, depth / tile, 1, 0, 1], grey);
      g.tri(c, d, e, [0, 0, 1, 0, 0.5, 0.6], grey);
    } else {
      g.quad(a, b, c, d, [0, 0, depth / tile, 0, depth / tile, 1, 0, 1], grey);
      g.tri(d, c, e, [0, 0, 1, 0, 0.5, 0.6], grey);
    }
  }
  if (!details) return;
  // Dormers, one per bay, standing on the lower slope.
  const bays = Math.round(len / BAY_M);
  const fac = B.at("facade", cx);
  const stone = B.at("stone", cx);
  for (let k = 0; k < bays; k++) {
    const um = (k + 0.5) * BAY_M, dw = 1.7, dh = 2.1, base = y0 + 0.5;
    const fo = P(um - dw / 2, 0.45, base);
    facadeQuad(fac, fo, dir, 0, dw, base, base + dh, ATLAS.dormer, tint);
    // Cheeks and a little pitched roof.
    const bl = P(um - dw / 2, 0.45, base), br = P(um + dw / 2, 0.45, base);
    const blb = P(um - dw / 2, 1.9, base), brb = P(um + dw / 2, 1.9, base);
    stone.quad(blb, bl, bl.clone().setY(base + dh), blb.clone().setY(base + dh), [0, 0, 0.5, 0, 0.5, 0.7, 0, 0.7], tint);
    stone.quad(br, brb, brb.clone().setY(base + dh), br.clone().setY(base + dh), [0, 0, 0.5, 0, 0.5, 0.7, 0, 0.7], tint);
    const ridgeF = P(um, 0.35, base + dh + 0.75), ridgeB = P(um, 1.95, base + dh + 0.75);
    const eL = P(um - dw / 2 - 0.12, 0.35, base + dh), eR = P(um + dw / 2 + 0.12, 0.35, base + dh);
    const eLb = P(um - dw / 2 - 0.12, 1.95, base + dh), eRb = P(um + dw / 2 + 0.12, 1.95, base + dh);
    g.quad(eL, ridgeF, ridgeB, eLb, [0, 0, 1, 0, 1, 1, 0, 1], grey);
    g.quad(ridgeF, eR, eRb, ridgeB, [0, 0, 1, 0, 1, 1, 0, 1], grey);
    stone.tri(eL, eR, ridgeF, [0, 0, 1, 0, 0.5, 0.4], tint);
  }
  // Chimney stacks along the ridge.
  const stacks = 1 + Math.floor(r() * 3);
  for (let k = 0; k < stacks; k++) {
    const u = len * (0.15 + 0.7 * r());
    const p = P(u, depth / 2 + (r() - 0.5) * 2, y2 - 1);
    stone.box(p.x, p.y, p.z, 1.3 + r() * 1.2, 2.6 + r() * 0.8, 0.7, Math.atan2(n.x, n.z), tint, 2);
    const pots = B.at("pots", cx);
    for (let j = 0; j < 3; j++) pots.box(p.x + dir.x * (j - 1) * 0.35, p.y + 2.6, p.z + dir.z * (j - 1) * 0.35, 0.22, 0.55, 0.22, 0, WHITE, 1, 0b001111 | 16);
  }
}

/** A street wall from a to b (facade line), facing n, `depth` deep, split into buildings of 4–7 bays. */
function streetWall(B: Buckets, a: THREE.Vector3, b: THREE.Vector3, n: THREE.Vector3, depth: number, opts: RowOpts) {
  const total = a.distanceTo(b);
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  const r = rng(opts.seed);
  let u = 0, idx = 0;
  while (u + BAY_M * 2 <= total + 0.01) {
    let bays = 4 + Math.floor(r() * 4);
    bays = Math.min(bays, Math.floor((total - u) / BAY_M + 0.01));
    if (bays < 2) break;
    const o = a.clone().addScaledVector(dir, u);
    const last = u + bays * BAY_M + BAY_M * 2 > total;
    building(B, o, dir, n, bays, depth, { ...opts, endL: idx === 0, endR: last, key: opts.seed * 977 + idx });
    u += bays * BAY_M;
    idx++;
  }
}

/** Points round an annular sector (arcs and radial sides), in a fixed order and count so rings can be bridged. */
function sectorRing(C: { x: number; z: number }, r0: number, r1: number, a0: number, a1: number, nArc: number, nRad: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const at = (r: number, a: number) => new THREE.Vector3(C.x + Math.cos(a) * r, 0, C.z + Math.sin(a) * r);
  for (let i = 0; i < nArc; i++) pts.push(at(r1, a1 - ((a1 - a0) * i) / nArc));
  for (let i = 0; i < nRad; i++) pts.push(at(r1 - ((r1 - r0) * i) / nRad, a0));
  for (let i = 0; i < nArc; i++) pts.push(at(r0, a0 + ((a1 - a0) * i) / nArc));
  for (let i = 0; i < nRad; i++) pts.push(at(r0 + ((r1 - r0) * i) / nRad, a1));
  return pts;
}

/**
 * A city block seen mostly from afar: a ring of six-storey buildings round
 * a courtyard, as one closed shape with tiled facades and a slate mansard.
 */
function massBlock(M: Buckets, C: { x: number; z: number }, r0: number, r1: number, a0: number, a1: number, seed: number) {
  const r = rng(seed * 7919);
  const tint = TINTS[Math.floor(r() * TINTS.length)];
  const rm = (r0 + r1) / 2;
  const mid = new THREE.Vector3(C.x + Math.cos((a0 + a1) / 2) * rm, 0, C.z + Math.sin((a0 + a1) / 2) * rm);
  const nArc = Math.max(2, Math.round(((a1 - a0) * r1) / 14));
  const nRad = Math.max(1, Math.round((r1 - r0) / 14));
  const D = STREET.depth;
  const hasCourt = r1 - r0 > D * 2 + 10 && (a1 - a0) * r0 > D * 2 + 10;
  const ins = (d: number, rr: number) => d / Math.max(1, rr);
  const outer = sectorRing(C, r0, r1, a0, a1, nArc, nRad);
  const cornice = CORNICE_Y + (r() - 0.5) * 1.2;
  const walls = M.at("mass", mid.x, mid.z);
  const roofG = M.at("roof", mid.x, mid.z);
  const wallLoop = (ring: THREE.Vector3[], outward: boolean, centre: THREE.Vector3) => {
    let u = 0;
    for (let i = 0; i < ring.length; i++) {
      let p = ring[i], q = ring[(i + 1) % ring.length];
      const len = p.distanceTo(q);
      if (len < 0.01) continue;
      const dx = q.x - p.x, dz = q.z - p.z;
      const n = new THREE.Vector3(-dz, 0, dx);
      const m = p.clone().add(q).multiplyScalar(0.5).sub(centre);
      let u0 = u / (BAY_M * 2), u1 = (u + len) / (BAY_M * 2);
      if ((n.dot(m) > 0) !== outward) { [p, q] = [q, p]; [u0, u1] = [u1, u0]; }
      walls.quad(p.clone().setY(0), q.clone().setY(0), q.clone().setY(cornice), p.clone().setY(cornice), [u0, 0, u1, 0, u1, 1, u0, 1], tint);
      u += len;
    }
  };
  wallLoop(outer, true, mid);
  const grey = new THREE.Color(0.93, 0.95, 1);
  const bridge = (A: THREE.Vector3[], yA: number, Bp: THREE.Vector3[], yB: number) => {
    for (let i = 0; i < A.length; i++) {
      const j = (i + 1) % A.length;
      const a = A[i].clone().setY(yA), b = A[j].clone().setY(yA), c = Bp[j].clone().setY(yB), d = Bp[i].clone().setY(yB);
      // Up-facing: order so the normal points up.
      const nrm = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a));
      const uv = (v: THREE.Vector3) => [v.x / 3, v.z / 3] as const;
      if (nrm.y >= 0) roofG.quad(a, b, c, d, [...uv(a), ...uv(b), ...uv(c), ...uv(d)], grey);
      else roofG.quad(b, a, d, c, [...uv(b), ...uv(a), ...uv(d), ...uv(c)], grey);
    }
  };
  const top = cornice + 3.4;
  const inset = 1.5;
  const ringB = sectorRing(C, r0 + inset, r1 - inset, a0 + ins(inset, r0), a1 - ins(inset, r0), nArc, nRad);
  bridge(outer, cornice, ringB, top);
  if (hasCourt) {
    const cr0 = r0 + D, cr1 = r1 - D, ca0 = a0 + ins(D, r0 + D), ca1 = a1 - ins(D, r0 + D);
    const court = sectorRing(C, cr0, cr1, ca0, ca1, nArc, nRad);
    const ringC = sectorRing(C, cr0 - inset, cr1 + inset, ca0 - ins(inset, cr0), ca1 + ins(inset, cr0), nArc, nRad);
    bridge(ringB, top, ringC, top);
    bridge(ringC, top, court, cornice);
    const cm = new THREE.Vector3(C.x + Math.cos((ca0 + ca1) / 2) * ((cr0 + cr1) / 2), 0, C.z + Math.sin((ca0 + ca1) / 2) * ((cr0 + cr1) / 2));
    wallLoop(court, false, cm);
  } else {
    // Solid block: close the top with a fan.
    const c = ringB.reduce((acc, v) => acc.add(v), new THREE.Vector3()).multiplyScalar(1 / ringB.length).setY(top);
    for (let i = 0; i < ringB.length; i++) {
      const a = ringB[i].clone().setY(top), b = ringB[(i + 1) % ringB.length].clone().setY(top);
      const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      if (n.y >= 0) roofG.tri(a, b, c, [a.x / 3, a.z / 3, b.x / 3, b.z / 3, c.x / 3, c.z / 3], grey);
      else roofG.tri(b, a, c, [b.x / 3, b.z / 3, a.x / 3, a.z / 3, c.x / 3, c.z / 3], grey);
    }
  }
}

export function buildCity(plan: WorldPlan, shared: Shared, tex: CityTextures, quality: { facadeScale: 1 | 2; anisotropy: number; blocks: number }): City {
  const group = new THREE.Group();
  group.name = "city";
  const B = new Buckets(CHUNK);
  const F = STREET.facade, D = STREET.depth;

  // ---- The boulevard's two street walls, broken by side streets.
  const crossEvery = 132;
  const crossW = 16;
  const sides: [number, number][] = [[1, 1], [-1, 2]];
  for (const [side, seedBase] of sides) {
    const z = side * F;
    const n = new THREE.Vector3(0, 0, -side);
    let x = plan.x0, k = 0;
    while (x < plan.x1 - 10) {
      const xe = Math.min(plan.x1, x + crossEvery - crossW);
      // A facade runs so that its outward normal is dir × up: on the far side (+z, facing -z) towards -x.
      const a = new THREE.Vector3(side > 0 ? xe : x, 0, z), b = new THREE.Vector3(side > 0 ? x : xe, 0, z);
      if (xe - x > BAY_M * 3) streetWall(B, a, b, n, D, { shops: true, details: true, awnings: side > 0, seed: seedBase * 1000 + k });
      x += crossEvery;
      k++;
    }
  }

  // ---- The plaza's ring of buildings facing the centre, broken by eight radial avenues (one is the boulevard).
  const C = { x: plan.plaza.cx, z: 0 };
  const ringR = plan.plaza.r + 12;
  const AVENUES = 8;
  const avenueAngle = (i: number) => Math.PI + (i * Math.PI * 2) / AVENUES;
  const avenueHalf = (i: number) => (i === 0 ? F + 2 : 21);
  for (let i = 0; i < AVENUES; i++) {
    const a0 = avenueAngle(i) + Math.asin(Math.min(1, avenueHalf(i) / ringR));
    const a1 = avenueAngle(i + 1) - Math.asin(Math.min(1, avenueHalf((i + 1) % AVENUES) / ringR));
    const segs = Math.max(2, Math.round(((a1 - a0) * ringR) / 26));
    for (let sg = 0; sg < segs; sg++) {
      const t0 = a0 + ((a1 - a0) * sg) / segs, t1 = a0 + ((a1 - a0) * (sg + 1)) / segs;
      // Facing the centre: dir = up × n runs towards increasing angle. Overlap neighbours a little so the joints close.
      const e = 0.6 / ringR;
      const p0 = new THREE.Vector3(C.x + Math.cos(t0 - e) * ringR, 0, Math.sin(t0 - e) * ringR);
      const p1 = new THREE.Vector3(C.x + Math.cos(t1 + e) * ringR, 0, Math.sin(t1 + e) * ringR);
      const mid = p0.clone().add(p1).multiplyScalar(0.5);
      const n = new THREE.Vector3(C.x - mid.x, 0, -mid.z).normalize();
      streetWall(B, p0, p1, n, D, { shops: true, details: true, awnings: true, seed: 9000 + i * 31 + sg });
    }
  }

  // ---- Lumiose's rings: city blocks with courtyards round the plaza, out past the boulevard's far end.
  const M = new Buckets(640);
  const ring0 = ringR + D + 18;
  const rMax = Math.max(700, Math.hypot(C.x - plan.x0, 0) + 160) * quality.blocks;
  let seed = 1;
  for (let r0 = ring0; r0 < rMax; r0 += 96) {
    const r1 = r0 + 78;
    for (let i = 0; i < AVENUES; i++) {
      // Keep each avenue's corridor clear (its width is constant, so the angle it takes shrinks outwards).
      const half0 = i === 0 ? F + D + 16 : 30, half1 = (i + 1) % AVENUES === 0 ? F + D + 16 : 30;
      const s0 = avenueAngle(i) + Math.asin(Math.min(1, half0 / r0));
      const s1 = avenueAngle(i + 1) - Math.asin(Math.min(1, half1 / r0));
      if (s1 - s0 < 0.02) continue;
      const rm = (r0 + r1) / 2;
      const nb = Math.max(1, Math.round(((s1 - s0) * rm) / 140));
      const street = 16 / rm;
      for (let k = 0; k < nb; k++) {
        const b0 = s0 + ((s1 - s0) * k) / nb + (k ? street / 2 : 0);
        const b1 = s0 + ((s1 - s0) * (k + 1)) / nb - (k < nb - 1 ? street / 2 : 0);
        massBlock(M, C, r0, r1, b0, b1, seed++);
      }
    }
  }
  // ---- Materials.
  const atlas: FacadeMaps = facadeAtlas(quality.facadeScale, quality.anisotropy);
  const facade = new THREE.MeshStandardMaterial({ map: atlas.map, normalMap: atlas.normalMap, roughnessMap: atlas.orm, metalnessMap: atlas.orm, aoMap: atlas.orm, aoMapIntensity: 0.6, vertexColors: true, roughness: 1, metalness: 1, normalScale: new THREE.Vector2(1.1, 1.1) });
  const stone = new THREE.MeshStandardMaterial({ ...tex.pbr("sandstone_blocks_08", 3, { color: "#ffffff" }), vertexColors: true });
  const roofM = new THREE.MeshStandardMaterial({ ...tex.pbr("roof_slates_03", 3, { color: "#9aa3ad", normalScale: 1.2 }), vertexColors: true, metalness: 0.15 });
  const rail = new THREE.MeshStandardMaterial({ map: railingTexture(quality.anisotropy), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6 });
  const awn = new THREE.MeshStandardMaterial({ map: awningTexture(), side: THREE.DoubleSide, roughness: 0.85 });
  const pots = new THREE.MeshStandardMaterial({ color: "#b5643f", roughness: 0.8 });
  const mass = new THREE.MeshStandardMaterial({ map: atlas.mass.map, normalMap: atlas.mass.normalMap, roughnessMap: atlas.mass.orm, metalnessMap: atlas.mass.orm, aoMap: atlas.mass.orm, aoMapIntensity: 0.6, vertexColors: true, roughness: 1, metalness: 1 });
  const mats: Record<string, THREE.Material> = { facade, stone, roof: roofM, rail, awning: awn, pots, mass };
  for (const m of Object.values(mats)) cutaway(m as THREE.MeshStandardMaterial, shared);
  const shadowCasters: THREE.Mesh[] = [];
  for (const mesh of B.meshes(mats, { cast: (m) => m !== "rail" && m !== "awning" })) group.add(mesh);
  for (const mesh of M.meshes(mats)) { group.add(mesh); shadowCasters.push(mesh); }

  // ---- Ground.
  group.add(...ground(plan, shared, tex));

  const centre = new THREE.Vector3();
  return {
    group,
    update(camera: THREE.Vector3, shadowRange: number) {
      // Far blocks don't need to cast shadows into the cascades.
      for (const m of shadowCasters) {
        const bs = m.geometry.boundingSphere!;
        m.castShadow = centre.copy(bs.center).distanceTo(camera) - bs.radius < shadowRange;
      }
    },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      atlas.dispose();
      for (const m of Object.values(mats)) m.dispose();
    },
  };
}

/** Flat ground strips with world-scaled UVs. */
function ground(plan: WorldPlan, shared: Shared, tex: CityTextures): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  const strip = (name: string, mat: THREE.MeshStandardMaterial, x0: number, x1: number, z0: number, z1: number, y: number, tile: number) => {
    const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / tile, -pos.getZ(i) / tile);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    out.push(mesh);
  };
  const mk = (name: string, tile: number, opts?: { color?: string; normalScale?: number; bright?: number }) => {
    const m = new THREE.MeshStandardMaterial(tex.pbr(name, tile, opts));
    if (opts?.bright) m.color.multiplyScalar(opts.bright);
    groundVariation(m);
    return m;
  };
  const prom = mk("granite_tile", 2.3, { color: "#fbf7ef", bright: 1.6 });
  const asphalt = mk("asphalt_02", 3, { color: "#8f8f92" });
  const walk = mk("large_grey_tiles", 3, { color: "#d6d2ca" });
  const cobble = mk("patterned_cobblestone", 2.5, { color: "#d9d2c6" });
  const grass = mk("leafy_grass", 2, { color: "#8cc455", bright: 0.95 });
  lawnStripes(grass);
  // The line stands on a long lawn down the middle of the boulevard (finer grass: the camera gets close to the smallest).
  const lineLawn = mk("leafy_grass", 0.9, { color: "#93cc58", bright: 1 });
  lawnStripes(lineLawn);
  // The figures stand at y = 0 on this lawn: it sits exactly there and wins the depth test against the paving just below.
  lineLawn.polygonOffset = true;
  lineLawn.polygonOffsetFactor = -1;
  lineLawn.polygonOffsetUnits = -2;
  const curb = new THREE.MeshStandardMaterial({ color: "#c9c4ba", roughness: 0.8 });
  const { x0, x1 } = plan;
  const far = 2600;
  // Base: the whole city's streets.
  strip("ground-base", asphalt, x0 - far, plan.plaza.cx + plan.plaza.r + far, -far, far, -0.05, 3);
  // The boulevard: promenade (a lawn with stone edging), then per side road and pavement.
  strip("promenade", prom, x0, x1 + 4, -STREET.promenade, STREET.promenade, -0.006, 2.3);
  strip("lawn", lineLawn, x0, x1 + 2, -STREET.promenade + 1.1, STREET.promenade - 1.1, 0, 0.9);
  for (const s of [1, -1]) {
    const lo = (a: number, b: number) => [Math.min(s * a, s * b), Math.max(s * a, s * b)] as const;
    const [p0, p1] = lo(STREET.roadOut + 0.3, STREET.facade + 0.6);
    strip("pavement", walk, x0, x1, p0, p1, 0.12, 3);
    const [t0, t1] = lo(STREET.promenade, STREET.roadIn);
    strip("allee", walk, x0, x1, t0, t1, 0.12, 3);
    // Kerbs.
    for (const zk of [STREET.roadIn, STREET.roadOut]) {
      const geo = new THREE.BoxGeometry(x1 - x0, 0.14, 0.3);
      geo.translate((x0 + x1) / 2, 0.07, s * zk);
      const m = new THREE.Mesh(geo, curb);
      m.receiveShadow = true;
      out.push(m);
    }
  }
  // Lane markings.
  const dash = new THREE.MeshStandardMaterial({ color: "#f2f0e8", roughness: 0.6 });
  const dashes = new THREE.InstancedMesh(new THREE.PlaneGeometry(3, 0.15).rotateX(-Math.PI / 2), dash, Math.ceil((x1 - x0) / 9) * 4);
  let di = 0;
  const m4 = new THREE.Matrix4();
  for (const s of [1, -1]) for (const lane of [16, 20]) for (let x = x0; x < x1 - 6; x += 9) { m4.makeTranslation(x, 0.01, s * lane); dashes.setMatrixAt(di++, m4); }
  dashes.count = di;
  dashes.receiveShadow = true;
  out.push(dashes);
  // The plaza: pale stone, fan-patterned cobbles round its rim, eight lawn parterres between the avenues,
  // a stone apron round the tower and two fountains either side of the line.
  const R = plan.plaza.r, cx = plan.plaza.cx;
  const flat = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number, tile: number, at?: { x: number; z: number }) => {
    geo.rotateX(-Math.PI / 2);
    geo.translate(at?.x ?? cx, y, at?.z ?? 0);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / tile, -pos.getZ(i) / tile);
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    out.push(m);
    return m;
  };
  flat(new THREE.CircleGeometry(R + STREET.facade - 10, 128), cobble, -0.035, 2.5);
  const plazaStone = mk("granite_tile", 2.3, { color: "#fbf7ef", bright: 1.55 });
  plazaPattern(plazaStone, new THREE.Vector2(cx, 0), R - 4);
  flat(new THREE.CircleGeometry(R - 4, 128), plazaStone, -0.022, 2.3);
  const lawnIn = R * 0.3, lawnOut = R * 0.9;
  for (let i = 0; i < 8; i++) {
    const c0 = Math.PI + (i * Math.PI) / 4, c1 = c0 + Math.PI / 4;
    // Paths: along each avenue's line (the line of giants runs down the boulevard's).
    const pathHalf = (k: number) => ((k % 8) === 0 || (k % 8) === 4 ? 14 : 9);
    const t0 = c0 + Math.asin(Math.min(0.9, pathHalf(i) / lawnIn)), t1 = c1 - Math.asin(Math.min(0.9, pathHalf(i + 1) / lawnIn));
    if (t1 <= t0) continue;
    const g = new THREE.RingGeometry(lawnIn, lawnOut, 32, 2, -t1, t1 - t0);
    flat(g, grass, -0.01, 2);
  }
  // The line's lawn runs on into the plaza, where the giants stand.
  strip("plaza-lawn", lineLawn, x1, cx + R * 0.86, -16, 16, 0, 0.9);
  flat(new THREE.CircleGeometry(66, 64), prom, 0.08, 2.3, { x: plan.tower.x, z: plan.tower.z });
  // Fountains: a stone basin, water and a spray.
  const basinM = new THREE.MeshStandardMaterial({ color: "#e8e1d3", roughness: 0.7 });
  const water = new THREE.MeshStandardMaterial({ color: "#3d6f8f", roughness: 0.05, metalness: 0.2, envMapIntensity: 1.4 });
  const spray = new THREE.MeshStandardMaterial({ color: "#eaf6ff", roughness: 0.3, transparent: true, opacity: 0.75, emissive: "#9fd3ff", emissiveIntensity: 0.15 });
  for (const sz of [1, -1]) {
    const fx = cx + Math.cos(Math.PI - 0.62) * R * 0.6, fz = sz * Math.sin(0.62) * R * 0.6;
    flat(new THREE.CircleGeometry(15, 48), prom, 0.07, 2.3, { x: fx, z: fz });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(9, 0.55, 8, 48).rotateX(Math.PI / 2).translate(fx, 0.55, fz), basinM);
    rim.castShadow = rim.receiveShadow = true;
    out.push(rim);
    flat(new THREE.CircleGeometry(9, 48), water, 0.5, 4, { x: fx, z: fz });
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.8, 2.4, 16).translate(fx, 1.2, fz), basinM);
    ped.castShadow = ped.receiveShadow = true;
    out.push(ped);
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(2.4, 24, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).translate(fx, 3.3, fz), basinM);
    bowl.castShadow = true;
    out.push(bowl);
    const jet = new THREE.Mesh(new THREE.ConeGeometry(1.1, 5.5, 16, 1, true).rotateX(Math.PI).translate(fx, 6.2, fz), spray);
    out.push(jet);
  }
  for (const m of out) { m.matrixAutoUpdate = false; m.updateMatrix(); }
  return out;
}
