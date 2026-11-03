import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { STREET, boulevardDistricts, boulevardEnd, wrap, type WorldPlan } from "@/lib/sizes/world";
import { rng } from "./geo";
import { cutaway, type Shared } from "./shaders";

/**
 * Street furniture for the boulevard and the plaza, all instanced (and kept
 * low in triangles: hundreds of cars line the boulevard): London plane
 * trees along the pavements, round the plaza and down the avenues,
 * cast-iron lantern posts (lit), café terraces with parasols in the
 * district's colour, parked and passing cars and buses (plain liveries, no
 * logos) and Morris advertising columns. Original procedural models.
 */

export interface Props {
  group: THREE.Group;
  /** Alpha to coverage on the leaves only where the frame is multisampled (without it every leaf card's soft edge is drawn whole: blocky clumps). */
  setCoverage(on: boolean): void;
  dispose(): void;
}

const CAR_COLOURS = ["#f2f2f0", "#1d1f22", "#9aa1a8", "#6d7680", "#8e1b1b", "#203a63", "#2f4f3a", "#d8d2c4", "#45484c", "#b8bcc2", "#5a2a4a", "#c9a227"].map((c) => new THREE.Color(c));

/** A canopy of leaf cards: alpha-cut leaf clusters scattered through an ellipsoid, with normals pointing out from its centre (soft, volumetric shading). */
function canopyGeometry(seed: number): THREE.BufferGeometry {
  const r = rng(seed);
  const cards = 64;
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  const cy = 11.2, rx = 4.6, ry = 3.4, rz = 4.6;
  const centre = new THREE.Vector3(0, cy, 0);
  for (let i = 0; i < cards; i++) {
    // Mostly near the surface of the ellipsoid, some inside.
    const u = r() * 2 - 1, th = r() * Math.PI * 2, k = 0.55 + 0.45 * Math.cbrt(r());
    const sx = Math.sqrt(1 - u * u) * Math.cos(th), sz = Math.sqrt(1 - u * u) * Math.sin(th);
    const c = new THREE.Vector3(sx * rx * k, cy + u * ry * k, sz * rz * k);
    const size = 2.3 + r() * 1.3;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * Math.PI, r() * Math.PI, r() * Math.PI));
    const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(q).multiplyScalar(size / 2);
    const ay = new THREE.Vector3(0, 1, 0).applyQuaternion(q).multiplyScalar(size / 2);
    const corners = [c.clone().sub(ax).sub(ay), c.clone().add(ax).sub(ay), c.clone().add(ax).add(ay), c.clone().sub(ax).add(ay)];
    const base = pos.length / 3;
    const quadrant = Math.floor(r() * 4);
    const u0 = (quadrant % 2) * 0.5, v0 = Math.floor(quadrant / 2) * 0.5;
    corners.forEach((p, j) => {
      pos.push(p.x, p.y, p.z);
      const n = p.clone().sub(centre).multiply(new THREE.Vector3(1 / rx, 1 / ry, 1 / rz)).normalize();
      nrm.push(n.x, n.y, n.z);
      uv.push(u0 + (j === 1 || j === 2 ? 0.5 : 0), v0 + (j >= 2 ? 0.5 : 0));
    });
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Canopy proportions shared by the leaf cards and their core. */
const CANOPY = { cy: 11.2, rx: 4.6, ry: 3.4, rz: 4.6 };

/**
 * The canopy's core: a lumpy ellipsoid of dense foliage inside the leaf
 * cards, so a crown reads as one leafy mass from afar (no sky showing
 * through it, no speckle where the cards' mipmaps thin out) and casts a
 * whole shadow. Normals point out from the centre, like the cards'.
 */
function canopyCore(seed: number): THREE.BufferGeometry {
  const { cy, rx, ry, rz } = CANOPY;
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  const r = rng(seed);
  const bump = new Map<string, number>();
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Corners shared by neighbouring faces move together (the geometry isn't indexed).
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let k = bump.get(key);
    if (k === undefined) { k = 0.62 + r() * 0.2; bump.set(key, k); }
    pos.setXYZ(i, v.x * rx * k, cy + v.y * ry * k, v.z * rz * k);
    n.set(v.x / rx, v.y / ry, v.z / rz).normalize();
    nrm.setXYZ(i, n.x, n.y, n.z);
  }
  g.computeBoundingSphere();
  return g;
}

/** Leaves drawn into a 256 px square at (ox, oy): varied greens, three-lobed, with a midrib. */
function drawLeaves(g: CanvasRenderingContext2D, ox: number, oy: number, count: number, spread: number, light: [number, number], r: () => number) {
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * spread;
    const x = ox + 128 + Math.cos(a) * d, y = oy + 128 + Math.sin(a) * d;
    const len = 15 + r() * 15, wid = len * (0.55 + r() * 0.2);
    const l = light[0] + r() * light[1];
    g.save();
    g.translate(x, y);
    g.rotate(r() * Math.PI * 2);
    g.fillStyle = `hsl(${88 + r() * 26}, ${42 + r() * 22}%, ${l * 100}%)`;
    g.beginPath();
    for (const t of [-0.55, 0, 0.55]) g.ellipse(Math.sin(t) * len * 0.35, -Math.cos(t) * len * 0.2, wid * 0.42, len * 0.5, t, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(20,40,10,0.35)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, len * 0.35);
    g.lineTo(0, -len * 0.4);
    g.stroke();
    g.restore();
  }
}

/** The core's foliage: dense leaves over deep shade, tiling (no transparency). */
function coreTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  const g = cv.getContext("2d")!;
  g.fillStyle = "hsl(98, 38%, 16%)";
  g.fillRect(0, 0, 256, 256);
  // Each layer is drawn at all nine neighbouring offsets (the same leaves each time), so leaves cross the edges seamlessly.
  for (const [seed, light] of [[456, [0.17, 0.16]], [789, [0.24, 0.2]]] as const) {
    for (let dx = -256; dx <= 256; dx += 256) for (let dy = -256; dy <= 256; dy += 256) drawLeaves(g, dx, dy, 110, 150, [light[0], light[1]], rng(seed));
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Leaf clusters (four per texture), drawn with varied greens and sun-catching edges. */
function leafTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 512;
  const g = cv.getContext("2d")!;
  const r = rng(99);
  for (let q = 0; q < 4; q++) {
    const ox = (q % 2) * 256, oy = Math.floor(q / 2) * 256;
    for (let i = 0; i < 150; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 108;
      const x = ox + 128 + Math.cos(a) * d, y = oy + 128 + Math.sin(a) * d;
      const len = 15 + r() * 15, wid = len * (0.55 + r() * 0.2);
      const l = 0.26 + r() * 0.26;
      g.save();
      g.translate(x, y);
      g.rotate(r() * Math.PI * 2);
      g.fillStyle = `hsl(${88 + r() * 26}, ${42 + r() * 22}%, ${l * 100}%)`;
      g.beginPath();
      // A lobed leaf: three overlapping points.
      for (const t of [-0.55, 0, 0.55]) {
        g.ellipse(Math.sin(t) * len * 0.35, -Math.cos(t) * len * 0.2, wid * 0.42, len * 0.5, t, 0, Math.PI * 2);
      }
      g.fill();
      g.strokeStyle = `rgba(20,40,10,0.35)`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, len * 0.35);
      g.lineTo(0, -len * 0.4);
      g.stroke();
      g.restore();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function trunkGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.17, 0.26, 8.5, 9, 4);
  trunk.translate(0, 4.25, 0);
  const b1 = new THREE.CylinderGeometry(0.07, 0.13, 3.6, 6);
  b1.translate(0, 1.8, 0);
  b1.rotateZ(0.55);
  b1.translate(0, 6.6, 0);
  const b2 = b1.clone().rotateY(2.2);
  const b3 = b1.clone().rotateY(4.1);
  return mergeGeometries([trunk, b1, b2, b3].map((g) => g.toNonIndexed()));
}

function lanternGeometry(): { iron: THREE.BufferGeometry; glass: THREE.BufferGeometry } {
  const base = new THREE.CylinderGeometry(0.2, 0.28, 0.9, 12);
  base.translate(0, 0.45, 0);
  const shaft = new THREE.CylinderGeometry(0.06, 0.09, 3.6, 10);
  shaft.translate(0, 2.7, 0);
  const collar = new THREE.CylinderGeometry(0.12, 0.08, 0.25, 10);
  collar.translate(0, 4.55, 0);
  const cap = new THREE.ConeGeometry(0.34, 0.32, 6);
  cap.translate(0, 5.5, 0);
  const finial = new THREE.SphereGeometry(0.06, 8, 6);
  finial.translate(0, 5.72, 0);
  const iron = mergeGeometries([base, shaft, collar, cap, finial].map((g) => g.toNonIndexed()));
  const glass = new THREE.CylinderGeometry(0.29, 0.17, 0.68, 6);
  glass.translate(0, 5.0, 0);
  return { iron, glass };
}

function morrisGeometry(): { body: THREE.BufferGeometry; band: THREE.BufferGeometry } {
  const pts = [[0, 0], [0.78, 0], [0.78, 0.25], [0.66, 0.32], [0.66, 3.1], [0.74, 3.2], [0.74, 3.32], [0.6, 3.38], [0.5, 3.7], [0.3, 3.95], [0.12, 4.05], [0.05, 4.3], [0, 4.35]].map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.LatheGeometry(pts, 20);
  const band = new THREE.CylinderGeometry(0.675, 0.675, 2.4, 20, 1, true);
  band.translate(0, 1.85, 0);
  return { body, band };
}

function carGeometry(): { body: THREE.BufferGeometry; glass: THREE.BufferGeometry; wheels: THREE.BufferGeometry } {
  const lower = new RoundedBoxGeometry(4.45, 0.78, 1.8, 1, 0.22);
  lower.translate(0, 0.72, 0);
  const roof = new RoundedBoxGeometry(2.25, 0.08, 1.5, 1, 0.04);
  roof.translate(-0.25, 1.62, 0);
  const body = mergeGeometries([lower.toNonIndexed(), roof.toNonIndexed()]);
  const cabin = new RoundedBoxGeometry(2.55, 0.56, 1.6, 1, 0.18);
  cabin.translate(-0.25, 1.33, 0);
  const wheelParts: THREE.BufferGeometry[] = [];
  for (const [x, z] of [[1.42, 0.82], [1.42, -0.82], [-1.38, 0.82], [-1.38, -0.82]]) {
    const w = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 10);
    w.rotateX(Math.PI / 2);
    w.translate(x, 0.34, z);
    wheelParts.push(w.toNonIndexed());
  }
  return { body, glass: cabin, wheels: mergeGeometries(wheelParts) };
}

function busGeometry(): { body: THREE.BufferGeometry; glass: THREE.BufferGeometry; wheels: THREE.BufferGeometry } {
  const body = new RoundedBoxGeometry(12, 2.6, 2.55, 1, 0.25);
  body.translate(0, 1.65, 0);
  const glass = new RoundedBoxGeometry(11.2, 1.05, 2.6, 1, 0.12);
  glass.translate(0.1, 2.25, 0);
  const wheelParts: THREE.BufferGeometry[] = [];
  for (const [x, z] of [[3.9, 1.12], [3.9, -1.12], [-3.6, 1.12], [-3.6, -1.12]]) {
    const w = new THREE.CylinderGeometry(0.5, 0.5, 0.32, 10);
    w.rotateX(Math.PI / 2);
    w.translate(x, 0.5, z);
    wheelParts.push(w.toNonIndexed());
  }
  return { body, glass, wheels: mergeGeometries(wheelParts) };
}

/** A district banner: a pennant in the district's colour with a pale prism emblem (original artwork). */
function bannerTexture(color: string): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = 64;
  cv.height = 160;
  const g = cv.getContext("2d")!;
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(64, 0);
  g.lineTo(64, 140);
  g.lineTo(32, 160);
  g.lineTo(0, 140);
  g.closePath();
  g.fill();
  const shade = g.createLinearGradient(0, 0, 64, 0);
  shade.addColorStop(0, "rgba(0,0,0,0.18)");
  shade.addColorStop(0.5, "rgba(255,255,255,0.08)");
  shade.addColorStop(1, "rgba(0,0,0,0.18)");
  g.fillStyle = shade;
  g.fill();
  g.fillStyle = "#f6edd6";
  g.fillRect(0, 8, 64, 5);
  g.fillRect(0, 122, 64, 4);
  // A small prism: a tall diamond with a bar across.
  g.beginPath();
  g.moveTo(32, 36);
  g.lineTo(44, 66);
  g.lineTo(32, 100);
  g.lineTo(20, 66);
  g.closePath();
  g.fill();
  g.fillStyle = color;
  g.fillRect(20, 64, 24, 4);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A café table for two: a round marble top on a cast-iron stem, and two bistro chairs. */
function terraceGeometry(): { iron: THREE.BufferGeometry; top: THREE.BufferGeometry; seats: THREE.BufferGeometry } {
  const stem = new THREE.CylinderGeometry(0.035, 0.05, 0.72, 6).translate(0, 0.36, 0);
  const foot = new THREE.CylinderGeometry(0.22, 0.24, 0.03, 10).translate(0, 0.015, 0);
  const top = new THREE.CylinderGeometry(0.33, 0.33, 0.035, 16).translate(0, 0.74, 0);
  const iron: THREE.BufferGeometry[] = [stem.toNonIndexed(), foot.toNonIndexed()];
  const seats: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const x = side * 0.62;
    for (const [lx, lz] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) iron.push(new THREE.CylinderGeometry(0.018, 0.018, 0.45, 4).translate(x + lx, 0.225, lz).toNonIndexed());
    seats.push(new THREE.CylinderGeometry(0.21, 0.21, 0.04, 12).translate(x, 0.47, 0).toNonIndexed());
    // The back, a woven panel turned to the table.
    seats.push(new THREE.BoxGeometry(0.04, 0.36, 0.38).translate(x + side * 0.2, 0.68, 0).toNonIndexed());
  }
  return { iron: mergeGeometries(iron), top: top.toNonIndexed(), seats: mergeGeometries(seats) };
}

/** A café parasol: a pole and an eight-sided canopy with a valance. */
function parasolGeometry(): { pole: THREE.BufferGeometry; canopy: THREE.BufferGeometry } {
  const pole = new THREE.CylinderGeometry(0.03, 0.03, 2.5, 6).translate(0, 1.25, 0);
  const cone = new THREE.ConeGeometry(1.45, 0.55, 8, 1, true).translate(0, 2.55, 0);
  const valance = new THREE.CylinderGeometry(1.45, 1.45, 0.18, 8, 1, true).translate(0, 2.2, 0);
  return { pole, canopy: mergeGeometries([cone.toNonIndexed(), valance.toNonIndexed()]) };
}

/** A Paris park bench: green-painted wooden slats on two cast-iron frames, 1.9 m long, facing +z. */
function benchGeometry(): { iron: THREE.BufferGeometry; wood: THREE.BufferGeometry } {
  const iron: THREE.BufferGeometry[] = [], wood: THREE.BufferGeometry[] = [];
  for (const x of [-0.82, 0.82]) {
    iron.push(new THREE.BoxGeometry(0.07, 0.44, 0.08).translate(x, 0.22, 0.2).toNonIndexed());
    iron.push(new THREE.BoxGeometry(0.07, 0.86, 0.08).rotateX(-0.2).translate(x, 0.43, -0.16).toNonIndexed());
    iron.push(new THREE.BoxGeometry(0.07, 0.06, 0.5).translate(x, 0.44, 0.02).toNonIndexed());
  }
  for (let k = 0; k < 3; k++) wood.push(new THREE.BoxGeometry(1.9, 0.04, 0.12).translate(0, 0.47, 0.18 - k * 0.15).toNonIndexed());
  for (let k = 0; k < 2; k++) wood.push(new THREE.BoxGeometry(1.9, 0.11, 0.035).rotateX(-0.2).translate(0, 0.66 + k * 0.16, -0.2 - k * 0.035).toNonIndexed());
  return { iron: mergeGeometries(iron), wood: mergeGeometries(wood) };
}

/** The radial walks inside the giants' ring (between the tower's apron and the ring's lawns: see city.ts) and the fountains on them. */
export function plazaWalks(plan: WorldPlan): { angles: number[]; from: number; to: number; fountains: { x: number; z: number; r: number }[] } {
  const rr = plan.ring?.r ?? Math.max(60, plan.plaza.r - 120);
  const apron = 58, inner = rr - 20;
  const fr = (apron + inner) / 2;
  const fountains = inner - apron > 30 ? [0, 1, 2, 3].map((k) => { const a = Math.PI / 4 + (k * Math.PI) / 2; return { x: plan.plaza.cx + Math.cos(a) * fr, z: plan.plaza.cz + Math.sin(a) * fr, r: 8.5 * 1.6 }; }) : [];
  return { angles: [0, 1, 2, 3, 4, 5, 6, 7].map((k) => (k * Math.PI) / 4), from: apron + 14, to: inner - 10, fountains };
}

export function buildProps(plan: WorldPlan, shared: Shared, tex: { bark: THREE.MeshStandardMaterialParameters }, quality: { trees: boolean; coverage?: boolean }): Props {
  const group = new THREE.Group();
  group.name = "props";
  const disposables: { dispose(): void }[] = [];
  const leafMats: THREE.MeshStandardMaterial[] = [];
  const walks = plazaWalks(plan);
  /** Points along both sides of the plaza's radial walks, every `every` metres (starting `phase` in), clear of the fountains. */
  const alongWalks = (every: number, phase: number, side: number) => {
    const pts: { x: number; z: number; t: number; s: number }[] = [];
    if (!plan.ring) return pts;
    for (const a of walks.angles) {
      for (let d = walks.from + phase; d < walks.to; d += every) {
        for (const s of [-1, 1]) {
          // Just inside the walk, along the lawns' edge (the walks widen outwards like the lawns between them).
          const t = a + s * Math.min(0.17, side / d);
          const x = plan.plaza.cx + Math.cos(t) * d, z = plan.plaza.cz + Math.sin(t) * d;
          if (walks.fountains.some((f) => Math.hypot(f.x - x, f.z - z) < f.r + 4)) continue;
          pts.push({ x, z, t, s });
        }
      }
    }
    return pts;
  };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const r = rng(424242);
  const { x0 } = plan;
  /** Where the boulevard's furniture stops on a line |z|, short of the plaza. */
  const endAt = (z: number) => boulevardEnd(plan, z) - 6;
  const C = { x: plan.plaza.cx, z: plan.plaza.cz };
  /** Clear of the ways out of the plaza (the boulevard's mouth and the avenues), at radius rr. */
  const offWays = (a: number, rr: number, half: number) => {
    for (const av of plan.avenues.slice(1)) if (Math.abs(wrap(a - av)) < Math.asin(Math.min(1, half / rr))) return false;
    const z = C.z + Math.sin(a) * rr, x = C.x + Math.cos(a) * rr;
    return !(Math.abs(z) < STREET.facade + 6 && x < C.x);
  };
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], colors?: THREE.Color[], cast = true) => {
    if (!mats.length) return;
    const mesh = new THREE.InstancedMesh(geo, mat, mats.length);
    mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    if (colors) colors.forEach((c, i) => mesh.setColorAt(i, c));
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    disposables.push(geo, mat);
  };
  const place = (x: number, y: number, z: number, yaw: number, sc = 1, sy = sc) => m4.compose(p.set(x, y, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), s.set(sc, sy, sc)).clone();

  // ---- Plane trees along both edges of the promenade (and round the plaza's lawns).
  if (quality.trees) {
    const trunkMats: THREE.Matrix4[] = [];
    const canopy: THREE.Matrix4[][] = [[], [], []];
    const leafCols: THREE.Color[][] = [[], [], []];
    const tree = (x: number, z: number) => {
      const sc = 0.78 + r() * 0.28;
      const yaw = r() * Math.PI * 2;
      trunkMats.push(place(x, 0, z, yaw, sc));
      const v = Math.floor(r() * 3);
      canopy[v].push(place(x, 0, z, yaw, sc, sc * (0.9 + r() * 0.2)));
      leafCols[v].push(new THREE.Color().setHSL(0.23 + r() * 0.05, 0.35 + r() * 0.2, 0.62 + r() * 0.12));
    };
    for (const side of [1, -1]) for (let x = x0 + 4; x < endAt(side * STREET.trees); x += 10.5) tree(x + (r() - 0.5) * 0.6, side * STREET.trees);
    // A ring of trees round the plaza's edge, leaving the ways out open.
    const ringR = plan.plaza.r - 9;
    const count = Math.round((Math.PI * 2 * ringR) / 12);
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2;
      if (offWays(a, ringR, 30)) tree(C.x + Math.cos(a) * ringR, C.z + Math.sin(a) * ringR);
    }
    // Rows of trees down the four avenues.
    for (const a of plan.avenues.slice(1)) {
      const c = Math.cos(a), sn = Math.sin(a);
      for (let d = plan.plaza.r + 40; d < plan.plaza.r + 700; d += 13) {
        for (const off of [-14, 14]) tree(C.x + c * d - sn * off, C.z + sn * d + c * off);
      }
    }
    // Allées of plane trees along the plaza's radial walks, from the tower's apron out towards the giants' ring (behind them, seen from the camera).
    for (const p of alongWalks(13, 4, 10)) tree(p.x, p.z);
    const bark = new THREE.MeshStandardMaterial({ ...tex.bark, color: "#a49a8c" });
    cutaway(bark, shared);
    add(trunkGeometry(), bark, trunkMats);
    // Every crown's solid core of foliage (one draw for all of them).
    const coreTex = coreTexture();
    disposables.push(coreTex);
    const core = new THREE.MeshStandardMaterial({ color: "#ffffff", map: coreTex, roughness: 0.9, metalness: 0 });
    cutaway(core, shared);
    add(canopyCore(7), core, canopy.flat(), leafCols.flat().map((c) => c.clone().multiplyScalar(0.92)));
    const leafTex = leafTexture();
    disposables.push(leafTex);
    for (let v = 0; v < 3; v++) {
      const leaves = new THREE.MeshStandardMaterial({ color: "#ffffff", map: leafTex, alphaTest: 0.5, alphaToCoverage: quality.coverage ?? true, side: THREE.DoubleSide, roughness: 0.8, metalness: 0 });
      cutaway(leaves, shared);
      leafMats.push(leaves);
      const before = group.children.length;
      add(canopyGeometry(17 + v * 31), leaves, canopy[v], leafCols[v]);
      const mesh = group.children[before] as THREE.InstancedMesh | undefined;
      if (mesh) mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafTex, alphaTest: 0.5 });
    }
  }

  // ---- Lantern posts: on both pavements, along the promenade, round the plaza's edge and round the giants' ring (behind them).
  {
    const mats: THREE.Matrix4[] = [];
    for (const side of [1, -1]) {
      for (let x = x0 + 10; x < endAt(side * STREET.roadOut); x += 26) mats.push(place(x, 0.12, side * (STREET.roadOut + 0.7), 0));
      // Along the lawn only on the far side: on the camera's side they would stand right in front of the lens.
      if (side > 0) for (let x = x0 + 23; x < (plan.ring ? plan.ring.s0 : endAt(STREET.promenade)) - 4; x += 26) mats.push(place(x, 0, side * (STREET.promenade - 0.5), 0));
    }
    const edgeR = plan.plaza.r - 3;
    const edgeN = Math.round((Math.PI * 2 * edgeR) / 24);
    for (let k = 0; k < edgeN; k++) {
      const a = (k / edgeN) * Math.PI * 2;
      if (offWays(a, edgeR, 24)) mats.push(place(C.x + Math.cos(a) * edgeR, 0, C.z + Math.sin(a) * edgeR, 0));
    }
    if (plan.ring) {
      // On the ring promenade's inner edge: Prism Tower's side of the giants, never between them and the camera.
      const ir = plan.ring.r - 19;
      const n = Math.round((Math.PI * 2 * ir) / 22);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        mats.push(place(C.x + Math.cos(a) * ir, 0, C.z + Math.sin(a) * ir, 0, 1.25));
      }
      // Down the radial walks to the tower, between the allées' trees.
      for (const p of alongWalks(26, 10.5, 6.5)) mats.push(place(p.x, 0, p.z, 0, 1.1));
    }
    // Round the plaza's ring road, on the buildings' side.
    {
      const lr = plan.plaza.r + 9.4;
      const n = Math.round((Math.PI * 2 * lr) / 27);
      for (let k = 0; k < n; k++) {
        const a = ((k + 0.5) / n) * Math.PI * 2;
        if (offWays(a, lr, 26)) mats.push(place(C.x + Math.cos(a) * lr, 0.12, C.z + Math.sin(a) * lr, 0));
      }
    }
    const { iron, glass } = lanternGeometry();
    const ironM = new THREE.MeshStandardMaterial({ color: "#1f2a26", roughness: 0.45, metalness: 0.7 });
    const glassM = new THREE.MeshStandardMaterial({ color: "#fff4d8", emissive: "#ffc56a", emissiveIntensity: 0.9, roughness: 0.15, metalness: 0.1 });
    cutaway(ironM, shared);
    cutaway(glassM, shared);
    add(iron, ironM, mats);
    add(glass, glassM, mats, undefined, false);
    // Banners in the district's colour on the far pavement's lamp posts (the backdrop behind the line), and round the plaza.
    const bannerMats: THREE.Matrix4[] = [];
    for (let x = x0 + 10; x < endAt(STREET.roadOut); x += 52) bannerMats.push(place(x + 0.42, 3.1, STREET.roadOut + 0.75, Math.PI));
    const btex = bannerTexture(boulevardDistricts(plan).far.color);
    disposables.push(btex);
    const bmat = new THREE.MeshStandardMaterial({ map: btex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 });
    cutaway(bmat, shared);
    add(new THREE.PlaneGeometry(0.62, 1.55).translate(0, 0.78, 0), bmat, bannerMats);
  }

  // ---- Morris columns on the pavements.
  {
    const mats: THREE.Matrix4[] = [];
    for (const side of [1, -1]) for (let x = x0 + 60; x < endAt(side * STREET.roadOut) - 14; x += 150 + r() * 60) mats.push(place(x, 0.12, side * (STREET.roadOut + 4.6), r() * 6));
    const { body, band } = morrisGeometry();
    const green = new THREE.MeshStandardMaterial({ color: "#2c4a37", roughness: 0.5, metalness: 0.35 });
    const poster = new THREE.MeshStandardMaterial({ color: "#efe3c4", roughness: 0.9 });
    cutaway(green, shared);
    cutaway(poster, shared);
    add(body, green, mats);
    add(band, poster, mats);
  }

  // ---- Benches: down the plaza's radial walks between the trees (facing the walk), and round the plaza's edge facing the tower.
  {
    const mats: THREE.Matrix4[] = [];
    for (const p of alongWalks(26, 17, 8.4)) {
      // Facing the walk's middle: across it, towards the other row.
      const fx = p.s * Math.sin(p.t), fz = -p.s * Math.cos(p.t);
      mats.push(place(p.x, 0, p.z, Math.atan2(fx, fz)));
    }
    const er = plan.plaza.r - 6.5;
    const en = Math.round((Math.PI * 2 * er) / 24);
    for (let k = 0; k < en; k++) {
      const a = ((k + 0.5) / en) * Math.PI * 2;
      if (offWays(a, er, 26)) mats.push(place(C.x + Math.cos(a) * er, 0, C.z + Math.sin(a) * er, Math.atan2(-Math.cos(a), -Math.sin(a))));
    }
    const b = benchGeometry();
    const ironB = new THREE.MeshStandardMaterial({ color: "#1d2a24", roughness: 0.5, metalness: 0.6 });
    const slats = new THREE.MeshStandardMaterial({ color: "#2f5a3e", roughness: 0.6, metalness: 0.05 });
    cutaway(ironB, shared);
    cutaway(slats, shared);
    add(b.iron, ironB, mats);
    add(b.wood, slats, mats);
  }

  // ---- Café terraces on the far pavement (behind the line, under the plane trees): tables for two and parasols in the district's colour.
  {
    const tables: THREE.Matrix4[] = [], umbrellas: THREE.Matrix4[] = [];
    const z0 = STREET.trees + 2.6;
    for (let x = x0 + 14; x < endAt(z0) - 8; x += 17 + r() * 12) {
      if (r() < 0.25) continue;
      const n = 2 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        const tx = x + k * 2.3 + (r() - 0.5) * 0.4, tz = z0 + (k % 2) * 2.1 + (r() - 0.5) * 0.3;
        tables.push(place(tx, 0.12, tz, r() * 0.6 - 0.3));
        if (k % 2 === 0) umbrellas.push(place(tx + 0.2, 0.12, tz + 0.9, r() * Math.PI));
      }
    }
    const t = terraceGeometry();
    const ironT = new THREE.MeshStandardMaterial({ color: "#20221f", roughness: 0.5, metalness: 0.6 });
    const marble = new THREE.MeshStandardMaterial({ color: "#f1ece2", roughness: 0.35 });
    const rattan = new THREE.MeshStandardMaterial({ color: "#a7743f", roughness: 0.7 });
    for (const m of [ironT, marble, rattan]) cutaway(m, shared);
    add(t.iron, ironT, tables);
    add(t.top, marble, tables);
    add(t.seats, rattan, tables);
    const pg = parasolGeometry();
    const colour = new THREE.Color(boulevardDistricts(plan).far.color);
    const cloth = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.8, side: THREE.DoubleSide });
    const poleM = new THREE.MeshStandardMaterial({ color: "#d9d4c7", roughness: 0.6 });
    for (const m of [cloth, poleM]) cutaway(m, shared);
    // Every other parasol in cream, the rest in the district's colour.
    const cols = umbrellas.map((_, i) => (i % 3 === 1 ? new THREE.Color("#f2ead8") : colour.clone().offsetHSL(0, 0, (r() - 0.5) * 0.06)));
    add(pg.pole, poleM, umbrellas);
    add(pg.canopy, cloth, umbrellas, cols);
  }

  // ---- Cars: parked along the kerbs, some driving; a few buses.
  {
    const car = carGeometry();
    const bus = busGeometry();
    const carMats: THREE.Matrix4[] = [], carCols: THREE.Color[] = [];
    const busMats: THREE.Matrix4[] = [], busCols: THREE.Color[] = [];
    for (const side of [1, -1]) {
      for (const lane of [STREET.roadIn + 1.25, STREET.roadOut - 1.25]) {
        // The camera's side keeps its inner kerb clear: parked cars there would sit right in front of the lens.
        if (side < 0 && lane === STREET.roadIn + 1.25) continue;
        for (let x = x0 + 5; x < endAt(side * lane) - 4; x += 5.6 + r() * 1.4) {
          if (r() < 0.32) continue;
          carMats.push(place(x, 0, side * lane, side > 0 ? 0 : Math.PI, 1));
          carCols.push(CAR_COLOURS[Math.floor(r() * CAR_COLOURS.length)]);
        }
      }
      // Traffic: spaced out in the inner lanes, heading the side's way.
      for (let x = x0 + 30; x < endAt(side * STREET.roadIn) - 26; x += 38 + r() * 70) {
        const lane = side * (STREET.roadIn + 4 + r() * 3.5);
        if (r() < 0.12) {
          busMats.push(place(x, 0, lane, side > 0 ? 0 : Math.PI));
          busCols.push(new THREE.Color(r() < 0.5 ? "#2f6b4f" : "#2b4f7c"));
        } else {
          carMats.push(place(x, 0, lane, side > 0 ? 0 : Math.PI, 1));
          carCols.push(CAR_COLOURS[Math.floor(r() * CAR_COLOURS.length)]);
        }
      }
    }
    // The plaza's ring road, the city's great roundabout: traffic going round it (anticlockwise seen from above), clear of the junctions.
    for (const lr of [plan.plaza.r + 1.8, plan.plaza.r + 5.6]) {
      const n = Math.floor((Math.PI * 2 * lr) / 7.5);
      for (let k = 0; k < n; k++) {
        if (r() < 0.58) continue;
        const a = (k / n) * Math.PI * 2 + (r() - 0.5) * 0.002;
        if (!offWays(a, lr, 24)) continue;
        // Facing along the road, anticlockwise from above (the car's length is its local x, turned to (sin a, -cos a)).
        const yaw = Math.atan2(Math.cos(a), Math.sin(a));
        const x = C.x + Math.cos(a) * lr, z = C.z + Math.sin(a) * lr;
        if (r() < 0.07) {
          busMats.push(place(x, 0, z, yaw));
          busCols.push(new THREE.Color(r() < 0.5 ? "#2f6b4f" : "#2b4f7c"));
        } else {
          carMats.push(place(x, 0, z, yaw, 1));
          carCols.push(CAR_COLOURS[Math.floor(r() * CAR_COLOURS.length)]);
        }
      }
    }
    const paint = new THREE.MeshPhysicalMaterial({ color: "#ffffff", roughness: 0.32, metalness: 0.45, clearcoat: 0.8, clearcoatRoughness: 0.12 });
    const glass = new THREE.MeshStandardMaterial({ color: "#1a2129", roughness: 0.08, metalness: 0.6 });
    const tyre = new THREE.MeshStandardMaterial({ color: "#151515", roughness: 0.9 });
    for (const m of [paint, glass, tyre]) cutaway(m, shared);
    add(car.body, paint, carMats, carCols);
    add(car.glass, glass, carMats);
    add(car.wheels, tyre, carMats);
    const busPaint = paint.clone();
    cutaway(busPaint, shared);
    add(bus.body, busPaint, busMats, busCols);
    add(bus.glass, glass.clone(), busMats);
    add(bus.wheels, tyre.clone(), busMats);
  }

  return {
    group,
    setCoverage(on) {
      for (const m of leafMats) {
        if (m.alphaToCoverage === on) continue;
        m.alphaToCoverage = on;
        m.needsUpdate = true;
      }
    },
    dispose() { for (const d of disposables) d.dispose(); },
  };
}
