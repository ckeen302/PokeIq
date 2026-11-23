import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Landmark } from "@/lib/sizes/world";

/**
 * The great Ferris wheel, our own design in the spirit of Nimbasa City's
 * landmark: a white steel wheel of twin rims joined by a lattice truss,
 * tension spokes from a glowing hub, carried on two pairs of raking A-frame
 * legs over a round boarding terminal. Round gondolas in bright colours hang
 * from the rim and stay level as it turns (slowly: one turn in about five
 * minutes). At night strings of bulbs along both rims and every spoke chase
 * colour round the wheel and pulse out from the hub. It stands at the centre
 * of the great plaza, where Prism Tower stands in Lumiose.
 */

/** The wheel's radius (to the rim), its hub's height and the rims' spacing along the axle (m). */
export const WHEEL_R = 84;
export const HUB_Y = 98;
const RIM_GAP = 12;
const GONDOLAS = 36;
/** For the finale's framing: the top of the wheel and its half-width face on. */
export const WHEEL: Landmark = { h: HUB_Y + WHEEL_R + 6, half: WHEEL_R + 6 };

const GONDOLA_COLOURS = ["#ff4f9a", "#37c8ff", "#ffd23a", "#8a63ff", "#ff7a2f", "#43e39a"].map((c) => new THREE.Color(c));

export interface Wheel {
  group: THREE.Group;
  tick(t: number): void;
  dispose(): void;
}

/** A cylinder from a to b (radius r, n sides), non-indexed with uv, for merging. */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, n = 6): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, n, 1, true);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  g.translate(a.x, a.y, a.z);
  return g.toNonIndexed();
}

/** Keeps position, normal and uv only (so differently made geometries merge). */
const bare = (g: THREE.BufferGeometry) => {
  const q = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(q.attributes)) if (k !== "position" && k !== "normal" && k !== "uv") q.deleteAttribute(k);
  if (!q.attributes.uv) q.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2));
  return q;
};

/** Bulbs whose colour chases round the wheel (aK: share of the way round, aR: share of the way out from the hub). */
function bulbMaterial(time: { value: number }): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: true, fog: true });
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = time;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nattribute float aK;\nattribute float aR;\nvarying vec3 vBulb;\nvec3 hsv(float h){ vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); return k * k * (3.0 - 2.0 * k); }")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        // Colour chases round the rim; spokes pulse outwards from the hub in the same colour.
        float hue = fract(aK * 2.0 - uTime * 0.05);
        float pulse = aR < 0.99 ? 0.45 + 0.55 * smoothstep(0.55, 1.0, sin(aR * 9.0 - uTime * 2.6) * 0.5 + 0.5) : 0.8 + 0.2 * sin(aK * 120.0 - uTime * 4.0);
        vBulb = mix(vec3(1.0, 0.92, 0.8), hsv(hue), 0.82) * pulse * 3.4;`
      );
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vBulb;")
      .replace("#include <opaque_fragment>", "outgoingLight = vBulb;\n#include <opaque_fragment>");
  };
  m.customProgramCacheKey = () => "nimbasa-wheel-bulbs";
  return m;
}

export function buildWheel(x: number, z: number, faceYaw: number, detail: number): Wheel {
  const group = new THREE.Group();
  group.name = "ferris-wheel";
  group.position.set(x, 0, z);
  // The wheel's face (its local +z) turns to faceYaw (radians, 0 faces +z).
  group.rotation.y = faceYaw;
  const geos: THREE.BufferGeometry[] = [];
  const steel = new THREE.MeshStandardMaterial({ color: "#eef0f6", roughness: 0.35, metalness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: "#3a3f52", roughness: 0.5, metalness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: "#2b3350", roughness: 0.1, metalness: 0.3, emissive: "#ffd9a0", emissiveIntensity: 1.1 });
  const terminal = new THREE.MeshStandardMaterial({ color: "#f3e9ee", roughness: 0.6, metalness: 0.05 });
  const add = (parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, cast = true) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    parent.add(mesh);
    geos.push(g);
    return mesh;
  };

  // ---- The rotor: rims, truss, spokes and the hub, turning about the axle (local z, at the hub's height).
  const rotor = new THREE.Group();
  rotor.position.y = HUB_Y;
  group.add(rotor);
  const segs = 96;
  const rimIn = WHEEL_R - 4.2;
  {
    const parts: THREE.BufferGeometry[] = [];
    for (const zz of [-RIM_GAP / 2, RIM_GAP / 2]) {
      parts.push(bare(new THREE.TorusGeometry(WHEEL_R, 0.85, 6, segs * 2).translate(0, 0, zz)));
      parts.push(bare(new THREE.TorusGeometry(rimIn, 0.55, 6, segs * 2).translate(0, 0, zz)));
      // The lattice between the outer and inner rim: a zig-zag all round.
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
        const p = (r: number, a: number) => new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, zz);
        parts.push(rod(p(WHEEL_R, a0), p(rimIn, (a0 + a1) / 2), 0.28, 4));
        parts.push(rod(p(rimIn, (a0 + a1) / 2), p(WHEEL_R, a1), 0.28, 4));
      }
    }
    // Cross beams between the rims, one at every gondola.
    for (let i = 0; i < GONDOLAS; i++) {
      const a = (i / GONDOLAS) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      parts.push(rod(new THREE.Vector3(c * WHEEL_R, s * WHEEL_R, -RIM_GAP / 2 - 1), new THREE.Vector3(c * WHEEL_R, s * WHEEL_R, RIM_GAP / 2 + 1), 0.5, 6));
      parts.push(rod(new THREE.Vector3(c * rimIn, s * rimIn, -RIM_GAP / 2), new THREE.Vector3(c * rimIn, s * rimIn, RIM_GAP / 2), 0.35, 4));
    }
    add(rotor, mergeGeometries(parts), steel);
  }
  {
    // Tension spokes: from each end of the hub to the far rim's side (crossing, as on real wheels), a few sturdier ones.
    const parts: THREE.BufferGeometry[] = [];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      for (const side of [-1, 1]) {
        const hub = new THREE.Vector3(Math.cos(a) * 3.4, Math.sin(a) * 3.4, side * 4.6);
        const rim = new THREE.Vector3(Math.cos(a + side * 0.02) * rimIn, Math.sin(a + side * 0.02) * rimIn, -side * RIM_GAP / 2);
        parts.push(rod(hub, rim, i % 4 === 0 ? 0.32 : 0.16, 4));
      }
    }
    add(rotor, mergeGeometries(parts), steel);
  }
  {
    const hub = new THREE.CylinderGeometry(4.2, 4.2, RIM_GAP + 2, 24).rotateX(Math.PI / 2);
    const caps = [-1, 1].map((s) => new THREE.CylinderGeometry(5.6, 5.6, 0.8, 32).rotateX(Math.PI / 2).translate(0, 0, s * (RIM_GAP / 2 + 1.4)));
    add(rotor, mergeGeometries([bare(hub), ...caps.map(bare)]), dark);
  }
  // The hub's face: a glowing star on each side.
  const hubGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffe27a").multiplyScalar(3), toneMapped: true });
  {
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 2.4 : 5.2;
      if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const star = new THREE.ShapeGeometry(shape);
    const a = star.clone().translate(0, 0, RIM_GAP / 2 + 1.85);
    const b = star.clone().rotateY(Math.PI).translate(0, 0, -RIM_GAP / 2 - 1.85);
    add(rotor, mergeGeometries([bare(a), bare(b)]), hubGlow, false);
    star.dispose();
  }

  // ---- Bulbs on both rims and every fourth spoke.
  const time = { value: 0 };
  const bulbMat = bulbMaterial(time);
  const rimBulbs = Math.round(240 * Math.max(0.5, detail));
  const pts: { p: THREE.Vector3; k: number; r: number }[] = [];
  for (const zz of [-RIM_GAP / 2 - 0.9, RIM_GAP / 2 + 0.9]) {
    for (let i = 0; i < rimBulbs; i++) {
      const a = (i / rimBulbs) * Math.PI * 2;
      pts.push({ p: new THREE.Vector3(Math.cos(a) * (WHEEL_R + 0.2), Math.sin(a) * (WHEEL_R + 0.2), zz), k: i / rimBulbs, r: 1 });
    }
  }
  for (let i = 0; i < 48; i += 2) {
    const a = (i / 48) * Math.PI * 2;
    for (const side of [-1, 1]) {
      const hub = new THREE.Vector3(Math.cos(a) * 3.4, Math.sin(a) * 3.4, side * 4.6);
      const rim = new THREE.Vector3(Math.cos(a + side * 0.02) * rimIn, Math.sin(a + side * 0.02) * rimIn, -side * RIM_GAP / 2);
      const n = detail >= 0.7 ? 14 : 8;
      for (let k = 1; k <= n; k++) pts.push({ p: hub.clone().lerp(rim, k / (n + 1)), k: i / 48, r: k / (n + 1) * 0.98 });
    }
  }
  const bulbGeo = new THREE.SphereGeometry(0.62, 6, 4);
  const aK = new Float32Array(pts.length), aR = new Float32Array(pts.length);
  pts.forEach((b, i) => { aK[i] = b.k; aR[i] = b.r; });
  bulbGeo.setAttribute("aK", new THREE.InstancedBufferAttribute(aK, 1));
  bulbGeo.setAttribute("aR", new THREE.InstancedBufferAttribute(aR, 1));
  geos.push(bulbGeo);
  const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, pts.length);
  const m4 = new THREE.Matrix4();
  pts.forEach((b, i) => bulbs.setMatrixAt(i, m4.makeTranslation(b.p.x, b.p.y, b.p.z)));
  bulbs.computeBoundingSphere();
  rotor.add(bulbs);

  // ---- Gondolas: round cabins with a lit window band, hanging level from the cross beams.
  const cabinGeo = new THREE.SphereGeometry(2.6, 14, 10).scale(1, 1.08, 1.15);
  const bandGeo = new THREE.CylinderGeometry(2.72, 2.72, 1.2, 14, 1, true).scale(1, 1, 1.15);
  const hangerGeo = new THREE.CylinderGeometry(0.22, 0.22, 2.4, 5);
  geos.push(cabinGeo, bandGeo, hangerGeo);
  const cabinMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.32, metalness: 0.1 });
  const cabins = new THREE.InstancedMesh(cabinGeo, cabinMat, GONDOLAS);
  const bands = new THREE.InstancedMesh(bandGeo, glass, GONDOLAS);
  const hangers = new THREE.InstancedMesh(hangerGeo, dark, GONDOLAS);
  for (let i = 0; i < GONDOLAS; i++) cabins.setColorAt(i, GONDOLA_COLOURS[i % GONDOLA_COLOURS.length]);
  for (const im of [cabins, bands, hangers]) { im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; group.add(im); }
  bands.castShadow = false;

  // ---- Legs: two A-frames, one each side of the wheel, raking out to the ground, with a cross tie.
  {
    const parts: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      const top = new THREE.Vector3(0, HUB_Y, side * (RIM_GAP / 2 + 3.2));
      for (const sx of [-1, 1]) {
        const foot = new THREE.Vector3(sx * 34, 0, side * (RIM_GAP / 2 + 16));
        parts.push(bare(new THREE.CylinderGeometry(1.0, 1.9, top.distanceTo(foot), 10).translate(0, top.distanceTo(foot) / 2, 0).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(foot).normalize())).translate(foot.x, foot.y, foot.z)));
      }
      for (const f of [0.34, 0.62]) {
        const y = HUB_Y * f, w = 34 * (1 - f) + 1;
        const zz = side * (RIM_GAP / 2 + 3.2 + 12.8 * (1 - f));
        parts.push(rod(new THREE.Vector3(-w, y, zz), new THREE.Vector3(w, y, zz), 0.7, 6));
      }
    }
    // The axle's bearing housings and a tie across the top.
    parts.push(rod(new THREE.Vector3(0, HUB_Y, -RIM_GAP / 2 - 4.5), new THREE.Vector3(0, HUB_Y, RIM_GAP / 2 + 4.5), 1.6, 12));
    add(group, mergeGeometries(parts), steel);
  }

  // ---- The terminal under the wheel: a round pavilion with a lit canopy and glass walls, on a stepped plinth.
  const canopyGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ff6fb5").multiplyScalar(2.2), toneMapped: true });
  {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(bare(new THREE.CylinderGeometry(44, 45, 0.6, 72).translate(0, 0.3, 0)));
    parts.push(bare(new THREE.CylinderGeometry(40, 41, 0.6, 72).translate(0, 0.9, 0)));
    // The loading deck under the lowest gondola.
    parts.push(bare(new THREE.BoxGeometry(18, 2.4, RIM_GAP + 14).translate(0, HUB_Y - WHEEL_R - 6.6, 0)));
    add(group, mergeGeometries(parts), terminal);
    const pav = mergeGeometries([bare(new THREE.CylinderGeometry(16, 16, 6.5, 40, 1, true).translate(-30, 4.45, 0)), bare(new THREE.CylinderGeometry(16, 16, 6.5, 40, 1, true).translate(30, 4.45, 0))]);
    add(group, pav, glass);
    const roofs = mergeGeometries([bare(new THREE.CylinderGeometry(18.5, 18.5, 1.2, 40).translate(-30, 8.3, 0)), bare(new THREE.CylinderGeometry(18.5, 18.5, 1.2, 40).translate(30, 8.3, 0))]);
    add(group, roofs, terminal);
    const rims = mergeGeometries([bare(new THREE.TorusGeometry(18.6, 0.35, 4, 48).rotateX(Math.PI / 2).translate(-30, 8.3, 0)), bare(new THREE.TorusGeometry(18.6, 0.35, 4, 48).rotateX(Math.PI / 2).translate(30, 8.3, 0))]);
    add(group, rims, canopyGlow, false);
  }

  group.traverse((o) => { o.matrixAutoUpdate = o === rotor || o === group; });
  group.updateMatrixWorld(true);
  const q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), at = new THREE.Vector3(), hang = new THREE.Vector3();
  const place = (angle: number) => {
    for (let i = 0; i < GONDOLAS; i++) {
      const a = angle + (i / GONDOLAS) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      // Hung from the beam on the outer rim: cabin below it, upright whatever the wheel's angle.
      at.set(c * WHEEL_R, HUB_Y + s * WHEEL_R - 4.2, 0);
      cabins.setMatrixAt(i, m4.compose(at, q, one));
      bands.setMatrixAt(i, m4.compose(hang.copy(at).setY(at.y + 0.5), q, one));
      hangers.setMatrixAt(i, m4.compose(hang.copy(at).setY(at.y + 3.0), q, one));
    }
    cabins.instanceMatrix.needsUpdate = bands.instanceMatrix.needsUpdate = hangers.instanceMatrix.needsUpdate = true;
  };
  place(0);
  let lastAngle = 0;
  return {
    group,
    tick(t) {
      time.value = t;
      // One turn in about five minutes.
      const angle = t * ((Math.PI * 2) / 300);
      if (Math.abs(angle - lastAngle) < 1e-5) return;
      lastAngle = angle;
      rotor.rotation.z = angle;
      place(angle);
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of [steel, dark, glass, terminal, hubGlow, bulbMat, cabinMat, canopyGlow]) m.dispose();
      cabins.dispose();
      bands.dispose();
      hangers.dispose();
      bulbs.dispose();
    },
  };
}
