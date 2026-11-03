import * as THREE from "three";
import type { ArenaId } from "@/lib/mass-battle/types";
import type { Weather } from "./look";

/**
 * Weather in the air, all of it 3D and animated on the GPU from the clock:
 * rain streaks falling round the camera with splashes on the battleground
 * and now and then a flash of lightning far off; snow drifting down; a
 * sandstorm's grains racing sideways with dust clouds rolling through;
 * embers and ash over the volcano; motes glinting in harsh sunlight. Each
 * is one instanced draw wrapped round the camera, so it never runs out.
 */

export interface WeatherLayer {
  group: THREE.Group;
  update(t: number, camera: THREE.Camera, focus: THREE.Vector3): void;
  /** Lightning far off (rain): called with a bearing and strength when a flash happens. */
  onFlash: ((x: number, z: number, strength: number) => void) | null;
  materials(): THREE.Material[];
  dispose(): void;
}

interface Field {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  geo: THREE.InstancedBufferGeometry;
}

function seeds(count: number, rand: () => number) {
  const a = new Float32Array(count * 4);
  for (let k = 0; k < count; k++) a.set([rand(), rand(), rand(), rand()], k * 4);
  return new THREE.InstancedBufferAttribute(a, 4);
}

/** Particles in a box round the camera: `fall` m/s down (negative rises), drift sideways, stretched along their motion. */
function particleField(opts: {
  count: number;
  box: number;
  height: number;
  fall: number;
  wind: [number, number];
  size: number;
  stretch: number;
  color: THREE.Color;
  alpha: number;
  additive: boolean;
  wobble: number;
  base: THREE.BufferGeometry;
  rand: () => number;
  /** Fireflies: each one glows and fades on its own beat. */
  blink?: number;
  /** Kept round what the camera looks at, from the ground up (fireflies), rather than round the camera. */
  grounded?: boolean;
}): Field {
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = opts.base.index;
  geo.setAttribute("position", opts.base.getAttribute("position"));
  geo.setAttribute("aSeed", seeds(opts.count, opts.rand));
  geo.instanceCount = opts.count;
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uBox: { value: opts.box },
      uHeight: { value: opts.height },
      uFall: { value: opts.fall },
      uWind: { value: new THREE.Vector2(...opts.wind) },
      uSize: { value: opts.size },
      uStretch: { value: opts.stretch },
      uColor: { value: opts.color },
      uAlpha: { value: opts.alpha },
      uWobble: { value: opts.wobble },
      uBlink: { value: opts.blink ?? 0 },
      uGround: { value: opts.grounded ? 1 : 0 },
      uFocus: { value: new THREE.Vector3() },
    },
    vertexShader: /* glsl */ `
uniform float uTime; uniform vec3 uCam; uniform float uBox; uniform float uHeight; uniform float uFall;
uniform vec2 uWind; uniform float uSize; uniform float uStretch; uniform float uWobble; uniform float uBlink;
uniform float uGround; uniform vec3 uFocus;
attribute vec4 aSeed;
varying float vA;
void main() {
  float sp = 0.7 + aSeed.w * 0.6;
  vec3 vel = vec3(uWind.x, -uFall, uWind.y) * sp;
  vec3 p = aSeed.xyz * vec3(uBox, uHeight, uBox) + vel * uTime;
  p.x += sin(uTime * 1.3 * sp + aSeed.y * 40.0) * uWobble;
  p.z += cos(uTime * 1.1 * sp + aSeed.x * 40.0) * uWobble;
  vec3 c = uGround > 0.5 ? uFocus : uCam;
  vec3 lo = vec3(c.x - uBox * 0.5, uGround > 0.5 ? 0.0 : max(0.0, c.y - uHeight * 0.5), c.z - uBox * 0.5);
  p = mod(p - lo, vec3(uBox, uHeight, uBox)) + lo;
  vec3 rel = (p - lo) / vec3(uBox, uHeight, uBox);
  vA = smoothstep(0.0, 0.12, rel.x) * smoothstep(1.0, 0.88, rel.x) * smoothstep(0.0, 0.12, rel.z) * smoothstep(1.0, 0.88, rel.z) * smoothstep(1.0, 0.85, rel.y);
  // Nothing right in front of the lens (a flake an inch away would fill the screen).
  float dc = length(p - uCam);
  vA *= smoothstep(1.2, 3.5, dc);
  if (uBlink > 0.0) vA *= pow(0.5 + 0.5 * sin(uTime * (1.0 + aSeed.w * 2.0) * uBlink + aSeed.x * 60.0), 6.0);
  if (dc < 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float speed = length(vel);
  vec3 dir = speed > 1e-3 ? vel / speed : vec3(0.0, -1.0, 0.0);
  vec3 toCam = normalize(uCam - p);
  vec3 side = normalize(cross(dir, toCam));
  vec3 q = side * position.x * uSize + dir * position.y * uSize * (1.0 + uStretch) + cross(side, dir) * position.z * uSize;
  gl_Position = projectionMatrix * viewMatrix * vec4(p + q, 1.0);
}`,
    fragmentShader: /* glsl */ `
uniform vec3 uColor; uniform float uAlpha;
varying float vA;
void main() {
  float a = vA * uAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor * a, a);
}`,
  });
  if (!opts.additive) mat.fragmentShader = mat.fragmentShader.replace("gl_FragColor = vec4(uColor * a, a);", "gl_FragColor = vec4(uColor, a);");
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  return { mesh, mat, geo };
}

/** Rain splashing on the battleground: little rings that open and fade, each on its own beat. */
function splashField(count: number, box: number, rand: () => number): Field {
  const ring = new THREE.RingGeometry(0.7, 1, 16).rotateX(-Math.PI / 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = ring.index;
  geo.setAttribute("position", ring.getAttribute("position"));
  geo.setAttribute("aSeed", seeds(count, rand));
  geo.instanceCount = count;
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uFocus: { value: new THREE.Vector3() }, uBox: { value: box } },
    vertexShader: /* glsl */ `
uniform float uTime; uniform vec3 uFocus; uniform float uBox;
attribute vec4 aSeed;
varying float vA;
void main() {
  float cyc = uTime * (1.6 + aSeed.w) + aSeed.z * 10.0;
  float k = fract(cyc);
  float n = floor(cyc);
  vec2 jit = vec2(fract(sin(n * 12.9 + aSeed.x * 80.0) * 437.5), fract(sin(n * 78.2 + aSeed.y * 80.0) * 437.5));
  vec2 p = (aSeed.xy + jit * 0.3) * uBox;
  p = mod(p - uFocus.xz + uBox * 0.5, uBox) - uBox * 0.5 + uFocus.xz;
  float r = 0.05 + k * 0.22;
  vA = (1.0 - k) * smoothstep(uBox * 0.5, uBox * 0.3, length(p - uFocus.xz));
  gl_Position = projectionMatrix * viewMatrix * vec4(p.x + position.x * r, 0.04, p.y + position.z * r, 1.0);
}`,
    fragmentShader: "varying float vA; void main(){ if (vA < 0.01) discard; gl_FragColor = vec4(vec3(0.55, 0.62, 0.72) * vA, vA); }",
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  ring.dispose();
  return { mesh, mat, geo };
}

/** A sandstorm's rolling clouds: big soft puffs racing across the field. */
function dustSheets(count: number, box: number, color: THREE.Color, rand: () => number): Field {
  const ball = new THREE.IcosahedronGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = ball.index;
  geo.setAttribute("position", ball.getAttribute("position"));
  geo.setAttribute("normal", ball.getAttribute("normal"));
  geo.setAttribute("aSeed", seeds(count, rand));
  geo.instanceCount = count;
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: box }, uColor: { value: color } },
    vertexShader: /* glsl */ `
uniform float uTime; uniform vec3 uCam; uniform float uBox;
attribute vec4 aSeed;
varying float vA; varying float vF;
void main() {
  vec3 p = vec3(aSeed.x * uBox + uTime * (7.0 + aSeed.w * 5.0), aSeed.y * 6.0, aSeed.z * uBox + uTime * 1.5);
  vec3 lo = vec3(uCam.x - uBox * 0.5, 0.0, uCam.z - uBox * 0.5);
  p.xz = mod(p.xz - lo.xz, vec2(uBox)) + lo.xz;
  vec2 rel = (p.xz - lo.xz) / uBox;
  vA = smoothstep(0.0, 0.2, rel.x) * smoothstep(1.0, 0.8, rel.x) * smoothstep(0.0, 0.2, rel.y) * smoothstep(1.0, 0.8, rel.y);
  float size = 4.0 + aSeed.w * 7.0;
  vec3 wp = p + position * vec3(size * 1.6, size * 0.5, size);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vF = max(dot(normalize(mat3(viewMatrix) * normal), normalize(-mv.xyz)), 0.0);
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: "uniform vec3 uColor; varying float vA; varying float vF; void main(){ float a = vA * smoothstep(0.0, 1.0, vF) * 0.22; if (a < 0.004) discard; gl_FragColor = vec4(uColor, a); }",
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  ball.dispose();
  return { mesh, mat, geo };
}

export function buildWeather(arena: ArenaId, weather: Weather, opts: { density: number; radius: number; seed?: number; night?: boolean }): WeatherLayer {
  const group = new THREE.Group();
  group.name = "weather";
  const fields: Field[] = [];
  const disposables: { dispose(): void }[] = [];
  let s = (opts.seed ?? 4242) % 2147483647 || 1;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const d = Math.max(0.15, opts.density);
  // Every piece is a little 3D crystal (stretched along its fall for rain and sand), never a flat card.
  const crystal = new THREE.OctahedronGeometry(1, 0);
  disposables.push(crystal);
  const add = (f: Field) => {
    fields.push(f);
    group.add(f.mesh);
  };
  let splash: Field | null = null;
  let dust: Field | null = null;
  if (weather === "rain") {
    add(particleField({ count: Math.round(6000 * d), box: 46, height: 30, fall: 16, wind: [1.6, 0.8], size: 0.012, stretch: 40, color: new THREE.Color(0.62, 0.7, 0.82), alpha: 0.6, additive: true, wobble: 0, base: crystal, rand }));
    splash = splashField(Math.round(900 * d), 44, rand);
    add(splash);
  }
  const snowy = weather === "snow" || (arena === "snowfield" && weather === "none");
  if (snowy) {
    const heavy = weather === "snow";
    add(particleField({ count: Math.round((heavy ? 5000 : 2400) * d), box: 44, height: 26, fall: heavy ? 2.2 : 1.3, wind: heavy ? [1.4, 0.6] : [0.4, 0.2], size: 0.03, stretch: 0.3, color: new THREE.Color(1, 1, 1), alpha: 0.85, additive: false, wobble: 0.6, base: crystal, rand }));
  }
  if (weather === "sand") {
    const col = new THREE.Color("#e0b47a");
    add(particleField({ count: Math.round(5000 * d), box: 46, height: 14, fall: 0.6, wind: [22, 4], size: 0.02, stretch: 10, color: col, alpha: 0.7, additive: false, wobble: 0.4, base: crystal, rand }));
    dust = dustSheets(Math.round(70 * Math.max(0.5, d)), 90, new THREE.Color("#c89a64"), rand);
    add(dust);
  }
  if (arena === "volcano") {
    // Embers rising on the heat and ash drifting down.
    add(particleField({ count: Math.round(1600 * d), box: 50, height: 28, fall: -1.4, wind: [0.8, 0.3], size: 0.04, stretch: 1.5, color: new THREE.Color(3.2, 1.1, 0.25), alpha: 1, additive: true, wobble: 0.8, base: crystal, rand }));
    add(particleField({ count: Math.round(1200 * d), box: 50, height: 28, fall: 0.7, wind: [0.6, 0.2], size: 0.05, stretch: 0, color: new THREE.Color("#5a5452"), alpha: 0.75, additive: false, wobble: 0.6, base: crystal, rand }));
  }
  if (opts.night && (arena === "plains" || arena === "colosseum") && weather === "none") {
    // Fireflies over the grass (and round the arena's torches) at night.
    add(particleField({ count: Math.round(600 * d), box: 60, height: 3, fall: 0, wind: [0.2, 0.1], size: 0.04, stretch: 0, color: new THREE.Color(2.4, 3.2, 0.9), alpha: 1, additive: true, wobble: 1.2, base: crystal, rand, blink: 1, grounded: true }));
  }
  if (weather === "sun") {
    // Motes glinting in the light.
    add(particleField({ count: Math.round(700 * d), box: 36, height: 14, fall: -0.15, wind: [0.3, 0.1], size: 0.03, stretch: 0, color: new THREE.Color(2.2, 2.0, 1.4), alpha: 0.6, additive: true, wobble: 0.5, base: crystal, rand }));
  }
  let nextFlash = 3 + rand() * 5;
  const layer: WeatherLayer = {
    group,
    onFlash: null,
    update(t, camera, focus) {
      for (const f of fields) {
        const u = f.mat.uniforms;
        u.uTime.value = t;
        if (u.uCam) u.uCam.value.copy(camera.position);
        if (u.uFocus) u.uFocus.value.copy(focus);
      }
      void splash;
      void dust;
      if (weather === "rain" && t > nextFlash) {
        // Lightning far off, on a bearing away from the camera's side of the field.
        nextFlash = t + 4 + rand() * 9;
        const a = rand() * Math.PI * 2;
        const r = opts.radius * (1.6 + rand());
        layer.onFlash?.(Math.cos(a) * r, Math.sin(a) * r, 0.4 + rand() * 0.6);
      }
      if (t < nextFlash - 30) nextFlash = t + 3;
    },
    materials: () => fields.map((f) => f.mat),
    dispose() {
      for (const f of fields) {
        f.geo.dispose();
        f.mat.dispose();
      }
      for (const x of disposables) x.dispose();
    },
  };
  return layer;
}
