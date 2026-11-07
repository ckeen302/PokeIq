import * as THREE from "three";
import { LAYER, TIERS, bowlLength, bowlRing } from "./stadium";
import { CROWD_HAIR, CROWD_SHIRT, CROWD_SKIN, rng } from "./textures";

/**
 * The crowd: every seat row of both tiers, filled with seated spectators
 * modelled in 3D (a low-poly body: torso, lap, head, hair and two arms), drawn
 * instanced. Each one has its own shirt, skin and hair (or cap) colour
 * and size; the vertex shader bobs them, and as the excitement grows more
 * of them clap and then stand their arms up, in waves round the bowl.
 * The stands are cut into sections so the ones out of shot aren't drawn.
 * Camera flashes pop across the stands, more of them at the start and the
 * finish.
 */

export interface CrowdOptions {
  /** Share of seats taken (fewer spectators on slower devices). */
  occupancy: number;
  flashes: number;
  /**
   * Other stands than the stadium bowl (the PokéIQ Games' indoor arena and
   * aquatics centre): rows of seats, each a list of seat points (x, z),
   * the seat's height, and the direction it faces (towards the floor).
   */
  rows?: { pts: { x: number; z: number; nx: number; nz: number }[]; y: number; tier: 0 | 1 }[];
  /** Where the lights shine in from (the stadium's floodlights by default). */
  light?: { y: number };
}

export interface Crowd {
  group: THREE.Group;
  count: number;
  /** 0 calm … 1 the finish. */
  update(t: number, excitement: number): void;
  dispose(): void;
}

const SEAT_W = 0.56;
const ROW_D = 0.86;
/** Sections round the bowl per tier (each one culled on its own). */
const SECTIONS = 24;

/** Body parts, for the colours: shirt, skin, hair, trousers. */
const PART = { shirt: 0, skin: 1, hair: 2, legs: 3 } as const;
type Face = "px" | "nx" | "py" | "ny" | "pz" | "nz";

/**
 * One spectator, seated, facing +z (the field), in metres: the origin is
 * where the seat row meets the slope. Boxes without the faces nobody sees;
 * arms carry their side (−1 / +1) so the shader can raise them.
 */
function spectatorGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], part: number[] = [], arm: number[] = [], index: number[] = [];
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, partOf: (f: Face) => number, side = 0, skip: Face[] = []) => {
    const faces: [Face, number[], [number, number, number][]][] = [
      ["px", [1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]],
      ["nx", [-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
      ["py", [0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]],
      ["ny", [0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
      ["pz", [0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
      ["nz", [0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
    ];
    for (const [f, n, q] of faces) {
      if (skip.includes(f)) continue;
      // Four corners per face (flat shading), two triangles: the vertex shader runs once per corner.
      const v0 = pos.length / 3;
      for (const c of q) {
        pos.push(...c);
        nrm.push(...n);
        part.push(partOf(f));
        arm.push(side);
      }
      index.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
    }
  };
  const all = (p: number) => () => p;
  // Lap (thighs on the seat, knees towards the field).
  box(-0.18, 0.18, 0.3, 0.46, -0.12, 0.3, all(PART.legs), 0, ["ny", "nz"]);
  // Torso.
  box(-0.19, 0.19, 0.42, 0.94, -0.28, -0.06, all(PART.shirt), 0, ["ny", "nz"]);
  // Head: the face, then hair (or a cap) over the top, sides and fringe. The backs of heads and bodies face away from every camera.
  box(-0.1, 0.1, 0.97, 1.14, -0.27, -0.07, all(PART.skin), 0, ["ny", "nz", "py"]);
  box(-0.106, 0.106, 1.14, 1.23, -0.276, -0.064, all(PART.hair), 0, ["ny", "nz"]);
  // Arms, hanging from the shoulders (the shader swings them about the shoulder): sleeves, hands at the end.
  for (const s of [-1, 1]) {
    const x = s * 0.245;
    box(x - 0.05, x + 0.05, 0.38, 0.92, -0.22, -0.12, (f) => (f === "ny" ? PART.skin : PART.shirt), s, ["py"]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("aPart", new THREE.Float32BufferAttribute(part, 1));
  g.setAttribute("aArm", new THREE.Float32BufferAttribute(arm, 1));
  g.setIndex(index);
  return g;
}

const linear = (hex: string) => new THREE.Color(hex);

export function buildCrowd(o: CrowdOptions): Crowd {
  const r = rng(2026);
  const shirts = CROWD_SHIRT.map(linear), skins = CROWD_SKIN.map(linear), hairs = CROWD_HAIR.map(linear);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  type Inst = { pos: number[]; dir: number[]; shirt: number[]; skin: number[]; hair: number[]; phase: number[]; scale: number[] };
  const sections: Inst[] = Array.from({ length: SECTIONS * 2 }, () => ({ pos: [], dir: [], shirt: [], skin: [], hair: [], phase: [], scale: [] }));
  const heads: THREE.Vector3[] = [];
  let count = 0;
  const seat = (ti: number, i: number, n: number, p: { x: number; z: number; nx: number; nz: number }, y: number) => {
    if (r() > o.occupancy) return;
    const sec = sections[ti * SECTIONS + Math.floor((i / n) * SECTIONS)];
    sec.pos.push(p.x, y, p.z);
    sec.dir.push(-p.nx, -p.nz);
    const shirt = pick(shirts), skin = pick(skins);
    const hair = r() < 0.16 ? pick(shirts) : pick(hairs);
    sec.shirt.push(shirt.r, shirt.g, shirt.b);
    sec.skin.push(skin.r, skin.g, skin.b);
    sec.hair.push(hair.r, hair.g, hair.b);
    sec.phase.push(r() * 100 + ti * 0.5);
    sec.scale.push(0.9 + r() * 0.2);
    count++;
    if (r() < 0.06) heads.push(new THREE.Vector3(p.x - p.nx * 0.2, y + 1.15, p.z - p.nz * 0.2));
  };
  for (const row of o.rows ?? []) row.pts.forEach((p, i) => seat(row.tier, i, row.pts.length, p, row.y));
  if (!o.rows) for (const [ti, tier] of [TIERS.lower, TIERS.upper].entries()) {
    const rows = Math.floor((tier.d1 - tier.d0) / ROW_D);
    for (let row = 0; row < rows; row++) {
      const d = tier.d0 + row * ROW_D + 0.35;
      const y = tier.y0 + ((d - tier.d0) / (tier.d1 - tier.d0)) * (tier.y1 - tier.y0);
      const L = bowlLength(d);
      const n = Math.floor(L / SEAT_W);
      const ring = bowlRing(n, d - 0.2);
      ring.forEach((p, i) => {
        if (r() > o.occupancy) return;
        const sec = sections[ti * SECTIONS + Math.floor((i / n) * SECTIONS)];
        sec.pos.push(p.x, y, p.z);
        sec.dir.push(-p.nx, -p.nz);
        const shirt = pick(shirts), skin = pick(skins);
        // About one in six wears a cap in a team colour.
        const hair = r() < 0.16 ? pick(shirts) : pick(hairs);
        sec.shirt.push(shirt.r, shirt.g, shirt.b);
        sec.skin.push(skin.r, skin.g, skin.b);
        sec.hair.push(hair.r, hair.g, hair.b);
        sec.phase.push(r() * 100 + ti * 0.5);
        sec.scale.push(0.9 + r() * 0.2);
        count++;
        if (r() < 0.06) heads.push(new THREE.Vector3(p.x - p.nx * 0.2, y + 1.15, p.z - p.nz * 0.2));
      });
    }
  }

  const base = spectatorGeometry();
  const uniforms = {
    uTime: { value: 0 },
    uExcite: { value: 0.2 },
    uLightY: { value: o.light?.y ?? 46 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute float aPart; attribute float aArm;
      attribute vec3 iPos; attribute vec2 iDir; attribute vec3 iShirt; attribute vec3 iSkin; attribute vec3 iHair; attribute float iPhase; attribute float iScale;
      uniform float uTime; uniform float uExcite; uniform float uLightY;
      varying vec3 vColor; varying float vLight; varying float vDist;
      vec3 rotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c); }
      vec3 rotZ(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z); }
      void main() {
        float e = uExcite * uExcite;
        float h1 = fract(iPhase * 13.7), h2 = fract(iPhase * 7.31), h3 = fract(iPhase * 3.17);
        // In waves round the bowl: more and more of the crowd stand their arms up, others clap.
        float wave = fract(iPhase * 0.137 + uTime * 0.21);
        float cheer = step(1.0 - e * 0.6, h1) * step(0.2, wave);
        float clap = (1.0 - cheer) * step(1.0 - uExcite * 0.7, h2);
        vec3 p = position;
        vec3 n = normal;
        if (aArm != 0.0) {
          // Swing the arm about its shoulder: resting on the lap, forward to clap, or up and waving.
          vec3 pivot = vec3(aArm * 0.245, 0.92, -0.17);
          float speed = 5.0 + 4.0 * h2;
          float lift = mix(0.45, mix(1.25, 2.75 + 0.22 * sin(uTime * speed + iPhase * 6.2831), cheer), max(cheer, clap));
          float splay = cheer > 0.5 ? 0.32 + 0.08 * sin(uTime * speed * 0.5 + iPhase) : clap > 0.5 ? -0.36 + 0.1 * sin(uTime * 14.0 + iPhase * 9.0) : 0.06;
          // Out to the side (or in, to clap) first, then forward and up.
          float side = aArm * splay;
          p = rotX(rotZ(p - pivot, side), -lift) + pivot;
          n = rotX(rotZ(n, side), -lift);
        }
        p *= iScale;
        float speed = 5.0 + 4.0 * h3;
        float jump = e * 0.16 * max(0.0, sin(uTime * speed + iPhase * 6.2831)) * cheer;
        float sway = 0.03 * sin(uTime * 1.3 + iPhase);
        vec3 fwd = vec3(iDir.x, 0.0, iDir.y);
        vec3 right = vec3(iDir.y, 0.0, -iDir.x);
        vec3 w = iPos + right * (p.x + sway) + vec3(0.0, p.y + jump, 0.0) + fwd * p.z;
        vec3 wn = normalize(right * n.x + vec3(0.0, n.y, 0.0) + fwd * n.z);
        // Trousers: dark denim, black or khaki.
        vec3 legs = h3 < 0.45 ? vec3(0.025, 0.035, 0.07) : h3 < 0.8 ? vec3(0.012) : vec3(0.16, 0.12, 0.07);
        vColor = aPart < 0.5 ? iShirt : aPart < 1.5 ? iSkin : aPart < 2.5 ? iHair : legs;
        // The floodlights shine in from over the field; the back of the upper tier is darker.
        vec3 toField = normalize(vec3(-iPos.x * 0.55, uLightY - iPos.y, -iPos.z * 0.55));
        float key = max(dot(wn, toField), 0.0);
        float sky = 0.5 + 0.5 * wn.y;
        vLight = (0.22 + 0.62 * key + 0.16 * sky) * mix(1.0, 0.62, smoothstep(2.0, 34.0, iPos.y));
        vec4 mv = viewMatrix * vec4(w, 1.0);
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor; varying float vLight; varying float vDist;
      void main() {
        vec3 c = vColor;
        c = mix(vec3(dot(c, vec3(0.3, 0.59, 0.11))), c, 0.74) * vLight * 0.44;
        // The night haze over the far side of the bowl softens the crowd into a wall of colour.
        c = mix(c, vec3(0.03, 0.04, 0.068), smoothstep(35.0, 230.0, vDist) * 0.5);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

  const group = new THREE.Group();
  const geos: THREE.InstancedBufferGeometry[] = [];
  for (const s of sections) {
    const k = s.pos.length / 3;
    if (!k) continue;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.getIndex());
    for (const name of ["position", "normal", "aPart", "aArm"]) geo.setAttribute(name, base.getAttribute(name));
    geo.setAttribute("iPos", new THREE.InstancedBufferAttribute(new Float32Array(s.pos), 3));
    geo.setAttribute("iDir", new THREE.InstancedBufferAttribute(new Float32Array(s.dir), 2));
    geo.setAttribute("iShirt", new THREE.InstancedBufferAttribute(new Float32Array(s.shirt), 3));
    geo.setAttribute("iSkin", new THREE.InstancedBufferAttribute(new Float32Array(s.skin), 3));
    geo.setAttribute("iHair", new THREE.InstancedBufferAttribute(new Float32Array(s.hair), 3));
    geo.setAttribute("iPhase", new THREE.InstancedBufferAttribute(new Float32Array(s.phase), 1));
    geo.setAttribute("iScale", new THREE.InstancedBufferAttribute(new Float32Array(s.scale), 1));
    geo.instanceCount = k;
    // The section's bounds (world space: the mesh sits at the origin), so whole sections out of shot are skipped.
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < k; i++) pts.push(new THREE.Vector3(s.pos[i * 3], s.pos[i * 3 + 1] + 0.7, s.pos[i * 3 + 2]));
    const sphere = new THREE.Sphere().setFromPoints(pts);
    sphere.radius += 1.6;
    geo.boundingSphere = sphere;
    const mesh = new THREE.Mesh(geo, material);
    mesh.layers.set(LAYER.CROWD);
    group.add(mesh);
    geos.push(geo);
  }

  // Camera flashes.
  const fp: number[] = [], fa: number[] = [];
  for (let i = 0; i < o.flashes && heads.length; i++) {
    const h = heads[Math.floor(r() * heads.length)];
    fp.push(h.x + (r() - 0.5) * 3, h.y + r() * 0.3, h.z + (r() - 0.5) * 3);
    fa.push(r() * 1000);
  }
  const fgeo = new THREE.BufferGeometry();
  fgeo.setAttribute("position", new THREE.Float32BufferAttribute(fp, 3));
  fgeo.setAttribute("aPhase", new THREE.Float32BufferAttribute(fa, 1));
  const fmat = new THREE.ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uExcite: uniforms.uExcite, uScale: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: /* glsl */ `
      attribute float aPhase; uniform float uTime; uniform float uExcite; uniform float uScale; varying float vI;
      void main() {
        float period = mix(16.0, 2.2, uExcite * uExcite);
        float f = fract(uTime / period + aPhase);
        float x = f * period;
        vI = exp(-x * x * 900.0) + 0.6 * exp(-(x - 0.09) * (x - 0.09) * 2000.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = vI > 0.01 ? clamp(uScale * 260.0 / -mv.z, 2.0, 12.0) : 0.0;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vI;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float a = exp(-dot(q, q) * 18.0) * vI;
        gl_FragColor = vec4(vec3(5.0, 5.2, 6.0) * a, a);
      }`,
  });
  const flashes = new THREE.Points(fgeo, fmat);
  flashes.frustumCulled = false;
  flashes.layers.set(LAYER.CROWD);
  group.add(flashes);

  return {
    group,
    count,
    update(t, excitement) {
      uniforms.uTime.value = t;
      uniforms.uExcite.value = excitement;
      fmat.uniforms.uScale.value = window.devicePixelRatio > 1.5 ? 1.4 : 1;
    },
    dispose() {
      base.dispose();
      geos.forEach((g) => g.dispose());
      material.dispose();
      fgeo.dispose();
      fmat.dispose();
    },
  };
}
