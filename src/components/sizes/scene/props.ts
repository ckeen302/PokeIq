import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { STREET, type WorldPlan } from "@/lib/sizes/world";
import { rng } from "./geo";
import { cutaway, type Shared } from "./shaders";

/**
 * Street furniture for the boulevard, all instanced (and kept low in
 * triangles: hundreds of cars line the boulevard): London plane trees
 * along the promenade, cast-iron lantern posts, parked and passing cars
 * and buses (plain liveries, no logos) and Morris advertising columns.
 * Original procedural models.
 */

export interface Props {
  group: THREE.Group;
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

export function buildProps(plan: WorldPlan, shared: Shared, tex: { bark: THREE.MeshStandardMaterialParameters }, quality: { trees: boolean }): Props {
  const group = new THREE.Group();
  group.name = "props";
  const disposables: { dispose(): void }[] = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const r = rng(424242);
  const { x0, x1 } = plan;
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
    for (const side of [1, -1]) for (let x = x0 + 4; x < x1 - 6; x += 10.5) tree(x + (r() - 0.5) * 0.6, side * STREET.trees);
    // A ring of trees round the plaza, leaving the avenues open.
    const ringR = plan.plaza.r - 8;
    const count = Math.round((Math.PI * 2 * ringR) / 13);
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2;
      const nearAvenue = [0, 1, 2, 3, 4, 5, 6, 7].some((i) => {
        const av = Math.PI + (i * Math.PI) / 4;
        const d = Math.atan2(Math.sin(a - av), Math.cos(a - av));
        return Math.abs(d) < Math.asin(Math.min(1, (i === 0 ? 40 : 26) / ringR));
      });
      if (nearAvenue) continue;
      const x = plan.plaza.cx + Math.cos(a) * ringR, z = Math.sin(a) * ringR;
      if (Math.hypot(x - plan.tower.x, z - plan.tower.z) < 70) continue;
      tree(x, z);
    }
    // Rows of trees down the other seven avenues.
    for (let i = 1; i < 8; i++) {
      const a = Math.PI + (i * Math.PI) / 4;
      const c = Math.cos(a), sn = Math.sin(a);
      for (let d = plan.plaza.r + 60; d < plan.plaza.r + 700; d += 13) {
        for (const off of [-14, 14]) tree(plan.plaza.cx + c * d - sn * off, sn * d + c * off);
      }
    }
    const bark = new THREE.MeshStandardMaterial({ ...tex.bark, color: "#a49a8c" });
    cutaway(bark, shared);
    add(trunkGeometry(), bark, trunkMats);
    const leafTex = leafTexture();
    disposables.push(leafTex);
    for (let v = 0; v < 3; v++) {
      const leaves = new THREE.MeshStandardMaterial({ color: "#ffffff", map: leafTex, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.8, metalness: 0 });
      cutaway(leaves, shared);
      const before = group.children.length;
      add(canopyGeometry(17 + v * 31), leaves, canopy[v], leafCols[v]);
      const mesh = group.children[before] as THREE.InstancedMesh | undefined;
      if (mesh) mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafTex, alphaTest: 0.5 });
    }
  }

  // ---- Lantern posts: on both pavements and along the promenade.
  {
    const mats: THREE.Matrix4[] = [];
    for (const side of [1, -1]) {
      for (let x = x0 + 10; x < x1 - 8; x += 26) mats.push(place(x, 0.12, side * (STREET.roadOut + 0.7), 0));
      // Along the lawn only on the far side: on the camera's side they would stand right in front of the lens.
      if (side > 0) for (let x = x0 + 23; x < x1 - 8; x += 26) mats.push(place(x, 0, side * (STREET.promenade - 0.5), 0));
    }
    const { iron, glass } = lanternGeometry();
    const ironM = new THREE.MeshStandardMaterial({ color: "#1f2a26", roughness: 0.45, metalness: 0.7 });
    const glassM = new THREE.MeshStandardMaterial({ color: "#fff4d8", emissive: "#ffcf7a", emissiveIntensity: 0.15, roughness: 0.15, metalness: 0.1 });
    cutaway(ironM, shared);
    cutaway(glassM, shared);
    add(iron, ironM, mats);
    add(glass, glassM, mats, undefined, false);
  }

  // ---- Morris columns on the pavements.
  {
    const mats: THREE.Matrix4[] = [];
    for (const side of [1, -1]) for (let x = x0 + 60; x < x1 - 20; x += 150 + r() * 60) mats.push(place(x, 0.12, side * (STREET.roadOut + 4.6), r() * 6));
    const { body, band } = morrisGeometry();
    const green = new THREE.MeshStandardMaterial({ color: "#2c4a37", roughness: 0.5, metalness: 0.35 });
    const poster = new THREE.MeshStandardMaterial({ color: "#efe3c4", roughness: 0.9 });
    cutaway(green, shared);
    cutaway(poster, shared);
    add(body, green, mats);
    add(band, poster, mats);
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
        for (let x = x0 + 5; x < x1 - 8; x += 5.6 + r() * 1.4) {
          if (r() < 0.32) continue;
          carMats.push(place(x, 0, side * lane, side > 0 ? 0 : Math.PI, 1));
          carCols.push(CAR_COLOURS[Math.floor(r() * CAR_COLOURS.length)]);
        }
      }
      // Traffic: spaced out in the inner lanes, heading the side's way.
      for (let x = x0 + 30; x < x1 - 30; x += 38 + r() * 70) {
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

  return { group, dispose() { for (const d of disposables) d.dispose(); } };
}
