import * as THREE from "three";
import type { Key, Vec3 } from "@/lib/world-history/camera";
import { col, makeCloudLayer, makeGlow, makeSky, makeTerrain, merge, noise2, placed, ramp, rng, stoneMaterial } from "@/components/world-history/scene/kit";
import { makeCanvasPanel } from "@/components/world-history/scene/props";
import { lights, loadFigures, lookAt, pointPixel } from "@/components/world-history/scene/chapters/common";
import type { ChapterBuilder } from "@/components/world-history/scene/types";
import { drawCritter, makeBall, makeDevice, makeGrass, makeSunShadows, makeThreads } from "../story-kit";
import { bag, heroFigure, shots, STOCK } from "./base";

/**
 * V. Red and Green. A Game Boy's screen fills the frame with a pixel title;
 * the camera pushes through it and the pixels become blocks, then a soft 3D
 * village in early morning. For a moment the sky flickers back to four
 * shades of green. Three balls on a lab table pop open in turn (slow
 * motion) and the three starters appear, rimmed green, orange and blue.
 * Mew zips over; lights pass from house to house on glowing threads; the
 * camera rises over the village at dusk as windows light up. A blue
 * cartridge glides in and a single card spins off it.
 */

type Parts = Record<"plaster" | "trim" | "stone" | "wood" | "roof" | "pane", THREE.BufferGeometry[]>;

/**
 * A cottage facing +z: a stone plinth, plaster walls, a pitched roof whose
 * eaves overhang the walls (with a ridge cap and a fascia line), a brick
 * chimney with a cap, a framed door under a little hood with a step, and
 * framed windows (sill, mullions, shutters) that glow warm from inside.
 */
function cottage(o: { w: number; h: number; d: number; seed: number }): Parts {
  const { w, h, d } = o;
  const r = rng(o.seed);
  const P: Parts = { plaster: [], trim: [], stone: [], wood: [], roof: [], pane: [] };
  const box = (k: keyof Parts, sx: number, sy: number, sz: number, x: number, y: number, z: number, rx = 0, ry = 0) => P[k].push(placed(new THREE.BoxGeometry(sx, sy, sz), [x, y, z], ry, [1, 1, 1], rx));
  box("stone", w + 0.12, 0.28, d + 0.12, 0, 0.14, 0);
  box("plaster", w, h - 0.28, d, 0, 0.28 + (h - 0.28) / 2, 0);
  // Gables (the walls' triangles under the roof, on the ±x ends).
  const rh = d * 0.44;
  const tri = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, rh)]);
  const gable = new THREE.ExtrudeGeometry(tri, { depth: w, bevelEnabled: false }).translate(0, 0, -w / 2).rotateY(Math.PI / 2).translate(0, h, 0);
  P.plaster.push(gable);
  // The roof: two slabs from the ridge out past the eaves.
  const ov = 0.42, ovx = 0.3, th = 0.12;
  const run = d / 2 + ov, ang = Math.atan2(rh, d / 2), len = run / Math.cos(ang);
  for (const side of [-1, 1]) {
    const cz = side * run / 2, cy = h + rh - (run / 2) * Math.tan(ang) + th * 0.5 / Math.cos(ang);
    box("roof", w + ovx * 2, th, len, 0, cy, cz, side * ang);
    // A fascia board along the eave.
    box("trim", w + ovx * 2, 0.16, 0.05, 0, h + rh - run * Math.tan(ang) - 0.02, side * (run + 0.01));
  }
  box("roof", w + ovx * 2 + 0.04, 0.1, 0.22, 0, h + rh + 0.09, 0);
  // Barge boards up the gable ends.
  for (const sx of [-1, 1]) for (const side of [-1, 1]) {
    const g = placed(new THREE.BoxGeometry(0.06, 0.16, len), [sx * (w / 2 + ovx), h + rh - (run / 2) * Math.tan(ang) + 0.02, side * run / 2], 0, [1, 1, 1], side * ang);
    P.trim.push(g);
  }
  // Chimney through the back slope.
  const chx = (r() < 0.5 ? -1 : 1) * w * 0.28;
  box("stone", 0.42, 1.5, 0.42, chx, h + rh * 0.55 + 0.4, -d * 0.2);
  box("stone", 0.52, 0.08, 0.52, chx, h + rh * 0.55 + 1.18, -d * 0.2);
  // The door: frame, panel, a hood on brackets, a step.
  const dx = (r() - 0.5) * w * 0.08, fz = d / 2;
  box("wood", 0.58, 1.12, 0.06, dx, 0.28 + 0.56, fz + 0.01);
  box("trim", 0.72, 0.08, 0.08, dx, 0.28 + 1.16, fz + 0.02);
  box("trim", 0.07, 1.16, 0.08, dx - 0.33, 0.28 + 0.58, fz + 0.02);
  box("trim", 0.07, 1.16, 0.08, dx + 0.33, 0.28 + 0.58, fz + 0.02);
  box("roof", 0.95, 0.06, 0.42, dx, 0.28 + 1.36, fz + 0.2, 0.18);
  box("stone", 0.9, 0.12, 0.42, dx, 0.06, fz + 0.24);
  P.pane.push(placed(new THREE.PlaneGeometry(0.3, 0.22), [dx, 0.28 + 0.92, fz + 0.045]));
  // Windows: a pair on the front (either side of the door), one on each gable end.
  const win = (x: number, y: number, z: number, ry: number, ww: number, wh: number) => {
    const at = (lx: number, ly: number, lz: number): Vec3 => [x + Math.cos(ry) * lx + Math.sin(ry) * lz, y + ly, z - Math.sin(ry) * lx + Math.cos(ry) * lz];
    P.pane.push(placed(new THREE.PlaneGeometry(ww, wh), at(0, 0, 0.012), ry));
    const tb = 0.07;
    P.trim.push(placed(new THREE.BoxGeometry(ww + tb * 2, tb, 0.07), at(0, wh / 2 + tb / 2, 0.02), ry));
    P.trim.push(placed(new THREE.BoxGeometry(ww + tb * 2 + 0.1, 0.07, 0.16), at(0, -wh / 2 - 0.035, 0.06), ry));
    P.trim.push(placed(new THREE.BoxGeometry(tb, wh, 0.07), at(-ww / 2 - tb / 2, 0, 0.02), ry));
    P.trim.push(placed(new THREE.BoxGeometry(tb, wh, 0.07), at(ww / 2 + tb / 2, 0, 0.02), ry));
    P.trim.push(placed(new THREE.BoxGeometry(0.035, wh, 0.04), at(0, 0, 0.02), ry));
    P.trim.push(placed(new THREE.BoxGeometry(ww, 0.035, 0.04), at(0, wh * 0.1, 0.02), ry));
    // Shutters, in the roof's colour.
    P.roof.push(placed(new THREE.BoxGeometry(ww * 0.48, wh + 0.06, 0.04), at(-ww * 0.78 - tb, 0, 0.03), ry));
    P.roof.push(placed(new THREE.BoxGeometry(ww * 0.48, wh + 0.06, 0.04), at(ww * 0.78 + tb, 0, 0.03), ry));
  };
  const wy = 0.28 + (h - 0.28) * 0.56;
  win(dx - w * 0.27, wy, fz, 0, 0.44, 0.6); win(dx + w * 0.27, wy, fz, 0, 0.44, 0.6);
  win(w / 2, wy, 0, Math.PI / 2, 0.46, 0.56);
  win(-w / 2, wy, 0, -Math.PI / 2, 0.46, 0.56);
  win(w / 2, h + rh * 0.38, 0, Math.PI / 2, 0.34, 0.36);
  return P;
}

/** Merges geometries and gives each source its own vertex colour. */
function mergeTinted(list: [THREE.BufferGeometry, THREE.Color][]) {
  const counts = list.map(([g]) => (g.index ? g.getAttribute("position").count : g.getAttribute("position").count));
  const geo = merge(list.map(([g]) => g));
  const c = new Float32Array(geo.getAttribute("position").count * 3);
  let o = 0;
  list.forEach(([, k], i) => { for (let j = 0; j < counts[i]; j++, o++) c.set([k.r, k.g, k.b], o * 3); });
  geo.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return { geo, counts };
}

/** The warm interior seen through a window pane: a lamp-lit room, curtains drawn back. */
function paneTexture() {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 64;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(32, 40, 2, 32, 40, 44);
  gr.addColorStop(0, "#fff2c8"); gr.addColorStop(0.45, "#f6b860"); gr.addColorStop(1, "#7a3a18");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  g.fillStyle = "rgba(120,40,30,0.75)";
  g.beginPath(); g.moveTo(0, 0); g.lineTo(16, 0); g.quadraticCurveTo(8, 34, 14, 64); g.lineTo(0, 64); g.fill();
  g.beginPath(); g.moveTo(64, 0); g.lineTo(48, 0); g.quadraticCurveTo(56, 34, 50, 64); g.lineTo(64, 64); g.fill();
  g.fillStyle = "rgba(60,30,10,0.5)"; g.fillRect(20, 50, 24, 14);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The village (shared with Chapter X's return to Kanto). The side toward +z is left open: the camera walks in from there. */
export function makeVillage(scene: THREE.Object3D, seed = 2, sun: Vec3 = [-0.82, 0.27, -0.5]) {
  const r = rng(seed);
  const spots: { pos: Vec3; rot: number; size: Vec3 }[] = [];
  const N = 14;
  for (let i = 0; i < N; i++) {
    // Around the green, on the arc away from the open side.
    const a = Math.PI / 2 + 0.75 + (i / (N - 1)) * (Math.PI * 2 - 1.5) + (r() - 0.5) * 0.12;
    const d = 10 + r() * 5 + (i % 2) * 3;
    const x = Math.cos(a) * d, z = Math.sin(a) * d - 4;
    spots.push({ pos: [x, 0, z], rot: Math.atan2(-x, -(z + 4)), size: [2.8 + r() * 1.2, 2.0 + r() * 0.6, 2.4 + r() * 0.6] });
  }
  const ROOFS = ["#9a3a2e", "#3a5a7e", "#4a6a3e", "#a8683a", "#6a4a6a", "#7a3a2a"].map((c) => col(c));
  const WALLS = ["#efe2cc", "#e8d4b4", "#f2e8d8", "#e2cfb8"].map((c) => col(c));
  const parts: { [K in keyof Parts]: [THREE.BufferGeometry, THREE.Color][] } = { plaster: [], trim: [], stone: [], wood: [], roof: [], pane: [] };
  const paneOwner: number[] = [];
  spots.forEach((sp, i) => {
    const P = cottage({ w: sp.size[0], h: sp.size[1], d: sp.size[2], seed: seed * 31 + i });
    const roofC = ROOFS[i % ROOFS.length], wallC = WALLS[(i * 3) % WALLS.length];
    for (const k of Object.keys(P) as (keyof Parts)[]) for (const g of P[k]) {
      placed(g, sp.pos, sp.rot);
      parts[k].push([g, k === "roof" ? roofC : k === "plaster" ? wallC : col("#ffffff")]);
      if (k === "pane") paneOwner.push(i);
    }
  });
  const sh = makeSunShadows({
    sun,
    boxes: spots.map((sp) => ({ c: [sp.pos[0], (sp.size[1] + sp.size[2] * 0.3) / 2, sp.pos[2]] as Vec3, half: [sp.size[0] / 2 + 0.1, (sp.size[1] + sp.size[2] * 0.3) / 2, sp.size[2] / 2 + 0.15] as Vec3, rot: sp.rot })),
    balls: [],
  });
  const wallMat = stoneMaterial({ color: "#ffffff", roughness: 0.92, dirt: 0.22 });
  wallMat.vertexColors = true;
  const trimMat = new THREE.MeshStandardMaterial({ color: col("#f3ede0"), roughness: 0.7 });
  const stoneMat = stoneMaterial({ color: "#8e8072", roughness: 0.95, dirt: 0.5 });
  const woodMat = new THREE.MeshStandardMaterial({ color: col("#5a3420"), roughness: 0.75 });
  const roofMat = stoneMaterial({ color: "#ffffff", roughness: 0.78, dirt: 0.35 });
  roofMat.vertexColors = true;
  const paneTex = paneTexture();
  const paneMat = new THREE.MeshBasicMaterial({ map: paneTex, vertexColors: true });
  const town = new THREE.Group();
  const merged = (Object.keys(parts) as (keyof Parts)[]).map((k) => {
    const { geo, counts } = mergeTinted(parts[k]);
    const m = { plaster: wallMat, trim: trimMat, stone: stoneMat, wood: woodMat, roof: roofMat, pane: paneMat }[k];
    town.add(new THREE.Mesh(geo, m));
    return { k, geo, counts };
  });
  scene.add(town);
  const paneGeo = merged.find((m) => m.k === "pane")!;
  const paneCol = paneGeo.geo.getAttribute("color") as THREE.BufferAttribute;
  // Grounding: garden paths from each door to the ring, picket fences with a gate gap, hedges.
  const fenceG: THREE.BufferGeometry[] = [], pathG: THREE.BufferGeometry[] = [], hedgeG: THREE.BufferGeometry[] = [];
  const toWorld = (sp: typeof spots[number], lx: number, lz: number): Vec3 => { const c = Math.cos(sp.rot), sn = Math.sin(sp.rot); return [sp.pos[0] + lx * c + lz * sn, 0, sp.pos[2] - lx * sn + lz * c]; };
  const fence = (pts: [number, number][], at: (x: number, z: number) => Vec3, rot: number) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
      const L = Math.hypot(x1 - x0, z1 - z0), ry = rot + Math.atan2(-(z1 - z0), x1 - x0);
      const n = Math.max(1, Math.round(L / 0.2));
      for (let k = 0; k <= n; k++) { const f = k / n; const p = at(x0 + (x1 - x0) * f, z0 + (z1 - z0) * f); fenceG.push(placed(new THREE.BoxGeometry(0.07, k % 6 === 0 ? 0.7 : 0.58, 0.04), [p[0], k % 6 === 0 ? 0.35 : 0.29, p[2]], ry)); }
      for (const y of [0.18, 0.44]) { const m = at((x0 + x1) / 2, (z0 + z1) / 2); fenceG.push(placed(new THREE.BoxGeometry(L, 0.05, 0.03), [m[0], y, m[2]], ry)); }
    }
  };
  spots.forEach((sp, i) => {
    const front = sp.size[2] / 2;
    const dist = Math.hypot(sp.pos[0], sp.pos[2] + 4);
    const L = Math.max(0.5, dist - front - 5.4);
    const mid = toWorld(sp, 0, front + L / 2);
    pathG.push(placed(new THREE.PlaneGeometry(0.9, L).rotateX(-Math.PI / 2), [mid[0], 0.022, mid[2]], sp.rot));
    const fz = front + 1.8, hw = sp.size[0] * 0.5 + 0.6;
    const at = (x: number, z: number) => toWorld(sp, x, z);
    if (i % 3 !== 1) {
      fence([[-hw, front - 0.3], [-hw, fz], [-0.6, fz]], at, sp.rot);
      fence([[0.6, fz], [hw, fz], [hw, front - 0.3]], at, sp.rot);
    } else {
      for (const side of [-1, 1]) { const p = at(side * (hw * 0.55 + 0.3), fz); hedgeG.push(placed(new THREE.BoxGeometry(hw - 0.7, 0.6, 0.5), [p[0], 0.3, p[2]], sp.rot)); }
    }
    // A flower bed under the front windows.
    for (const side of [-1, 1]) { const p = at(side * sp.size[0] * 0.3, front + 0.35); hedgeG.push(placed(new THREE.BoxGeometry(0.9, 0.32, 0.38), [p[0], 0.16, p[2]], sp.rot)); }
  });
  // Fences down both sides of the lane in.
  fence([[1.6, 30], [1.6, 7]], (x, z) => [x, 0, z], 0);
  fence([[-1.6, 7], [-1.6, 30]], (x, z) => [x, 0, z], 0);
  const fenceMat = new THREE.MeshStandardMaterial({ color: col("#e9e2d2"), roughness: 0.8 });
  const pathMat = new THREE.MeshStandardMaterial({ color: col("#cdb487"), roughness: 0.95 });
  const hedgeMat = stoneMaterial({ color: "#3e6a2c", roughness: 0.95, dirt: 0.6 });
  const fenceGeo = merge(fenceG), pathGeo = merge(pathG), hedgeGeo = merge(hedgeG);
  const extras = new THREE.Group();
  extras.add(new THREE.Mesh(fenceGeo, fenceMat), new THREE.Mesh(pathGeo, pathMat), new THREE.Mesh(hedgeGeo, hedgeMat));
  scene.add(extras);
  const grass = makeGrass({ count: 16000, center: [0, 0, -2], size: [44, 40], height: [0.1, 0.28], base: "#3a6a2a", tip: "#c4d870", seed: 9, clear: { x: 0, z: -4, r: 6.2 }, shadow: sh });
  grass.u.uWind.value = 0.4;
  grass.u.uSunDir.value.set(...sun).normalize();
  extras.add(grass.mesh);
  const nz = noise2(seed);
  const terrain = makeTerrain({ size: [220, 220], segments: 90, height: (x, z) => { const d = Math.hypot(x, z + 4); if (d < 24) return 0; const k = Math.min(1, (d - 24) / 10); return Math.max(0, (d - 24) * 0.12 + nz.fbm(x * 0.03, z * 0.03, 3) * 5 * k); }, color: (h, _s, x, z) => { const n = nz.fbm(x * 0.15, z * 0.15, 2); return [0.24 + h * 0.008 + n * 0.05, 0.42 + h * 0.006 + n * 0.06, 0.17]; } });
  scene.add(terrain.mesh);
  const path = new THREE.Mesh(new THREE.RingGeometry(4, 5.6, 64).rotateX(-Math.PI / 2), pathMat);
  path.position.set(0, 0.02, -4);
  const lane = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 30).rotateX(-Math.PI / 2), pathMat);
  lane.position.set(0, 0.015, 16);
  scene.add(path, lane);
  const trees = new THREE.InstancedMesh(new THREE.ConeGeometry(1.1, 3.4, 8), new THREE.MeshStandardMaterial({ color: col("#2f5a2c"), roughness: 0.9 }), 70);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.2, 1, 6), new THREE.MeshStandardMaterial({ color: col("#4a3020"), roughness: 0.9 }), 70);
  const m = new THREE.Matrix4();
  const balls: [number, number, number, number][] = [];
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2, dd = 22 + r() * 22;
    const x = Math.cos(a) * dd, z = Math.sin(a) * dd - 4;
    const open = Math.abs(x) < 6 && z > 0;
    const s = open ? 0.0001 : 0.8 + r() * 0.6;
    m.makeScale(s, s, s).setPosition(x, 2.2 * s, z);
    trees.setMatrixAt(i, m);
    m.makeScale(s, s, s).setPosition(x, 0.5 * s, z);
    trunks.setMatrixAt(i, m);
    if (!open) balls.push([x, 1.9 * s, z, 0.95 * s]);
  }
  sh.uniforms.uShBall.value = (sh.uniforms.uShBall.value as THREE.Vector4[]).map((v, i) => (balls[i] ? new THREE.Vector4(...balls[i]) : v));
  scene.add(trees, trunks);
  for (const [mat, tag] of [[terrain.mesh.material, "terrain"], [pathMat, "path"], [hedgeMat, "hedge"], [fenceMat, "fence"]] as [THREE.MeshStandardMaterial, string][]) sh.patch(mat, tag);
  const warm = col("#ffd8a0");
  return {
    spots, town, extras, grass, shadows: sh,
    /** Window light per house (0 day glow … 1 lit at dusk). */
    windows(k: number[]) {
      let o = 0;
      paneGeo.counts.forEach((n, j) => { const v = 0.35 + 2.6 * (k[paneOwner[j]] ?? 0); for (let q = 0; q < n; q++, o++) paneCol.setXYZ(o, warm.r * v, warm.g * v, warm.b * v); });
      paneCol.needsUpdate = true;
    },
    dispose() {
      merged.forEach((x) => x.geo.dispose());
      [wallMat, trimMat, stoneMat, woodMat, roofMat, paneMat, fenceMat, pathMat, hedgeMat].forEach((x) => x.dispose());
      paneTex.dispose(); fenceGeo.dispose(); pathGeo.dispose(); hedgeGeo.dispose(); grass.dispose();
      terrain.dispose(); path.geometry.dispose(); lane.geometry.dispose();
      [trees, trunks].forEach((t) => { t.geometry.dispose(); (t.material as THREE.Material).dispose(); t.dispose(); });
    },
  };
}

/** A pixel title screen (shared with Chapter VIII's callback): the film's own, two words and a little creature. */
export function drawTitleScreen(font: string) {
  return (g: CanvasRenderingContext2D, w: number, h: number) => {
    g.fillStyle = "#9bbc0f"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#0f380f";
    g.font = `700 ${Math.round(h * 0.13)}px ${font}`;
    g.textAlign = "center";
    g.fillText("POCKET", w / 2, h * 0.24);
    g.fillText("MONSTERS", w / 2, h * 0.38);
    drawCritter(g, w / 2 - h * 0.17, h * 0.47, h * 0.34, 41, "#306230");
    g.font = `600 ${Math.round(h * 0.07)}px ${font}`;
    g.fillText("RED · GREEN", w / 2, h * 0.92);
  };
}

export const build: ChapterBuilder = async (ctx) => {
  const scene = new THREE.Scene();
  const D = bag();
  const B = ctx.beat;
  const end = ctx.timing.anim;
  const tLaunch = B("launch"), tOld = B("old"), tThree = B("three"), tMew = B("mew-rumour"), tWord = B("word"), tBlue = B("blue");

  // Early morning: a low warm sun off to the left, long shadows across the green.
  const SUN: Vec3 = [-0.82, 0.27, -0.5];
  const sunV = new THREE.Vector3(...SUN).normalize();
  const sky = D.add(makeSky({ top: "#4a7fcc", horizon: "#f6d6a8", bottom: "#5a6a3a", sunDir: SUN, sunColor: "#ffd8a0", sunSize: 700, sunGlow: 0.45 }));
  scene.add(sky.mesh);
  scene.fog = new THREE.FogExp2(col("#dcc6a2"), 0.0048);
  const clouds = D.add(makeCloudLayer({ size: 700, y: 70, color: "#fff4e4", shadow: "#c0a8a8", density: 0.2, scale: 0.006, speed: [1, 0, 0.3], intensity: 1.05 }));
  scene.add(clouds.mesh);
  const L = lights(scene, { sky: "#a8c4ec", ground: "#4a5a2a", fill: 0.72, key: "#ffd8a8", keyK: 2.5, keyPos: [SUN[0] * 30, SUN[1] * 30, SUN[2] * 30], rim: "#a8c0ff", rimK: 0.35, rimPos: [20, 8, 14] });
  const V = D.add(makeVillage(scene, 2, SUN));
  V.shadows.uniforms.uShK.value = 0.82;

  // The Game Boy whose screen we push through.
  const gb = D.add(makeDevice("gb", { draw: drawTitleScreen(ctx.font), px: [320, 288] }));
  gb.group.scale.setScalar(6);
  gb.group.position.set(0, 2.2 - 6 * 1.48 * 0.2, 26);
  scene.add(gb.group);
  // The push through the screen: once the screen fills the frame, its pixels
  // switch off cell by cell (centre first, ragged at the edge, each flaring
  // pale green as it goes) and the morning village is behind them.
  const GX = 40, GY = 36;
  const thr = new Uint8Array(GX * GY * 4);
  const tr0 = rng(17);
  const cellK: number[] = [];
  for (let y = 0; y < GY; y++) for (let x = 0; x < GX; x++) {
    const rad = Math.hypot((x + 0.5) / GX - 0.5, ((y + 0.5) / GY - 0.5) * 0.9) / 0.68;
    const k = Math.min(0.999, Math.max(0, rad * 0.62 + tr0() * 0.38));
    cellK.push(k);
    thr.set([Math.round(k * 255), 0, 0, 255], (y * GX + x) * 4);
  }
  const thrTex = new THREE.DataTexture(thr, GX, GY, THREE.RGBAFormat);
  thrTex.magFilter = thrTex.minFilter = THREE.NearestFilter;
  thrTex.needsUpdate = true;
  const pixU = { uMap: { value: (gb.screen.mat as THREE.MeshBasicMaterial).map }, uThr: { value: thrTex }, uRect: { value: new THREE.Vector4(-1, -1, 1, 1) }, uK: { value: 0 }, uGrid: { value: new THREE.Vector2(GX, GY) } };
  const pixMat = new THREE.ShaderMaterial({
    uniforms: pixU,
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    vertexShader: /* glsl */ `varying vec2 vN; void main(){ vN = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap, uThr; uniform vec4 uRect; uniform float uK; uniform vec2 uGrid;
      varying vec2 vN;
      void main(){
        vec2 uv = (vN - uRect.xy) / max(uRect.zw - uRect.xy, vec2(1e-3));
        vec2 cell = floor(uv * uGrid);
        vec2 cuv = (cell + 0.5) / uGrid;
        // Past the screen's edge (a tall phone frame), the bezel breaks up into cells too, a little ahead of the screen.
        float outside = 1.0 - step(0.0, cuv.x) * step(cuv.x, 1.0) * step(0.0, cuv.y) * step(cuv.y, 1.0);
        float th = texture2D(uThr, clamp(cuv, 0.5 / uGrid, 1.0 - 0.5 / uGrid)).r - 0.12 * outside;
        float left = th - uK;
        if (left < 0.0) discard;
        vec3 c = mix(texture2D(uMap, cuv).rgb * 1.25, vec3(0.07, 0.07, 0.09), outside);
        vec2 f = fract(uv * uGrid);
        float gap = step(0.07, f.x) * step(0.07, f.y);
        c *= mix(0.72, 1.0, gap);
        float edge = 1.0 - smoothstep(0.0, 0.09, left);
        c = mix(c, vec3(0.62, 0.78, 0.2), edge * step(0.001, uK));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const pix = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), pixMat);
  pix.frustumCulled = false;
  pix.renderOrder = 999;
  scene.add(pix);
  D.add({ dispose: () => { pix.geometry.dispose(); pixMat.dispose(); thrTex.dispose(); } });
  // As each cell goes, a block of it falls away into the village.
  const NB = 420;
  const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: col("#ffffff"), roughness: 0.6, emissive: col("#9bbc0f"), emissiveIntensity: 0.35 }), NB);
  const GBC = ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"].map((c) => col(c));
  const br = rng(7);
  const bseed = Array.from({ length: NB }, (_, i) => { const cx = Math.floor(br() * GX), cy = Math.floor(br() * GY); blocks.setColorAt(i, GBC[Math.floor(br() * 4)]); return [cx, cy, cellK[cy * GX + cx], br()]; });
  scene.add(blocks);
  D.add({ dispose: () => { blocks.geometry.dispose(); (blocks.material as THREE.Material).dispose(); blocks.dispose(); } });
  const m4 = new THREE.Matrix4();
  const corner = new THREE.Vector3();
  const scrW = 0.9 * 0.52, scrH = 0.9 * 0.47;

  // The lab table and three balls.
  const tableMat = new THREE.MeshStandardMaterial({ color: col("#7a5236"), roughness: 0.5 });
  const table = new THREE.Mesh(merge([placed(new THREE.BoxGeometry(4.2, 0.1, 1.6), [0, 0.95, 2]), ...[[-1.95, -0.65], [1.95, -0.65], [-1.95, 0.65], [1.95, 0.65]].map(([x, z]) => placed(new THREE.BoxGeometry(0.1, 0.9, 0.1), [x, 0.45, 2 + z]))]), tableMat);
  const clothMat = new THREE.MeshStandardMaterial({ color: col("#f4f0e6"), roughness: 0.85 });
  const cloth = new THREE.Mesh(merge([placed(new THREE.BoxGeometry(3.9, 0.012, 1.3), [0, 1.006, 2]), placed(new THREE.BoxGeometry(3.9, 0.32, 0.012), [0, 0.85, 2.655])]), clothMat);
  scene.add(table, cloth);
  D.add({ dispose: () => { table.geometry.dispose(); tableMat.dispose(); cloth.geometry.dispose(); clothMat.dispose(); } });
  // A halo of each starter's colour behind it as it forms.
  const halos = ["#5aff8a", "#ff9a3a", "#5ab8ff"].map((c, i) => { const g = D.add(makeGlow({ pos: [(i - 1) * 1.2, 1.5, 1.7], size: 2.2, color: c, intensity: 0 })); scene.add(g.sprite); return g; });
  const balls = [-1.2, 0, 1.2].map((x) => { const b = D.add(makeBall({ radius: 0.17 })); b.group.position.set(x, 1.18, 2); b.group.rotation.y = 0; scene.add(b.group); return b; });
  const figs = await loadFigures(ctx, [1, 4, 7, 151]);
  const RIM = ["#5aff8a", "#ff9a3a", "#5ab8ff"];
  const starters = [1, 4, 7].map((a, i) => heroFigure(figs.get(a), { pos: [(i - 1) * 1.2, 1.02, 2.1], height: 0.9, accent: RIM[i], scene }));
  starters.forEach((s) => s && D.add(s));
  const mew = heroFigure(figs.get(151), { pos: [0, 9, -2], height: 2.8, accent: "#ff9ad0", scene });
  if (mew) D.add(mew);
  const mewTrail = D.add(makeGlow({ pos: [0, 9, -2], size: 4, color: "#ff9ad0", intensity: 0 }));
  scene.add(mewTrail.sprite);

  // Word of mouth: threads of light from house to house.
  const tr = rng(5);
  const pairs: [Vec3, Vec3][] = [];
  for (let i = 0; i < V.spots.length; i++) for (let k = 0; k < 2; k++) {
    const j = Math.floor(tr() * V.spots.length);
    if (j === i) continue;
    const a = V.spots[i].pos, b = V.spots[j].pos;
    pairs.push([[a[0], 3.4, a[2]], [b[0], 3.4, b[2]]]);
  }
  const threads = D.add(makeThreads({ pairs, lift: 3, color: "#ffd890", per: 50, size: 0.12 }));
  scene.add(threads.points);

  // The blue cartridge, and the card that spins off it.
  // A plain cartridge: a body with a notched top corner, grip ridges and a blank label with a little creature.
  const cartShape = new THREE.Shape([[-0.285, -0.325], [0.285, -0.325], [0.285, 0.24], [0.2, 0.325], [-0.285, 0.325]].map(([x, y]) => new THREE.Vector2(x, y)));
  const cartGeo = merge([new THREE.ExtrudeGeometry(cartShape, { depth: 0.08, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 }).translate(0, 0, -0.04), ...[0, 1, 2, 3].map((i) => placed(new THREE.BoxGeometry(0.4, 0.012, 0.012), [0, -0.2 - i * 0.03, 0.055]))]);
  const cart = new THREE.Mesh(cartGeo, new THREE.MeshStandardMaterial({ color: col("#2a5ad8"), roughness: 0.3, metalness: 0.05, emissive: col("#1a3a9a"), emissiveIntensity: 0.5 }));
  const label = makeCanvasPanel({ w: 0.42, h: 0.34, px: [168, 136], emissive: 0.9, draw(g, w, h) { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#6aa8ff"); gr.addColorStop(1, "#1a4ab8"); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = "#ffffff"; g.fillRect(8, 8, w - 16, 4); drawCritter(g, w / 2 - 34, 30, 68, 91, "#eaf2ff"); } });
  label.mesh.position.set(0, 0.07, 0.066);
  cart.add(label.mesh);
  D.add(label);
  scene.add(cart);
  const cardTex = makeCanvasPanel({ w: 0.42, h: 0.58, px: [128, 176], emissive: 1.0, draw(g, w, h) { g.fillStyle = "#f2c94c"; g.fillRect(0, 0, w, h); g.fillStyle = "#e85a3a"; g.fillRect(7, 7, w - 14, h - 14); g.fillStyle = "#fff8e0"; g.fillRect(14, 24, w - 28, 64); drawCritter(g, 36, 28, 56, 77, "#3a2a8a"); } });
  D.add(cardTex);
  scene.add(cardTex.mesh);
  D.add({ dispose: () => { cartGeo.dispose(); (cart.material as THREE.Material).dispose(); } });

  const R = 6.2;
  const arc = (k: number): Key => { const a = -0.8 + k * 1.6; return { t: tThree + 0.4 + k * 4.6, pos: [Math.sin(a) * 4.6, 1.75, 2 + Math.cos(a) * 4.6], look: [0, 1.35, 2], fov: 38 }; };
  // Shots: the push through the screen into the village (one move); cut in to the starters' arc; cut to
  // the rooftops for the rumour and the network; cut close on the Blue cartridge.
  const cam = shots([
    [0, [
      { t: 0, pos: [0, 2.2, 26 + R * 1.6], look: [0, 2.2, 26], fov: 40 },
      { t: tLaunch + 0.6, pos: [0, 2.2, 26 + R * 0.9], look: [0, 2.2, 26], fov: 40 },
      { t: tLaunch + 1.25, pos: [0, 2.2, 29.1], look: [0, 2.2, 24], fov: 40 },
      { t: tLaunch + 2.3, pos: [0, 2.2, 28.4], look: [0, 2.1, 18], fov: 42 },
      { t: tLaunch + 3.6, pos: [0, 2.3, 22], look: [0, 1.8, 8], fov: 46 },
      { t: tOld + 1, pos: [0, 2.6, 16], look: [0, 1.6, 2], fov: 46 },
      { t: tThree - 0.3, pos: [0, 2.45, 11.5], look: [0, 1.45, 2], fov: 44 },
    ]],
    [tThree - 0.3, [
      { t: tThree - 0.3, pos: [0, 2.2, 7], look: [0, 1.25, 2], fov: 42 },
      arc(0), arc(0.5), arc(1),
      { t: tMew - 0.1, pos: [Math.sin(0.8) * 4.7, 1.8, 2 + Math.cos(0.8) * 4.7], look: [0, 1.4, 2], fov: 38 },
    ]],
    [tMew - 0.1, [
      { t: tMew - 0.1, pos: [0, 5.2, 16], look: [0, 6, -2], fov: 50 },
      { t: tMew + 0.6, pos: [0, 6, 18], look: [0, 6, -2], fov: 50 },
      { t: tWord + 0.5, pos: [0, 14, 30], look: [0, 1, -4], fov: 50 },
      { t: tBlue + 0.5, pos: [0, 17.2, 31.2], look: [0, 1.5, -4], fov: 50 },
    ]],
    [tBlue + 0.5, [
      { t: tBlue + 0.5, pos: [0.25, 5.8, 13], look: [0, 3.3, 4], fov: 42 },
      { t: tBlue + 1.8, pos: [0.2, 5.2, 11.5], look: [0, 3.3, 4], fov: 42 },
      { t: end, pos: [0.4, 3.7, 7.6], look: [0, 3.3, 4], fov: 38 },
    ]],
  ]);
  const dayTop = col("#3a74d0"), duskTop = col("#2a2e6a"), dayHor = col("#d6e0e6"), duskHor = col("#ff8a5a");

  return {
    scene,
    portalScale: 1.6,
    camera: cam,
    orbit: (t) => ({ target: cam(t).look, limits: { yaw0: 0, yawSpan: 1.1, minPitch: -0.05, maxPitch: 1.2, minDist: 1.5, maxDist: 60 } }),
    update(t, ambient, cam, viewH) {
      const px = pointPixel(viewH, cam);
      sky.follow(cam);
      const dusk = ramp(t, tWord - 1, tWord + 3);
      sky.u.uTop.value.copy(dayTop.clone().lerp(duskTop, dusk));
      sky.u.uHorizon.value.copy(dayHor.clone().lerp(duskHor, dusk));
      L.key.intensity = 2.5 * (1 - dusk * 0.72);
      L.key.color.copy(col("#ffd8a8").lerp(col("#ff8a50"), dusk));
      clouds.u.uTime.value = ambient;
      clouds.u.uColor.value.copy(col("#fff4e4").lerp(col("#ffb08a"), dusk));
      clouds.u.uShadow.value.copy(col("#d8c8cc").lerp(col("#4a3a6a"), dusk));
      V.grass.u.uTime.value = ambient;
      V.grass.u.uLight.value = 1 - dusk * 0.6;
      L.hemi.intensity = 0.72 * (1 - dusk * 0.25);
      (scene.fog as THREE.FogExp2).color.copy(col("#d2cdbc").lerp(col("#6a4a5a"), dusk));
      // Through the screen: the title's pixels switch off and fall into the village.
      const tA = tLaunch + 1.25;
      const dis = ramp(t, tA, tA + 1.0);
      const lin = Math.max(0, Math.min(1, (t - tA) / 1.0));
      gb.group.visible = t < tA;
      gb.screen.redraw(ambient);
      pix.visible = t >= tA && lin < 1;
      if (pix.visible) {
        gb.group.updateMatrixWorld(true);
        let x0 = 9, y0 = 9, x1 = -9, y1 = -9;
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          corner.set((sx * scrW) / 2, (sy * scrH) / 2, 0);
          gb.screen.mesh.localToWorld(corner).project(cam);
          x0 = Math.min(x0, corner.x); x1 = Math.max(x1, corner.x); y0 = Math.min(y0, corner.y); y1 = Math.max(y1, corner.y);
        }
        pixU.uRect.value.set(x0, y0, x1, y1);
        pixU.uK.value = lin * 1.02;
      }
      for (let i = 0; i < NB; i++) {
        const [cx, cy, k0, rr] = bseed[i];
        const f = Math.max(0, Math.min(1, (lin * 1.02 - k0) / 0.55));
        const sx = ((cx + 0.5) / GX - 0.5) * scrW * 6, sy = 2.2 + ((cy + 0.5) / GY - 0.5) * scrH * 6;
        const tx = sx * 7 + (rr - 0.5) * 6, tz = 27 - 10 - rr * 22;
        const x = sx + (tx - sx) * f, z = 27.1 + (tz - 27.1) * f, y = sy + (0.12 - sy) * f * f + Math.sin(f * Math.PI) * 1.2;
        const sc = f > 0 && f < 1 ? 0.07 * (1 - f) + 0.02 : 0.00001;
        m4.makeRotationFromEuler(new THREE.Euler(f * 4 * rr, f * 3, 0)).scale(new THREE.Vector3(sc, sc, sc)).setPosition(x, y, z);
        blocks.setMatrixAt(i, m4);
      }
      blocks.instanceMatrix.needsUpdate = true;
      blocks.visible = t >= tA && lin < 1.6;
      void dis;
      // The starters: each ball pops in turn and its Pokémon forms out of light.
      starters.forEach((s, i) => {
        const at = tThree + 0.9 + i * 1.2;
        const k = ramp(t, at, at + 0.5);
        balls[i].open(k, RIM[i]);
        balls[i].group.visible = t < tMew + 1;
        const form = ramp(t, at + 0.2, at + 1.4) * (1 - ramp(t, tMew + 0.5, tMew + 1.5));
        s?.set(form, ambient, viewH, cam, 0.03, 0.05);
        halos[i].set(RIM[i], (0.5 * form + 0.9 * Math.max(0, 1 - Math.abs(t - at - 0.4) * 1.6)) * (1 - ramp(t, tMew, tMew + 1)));
      });
      // Mew zips across the top of the frame.
      const mz = ramp(t, tMew + 0.2, tMew + 2.6);
      const mp: Vec3 = [-12 + mz * 24, 6.2 + Math.sin(mz * 9) * 0.7, 3 + Math.sin(mz * 4) * 1.5];
      if (mew) { mew.move(mp, Math.PI / 2 * (mz < 1 ? 1 : 0)); mew.set(mz > 0 && mz < 1 ? 1 : 0, ambient, viewH, cam, 0.02, 0.4); }
      mewTrail.sprite.position.set(...mp);
      mewTrail.set("#ff9ad0", mz > 0 && mz < 1 ? 1.2 : 0);
      // The word spreads house to house, and windows light up across the village.
      threads.u.uGrow.value = ramp(t, tMew + 2, tWord + 4);
      threads.u.uTime.value = ambient;
      threads.u.uPixel.value = px;
      V.windows(V.spots.map((_, i) => ramp(t, tWord - 0.5 + i * 0.25, tWord + 0.5 + i * 0.25)));
      // Blue: the cartridge glides in; a card spins off it.
      const glide = ramp(t, tBlue + 0.6, tBlue + 1.8);
      cart.visible = glide > 0;
      cart.position.set(-2 + glide * 2, 3.3, 4);
      cart.rotation.y = (1 - glide) * 0.8;
      const spin = ramp(t, tBlue + 2.0, end);
      cardTex.mesh.visible = spin > 0;
      cardTex.mesh.position.set(0.1 + spin * 1.4, 3.3 + spin * 0.5, 4.1 + spin * 1.2);
      cardTex.mesh.rotation.set(spin * 0.4, spin * 7, spin * 0.3);
    },
    look: (t) => {
      const L0 = lookAt(t, { ...STOCK.pop, saturation: 1.15 }, {
        exposure: [[0, 0.95], [tLaunch + 2.5, 0.88], [tWord + 2, 0.9], [end, 0.95]],
        bloom: [[0, 0.9], [tLaunch + 2.6, 0.7], [tThree + 1, 0.95], [tMew, 0.75], [tWord + 2, 1.0]],
        rays: [[0, 0.16], [tWord, 0.16], [tWord + 2.5, 0.05]],
      }, { pos: [sunV.x * 500, sunV.y * 500, sunV.z * 500], color: [1.0, 0.82, 0.55] });
      // "Old": for a moment the world flickers back to four shades of green.
      const g = t > tOld + 0.8 && t < tOld + 2.2 && Math.sin((t - tOld) * 22) > -0.6 ? 1 : 0;
      if (g) return { ...L0, saturation: 0, gain: [0.62, 0.78, 0.18], contrast: 1.5, lift: [0.06, 0.12, 0.03] };
      return L0;
    },
    dispose() { D.dispose(); },
  };
};
