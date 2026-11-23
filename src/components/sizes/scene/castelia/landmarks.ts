import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { rng, type CasteliaPlan } from "@/lib/sizes/castelia";

/**
 * Castelia's landmarks, our own designs: the fountain at the heart of
 * Central Plaza (three basins, a tall lit jet and a ring of smaller ones),
 * the waterfront's five piers with their sheds and a moored ferry, Liberty
 * Garden (a wooded island offshore with a lighthouse whose beam sweeps the
 * bay) and the Skyarrow Bridge, a long cable-stayed span on two tall
 * pylons, lit along its deck, reaching out over the water. Each is a few
 * merged meshes.
 */

export interface Landmarks {
  group: THREE.Group;
  tick(t: number): void;
  dispose(): void;
}

/** Merges a list of geometries (with their transforms applied) into one. */
function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clean = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of clean) { g.deleteAttribute("uv"); if (!g.attributes.normal) g.computeVertexNormals(); }
  const out = mergeGeometries(clean, false)!;
  for (const g of [...parts, ...clean]) g.dispose();
  return out;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, yaw = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateY(yaw);
  g.translate(x, y + h / 2, z);
  return g;
};

/** A thin box from a to b (a cable, a rail), `r` thick. */
function beam(a: THREE.Vector3, b: THREE.Vector3, r: number): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(r, r, len);
  const vertical = Math.abs(b.y - a.y) > 0.9 * len;
  const m = new THREE.Matrix4().lookAt(a, b, vertical ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0));
  g.applyMatrix4(m);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

export function buildLandmarks(cp: CasteliaPlan, quality: { detail: number }): Landmarks {
  const group = new THREE.Group();
  group.name = "castelia-landmarks";
  const mats: THREE.Material[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const mat = <M extends THREE.Material>(m: M) => { mats.push(m); return m; };
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, cast = true) => {
    const o = new THREE.Mesh(g, m);
    o.castShadow = cast;
    o.receiveShadow = true;
    geos.push(g);
    group.add(o);
    return o;
  };
  const stone = mat(new THREE.MeshStandardMaterial({ color: "#d9d2c6", roughness: 0.75 }));
  const concrete = mat(new THREE.MeshStandardMaterial({ color: "#9b9890", roughness: 0.9 }));
  const steel = mat(new THREE.MeshStandardMaterial({ color: "#c9ced6", roughness: 0.4, metalness: 0.6 }));
  const white = mat(new THREE.MeshStandardMaterial({ color: "#eeeae2", roughness: 0.6 }));
  const lamp = mat(new THREE.MeshStandardMaterial({ color: "#000000", emissive: new THREE.Color("#ffd9a0"), emissiveIntensity: 2.6 }));
  const cable = mat(new THREE.MeshStandardMaterial({ color: "#e8ecf2", roughness: 0.5, metalness: 0.3, emissive: new THREE.Color("#6f7fa8"), emissiveIntensity: 0.35 }));
  const ticks: ((t: number) => void)[] = [];

  // ---- The fountain at the centre of Central Plaza.
  {
    const { x, z } = cp.centre;
    const basin = (r: number, h: number, y: number) => {
      const pts = [new THREE.Vector2(r - 1.2, 0), new THREE.Vector2(r, 0), new THREE.Vector2(r + 0.25, h * 0.9), new THREE.Vector2(r, h), new THREE.Vector2(r - 1.0, h), new THREE.Vector2(r - 1.1, h * 0.4)];
      const g = new THREE.LatheGeometry(pts, 64);
      g.translate(x, y, z);
      return g;
    };
    const parts: THREE.BufferGeometry[] = [basin(19, 0.9, 0), basin(9, 0.7, 2.4), basin(4, 0.6, 5.2)];
    // Pedestals between the basins.
    const ped = (r0: number, r1: number, y0: number, y1: number) => { const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, 24); g.translate(x, (y0 + y1) / 2, z); return g; };
    parts.push(ped(3.4, 2.2, 0, 2.4), ped(1.6, 1.1, 2.4, 5.2), ped(0.9, 0.6, 5.2, 6.4));
    mesh(merged(parts), stone);
    // Water in the basins: lit from below.
    const waterM = mat(new THREE.MeshStandardMaterial({ color: "#1f4a66", roughness: 0.1, metalness: 0.3, emissive: new THREE.Color("#2fa6d6"), emissiveIntensity: 0.55 }));
    const pool = (r: number, y: number) => { const g = new THREE.CircleGeometry(r, 48).rotateX(-Math.PI / 2); g.translate(x, y, z); return g; };
    mesh(merged([pool(18, 0.72), pool(8.2, 2.95), pool(3.2, 5.65)]), waterM, false);
    // The jets: soft additive columns that breathe.
    const jetM = mat(new THREE.MeshBasicMaterial({ color: new THREE.Color("#cfefff"), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }));
    const jetG = new THREE.CylinderGeometry(0.25, 1.1, 1, 16, 1, true);
    jetG.translate(0, 0.5, 0);
    geos.push(jetG);
    const main = new THREE.Mesh(jetG, jetM);
    main.position.set(x, 6.2, z);
    main.scale.set(1, 22, 1);
    group.add(main);
    const ring: THREE.Mesh[] = [];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const j = new THREE.Mesh(jetG, jetM);
      j.position.set(x + Math.cos(a) * 14, 0.7, z + Math.sin(a) * 14);
      j.scale.set(0.45, 6, 0.45);
      j.rotation.z = Math.cos(a) * 0.35;
      j.rotation.x = -Math.sin(a) * 0.35;
      group.add(j);
      ring.push(j);
    }
    ticks.push((t) => {
      main.scale.y = 22 + Math.sin(t * 0.9) * 2.5;
      ring.forEach((j, k) => { j.scale.y = 5.5 + Math.sin(t * 1.7 + k * 0.8) * 1.2; });
    });
  }

  // ---- Piers, sheds and a ferry.
  {
    const deck: THREE.BufferGeometry[] = [];
    const piles: THREE.BufferGeometry[] = [];
    const sheds: THREE.BufferGeometry[] = [];
    const lamps: THREE.BufferGeometry[] = [];
    const poles: THREE.BufferGeometry[] = [];
    // Each pier is built along local +x (from the quay out to sea), then turned and moved into place.
    const place = (g: THREE.BufferGeometry, p: CasteliaPlan["piers"][number]) => { g.rotateY(-p.dir); g.translate(p.x, 0, p.z); return g; };
    for (const p of cp.piers) {
      const len = p.len;
      deck.push(place(box(len, 1.0, p.w, len / 2, -0.8, 0), p));
      for (let x = 4; x < len; x += 12) for (const s of [-1, 1]) { const g = new THREE.CylinderGeometry(0.5, 0.5, 4, 6); g.translate(x, -2.2, s * (p.w / 2 - 1.2)); piles.push(place(g, p)); }
      if (p.sheds) {
        const sl = Math.min(110, len * 0.55);
        const sx = len * 0.45;
        sheds.push(place(box(sl, 9, p.w - 7, sx, 0.2, 0), p));
        // A shallow pitched roof.
        const roof = new THREE.CylinderGeometry(1, 1, sl, 3, 1);
        roof.rotateZ(Math.PI / 2);
        roof.rotateX(Math.PI / 2);
        roof.scale(1, 1.6 / 1.5, (p.w - 6) / 1.7);
        roof.translate(sx, 9.6, 0);
        sheds.push(place(roof, p));
      }
      for (let x = 8; x < len - 4; x += 26) for (const s of [-1, 1]) {
        const zz = s * (p.w / 2 - 0.8);
        poles.push(place(box(0.22, 6, 0.22, x, 0.2, zz), p));
        lamps.push(place(box(0.6, 0.4, 0.6, x, 6.1, zz), p));
      }
    }
    mesh(merged(deck), concrete);
    mesh(merged(piles), concrete, false);
    if (sheds.length) mesh(merged(sheds), mat(new THREE.MeshStandardMaterial({ color: "#7f8f98", roughness: 0.7, metalness: 0.2 })));
    mesh(merged(poles), steel, false);
    mesh(merged(lamps), lamp, false);
    // The Liberty Garden ferry at the long pier.
    const pier = cp.piers.find((p) => !p.sheds) ?? cp.piers[0];
    const hullShape = new THREE.Shape();
    hullShape.moveTo(-24, -5);
    hullShape.lineTo(18, -5);
    hullShape.quadraticCurveTo(30, -3, 32, 0);
    hullShape.quadraticCurveTo(30, 3, 18, 5);
    hullShape.lineTo(-24, 5);
    hullShape.lineTo(-24, -5);
    const hull = new THREE.ExtrudeGeometry(hullShape, { depth: 5, bevelEnabled: false });
    hull.rotateX(-Math.PI / 2);
    hull.translate(0, -2.2, 0);
    // Moored along the long pier, bow out to sea.
    const fx = pier.len * 0.55, fz = pier.w / 2 + 8;
    hull.translate(fx, 0, fz);
    const hullM = mat(new THREE.MeshStandardMaterial({ color: "#e9edf2", roughness: 0.5 }));
    mesh(place(hull, pier), hullM);
    mesh(place(merged([box(30, 4.2, 8, fx + 2, 2.8, fz), box(18, 3.4, 7, fx + 4, 7, fz)]), pier), white);
    // Its lit windows: a band on each deck.
    mesh(place(merged([box(28, 1.2, 8.15, fx + 2, 4.3, fz), box(16, 1.1, 7.15, fx + 4, 8.2, fz)]), pier), lamp, false);
    const stripe = mat(new THREE.MeshStandardMaterial({ color: "#1d5fa8", roughness: 0.5 }));
    mesh(place(box(52, 0.8, 10.1, fx - 2, 1.2, fz), pier), stripe, false);
  }

  // ---- Liberty Garden: a wooded island with its lighthouse.
  {
    const { x, z, r } = cp.island;
    const rr = rng(4242);
    const rock = new THREE.CylinderGeometry(r * 0.96, r * 1.06, 5, 40, 1);
    rock.translate(x, -1.5, z);
    const rockM = mat(new THREE.MeshStandardMaterial({ color: "#6d6458", roughness: 0.95 }));
    mesh(rock, rockM);
    const lawn = new THREE.CircleGeometry(r * 0.94, 40).rotateX(-Math.PI / 2);
    lawn.translate(x, 1.02, z);
    mesh(lawn, mat(new THREE.MeshStandardMaterial({ color: "#3f5a3a", roughness: 1 })), false);
    const trees: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 46; k++) {
      const a = rr() * Math.PI * 2, d = Math.sqrt(rr()) * r * 0.82;
      const tx = x + Math.cos(a) * d, tz = z + Math.sin(a) * d;
      if (Math.hypot(tx - x - r * 0.25, tz - z) < 16) continue;
      const s = 4 + rr() * 3;
      const g = new THREE.IcosahedronGeometry(s, 0);
      g.scale(1, 1.3, 1);
      g.translate(tx, 1 + s * 1.2, tz);
      trees.push(g);
    }
    mesh(merged(trees), mat(new THREE.MeshStandardMaterial({ color: "#2f4a33", roughness: 1, flatShading: true })));
    // The lighthouse: a white tapering tower with red bands, the lantern room lit, a beam that sweeps the bay.
    const lx = x + r * 0.25, lz = z;
    const H = 42;
    const towerG = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(6, 0), new THREE.Vector2(4.2, H), new THREE.Vector2(0, H)], 24);
    towerG.translate(lx, 1, lz);
    const colors: number[] = [];
    const pos = towerG.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) - 1;
      const red = y > H * 0.3 && y < H * 0.42 || y > H * 0.7 && y < H * 0.82;
      const c = red ? new THREE.Color("#c4362c") : new THREE.Color("#f2efe8");
      colors.push(c.r, c.g, c.b);
    }
    towerG.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    mesh(towerG, mat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })));
    const gallery = new THREE.CylinderGeometry(5.6, 5.6, 0.8, 24);
    gallery.translate(lx, 1 + H + 0.4, lz);
    const roofG = new THREE.ConeGeometry(4.4, 4, 24);
    roofG.translate(lx, 1 + H + 6.6, lz);
    mesh(merged([gallery, roofG]), mat(new THREE.MeshStandardMaterial({ color: "#2b2f33", roughness: 0.5, metalness: 0.4 })));
    const lantern = new THREE.CylinderGeometry(3.4, 3.4, 4, 16);
    lantern.translate(lx, 1 + H + 2.8, lz);
    mesh(lantern, mat(new THREE.MeshStandardMaterial({ color: "#000000", emissive: new THREE.Color("#fff1c8"), emissiveIntensity: 4 })), false);
    const beamM = mat(new THREE.MeshBasicMaterial({ color: new THREE.Color("#fff3d0"), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    const beamG = new THREE.ConeGeometry(28, 420, 24, 1, true);
    beamG.translate(0, -210, 0);
    beamG.rotateZ(Math.PI / 2);
    geos.push(beamG);
    const beamPivot = new THREE.Group();
    beamPivot.position.set(lx, 1 + H + 2.8, lz);
    for (const s of [0, Math.PI]) {
      const b = new THREE.Mesh(beamG, beamM);
      b.rotation.y = s;
      b.rotation.z = -0.02;
      beamPivot.add(b);
    }
    group.add(beamPivot);
    ticks.push((t) => { beamPivot.rotation.y = t * 0.55; });
  }

  // ---- The Skyarrow Bridge.
  {
    const b = cp.bridge;
    const dir = new THREE.Vector3(b.x1 - b.x0, 0, b.z1 - b.z0);
    const len = dir.length();
    dir.normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const at = (s: number, off = 0, y = 0) => new THREE.Vector3(b.x0 + dir.x * s + side.x * off, y, b.z0 + dir.z * s + side.z * off);
    const yaw = Math.atan2(dir.x, dir.z);
    // The deck rises from the shore to its full height, runs level across the main spans and comes down far out.
    const ramp = 300;
    const deckY = (s: number) => s < ramp ? 12 + (b.deck - 12) * smooth(s / ramp) : s > len - ramp ? 12 + (b.deck - 12) * smooth((len - s) / ramp) : b.deck;
    const deck: THREE.BufferGeometry[] = [];
    const piers: THREE.BufferGeometry[] = [];
    const rails: THREE.BufferGeometry[] = [];
    const lights: THREE.BufferGeometry[] = [];
    const step = 40;
    const pyl = b.pylons.map((f) => f * len);
    for (let s = 0; s < len; s += step) {
      const a = at(s, 0, deckY(s)), c = at(s + step, 0, deckY(s + step));
      const g = new THREE.BoxGeometry(b.width, 2.6, a.distanceTo(c) + 0.3);
      const m = new THREE.Matrix4().lookAt(a, c, new THREE.Vector3(0, 1, 0));
      g.applyMatrix4(m);
      g.translate((a.x + c.x) / 2, (a.y + c.y) / 2 - 1.3, (a.z + c.z) / 2);
      deck.push(g);
      // Piers under the approaches (the main spans between and beside the pylons hang from the cables).
      const free = pyl.some((p) => Math.abs(s - p) < 360);
      if (!free && s % 120 < step) piers.push(box(6, deckY(s) + 2, 10, a.x, -2, a.z, yaw));
      for (const o of [-1, 1]) {
        const ra = at(s, o * (b.width / 2 - 0.4), deckY(s) + 0.8), rc = at(s + step, o * (b.width / 2 - 0.4), deckY(s + step) + 0.8);
        rails.push(beam(ra, rc, 0.5));
        if (s % 80 < step) lights.push(box(0.8, 0.5, 0.8, ra.x, ra.y + 2.6, ra.z));
      }
    }
    mesh(merged(deck), concrete);
    if (piers.length) mesh(merged(piers), concrete);
    mesh(merged(rails), steel, false);
    mesh(merged(lights), lamp, false);
    // Two pylons, each an inverted Y, with fans of cables to both sides.
    const pylons: THREE.BufferGeometry[] = [];
    const cables: THREE.BufferGeometry[] = [];
    const beacons: THREE.BufferGeometry[] = [];
    const ph = 210;
    for (const s of pyl) {
      const y0 = -2, dy = deckY(s);
      const foot = (o: number) => at(s, o * (b.width / 2 + 4), y0);
      const knee = at(s, 0, dy + 48);
      const top = at(s, 0, ph);
      for (const o of [-1, 1]) pylons.push(beam(foot(o), knee, 5));
      pylons.push(beam(knee, top, 5.5));
      pylons.push(box(b.width + 12, 3, 7, at(s, 0, 0).x, dy - 3, at(s, 0, 0).z, yaw));
      beacons.push(box(1.6, 1.6, 1.6, top.x, top.y, top.z));
      const n = quality.detail < 0.6 ? 8 : 13;
      for (const dirS of [-1, 1]) for (let k = 1; k <= n; k++) {
        const ds = dirS * (k / n) * 330;
        const anchorY = ph - 4 - k * 3.2;
        for (const o of [-1, 1]) {
          const from = at(s, 0, anchorY);
          const to = at(s + ds, o * (b.width / 2 - 1), deckY(s + ds) + 0.3);
          cables.push(beam(from, to, 0.35));
        }
      }
    }
    mesh(merged(pylons), mat(new THREE.MeshStandardMaterial({ color: "#d6d3cc", roughness: 0.6 })));
    mesh(merged(cables), cable, false);
    mesh(merged(beacons), mat(new THREE.MeshStandardMaterial({ color: "#000000", emissive: new THREE.Color("#ff2a10"), emissiveIntensity: 4 })), false);
    // The abutment where it leaves the shore.
    mesh(box(40, 14, 40, b.x0 + 6, -2, b.z0, yaw), concrete);
  }

  return {
    group,
    tick(t) { for (const f of ticks) f(t); },
    dispose() {
      group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}

const smooth = (f: number) => { const k = Math.max(0, Math.min(1, f)); return k * k * (3 - 2 * k); };
