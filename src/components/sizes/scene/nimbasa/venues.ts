import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { STREET, type WorldPlan } from "@/lib/sizes/world";
import { rng } from "../geo";
import { cutaway, type Shared } from "../shaders";
import type { CityQuality, CityTex } from "../kit";
import type { KeepOut } from "./city";
import { NEON } from "./facade";

/**
 * Nimbasa's venues, our own designs in the spirit of the city's: Gear
 * Station on the promenade, a grand hall with a great turning gear over its
 * doors, its rail lines leaving on viaducts over the rooftops with lit
 * trains running; the Big Stadium, an oval bowl under floodlight masts; the
 * Small Court, an arena under a curved roof; the Musical Theater, columns,
 * a marquee of bulbs and a gilded dome; and the amusement park behind the
 * Ferris wheel, its roller coaster circling the Electric-type gym with a
 * train racing round, a carousel, a drop tower and striped tents. Where
 * each stands is worked out from the plan (venueSites), so the city keeps
 * clear of them and none stands where the camera goes.
 */

export interface Sites {
  station: { x0: number; x1: number } | null;
  stadium: { x: number; z: number; r: number };
  court: { x: number; z: number; r: number };
  theater: { x: number; z: number; r: number };
  park: { x: number; z: number; r: number };
  /** The rail lines (points with heights), each from inside the station out. */
  rails: THREE.Vector3[][];
  keep: KeepOut;
}

const polar = (C: { x: number; z: number }, a: number, d: number) => ({ x: C.x + Math.cos(a) * d, z: C.z + Math.sin(a) * d });
const deg = (d: number) => (d * Math.PI) / 180;

/** Where everything stands for a plan. */
export function venueSites(plan: WorldPlan): Sites {
  const C = { x: plan.plaza.cx, z: plan.plaza.cz };
  const R = plan.plaza.r;
  const stadium = { ...polar(C, deg(150), R + 205), r: 118 };
  const court = { ...polar(C, deg(84), R + 150), r: 48 };
  const theater = { ...polar(C, deg(46), R + 105), r: 40 };
  const park = { ...polar(C, deg(104), R + 330), r: 175 };
  // Gear Station on the far side of the promenade, short of the plaza, when the promenade is long enough.
  const xEnd = plan.x1 - 20;
  let station: Sites["station"] = null;
  if (xEnd - plan.x0 > 330) {
    const x1 = Math.max(plan.x0 + 150, xEnd - 150);
    station = { x0: x1 - 116, x1 };
  }
  const rails: THREE.Vector3[][] = [];
  const keep: KeepOut = { circles: [stadium, court, theater, park].map((v) => ({ x: v.x, z: v.z, r: v.r })), segments: [] };
  if (station) {
    const zA = STREET.facade + 34, zB = STREET.facade + 24;
    const sx = station.x0;
    // West, behind the far street wall, rising out of the station onto the viaduct over the rooftops.
    rails.push([new THREE.Vector3(station.x1 - 10, 9, zA), new THREE.Vector3(sx - 10, 12, zA), new THREE.Vector3(sx - 170, 29, zA), new THREE.Vector3(Math.min(plan.x0, sx - 400) - 600, 29, zA)]);
    // North, swinging away over the city.
    const pts = [new THREE.Vector3(station.x1 - 10, 9, zB), new THREE.Vector3(sx - 10, 12, zB), new THREE.Vector3(sx - 120, 22, zB + 4)];
    for (let k = 1; k <= 8; k++) {
      const a = (k / 8) * (Math.PI / 2);
      pts.push(new THREE.Vector3(sx - 120 - Math.sin(a) * 110, 22 + 7 * Math.min(1, k / 4), zB + 4 + (1 - Math.cos(a)) * 110));
    }
    pts.push(new THREE.Vector3(sx - 230, 29, zB + 1800));
    rails.push(pts);
    keep.circles.push({ x: (station.x0 + station.x1) / 2, z: STREET.facade + 32, r: 70 });
    for (const line of rails) for (let i = 0; i < line.length - 1; i++) keep.segments.push({ ax: line[i].x, az: line[i].z, bx: line[i + 1].x, bz: line[i + 1].z, r: 22 });
  }
  return { station, stadium, court, theater, park, rails, keep };
}

/** Keeps position, normal and uv only (so differently made geometries merge). */
const bare = (g: THREE.BufferGeometry) => {
  const q = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(q.attributes)) if (k !== "position" && k !== "normal" && k !== "uv") q.deleteAttribute(k);
  if (!q.attributes.uv) q.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2));
  return q;
};

/** A box from a to b (centre line), w wide and h high, its top at a.y / b.y. */
function beam(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(w, h, len).translate(0, -h / 2, len / 2);
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), b.clone().sub(a), new THREE.Vector3(0, 1, 0));
  // lookAt points -z at the target: turn the box (built along +z) round.
  g.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI));
  g.applyMatrix4(m);
  g.translate(a.x, a.y, a.z);
  return bare(g);
}

/** Stripes for tents and canopies. */
function stripeTexture(a: string, b: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 8;
  const g = c.getContext("2d")!;
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? a : b; g.fillRect(i * 8, 0, 8, 8); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A building's skin with bands of light (concourses, glass floors): pale panels and glowing strips. */
function bandTexture(): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const mk = () => { const c = document.createElement("canvas"); c.width = 64; c.height = 128; return { c, g: c.getContext("2d")! }; };
  const col = mk(), emi = mk();
  col.g.fillStyle = "#e9ebf3";
  col.g.fillRect(0, 0, 64, 128);
  emi.g.fillStyle = "#000";
  emi.g.fillRect(0, 0, 64, 128);
  for (const [y, h] of [[18, 10], [62, 12], [104, 8]]) {
    col.g.fillStyle = "#ffe6b8";
    col.g.fillRect(0, y, 64, h);
    emi.g.fillStyle = "#ffd59a";
    emi.g.fillRect(0, y, 64, h);
  }
  for (let x = 0; x < 64; x += 16) { col.g.fillStyle = "rgba(60,64,90,0.35)"; col.g.fillRect(x, 0, 2, 128); }
  const t = (c: HTMLCanvasElement) => { const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.wrapS = tx.wrapT = THREE.RepeatWrapping; return tx; };
  return { map: t(col.c), emissive: t(emi.c) };
}

export interface Venues {
  group: THREE.Group;
  tick(t: number): void;
  dispose(): void;
}

export function buildVenues(plan: WorldPlan, sites: Sites, shared: Shared, tex: CityTex, quality: CityQuality): Venues {
  const group = new THREE.Group();
  group.name = "nimbasa-venues";
  const own: { dispose(): void }[] = [];
  const ticks: ((t: number) => void)[] = [];
  const C = { x: plan.plaza.cx, z: plan.plaza.cz };
  const add = (g: THREE.BufferGeometry, m: THREE.Material, cast = true, parent: THREE.Object3D = group) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    parent.add(mesh);
    own.push(g);
    return mesh;
  };
  const glow = (color: string, k = 2.6) => { const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: true }); own.push(m); return m; };
  const std = (p: THREE.MeshStandardMaterialParameters) => { const m = new THREE.MeshStandardMaterial(p); cutaway(m, shared); own.push(m); return m; };
  const white = std({ color: "#eceef5", roughness: 0.55, metalness: 0.1 });
  const steel = std({ color: "#9aa0b4", roughness: 0.4, metalness: 0.6 });
  const darkSteel = std({ color: "#3a3e50", roughness: 0.5, metalness: 0.5 });
  const bands = bandTexture();
  own.push(bands.map, bands.emissive);
  const banded = std({ map: bands.map, emissiveMap: bands.emissive, emissive: "#ffffff", emissiveIntensity: 1.3, roughness: 0.6 });
  const stone = std({ ...tex.pbr("sandstone_blocks_08", 3, { color: "#efe4dc" }) });
  const glassLit = std({ color: "#3a3550", roughness: 0.08, metalness: 0.4, emissive: "#ffcf90", emissiveIntensity: 1.25 });
  const bulbGeo = new THREE.SphereGeometry(0.4, 6, 4);
  own.push(bulbGeo);
  const bulbs = (pts: THREE.Vector3[], color: string, k = 3, size = 1) => {
    if (!pts.length) return;
    const im = new THREE.InstancedMesh(bulbGeo, glow(color, k), pts.length);
    pts.forEach((p, i) => im.setMatrixAt(i, new THREE.Matrix4().compose(p, new THREE.Quaternion(), new THREE.Vector3(size, size, size))));
    im.computeBoundingSphere();
    group.add(im);
  };
  const ground = (x: number, z: number, r: number, color: string) => {
    const m = std({ ...tex.pbr("large_grey_tiles", 3, { color }) });
    const g = new THREE.CircleGeometry(r, 64).rotateX(-Math.PI / 2).translate(x, 0.02, z);
    const uv = g.attributes.uv as THREE.BufferAttribute, pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 3, -pos.getZ(i) / 3);
    add(g, m, false);
  };
  const detail = quality.blocks;

  // ---- Gear Station.
  if (sites.station) {
    const { x0, x1 } = sites.station;
    const zf = STREET.facade, depth = 62, H = 20;
    const xm = (x0 + x1) / 2, len = x1 - x0;
    const parts: THREE.BufferGeometry[] = [];
    // The hall's walls (stone) and a cornice.
    parts.push(bare(new THREE.BoxGeometry(len, H, 1.6).translate(xm, H / 2, zf + depth - 0.8)));
    for (const sx of [x0, x1]) parts.push(bare(new THREE.BoxGeometry(1.6, H, depth).translate(sx + (sx === x0 ? 0.8 : -0.8), H / 2, zf + depth / 2)));
    // The front: piers between three great arched windows.
    const arches = [{ c: xm - 34, w: 22 }, { c: xm, w: 30 }, { c: xm + 34, w: 22 }];
    let at = x0;
    for (const a of arches) {
      parts.push(bare(new THREE.BoxGeometry(a.c - a.w / 2 - at, H, 3).translate((at + a.c - a.w / 2) / 2, H / 2, zf + 1.5)));
      at = a.c + a.w / 2;
    }
    parts.push(bare(new THREE.BoxGeometry(x1 - at, H, 3).translate((at + x1) / 2, H / 2, zf + 1.5)));
    for (const a of arches) {
      // Over each window, the wall closes down to a round arch.
      const shape = new THREE.Shape();
      shape.moveTo(-a.w / 2, 0);
      shape.lineTo(a.w / 2, 0);
      shape.lineTo(a.w / 2, -a.w / 2);
      shape.absarc(0, -a.w / 2, a.w / 2, 0, Math.PI, false);
      shape.lineTo(-a.w / 2, 0);
      const g = new THREE.ExtrudeGeometry(shape, { depth: 3, bevelEnabled: false, curveSegments: 16 }).translate(a.c, H, zf);
      parts.push(bare(g));
      const glass = new THREE.Shape();
      glass.moveTo(-a.w / 2, 0);
      glass.lineTo(a.w / 2, 0);
      glass.lineTo(a.w / 2, H - a.w / 2);
      glass.absarc(0, H - a.w / 2, a.w / 2, 0, Math.PI, false);
      glass.lineTo(-a.w / 2, 0);
      add(bare(new THREE.ShapeGeometry(glass, 16).translate(a.c, 0, zf + 2.2)), glassLit, false);
    }
    parts.push(bare(new THREE.BoxGeometry(len + 2, 1.4, 4).translate(xm, H + 0.7, zf + 1.6)));
    add(mergeGeometries(parts), stone);
    // The roof: a glass barrel vault on lit ribs.
    const vault = new THREE.CylinderGeometry(depth / 2 - 1, depth / 2 - 1, len - 4, 24, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 0.42, 1).translate(xm, H, zf + depth / 2);
    add(bare(vault), std({ color: "#5b6a8c", roughness: 0.15, metalness: 0.5, emissive: "#6fb8ff", emissiveIntensity: 0.35, side: THREE.DoubleSide }), false);
    const ribs: THREE.BufferGeometry[] = [];
    for (let x = x0 + 6; x < x1 - 4; x += 10) ribs.push(bare(new THREE.TorusGeometry(depth / 2 - 0.7, 0.32, 4, 24, Math.PI).rotateY(Math.PI / 2).scale(1, 0.42, 1).translate(x, H, zf + depth / 2)));
    add(mergeGeometries(ribs), glow("#bfe6ff", 1.8), false);
    // The gear over the middle door: teeth round a ring, spokes, turning slowly.
    const gear = new THREE.Group();
    gear.position.set(xm, H - 4.5, zf - 0.4);
    group.add(gear);
    const gp: THREE.BufferGeometry[] = [bare(new THREE.TorusGeometry(7.4, 0.9, 6, 40))];
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; gp.push(bare(new THREE.BoxGeometry(2, 1.8, 1.2).translate(0, 8.4, 0).applyMatrix4(new THREE.Matrix4().makeRotationZ(a)))); }
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; gp.push(bare(new THREE.BoxGeometry(0.7, 7, 0.6).translate(0, 3.5, 0).applyMatrix4(new THREE.Matrix4().makeRotationZ(a)))); }
    gp.push(bare(new THREE.CylinderGeometry(1.8, 1.8, 1.2, 20).rotateX(Math.PI / 2)));
    add(mergeGeometries(gp), glow("#7fe8ff", 2.8), false, gear);
    ticks.push((t) => { gear.rotation.z = t * 0.12; });
    // Two corner towers with lit lanterns.
    for (const sx of [x0 + 4, x1 - 4]) {
      add(bare(new THREE.BoxGeometry(8, H + 12, 8).translate(sx, (H + 12) / 2, zf + 4)), stone);
      add(bare(new THREE.BoxGeometry(5.6, 4, 5.6).translate(sx, H + 14, zf + 4)), glow("#ffd27a", 2.2), false);
      add(bare(new THREE.ConeGeometry(4.6, 6, 4).rotateY(Math.PI / 4).translate(sx, H + 19, zf + 4)), darkSteel);
    }
    bulbs(Array.from({ length: Math.floor(len / 2.2) }, (_, i) => new THREE.Vector3(x0 + 1 + i * 2.2, H + 1.6, zf - 0.6)), "#fff0c0", 3.2, 0.8);
  }

  // ---- Rail lines on viaducts, and trains.
  const trains: { cars: THREE.InstancedMesh; wins: THREE.InstancedMesh; curve: THREE.CurvePath<THREE.Vector3>; len: number; n: number; speed: number; offset: number }[] = [];
  if (sites.rails.length) {
    const deck: THREE.BufferGeometry[] = [], railG: THREE.BufferGeometry[] = [], piers: THREE.Matrix4[] = [], lights: THREE.Vector3[] = [];
    for (const line of sites.rails) {
      for (let i = 0; i < line.length - 1; i++) {
        const a = line[i], b = line[i + 1];
        // Inside the station's hall the tracks run on its floor.
        deck.push(beam(a, b, 10, 1.6));
        const dir = b.clone().sub(a).setY(0).normalize();
        const side = new THREE.Vector3(-dir.z, 0, dir.x);
        for (const o of [-2.4, 2.4]) for (const rr of [-0.75, 0.75]) railG.push(beam(a.clone().addScaledVector(side, o + rr).setY(a.y + 0.25), b.clone().addScaledVector(side, o + rr).setY(b.y + 0.25), 0.14, 0.2));
        const len = a.distanceTo(b);
        for (let d = 0; d < len; d += 28) {
          const p = a.clone().lerp(b, d / len);
          if (p.y > 14) piers.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, 0, p.z), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), side), new THREE.Vector3(1, p.y - 1.6, 1)));
          for (const o of [-5, 5]) lights.push(p.clone().addScaledVector(side, o).setY(p.y + 0.3));
        }
      }
    }
    add(mergeGeometries(deck), std({ color: "#b8b4c4", roughness: 0.8 }));
    add(mergeGeometries(railG), steel, false);
    const pierGeo = new THREE.BoxGeometry(2.4, 1, 6).translate(0, 0.5, 0);
    own.push(pierGeo);
    const pierM = new THREE.InstancedMesh(pierGeo, std({ color: "#a9a5b6", roughness: 0.85 }), piers.length);
    piers.forEach((m, i) => pierM.setMatrixAt(i, m));
    pierM.castShadow = pierM.receiveShadow = true;
    pierM.computeBoundingSphere();
    group.add(pierM);
    bulbs(lights.filter((_, i) => i % (detail > 0.7 ? 1 : 2) === 0), "#6fe0ff", 2.6, 0.7);
    // Trains: white cars with a band of lit windows, running out of the station and on into the haze.
    const carGeo = new THREE.BoxGeometry(3.2, 3.6, 17).translate(0, 2.3, 0);
    const winGeo = new THREE.BoxGeometry(3.3, 1.1, 16.2).translate(0, 2.9, 0);
    own.push(carGeo, winGeo);
    const carMat = std({ color: "#f2f4fa", roughness: 0.35, metalness: 0.2 });
    const winMat = glow("#ffe0a8", 2.2);
    sites.rails.forEach((line, li) => {
      const curve = new THREE.CurvePath<THREE.Vector3>();
      for (let i = 0; i < line.length - 1; i++) curve.add(new THREE.LineCurve3(line[i].clone().setY(line[i].y + 0.4), line[i + 1].clone().setY(line[i + 1].y + 0.4)));
      const n = 6;
      for (const offset of [0, 0.5]) {
        const cars = new THREE.InstancedMesh(carGeo, carMat, n), wins = new THREE.InstancedMesh(winGeo, winMat, n);
        cars.castShadow = true;
        cars.frustumCulled = wins.frustumCulled = false;
        group.add(cars, wins);
        trains.push({ cars, wins, curve, len: curve.getLength(), n, speed: 16 + li * 3, offset: offset + li * 0.21 });
      }
    });
  }

  // ---- The Big Stadium: an oval bowl, its tiers lit, the pitch glowing under floodlight masts.
  {
    const s = sites.stadium;
    const ax = 1.28;
    const g = new THREE.Group();
    g.position.set(s.x, 0, s.z);
    g.rotation.y = Math.atan2(C.x - s.x, C.z - s.z);
    group.add(g);
    const r = s.r * 0.78;
    const wall = new THREE.CylinderGeometry(r, r * 1.04, 30, 64, 1, true).translate(0, 15, 0).scale(ax, 1, 1);
    const uv = wall.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 40, uv.getY(i) * 1);
    add(wall, banded, true, g);
    const tiers = new THREE.CylinderGeometry(r - 2, r * 0.52, 26, 64, 1, true).translate(0, 16, 0).scale(ax, 1, 1);
    add(tiers, std({ color: "#5a4f86", roughness: 0.8, side: THREE.BackSide }), false, g);
    add(new THREE.CircleGeometry(r * 0.52, 48).rotateX(-Math.PI / 2).translate(0, 3, 0).scale(ax, 1, 1), std({ color: "#2f7a3e", roughness: 0.9, emissive: "#3fa04f", emissiveIntensity: 0.5 }), false, g);
    // The roof ring over the stands, its rim lit.
    add(new THREE.RingGeometry(r * 0.78, r + 1.5, 64, 1).rotateX(-Math.PI / 2).translate(0, 30.5, 0).scale(ax, 1, 1), std({ color: "#dfe2ee", roughness: 0.5, side: THREE.DoubleSide }), true, g);
    add(new THREE.TorusGeometry(r * 0.78, 0.5, 4, 64).rotateX(Math.PI / 2).translate(0, 30.6, 0).scale(ax, 1, 1), glow(NEON[1], 2.4), false, g);
    add(new THREE.TorusGeometry(r + 1.5, 0.5, 4, 64).rotateX(Math.PI / 2).translate(0, 30.6, 0).scale(ax, 1, 1), glow(NEON[0], 2.4), false, g);
    // Floodlight masts.
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
      const px = Math.cos(a) * (r + 8) * ax, pz = Math.sin(a) * (r + 8);
      add(bare(new THREE.CylinderGeometry(0.8, 1.4, 58, 8).translate(px, 29, pz)), steel, true, g);
      add(bare(new THREE.BoxGeometry(9, 5, 1.2).lookAt(new THREE.Vector3(-px, 0, -pz)).translate(px, 59, pz)), glow("#f4f8ff", 4), false, g);
      pts.push(new THREE.Vector3(px, 62, pz));
    }
    void pts;
    ground(s.x, s.z, s.r, "#8d86a2");
  }

  // ---- The Small Court: an arena under a curved roof, its glass sides lit, two masts.
  {
    const s = sites.court;
    const g = new THREE.Group();
    g.position.set(s.x, 0, s.z);
    g.rotation.y = Math.atan2(C.x - s.x, C.z - s.z);
    group.add(g);
    const W = 64, Dp = 44, H = 13;
    add(bare(new THREE.BoxGeometry(W, H, Dp).translate(0, H / 2, 0)), banded, true, g);
    add(bare(new THREE.BoxGeometry(W - 6, H - 4, 0.4).translate(0, (H - 4) / 2 + 1, Dp / 2 + 0.3)), glassLit, false, g);
    // A shallow arc over the arena (a slice of a wide cylinder along its length).
    const rr = (Dp / 2 + 2) / Math.sin(0.5);
    const roof = new THREE.CylinderGeometry(rr, rr, W + 2, 24, 1, true, Math.PI / 2 - 0.5, 1).rotateZ(Math.PI / 2).translate(0, H - rr * Math.cos(0.5) + 0.3, 0);
    add(bare(roof), std({ color: "#c9cde0", roughness: 0.4, metalness: 0.4, side: THREE.DoubleSide }), true, g);
    add(bare(new THREE.BoxGeometry(W + 1, 0.5, 0.5).translate(0, H + 0.4, Dp / 2)), glow(NEON[2], 2.6), false, g);
    add(bare(new THREE.BoxGeometry(W + 1, 0.5, 0.5).translate(0, H + 0.4, -Dp / 2)), glow(NEON[2], 2.6), false, g);
    for (const sx of [-1, 1]) {
      add(bare(new THREE.CylinderGeometry(0.6, 1, 34, 8).translate(sx * (W / 2 + 6), 17, 0)), steel, true, g);
      add(bare(new THREE.BoxGeometry(1, 3.5, 6).translate(sx * (W / 2 + 6), 34, 0)), glow("#f4f8ff", 3.6), false, g);
    }
    ground(s.x, s.z, s.r, "#9a94ae");
  }

  // ---- The Musical Theater: a colonnaded front under a marquee of bulbs, a star in the pediment, a gilded dome.
  {
    const s = sites.theater;
    const g = new THREE.Group();
    g.position.set(s.x, 0, s.z);
    g.rotation.y = Math.atan2(C.x - s.x, C.z - s.z);
    group.add(g);
    const W = 54, Dp = 40, H = 17;
    const cream = std({ color: "#f6ead8", roughness: 0.7 });
    add(bare(new THREE.BoxGeometry(W, H, Dp).translate(0, H / 2, -Dp / 2)), cream, true, g);
    // Columns and the pediment.
    const cols: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 8; k++) cols.push(bare(new THREE.CylinderGeometry(0.9, 1, H - 2, 12).translate(-W / 2 + 5 + k * ((W - 10) / 7), (H - 2) / 2, 5)));
    cols.push(bare(new THREE.BoxGeometry(W - 4, 2, 8).translate(0, H - 1, 3)));
    const ped = new THREE.Shape();
    ped.moveTo(-W / 2 + 2, 0);
    ped.lineTo(W / 2 - 2, 0);
    ped.lineTo(0, 8);
    ped.lineTo(-W / 2 + 2, 0);
    cols.push(bare(new THREE.ExtrudeGeometry(ped, { depth: 8, bevelEnabled: false }).translate(0, H, -1)));
    add(mergeGeometries(cols), cream, true, g);
    // Glowing doors behind the columns, the marquee canopy with bulbs, a star.
    add(bare(new THREE.PlaneGeometry(W - 8, H - 6).translate(0, (H - 6) / 2, 0.1)), glassLit, false, g);
    add(bare(new THREE.BoxGeometry(W - 14, 0.8, 7).translate(0, 6.2, 8)), std({ color: "#3a1f4a", roughness: 0.5 }), true, g);
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 40; k++) for (const [y, z] of [[6.8, 11.6], [5.8, 11.6]]) pts.push(new THREE.Vector3(-W / 2 + 7 + k * ((W - 14) / 40), y, z));
    const star = new THREE.Shape();
    for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI * 2 + Math.PI / 2, rr = i % 2 ? 1.6 : 3.6; if (i) star.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else star.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    add(bare(new THREE.ShapeGeometry(star).translate(0, H + 3.6, 7.1)), glow(NEON[2], 3.2), false, g);
    // The dome, gilded, with a lit lantern.
    add(bare(new THREE.CylinderGeometry(11, 11, 3, 32).translate(0, H + 1.5, -Dp / 2)), cream, true, g);
    add(bare(new THREE.SphereGeometry(10.5, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, H + 3, -Dp / 2)), std({ color: "#d9a93c", roughness: 0.3, metalness: 0.85 }), true, g);
    add(bare(new THREE.CylinderGeometry(1.6, 1.6, 3, 12).translate(0, H + 14.5, -Dp / 2)), glow("#ffd890", 2.6), false, g);
    // Bulbs along the cornice and round the dome's drum.
    for (let k = 0; k < 30; k++) pts.push(new THREE.Vector3(-W / 2 + 1 + k * (W - 2) / 29, H + 0.4, 0.6));
    for (let k = 0; k < 36; k++) { const a = (k / 36) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * 11.3, H + 3.1, -Dp / 2 + Math.sin(a) * 11.3)); }
    const im = new THREE.InstancedMesh(bulbGeo, glow("#fff0c0", 3.4), pts.length);
    pts.forEach((p, i) => im.setMatrixAt(i, new THREE.Matrix4().compose(p, new THREE.Quaternion(), new THREE.Vector3(0.7, 0.7, 0.7))));
    im.computeBoundingSphere();
    g.add(im);
    ground(s.x, s.z, s.r + 8, "#b8a8b4");
  }

  // ---- The amusement park: the roller coaster round the Electric-type gym, a carousel, a drop tower, tents.
  {
    const s = sites.park;
    const g = new THREE.Group();
    g.position.set(s.x, 0, s.z);
    // Its front (local +z) faces the wheel.
    g.rotation.y = Math.atan2(C.x - s.x, C.z - s.z);
    group.add(g);
    ground(s.x, s.z, s.r, "#a58fb0");
    const r = rng(2024);
    // The coaster: a closed course of climbs and drops round the park, with a loop.
    const ctrl: THREE.Vector3[] = [];
    const n = 22;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rx = s.r * 0.78, rz = s.r * 0.58;
      const wob = 1 + 0.12 * Math.sin(a * 3);
      const h = i === 2 ? 44 : i === 3 ? 38 : i === 4 ? 8 : 10 + 16 * (0.5 + 0.5 * Math.sin(a * 2 + 1)) + (i % 2) * 6;
      ctrl.push(new THREE.Vector3(Math.cos(a) * rx * wob, h, Math.sin(a) * rz * wob));
    }
    // A vertical loop after the big drop (points round a circle in the course's direction, stepping sideways).
    const i0 = 5;
    const pa = ctrl[i0 - 1], pb = ctrl[i0];
    const dir = pb.clone().sub(pa).setY(0).normalize(), side = new THREE.Vector3(-dir.z, 0, dir.x);
    const loop: THREE.Vector3[] = [];
    const LR = 11;
    for (let k = 1; k < 10; k++) {
      const t = (k / 10) * Math.PI * 2;
      loop.push(pb.clone().setY(0).addScaledVector(dir, Math.sin(t) * LR).addScaledVector(side, (k / 10) * 5).setY(4 + LR - Math.cos(t) * LR));
    }
    const course = [...ctrl.slice(0, i0), new THREE.Vector3(pb.x, 4, pb.z), ...loop, ...ctrl.slice(i0).map((p) => p.clone().addScaledVector(side, 5 * Math.max(0, 1 - ctrl.indexOf(p) / (i0 + 4))))];
    const curve = new THREE.CatmullRomCurve3(course, true, "centripetal", 0.5);
    const segs = Math.round(240 * Math.max(0.6, detail));
    add(new THREE.TubeGeometry(curve, segs, 0.75, 6, true), std({ color: "#ff4f9a", roughness: 0.4, metalness: 0.3 }), true, g);
    add(new THREE.TubeGeometry(curve, segs, 0.16, 4, true).translate(0, 0.85, 0), glow(NEON[2], 2.6), false, g);
    // Supports from the ground.
    const sup: THREE.Matrix4[] = [];
    const L = curve.getLength();
    for (let d = 0; d < L; d += 9) {
      const p = curve.getPointAt(d / L);
      if (p.y < 3) continue;
      sup.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, 0, p.z), new THREE.Quaternion(), new THREE.Vector3(1, p.y - 0.6, 1)));
    }
    const supGeo = new THREE.CylinderGeometry(0.28, 0.38, 1, 6).translate(0, 0.5, 0);
    own.push(supGeo);
    const supM = new THREE.InstancedMesh(supGeo, steel, sup.length);
    sup.forEach((m, i) => supM.setMatrixAt(i, m));
    supM.castShadow = true;
    supM.computeBoundingSphere();
    g.add(supM);
    // Its train: yellow cars racing round, faster at the bottom.
    const carGeo = new THREE.BoxGeometry(1.9, 1.3, 3).translate(0, 1.2, 0);
    own.push(carGeo);
    const cars = new THREE.InstancedMesh(carGeo, std({ color: "#ffd23a", roughness: 0.35, metalness: 0.3, emissive: "#ffb000", emissiveIntensity: 0.3 }), 6);
    cars.frustumCulled = false;
    cars.castShadow = true;
    g.add(cars);
    const top = Math.max(...course.map((p) => p.y));
    let along = 0, lastT = 0;
    const m4 = new THREE.Matrix4(), look = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3();
    ticks.push((t) => {
      // Scene time (a video steps it frame by frame): faster at the bottom of each drop.
      const dt = Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      const p = curve.getPointAt(along);
      const v = Math.sqrt(36 + 2 * 9.8 * Math.max(0, top - p.y));
      along = (along + (v * dt) / L) % 1;
      for (let k = 0; k < 6; k++) {
        const u = (along - (k * 3.3) / L + 1) % 1;
        curve.getPointAt(u, pos);
        curve.getTangentAt(u, look);
        m4.lookAt(new THREE.Vector3(), look.negate(), up);
        m4.setPosition(pos);
        cars.setMatrixAt(k, m4);
      }
      cars.instanceMatrix.needsUpdate = true;
    });
    // The gym: a hall under a lit vault, a great lightning bolt on its front, the coaster's station.
    {
      const gx = 0, gz = s.r * 0.15;
      add(bare(new THREE.BoxGeometry(46, 12, 30).translate(gx, 6, gz)), banded, true, g);
      add(bare(new THREE.CylinderGeometry(15, 15, 46, 20, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 0.5, 1).translate(gx, 12, gz)), std({ color: "#ffe066", roughness: 0.4, metalness: 0.3, emissive: "#ffb800", emissiveIntensity: 0.25 }), true, g);
      const bolt = new THREE.Shape();
      [[0.15, -1], [-0.45, 0.1], [0, 0.1], [-0.2, 1], [0.5, -0.2], [0.05, -0.2], [0.3, -1]].forEach(([x, y], i) => (i ? bolt.lineTo(x * 7, -y * 7) : bolt.moveTo(x * 7, -y * 7)));
      add(bare(new THREE.ShapeGeometry(bolt).translate(gx, 11, gz + 15.3)), glow(NEON[2], 3.6), false, g);
      add(bare(new THREE.PlaneGeometry(30, 6).translate(gx, 3.2, gz + 15.2)), glassLit, false, g);
    }
    // The carousel: a striped canopy over a turning deck of riders, bulbs round its rim.
    {
      const cx = -s.r * 0.42, cz = s.r * 0.3;
      const car = new THREE.Group();
      car.position.set(cx, 0, cz);
      g.add(car);
      const stripes = stripeTexture("#ff4f9a", "#fff4f8");
      stripes.repeat.set(4, 1);
      own.push(stripes);
      add(bare(new THREE.CylinderGeometry(9, 9.4, 0.8, 32).translate(0, 0.4, 0)), white, true, car);
      add(new THREE.ConeGeometry(10.5, 5, 32, 1, true).translate(0, 8.6, 0), std({ map: stripes, roughness: 0.7, side: THREE.DoubleSide }), true, car);
      add(bare(new THREE.CylinderGeometry(0.8, 0.8, 6, 12).translate(0, 3.6, 0)), std({ color: "#ffd23a", metalness: 0.7, roughness: 0.3 }), true, car);
      const riders: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        riders.push(bare(new THREE.BoxGeometry(0.6, 1.2, 1.6).translate(Math.cos(a) * 6.5, 2 + (k % 2) * 0.6, Math.sin(a) * 6.5)));
        riders.push(bare(new THREE.CylinderGeometry(0.06, 0.06, 6, 4).translate(Math.cos(a) * 6.5, 3.4, Math.sin(a) * 6.5)));
      }
      add(mergeGeometries(riders), std({ color: "#f6f0ff", roughness: 0.5 }), true, car);
      const rim: THREE.Vector3[] = [];
      for (let k = 0; k < 40; k++) { const a = (k / 40) * Math.PI * 2; rim.push(new THREE.Vector3(cx + Math.cos(a) * 10.5, 6.2, cz + Math.sin(a) * 10.5)); }
      const rb = new THREE.InstancedMesh(bulbGeo, glow("#fff0c0", 3.2), rim.length);
      rim.forEach((p, i) => rb.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
      rb.computeBoundingSphere();
      g.add(rb);
      ticks.push((t) => { car.rotation.y = t * 0.5; });
    }
    // The drop tower: a tall lit mast, its ring of seats rising and falling.
    {
      const dx = s.r * 0.5, dz = s.r * 0.25;
      add(bare(new THREE.CylinderGeometry(1.6, 2.2, 62, 12).translate(dx, 31, dz)), white, true, g);
      add(bare(new THREE.CylinderGeometry(1.75, 1.75, 60, 12, 1, true).translate(dx, 31, dz)), glow(NEON[3], 0.9), false, g);
      add(bare(new THREE.SphereGeometry(2.6, 12, 8).translate(dx, 63, dz)), glow(NEON[0], 3), false, g);
      const ringG = new THREE.TorusGeometry(3.6, 0.8, 6, 20).rotateX(Math.PI / 2);
      const ring = add(ringG, std({ color: "#37c8ff", roughness: 0.4, emissive: "#37c8ff", emissiveIntensity: 0.4 }), true, g);
      ticks.push((t) => {
        const ph = (t % 14) / 14;
        const y = ph < 0.55 ? 4 + (ph / 0.55) * 52 : ph < 0.65 ? 56 : ph < 0.72 ? 56 - Math.pow((ph - 0.65) / 0.07, 2) * 52 : 4;
        ring.position.set(dx, y, dz);
      });
    }
    // Striped tents and stalls round the edge, strings of bulbs between their tops.
    {
      const tentCols: [string, string][] = [["#37c8ff", "#ffffff"], ["#ffd23a", "#ff4f9a"], ["#8a63ff", "#ffffff"], ["#43e39a", "#ffffff"]];
      const tops: THREE.Vector3[] = [];
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2 + 0.3;
        const tx = Math.cos(a) * s.r * 0.62, tz = Math.sin(a) * s.r * 0.86 * 0.62;
        if (Math.hypot(tx + s.r * 0.42, tz - s.r * 0.3) < 18 || Math.hypot(tx - s.r * 0.5, tz - s.r * 0.25) < 10 || Math.abs(tx) < 30 && Math.abs(tz - s.r * 0.15) < 22) continue;
        const [ca, cb] = tentCols[k % tentCols.length];
        const st = stripeTexture(ca, cb);
        st.repeat.set(3, 1);
        own.push(st);
        const sz = 4 + r() * 3;
        add(bare(new THREE.CylinderGeometry(sz, sz, 3.2, 20, 1, true).translate(tx, 1.6, tz)), std({ map: st, roughness: 0.7, side: THREE.DoubleSide }), true, g);
        add(new THREE.ConeGeometry(sz * 1.15, sz * 0.9, 20, 1, true).translate(tx, 3.2 + sz * 0.45, tz), std({ map: st, roughness: 0.7, side: THREE.DoubleSide }), true, g);
        tops.push(new THREE.Vector3(tx, 3.2 + sz * 0.9, tz));
      }
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < tops.length; i++) {
        const a = tops[i], b = tops[(i + 1) % tops.length];
        const len = a.distanceTo(b);
        for (let d = 1.5; d < len; d += 2.2) { const p = a.clone().lerp(b, d / len); p.y -= Math.sin((d / len) * Math.PI) * 2.2; pts.push(p); }
      }
      const fb = new THREE.InstancedMesh(bulbGeo, glow(NEON[0], 2.6), pts.length);
      pts.forEach((p, i) => fb.setMatrixAt(i, new THREE.Matrix4().compose(p, new THREE.Quaternion(), new THREE.Vector3(0.55, 0.55, 0.55))));
      fb.computeBoundingSphere();
      g.add(fb);
    }
  }

  // Trains: placed every frame along their lines (looping out of the station into the haze).
  const tq = new THREE.Matrix4(), tp = new THREE.Vector3(), tt = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  ticks.push((t) => {
    for (const tr of trains) {
      const head = ((t * tr.speed) / tr.len + tr.offset) % 1;
      for (let k = 0; k < tr.n; k++) {
        const u = Math.max(0, head - (k * 17.6) / tr.len);
        tp.copy(tr.curve.getPointAt(u));
        tt.copy(tr.curve.getTangentAt(Math.min(0.999, u + 1e-4)));
        tq.lookAt(new THREE.Vector3(), tt.negate(), up);
        tq.setPosition(tp);
        tr.cars.setMatrixAt(k, tq);
        tr.wins.setMatrixAt(k, tq);
      }
      tr.cars.instanceMatrix.needsUpdate = tr.wins.instanceMatrix.needsUpdate = true;
    }
  });

  return {
    group,
    tick(t) { for (const f of ticks) f(t); },
    dispose() {
      group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
      for (const o of own) o.dispose();
    },
  };
}
