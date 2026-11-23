import * as THREE from "three";
import { EFFECTS, type Effect } from "@/lib/pokeball-maker/design";

/**
 * The opening effect and the catch's stars: one Points draw call whose every particle's place, size, turn and
 * fade come from its seed and the effect's time in the vertex shader (like the Lab's type particles), and whose
 * shape (heart, star, flame, bubble, spark, petal, confetti, smoke puff) is drawn in the fragment shader. A pure
 * function of time, so a video frame is the same as the stage's.
 */

export const MAX_PARTICLES = 640;
/** The catch's stars, after the effects. */
export const STARS_MODE = EFFECTS.length;

export interface Particles {
  points: THREE.Points;
  /** The effect (or the catch's stars), its colours, and its time in seconds (< 0 hides it). */
  set(mode: number, colours: [THREE.Color, THREE.Color, THREE.Color], t: number): void;
  setCount(n: number): void;
  /** Pixels per millimetre at a distance of one unit (the viewport's height over 2·tan(fov/2)). */
  setScale(px: number): void;
  dispose(): void;
}

const VS = /* glsl */ `
attribute vec4 seed;
uniform float uT, uMode, uScale, uCount;
varying float vAlpha, vRot, vMix, vMode, vAspect;
const float TAU = 6.28318531;
void main() {
  vMode = uMode;
  float id = float(gl_VertexID);
  float hide = step(uCount, id) + step(uT, -0.0001);
  float delay = seed.z * 0.45;
  float life = 1.4 + seed.w * 1.1;
  vec3 dir;
  float th = seed.x * TAU;
  float up = mix(0.15, 1.0, seed.y);
  float side = sqrt(1.0 - up * up);
  dir = vec3(side * cos(th), up, side * sin(th));
  vec3 p = vec3(0.0);
  float size = 6.0;
  vRot = seed.x * 20.0;
  vMix = seed.w;
  vAspect = 1.0;
  float age = uT - delay;
  float k = clamp(age / life, 0.0, 1.0);
  vAlpha = smoothstep(0.0, 0.08, k) * (1.0 - smoothstep(0.65, 1.0, k));
  int m = int(uMode + 0.5);
  if (m == 1) {
    // Hearts: thrown up and out, then floating.
    float sp = 70.0 * (0.6 + seed.w * 0.6);
    p = dir * sp * (1.0 - exp(-age * 2.2)) / 2.2 + vec3(sin(age * 3.0 + seed.x * 9.0) * 4.0, age * 9.0, 0.0);
    size = 7.0 + 4.0 * seed.y;
    vRot = sin(age * 2.0 + seed.x * 6.0) * 0.4;
  } else if (m == 2) {
    // Stars: a fast burst with drag, spinning.
    float sp = 120.0 * (0.5 + seed.w * 0.7);
    p = dir * sp * (1.0 - exp(-age * 3.0)) / 3.0;
    size = 5.0 + 5.0 * seed.y;
    vRot = seed.x * 6.0 + age * (seed.w - 0.5) * 6.0;
    vAlpha *= 0.75 + 0.25 * sin(age * 18.0 + seed.x * 30.0);
  } else if (m == 3) {
    // Fire: embers rising and flickering, hot at first.
    life = 0.7 + seed.w * 0.8;
    delay = seed.z * 1.6;
    age = mod(max(uT - seed.z * 0.4, 0.0), life + 0.2);
    k = clamp(age / life, 0.0, 1.0);
    vAlpha = smoothstep(0.0, 0.1, k) * (1.0 - smoothstep(0.4, 1.0, k)) * (1.0 - smoothstep(2.0, 2.6, uT));
    p = vec3(dir.x * 14.0, 0.0, dir.z * 14.0) * (0.4 + k) + vec3(sin(age * 9.0 + seed.y * 20.0) * 2.5, age * 70.0 * (0.6 + seed.y * 0.6), 0.0);
    size = 9.0 * (1.0 - k * 0.7) + 3.0 * seed.y;
    vMix = k;
    vRot = sin(age * 6.0 + seed.x * 9.0) * 0.3;
  } else if (m == 4) {
    // Bubbles: drifting up with a wobble.
    float sp = 40.0 * (0.4 + seed.w * 0.6);
    p = dir * sp * (1.0 - exp(-age * 2.0)) / 2.0 + vec3(sin(age * 2.6 + seed.x * 12.0) * 5.0, age * 18.0, cos(age * 2.1 + seed.y * 7.0) * 3.0);
    size = 4.0 + 8.0 * seed.y * seed.y;
  } else if (m == 5) {
    // Lightning: short-lived sparks flying straight out, in waves.
    float wave = floor(seed.z * 4.0);
    delay = wave * 0.32;
    life = 0.28 + seed.w * 0.3;
    age = uT - delay;
    k = clamp(age / life, 0.0, 1.0);
    vAlpha = step(0.0, age) * (1.0 - k) * step(k, 0.999);
    float sp = 220.0 * (0.5 + seed.w * 0.6);
    p = dir * sp * age;
    size = 7.0 + 5.0 * seed.y;
    vRot = atan(dir.y, dir.x + dir.z * 0.6);
    vAspect = 0.22;
  } else if (m == 6) {
    // Petals: blown out, then fluttering down.
    float sp = 80.0 * (0.5 + seed.w * 0.6);
    p = dir * sp * (1.0 - exp(-age * 2.0)) / 2.0 + vec3(sin(age * 2.0 + seed.x * 9.0) * 8.0, -age * age * 6.0, cos(age * 1.7 + seed.y * 5.0) * 6.0);
    size = 6.0 + 3.0 * seed.y;
    vRot = age * (1.5 + seed.w * 3.0) + seed.x * 6.0;
    vAspect = 0.55 + 0.45 * cos(age * 5.0 + seed.y * 9.0);
  } else if (m == 7) {
    // Confetti: thrown up, falling, tumbling.
    float sp = 140.0 * (0.5 + seed.w * 0.5);
    vec3 v = dir * sp;
    p = v * (1.0 - exp(-age * 2.4)) / 2.4 + vec3(0.0, -age * age * 22.0, 0.0);
    size = 4.0 + 3.0 * seed.y;
    vRot = age * (4.0 + seed.w * 8.0) + seed.x * 6.0;
    vAspect = 0.35 + 0.6 * abs(cos(age * 7.0 + seed.y * 9.0));
  } else if (m == 8) {
    // Smoke: soft puffs swelling and rising.
    float sp = 30.0 * (0.4 + seed.w * 0.6);
    p = dir * sp * (1.0 - exp(-age * 1.5)) / 1.5 + vec3(0.0, age * 10.0, 0.0);
    size = 14.0 + 28.0 * k + 8.0 * seed.y;
    vAlpha *= 0.42;
    vRot = seed.x * 6.0 + age * 0.4;
  } else if (m == 9) {
    // The catch's stars: three, up and out from the top of the ball.
    float i = mod(id, 3.0);
    hide += step(3.0, id);
    life = 0.95;
    age = uT;
    k = clamp(age / life, 0.0, 1.0);
    vAlpha = smoothstep(0.0, 0.06, k) * (1.0 - smoothstep(0.55, 1.0, k));
    float a = (i - 1.0) * 0.75;
    vec3 d = vec3(sin(a), cos(a), 0.15);
    p = vec3(0.0, 26.0, 6.0) + d * 34.0 * (1.0 - exp(-age * 5.0));
    size = 12.0 * (1.0 - 0.4 * k);
    vRot = age * 3.0 * (i - 1.0) + i;
    vMix = i / 2.0;
  }
  if (age < 0.0 && m != 9) vAlpha = 0.0;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = hide > 0.5 ? 0.0 : size * uScale / max(1.0, -mv.z);
  if (hide > 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const FS = /* glsl */ `
uniform vec3 uC1, uC2, uC3;
varying float vAlpha, vRot, vMix, vMode, vAspect;
float heart(vec2 p) {
  p.x = abs(p.x);
  p.y += 0.55;
  if (p.y + p.x > 1.0) return length(p - vec2(0.25, 0.75)) - 0.35355339;
  vec2 a = p - vec2(0.0, 1.0);
  vec2 b = p - 0.5 * max(p.x + p.y, 0.0);
  return sqrt(min(dot(a, a), dot(b, b))) * sign(p.x - p.y);
}
float star(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-0.809016994375, -0.587785252292);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
void main() {
  if (vAlpha <= 0.002) discard;
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  p.y = -p.y;
  float c = cos(vRot), s = sin(vRot);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  int m = int(vMode + 0.5);
  float a = 0.0;
  vec3 col = mix(uC1, uC2, step(0.5, vMix));
  col = mix(col, uC3, step(0.82, vMix));
  float e = 0.08;
  if (m == 1) a = 1.0 - smoothstep(-e, e, heart(p * 1.15));
  else if (m == 2 || m == 9) {
    float d = star(p, 0.85, 0.45);
    a = 1.0 - smoothstep(-e, e, d);
    col = m == 9 ? mix(vec3(1.0, 0.86, 0.3), vec3(1.0), 0.25) : col;
    a += (1.0 - smoothstep(0.0, 0.7, length(p))) * 0.35;
  } else if (m == 3) {
    float d = length(p * vec2(1.0, 0.75) + vec2(0.0, 0.15)) - 0.65 + 0.25 * max(p.y, 0.0);
    a = (1.0 - smoothstep(-0.35, 0.05, d));
    col = mix(uC3, mix(uC2, uC1, smoothstep(0.35, 0.8, vMix)), smoothstep(0.1, 0.45, vMix));
  } else if (m == 4) {
    float r = length(p);
    a = smoothstep(0.98, 0.86, r) * (0.25 + 0.75 * smoothstep(0.55, 0.92, r));
    a += (1.0 - smoothstep(0.0, 0.22, length(p - vec2(-0.35, 0.35)))) * 0.9;
    col = mix(uC1, uC2, vMix);
  } else if (m == 5) {
    vec2 q = p / vec2(1.0, vAspect);
    a = 1.0 - smoothstep(0.4, 1.0, length(q));
    a = pow(a, 0.6);
    col = mix(uC1, uC2, vMix) + 0.4;
  } else if (m == 6) {
    vec2 q = p / vec2(vAspect, 1.0);
    float d = length(q * vec2(1.0, 0.62)) - 0.62 + 0.18 * abs(q.x);
    a = 1.0 - smoothstep(-e, e, d);
    col = mix(col, vec3(1.0), 0.25 * (1.0 - length(q)));
  } else if (m == 7) {
    vec2 q = abs(p / vec2(1.0, vAspect));
    a = step(q.x, 0.55) * step(q.y, 0.85);
  } else if (m == 8) {
    a = (1.0 - smoothstep(0.0, 1.0, length(p))) * 0.9;
    col = mix(uC1, uC2, vMix * 0.6);
  }
  a = clamp(a, 0.0, 1.0) * vAlpha;
  if (a <= 0.002) discard;
  gl_FragColor = vec4(col, a);
}`;

const ADDITIVE = new Set([2, 3, 5, STARS_MODE]);

export function createParticles(): Particles {
  const seed = new Float32Array(MAX_PARTICLES * 4);
  let s = 90210;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < seed.length; i++) seed[i] = rnd();
  const g = new THREE.BufferGeometry();
  // Places come from the shader; a placeholder keeps three.js's draw count.
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
  g.setAttribute("seed", new THREE.BufferAttribute(seed, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 400);
  const u = {
    uT: { value: -1 },
    uMode: { value: 0 },
    uScale: { value: 600 },
    uCount: { value: MAX_PARTICLES },
    uC1: { value: new THREE.Color(1, 1, 1) },
    uC2: { value: new THREE.Color(1, 1, 1) },
    uC3: { value: new THREE.Color(1, 1, 1) },
  };
  const m = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false });
  const points = new THREE.Points(g, m);
  points.frustumCulled = false;
  points.renderOrder = 5;
  let count = MAX_PARTICLES;
  return {
    points,
    set(mode, colours, t) {
      const want = ADDITIVE.has(mode) ? THREE.AdditiveBlending : THREE.NormalBlending;
      if (m.blending !== want) m.blending = want;
      u.uMode.value = mode;
      u.uT.value = t;
      u.uC1.value.copy(colours[0]);
      u.uC2.value.copy(colours[1]);
      u.uC3.value.copy(colours[2]);
      points.visible = t >= 0 && mode > 0;
      g.setDrawRange(0, mode === STARS_MODE ? 3 : count);
    },
    setCount(n) {
      count = Math.max(0, Math.min(MAX_PARTICLES, n));
      u.uCount.value = count;
    },
    setScale(px) {
      u.uScale.value = px;
    },
    dispose() {
      g.dispose();
      m.dispose();
    },
  };
}

export const effectMode = (e: Effect) => EFFECTS.indexOf(e);
