import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CASTELIA_STREET, rng, type CasteliaPlan } from "@/lib/sizes/castelia";
import type { WorldPlan } from "@/lib/sizes/world";
import { cutaway, type Shared } from "../shaders";

/**
 * The street life of Castelia's evening, all instanced (one draw per kind):
 * street lamps along the main street, round the plaza and on the
 * waterfront; traffic with its head and tail lights; trees round the
 * fountain and along the promenade; strings of lights across Mall Street
 * and lanterns down Narrow Street.
 */

export interface CasteliaProps {
  group: THREE.Group;
  dispose(): void;
}

const CAR = ["#e8e8e6", "#1c1e22", "#8e959c", "#5f6872", "#7e1a1a", "#1f355c", "#2e4a38", "#c9c2b2", "#3e4146"];
const TAXI = "#f0b81c";

function mergedParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clean = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of clean) g.deleteAttribute("uv");
  const out = mergeGeometries(clean, false)!;
  for (const g of [...parts, ...clean]) g.dispose();
  return out;
}

const boxAt = (w: number, h: number, d: number, x: number, y: number, z: number) => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  return g;
};

export function buildProps(plan: WorldPlan, cp: CasteliaPlan, shared: Shared, quality: { detail: number; trees: boolean }): CasteliaProps {
  const group = new THREE.Group();
  group.name = "castelia-props";
  const own: { geo: THREE.BufferGeometry[]; mat: THREE.Material[] } = { geo: [], mat: [] };
  const S = CASTELIA_STREET;
  const r = rng(9001);
  const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], colors?: THREE.Color[], shadows = false) => {
    if (!mats.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, mats.length);
    mats.forEach((x, i) => m.setMatrixAt(i, x));
    if (colors) colors.forEach((c, i) => m.setColorAt(i, c));
    m.castShadow = shadows;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    group.add(m);
    own.geo.push(geo);
    return m;
  };
  const mat = <M extends THREE.Material>(m: M, cut = true) => { if (cut) cutaway(m, shared); own.mat.push(m); return m; };
  const at = (x: number, z: number, yaw = 0, s = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(s, s, s));

  // ---- Street lamps: a slim pole with an arm over the road and a warm lamp.
  {
    const pole = mergedParts([boxAt(0.22, 8.6, 0.22, 0, 0, 0), boxAt(0.14, 0.14, 2.6, 0, 8.4, 1.2)]);
    const head = boxAt(0.7, 0.28, 1.1, 0, 8.18, 2.3);
    const where: THREE.Matrix4[] = [];
    const xEnd = plan.x1 - 6;
    for (let x = cp.promenade.x1 + 8; x < xEnd; x += 34) {
      // Arms reach out over the road from both kerbs.
      where.push(at(x, -(S.road + 1.4), 0));
      where.push(at(x + 17, S.road + 1.4, Math.PI));
    }
    // Round the fountain's plaza and along the waterfront.
    const c = cp.centre;
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; where.push(at(c.x + Math.cos(a) * (c.r - 4), c.z + Math.sin(a) * (c.r - 4), Math.PI / 2 - a + Math.PI)); }
    for (let z = cp.promenade.z0 + 30; z < cp.promenade.z1 - 20; z += 30) where.push(at(cp.land.x0 + 4, z, -Math.PI / 2));
    // Round Central Plaza's edge, facing in.
    {
      const rad = cp.edge - 10;
      const n = Math.round((Math.PI * 2 * rad) / 30);
      for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; where.push(at(c.x + Math.cos(a) * rad, c.z + Math.sin(a) * rad, Math.PI / 2 - a + Math.PI)); }
    }
    inst(pole, mat(new THREE.MeshStandardMaterial({ color: "#3a3d42", roughness: 0.5, metalness: 0.6 })), where);
    inst(head, mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.9, 1.3) })), where);
  }

  // ---- Traffic on the main street and the cross streets near it.
  {
    const body = mergedParts([boxAt(4.4, 0.85, 1.85, 0, 0.32, 0), boxAt(2.5, 0.62, 1.7, -0.25, 1.17, 0)]);
    const glass = boxAt(2.3, 0.5, 1.74, -0.25, 1.2, 0);
    const heads = mergedParts([boxAt(0.08, 0.16, 0.34, 2.2, 0.82, -0.62), boxAt(0.08, 0.16, 0.34, 2.2, 0.82, 0.62)]);
    const tails = mergedParts([boxAt(0.08, 0.14, 0.34, -2.21, 0.86, -0.62), boxAt(0.08, 0.14, 0.34, -2.21, 0.86, 0.62)]);
    const where: THREE.Matrix4[] = [];
    const colors: THREE.Color[] = [];
    for (const road of cp.roads) {
      const dx = road.x1 - road.x0, dz = road.z1 - road.z0;
      const len = Math.hypot(dx, dz);
      const yaw = Math.atan2(-dz, dx);
      // Two lanes: one each way on a cross street; the main street's carriageways are one way each.
      const lanes = Math.abs(dz) > Math.abs(dx) ? [-road.w / 4, road.w / 4] : [road.z0 > 0 ? -2.2 : 2.2, road.z0 > 0 ? 2.6 : -2.6];
      for (const lane of lanes) {
        let s = r() * 20;
        while (s < len - 6) {
          const f = s / len;
          const px = road.x0 + dx * f, pz = road.z0 + dz * f;
          const nx = -dz / len, nz = dx / len;
          const flip = (Math.abs(dz) > Math.abs(dx) ? lane > 0 : road.z0 > 0) ? Math.PI : 0;
          where.push(at(px + nx * lane, pz + nz * lane, yaw + flip));
          colors.push(new THREE.Color(r() < 0.22 ? TAXI : CAR[Math.floor(r() * CAR.length)]));
          s += 9 + r() * (quality.detail < 0.6 ? 70 : 38);
        }
      }
    }
    const paint = mat(new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.35, metalness: 0.4 }));
    inst(body, paint, where, colors);
    inst(glass, mat(new THREE.MeshStandardMaterial({ color: "#0e1218", roughness: 0.1, metalness: 0.6 })), where);
    inst(heads, mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.8, 2.4) })), where);
    inst(tails, mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.15, 0.1) })), where);
  }

  // ---- Trees round the fountain and along the waterfront.
  if (quality.trees) {
    const trunk = boxAt(0.4, 3.2, 0.4, 0, 0, 0);
    const crown = new THREE.IcosahedronGeometry(2.8, 1);
    crown.scale(1, 1.15, 1);
    crown.translate(0, 5.4, 0);
    const where: THREE.Matrix4[] = [];
    const tint: THREE.Color[] = [];
    const c = cp.centre;
    for (const rad of [c.r - 14, c.r - 26]) {
      const n = Math.round((Math.PI * 2 * rad) / 11);
      for (let k = 0; k < n; k++) {
        const a = ((k + (rad === c.r - 26 ? 0.5 : 0)) / n) * Math.PI * 2;
        where.push(at(c.x + Math.cos(a) * rad, c.z + Math.sin(a) * rad, r() * 6, 0.85 + r() * 0.35));
        tint.push(new THREE.Color("#4c7a3e").multiplyScalar(0.75 + r() * 0.4));
      }
    }
    for (let z = cp.promenade.z0 + 15; z < cp.promenade.z1 - 10; z += 15) {
      where.push(at(cp.land.x0 + 16 + r() * 3, z, r() * 6, 0.8 + r() * 0.3));
      tint.push(new THREE.Color("#4f7a40").multiplyScalar(0.75 + r() * 0.4));
    }
    inst(trunk, mat(new THREE.MeshStandardMaterial({ color: "#4a3b2e", roughness: 1 })), where);
    inst(crown, mat(new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.95, flatShading: true })), where, tint, true);
  }

  // ---- Strings of lights across Mall Street, lanterns down Narrow Street.
  {
    const bulb = new THREE.IcosahedronGeometry(0.16, 0);
    const where: THREE.Matrix4[] = [];
    const m = cp.mall;
    for (let z = m.z0 + 6; z < m.z1; z += 7) {
      const x0 = m.x - m.w / 2 - 1, x1 = m.x + m.w / 2 + 1;
      for (let k = 0; k <= 16; k++) {
        const f = k / 16;
        const y = 9 - Math.sin(f * Math.PI) * 1.6;
        where.push(new THREE.Matrix4().makeTranslation(x0 + (x1 - x0) * f, y, z + Math.sin(f * Math.PI) * 0.6));
      }
    }
    const n = cp.narrow;
    for (let z = n.z0 + 5; z < n.z1; z += 9) for (const s of [-1, 1]) where.push(new THREE.Matrix4().compose(new THREE.Vector3(n.x + s * (n.w / 2 + 0.2), 4.2, z), new THREE.Quaternion(), new THREE.Vector3(3, 3.5, 3)));
    inst(bulb, mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.3, 1.2) }), false), where);
  }

  return {
    group,
    dispose() {
      for (const g of own.geo) g.dispose();
      for (const m of own.mat) m.dispose();
    },
  };
}
