import * as THREE from "three";
import type { Vec3 } from "@/lib/world-history/camera";

/**
 * The museum's effects kit, shared by every chapter: procedural skies and
 * nebulae, GPU particles (embers, dust, stars, snow, sparks, motes that
 * converge into a figure), velocity streaks (rain, meteors, warp), light
 * shafts, lightning, an ocean with Gerstner waves, heightfield terrain with
 * glowing lava cracks, shockwave rings, glow halos, storm clouds, flames and
 * wormholes. Everything is a pure function of the clocks it is given, so a
 * scrubbed film and an exported video draw the same frames.
 */

export const NOISE = /* glsl */ `
float whHash(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float whNoise(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(whHash(i), whHash(i + vec3(1,0,0)), f.x), mix(whHash(i + vec3(0,1,0)), whHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(whHash(i + vec3(0,0,1)), whHash(i + vec3(1,0,1)), f.x), mix(whHash(i + vec3(0,1,1)), whHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float whFbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * whNoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
float whFbm3(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++){ s += a * whNoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
vec3 whHash3(float n){ return fract(sin(vec3(n, n + 1.31, n + 2.77)) * vec3(43758.5453, 22578.1459, 19642.3490)); }
`;

export const v3 = (v: Vec3) => new THREE.Vector3(v[0], v[1], v[2]);
export const col = (hex: string | number, k = 1) => new THREE.Color(hex).multiplyScalar(k);

/** A deterministic random stream (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** JS value noise and fbm (terrain, layouts). */
export function noise2(seed = 1) {
  const r = rng(seed);
  const perm = new Uint16Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const val = new Float32Array(256).map(() => r());
  const at = (x: number, y: number) => val[perm[(perm[x & 255] + y) & 511] & 255];
  const n = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const fbm = (x: number, y: number, oct = 5) => {
    let s = 0, amp = 0.5, f = 1;
    for (let i = 0; i < oct; i++) { s += amp * n(x * f, y * f); f *= 2.03; amp *= 0.5; }
    return s;
  };
  return { n, fbm };
}

// ---------------------------------------------------------------------------
// Sky
// ---------------------------------------------------------------------------

export interface SkyOpts {
  top: string; horizon: string; bottom: string;
  nebulaA?: string; nebulaB?: string; nebula?: number; nebulaScale?: number;
  stars?: number; sunDir?: Vec3; sunColor?: string; sunSize?: number; sunGlow?: number;
  swirl?: number; brightness?: number;
}

export function makeSky(o: SkyOpts) {
  const u = {
    uTime: { value: 0 },
    uTop: { value: col(o.top) }, uHorizon: { value: col(o.horizon) }, uBottom: { value: col(o.bottom) },
    uNebA: { value: col(o.nebulaA ?? "#000000") }, uNebB: { value: col(o.nebulaB ?? "#000000") },
    uNeb: { value: o.nebula ?? 0 }, uNebScale: { value: o.nebulaScale ?? 2.2 },
    uStars: { value: o.stars ?? 0 },
    uSunDir: { value: v3(o.sunDir ?? [0, 0.3, -1]).normalize() }, uSunColor: { value: col(o.sunColor ?? "#000000") },
    uSunSize: { value: o.sunSize ?? 900 }, uSunGlow: { value: o.sunGlow ?? 0 },
    uSwirl: { value: o.swirl ?? 0 }, uFlash: { value: 0 }, uFlashColor: { value: col("#cfd8ff") },
    uBright: { value: o.brightness ?? 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform float uTime, uNeb, uNebScale, uStars, uSunSize, uSunGlow, uSwirl, uFlash, uBright;
      uniform vec3 uTop, uHorizon, uBottom, uNebA, uNebB, uSunDir, uSunColor, uFlashColor;
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 c = h > 0.0 ? mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(uHorizon, uBottom, pow(clamp(-h, 0.0, 1.0), 0.45));
        if (uNeb > 0.0) {
          float a = uSwirl * (1.0 - abs(h)) * (1.2 + 0.25 * sin(uTime * 0.05)) + uTime * 0.01 * uSwirl;
          vec3 q = vec3(d.x * cos(a) - d.z * sin(a), d.y, d.x * sin(a) + d.z * cos(a));
          float n = whFbm(q * uNebScale + vec3(0.0, uTime * 0.004, 0.0));
          float m = whFbm(q * uNebScale * 2.1 + 5.3);
          float dens = smoothstep(0.42, 0.9, n) * (0.55 + 0.6 * m);
          c += mix(uNebA, uNebB, smoothstep(0.3, 0.75, m)) * dens * uNeb;
        }
        if (uStars > 0.0) {
          vec3 sd = d * 340.0;
          vec3 cell = floor(sd);
          float r = whHash(cell);
          vec3 jit = vec3(whHash(cell + 3.1), whHash(cell + 7.7), whHash(cell + 1.9)) - 0.5;
          float dist = length(fract(sd) - 0.5 - jit * 0.6);
          float tw = 0.65 + 0.35 * sin(uTime * (1.5 + r * 3.0) + r * 60.0);
          float star = step(1.0 - uStars, r) * smoothstep(0.32, 0.0, dist) * tw;
          c += star * mix(vec3(1.0, 0.85, 0.7), vec3(0.7, 0.85, 1.0), whHash(cell + 9.0)) * 2.4;
        }
        float s = max(dot(d, uSunDir), 0.0);
        c += uSunColor * (pow(s, uSunSize) * 14.0 + pow(s, 7.0) * uSunGlow);
        c += uFlashColor * uFlash * (0.4 + 0.6 * smoothstep(-0.2, 0.6, h));
        gl_FragColor = vec4(c * uBright, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return {
    mesh,
    u,
    /** Keeps the dome around the camera (infinitely far). */
    follow(cam: THREE.Camera) { mesh.position.copy(cam.position); },
    dispose() { mesh.geometry.dispose(); mat.dispose(); },
  };
}

// ---------------------------------------------------------------------------
// GPU particles
// ---------------------------------------------------------------------------

export interface ParticleOpts {
  count: number;
  /** Spawn volume: a box (half extents), a sphere/shell (radius), a disc (radius, in xz), a cylinder (radius, half height). */
  shape: "box" | "sphere" | "shell" | "disc" | "cylinder";
  center: Vec3;
  extent: Vec3;
  velocity?: Vec3;
  spread?: Vec3;
  gravity?: Vec3;
  life: number;
  size: [number, number];
  colors: [string, string, string];
  intensity?: number;
  turbulence?: number;
  /** Spin around the y axis through the centre (radians per second). */
  swirl?: number;
  /** Pull toward the centre (units per second², shells and spheres). */
  pull?: number;
  fadeIn?: number;
  fadeOut?: number;
  additive?: boolean;
  /** Flicker amount (embers). */
  flicker?: number;
  seed?: number;
}

export function makeParticles(o: ParticleOpts) {
  const n = Math.max(1, Math.round(o.count));
  const r = rng(o.seed ?? 11);
  const seeds = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) seeds[i] = r();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
  const shapeId = { box: 0, sphere: 1, shell: 2, disc: 3, cylinder: 4 }[o.shape];
  const u = {
    uTime: { value: 0 }, uLife: { value: o.life },
    uCenter: { value: v3(o.center) }, uExtent: { value: v3(o.extent) },
    uVel: { value: v3(o.velocity ?? [0, 0, 0]) }, uSpread: { value: v3(o.spread ?? [0, 0, 0]) }, uGravity: { value: v3(o.gravity ?? [0, 0, 0]) },
    uSize0: { value: o.size[0] }, uSize1: { value: o.size[1] },
    uC0: { value: col(o.colors[0]) }, uC1: { value: col(o.colors[1]) }, uC2: { value: col(o.colors[2]) },
    uIntensity: { value: o.intensity ?? 1 }, uOpacity: { value: 1 },
    uTurb: { value: o.turbulence ?? 0 }, uSwirl: { value: o.swirl ?? 0 }, uPull: { value: o.pull ?? 0 },
    uFadeIn: { value: o.fadeIn ?? 0.15 }, uFadeOut: { value: o.fadeOut ?? 0.35 },
    uFlicker: { value: o.flicker ?? 0 }, uPixel: { value: 600 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: o.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
    defines: { SHAPE: shapeId },
    vertexShader: /* glsl */ `
      ${NOISE}
      attribute vec4 aSeed;
      uniform float uTime, uLife, uSize0, uSize1, uTurb, uSwirl, uPull, uPixel;
      uniform vec3 uCenter, uExtent, uVel, uSpread, uGravity;
      varying float vAge; varying float vSeed;
      void main(){
        float t = uTime / uLife + aSeed.w;
        float cyc = floor(t); float age = fract(t);
        vec3 r = whHash3(dot(aSeed.xyz, vec3(12.9898, 78.233, 37.719)) + cyc * 1.618);
        vec3 r2 = whHash3(aSeed.x * 91.7 + cyc * 3.3);
        vec3 p;
        #if SHAPE == 0
          p = (r * 2.0 - 1.0) * uExtent;
        #elif SHAPE == 1 || SHAPE == 2
          float th = r.x * 6.2831853; float ph = acos(2.0 * r.y - 1.0);
          float rad = SHAPE == 1 ? pow(r.z, 0.33) : mix(0.85, 1.0, r.z);
          p = vec3(sin(ph) * cos(th), cos(ph), sin(ph) * sin(th)) * rad * uExtent;
        #elif SHAPE == 3
          float th = r.x * 6.2831853; float rad = sqrt(r.y);
          p = vec3(cos(th) * rad * uExtent.x, (r.z * 2.0 - 1.0) * uExtent.y, sin(th) * rad * uExtent.z);
        #else
          float th = r.x * 6.2831853; float rad = sqrt(r.y);
          p = vec3(cos(th) * rad * uExtent.x, (r.z * 2.0 - 1.0) * uExtent.y, sin(th) * rad * uExtent.z);
        #endif
        float a = age * uLife;
        vec3 vel = uVel + (r2 * 2.0 - 1.0) * uSpread;
        p += vel * a + 0.5 * uGravity * a * a;
        if (uPull != 0.0) p -= normalize(p + 1e-4) * min(length(p) * 0.98, 0.5 * uPull * a * a);
        if (uTurb > 0.0) p += uTurb * (vec3(whNoise(p * 0.15 + a * 0.3 + r * 9.0), whNoise(p * 0.15 + 4.0 + a * 0.3), whNoise(p * 0.15 + 8.0 - a * 0.3)) - 0.5) * 2.0;
        if (uSwirl != 0.0) { float s = uSwirl * a + uSwirl * uTime * 0.0; float cs = cos(s), sn = sin(s); p.xz = mat2(cs, -sn, sn, cs) * p.xz; }
        p += uCenter;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(mix(uSize0, uSize1, r2.y) * uPixel / max(0.05, -mv.z), 0.0, 96.0);
        vAge = age; vSeed = r.x;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uC0, uC1, uC2; uniform float uIntensity, uOpacity, uFadeIn, uFadeOut, uFlicker, uTime;
      varying float vAge; varying float vSeed;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        float d = length(q);
        float a = smoothstep(0.5, 0.0, d);
        a *= a;
        float life = smoothstep(0.0, uFadeIn, vAge) * (1.0 - smoothstep(1.0 - uFadeOut, 1.0, vAge));
        vec3 c = vAge < 0.5 ? mix(uC0, uC1, vAge * 2.0) : mix(uC1, uC2, vAge * 2.0 - 1.0);
        float fl = 1.0 - uFlicker * (0.5 + 0.5 * sin(uTime * 23.0 + vSeed * 80.0));
        float k = a * life * fl * uOpacity;
        gl_FragColor = vec4(c * uIntensity * k, k);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return {
    points,
    u,
    /** Point size in pixels for a world unit at distance 1 (call on resize / fov change). */
    setPixel(viewH: number, fovDeg: number) { u.uPixel.value = viewH / (2 * Math.tan((fovDeg * Math.PI) / 360)); },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

/**
 * Motes that gather into (or fly off) a shape: each starts somewhere in a
 * swirling cloud and lands on its target point as `uForm` goes 0 → 1
 * (staggered, so the shape fills in). Targets are in the points' own space.
 */
export function makeConverge(targets: Float32Array, o: { radius: number; colors: [string, string]; size: [number, number]; intensity?: number; seed?: number; spin?: number }) {
  const n = targets.length / 3;
  const r = rng(o.seed ?? 3);
  const seeds = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) seeds[i] = r();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(targets.slice(), 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
  const u = {
    uForm: { value: 0 }, uTime: { value: 0 }, uRadius: { value: o.radius }, uSpin: { value: o.spin ?? 1.2 },
    uC0: { value: col(o.colors[0]) }, uC1: { value: col(o.colors[1]) }, uIntensity: { value: o.intensity ?? 1.5 },
    uSize0: { value: o.size[0] }, uSize1: { value: o.size[1] }, uPixel: { value: 600 }, uOpacity: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uForm, uTime, uRadius, uSpin, uSize0, uSize1, uPixel;
      varying float vK; varying float vSeed;
      void main(){
        float th = aSeed.x * 6.2831853 + uTime * uSpin * (0.4 + aSeed.y);
        float ph = acos(2.0 * aSeed.y - 1.0);
        vec3 cloud = vec3(sin(ph) * cos(th), cos(ph) * 0.6, sin(ph) * sin(th)) * uRadius * (0.5 + aSeed.z);
        float k = clamp((uForm * 1.6 - aSeed.w * 0.6), 0.0, 1.0);
        k = k * k * (3.0 - 2.0 * k);
        vec3 p = mix(cloud + position * 0.3, position, k);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(mix(uSize0, uSize1, aSeed.z) * uPixel / max(0.05, -mv.z), 0.0, 64.0);
        vK = k; vSeed = aSeed.x;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uC0, uC1; uniform float uIntensity, uOpacity, uForm;
      varying float vK; varying float vSeed;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d); a *= a;
        float fade = (1.0 - smoothstep(0.85, 1.0, vK) * 0.85) * uOpacity * smoothstep(0.0, 0.08, uForm + 0.02);
        gl_FragColor = vec4(mix(uC0, uC1, vK) * uIntensity * a * fade, a * fade);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return {
    points: pts,
    u,
    setPixel(viewH: number, fovDeg: number) { u.uPixel.value = viewH / (2 * Math.tan((fovDeg * Math.PI) / 360)); },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

// ---------------------------------------------------------------------------
// Streaks: rain, meteor sparks, warp lines
// ---------------------------------------------------------------------------

export interface StreakOpts {
  count: number;
  center: Vec3;
  extent: Vec3;
  velocity: Vec3;
  spread?: Vec3;
  life: number;
  length: number;
  width: number;
  color: string;
  intensity?: number;
  seed?: number;
}

export function makeStreaks(o: StreakOpts) {
  const n = Math.max(1, Math.round(o.count));
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setAttribute("uv", base.getAttribute("uv"));
  const r = rng(o.seed ?? 5);
  const seeds = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) seeds[i] = r();
  geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = n;
  const u = {
    uTime: { value: 0 }, uLife: { value: o.life }, uCenter: { value: v3(o.center) }, uExtent: { value: v3(o.extent) },
    uVel: { value: v3(o.velocity) }, uSpread: { value: v3(o.spread ?? [0, 0, 0]) }, uLen: { value: o.length }, uWidth: { value: o.width },
    uColor: { value: col(o.color) }, uIntensity: { value: o.intensity ?? 1 }, uOpacity: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      ${NOISE}
      attribute vec4 aSeed;
      uniform float uTime, uLife, uLen, uWidth;
      uniform vec3 uCenter, uExtent, uVel, uSpread;
      varying vec2 vUv; varying float vAge;
      void main(){
        float t = uTime / uLife + aSeed.w;
        float cyc = floor(t); float age = fract(t);
        vec3 r = whHash3(dot(aSeed.xyz, vec3(12.9898, 78.233, 37.719)) + cyc * 1.618);
        vec3 vel = uVel + (whHash3(aSeed.y * 51.3 + cyc) * 2.0 - 1.0) * uSpread;
        vec3 p = uCenter + (r * 2.0 - 1.0) * uExtent + vel * age * uLife;
        vec4 a = modelViewMatrix * vec4(p, 1.0);
        vec4 b = modelViewMatrix * vec4(p - normalize(vel) * uLen * (0.6 + 0.8 * aSeed.z), 1.0);
        vec2 dir = normalize(a.xy - b.xy + 1e-5);
        vec2 side = vec2(-dir.y, dir.x);
        vec4 q = mix(b, a, position.y + 0.5);
        q.xy += side * position.x * uWidth;
        gl_Position = projectionMatrix * q;
        vUv = uv; vAge = age;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uIntensity, uOpacity;
      varying vec2 vUv; varying float vAge;
      void main(){
        float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
        float along = vUv.y;
        float k = across * across * along * smoothstep(0.0, 0.1, vAge) * (1.0 - smoothstep(0.8, 1.0, vAge)) * uOpacity;
        gl_FragColor = vec4(uColor * uIntensity * k, k);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, u, dispose() { geo.dispose(); base.dispose(); mat.dispose(); } };
}

// ---------------------------------------------------------------------------
// Light: shafts, halos, beams
// ---------------------------------------------------------------------------

/** A volumetric light shaft: a cone from `from` to `to`, brightest down its middle. */
export function makeShaft(o: { from: Vec3; to: Vec3; r0: number; r1: number; color: string; intensity?: number; noise?: number }) {
  const from = v3(o.from), to = v3(o.to);
  const len = from.distanceTo(to);
  const geo = new THREE.CylinderGeometry(o.r0, o.r1, len, 48, 8, true);
  geo.translate(0, -len / 2, 0);
  const u = { uColor: { value: col(o.color) }, uIntensity: { value: o.intensity ?? 1 }, uTime: { value: 0 }, uNoise: { value: o.noise ?? 0.5 }, uOpacity: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying float vY; varying vec3 vP;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        vY = uv.y; vP = position;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform vec3 uColor; uniform float uIntensity, uTime, uNoise, uOpacity;
      varying vec3 vN; varying vec3 vV; varying float vY; varying vec3 vP;
      void main(){
        float facing = abs(dot(normalize(vN), normalize(vV)));
        float core = pow(facing, 2.2);
        float fall = smoothstep(0.0, 0.25, vY) * pow(vY, 0.6);
        float n = mix(1.0, 0.55 + 0.9 * whNoise(vec3(vP.x * 0.6, vP.y * 0.12 + uTime * 0.25, vP.z * 0.6)), uNoise);
        float k = core * fall * n * uOpacity;
        gl_FragColor = vec4(uColor * uIntensity * k, k);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(from);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), to.clone().sub(from).normalize());
  mesh.renderOrder = 5;
  return { mesh, u, dispose() { geo.dispose(); mat.dispose(); } };
}

let glowTex: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const s = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const g = cv.getContext("2d")!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.18, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.14)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  glowTex = new THREE.CanvasTexture(cv);
  return glowTex;
}

/** A soft additive halo (a sprite that always faces the camera). */
export function makeGlow(o: { pos: Vec3; size: number; color: string; intensity?: number }) {
  const mat = new THREE.SpriteMaterial({ map: glowTexture(), color: col(o.color, o.intensity ?? 1), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const s = new THREE.Sprite(mat);
  s.position.copy(v3(o.pos));
  s.scale.setScalar(o.size);
  s.renderOrder = 6;
  return { sprite: s, mat, set(color: string, k: number) { mat.color.copy(col(color, k)); }, dispose() { mat.dispose(); } };
}

/** A beam of light: a bright core inside a soft glow, pulsing. */
export function makeBeam(o: { from: Vec3; to: Vec3; radius: number; color: string; intensity?: number }) {
  const from = v3(o.from), to = v3(o.to);
  const len = from.distanceTo(to);
  const geo = new THREE.CylinderGeometry(o.radius, o.radius, len, 32, 1, true);
  geo.translate(0, len / 2, 0);
  const u = { uColor: { value: col(o.color) }, uIntensity: { value: o.intensity ?? 4 }, uTime: { value: 0 }, uOpacity: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vV; varying vec2 vUv; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); vUv = uv; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uIntensity, uTime, uOpacity;
      varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      void main(){
        float f = abs(dot(normalize(vN), normalize(vV)));
        float core = pow(f, 6.0) * 3.0 + pow(f, 1.5) * 0.6;
        float pulse = 0.85 + 0.15 * sin(uTime * 9.0 - vUv.y * 30.0);
        float k = core * pulse * uOpacity;
        gl_FragColor = vec4(uColor * uIntensity * k, k);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(from);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
  mesh.renderOrder = 6;
  return { mesh, u, dispose() { geo.dispose(); mat.dispose(); } };
}

/** An expanding ring of light on a plane (shockwaves, Dynamax rings, Mega Evolution). */
export function makeRing(o: { color: string; intensity?: number; thickness?: number }) {
  const geo = new THREE.PlaneGeometry(2, 2);
  const u = { uColor: { value: col(o.color) }, uIntensity: { value: o.intensity ?? 3 }, uK: { value: 0 }, uThick: { value: o.thickness ?? 0.08 }, uOpacity: { value: 1 }, uTime: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform vec3 uColor; uniform float uIntensity, uK, uThick, uOpacity, uTime;
      varying vec2 vUv;
      void main(){
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        float ang = atan(p.y, p.x);
        float n = 0.75 + 0.5 * whNoise(vec3(ang * 3.0, r * 4.0, uTime * 0.6));
        float d = abs(r - uK) / max(1e-3, uThick * (0.4 + uK));
        float ring = exp(-d * d * 2.0) * n;
        float inner = smoothstep(uK, 0.0, r) * 0.18 * (1.0 - uK);
        float k = (ring + inner) * uOpacity * (1.0 - smoothstep(0.85, 1.0, uK));
        gl_FragColor = vec4(uColor * uIntensity * k, k);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 6;
  return { mesh, u, dispose() { geo.dispose(); mat.dispose(); } };
}

// ---------------------------------------------------------------------------
// Lightning
// ---------------------------------------------------------------------------

/** A forked lightning bolt as a glowing ribbon; strike() rebuilds it between two points. */
export function makeLightning(o: { color: string; width: number; intensity?: number; branches?: number }) {
  const max = 2600;
  const pos = new Float32Array(max * 3), uv = new Float32Array(max * 2);
  const idx: number[] = [];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  const u = { uColor: { value: col(o.color) }, uIntensity: { value: o.intensity ?? 6 }, uAlpha: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uIntensity, uAlpha; varying vec2 vUv;
      void main(){
        float a = 1.0 - abs(vUv.x - 0.5) * 2.0;
        float core = pow(a, 6.0) * 2.5 + pow(a, 1.5) * 0.5;
        float k = core * uAlpha * vUv.y;
        gl_FragColor = vec4(mix(uColor, vec3(1.0), pow(a, 8.0)) * uIntensity * k, k);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 7;
  let used = 0;
  const viewDir = new THREE.Vector3();
  const addPath = (pts: THREE.Vector3[], w: number, bright: number) => {
    for (let i = 0; i < pts.length - 1 && used + 4 <= max; i++) {
      const a = pts[i], b = pts[i + 1];
      const dir = b.clone().sub(a).normalize();
      const side = dir.clone().cross(viewDir).normalize().multiplyScalar(w * (1 - (i / pts.length) * 0.6));
      const v = used;
      const put = (p: THREE.Vector3, ux: number) => { pos.set([p.x, p.y, p.z], used * 3); uv.set([ux, bright], used * 2); used++; };
      put(a.clone().sub(side), 0); put(a.clone().add(side), 1); put(b.clone().sub(side), 0); put(b.clone().add(side), 1);
      idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
  };
  const bolt = (a: THREE.Vector3, b: THREE.Vector3, rand: () => number, depth: number, rough: number) => {
    let pts = [a.clone(), b.clone()];
    for (let lvl = 0; lvl < depth; lvl++) {
      const next: THREE.Vector3[] = [];
      const amp = a.distanceTo(b) * rough / Math.pow(2, lvl);
      for (let i = 0; i < pts.length - 1; i++) {
        const m = pts[i].clone().lerp(pts[i + 1], 0.5);
        m.add(new THREE.Vector3(rand() - 0.5, (rand() - 0.5) * 0.4, rand() - 0.5).multiplyScalar(amp));
        next.push(pts[i], m);
      }
      next.push(pts[pts.length - 1]);
      pts = next;
    }
    return pts;
  };
  return {
    mesh,
    u,
    /** Rebuilds the bolt from a to b (facing `camPos`), deterministic per seed. */
    strike(a: Vec3, b: Vec3, seed: number, camPos: THREE.Vector3) {
      const rand = rng(seed);
      used = 0;
      idx.length = 0;
      const A = v3(a), B = v3(b);
      viewDir.copy(camPos).sub(A.clone().lerp(B, 0.5)).normalize();
      const main = bolt(A, B, rand, 7, 0.32);
      addPath(main, o.width, 1);
      for (let k = 0; k < (o.branches ?? 4); k++) {
        const at = main[Math.floor(main.length * (0.15 + rand() * 0.6))];
        const end = at.clone().add(new THREE.Vector3((rand() - 0.5) * 2, -0.4 - rand() * 0.6, (rand() - 0.5) * 2).multiplyScalar(A.distanceTo(B) * (0.15 + rand() * 0.25)));
        addPath(bolt(at, end, rand, 5, 0.35), o.width * 0.45, 0.6);
      }
      geo.setIndex(idx.slice());
      geo.setDrawRange(0, idx.length);
      (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (geo.getAttribute("uv") as THREE.BufferAttribute).needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

/** Lightning timing: the flash level (0..1) at time t for strikes every `every` seconds (deterministic). */
export function strikeAt(t: number, every: number, seed = 1): { level: number; id: number } {
  const id = Math.floor(t / every);
  const r = rng(seed * 7919 + id * 104729);
  const at = r() * every * 0.7;
  const local = t - id * every - at;
  if (local < 0 || local > 0.6) return { level: 0, id };
  const flick = local < 0.05 ? 1 : local < 0.1 ? 0.35 : local < 0.16 ? 0.9 : Math.exp(-(local - 0.16) * 9);
  return { level: flick, id };
}

// ---------------------------------------------------------------------------
// Ocean
// ---------------------------------------------------------------------------

export interface Wave { dir: [number, number]; steep: number; length: number; speed?: number }

export function makeOcean(o: { size: number; segments: number; waves: Wave[]; deep: string; shallow: string; sky: string; sun?: Vec3; sunColor?: string; foam?: number; amp?: number }) {
  const geo = new THREE.PlaneGeometry(o.size, o.size, o.segments, o.segments);
  geo.rotateX(-Math.PI / 2);
  const W = o.waves.slice(0, 4);
  while (W.length < 4) W.push({ dir: [1, 0], steep: 0, length: 10 });
  const u = {
    uTime: { value: 0 }, uAmp: { value: o.amp ?? 1 },
    uW: { value: W.map((w) => { const l = Math.hypot(w.dir[0], w.dir[1]) || 1; return new THREE.Vector4(w.dir[0] / l, w.dir[1] / l, w.steep, w.length); }) },
    uSpeed: { value: new THREE.Vector4(...W.map((w) => w.speed ?? 1)) },
    uDeep: { value: col(o.deep) }, uShallow: { value: col(o.shallow) }, uSky: { value: col(o.sky) },
    uSun: { value: v3(o.sun ?? [0.3, 0.5, -1]).normalize() }, uSunColor: { value: col(o.sunColor ?? "#ffffff") },
    uFoam: { value: o.foam ?? 0.5 }, uFlash: { value: 0 }, uFogColor: { value: col(o.sky) }, uFogDensity: { value: 0.004 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: /* glsl */ `
      uniform float uTime, uAmp; uniform vec4 uW[4]; uniform vec4 uSpeed;
      varying vec3 vWorld; varying vec3 vNormal; varying float vCrest;
      void main(){
        vec3 p = position; vec3 t = vec3(1.0, 0.0, 0.0); vec3 b = vec3(0.0, 0.0, 1.0);
        vec3 wp0 = (modelMatrix * vec4(position, 1.0)).xyz;
        float crest = 0.0;
        for (int i = 0; i < 4; i++){
          vec4 w = uW[i];
          float k = 6.2831853 / w.w; float c = sqrt(9.8 / k) * uSpeed[i];
          vec2 d = w.xy; float f = k * (dot(d, wp0.xz) - c * uTime);
          float a = w.z / k * uAmp;
          p.x += d.x * a * cos(f); p.y += a * sin(f); p.z += d.y * a * cos(f);
          t += vec3(-d.x * d.x * w.z * uAmp * sin(f), d.x * w.z * uAmp * cos(f), -d.x * d.y * w.z * uAmp * sin(f));
          b += vec3(-d.x * d.y * w.z * uAmp * sin(f), d.y * w.z * uAmp * cos(f), -d.y * d.y * w.z * uAmp * sin(f));
          crest += max(0.0, sin(f)) * w.z * uAmp;
        }
        vNormal = normalize(cross(b, t));
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorld = wp.xyz; vCrest = crest;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform vec3 uDeep, uShallow, uSky, uSun, uSunColor, uFogColor; uniform float uFoam, uFlash, uTime, uFogDensity;
      varying vec3 vWorld; varying vec3 vNormal; varying float vCrest;
      void main(){
        vec3 n = normalize(vNormal + 0.08 * (vec3(whNoise(vWorld * 0.35 + uTime * 0.4), 0.0, whNoise(vWorld * 0.35 - uTime * 0.4 + 3.0)) - 0.5));
        vec3 v = normalize(cameraPosition - vWorld);
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
        vec3 r = reflect(-v, n);
        vec3 sky = mix(uSky * 0.6, uSky * 1.4, clamp(r.y, 0.0, 1.0)) + vec3(0.8, 0.85, 1.0) * uFlash * 2.0;
        vec3 water = mix(uDeep, uShallow, clamp(vCrest * 1.3 + 0.2, 0.0, 1.0));
        vec3 c = mix(water, sky, fres);
        c += uSunColor * pow(max(dot(r, uSun), 0.0), 220.0) * 6.0;
        float foam = smoothstep(0.55, 1.0, vCrest * 1.6 + whNoise(vWorld * 0.8 + uTime) * 0.4) * uFoam;
        c = mix(c, vec3(0.85, 0.9, 0.95), foam);
        float fog = 1.0 - exp(-uFogDensity * length(cameraPosition - vWorld));
        gl_FragColor = vec4(mix(c, uFogColor, fog), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  return { mesh, u, dispose() { geo.dispose(); mat.dispose(); } };
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

export interface TerrainOpts {
  size: [number, number];
  segments: number;
  height: (x: number, z: number) => number;
  color: (h: number, slope: number, x: number, z: number) => [number, number, number];
  roughness?: number;
  /** Glowing cracks: where the crack noise passes this threshold (0 none). */
  lava?: { color: string; scale: number; width: number; intensity: number; below?: number };
  center?: Vec3;
}

export function makeTerrain(o: TerrainOpts) {
  const [sx, sz] = o.size;
  const seg = o.segments;
  const geo = new THREE.PlaneGeometry(sx, sz, seg, Math.round((seg * sz) / sx));
  geo.rotateX(-Math.PI / 2);
  const p = geo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setY(i, o.height(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();
  const nrm = geo.getAttribute("normal") as THREE.BufferAttribute;
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const c = o.color(p.getY(i), 1 - nrm.getY(i), p.getX(i), p.getZ(i));
    colors.set(c, i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const u = { uLava: { value: o.lava ? 1 : 0 }, uLavaColor: { value: col(o.lava?.color ?? "#ff5a1f") }, uLavaScale: { value: o.lava?.scale ?? 0.05 }, uLavaWidth: { value: o.lava?.width ?? 0.04 }, uLavaK: { value: o.lava?.intensity ?? 4 }, uLavaBelow: { value: o.lava?.below ?? 1e4 }, uTime: { value: 0 }, uFlash: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: o.roughness ?? 0.92, metalness: 0 });
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vTerrW;").replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvTerrW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vTerrW;\nuniform float uLava, uLavaScale, uLavaWidth, uLavaK, uLavaBelow, uTime, uFlash;\nuniform vec3 uLavaColor;\n${NOISE}`)
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        if (uLava > 0.0) {
          vec3 q = vTerrW * uLavaScale;
          float c1 = abs(whNoise(q + vec3(0.0, uTime * 0.02, 0.0)) - 0.5);
          float c2 = abs(whNoise(q * 2.3 + 7.0) - 0.5);
          float crack = smoothstep(uLavaWidth, 0.0, min(c1, c2 * 1.4));
          float low = 1.0 - smoothstep(uLavaBelow - 2.0, uLavaBelow + 2.0, vTerrW.y);
          float flow = 0.65 + 0.35 * sin(uTime * 1.3 + vTerrW.x * 0.11 + vTerrW.z * 0.07);
          totalEmissiveRadiance += uLavaColor * crack * uLavaK * uLava * mix(0.25, 1.0, low) * flow;
        }
        totalEmissiveRadiance += diffuseColor.rgb * uFlash * 0.6;`
      );
  };
  const mesh = new THREE.Mesh(geo, mat);
  if (o.center) mesh.position.copy(v3(o.center));
  return { mesh, u, heightAt: o.height, dispose() { geo.dispose(); mat.dispose(); } };
}

// ---------------------------------------------------------------------------
// Clouds, mist, fire, wormholes
// ---------------------------------------------------------------------------

/** A big soft layer of cloud or mist (a horizontal plane with drifting noise). */
export function makeCloudLayer(o: { size: number; y: number; color: string; shadow?: string; density?: number; scale?: number; speed?: Vec3; intensity?: number; additive?: boolean; center?: Vec3 }) {
  const geo = new THREE.PlaneGeometry(o.size, o.size, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const u = { uTime: { value: 0 }, uColor: { value: col(o.color) }, uShadow: { value: col(o.shadow ?? o.color) }, uDensity: { value: o.density ?? 0.6 }, uScale: { value: o.scale ?? 0.012 }, uSpeed: { value: v3(o.speed ?? [1, 0, 0.5]) }, uIntensity: { value: o.intensity ?? 1 }, uFlash: { value: 0 }, uOpacity: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: /* glsl */ `varying vec3 vW; varying vec2 vUv; void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform float uTime, uDensity, uScale, uIntensity, uFlash, uOpacity; uniform vec3 uColor, uShadow, uSpeed;
      varying vec3 vW; varying vec2 vUv;
      void main(){
        vec3 q = vec3(vW.x, 0.0, vW.z) * uScale + uSpeed * uTime * 0.01;
        float n = whFbm(q);
        float m = whFbm(q * 2.7 + 3.0);
        float d = smoothstep(1.0 - uDensity, 1.0, n * 0.8 + m * 0.4);
        float edge = 1.0 - smoothstep(0.35, 0.5, length(vUv - 0.5));
        vec3 c = mix(uShadow, uColor, smoothstep(0.2, 0.9, m)) * uIntensity + vec3(0.75, 0.8, 1.0) * uFlash * d;
        float a = d * edge * uOpacity;
        gl_FragColor = vec4(c * a, a);
      }`,
  });
  mat.premultipliedAlpha = true;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(o.center?.[0] ?? 0, o.y, o.center?.[2] ?? 0);
  mesh.renderOrder = 3;
  return { mesh, u, dispose() { geo.dispose(); mat.dispose(); } };
}

/** Flames: camera-facing licks of fire, instanced along a set of points. */
export function makeFlames(o: { points: Vec3[]; size: [number, number]; color?: [string, string]; intensity?: number; seed?: number }) {
  const n = o.points.length;
  const base = new THREE.PlaneGeometry(1, 1);
  base.translate(0, 0.5, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setAttribute("uv", base.getAttribute("uv"));
  const at = new Float32Array(n * 4);
  const r = rng(o.seed ?? 9);
  o.points.forEach((p, i) => at.set([p[0], p[1], p[2], r()], i * 4));
  geo.setAttribute("aAt", new THREE.InstancedBufferAttribute(at, 4));
  geo.instanceCount = n;
  const u = { uTime: { value: 0 }, uSize0: { value: o.size[0] }, uSize1: { value: o.size[1] }, uHot: { value: col(o.color?.[0] ?? "#fff1a8") }, uCool: { value: col(o.color?.[1] ?? "#ff3b0a") }, uIntensity: { value: o.intensity ?? 3 }, uOpacity: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec4 aAt; uniform float uTime, uSize0, uSize1; varying vec2 vUv; varying float vSeed;
      void main(){
        float s = mix(uSize0, uSize1, aAt.w) * (0.85 + 0.15 * sin(uTime * 3.0 + aAt.w * 20.0));
        vec4 c = modelViewMatrix * vec4(aAt.xyz, 1.0);
        c.xy += vec2(position.x * s * 0.6, position.y * s * 1.4);
        gl_Position = projectionMatrix * c;
        vUv = uv; vSeed = aAt.w;
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform float uTime, uIntensity, uOpacity; uniform vec3 uHot, uCool; varying vec2 vUv; varying float vSeed;
      void main(){
        vec2 p = vUv; p.x -= 0.5;
        float n = whFbm3(vec3(p.x * 3.0, p.y * 2.2 - uTime * 2.4, vSeed * 10.0));
        float shape = smoothstep(0.5, 0.0, abs(p.x) * (1.4 + p.y * 1.8) + (n - 0.5) * 0.5) * (1.0 - smoothstep(0.35, 1.0, p.y + n * 0.3)) * smoothstep(0.0, 0.08, p.y);
        vec3 c = mix(uCool, uHot, smoothstep(0.2, 0.9, shape * (1.2 - p.y)));
        float k = shape * uOpacity;
        gl_FragColor = vec4(c * uIntensity * k, k);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  return { mesh, u, dispose() { geo.dispose(); base.dispose(); mat.dispose(); } };
}

/** An Ultra Wormhole or space-time rift: a swirling disc of light with chromatic rings. */
export function makePortal(o: { radius: number; inner: string; outer: string; intensity?: number; tear?: number }) {
  const geo = new THREE.PlaneGeometry(o.radius * 2, o.radius * 2);
  const u = { uTime: { value: 0 }, uOpen: { value: 1 }, uInner: { value: col(o.inner) }, uOuter: { value: col(o.outer) }, uIntensity: { value: o.intensity ?? 3 }, uTear: { value: o.tear ?? 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform float uTime, uOpen, uIntensity, uTear; uniform vec3 uInner, uOuter; varying vec2 vUv;
      void main(){
        vec2 p = vUv * 2.0 - 1.0;
        p.x *= mix(1.0, 0.35, uTear);
        float r = length(p) / max(0.001, uOpen);
        float a = atan(p.y, p.x);
        float sw = a + 3.0 / (r + 0.25) + uTime * 0.8;
        float n = whFbm3(vec3(cos(sw) * 2.0, sin(sw) * 2.0, r * 3.0 - uTime * 0.5));
        float ring = smoothstep(1.0, 0.82, r) * smoothstep(0.55, 0.92, r);
        float core = smoothstep(0.75, 0.0, r);
        vec3 chroma = vec3(sin(r * 14.0 - uTime * 2.0), sin(r * 14.0 - uTime * 2.0 + 2.1), sin(r * 14.0 - uTime * 2.0 + 4.2)) * 0.5 + 0.5;
        vec3 c = uInner * core * (0.2 + n) * 0.9 + mix(uOuter, chroma, 0.45) * ring * (0.5 + n * 1.2);
        float k = clamp(core * 0.9 + ring, 0.0, 1.0) * smoothstep(1.05, 0.9, r);
        gl_FragColor = vec4(c * uIntensity * k, k);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 6;
  return { mesh, u, dispose() { geo.dispose(); mat.dispose(); } };
}

// ---------------------------------------------------------------------------
// Stone and simple architecture
// ---------------------------------------------------------------------------

/** Weathered stone: vertex-coloured, with world-space noise for grime and wear. */
export function stoneMaterial(o: { color: string; roughness?: number; dirt?: number; emissive?: string; emissiveK?: number }) {
  const mat = new THREE.MeshStandardMaterial({ color: col(o.color), roughness: o.roughness ?? 0.88, metalness: 0, emissive: col(o.emissive ?? "#000000"), emissiveIntensity: o.emissiveK ?? 0 });
  const dirt = o.dirt ?? 0.45;
  mat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vStoneW;").replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvStoneW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vStoneW;\n${NOISE}`)
      .replace("#include <map_fragment>", `#include <map_fragment>\n{ float n = whFbm3(vStoneW * 0.9); float m = whNoise(vStoneW * 6.0); diffuseColor.rgb *= mix(1.0, 0.55 + 0.6 * n, ${dirt.toFixed(3)}) * (0.92 + 0.16 * m); }`);
  };
  mat.customProgramCacheKey = () => `wh-stone-${dirt.toFixed(2)}`;
  return mat;
}

/** Merges geometries (all with the same attributes) into one. */
export function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const ni = geos.map((g) => (g.index ? g : g.toNonIndexed()));
  const attrs = ["position", "normal", "uv"];
  let vCount = 0, iCount = 0;
  for (const g of ni) { vCount += g.getAttribute("position").count; iCount += g.index ? g.index.count : g.getAttribute("position").count; }
  const out = new THREE.BufferGeometry();
  const arrays: Record<string, Float32Array> = { position: new Float32Array(vCount * 3), normal: new Float32Array(vCount * 3), uv: new Float32Array(vCount * 2) };
  const index = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const g of ni) {
    const n = g.getAttribute("position").count;
    for (const a of attrs) {
      const src = g.getAttribute(a) as THREE.BufferAttribute | undefined;
      const size = a === "uv" ? 2 : 3;
      if (src) arrays[a].set(src.array as Float32Array, vo * size);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) index[io++] = g.index.getX(i) + vo;
    else for (let i = 0; i < n; i++) index[io++] = i + vo;
    vo += n;
  }
  out.setAttribute("position", new THREE.BufferAttribute(arrays.position, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(arrays.normal, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(arrays.uv, 2));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  for (const g of geos) g.dispose();
  return out;
}

export function placed(g: THREE.BufferGeometry, pos: Vec3, rotY = 0, scale: Vec3 = [1, 1, 1], rotX = 0, rotZ = 0): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(v3(pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ)), v3(scale));
  g.applyMatrix4(m);
  return g;
}

/** Disposes everything under an object (geometries and materials, not shared textures). */
export function disposeTree(o: THREE.Object3D) {
  o.traverse((x) => {
    const m = x as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((y) => y.dispose());
    else mat?.dispose();
  });
}

/** Keyed scalar animation: piecewise smooth between [t, value] pairs. */
export function keyed(keys: [number, number][], t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0] = keys[i], [t1, v1] = keys[i + 1];
    if (t <= t1) {
      const k = (t - t0) / Math.max(1e-6, t1 - t0);
      const e = k * k * (3 - 2 * k);
      return v0 + (v1 - v0) * e;
    }
  }
  return keys[keys.length - 1][1];
}

/** 0 → 1 over [a, b] (smooth). */
export const ramp = (t: number, a: number, b: number) => {
  const k = Math.max(0, Math.min(1, (t - a) / Math.max(1e-6, b - a)));
  return k * k * (3 - 2 * k);
};
