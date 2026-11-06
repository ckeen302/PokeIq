import * as THREE from "three";
import { CORNICE_Y, DISTRICT_COLORS, ROOF_Y, STREET, boulevardDistricts, boulevardEnd, districtAt, wrap, type District, type WorldPlan } from "@/lib/sizes/world";
import { ATLAS, AWNING_ROWS, BALCONY_FLOORS, BAY_M, FLOORS_M, GROUND_M, UPPER_M, awningTexture, facadeAtlas, railingTexture, type FacadeMaps } from "./facade";
import { Buckets, Geo, rng } from "./geo";
import { cutaway, groundVariation, lawnStripes, plazaPattern, type Shared } from "./shaders";

/**
 * The Lumiose City tribute: Haussmann street walls in cream and sandstone
 * along the Grand Boulevard (lit shopfronts and café awnings in their
 * district's colour, wrought-iron balconies, cornices, grey slate mansards
 * with dormers and chimneys); the great round plaza with Prism Tower at its
 * centre, ringed by buildings facing it and opened by the boulevard and four
 * avenues; the round city of courtyard blocks spreading out from it (seen
 * whole in the aerial finale), with each district's colour plaza; and the
 * ground: stone promenade, asphalt, pavements, fan-patterned cobbles, lawns,
 * the ring promenade the giants stand on round the tower, fountains. Built
 * once per line as merged meshes in chunks.
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
  /** The district's awning row (see AWNING_ROWS). */
  style: number;
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
    // Most awnings wear the district's colour; a few are classic.
    if (opts.awnings && opts.shops && shop % 3 !== 2 && r() < 0.62) awning(B, o, dir, n, k, r() < 0.78 ? opts.style : 5 + Math.floor(r() * 3), cx);
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
  const v0 = 1 - (style + 1) / AWNING_ROWS, v1 = 1 - style / AWNING_ROWS;
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
  // The shallow upper slope is zinc, paler and bluer than the slates below (each roof a shade of its own).
  const zinc = new THREE.Color(1.22, 1.27, 1.34).multiplyScalar(0.94 + r() * 0.12);
  const tile = 3;
  const slope = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, w: number, h: number, col = grey) => g.quad(a, b, c, d, [0, 0, w / tile, 0, w / tile, h / tile, 0, h / tile], col);
  // Front lower and upper slopes, back lower and upper slopes.
  slope(P(0, 0, y0), P(len, 0, y0), P(len, inset, y1), P(0, inset, y1), len, 3.6);
  slope(P(0, inset, y1), P(len, inset, y1), P(len, depth / 2, y2), P(0, depth / 2, y2), len, depth / 2, zinc);
  slope(P(len, depth, y0), P(0, depth, y0), P(0, depth - inset, y1), P(len, depth - inset, y1), len, 3.6);
  slope(P(len, depth - inset, y1), P(0, depth - inset, y1), P(0, depth / 2, y2), P(len, depth / 2, y2), len, depth / 2, zinc);
  // Gable ends (hipped look at row ends).
  for (const [u, open] of [[0, endL], [len, endR]] as const) {
    const s = u === 0 ? 1 : -1;
    const ii = open ? inset : 0;
    const a = P(u, 0, y0), b = P(u, depth, y0), c = P(u + s * ii, depth - inset, y1), d = P(u + s * ii, inset, y1), e = P(u + s * ii, depth / 2, y2);
    if (s > 0) {
      g.quad(b, a, d, c, [0, 0, depth / tile, 0, depth / tile, 1, 0, 1], grey);
      g.tri(c, d, e, [0, 0, 1, 0, 0.5, 0.6], zinc);
    } else {
      g.quad(a, b, c, d, [0, 0, depth / tile, 0, depth / tile, 1, 0, 1], grey);
      g.tri(d, c, e, [0, 0, 1, 0, 0.5, 0.6], zinc);
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

/** Flowers seen from afar: a green bed dotted with blooms in a district's colour, white and gold. */
function flowerTexture(color: string): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#3f6e33";
  g.fillRect(0, 0, 128, 128);
  const r = rng(77);
  // Mostly the district's colour, densely (it must read as that colour from the sky), a few white and gold.
  for (let i = 0; i < 1100; i++) {
    const k = r();
    g.fillStyle = k < 0.88 ? color : k < 0.95 ? "#f6f1e4" : "#f2c84b";
    g.globalAlpha = 0.75 + r() * 0.25;
    g.beginPath();
    g.arc(r() * 128, r() * 128, 1.6 + r() * 2, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Whether a block (an annular sector round the plaza's centre) would stand in the boulevard's corridor or on a colour plaza. */
function blocked(plan: WorldPlan, C: { x: number; z: number }, r0: number, r1: number, a0: number, a1: number): boolean {
  const corridor = STREET.facade + STREET.depth + 14;
  // An open esplanade on the camera's side (plan.open) keeps that side clear much further out.
  const near = plan.open ? plan.open + 14 : corridor;
  for (let i = 0; i <= 4; i++) {
    for (let j = 0; j <= 4; j++) {
      const r = r0 + ((r1 - r0) * i) / 4, a = a0 + ((a1 - a0) * j) / 4;
      const x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r;
      if (z < corridor && z > -near && x < plan.plaza.cx + 10 && x > plan.x0 - 40) return true;
      for (const d of plan.districts) if (Math.hypot(x - d.plaza.x, z - d.plaza.z) < d.plaza.r + 26) return true;
    }
  }
  return false;
}

const styleOf = (d: District) => Math.max(0, DISTRICT_COLORS.findIndex((c) => c.name === d.name));

export function buildCity(plan: WorldPlan, shared: Shared, tex: CityTextures, quality: { facadeScale: 1 | 2; anisotropy: number; blocks: number }): City {
  const group = new THREE.Group();
  group.name = "city";
  const B = new Buckets(CHUNK);
  const F = STREET.facade, D = STREET.depth;
  const C = { x: plan.plaza.cx, z: plan.plaza.cz };
  const sides = boulevardDistricts(plan);

  // ---- The boulevard's two street walls, broken by side streets, up to the buildings round the plaza.
  const crossEvery = 132;
  const crossW = 16;
  for (const [side, seedBase] of [[1, 1], [-1, 2]] as const) {
    // The camera's side is an open esplanade when the line has a giant on the boulevard (plan.open).
    if (side < 0 && plan.open) continue;
    const z = side * F;
    const xEnd = boulevardEnd(plan, z, 12) - 3;
    const n = new THREE.Vector3(0, 0, -side);
    let x = plan.x0, k = 0;
    while (x < xEnd - 10) {
      const xe = Math.min(xEnd, x + crossEvery - crossW);
      // A facade runs so that its outward normal is dir × up: on the far side (+z, facing -z) towards -x.
      const a = new THREE.Vector3(side > 0 ? xe : x, 0, z), b = new THREE.Vector3(side > 0 ? x : xe, 0, z);
      if (xe - x > BAY_M * 3) streetWall(B, a, b, n, D, { shops: true, details: true, awnings: side > 0, seed: seedBase * 1000 + k, style: styleOf(side > 0 ? sides.far : sides.near) });
      x += crossEvery;
      k++;
    }
  }

  // ---- The plaza's ring of buildings facing the tower, open where the boulevard and the four avenues leave.
  const ringR = plan.plaza.r + 12;
  const gaps: [number, number][] = [];
  {
    // The boulevard meets the ring off its centre line: open between its two building lines.
    const half = F + D + 4;
    const sHi = Math.max(-1, Math.min(1, (half - C.z) / ringR)), sLo = Math.max(-1, Math.min(1, (-half - C.z) / ringR));
    gaps.push([wrap(Math.PI - Math.asin(sHi)), wrap(Math.PI - Math.asin(sLo))]);
    for (const av of plan.avenues.slice(1)) { const h = Math.asin(Math.min(1, 21 / ringR)); gaps.push([wrap(av - h), wrap(av + h)]); }
  }
  // Walk round from the end of each gap to the start of the next.
  const sorted = gaps.map(([a, b]) => [a, b < a ? b + Math.PI * 2 : b] as [number, number]).sort((p, q) => p[0] - q[0]);
  for (let i = 0; i < sorted.length; i++) {
    const a0 = sorted[i][1];
    let a1 = sorted[(i + 1) % sorted.length][0];
    while (a1 <= a0) a1 += Math.PI * 2;
    const segs = Math.max(2, Math.round(((a1 - a0) * ringR) / 26));
    for (let sg = 0; sg < segs; sg++) {
      const t0 = a0 + ((a1 - a0) * sg) / segs, t1 = a0 + ((a1 - a0) * (sg + 1)) / segs;
      // Facing the centre: dir = up × n runs towards increasing angle. Overlap neighbours a little so the joints close.
      const e = 0.6 / ringR;
      const p0 = new THREE.Vector3(C.x + Math.cos(t0 - e) * ringR, 0, C.z + Math.sin(t0 - e) * ringR);
      const p1 = new THREE.Vector3(C.x + Math.cos(t1 + e) * ringR, 0, C.z + Math.sin(t1 + e) * ringR);
      const mid = p0.clone().add(p1).multiplyScalar(0.5);
      const n = new THREE.Vector3(C.x - mid.x, 0, C.z - mid.z).normalize();
      streetWall(B, p0, p1, n, D, { shops: true, details: true, awnings: true, seed: 9000 + i * 31 + sg, style: styleOf(districtAt(plan, mid.x, mid.z)) });
    }
  }

  // ---- The round city: courtyard blocks in rings round the plaza, out past the boulevard's far end, cut by the avenues and the ring streets.
  const M = new Buckets(640);
  const ring0 = ringR + D + 18;
  // Out to the boulevard's far end, and at least far enough that the finale's aerial sees a city all round (blocks are cheap: lighter qualities thin them less than the street walls).
  const rMax = Math.max(ringR + 620, Math.hypot(C.x - plan.x0, C.z) + 160) * (0.55 + 0.45 * quality.blocks);
  const dividers = plan.avenues.map((a) => wrap(a)).sort((p, q) => p - q);
  let seed = 1;
  for (let r0 = ring0; r0 < rMax; r0 += 96) {
    const r1 = r0 + 78;
    for (let i = 0; i < dividers.length; i++) {
      // Keep each avenue's corridor clear (its width is constant, so the angle it takes shrinks outwards).
      const s0 = dividers[i] + Math.asin(Math.min(1, 30 / r0));
      let s1 = dividers[(i + 1) % dividers.length] - Math.asin(Math.min(1, 30 / r0));
      while (s1 <= s0) s1 += Math.PI * 2;
      const rm = (r0 + r1) / 2;
      const nb = Math.max(1, Math.round(((s1 - s0) * rm) / 140));
      const street = 16 / rm;
      for (let k = 0; k < nb; k++) {
        const b0 = s0 + ((s1 - s0) * k) / nb + (k ? street / 2 : 0);
        const b1 = s0 + ((s1 - s0) * (k + 1)) / nb - (k < nb - 1 ? street / 2 : 0);
        if (!blocked(plan, C, r0, r1, b0, b1)) { massBlock(M, C, r0, r1, b0, b1, seed++); continue; }
        // Next to the boulevard or a colour plaza: smaller blocks, where they fit.
        const parts = Math.max(2, Math.round(((b1 - b0) * rm) / 46));
        for (let q = 0; q < parts; q++) {
          const c0 = b0 + ((b1 - b0) * q) / parts + (q ? street / 3 : 0), c1 = b0 + ((b1 - b0) * (q + 1)) / parts - (q < parts - 1 ? street / 3 : 0);
          if (!blocked(plan, C, r0, r1, c0, c1)) massBlock(M, C, r0, r1, c0, c1, seed++);
          else if (!blocked(plan, C, r0, r0 + 34, c0, c1)) massBlock(M, C, r0, r0 + 34, c0, c1, seed++);
        }
      }
    }
  }
  // ---- Materials.
  const atlas: FacadeMaps = facadeAtlas(quality.facadeScale, quality.anisotropy);
  const facade = new THREE.MeshStandardMaterial({ map: atlas.map, normalMap: atlas.normalMap, roughnessMap: atlas.orm, metalnessMap: atlas.orm, aoMap: atlas.orm, aoMapIntensity: 0.6, emissiveMap: atlas.emissive, emissive: "#ffffff", emissiveIntensity: 0.62, vertexColors: true, roughness: 1, metalness: 1, normalScale: new THREE.Vector2(1.1, 1.1) });
  const stone = new THREE.MeshStandardMaterial({ ...tex.pbr("sandstone_blocks_08", 3, { color: "#ffffff" }), vertexColors: true });
  const roofM = new THREE.MeshStandardMaterial({ ...tex.pbr("roof_slates_03", 3, { color: "#8d98a6", normalScale: 1.2 }), vertexColors: true, metalness: 0.15 });
  const rail = new THREE.MeshStandardMaterial({ map: railingTexture(quality.anisotropy), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6 });
  const awn = new THREE.MeshStandardMaterial({ map: awningTexture(DISTRICT_COLORS.map((d) => d.color)), side: THREE.DoubleSide, roughness: 0.85 });
  const pots = new THREE.MeshStandardMaterial({ color: "#b5643f", roughness: 0.8 });
  const mass = new THREE.MeshStandardMaterial({ map: atlas.mass.map, normalMap: atlas.mass.normalMap, roughnessMap: atlas.mass.orm, metalnessMap: atlas.mass.orm, aoMap: atlas.mass.orm, aoMapIntensity: 0.6, emissiveMap: atlas.mass.emissive, emissive: "#ffffff", emissiveIntensity: 0.45, vertexColors: true, roughness: 1, metalness: 1 });
  const mats: Record<string, THREE.Material> = { facade, stone, roof: roofM, rail, awning: awn, pots, mass };
  for (const m of Object.values(mats)) cutaway(m as THREE.MeshStandardMaterial, shared);
  const shadowCasters: THREE.Mesh[] = [];
  for (const mesh of B.meshes(mats, { cast: (m) => m !== "rail" && m !== "awning" })) group.add(mesh);
  for (const mesh of M.meshes(mats)) { group.add(mesh); shadowCasters.push(mesh); }

  // ---- Ground.
  const ground = buildGround(plan, shared, tex, quality.blocks);
  group.add(...ground.meshes);

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
      ground.dispose();
    },
  };
}

/** The ground: flat strips and discs with world-scaled UVs, the plaza's pattern, the ring promenade, fountains and the colour plazas. */
/** `detail` is the quality's share of the city (see QUALITY.blocks): the lighter ones plant fewer, simpler flowers. */
function buildGround(plan: WorldPlan, shared: Shared, tex: CityTextures, detail = 1): { meshes: THREE.Mesh[]; dispose(): void } {
  const out: THREE.Mesh[] = [];
  const own: THREE.Material[] = [];
  const strip = (name: string, mat: THREE.MeshStandardMaterial, x0: number, x1: number, z0: number, z1: number, y: number, tile: number) => {
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
  const mk = (name: string, tile: number, opts?: { color?: string; normalScale?: number; bright?: number }) => {
    const m = new THREE.MeshStandardMaterial(tex.pbr(name, tile, opts));
    if (opts?.bright) m.color.multiplyScalar(opts.bright);
    groundVariation(m);
    own.push(m);
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
  own.push(curb);
  const { x0, x1 } = plan;
  const R = plan.plaza.r, cx = plan.plaza.cx, cz = plan.plaza.cz;
  const ring = plan.ring;
  const lineIn = ring ? ring.s0 : x1;
  // Far enough that the haze has swallowed the ground's edge long before it (no seam against the sky from the finale's height).
  const far = 7000;
  // Base: the whole city's streets.
  strip("ground-base", asphalt, Math.min(x0, cx - R) - far, cx + R + far, cz - R - far, cz + R + far, -0.05, 3);
  // The boulevard: promenade (a lawn with stone edging) on into the plaza, then per side road and pavement up to the plaza.
  strip("promenade", prom, x0, lineIn + 6, -STREET.promenade, STREET.promenade, -0.006, 2.3);
  strip("lawn", lineLawn, x0, lineIn + (ring ? 0.5 : 4), -STREET.promenade + 1.1, STREET.promenade - 1.1, 0, 0.9);
  // The camera's open side (plan.open): a long lawn past the pavement.
  if (plan.open) strip("esplanade", grass, x0 - 40, boulevardEnd(plan, -STREET.facade), -plan.open, -STREET.facade - 0.6, 0.06, 2);
  for (const s of [1, -1]) {
    const lo = (a: number, b: number) => [Math.min(s * a, s * b), Math.max(s * a, s * b)] as const;
    const [p0, p1] = lo(STREET.roadOut + 0.3, STREET.facade + 0.6);
    strip("pavement", walk, x0, boulevardEnd(plan, s * STREET.facade), p0, p1, 0.12, 3);
    const [t0, t1] = lo(STREET.promenade, STREET.roadIn);
    strip("allee", walk, x0, boulevardEnd(plan, s * STREET.roadIn), t0, t1, 0.12, 3);
    // Kerbs.
    for (const zk of [STREET.roadIn, STREET.roadOut]) {
      const xe = boulevardEnd(plan, s * zk);
      const geo = new THREE.BoxGeometry(xe - x0, 0.14, 0.3);
      geo.translate((x0 + xe) / 2, 0.07, s * zk);
      const m = new THREE.Mesh(geo, curb);
      m.receiveShadow = true;
      out.push(m);
    }
  }
  // Lane markings.
  const dash = new THREE.MeshStandardMaterial({ color: "#f2f0e8", roughness: 0.6 });
  own.push(dash);
  const dashes = new THREE.InstancedMesh(new THREE.PlaneGeometry(3, 0.15).rotateX(-Math.PI / 2), dash, Math.ceil((x1 - x0) / 9) * 4 + 4);
  let di = 0;
  const m4 = new THREE.Matrix4();
  for (const s of [1, -1]) for (const lane of [16, 20]) for (let x = x0; x < boulevardEnd(plan, s * lane) - 6; x += 9) { m4.makeTranslation(x, 0.01, s * lane); dashes.setMatrixAt(di++, m4); }
  dashes.count = di;
  dashes.receiveShadow = true;
  out.push(dashes);
  {
    const lr = R + 3.6;
    const n = Math.round((Math.PI * 2 * lr) / 9);
    const ringDashes = new THREE.InstancedMesh(new THREE.PlaneGeometry(3, 0.15).rotateX(-Math.PI / 2), dash, n);
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), at = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      at.set(cx + Math.cos(a) * lr, 0.012, cz + Math.sin(a) * lr);
      // Not across the line's lawn where it enters the plaza.
      if (Math.abs(at.z) < STREET.promenade + 1 && at.x < cx) continue;
      ringDashes.setMatrixAt(k++, m4.compose(at, q.setFromAxisAngle(up, Math.atan2(Math.cos(a), Math.sin(a))), one));
    }
    ringDashes.count = k;
    ringDashes.receiveShadow = true;
    out.push(ringDashes);
  }
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
  /** An arc of a ring round the plaza's centre between world angles a0 < a1 (RingGeometry runs the other way once laid flat). */
  const arc = (r0: number, r1: number, a0: number, a1: number, segs: number) => new THREE.RingGeometry(r0, r1, segs, 1, -a1, a1 - a0);
  // The plaza: fan-patterned cobbles round its rim, pale stone with a radial pattern inside.
  flat(new THREE.CircleGeometry(R + STREET.facade - 10, 160), cobble, -0.035, 2.5);
  const plazaStone = mk("granite_tile", 2.3, { color: "#fcf6ea", bright: 1.7 });
  plazaPattern(plazaStone, new THREE.Vector2(cx, cz), R - 4, { entry: plan.districts[0]?.a0 ?? 0, colors: plan.districts.map((d) => new THREE.Color(d.color)) });
  flat(new THREE.CircleGeometry(R - 4, 160), plazaStone, -0.022, 2.3);
  // The plaza's ring road, the city's great roundabout: two lanes between the lamps on the plaza's edge and the buildings round it.
  flat(new THREE.RingGeometry(R - 1, R + 8.2, 240, 1), asphalt, -0.03, 3);
  const rr = ring?.r ?? Math.max(60, R - 120);
  // The ring promenade the giants stand on: a band of cobbles edged in stone, with the line's lawn running round it.
  if (ring) {
    const span = (plan.lineEnd - ring.s0) / ring.r;
    const a0 = -Math.PI / 2 - 0.08, a1 = -Math.PI / 2 + span + 0.25;
    flat(arc(rr - 17, rr + 17, a0 - 0.05, a1 + 0.05, 160), prom, -0.012, 2.3);
    const lawnArc = flat(arc(rr - 10, rr + 10, -Math.PI / 2, a1, 160), lineLawn, 0, 0.9);
    lawnArc.name = "ring-lawn";
    // The straight lawn's end joins the ring's start without a seam.
  }
  // Between the ring and the plaza's edge: French parterres, clipped box hedges round raised beds of flowers in the colour of the district beyond (knee-high: they never hide a figure).
  {
    const flowers = new Map<string, THREE.MeshStandardMaterial>();
    const hedges = new Geo();
    const hedgeTint = [new THREE.Color(0.92, 0.97, 0.9), new THREE.Color(0.84, 0.9, 0.82), new THREE.Color(1, 1, 0.94)];
    const blooms: THREE.Matrix4[] = [], bloomCols: THREE.Color[] = [];
    const rnd = rng(5150);
    /** A clipped hedge from a to b (its corners overlap the next run's). */
    const hedgeRun = (a: THREE.Vector3, b: THREE.Vector3, h: number, w: number) => {
      const len = a.distanceTo(b);
      if (len < 0.05) return;
      hedges.box((a.x + b.x) / 2, 0, (a.z + b.z) / 2, len + w, h, w, Math.atan2(-(b.z - a.z), b.x - a.x), hedgeTint[Math.floor(rnd() * hedgeTint.length)], 1.2, 0b011111);
    };
    const at = (r: number, a: number) => new THREE.Vector3(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r);
    const arcRun = (r: number, a0: number, a1: number, h: number, w: number) => {
      const n = Math.max(2, Math.round(((a1 - a0) * r) / 6));
      for (let i = 0; i < n; i++) hedgeRun(at(r, a0 + ((a1 - a0) * i) / n), at(r, a0 + ((a1 - a0) * (i + 1)) / n), h, w);
    };
    const r0 = rr + 30, r1 = R - 24;
    if (r1 - r0 > 18) {
      for (let k = 0; k < 16; k++) {
        const a0 = (k * Math.PI) / 8 + 0.06, a1 = ((k + 1) * Math.PI) / 8 - 0.06;
        const am = (a0 + a1) / 2;
        // Keep the line's way into the plaza open.
        const px = cx + Math.cos(am) * (r0 + r1) / 2, pz = cz + Math.sin(am) * (r0 + r1) / 2;
        if (Math.abs(pz) < STREET.facade && px < cx) continue;
        if (Math.abs(Math.sin(am - Math.atan2(-cz, x1 - cx))) < 0.2 && Math.cos(am - Math.atan2(-cz, x1 - cx)) > 0) continue;
        const d = districtAt(plan, px, pz);
        let fm = flowers.get(d.name);
        if (!fm) {
          fm = new THREE.MeshStandardMaterial({ map: flowerTexture(d.color), roughness: 0.85 });
          fm.map!.wrapS = fm.map!.wrapT = THREE.RepeatWrapping;
          flowers.set(d.name, fm);
          own.push(fm);
        }
        // Gravel under the hedges, then the beds raised a little inside them.
        flat(arc(r0 - 1.2, r1 + 1.2, a0 - 1.2 / r0, a1 + 1.2 / r0, 12), prom, 0.02, 2.3);
        flat(arc(r0, r1, a0, a1, 12), fm, 0.2, 3.2);
        // The border, and a hedge across the middle making two beds.
        const rm = (r0 + r1) / 2;
        arcRun(r0, a0, a1, 0.62, 0.8);
        arcRun(r1, a0, a1, 0.62, 0.8);
        arcRun(rm, a0 + 0.8 / rm, a1 - 0.8 / rm, 0.5, 0.65);
        hedgeRun(at(r0, a0), at(r1, a0), 0.62, 0.8);
        hedgeRun(at(r0, a1), at(r1, a1), 0.62, 0.8);
        // Flowers standing in the beds: mostly the district's colour, some white and gold.
        const base = new THREE.Color(d.color);
        for (let rb = r0 + 1.8; rb < r1 - 1.3; rb += 2.6) {
          if (Math.abs(rb - rm) < 1.2) continue;
          const span = (a1 - a0) * rb - 2.6;
          const n = Math.max(1, Math.floor(span / 2.6));
          for (let i = 0; i < n; i++) {
            if (blooms.length >= 9000 * detail) break;
            const a = a0 + (1.3 + (i + 0.5) * (span / n) + (rnd() - 0.5) * 0.8) / rb;
            const p = at(rb + (rnd() - 0.5) * 0.8, a);
            const sc = 0.6 + rnd() * 0.4;
            blooms.push(new THREE.Matrix4().compose(p.setY(0.22 + sc * 0.16), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28), new THREE.Vector3(sc * 1.25, sc * (0.5 + rnd() * 0.2), sc * 1.25)));
            const kc = rnd();
            bloomCols.push(kc < 0.86 ? base.clone().offsetHSL((rnd() - 0.5) * 0.02, 0, (rnd() - 0.5) * 0.1) : kc < 0.95 ? new THREE.Color("#f7f2e6") : new THREE.Color("#f2c84b"));
          }
        }
      }
    }
    if (!hedges.empty) {
      const hedge = new THREE.MeshStandardMaterial({ ...tex.pbr("leafy_grass", 1.2, { color: "#7fa862" }), vertexColors: true, roughness: 0.95 });
      cutaway(hedge, shared);
      own.push(hedge);
      const mesh = new THREE.Mesh(hedges.build(), hedge);
      mesh.castShadow = mesh.receiveShadow = true;
      out.push(mesh);
    }
    if (blooms.length) {
      const petals = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.75 });
      cutaway(petals, shared);
      own.push(petals);
      // Rounded clumps; on the lighter qualities a simpler shape (8 triangles, not 20).
      const geo = detail >= 0.7 ? new THREE.IcosahedronGeometry(0.5, 0) : new THREE.OctahedronGeometry(0.55, 0);
      const mesh = new THREE.InstancedMesh(geo, petals, blooms.length);
      blooms.forEach((m, i) => { mesh.setMatrixAt(i, m); mesh.setColorAt(i, bloomCols[i]); });
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      out.push(mesh);
    }
  }
  // Inside the ring: lawns between paths that radiate from the tower, a stone apron round its feet, four fountains.
  const inner = rr - 20;
  const apron = 58;
  for (let i = 0; i < 8; i++) {
    const c0 = (i * Math.PI) / 4 + 0.07, c1 = ((i + 1) * Math.PI) / 4 - 0.07;
    const pathHalf = 7;
    const t0 = c0 + Math.asin(Math.min(0.9, pathHalf / apron)), t1 = c1 - Math.asin(Math.min(0.9, pathHalf / apron));
    if (t1 > t0 && inner > apron + 10) flat(arc(apron + 8, inner, t0, t1, 24), grass, -0.01, 2);
  }
  flat(new THREE.CircleGeometry(apron, 64), prom, 0.06, 2.3);
  const basinM = new THREE.MeshStandardMaterial({ color: "#e8e1d3", roughness: 0.7 });
  const water = new THREE.MeshStandardMaterial({ color: "#3d6f8f", roughness: 0.05, metalness: 0.2, envMapIntensity: 1.4 });
  const spray = new THREE.MeshStandardMaterial({ color: "#eaf6ff", roughness: 0.3, transparent: true, opacity: 0.72, emissive: "#9fd3ff", emissiveIntensity: 0.18, depthWrite: false });
  own.push(basinM, water, spray);
  const fountain = (fx: number, fz: number, size: number) => {
    flat(new THREE.CircleGeometry(size * 1.6, 48), prom, 0.07, 2.3, { x: fx, z: fz });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(size, size * 0.06, 8, 48).rotateX(Math.PI / 2).translate(fx, size * 0.06, fz), basinM);
    rim.castShadow = rim.receiveShadow = true;
    out.push(rim);
    flat(new THREE.CircleGeometry(size, 48), water, size * 0.055, 4, { x: fx, z: fz });
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.13, size * 0.2, size * 0.27, 16).translate(fx, size * 0.135, fz), basinM);
    ped.castShadow = ped.receiveShadow = true;
    out.push(ped);
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(size * 0.27, 24, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).translate(fx, size * 0.37, fz), basinM);
    bowl.castShadow = true;
    out.push(bowl);
    const jet = new THREE.Mesh(new THREE.ConeGeometry(size * 0.12, size * 0.6, 16, 1, true).rotateX(Math.PI).translate(fx, size * 0.68, fz), spray);
    out.push(jet);
  };
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const fr = (apron + inner) / 2;
    if (inner - apron > 30) fountain(cx + Math.cos(a) * fr, cz + Math.sin(a) * fr, 8.5);
  }
  // The colour plazas, one per district: a disc of cobbles, a ring of stone in the district's colour, flower beds and a fountain.
  for (const d of plan.districts) {
    const p = d.plaza;
    flat(new THREE.CircleGeometry(p.r + 10, 64), cobble, -0.03, 2.5, p);
    const tint = mk("granite_tile", 2.3, { color: d.color, bright: 1.15 });
    flat(new THREE.RingGeometry(p.r * 0.55, p.r * 0.85, 64, 1), tint, -0.02, 2.3, p);
    const beds = new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.75 });
    own.push(beds);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const bed = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 0.7, 20).translate(p.x + Math.cos(a) * p.r * 0.92, 0.35, p.z + Math.sin(a) * p.r * 0.92), beds);
      bed.castShadow = bed.receiveShadow = true;
      out.push(bed);
    }
    fountain(p.x, p.z, 7);
  }
  for (const m of out) { m.matrixAutoUpdate = false; m.updateMatrix(); }
  return { meshes: out, dispose() { for (const m of own) m.dispose(); } };
}
