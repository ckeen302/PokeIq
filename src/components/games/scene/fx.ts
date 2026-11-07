import * as THREE from "three";
import { LAYER } from "@/components/race/scene/stadium";
import { puffTexture, streakTexture } from "@/components/race/scene/textures";

/**
 * The Games' effects: particles (sand sprays, chalk and dust puffs, water
 * splashes and spray), confetti, decals on the ground (footprints, divots,
 * slide marks) and flight trails. All instanced, all deterministic on the
 * show clock (spawned with their birth time, so a replay or a seek redraws
 * them exactly), billboarded towards the camera.
 */

export interface Particles {
  mesh: THREE.InstancedMesh;
  /** A particle born at show time t0: position, velocity (m/s), size (m), lifetime (s), colour. */
  spawn(t0: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, color?: THREE.ColorRepresentation, rate?: number): void;
  /** Forgets every particle (a cut, a replay). */
  clear(): void;
  update(t: number, cam: THREE.Camera): void;
  dispose(): void;
}

export function makeParticles(n: number, o: { color: THREE.ColorRepresentation; gravity: number; drag: number; additive?: boolean; grow?: number; opacity?: number; floor?: number }): Particles {
  const tex = puffTexture();
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: 0xffffff, opacity: o.opacity ?? 1, blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  mesh.frustumCulled = false;
  mesh.layers.set(LAYER.MAIN);
  mesh.renderOrder = 5;
  const base = new THREE.Color(o.color);
  type P = { t0: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; size: number; life: number; rate: number };
  const ps: P[] = Array.from({ length: n }, () => ({ t0: -1e9, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0, life: 1, rate: 1 }));
  let next = 0;
  const q = new THREE.Quaternion(), m = new THREE.Matrix4(), v = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
  const k = o.drag;
  const floor = o.floor ?? -1e9;
  return {
    mesh,
    spawn(t0, x, y, z, vx, vy, vz, size, life, color, rate = 1) {
      ps[next] = { t0, x, y, z, vx, vy, vz, size, life, rate };
      c.set(color ?? base);
      mesh.instanceColor!.setXYZ(next, c.r, c.g, c.b);
      mesh.instanceColor!.needsUpdate = true;
      next = (next + 1) % n;
    },
    clear() { for (const p of ps) p.t0 = -1e9; },
    update(t, cam) {
      cam.getWorldQuaternion(q);
      for (let i = 0; i < n; i++) {
        const p = ps[i];
        const age = (t - p.t0) * p.rate;
        if (age < 0 || age > p.life) { s.setScalar(0); m.compose(v.set(0, -999, 0), q, s); mesh.setMatrixAt(i, m); continue; }
        // Linear drag: x(t) = x0 + v0 (1 − e^(−kt))/k, with gravity's terminal part.
        const e = Math.exp(-k * age);
        const d = (1 - e) / k;
        const gT = o.gravity / k;
        const y = Math.max(floor, p.y + p.vy * d - gT * (age - d));
        v.set(p.x + p.vx * d, y, p.z + p.vz * d);
        const life = age / p.life;
        s.setScalar(p.size * (1 + (o.grow ?? 0.8) * life) * (1 - Math.pow(life, 3)));
        m.compose(v, q, s);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() { tex.dispose(); geo.dispose(); mat.dispose(); },
  };
}

/** Confetti: small paper squares tumbling down through the air, coloured. */
export function makeConfetti(n: number): { mesh: THREE.InstancedMesh; burst(t0: number, x: number, y: number, z: number, spread: number, seed: number): void; clear(): void; update(t: number): void; dispose(): void } {
  const geo = new THREE.PlaneGeometry(0.05, 0.035);
  const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.6, metalness: 0.2, emissive: new THREE.Color(0.25, 0.25, 0.25) });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  mesh.frustumCulled = false;
  mesh.layers.set(LAYER.MAIN);
  const palette = ["#ffd84a", "#ff4d6d", "#3bceac", "#3a86ff", "#ffffff", "#f77f00", "#c77dff"].map((h) => new THREE.Color(h));
  type C = { t0: number; x: number; y: number; z: number; vx: number; vz: number; ax: number; az: number; spin: number; phase: number; fall: number };
  const cs: C[] = Array.from({ length: n }, () => ({ t0: -1e9, x: 0, y: 0, z: 0, vx: 0, vz: 0, ax: 0, az: 0, spin: 0, phase: 0, fall: 1 }));
  let next = 0;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  return {
    mesh,
    burst(t0, x, y, z, spread, seed) {
      let r = seed * 9301 + 49297;
      const rnd = () => { r = (r * 9301 + 49297) % 233280; return r / 233280; };
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * spread;
        cs[next] = { t0: t0 + rnd() * 0.6, x: x + Math.cos(a) * d, y: y + rnd() * spread * 0.4, z: z + Math.sin(a) * d, vx: (rnd() - 0.5) * 0.6, vz: (rnd() - 0.5) * 0.6, ax: rnd() * 6, az: rnd() * 6, spin: 3 + rnd() * 6, phase: rnd() * 6.28, fall: 0.35 + rnd() * 0.35 };
        const c = palette[Math.floor(rnd() * palette.length)];
        mesh.instanceColor!.setXYZ(next, c.r, c.g, c.b);
        next = (next + 1) % n;
      }
      mesh.instanceColor!.needsUpdate = true;
    },
    clear() { for (const c of cs) c.t0 = -1e9; },
    update(t) {
      for (let i = 0; i < n; i++) {
        const c = cs[i];
        const age = t - c.t0;
        if (age < 0 || age > 14) { m.makeScale(0, 0, 0); mesh.setMatrixAt(i, m); continue; }
        // Paper flutters: it falls slowly and sways side to side as it tumbles.
        const y = Math.max(0.01, c.y - c.fall * age);
        v.set(c.x + c.vx * age + 0.25 * Math.sin(age * 2.3 + c.phase), y, c.z + c.vz * age + 0.25 * Math.cos(age * 1.9 + c.phase));
        e.set(c.ax + age * c.spin, c.az + age * c.spin * 0.7, age * 1.3);
        q.setFromEuler(e);
        const k = y <= 0.011 ? 0.9 : 1;
        s.set(k, k, k);
        m.compose(v, q, s);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

/** Marks on the ground (footprints in sand, divots, slide marks): textured quads lying flat, each with a fade-in time. */
export function makeDecals(n: number, texture: THREE.Texture, color: THREE.ColorRepresentation, opacity = 0.85): { mesh: THREE.InstancedMesh; place(i: number, t0: number, x: number, y: number, z: number, w: number, l: number, angle: number): void; clear(): void; update(t: number): void; dispose(): void } {
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, color, opacity, polygonOffset: true, polygonOffsetFactor: -4 });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.frustumCulled = false;
  mesh.layers.set(LAYER.MAIN);
  mesh.renderOrder = 3;
  const items: { t0: number; x: number; y: number; z: number; w: number; l: number; angle: number }[] = Array.from({ length: n }, () => ({ t0: 1e9, x: 0, y: 0, z: 0, w: 0, l: 0, angle: 0 }));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  return {
    mesh,
    place(i, t0, x, y, z, w, l, angle) { items[i] = { t0, x, y, z, w, l, angle }; },
    clear() { for (const d of items) d.t0 = 1e9; },
    update(t) {
      items.forEach((d, i) => {
        const k = t < d.t0 ? 0 : Math.min(1, (t - d.t0) / 0.15);
        q.setFromAxisAngle(up, d.angle);
        v.set(d.x, d.y, d.z);
        s.set(d.w * k, 1, d.l * k);
        m.compose(v, q, s);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

/** A tracer's line: a bright core in a soft glow, even along its length (the segments butt together). */
function tracerTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 64;
  const g = c.getContext("2d")!;
  for (let y = 0; y < 64; y++) {
    const d = (y - 31.5) / 31.5;
    const a = Math.max(Math.exp(-Math.pow(d / 0.18, 2)), 0.45 * Math.exp(-Math.pow(d / 0.55, 2)));
    g.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
    g.fillRect(0, y, 8, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * A glowing trail behind a flying implement: streaks between its recent positions. As a tracer (the
 * broadcast's line drawn along a throw's whole path), the line keeps one width on screen however far
 * away it is or however long the lens.
 */
export function makeTrail(n: number, color: THREE.ColorRepresentation, o: { tracer?: boolean } = {}): { mesh: THREE.InstancedMesh; set(points: THREE.Vector3[], width: number, cam: THREE.Camera): void; dispose(): void } {
  const tex = o.tracer ? tracerTexture() : streakTexture();
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.frustumCulled = false;
  mesh.layers.set(LAYER.MAIN);
  mesh.renderOrder = 6;
  const m = new THREE.Matrix4(), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), P = new THREE.Vector3(), cp = new THREE.Vector3();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  // Nothing drawn until it's set (an instance starts as a unit quad at the origin).
  for (let i = 0; i < n; i++) mesh.setMatrixAt(i, zero);
  return {
    mesh,
    set(points, width, cam) {
      cam.getWorldPosition(cp);
      // A tracer's width is given as seen from 20 m through a 45° lens.
      const lens = o.tracer && cam instanceof THREE.PerspectiveCamera ? Math.tan((cam.fov * Math.PI) / 360) / Math.tan(Math.PI / 8) / 20 : 0;
      let used = 0;
      for (let i = 1; i < points.length && used < n; i++) {
        const a = points[i - 1], b = points[i];
        X.subVectors(b, a);
        const len = X.length();
        if (len < 1e-4) continue;
        X.divideScalar(len);
        P.addVectors(a, b).multiplyScalar(0.5);
        Z.subVectors(cp, P);
        Z.addScaledVector(X, -Z.dot(X)).normalize();
        Y.crossVectors(Z, X);
        const k = i / points.length;
        const w = o.tracer ? width * Math.max(0.3, Math.min(4, P.distanceTo(cp) * lens)) * (0.75 + 0.25 * k) : width * (0.3 + 0.7 * k);
        m.makeBasis(X.clone().multiplyScalar(len * (o.tracer ? 1.02 : 1.6)), Y.multiplyScalar(w), Z);
        m.setPosition(P);
        mesh.setMatrixAt(used++, m);
      }
      for (let i = used; i < n; i++) mesh.setMatrixAt(i, zero);
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() { tex.dispose(); geo.dispose(); mat.dispose(); },
  };
}

/** Textures drawn on a canvas: a footprint in sand, a divot, a scuff. */
export function markTexture(kind: "sand" | "divot" | "scuff"): THREE.CanvasTexture {
  const S = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const g = cv.getContext("2d")!;
  g.clearRect(0, 0, S, S);
  if (kind === "sand") {
    // A dent: dark rim, a lighter churned centre.
    const grad = g.createRadialGradient(S / 2, S / 2, S * 0.05, S / 2, S / 2, S / 2);
    grad.addColorStop(0, "rgba(40,24,10,0.55)");
    grad.addColorStop(0.55, "rgba(60,38,16,0.75)");
    grad.addColorStop(0.8, "rgba(255,240,210,0.25)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(S / 2, S / 2, S * 0.48, S * 0.48, 0, 0, Math.PI * 2);
    g.fill();
  } else if (kind === "divot") {
    const grad = g.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
    grad.addColorStop(0, "rgba(30,20,12,0.95)");
    grad.addColorStop(0.45, "rgba(52,36,20,0.8)");
    grad.addColorStop(0.7, "rgba(80,60,30,0.35)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
  } else {
    for (let i = 0; i < 26; i++) {
      g.strokeStyle = `rgba(70,40,20,${0.15 + Math.random() * 0.3})`;
      g.lineWidth = 1 + Math.random() * 3;
      const x = S * (0.15 + Math.random() * 0.7);
      g.beginPath();
      g.moveTo(x, S * 0.05);
      g.lineTo(x + (Math.random() - 0.5) * 6, S * 0.95);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
