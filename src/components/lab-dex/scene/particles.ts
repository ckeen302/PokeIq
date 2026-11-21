import * as THREE from "three";

/**
 * A few particles round the Pokémon on the holo-table, in the way of its
 * type: embers rising off a Fire type, bubbles for Water and Poison, leaves
 * drifting down round Grass and Bug, sparks crackling round Electric, snow
 * for Ice, dust for Rock and Ground, soft motes for the rest. All drawn by
 * one small shader (positions come from each particle's seed and the time),
 * so changing type is a uniform, not new geometry.
 */

export const PARTICLE_MODES: Record<string, number> = {
  fire: 1,
  water: 2,
  poison: 2,
  grass: 3,
  bug: 3,
  electric: 4,
  ice: 5,
  rock: 6,
  ground: 6,
};

export interface TypeParticles {
  points: THREE.Points;
  /** Switch to a type (fades out, changes, fades in). */
  setType(type: string, color: THREE.Color): void;
  /** How many draw (0 hides them). */
  setCount(n: number): void;
  update(dt: number): void;
  dispose(): void;
}

const MAX = 320;

export function typeParticles(time: { value: number }, centre: THREE.Vector3): TypeParticles {
  const seed = new Float32Array(MAX * 4);
  let s = 12345;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < MAX * 4; i++) seed[i] = rnd();
  const g = new THREE.BufferGeometry();
  // Positions are computed in the shader; a dummy attribute keeps three.js's draw count.
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
  g.setAttribute("seed", new THREE.BufferAttribute(seed, 4));
  g.setDrawRange(0, 0);
  const uniforms = {
    uTime: time,
    uMode: { value: 0 },
    uColor: { value: new THREE.Color(1, 1, 1) },
    uAlpha: { value: 0 },
    uCentre: { value: centre },
    uScale: { value: 600 },
  };
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec4 seed;
      uniform float uTime, uMode, uScale;
      uniform vec3 uCentre;
      varying float vLife;
      varying float vSpin;
      varying float vFlash;
      const float TAU = 6.2831853;
      void main() {
        float speed, life, rad, h0, h1, size;
        // Per mode: rise speed (m/s, negative falls), radius, height band, size.
        if (uMode < 0.5) { speed = 0.12; rad = 1.9; h0 = 0.0; h1 = 3.2; size = 0.045; }
        else if (uMode < 1.5) { speed = 0.55; rad = 1.1; h0 = 0.0; h1 = 2.6; size = 0.05; }
        else if (uMode < 2.5) { speed = 0.32; rad = 1.5; h0 = 0.0; h1 = 3.0; size = 0.07; }
        else if (uMode < 3.5) { speed = -0.22; rad = 2.1; h0 = 0.0; h1 = 3.4; size = 0.085; }
        else if (uMode < 4.5) { speed = 0.0; rad = 1.35; h0 = 0.1; h1 = 2.6; size = 0.06; }
        else if (uMode < 5.5) { speed = -0.18; rad = 2.2; h0 = 0.0; h1 = 3.6; size = 0.05; }
        else { speed = 0.05; rad = 2.0; h0 = 0.0; h1 = 1.1; size = 0.04; }
        float span = h1 - h0;
        float t = uTime + seed.x * 40.0;
        // Height: wraps round its band (rising or falling); life 0→1 over one pass.
        float y = abs(speed) > 0.001 ? fract(seed.y + t * speed / span) : seed.y;
        if (speed < 0.0) y = 1.0 - fract(seed.y + t * -speed / span);
        vLife = speed < 0.0 ? 1.0 - y : y;
        float r = rad * (0.35 + 0.65 * sqrt(seed.z));
        float a = seed.w * TAU + t * (0.08 + 0.12 * seed.z) * (uMode < 0.5 ? 1.0 : 0.4);
        vec3 p = vec3(sin(a) * r, h0 + y * span, cos(a) * r);
        if (uMode > 0.5 && uMode < 1.5) { p.x += sin(t * 2.3 + seed.x * 9.0) * 0.08 * y; p.z += cos(t * 1.9 + seed.y * 7.0) * 0.08 * y; r *= 1.0 - 0.4 * y; }
        if (uMode > 1.5 && uMode < 2.5) { p.x += sin(t * 3.0 + seed.z * 11.0) * 0.05; }
        if (uMode > 2.5 && uMode < 3.5) { p.x += sin(t * 1.1 + seed.x * 6.0) * 0.35; p.z += cos(t * 0.9 + seed.y * 5.0) * 0.2; }
        if (uMode > 4.5 && uMode < 5.5) { p.x += sin(t * 0.7 + seed.x * 6.0) * 0.18; }
        vFlash = 1.0;
        if (uMode > 3.5 && uMode < 4.5) {
          // Sparks: each one jumps somewhere new a few times a second and flashes there.
          float k = floor(t * (2.0 + 3.0 * seed.z));
          float h = fract(sin(k * 12.9898 + seed.x * 78.233) * 43758.5453);
          float h2 = fract(sin(k * 39.346 + seed.y * 11.135) * 43758.5453);
          p = vec3(sin(h * TAU) * r, h0 + h2 * span, cos(h * TAU) * r);
          vFlash = pow(1.0 - fract(t * (2.0 + 3.0 * seed.z)), 3.0);
        }
        vSpin = seed.x * TAU + uTime * (0.6 + seed.y) * (uMode > 2.5 && uMode < 3.5 ? 1.0 : 0.2);
        vec4 mv = modelViewMatrix * vec4(uCentre + p, 1.0);
        float sz = size * (0.55 + 0.9 * seed.w);
        if (uMode > 0.5 && uMode < 1.5) sz *= 1.0 - 0.7 * y;
        gl_PointSize = sz * uScale / max(0.5, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uMode, uAlpha;
      uniform vec3 uColor;
      varying float vLife;
      varying float vSpin;
      varying float vFlash;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float c = cos(vSpin), s = sin(vSpin);
        vec2 rq = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
        float d = length(q) * 2.0;
        float a;
        vec3 col = uColor;
        if (uMode > 1.5 && uMode < 2.5) {
          // A bubble: a bright rim, a clear middle, a glint.
          a = smoothstep(1.0, 0.82, d) * (0.25 + 0.75 * smoothstep(0.55, 0.9, d));
          a += smoothstep(0.22, 0.0, length(q - vec2(-0.16, 0.16))) * 0.8;
          col = mix(uColor, vec3(1.0), 0.35);
        } else if (uMode > 2.5 && uMode < 3.5) {
          // A leaf: a pointed ellipse with a lighter vein.
          vec2 l = rq * vec2(2.2, 1.0);
          float e = length(vec2(l.x, l.y * (1.0 + 0.6 * abs(l.y) * 2.0))) * 2.0;
          a = smoothstep(1.0, 0.8, e);
          col = mix(uColor * 0.75, uColor * 1.3, smoothstep(0.08, 0.0, abs(rq.x)));
        } else if (uMode > 4.5 && uMode < 5.5) {
          // A snowflake: six soft arms.
          float ang = atan(rq.y, rq.x);
          float arms = pow(abs(cos(ang * 3.0)), 18.0);
          a = (smoothstep(1.0, 0.0, d) * arms + smoothstep(0.35, 0.0, d)) * 0.9;
          col = mix(uColor, vec3(1.0), 0.6);
        } else if (uMode > 3.5 && uMode < 4.5) {
          // A spark: a hot core and a four-point flare.
          float cross = max(smoothstep(0.1, 0.0, abs(rq.x)), smoothstep(0.1, 0.0, abs(rq.y))) * smoothstep(1.0, 0.2, d);
          a = (smoothstep(0.4, 0.0, d) + cross) * vFlash;
          col = mix(uColor, vec3(1.0), 0.45);
        } else {
          a = pow(max(0.0, 1.0 - d), 2.0);
          if (uMode > 0.5 && uMode < 1.5) col = mix(vec3(1.0, 0.85, 0.5), uColor, vLife);
        }
        // Fade in at the start of its path and out at the end.
        a *= smoothstep(0.0, 0.12, vLife) * smoothstep(1.0, 0.8, vLife);
        if (a < 0.01) discard;
        gl_FragColor = vec4(col * a * uAlpha * 1.6, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(g, m);
  points.frustumCulled = false;
  points.renderOrder = 6;
  let count = 0;
  let wantMode = 0;
  const wantColor = new THREE.Color(1, 1, 1);
  let switching = false;
  let level = 0;
  return {
    points,
    setType(type, color) {
      const mode = PARTICLE_MODES[type] ?? 0;
      wantColor.copy(color);
      if (mode !== wantMode || uniforms.uAlpha.value === 0) switching = true;
      wantMode = mode;
    },
    setCount(n) {
      count = Math.max(0, Math.min(MAX, Math.round(n)));
      g.setDrawRange(0, count);
      points.visible = count > 0;
    },
    update(dt) {
      if (switching) {
        level = Math.max(0, level - dt * 2.5);
        if (level === 0) {
          uniforms.uMode.value = wantMode;
          switching = false;
        }
      } else level = Math.min(1, level + dt * 1.2);
      uniforms.uColor.value.lerp(wantColor, 1 - Math.exp(-dt * 4));
      uniforms.uAlpha.value = level;
    },
    dispose() {
      g.dispose();
      m.dispose();
    },
  };
}
