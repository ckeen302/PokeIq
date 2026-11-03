import * as THREE from "three";
import type { ArenaId } from "@/lib/mass-battle/types";
import type { Look } from "./look";

/**
 * The battlefields, built in the browser (nothing here is from any game):
 * a flat battleground of radius R in the middle, rising ground beyond it,
 * mountains on the horizon, a sky with its sun (or moon), clouds and
 * stars, atmospheric fog, and each arena's own scenery.
 *
 * - Plains: a grassy route, wind in the grass, flowers, trees and rocks.
 * - Volcano: dark basalt veined with flowing lava, a smoking cone, embers.
 * - Snowfield: glittering snow, snow-laden pines, ice, snowfall.
 * - Colosseum: a stone bowl with arches, banners, torches and a crowd that
 *   jumps and waves.
 *
 * Ground textures are Poly Haven's CC0 scans already in public/sizes/tex.
 */

export interface ArenaOptions {
  /** Battleground radius (m). */
  radius: number;
  /** Share of the props to build (phones build fewer). */
  props: number;
  /** Grass blades round the camera (plains). */
  grass: number;
  anisotropy: number;
  look: Look;
  tex(name: string, map: "diff" | "nor" | "rough"): string;
}

export interface Arena {
  group: THREE.Group;
  look: Look;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  /** Unit vector toward the sun (or the moon). */
  sunDir: THREE.Vector3;
  /** Ground height at a point (0 on the battleground). */
  heightAt(x: number, z: number): number;
  /** Per-frame animation (wind, the crowd, lava, clouds). */
  update(t: number, focus: THREE.Vector3, camera: THREE.Camera): void;
  /** The crowd's excitement, 0..1 (it jumps higher for big moments). */
  cheer(level: number): void;
  materials(): THREE.Material[];
  /** Colour of the dust a step kicks up here. */
  dust: THREE.Color;
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

const NOISE_GLSL = /* glsl */ `
float mbH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float mbN(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mbH(i), mbH(i + vec2(1.0, 0.0)), u.x), mix(mbH(i + vec2(0.0, 1.0)), mbH(i + vec2(1.0, 1.0)), u.x), u.y); }
float mbF(vec2 p) { return mbN(p) * 0.5 + mbN(p * 2.03 + 1.7) * 0.3 + mbN(p * 4.1 - 3.1) * 0.2; }`;

/** The sky: a gradient from the horizon up, the sun's disc and glow, drifting clouds, stars at night. */
function skyMaterial(look: Look, sunDir: THREE.Vector3, fog: THREE.Color) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(look.skyTop) },
      uHorizon: { value: new THREE.Color(look.skyHorizon) },
      uFog: { value: fog },
      uGlow: { value: new THREE.Color(look.sunGlow) },
      uSunDir: { value: sunDir },
      uSunDisc: { value: look.sunDisc },
      uClouds: { value: look.clouds },
      uCloudColor: { value: new THREE.Color(look.cloudColor) },
      uStars: { value: look.stars },
      uTime: { value: 0 },
    },
    vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: /* glsl */ `
uniform vec3 uTop, uHorizon, uFog, uGlow, uSunDir, uCloudColor;
uniform float uSunDisc, uClouds, uStars, uTime;
varying vec3 vP;
${NOISE_GLSL}
void main() {
  vec3 d = normalize(vP);
  float up = clamp(d.y, -1.0, 1.0);
  vec3 col = mix(uHorizon, uTop, pow(smoothstep(-0.02, 0.6, up), 0.7));
  float s = max(dot(d, normalize(uSunDir)), 0.0);
  // The sun's glow, its disc, and haze toward the horizon.
  col += uGlow * (pow(s, 6.0) * 0.35 + pow(s, 48.0) * 0.6) * min(1.0, uSunDisc + 0.3);
  col += uGlow * pow(s, 1400.0) * 30.0 * uSunDisc;
  // Clouds: two layers of drifting noise on a dome, lit toward the sun.
  if (up > 0.0 && uClouds > 0.01) {
    vec2 uv = d.xz / (up + 0.18) * 1.3;
    float c = mbF(uv * 1.2 + vec2(uTime * 0.004, uTime * 0.0015));
    c = c * 0.65 + mbF(uv * 3.1 - vec2(uTime * 0.007, 0.0)) * 0.35;
    float cover = smoothstep(1.0 - uClouds * 0.95, 1.12 - uClouds * 0.6, c);
    float lit = 0.75 + 0.45 * pow(s, 3.0);
    vec3 cc = uCloudColor * lit;
    col = mix(col, cc, cover * smoothstep(0.0, 0.12, up) * 0.92);
  }
  // Stars at night.
  if (uStars > 0.0 && up > 0.05) {
    vec3 g = floor(d * 260.0);
    float h = fract(sin(dot(g, vec3(12.989, 78.233, 37.719))) * 43758.5453);
    float tw = 0.6 + 0.4 * sin(uTime * 2.0 + h * 40.0);
    col += vec3(0.9, 0.95, 1.0) * step(0.9975, h) * tw * uStars * smoothstep(0.05, 0.35, up) * 1.6;
  }
  // Into the fog at the horizon, so the land fades into the sky.
  col = mix(col, uFog, smoothstep(0.12, -0.04, up));
  gl_FragColor = vec4(col, 1.0);
}`,
  });
}

/** Wind in the grass: blades round the camera's focus, wrapped so the field never ends; short on the battleground. */
function grassField(count: number, R: number, look: Look, sunDir: THREE.Vector3, rand: () => number) {
  const blade = new THREE.BufferGeometry();
  // A tapered, slightly bent blade: 5 vertices.
  blade.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.32, 0.5, 0.05, 0.32, 0.5, 0.05, 0, 1, 0.16], 3));
  blade.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4]);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = blade.index;
  geo.setAttribute("position", blade.getAttribute("position"));
  const seed = new Float32Array(count * 4);
  for (let k = 0; k < count; k++) seed.set([rand(), rand(), rand(), rand()], k * 4);
  geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 4));
  geo.instanceCount = count;
  const box = 30;
  const uniforms = {
    uTime: { value: 0 },
    uFocus: { value: new THREE.Vector3() },
    uBox: { value: box },
    uR: { value: R },
    uSun: { value: sunDir },
    uSunColor: { value: new THREE.Color(look.sun).multiplyScalar(look.sunIntensity * 0.32) },
    uSky: { value: new THREE.Color(look.hemiSky).multiplyScalar(look.hemiIntensity * 0.5) },
    uBase: { value: new THREE.Color("#2f5a1c") },
    uTip: { value: new THREE.Color("#a6d660") },
  };
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, uniforms]),
    vertexShader: /* glsl */ `
uniform float uTime; uniform vec3 uFocus; uniform float uBox; uniform float uR;
uniform vec3 uSun; uniform vec3 uSunColor; uniform vec3 uSky; uniform vec3 uBase; uniform vec3 uTip;
attribute vec4 aSeed;
varying vec3 vColor;
#include <fog_pars_vertex>
void main() {
  vec2 p = (aSeed.xy - 0.5) * uBox;
  p = mod(p - uFocus.xz + uBox * 0.5, uBox) - uBox * 0.5 + uFocus.xz;
  float r = length(p);
  float edge = 1.0 - smoothstep(uBox * 0.36, uBox * 0.5, length(p - uFocus.xz));
  float field = smoothstep(uR * 0.98, uR * 1.12, r);
  float hgt = mix(0.07, 0.42, field) * (0.5 + aSeed.z * 0.9) * edge;
  float wid = mix(0.022, 0.04, field) * (0.7 + aSeed.w * 0.6);
  float ang = aSeed.w * 6.2831;
  float wind = sin(uTime * 1.6 + p.x * 0.18 + p.y * 0.11) * 0.5 + sin(uTime * 3.1 + p.x * 0.7) * 0.2;
  vec3 q = position;
  float bend = q.y * q.y * (0.25 + wind * 0.35);
  vec3 local = vec3(q.x * wid, q.y * hgt, q.z * hgt + bend * hgt);
  float c = cos(ang), s = sin(ang);
  local = vec3(local.x * c - local.z * s, local.y, local.x * s + local.z * c);
  vec3 wp = vec3(p.x, 0.0, p.y) + local;
  vec3 n = normalize(vec3(-s, 0.6, c));
  float lit = max(dot(n, uSun), 0.0) * 0.8 + 0.35;
  float tone = 0.8 + aSeed.z * 0.4;
  vColor = mix(uBase, uTip * tone, q.y) * (uSunColor * lit + uSky);
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: /* glsl */ `
varying vec3 vColor;
#include <fog_pars_fragment>
void main() {
  gl_FragColor = vec4(vColor, 1.0);
  #include <fog_fragment>
}`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = "grass";
  return { mesh, mat, geo, blade, uniforms: mat.uniforms };
}

export function buildArena(id: ArenaId, opts: ArenaOptions): Arena {
  const look = opts.look;
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
  const fogColor = new THREE.Color(look.fog);
  const sunDir = new THREE.Vector3();
  {
    const el = THREE.MathUtils.degToRad(look.sunElevation), az = THREE.MathUtils.degToRad(look.sunAzimuth);
    sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
  }
  // The ground reaches well past the battleground and rises toward the edge of the world.
  const outer = R * 3.4;
  const rise = (r: number) => {
    if (r <= R * 1.02) return 0;
    const k = (r - R * 1.02) / (outer - R);
    return k * k * R * (id === "colosseum" ? 0 : id === "volcano" ? 0.4 : id === "snowfield" ? 0.3 : 0.22);
  };
  const heightAt = (x: number, z: number) => {
    const r = Math.hypot(x, z);
    if (r <= R) return 0;
    const n = id === "colosseum" ? 0 : fbm(x * 0.02, z * 0.02) * Math.min(1, (r - R) / (R * 0.5)) * R * 0.08;
    return rise(r) + n;
  };
  const time = { value: 0 };
  const wet = { value: look.wet };
  const segs = 180;
  {
    // Rings of vertices: a polar grid so the middle is flat and the edge can rise.
    const rings = 56;
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
          const n = fbm(x * 0.09 - 2, z * 0.09 + 5);
          const ring = Math.min(1, r / (R * 1.05));
          col.push(0.9 + n * 0.12 - ring * 0.06, 0.86 + n * 0.1 - ring * 0.07, 0.8 + n * 0.08 - ring * 0.09);
        } else if (id === "plains") {
          // Greener in hollows, sun-bleached on rises.
          const n = fbm(x * 0.03 + 11, z * 0.03 - 5);
          col.push(v * (0.92 + n * 0.12), v * (1.0 + n * 0.05), v * (0.88 + n * 0.08));
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
      gm = new THREE.MeshStandardMaterial({ map: texture("leafy_grass", "diff", 1, true), normalMap: texture("leafy_grass", "nor", 1, false), roughness: 0.95, vertexColors: true, color: "#c8dc98" });
    } else if (id === "volcano") {
      gm = new THREE.MeshStandardMaterial({ map: texture("asphalt_02", "diff", 1, true), normalMap: texture("asphalt_02", "nor", 1, false), roughness: 0.88, vertexColors: true, color: "#4a3c3a" });
    } else if (id === "snowfield") {
      gm = new THREE.MeshStandardMaterial({ normalMap: texture("granite_tile", "nor", 0.5, false), normalScale: new THREE.Vector2(0.22, 0.22), roughness: 0.78, vertexColors: true, color: "#f2f6fb" });
    } else {
      gm = new THREE.MeshStandardMaterial({ normalMap: texture("granite_tile", "nor", 1.6, false), normalScale: new THREE.Vector2(0.45, 0.45), roughness: 0.97, vertexColors: true, color: "#e2c696" });
    }
    const ground = id;
    gm.onBeforeCompile = (s) => {
      s.uniforms.uTime = time;
      s.uniforms.uWet = wet;
      s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWorld;").replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      let colorPatch = "";
      let emissivePatch = "";
      if (ground === "plains") {
        // Patches of dry grass and bare earth, more where the battle stands (the battleground is trampled).
        colorPatch = `
float mbP = mbF(vWorld.xz * 0.045);
float mbDirt = smoothstep(0.7, 0.82, mbF(vWorld.xz * 0.11 + 3.0)) * 0.32;
float mbDry = smoothstep(0.45, 0.8, mbP);
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 1.04, 0.7), mbDry * 0.35);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.33, 0.22), mbDirt);
diffuseColor.rgb *= 0.88 + mbN(vWorld.xz * 0.6) * 0.2;`;
      } else if (ground === "volcano") {
        colorPatch = `
float mbC = mbF(vWorld.xz * 0.05);
diffuseColor.rgb *= 0.75 + mbC * 0.5;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.22, 0.16, 0.15), smoothstep(0.55, 0.75, mbF(vWorld.xz * 0.12 + 9.0)) * 0.5);`;
        // Lava: rivers along the noise's ridges flowing slowly, and glowing cracks; they keep off the battleground's middle.
        emissivePatch = `
float mbR = length(vWorld.xz);
vec2 mbFlow = vWorld.xz * 0.045 + vec2(uTime * 0.01, uTime * 0.006);
float mbN1 = mbF(mbFlow) ;
float mbRiver = 1.0 - smoothstep(0.0, 0.035, abs(mbN1 - 0.5));
float mbCrack = 1.0 - smoothstep(0.0, 0.012, abs(mbF(vWorld.xz * 0.21) - 0.5));
float mbPulse = 0.75 + 0.25 * sin(uTime * 1.3 + vWorld.x * 0.05 + vWorld.z * 0.03);
float mbAway = smoothstep(${(R * 0.45).toFixed(1)}, ${(R * 0.95).toFixed(1)}, mbR) * 0.85 + 0.15;
vec3 mbLava = mix(vec3(1.0, 0.18, 0.02), vec3(1.0, 0.62, 0.12), mbN(vWorld.xz * 0.8 + uTime * 0.3));
totalEmissiveRadiance += mbLava * (mbRiver * 3.2 * mbAway + mbCrack * 1.4) * mbPulse;
diffuseColor.rgb *= 1.0 - mbRiver * mbAway * 0.8;`;
      } else if (ground === "snowfield") {
        // Snow: soft drifts, blue in the hollows, glittering crystals that catch the light as the camera moves.
        colorPatch = `
float mbD = mbF(vWorld.xz * 0.06);
diffuseColor.rgb *= mix(vec3(0.82, 0.88, 0.98), vec3(1.0), smoothstep(0.3, 0.7, mbD));`;
        emissivePatch = `
vec2 mbCell = floor(vWorld.xz * 9.0);
float mbG = mbH(mbCell);
vec3 mbV = normalize(cameraPosition - vWorld);
float mbGl = step(0.985, mbG) * pow(max(0.0, sin(dot(mbV, vec3(mbG * 40.0, mbG * 17.0, mbG * 29.0)) * 3.0)), 8.0);
totalEmissiveRadiance += vec3(1.0) * mbGl * 2.5 * (1.0 - smoothstep(10.0, 40.0, distance(cameraPosition, vWorld)));`;
      } else {
        // Sand: drifts of colour, raked rings close up, darker trampled patches, and a Poké Ball raked into the floor.
        const e = (R * 0.42).toFixed(2), lw = Math.max(0.25, R * 0.011).toFixed(3), c0 = (R * 0.1).toFixed(2), c1 = (R * 0.06).toFixed(2), rim = (R * 0.985).toFixed(2);
        colorPatch = `
float mbSand = mbN(vWorld.xz * 0.07) * 0.5 + mbN(vWorld.xz * 0.31 + 3.7) * 0.3 + mbN(vWorld.xz * 1.1 - 1.3) * 0.2;
float mbClose = 1.0 - smoothstep(18.0, 55.0, distance(cameraPosition, vWorld));
float mbRake = sin(length(vWorld.xz) * 4.2 + mbN(vWorld.xz * 0.2) * 6.0) * mbClose;
diffuseColor.rgb *= 0.8 + mbSand * 0.3 + mbRake * 0.025;
float mbTr = smoothstep(0.5, 0.8, mbF(vWorld.xz * 0.05 + 2.0));
diffuseColor.rgb *= 1.0 - mbTr * 0.12;
float mbRr = length(vWorld.xz);
float mbLine = 1.0 - smoothstep(${lw} * 0.6, ${lw}, abs(mbRr - ${e}));
mbLine = max(mbLine, (1.0 - smoothstep(${lw} * 0.6, ${lw}, abs(vWorld.z))) * step(${c0}, abs(vWorld.x)) * step(abs(vWorld.x), ${e}));
mbLine = max(mbLine, 1.0 - smoothstep(${lw} * 0.6, ${lw}, abs(mbRr - ${c0})));
mbLine = max(mbLine, 1.0 - smoothstep(${c1} - ${lw}, ${c1}, mbRr));
mbLine = max(mbLine, (1.0 - smoothstep(${lw} * 1.2, ${lw} * 2.0, abs(mbRr - ${rim}))) * 0.8);
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.72, 0.66, 0.6), mbLine * 0.85);`;
      }
      s.fragmentShader = s.fragmentShader
        .replace("#include <common>", `#include <common>\nuniform float uTime;\nuniform float uWet;\nvarying vec3 vWorld;\n${NOISE_GLSL}`)
        .replace("#include <color_fragment>", `#include <color_fragment>\n${colorPatch}\n// Rain darkens the ground.\ndiffuseColor.rgb *= 1.0 - uWet * 0.28;`)
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.32, uWet * smoothstep(0.35, 0.6, mbN(vWorld.xz * 0.12)) );")
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${emissivePatch}`);
    };
    gm.customProgramCacheKey = () => `mb-ground-${ground}`;
    mats.push(gm);
    const mesh = new THREE.Mesh(g, gm);
    mesh.receiveShadow = true;
    mesh.name = "ground";
    group.add(mesh);
    disposables.push(g, gm);
  }
  // Sky dome.
  const skyMat = skyMaterial(look, sunDir, fogColor);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(outer * 2.2, 48, 24), skyMat);
  {
    const g = sky.geometry;
    sky.name = "sky";
    sky.renderOrder = -1;
    sky.frustumCulled = false;
    group.add(sky);
    mats.push(skyMat);
    disposables.push(g, skyMat);
  }
  // Light: the sun (or moon) casts the shadows; the sky and ground fill.
  const sun = new THREE.DirectionalLight(look.sun, look.sunIntensity);
  sun.position.copy(sunDir).multiplyScalar(R * 2);
  group.add(sun);
  group.add(sun.target);
  const hemi = new THREE.HemisphereLight(look.hemiSky, look.hemiGround, look.hemiIntensity);
  group.add(hemi);

  const rand = seeded(id.length * 7919 + Math.round(R));
  const animated: ((t: number, focus: THREE.Vector3, camera: THREE.Camera) => void)[] = [];
  const scatterRing = (count: number, r0: number, r1: number, make: (x: number, z: number, s: number, k: number) => void) => {
    for (let k = 0; k < count; k++) {
      const a = rand() * Math.PI * 2;
      const r = r0 + (r1 - r0) * Math.sqrt(rand());
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      make(x, z, 0.7 + rand() * 0.8, k);
    }
  };
  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, count: number, shadow = false) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
    m.count = 0;
    m.castShadow = shadow;
    m.receiveShadow = shadow;
    group.add(m);
    disposables.push(geo, mat as unknown as { dispose(): void });
    mats.push(mat);
    return m;
  };
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), E = new THREE.Euler();
  const put = (im: THREE.InstancedMesh, x: number, y: number, z: number, s: number, yaw = 0, color?: THREE.Color, sy = s) => {
    E.set(0, yaw, 0);
    Q.setFromEuler(E);
    P.set(x, y, z);
    S.set(s, sy, s);
    M.compose(P, Q, S);
    im.setMatrixAt(im.count, M);
    if (color) im.setColorAt(im.count, color);
    im.count++;
  };
  const props = opts.props;

  // Mountains on the horizon (not over the colosseum's walls).
  if (id !== "colosseum") {
    const ring = 160, rows = 7;
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const baseR = outer * 1.35;
    const peakH = R * (id === "volcano" ? 0.9 : id === "snowfield" ? 1.1 : 0.7);
    const rock = new THREE.Color(id === "volcano" ? "#2a1c1a" : id === "snowfield" ? "#6a7a90" : "#5a7a6a");
    const snowC = new THREE.Color("#f4f8ff");
    for (let j = 0; j < rows; j++) {
      const v = j / (rows - 1);
      for (let s = 0; s <= ring; s++) {
        const a = (s / ring) * Math.PI * 2;
        const n = fbm(Math.cos(a) * 3 + 5, Math.sin(a) * 3 + 2) * 0.7 + fbm(Math.cos(a) * 9, Math.sin(a) * 9) * 0.3;
        const ridge = Math.pow(n, 1.6) * peakH * 1.6;
        const r = baseR + v * R * 0.8 - v * v * R * 0.4;
        const hgt = Math.max(0, ridge * Math.sin(v * Math.PI * 0.5)) * (1 - v * 0.15) - R * 0.15 * (1 - v);
        pos.push(Math.cos(a) * r, hgt, Math.sin(a) * r);
        const snowy = (id === "snowfield" || id === "plains") && hgt > peakH * (id === "snowfield" ? 0.45 : 0.85) ? 1 : 0;
        const c = rock.clone().lerp(snowC, snowy * 0.9).multiplyScalar(0.8 + n * 0.4);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let j = 0; j < rows - 1; j++) for (let s = 0; s < ring; s++) {
      const a = j * (ring + 1) + s, b = a + ring + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, m);
    mesh.name = "mountains";
    group.add(mesh);
    disposables.push(g, m);
    mats.push(m);
  }

  let grass: ReturnType<typeof grassField> | null = null;
  if (id === "plains" && opts.grass > 0) {
    grass = grassField(Math.round(opts.grass), R, look, sunDir, rand);
    group.add(grass.mesh);
    disposables.push(grass.geo, grass.blade, grass.mat);
    mats.push(grass.mat);
    const u = grass.uniforms;
    animated.push((t, f) => {
      u.uTime.value = t;
      u.uFocus.value.copy(f);
    });
  }

  if (id === "plains" || id === "snowfield") {
    // Trees round the battleground (snow-laden pines on the snowfield), rocks, and flowers on the plains.
    const pine = id === "snowfield";
    const trunk = new THREE.CylinderGeometry(0.18, 0.3, 2.2, 6).translate(0, 1.1, 0);
    const crownGeo = pine ? mergeCones() : mergeCrowns();
    const trunkMat = new THREE.MeshStandardMaterial({ color: "#5a3e2a", roughness: 0.95 });
    const crownMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.9, flatShading: true, vertexColors: true });
    const nTrees = Math.round(300 * props);
    const trunks = instanced(trunk, trunkMat, nTrees), crowns = instanced(crownGeo, crownMat, nTrees);
    const tint = new THREE.Color();
    scatterRing(nTrees, R * 1.15, R * 2.8, (x, z, s) => {
      const y = heightAt(x, z);
      const sc = s * (1.5 + R * 0.006);
      const yaw = rand() * 6;
      put(trunks, x, y - 0.2, z, sc, yaw);
      tint.setHSL(pine ? 0.38 : 0.24 + rand() * 0.08, pine ? 0.1 : 0.45, pine ? 0.9 : 0.55 + rand() * 0.15);
      put(crowns, x, y - 0.2, z, sc, yaw, tint);
    });
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: pine ? "#c8d4e0" : "#8d8a80", roughness: 1, flatShading: true });
    const nRocks = Math.round(140 * props);
    const rocks = instanced(rockGeo, rockMat, nRocks);
    scatterRing(nRocks, R * 0.98, R * 2.3, (x, z, s) => put(rocks, x, heightAt(x, z) - 0.25, z, s * 1.1, rand() * 6, undefined, s * 0.7));
    if (!pine) {
      // Flowers in clumps beyond the battleground.
      const flower = new THREE.IcosahedronGeometry(0.09, 0).translate(0, 0.16, 0);
      const flowerMat = new THREE.MeshStandardMaterial({ roughness: 0.7, emissive: "#000000" });
      const nFlowers = Math.round(2600 * props);
      const flowers = instanced(flower, flowerMat, nFlowers);
      const colors = ["#ffd84a", "#ff7ab0", "#ffffff", "#c89aff", "#ff8a4a"].map((c) => new THREE.Color(c));
      let made = 0;
      while (made < nFlowers) {
        const a = rand() * Math.PI * 2, r = R * (1.05 + rand() * 1.1);
        const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
        const c = colors[Math.floor(rand() * colors.length)];
        const n = 8 + Math.floor(rand() * 14);
        for (let k = 0; k < n && made < nFlowers; k++, made++) {
          const x = cx + (rand() - 0.5) * 4, z = cz + (rand() - 0.5) * 4;
          put(flowers, x, heightAt(x, z), z, 0.8 + rand() * 0.6, 0, c);
        }
      }
      if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
    } else {
      // Ice crystals poking out of the snow.
      const ice = new THREE.ConeGeometry(0.35, 2.2, 5).translate(0, 1.0, 0);
      const iceMat = new THREE.MeshStandardMaterial({ color: "#bfe8ff", roughness: 0.15, metalness: 0.1, emissive: "#3a7aa0", emissiveIntensity: 0.25, flatShading: true });
      const nIce = Math.round(80 * props);
      const ices = instanced(ice, iceMat, nIce * 3);
      scatterRing(nIce, R * 1.02, R * 1.9, (x, z, s) => {
        const y = heightAt(x, z);
        for (let k = 0; k < 3; k++) put(ices, x + (rand() - 0.5) * 2, y - 0.2, z + (rand() - 0.5) * 2, s * (0.5 + rand() * 0.7), rand() * 6);
      });
    }
  }

  if (id === "volcano") {
    // The cone on the horizon with a glowing crater and a column of smoke.
    const cone = new THREE.ConeGeometry(R * 1.1, R * 0.95, 48, 8, true);
    {
      const p = cone.getAttribute("position");
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const n = fbm(x * 0.05 + 3, z * 0.05 + y * 0.03);
        p.setXYZ(i, x * (0.92 + n * 0.2), y, z * (0.92 + n * 0.2));
      }
      cone.computeVertexNormals();
    }
    const coneMat = new THREE.MeshStandardMaterial({ color: "#2a1d1a", roughness: 1, flatShading: true, emissive: "#ff3a0a", emissiveIntensity: 0 });
    coneMat.onBeforeCompile = (s) => {
      s.uniforms.uTime = time;
      s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nvarying float vY;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvY = position.y;");
      s.fragmentShader = s.fragmentShader
        .replace("#include <common>", `#include <common>\nuniform float uTime;\nvarying float vY;`)
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n// Lava running down from the crater.\nfloat mbLv = smoothstep(${(R * 0.2).toFixed(2)}, ${(R * 0.47).toFixed(2)}, vY) * (0.5 + 0.5 * sin(vY * 0.4 - uTime * 0.6 + gl_FragCoord.x * 0.002));\ntotalEmissiveRadiance += vec3(1.0, 0.25, 0.04) * mbLv * 1.6;`);
    };
    coneMat.customProgramCacheKey = () => "mb-volcano-cone";
    const c = new THREE.Mesh(cone, coneMat);
    const vx = -R * 2.1, vz = -R * 2.4, vy = R * 0.3;
    c.position.set(vx, vy, vz);
    group.add(c);
    const crater = new THREE.Mesh(new THREE.CircleGeometry(R * 0.16, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.2, 0.25) }));
    crater.position.set(vx, vy + R * 0.47, vz);
    group.add(crater);
    disposables.push(cone, coneMat, crater.geometry, crater.material as THREE.Material);
    mats.push(coneMat, crater.material as THREE.Material);
    // The smoke column: soft dark puffs rising and spreading, lit red from below.
    const nPuffs = Math.round(70 * Math.max(0.4, props));
    const puff = new THREE.IcosahedronGeometry(1, 1);
    const pg = new THREE.InstancedBufferGeometry();
    pg.index = puff.index;
    pg.setAttribute("position", puff.getAttribute("position"));
    pg.setAttribute("normal", puff.getAttribute("normal"));
    const ps = new Float32Array(nPuffs * 4);
    for (let k = 0; k < nPuffs; k++) ps.set([rand(), rand(), rand(), k / nPuffs], k * 4);
    pg.setAttribute("aSeed", new THREE.InstancedBufferAttribute(ps, 4));
    pg.instanceCount = nPuffs;
    const pm = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uBase: { value: new THREE.Vector3(vx, vy + R * 0.47, vz) }, uR: { value: R } }]),
      vertexShader: /* glsl */ `
uniform float uTime; uniform vec3 uBase; uniform float uR;
attribute vec4 aSeed;
varying float vA; varying float vH; varying float vF;
#include <fog_pars_vertex>
void main() {
  float k = fract(aSeed.w + uTime * 0.018);
  float hgt = k * uR * 2.2;
  vec3 c = uBase + vec3((aSeed.x - 0.5) * uR * 0.25 * (0.3 + k * 2.0) + k * k * uR * 0.8, hgt, (aSeed.y - 0.5) * uR * 0.25 * (0.3 + k * 2.0));
  float size = uR * (0.1 + k * 0.38) * (0.7 + aSeed.z * 0.6);
  vec3 wp = c + position * size;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  vec3 n = normalize(mat3(viewMatrix) * normal);
  vF = max(dot(n, normalize(-mvPosition.xyz)), 0.0);
  vA = smoothstep(0.0, 0.08, k) * (1.0 - smoothstep(0.6, 1.0, k));
  vH = k;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
      fragmentShader: /* glsl */ `
varying float vA; varying float vH; varying float vF;
#include <fog_pars_fragment>
void main() {
  float a = vA * smoothstep(0.0, 0.8, vF) * 0.8;
  if (a < 0.005) discard;
  vec3 col = mix(vec3(0.9, 0.3, 0.08) * 1.6, vec3(0.12, 0.09, 0.09), smoothstep(0.0, 0.25, vH));
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
}`,
    });
    const smokeMesh = new THREE.Mesh(pg, pm);
    smokeMesh.frustumCulled = false;
    smokeMesh.renderOrder = 2;
    group.add(smokeMesh);
    disposables.push(pg, puff, pm);
    mats.push(pm);
    animated.push((t) => (pm.uniforms.uTime.value = t));
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: "#2b2422", roughness: 0.95, flatShading: true });
    const nRocks = Math.round(220 * props);
    const rocks = instanced(rockGeo, rockMat, nRocks);
    scatterRing(nRocks, R * 0.98, R * 2.4, (x, z, s) => put(rocks, x, heightAt(x, z) - 0.3, z, s * 1.6, rand() * 6, undefined, s * 1.1));
    // Obsidian spires.
    const spire = new THREE.ConeGeometry(0.6, 4, 5).translate(0, 1.8, 0);
    const spireMat = new THREE.MeshStandardMaterial({ color: "#151018", roughness: 0.25, metalness: 0.3, flatShading: true });
    const nSp = Math.round(60 * props);
    const spires = instanced(spire, spireMat, nSp);
    scatterRing(nSp, R * 1.05, R * 2, (x, z, s) => put(spires, x, heightAt(x, z) - 0.3, z, s * 1.2, rand() * 6, undefined, s * (1 + rand())));
  }

  let crowdMat: THREE.MeshStandardMaterial | null = null;
  const excite = { value: 0.3 };
  if (id === "colosseum") {
    // A stone wall round the floor, arches on top, tiers of seats, and a crowd that cheers.
    const wallH = Math.max(3, R * 0.06);
    const wall = new THREE.CylinderGeometry(R * 1.08, R * 1.08, wallH, 128, 1, true).translate(0, wallH / 2, 0);
    const stone = new THREE.MeshStandardMaterial({ map: texture("sandstone_blocks_08", "diff", 1, true), normalMap: texture("sandstone_blocks_08", "nor", 1, false), roughness: 0.9, side: THREE.DoubleSide, color: "#efe0c4" });
    const wm = new THREE.Mesh(wall, stone);
    wm.receiveShadow = true;
    group.add(wm);
    const tiers = 10;
    const pts: THREE.Vector2[] = [];
    for (let k = 0; k <= tiers; k++) {
      const r = R * 1.08 + k * R * 0.07;
      const y = wallH + k * R * 0.045;
      pts.push(new THREE.Vector2(r, y), new THREE.Vector2(r + R * 0.07, y));
    }
    const topR = R * 1.08 + tiers * R * 0.07 + R * 0.07, topY = wallH + tiers * R * 0.045;
    pts.push(new THREE.Vector2(topR, topY + R * 0.2));
    const seats = new THREE.LatheGeometry(pts, 128);
    const sm = new THREE.Mesh(seats, stone);
    sm.receiveShadow = true;
    group.add(sm);
    disposables.push(wall, seats, stone);
    mats.push(stone);
    // Arches round the top: piers and lintels.
    const pier = new THREE.BoxGeometry(R * 0.035, R * 0.22, R * 0.05).translate(0, R * 0.11, 0);
    const pierMat = new THREE.MeshStandardMaterial({ color: "#e8d6b4", roughness: 0.92 });
    const nPiers = 72;
    const piers = instanced(pier, pierMat, nPiers);
    for (let k = 0; k < nPiers; k++) {
      const a = (k / nPiers) * Math.PI * 2;
      put(piers, Math.cos(a) * (topR - R * 0.02), topY + R * 0.18, Math.sin(a) * (topR - R * 0.02), 1, -a);
    }
    const lintel = new THREE.TorusGeometry(topR - R * 0.02, R * 0.018, 4, 144).rotateX(Math.PI / 2);
    const lm = new THREE.Mesh(lintel, pierMat);
    lm.position.y = topY + R * 0.4;
    group.add(lm);
    disposables.push(lintel);
    // Spectators: a body, a head and two arms each, coloured, jumping and waving to their own beat.
    const person = mergeGeometries([
      new THREE.CylinderGeometry(0.22, 0.27, 0.75, 6).translate(0, 0.375, 0),
      new THREE.IcosahedronGeometry(0.19, 0).translate(0, 0.95, 0),
      new THREE.BoxGeometry(0.1, 0.5, 0.1).translate(-0.3, 0.95, 0),
      new THREE.BoxGeometry(0.1, 0.5, 0.1).translate(0.3, 0.95, 0),
    ]);
    crowdMat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    crowdMat.onBeforeCompile = (s) => {
      s.uniforms.uTime = time;
      s.uniforms.uExcite = excite;
      s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uExcite;").replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
float ph = instanceMatrix[3][0] * 0.37 + instanceMatrix[3][2] * 0.61;
float beat = 6.0 + fract(ph * 3.1) * 3.0;
float jump = max(0.0, sin(uTime * beat + ph * 5.0));
transformed.y += jump * (0.1 + uExcite * 0.4);
// Arms wave overhead (the arms are the parts out to the side, up high).
if (abs(position.x) > 0.24 && position.y > 0.6) {
  float wave = sin(uTime * (beat * 0.7) + ph * 3.0) * (0.3 + uExcite * 0.5);
  float up = (position.y - 0.7) * (0.6 + uExcite);
  transformed.x += sign(position.x) * up * 0.25 + wave * (position.y - 0.7) * 0.6;
  transformed.y += up * 0.8;
}`
      );
    };
    crowdMat.customProgramCacheKey = () => "mb-crowd-v2";
    const scale = Math.max(1, R * 0.018);
    const perTier = Math.round((Math.PI * 2 * R * 1.1) / (0.9 * scale));
    const total = Math.round(tiers * perTier * Math.min(1, props));
    const crowd = instanced(person, crowdMat, total);
    const palette = ["#e0483e", "#f2b632", "#3e7be0", "#4fb86a", "#f4f1e8", "#9a5ae0", "#f07ab0", "#2c2c38", "#ff8a3a", "#40c8d8"].map((c) => new THREE.Color(c));
    for (let k = 0; k < tiers; k++) {
      for (let s = 0; s < perTier; s++) {
        if (crowd.count >= total) break;
        if (rand() > props * 0.94) continue;
        const a = (s / perTier) * Math.PI * 2 + rand() * 0.01;
        const r = R * 1.08 + k * R * 0.07 + R * 0.035;
        const y = wallH + (k + 1) * R * 0.045 - R * 0.045 + 0.02;
        put(crowd, Math.cos(a) * r, y, Math.sin(a) * r, scale * (0.85 + rand() * 0.3), -a - Math.PI / 2, palette[Math.floor(rand() * palette.length)]);
      }
    }
    if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
    // Banners on the wall in the armies' colours, and torches between them.
    const banner = new THREE.PlaneGeometry(wallH * 0.5, wallH * 0.9, 1, 6);
    const bannerMats = ["#d8382e", "#2e6bd0"].map((c) => {
      const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, side: THREE.DoubleSide });
      m.onBeforeCompile = (s) => {
        s.uniforms.uTime = time;
        s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTime;").replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed.z += sin(uTime * 2.0 + position.y * 2.0 + modelMatrix[3][0]) * 0.06 * (0.5 - position.y / " + (wallH * 0.9).toFixed(2) + ");");
      };
      m.customProgramCacheKey = () => "mb-banner";
      return m;
    });
    const torchGeo = new THREE.CylinderGeometry(0.08, 0.12, wallH * 0.35, 6);
    const torchMat = new THREE.MeshStandardMaterial({ color: "#3a2a1a", roughness: 0.9 });
    const flameGeo = new THREE.IcosahedronGeometry(1, 1);
    const flameMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: time },
      vertexShader: /* glsl */ `
uniform float uTime;
varying float vF;
void main() {
  vec3 p = position;
  float ph = modelMatrix[3][0] * 1.7 + modelMatrix[3][2];
  p.y *= 1.6 + 0.3 * sin(uTime * 13.0 + ph);
  p.y += max(0.0, p.y) * 0.4;
  p.x += sin(uTime * 9.0 + p.y * 4.0 + ph) * 0.12 * max(0.0, p.y);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vF = max(dot(normalize(mat3(modelViewMatrix) * normal), normalize(-mv.xyz)), 0.0);
  gl_Position = projectionMatrix * mv;
}`,
      fragmentShader: "varying float vF; void main(){ float a = pow(vF, 1.5); gl_FragColor = vec4(vec3(3.2, 1.3, 0.3) * a, a); }",
    });
    disposables.push(banner, ...bannerMats, torchGeo, torchMat, flameGeo, flameMat);
    mats.push(...bannerMats, torchMat, flameMat);
    const nBanners = 20;
    for (let k = 0; k < nBanners; k++) {
      const a = (k / nBanners) * Math.PI * 2;
      const b = new THREE.Mesh(banner, bannerMats[k % 2]);
      b.position.set(Math.cos(a) * R * 1.075, wallH * 0.5, Math.sin(a) * R * 1.075);
      b.lookAt(0, wallH * 0.5, 0);
      group.add(b);
      const ta = a + Math.PI / nBanners;
      const torch = new THREE.Mesh(torchGeo, torchMat);
      torch.position.set(Math.cos(ta) * R * 1.07, wallH * 0.75, Math.sin(ta) * R * 1.07);
      group.add(torch);
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.scale.setScalar(Math.max(0.25, wallH * 0.07));
      flame.position.set(Math.cos(ta) * R * 1.07, wallH * 0.75 + wallH * 0.2, Math.sin(ta) * R * 1.07);
      flame.renderOrder = 4;
      group.add(flame);
    }
  }

  const groundMat = mats[0];
  void groundMat;
  animated.push((t, _f, cam) => {
    time.value = t;
    skyMat.uniforms.uTime.value = t;
    // The sky stays centred on the camera: it is at infinity.
    sky.position.copy(cam.position);
  });

  const dust = new THREE.Color(id === "plains" ? "#9a8a64" : id === "volcano" ? "#4a3a36" : id === "snowfield" ? "#f4f8ff" : "#d8bc8a");

  return {
    group,
    look,
    sun,
    hemi,
    sunDir,
    heightAt,
    dust,
    update(t, focus, camera) {
      for (const f of animated) f(t, focus, camera);
      excite.value += (0.3 - excite.value) * 0.01;
    },
    cheer(level) {
      excite.value = Math.max(excite.value, Math.min(1, level));
    },
    materials: () => mats,
    ready: Promise.all(loads).then(() => undefined),
    dispose() {
      for (const d of disposables) d.dispose();
      void crowdMat;
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

/** A leafy tree's crown: three lumps of foliage, lighter on top. */
function mergeCrowns(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const lumps: [number, number, number, number][] = [[0, 3.4, 0, 1.9], [0.9, 2.9, 0.4, 1.3], [-0.8, 3.0, -0.5, 1.4], [0.1, 4.4, 0.1, 1.2]];
  for (const [x, y, z, r] of lumps) {
    const c = new THREE.IcosahedronGeometry(r, 1).translate(x, y, z);
    const pos = c.getAttribute("position");
    const col: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const k = Math.min(1, Math.max(0, (pos.getY(i) - 2) / 3.5));
      col.push(0.55 + k * 0.45, 0.65 + k * 0.35, 0.5 + k * 0.35);
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
    const P = p.getAttribute("position"), N = p.getAttribute("normal"), C = p.getAttribute("color");
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i));
      nor.push(N.getX(i), N.getY(i), N.getZ(i));
      if (withColor) col.push(C.getX(i), C.getY(i), C.getZ(i));
    }
    if (p.index) for (let i = 0; i < p.index.count; i++) idx.push(p.index.getX(i) + base);
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
