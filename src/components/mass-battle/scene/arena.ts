import * as THREE from "three";
import type { ArenaId } from "@/lib/mass-battle/types";

/**
 * The battlefields, built in the browser (nothing here is from any game):
 * a flat battleground of radius R in the middle, rising ground beyond it,
 * a sky dome and fog, and each arena's own props.
 *
 * - Plains: a grassy route, rolling hills, trees and rocks.
 * - Volcano: dark basalt veined with glowing lava, a smoking cone, ash.
 * - Snowfield: snow under a pale sky, fog, snow-laden pines, snowfall.
 * - Colosseum: a stone bowl with tiers of cheering spectators.
 *
 * Ground textures are Poly Haven's CC0 scans already in public/sizes/tex.
 */

export interface ArenaLook {
  sky: [string, string];
  fog: string;
  fogNear: number;
  fogFar: number;
  sun: string;
  sunIntensity: number;
  sunElevation: number;
  hemi: [string, string, number];
  exposure: number;
}

export const ARENA_LOOK: Record<ArenaId, ArenaLook> = {
  plains: { sky: ["#3f8fe8", "#d9efff"], fog: "#cfe6f6", fogNear: 1.1, fogFar: 4.2, sun: "#fff3dc", sunIntensity: 2.6, sunElevation: 48, hemi: ["#cfe8ff", "#5b7a3a", 1.1], exposure: 1.0 },
  volcano: { sky: ["#1b0606", "#ff6a2a"], fog: "#4a1a12", fogNear: 0.7, fogFar: 3.2, sun: "#ffb27a", sunIntensity: 1.8, sunElevation: 28, hemi: ["#ff9a6a", "#2a0f0a", 0.9], exposure: 1.05 },
  snowfield: { sky: ["#7f9fc4", "#e9f0f7"], fog: "#dfe8f1", fogNear: 1.2, fogFar: 4.4, sun: "#fffaf0", sunIntensity: 2.2, sunElevation: 30, hemi: ["#e6f0ff", "#8ea3b8", 1.05], exposure: 0.92 },
  colosseum: { sky: ["#2f6fcf", "#ffe1b0"], fog: "#f2d9b4", fogNear: 1.6, fogFar: 5, sun: "#fff0d6", sunIntensity: 3.0, sunElevation: 42, hemi: ["#fff1dc", "#a08058", 1.2], exposure: 1.05 },
};

export interface ArenaOptions {
  /** Battleground radius (m). */
  radius: number;
  /** Share of the props to build (phones build fewer). */
  props: number;
  anisotropy: number;
  tex(name: string, map: "diff" | "nor" | "rough"): string;
}

export interface Arena {
  group: THREE.Group;
  look: ArenaLook;
  sun: THREE.DirectionalLight;
  /** Ground height at a point (0 on the battleground). */
  heightAt(x: number, z: number): number;
  /** Per-frame animation (ash, snow, the crowd, lava). */
  update(t: number, focus: THREE.Vector3): void;
  materials(): THREE.Material[];
  ready: Promise<void>;
  dispose(): void;
}

/** Deterministic noise for terrain and scattering. */
function hash2(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise2(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x: number, y: number) => noise2(x, y) * 0.55 + noise2(x * 2.1, y * 2.1) * 0.28 + noise2(x * 4.3, y * 4.3) * 0.17;

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

export function buildArena(id: ArenaId, opts: ArenaOptions): Arena {
  const look = ARENA_LOOK[id];
  const R = opts.radius;
  const group = new THREE.Group();
  group.name = `arena-${id}`;
  const disposables: { dispose(): void }[] = [];
  const mats: THREE.Material[] = [];
  const loader = new THREE.TextureLoader();
  const loads: Promise<unknown>[] = [];
  const texture = (name: string, map: "diff" | "nor" | "rough", repeat: number, srgb: boolean) => {
    let done: (v: unknown) => void = () => undefined;
    loads.push(new Promise((res) => { done = res; setTimeout(res, 10000); }));
    const t = loader.load(opts.tex(name, map), () => done(null), undefined, () => done(null));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = opts.anisotropy;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    disposables.push(t);
    return t;
  };
  // The ground reaches well past the battleground and rises toward the edge of the world.
  const outer = R * 3.2;
  const rise = (r: number) => {
    if (r <= R * 1.02) return 0;
    const k = (r - R * 1.02) / (outer - R);
    return k * k * R * (id === "colosseum" ? 0 : id === "volcano" ? 0.35 : 0.22);
  };
  const heightAt = (x: number, z: number) => {
    const r = Math.hypot(x, z);
    if (r <= R) return 0;
    const n = id === "colosseum" ? 0 : fbm(x * 0.02, z * 0.02) * Math.min(1, (r - R) / (R * 0.5)) * R * 0.08;
    return rise(r) + n;
  };
  const segs = 160;
  {
    // Rings of vertices: a polar grid so the middle is flat and the edge can rise.
    const rings = 48;
    const pos: number[] = [], uv: number[] = [], col: number[] = [];
    const idx: number[] = [];
    pos.push(0, 0, 0);
    uv.push(0, 0);
    col.push(1, 1, 1);
    for (let k = 1; k <= rings; k++) {
      const r = outer * Math.pow(k / rings, 1.7);
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        pos.push(x, heightAt(x, z), z);
        uv.push(x / 8, z / 8);
        const v = 0.86 + fbm(x * 0.05 + 7, z * 0.05 - 3) * 0.28;
        if (id === "colosseum") {
          // Sand: lighter in the middle, darker where it's been trampled, a warm hue shift.
          const n = fbm(x * 0.09 - 2, z * 0.09 + 5);
          const ring = Math.min(1, r / (R * 1.05));
          col.push(0.9 + n * 0.12 - ring * 0.06, 0.86 + n * 0.1 - ring * 0.07, 0.8 + n * 0.08 - ring * 0.09);
        } else col.push(v, v, v);
      }
    }
    for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
    for (let k = 1; k < rings; k++) {
      const a0 = 1 + (k - 1) * segs, a1 = 1 + k * segs;
      for (let s = 0; s < segs; s++) {
        const s1 = (s + 1) % segs;
        idx.push(a0 + s, a0 + s1, a1 + s, a0 + s1, a1 + s1, a1 + s);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    let gm: THREE.MeshStandardMaterial;
    if (id === "plains") {
      gm = new THREE.MeshStandardMaterial({ map: texture("leafy_grass", "diff", 1, true), normalMap: texture("leafy_grass", "nor", 1, false), roughness: 0.95, vertexColors: true, color: "#cfe0a0" });
    } else if (id === "volcano") {
      gm = new THREE.MeshStandardMaterial({ map: texture("asphalt_02", "diff", 1, true), normalMap: texture("asphalt_02", "nor", 1, false), roughness: 0.9, vertexColors: true, color: "#5a4a46" });
    } else if (id === "snowfield") {
      gm = new THREE.MeshStandardMaterial({ normalMap: texture("granite_tile", "nor", 0.5, false), normalScale: new THREE.Vector2(0.25, 0.25), roughness: 0.82, vertexColors: true, color: "#f4f8fc" });
    } else {
      // Raked sand: colour from noise (in the vertex colours below), a fine grain from the granite scan's normals.
      gm = new THREE.MeshStandardMaterial({ normalMap: texture("granite_tile", "nor", 1.6, false), normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.97, vertexColors: true, color: "#f1d39c" });
    }
    if (id === "volcano") {
      // Lava veins: a glow along the noise's ridges, pulsing slowly.
      const time = { value: 0 };
      gm.userData.time = time;
      gm.onBeforeCompile = (s) => {
        s.uniforms.uTime = time;
        s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWorld;").replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
        s.fragmentShader = s.fragmentShader
          .replace("#include <common>", `#include <common>
uniform float uTime;
varying vec3 vWorld;
float lh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float ln(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(lh(i), lh(i + vec2(1.0, 0.0)), u.x), mix(lh(i + vec2(0.0, 1.0)), lh(i + vec2(1.0, 1.0)), u.x), u.y); }`)
          .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
float n1 = ln(vWorld.xz * 0.06) * 0.6 + ln(vWorld.xz * 0.17) * 0.4;
float vein = 1.0 - smoothstep(0.0, 0.014, abs(n1 - 0.5));
float pulse = 0.7 + 0.3 * sin(uTime * 1.3 + vWorld.x * 0.05);
totalEmissiveRadiance += vec3(1.0, 0.3, 0.04) * vein * 1.6 * pulse;`);
      };
      gm.customProgramCacheKey = () => "mb-lava";
    }
    mats.push(gm);
    const mesh = new THREE.Mesh(g, gm);
    mesh.receiveShadow = true;
    mesh.name = "ground";
    group.add(mesh);
    disposables.push(g, gm);
  }
  // Sky dome.
  {
    const g = new THREE.SphereGeometry(outer * 2.2, 32, 16);
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: new THREE.Color(look.sky[0]) }, bottom: { value: new THREE.Color(look.sky[1]) } },
      vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: "uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float k = smoothstep(-0.05, 0.55, vP.y); gl_FragColor = vec4(mix(bottom, top, k), 1.0); }",
    });
    const sky = new THREE.Mesh(g, m);
    sky.name = "sky";
    sky.renderOrder = -1;
    group.add(sky);
    mats.push(m);
    disposables.push(g, m);
  }
  // Light.
  const sun = new THREE.DirectionalLight(look.sun, look.sunIntensity);
  const el = THREE.MathUtils.degToRad(look.sunElevation);
  sun.position.set(Math.cos(el) * 0.6, Math.sin(el), Math.cos(el) * 0.8).multiplyScalar(R * 2);
  group.add(sun);
  group.add(sun.target);
  const hemi = new THREE.HemisphereLight(look.hemi[0], look.hemi[1], look.hemi[2]);
  group.add(hemi);

  const rand = seeded(id.length * 7919 + Math.round(R));
  const animated: ((t: number, focus: THREE.Vector3) => void)[] = [];
  const scatterRing = (count: number, r0: number, r1: number, make: (x: number, z: number, s: number, k: number) => void) => {
    for (let k = 0; k < count; k++) {
      const a = rand() * Math.PI * 2;
      const r = r0 + (r1 - r0) * Math.sqrt(rand());
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      make(x, z, 0.7 + rand() * 0.8, k);
    }
  };
  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, count: number) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
    m.count = 0;
    m.castShadow = false;
    m.receiveShadow = false;
    group.add(m);
    disposables.push(geo, mat as unknown as { dispose(): void });
    mats.push(mat);
    return m;
  };
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), E = new THREE.Euler();
  const put = (im: THREE.InstancedMesh, x: number, y: number, z: number, s: number, yaw = 0, color?: THREE.Color) => {
    E.set(0, yaw, 0);
    Q.setFromEuler(E);
    P.set(x, y, z);
    S.setScalar(s);
    M.compose(P, Q, S);
    im.setMatrixAt(im.count, M);
    if (color) im.setColorAt(im.count, color);
    im.count++;
  };
  const props = opts.props;

  if (id === "plains" || id === "snowfield") {
    // Trees round the battleground (pines on the snowfield), rocks, and grass tufts on the plains.
    const pine = id === "snowfield";
    const trunk = new THREE.CylinderGeometry(0.18, 0.28, 2.2, 6).translate(0, 1.1, 0);
    const crownGeo = pine ? mergeCones() : new THREE.IcosahedronGeometry(1.9, 1).translate(0, 3.6, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: "#5a3e2a", roughness: 0.95 });
    const crownMat = new THREE.MeshStandardMaterial({ color: pine ? "#e9f1f6" : "#4f8f3a", roughness: 0.9, flatShading: true, vertexColors: pine });
    const nTrees = Math.round(260 * props);
    const trunks = instanced(trunk, trunkMat, nTrees), crowns = instanced(crownGeo, crownMat, nTrees);
    scatterRing(nTrees, R * 1.12, R * 2.6, (x, z, s) => {
      const y = heightAt(x, z);
      const sc = s * (1.4 + R * 0.006);
      put(trunks, x, y - 0.2, z, sc, rand() * 6);
      put(crowns, x, y - 0.2, z, sc, rand() * 6);
    });
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: pine ? "#d6e0e8" : "#8d8a80", roughness: 1, flatShading: true });
    const nRocks = Math.round(120 * props);
    const rocks = instanced(rockGeo, rockMat, nRocks);
    scatterRing(nRocks, R * 0.96, R * 2.2, (x, z, s) => put(rocks, x, heightAt(x, z) - 0.2, z, s * 0.9, rand() * 6));
    if (!pine) {
      const tuft = new THREE.ConeGeometry(0.09, 0.55, 4).translate(0, 0.25, 0);
      const tuftMat = new THREE.MeshStandardMaterial({ color: "#6fae3e", roughness: 1 });
      const nTufts = Math.round(1400 * props);
      const tufts = instanced(tuft, tuftMat, nTufts);
      scatterRing(nTufts, R * 0.2, R * 1.5, (x, z, s) => put(tufts, x, heightAt(x, z), z, s, rand() * 6));
    }
  }

  if (id === "volcano") {
    // The cone on the horizon with a glowing crater and a column of smoke.
    const cone = new THREE.ConeGeometry(R * 0.9, R * 0.75, 40, 6, true);
    const coneMat = new THREE.MeshStandardMaterial({ color: "#2a1d1a", roughness: 1, flatShading: true });
    const c = new THREE.Mesh(cone, coneMat);
    c.position.set(-R * 1.9, R * 0.3, -R * 2.2);
    group.add(c);
    const crater = new THREE.Mesh(new THREE.CircleGeometry(R * 0.14, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#ff7a2a" }));
    crater.position.set(-R * 1.9, R * 0.3 + R * 0.37, -R * 2.2);
    group.add(crater);
    disposables.push(cone, coneMat, crater.geometry, crater.material as THREE.Material);
    mats.push(coneMat, crater.material as THREE.Material);
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: "#2b2422", roughness: 1, flatShading: true });
    const nRocks = Math.round(200 * props);
    const rocks = instanced(rockGeo, rockMat, nRocks);
    scatterRing(nRocks, R * 0.98, R * 2.4, (x, z, s) => put(rocks, x, heightAt(x, z) - 0.3, z, s * 1.6, rand() * 6));
  }

  if (id === "colosseum") {
    // A stone wall round the floor, tiers of seats, and a crowd that cheers.
    const wallH = Math.max(3, R * 0.06);
    const wall = new THREE.CylinderGeometry(R * 1.08, R * 1.08, wallH, 96, 1, true).translate(0, wallH / 2, 0);
    const stone = new THREE.MeshStandardMaterial({ map: texture("sandstone_blocks_08", "diff", 1, true), normalMap: texture("sandstone_blocks_08", "nor", 1, false), roughness: 0.9, side: THREE.DoubleSide, color: "#efe0c4" });
    const wm = new THREE.Mesh(wall, stone);
    group.add(wm);
    const tiers = 9;
    const pts: THREE.Vector2[] = [];
    for (let k = 0; k <= tiers; k++) {
      const r = R * 1.08 + k * R * 0.07;
      const y = wallH + k * R * 0.045;
      pts.push(new THREE.Vector2(r, y), new THREE.Vector2(r + R * 0.07, y));
    }
    pts.push(new THREE.Vector2(R * 1.08 + tiers * R * 0.07 + R * 0.07, wallH + tiers * R * 0.045 + R * 0.2));
    const seats = new THREE.LatheGeometry(pts, 96);
    const sm = new THREE.Mesh(seats, stone);
    group.add(sm);
    disposables.push(wall, seats, stone);
    mats.push(stone);
    // Spectators: a little body and head each, coloured, bobbing to their own beat.
    const body = new THREE.BoxGeometry(0.5, 0.75, 0.4).translate(0, 0.375, 0);
    const head = new THREE.SphereGeometry(0.2, 8, 6).translate(0, 0.95, 0);
    const person = mergeGeometries([body, head]);
    const time = { value: 0 };
    const crowdMat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    crowdMat.onBeforeCompile = (s) => {
      s.uniforms.uTime = time;
      s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTime;").replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nfloat ph = instanceMatrix[3][0] * 0.37 + instanceMatrix[3][2] * 0.61;\ntransformed.y += max(0.0, sin(uTime * 7.0 + ph * 5.0)) * 0.35;"
      );
    };
    crowdMat.customProgramCacheKey = () => "mb-crowd";
    const scale = Math.max(1, R * 0.018);
    const perTier = Math.round((Math.PI * 2 * R * 1.1) / (0.9 * scale));
    const total = Math.round(tiers * perTier * Math.min(1, props));
    const crowd = instanced(person, crowdMat, total);
    const palette = ["#e0483e", "#f2b632", "#3e7be0", "#4fb86a", "#f4f1e8", "#9a5ae0", "#f07ab0", "#2c2c38"].map((c) => new THREE.Color(c));
    for (let k = 0; k < tiers; k++) {
      for (let s = 0; s < perTier; s++) {
        if (crowd.count >= total) break;
        if (rand() > props * 0.92) continue;
        const a = (s / perTier) * Math.PI * 2 + rand() * 0.01;
        const r = R * 1.08 + k * R * 0.07 + R * 0.035;
        const y = wallH + (k + 1) * R * 0.045 - R * 0.045 + 0.02;
        put(crowd, Math.cos(a) * r, y, Math.sin(a) * r, scale * (0.85 + rand() * 0.3), -a - Math.PI / 2, palette[Math.floor(rand() * palette.length)]);
      }
    }
    if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
    animated.push((t) => (time.value = t));
    // Banners on the wall, in the battle's colours.
    const banner = new THREE.PlaneGeometry(wallH * 0.5, wallH * 0.9);
    const bannerMats = ["#e0483e", "#3e7be0"].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, side: THREE.DoubleSide }));
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const b = new THREE.Mesh(banner, bannerMats[k % 2]);
      b.position.set(Math.cos(a) * R * 1.075, wallH * 0.5, Math.sin(a) * R * 1.075);
      b.lookAt(0, wallH * 0.5, 0);
      group.add(b);
    }
    disposables.push(banner, ...bannerMats);
    mats.push(...bannerMats);
  }

  // Weather: ash on the volcano, snow on the snowfield (small 3D flakes falling round the action).
  if (id === "volcano" || id === "snowfield") {
    const count = Math.round((id === "snowfield" ? 2200 : 1400) * Math.max(0.3, props));
    const geo = new THREE.InstancedBufferGeometry();
    const flake = new THREE.OctahedronGeometry(1, 0);
    geo.index = flake.index;
    geo.setAttribute("position", flake.getAttribute("position"));
    const seed = new Float32Array(count * 4);
    for (let k = 0; k < count; k++) seed.set([rand(), rand(), rand(), rand()], k * 4);
    geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 4));
    geo.instanceCount = count;
    const time = { value: 0 };
    const focus = { value: new THREE.Vector3() };
    const box = Math.max(40, R * 0.9);
    const snow = id === "snowfield";
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: time, uFocus: focus, uBox: { value: box }, uColor: { value: new THREE.Color(snow ? "#ffffff" : "#ff9a5a") }, uSize: { value: snow ? 0.06 : 0.05 } },
      vertexShader: `
uniform float uTime; uniform vec3 uFocus; uniform float uBox; uniform float uSize;
attribute vec4 aSeed;
varying float vA;
void main() {
  float fall = ${snow ? "1.6" : "-0.9"};
  vec3 p = vec3(aSeed.x, fract(aSeed.y - uTime * fall / (uBox * 0.6) * (0.6 + aSeed.w)), aSeed.z) * uBox;
  p.xz += sin(uTime * (0.6 + aSeed.w) + aSeed.x * 20.0) * 0.6;
  p = vec3(mod(p.x - uFocus.x, uBox), p.y * 0.6, mod(p.z - uFocus.z, uBox)) + vec3(uFocus.x, 0.0, uFocus.z) - vec3(uBox * 0.5, 0.0, uBox * 0.5);
  vA = smoothstep(0.0, 0.1, p.y / (uBox * 0.6)) * (1.0 - smoothstep(0.85, 1.0, p.y / (uBox * 0.6)));
  float a = uTime * 2.0 + aSeed.w * 10.0;
  vec3 q = position * uSize * (0.6 + aSeed.w) * (1.0 + uBox * 0.004);
  q = vec3(q.x * cos(a) - q.z * sin(a), q.y, q.x * sin(a) + q.z * cos(a));
  gl_Position = projectionMatrix * viewMatrix * vec4(p + q, 1.0);
}`,
      fragmentShader: "uniform vec3 uColor; varying float vA; void main(){ if (vA < 0.02) discard; gl_FragColor = vec4(uColor, vA * 0.9); }",
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    group.add(mesh);
    disposables.push(geo, flake, mat);
    mats.push(mat);
    animated.push((t, f) => {
      time.value = t;
      focus.value.copy(f);
    });
  }
  const groundMat = mats[0];
  if (groundMat.userData.time) animated.push((t) => (groundMat.userData.time.value = t));

  return {
    group,
    look,
    sun,
    heightAt,
    update(t, focus) {
      for (const f of animated) f(t, focus);
    },
    materials: () => mats,
    ready: Promise.all(loads).then(() => undefined),
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

/** A snow-laden pine: three stacked cones (dark green with white tips through vertex colours). */
function mergeCones(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    const c = new THREE.ConeGeometry(1.8 - k * 0.45, 2.2, 7).translate(0, 2.2 + k * 1.3, 0);
    const pos = c.getAttribute("position");
    const col: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const top = pos.getY(i) > 2.2 + k * 1.3 + 0.2;
      col.push(...(top ? [0.95, 0.97, 1] : [0.16, 0.32, 0.22]));
    }
    c.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    parts.push(c);
  }
  return mergeGeometries(parts);
}

/** Merges plain geometries (positions, normals and colours where all have them). */
function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  let base = 0;
  const withColor = parts.every((p) => p.getAttribute("color"));
  for (const p of parts) {
    const g = p.index ? p : p;
    const P = g.getAttribute("position"), N = g.getAttribute("normal"), C = g.getAttribute("color");
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i));
      nor.push(N.getX(i), N.getY(i), N.getZ(i));
      if (withColor) col.push(C.getX(i), C.getY(i), C.getZ(i));
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + base);
    else for (let i = 0; i < P.count; i++) idx.push(i + base);
    base += P.count;
    p.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  if (withColor) out.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  return out;
}
