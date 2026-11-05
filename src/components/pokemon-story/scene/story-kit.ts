import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Vec3 } from "@/lib/world-history/camera";
import { NOISE, col, makeGlow, makeParticles, merge, placed, rng, v3 } from "@/components/world-history/scene/kit";
import { makeCanvasPanel } from "@/components/world-history/scene/props";

/**
 * The Story of Pokémon's own props, all procedural and original: tall grass
 * in the wind, fireflies, people as backlit silhouettes, the hardware
 * (Game Boy to Switch 2, generic shapes, no logos), a globe of points with
 * arcs of light, trading cards, crowds, and little pixel creatures drawn
 * from a seed. Like the shared kit, everything is a function of the clocks
 * it is given, so a scrubbed film and an exported video draw the same frames.
 */

// ---------------------------------------------------------------------------
// Grass
// ---------------------------------------------------------------------------

export function makeGrass(o: { count: number; center: Vec3; size: [number, number]; height: [number, number]; base: string; tip: string; seed?: number; clear?: { x: number; z: number; r: number }; shadow?: SunShadows }) {
  const r = rng(o.seed ?? 5);
  const blade = new THREE.BufferGeometry();
  // A tapered blade: 4 segments, 9 vertices.
  const segs = 4;
  const pos: number[] = [], ys: number[] = [], idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const y = i / segs, w = 0.5 * (1 - y * 0.92);
    if (i < segs) { pos.push(-w, y, 0, w, y, 0); ys.push(y, y); }
    else { pos.push(0, 1, 0); ys.push(1); }
  }
  for (let i = 0; i < segs - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  idx.push((segs - 1) * 2, (segs - 1) * 2 + 1, segs * 2);
  blade.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  blade.setIndex(idx);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = blade.index;
  geo.setAttribute("position", blade.getAttribute("position"));
  const n = Math.max(1, Math.round(o.count));
  const off = new Float32Array(n * 4), shape = new Float32Array(n * 4);
  let k = 0;
  for (let i = 0; i < n * 3 && k < n; i++) {
    const x = o.center[0] + (r() - 0.5) * o.size[0], z = o.center[2] + (r() - 0.5) * o.size[1];
    if (o.clear && Math.hypot(x - o.clear.x, z - o.clear.z) < o.clear.r * (0.7 + r() * 0.4)) continue;
    off.set([x, o.center[1], z, r()], k * 4);
    shape.set([o.height[0] + r() * (o.height[1] - o.height[0]), 0.012 + r() * 0.018, r() * Math.PI, r()], k * 4);
    k++;
  }
  geo.instanceCount = k;
  geo.setAttribute("aOff", new THREE.InstancedBufferAttribute(off, 4));
  geo.setAttribute("aShape", new THREE.InstancedBufferAttribute(shape, 4));
  const u = { uTime: { value: 0 }, uSink: { value: 0 }, uBase: { value: col(o.base) }, uTip: { value: col(o.tip) }, uLight: { value: 1 }, uWind: { value: 1 }, uSun: { value: col("#ffcf7a") }, uSunDir: { value: new THREE.Vector3(0.3, 0.25, -1).normalize() }, uSat: { value: 1 } };
  const sh = o.shadow;
  const mat = new THREE.ShaderMaterial({
    uniforms: sh ? { ...u, ...sh.uniforms } : u,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      ${NOISE}
      attribute vec4 aOff; attribute vec4 aShape;
      uniform float uTime, uSink, uWind;
      varying float vY; varying float vSeed; varying vec3 vW;
      void main(){
        float h = aShape.x * (1.0 - uSink);
        vec3 p = position;
        float cs = cos(aShape.z), sn = sin(aShape.z);
        p.x *= aShape.y * 2.0;
        vec3 q = vec3(p.x * cs, p.y * h, p.x * sn);
        float gust = whNoise(vec3(aOff.x * 0.08 + uTime * 0.35, aOff.z * 0.08, 0.0));
        float bend = (0.35 + 0.65 * gust) * uWind * p.y * p.y * h * 0.45;
        q.x += bend * (0.8 + 0.2 * sin(uTime * 2.1 + aOff.w * 30.0));
        q.z += bend * 0.3 * sin(uTime * 1.3 + aOff.w * 11.0);
        q.y -= uSink * 0.2;
        vec4 wp = modelMatrix * vec4(aOff.xyz + q, 1.0);
        vW = wp.xyz; vY = p.y; vSeed = aOff.w;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uBase, uTip, uSun, uSunDir; uniform float uLight, uSat;
      varying float vY; varying float vSeed; varying vec3 vW;
      ${sh ? sh.glsl : ""}
      void main(){
        vec3 c = mix(uBase, uTip, vY) * (0.75 + 0.5 * vSeed);
        vec3 v = normalize(cameraPosition - vW);
        float back = pow(max(dot(-v, uSunDir), 0.0), 3.0) * vY;
        float lit = ${sh ? "1.0 - sunShadow(vW)" : "1.0"};
        c = c * uLight * (0.55 + 0.45 * vY) * mix(vec3(0.42, 0.5, 0.68), vec3(1.0), lit) + uSun * back * 0.35 * uLight * lit;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        gl_FragColor = vec4(mix(vec3(l), c, uSat), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, u, dispose() { geo.dispose(); blade.dispose(); mat.dispose(); } };
}

// ---------------------------------------------------------------------------
// Sun shadows without a shadow map: rays toward the sun tested against a few
// boxes (houses) and spheres (tree crowns), so long low-sun shadows fall on
// the ground, the grass and the hedges in one pass, with no overlap seams.
// ---------------------------------------------------------------------------

export const MAX_SHADOW_BOXES = 16, MAX_SHADOW_BALLS = 72;
export interface SunShadows {
  uniforms: Record<string, { value: unknown }>;
  glsl: string;
  /** Adds the shadow to a standard material's direct light (ambient stays, so shade is sky-blue). */
  patch(m: THREE.MeshStandardMaterial, tag: string): void;
  setSun(d: THREE.Vector3): void;
}

export function makeSunShadows(o: { sun: Vec3; boxes: { c: Vec3; half: Vec3; rot: number }[]; balls?: [number, number, number, number][] }): SunShadows {
  const boxes = o.boxes.slice(0, MAX_SHADOW_BOXES), balls = (o.balls ?? []).slice(0, MAX_SHADOW_BALLS);
  const pad = <T,>(a: T[], n: number, z: () => T) => { const out = a.slice(); while (out.length < n) out.push(z()); return out; };
  const uniforms = {
    uShSun: { value: v3(o.sun).normalize() },
    uShBoxC: { value: pad(boxes.map((b) => v3(b.c)), MAX_SHADOW_BOXES, () => new THREE.Vector3(0, -999, 0)) },
    uShBoxH: { value: pad(boxes.map((b) => v3(b.half)), MAX_SHADOW_BOXES, () => new THREE.Vector3(0.001, 0.001, 0.001)) },
    uShBoxR: { value: pad(boxes.map((b) => new THREE.Vector2(Math.cos(b.rot), Math.sin(b.rot))), MAX_SHADOW_BOXES, () => new THREE.Vector2(1, 0)) },
    uShBall: { value: pad(balls.map((b) => new THREE.Vector4(...b)), MAX_SHADOW_BALLS, () => new THREE.Vector4(0, -999, 0, 0.001)) },
    uShK: { value: 1 },
  };
  const glsl = /* glsl */ `
    uniform vec3 uShSun; uniform vec3 uShBoxC[${MAX_SHADOW_BOXES}]; uniform vec3 uShBoxH[${MAX_SHADOW_BOXES}]; uniform vec2 uShBoxR[${MAX_SHADOW_BOXES}]; uniform vec4 uShBall[${MAX_SHADOW_BALLS}]; uniform float uShK;
    float sunShadow(vec3 p) {
      float s = 0.0;
      for (int i = 0; i < ${MAX_SHADOW_BOXES}; i++) {
        vec3 o = p - uShBoxC[i];
        vec2 cs = uShBoxR[i];
        // Into the box's frame (it is turned by rot about y).
        vec3 lo = vec3(cs.x * o.x - cs.y * o.z, o.y, cs.y * o.x + cs.x * o.z);
        vec3 ld = vec3(cs.x * uShSun.x - cs.y * uShSun.z, uShSun.y, cs.y * uShSun.x + cs.x * uShSun.z);
        ld = sign(ld + 1e-6) * max(abs(ld), vec3(1e-4));
        vec3 t1 = (-uShBoxH[i] - lo) / ld, t2 = (uShBoxH[i] - lo) / ld;
        vec3 tn = min(t1, t2), tf = max(t1, t2);
        float a = max(max(tn.x, tn.y), tn.z), b = min(min(tf.x, tf.y), tf.z);
        if (b > max(a, 0.0)) s = 1.0;
      }
      for (int i = 0; i < ${MAX_SHADOW_BALLS}; i++) {
        vec3 o = uShBall[i].xyz - p;
        float tc = dot(o, uShSun);
        float d2 = dot(o, o) - tc * tc;
        float r2 = uShBall[i].w * uShBall[i].w;
        if (tc > 0.0 && d2 < r2) s = max(s, smoothstep(r2, r2 * 0.55, d2));
      }
      return s * uShK;
    }`;
  return {
    uniforms, glsl,
    patch(m, tag) {
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (s, r) => {
        prev.call(m, s, r);
        Object.assign(s.uniforms, uniforms);
        if (!s.vertexShader.includes("vShW;")) s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vShW;").replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvShW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
        s.fragmentShader = s.fragmentShader
          .replace("#include <common>", `#include <common>\nvarying vec3 vShW;\n${glsl}`)
          .replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\n{ float shd = sunShadow(vShW); reflectedLight.directDiffuse *= 1.0 - shd; reflectedLight.directSpecular *= 1.0 - shd; }");
      };
      const key = m.customProgramCacheKey.bind(m);
      m.customProgramCacheKey = () => `${key()}-sunshadow-${tag}`;
      m.needsUpdate = true;
    },
    setSun(d) { uniforms.uShSun.value.copy(d).normalize(); },
  };
}

// ---------------------------------------------------------------------------
// Fireflies: a swarm, and the single firefly that carries the film
// ---------------------------------------------------------------------------

export function makeFireflies(o: { count: number; center: Vec3; extent: Vec3; color?: string; seed?: number; intensity?: number }) {
  return makeParticles({ count: o.count, shape: "box", center: o.center, extent: o.extent, velocity: [0, 0.12, 0], spread: [0.25, 0.12, 0.25], life: 7, size: [0.05, 0.11], colors: [o.color ?? "#d9ff7a", o.color ?? "#f6ff9a", "#ffd36a"], intensity: o.intensity ?? 3.2, turbulence: 1.2, flicker: 0.7, fadeIn: 0.25, fadeOut: 0.35, seed: o.seed ?? 31 });
}

/** One firefly: a bright core and a soft halo, placed by the caller, pulsing. */
export function makeFirefly(o: { color?: string; size?: number }) {
  const halo = makeGlow({ pos: [0, 0, 0], size: (o.size ?? 0.5) * 3, color: o.color ?? "#e6ff8a", intensity: 1.4 });
  const core = makeGlow({ pos: [0, 0, 0], size: o.size ?? 0.5, color: "#fffbe0", intensity: 3 });
  const group = new THREE.Group();
  group.add(halo.sprite, core.sprite);
  return {
    group,
    set(pos: Vec3, k: number, ambient: number) {
      group.position.set(...pos);
      const pulse = 0.65 + 0.35 * Math.sin(ambient * 3.1) * Math.sin(ambient * 1.7 + 1);
      halo.set(o.color ?? "#e6ff8a", 1.4 * k * pulse);
      core.set("#fffbe0", 3 * k * (0.6 + 0.4 * pulse));
      group.visible = k > 0.01;
    },
    dispose() { halo.dispose(); core.dispose(); },
  };
}

// ---------------------------------------------------------------------------
// People, as silhouettes only
// ---------------------------------------------------------------------------

export type Pose = "stand" | "net" | "seated" | "walk" | "point" | "lean";

/** A limb segment between two points: a tapered cylinder with a rounded joint at each end. */
function limb(parts: THREE.BufferGeometry[], a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, joints = true) {
  const d = b.clone().sub(a), len = d.length();
  const g = new THREE.CylinderGeometry(rb, ra, len, 14, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  parts.push(g);
  // Joints as round as the limb and as finely divided, so the rim rolls over them without a seam or a bulge.
  if (joints) { parts.push(new THREE.SphereGeometry(ra, 14, 10).translate(a.x, a.y, a.z), new THREE.SphereGeometry(rb, 14, 10).translate(b.x, b.y, b.z)); }
}

/** A hand: a flattened palm, four fingers with a slight curl and a thumb (a silhouette, so the shape is what reads). */
function hand(parts: THREE.BufferGeometry[], wrist: THREE.Vector3, dir: THREE.Vector3, h: number, spread = 1) {
  const f = dir.clone().normalize();
  let side = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0));
  if (side.lengthSq() < 1e-4) side = new THREE.Vector3(1, 0, 0);
  side.normalize();
  const palmN = new THREE.Vector3().crossVectors(side, f).normalize();
  const palm = wrist.clone().addScaledVector(f, 0.022 * h);
  const pg = new THREE.SphereGeometry(0.021 * h, 12, 10).scale(1.15, 1.25, 0.5);
  pg.applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, f, palmN)));
  parts.push(pg.translate(palm.x, palm.y, palm.z));
  for (let i = 0; i < 4; i++) {
    const o = (i - 1.5) * 0.0105 * h * spread;
    const base = palm.clone().addScaledVector(f, 0.02 * h).addScaledVector(side, o);
    const len = (i === 1 || i === 2 ? 0.036 : 0.03) * h;
    const mid = base.clone().addScaledVector(f, len * 0.55).addScaledVector(side, o * 0.15);
    const tip = mid.clone().addScaledVector(f, len * 0.45).addScaledVector(palmN, -len * 0.25);
    limb(parts, base, mid, 0.0056 * h, 0.005 * h);
    limb(parts, mid, tip, 0.005 * h, 0.0042 * h);
  }
  const tb = palm.clone().addScaledVector(side, 0.017 * h).addScaledVector(f, -0.004 * h);
  const tt = tb.clone().addScaledVector(side, 0.012 * h).addScaledVector(f, 0.022 * h).addScaledVector(palmN, -0.006 * h);
  limb(parts, tb, tt, 0.0062 * h, 0.0048 * h);
}

/**
 * A person as a dark silhouette (no face, no likeness), built like a figure
 * study: an ovoid head on a neck, shoulders wider than the waist, a pelvis,
 * jointed arms and legs with hands and shoes, and a posture per beat
 * (standing at ease, walking, seated forward at a desk, pointing, or holding
 * a net up). Children have a larger head, shorter limbs and a cap. A soft rim
 * light follows the brightest directional light in the scene, so it catches
 * the edges that face the key, never a full outline.
 */
export function makeSilhouette(o: { height: number; pose?: Pose; child?: boolean; color?: string; rim?: string }) {
  const h = o.height, child = !!o.child, pose = o.pose ?? "stand";
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x * h, y * h, z * h);
  const parts: THREE.BufferGeometry[] = [];
  const seated = pose === "seated";
  // Landmarks (fractions of height), adult or child.
  const P = child
    ? { head: 0.9, headR: 0.088, neck: 0.8, sh: 0.755, shX: 0.1, chest: 0.68, waist: 0.56, hip: 0.47, hipX: 0.05, knee: 0.25, ankle: 0.04, upper: 0.15, fore: 0.13 }
    : { head: 0.935, headR: 0.064, neck: 0.855, sh: 0.82, shX: 0.118, chest: 0.73, waist: 0.6, hip: 0.5, hipX: 0.056, knee: 0.27, ankle: 0.04, upper: 0.17, fore: 0.15 };
  // Seated: the pelvis drops onto a seat and the upper body leans in a little.
  const drop = seated ? P.hip - 0.3 : 0, lean = seated ? 0.05 : pose === "walk" ? 0.02 : pose === "lean" ? 0.12 : 0;
  const up = (y: number, z = 0) => V(0, y - drop, z + lean * ((y - P.hip) / (1 - P.hip)));
  // Head (slightly ovoid), neck.
  const hc = up(P.head);
  parts.push(new THREE.SphereGeometry(P.headR * h, 18, 14).scale(0.9, 1.08, 0.98).translate(hc.x, hc.y, hc.z));
  const nk0 = up(P.neck), nk1 = up(P.head - P.headR * 0.6);
  limb(parts, nk0, nk1, 0.028 * h, 0.026 * h, false);
  if (child) {
    // A cap: a crown and a brim to the front.
    parts.push(new THREE.SphereGeometry(P.headR * h * 1.04, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).translate(hc.x, hc.y + P.headR * h * 0.12, hc.z));
    parts.push(new THREE.CylinderGeometry(P.headR * h * 0.7, P.headR * h * 0.7, 0.006 * h, 14).scale(1, 1, 0.75).translate(hc.x, hc.y + P.headR * h * 0.18, hc.z + P.headR * h * 0.9));
  }
  if (!child) {
    // Hair: a fuller mass at the back and crown, so the head is never a bare ball.
    parts.push(new THREE.SphereGeometry(P.headR * h * 1.03, 16, 12).scale(0.96, 0.86, 1.0).translate(hc.x, hc.y + P.headR * h * 0.2, hc.z - P.headR * h * 0.14));
  }
  // Torso as one smooth turned form: hips, a waist, the chest, sloping shoulders into the neck; oval in section.
  const sh = up(P.sh), hp = up(P.hip);
  const y0 = P.hip - 0.035, y1 = P.neck;
  const prof = ([[0, 0], [0.06, 0.6], [0.15, 0.74], [0.33, 0.64], [0.55, 0.8], [0.76, 0.95], [0.86, 1.0], [0.93, 0.78], [0.97, 0.42], [1, 0.25]] as [number, number][]).map(([t, r]) => new THREE.Vector2(Math.max(0.001, r * P.shX * h), (y0 + (y1 - y0) * t) * h));
  const torso = new THREE.LatheGeometry(prof, 20).scale(1, 1, 0.56);
  // Lean from the hips, then sit it on the pelvis.
  torso.translate(0, -P.hip * h, 0).rotateX(Math.atan2(lean, 1 - P.hip)).translate(0, (P.hip - drop) * h, 0);
  parts.push(torso);
  // Legs: thigh, shin, a shoe pointing forward.
  const legs: [THREE.Vector3, THREE.Vector3][] = seated
    ? [-1, 1].map((sd) => [V(sd * P.hipX * 1.05, P.hip - drop, 0.26), V(sd * P.hipX * 1.1, P.ankle, 0.3)])
    : pose === "walk"
      ? [[V(-P.hipX, P.knee + 0.01, 0.07), V(-P.hipX, P.ankle, 0.13)], [V(P.hipX, P.knee, -0.04), V(P.hipX, P.ankle + 0.03, -0.13)]]
      : [-1, 1].map((sd) => [V(sd * P.hipX * 1.05, P.knee, 0.012), V(sd * P.hipX * 1.15, P.ankle, 0)]);
  legs.forEach(([knee, ankle], i) => {
    const hipJ = V((i ? 1 : -1) * P.hipX, P.hip - drop - 0.01, 0);
    limb(parts, hipJ, knee, 0.05 * h, 0.036 * h);
    limb(parts, knee, ankle, 0.036 * h, 0.024 * h);
    parts.push(new THREE.SphereGeometry(0.03 * h, 10, 8).scale(1.05, 0.75, 2.1).translate(ankle.x, ankle.y - 0.012 * h, ankle.z + 0.03 * h));
  });
  // Arms: upper arm, forearm, a hand with fingers; posture per pose.
  void sh; void hp;
  const shL = up(P.sh - 0.025).add(V(-P.shX * 0.86, 0, 0)), shR = up(P.sh - 0.025).add(V(P.shX * 0.86, 0, 0));
  const arm = (s0: THREE.Vector3, dirE: THREE.Vector3, dirW: THREE.Vector3) => {
    const e = s0.clone().addScaledVector(dirE.normalize(), P.upper * h);
    const w = e.clone().addScaledVector(dirW.normalize(), P.fore * h);
    limb(parts, s0, e, 0.032 * h, 0.026 * h);
    limb(parts, e, w, 0.026 * h, 0.02 * h);
    const hd = w.clone().addScaledVector(dirW, 0.03 * h);
    hand(parts, w, dirW, h, pose === "lean" ? 1.25 : 1);
    return hd;
  };
  let handR: THREE.Vector3;
  if (seated) {
    arm(shL, new THREE.Vector3(-0.15, -1, 0.55), new THREE.Vector3(0.35, -0.05, 1));
    handR = arm(shR, new THREE.Vector3(0.15, -1, 0.55), new THREE.Vector3(-0.35, -0.05, 1));
  } else if (pose === "walk") {
    arm(shL, new THREE.Vector3(-0.12, -1, -0.32), new THREE.Vector3(-0.05, -1, -0.05));
    handR = arm(shR, new THREE.Vector3(0.12, -1, 0.3), new THREE.Vector3(0.0, -0.8, 0.5));
  } else if (pose === "point") {
    arm(shL, new THREE.Vector3(-0.15, -1, 0.05), new THREE.Vector3(-0.05, -1, 0.15));
    handR = arm(shR, new THREE.Vector3(0.25, -0.1, 1), new THREE.Vector3(0.1, 0.05, 1));
  } else if (pose === "net") {
    arm(shL, new THREE.Vector3(-0.2, -1, 0.1), new THREE.Vector3(-0.05, -1, 0.3));
    handR = arm(shR, new THREE.Vector3(0.5, 0.25, 0.6), new THREE.Vector3(0.35, 0.8, 0.45));
  } else if (pose === "lean") {
    // Leaning in over a table, both hands forward on it.
    arm(shL, new THREE.Vector3(-0.05, -0.75, 0.66), new THREE.Vector3(0.12, -0.75, 0.65));
    handR = arm(shR, new THREE.Vector3(0.05, -0.75, 0.66), new THREE.Vector3(-0.12, -0.75, 0.65));
  } else {
    // At ease: arms hang a little out from the body, elbows soft.
    arm(shL, new THREE.Vector3(-0.16, -1, -0.03), new THREE.Vector3(0.02, -1, 0.14));
    handR = arm(shR, new THREE.Vector3(0.16, -1, -0.03), new THREE.Vector3(-0.02, -1, 0.14));
  }
  if (pose === "net") {
    // A long pole held up from the raised hand, ending in a ring with a mesh bag.
    const dir = new THREE.Vector3(0.62, 0.72, 0.3).normalize();
    const tip = handR.clone().addScaledVector(dir, 0.72 * h);
    limb(parts, handR.clone().addScaledVector(dir, -0.12 * h), tip, 0.008 * h, 0.007 * h, false);
    const ringC = tip.clone().addScaledVector(dir, 0.1 * h);
    parts.push(new THREE.TorusGeometry(h * 0.1, h * 0.008, 6, 20).rotateY(Math.PI / 2).translate(ringC.x, ringC.y, ringC.z));
    parts.push(new THREE.ConeGeometry(h * 0.095, h * 0.2, 12, 1, true).rotateZ(Math.PI).translate(ringC.x, ringC.y - h * 0.12, ringC.z));
  }
  const geo = merge(parts);
  parts.forEach((g) => g.dispose());
  const mat = new THREE.MeshStandardMaterial({ color: col(o.color ?? "#0d0b10"), roughness: 0.85, metalness: 0, emissive: col(o.rim ?? "#000000"), emissiveIntensity: 0 });
  const rimDir = new THREE.Vector3(0, 1, -0.3).normalize();
  mat.onBeforeCompile = (s) => {
    s.uniforms.uRimC = { value: col(o.rim ?? "#ffcf8a") };
    s.uniforms.uRimK = { value: 1.4 };
    s.uniforms.uRimDir = { value: rimDir };
    mat.userData.shader = s;
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uRimC; uniform float uRimK; uniform vec3 uRimDir;")
      // The rim catches the edges that face the key light (a little from above too), never a full outline.
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n{ vec3 sn = normalize(vNormal); float f = clamp(1.0 - abs(dot(sn, normalize(vViewPosition))), 0.0, 1.0); float toward = smoothstep(-0.1, 0.8, dot(sn, uRimDir)); float above = smoothstep(0.0, 0.9, sn.y); float f2 = f * f; totalEmissiveRadiance += uRimC * f2 * f2 * uRimK * (0.05 + 1.0 * toward + 0.2 * above); }");
  };
  mat.customProgramCacheKey = () => "ps-silhouette-2";
  const mesh = new THREE.Mesh(geo, mat);
  // Find the scene's key (its brightest directional light) once, then track its direction in view space each frame.
  let key: THREE.DirectionalLight | null | undefined;
  const tmp = new THREE.Vector3();
  mesh.onBeforeRender = (_r, scene, camera) => {
    if (key === undefined) {
      key = null;
      scene.traverse((x) => { if ((x as THREE.DirectionalLight).isDirectionalLight && (!key || (x as THREE.DirectionalLight).intensity > key.intensity)) key = x as THREE.DirectionalLight; });
    }
    if (key) {
      tmp.setFromMatrixPosition(key.matrixWorld).sub(tmp.clone().setFromMatrixPosition(key.target.matrixWorld));
      if (tmp.lengthSq() > 1e-8) rimDir.copy(tmp.normalize().transformDirection(camera.matrixWorldInverse).normalize()).lerp(new THREE.Vector3(0, 0.6, -0.8), 0.25).normalize();
    }
  };
  return {
    mesh,
    setRim(color: string, k: number) {
      const s = mat.userData.shader as { uniforms: Record<string, { value: unknown }> } | undefined;
      if (s) { (s.uniforms.uRimC.value as THREE.Color).copy(col(color)); s.uniforms.uRimK.value = k; }
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

/** A line of woods behind a field: merged trunks and lumpy crowns (two draw calls), with a gap along the sun's line. */
export function makeWoods(o: { height: (x: number, z: number) => number; center: Vec3; seed?: number; count?: number; sunX?: (z: number) => number }) {
  const r = rng(o.seed ?? 12);
  const trunkG: THREE.BufferGeometry[] = [], crownG: THREE.BufferGeometry[] = [];
  const [cx, , cz] = o.center;
  for (let i = 0, made = 0; i < 200 && made < (o.count ?? 64); i++) {
    const x = (r() - 0.5) * 140, z = -24 - r() * 52;
    if (o.sunX && Math.abs(x - o.sunX(z)) < 7 + (9 - z) * 0.08) continue;
    made++;
    const s = 0.75 + r() * 1.0;
    const y0 = o.height(cx + x, cz + z);
    trunkG.push(placed(new THREE.CylinderGeometry(0.22, 0.42, 7, 7), [cx + x, y0 + 3.5 * s, cz + z], 0, [s, s, s], (r() - 0.5) * 0.08));
    const lumps = 3 + Math.floor(r() * 3);
    for (let j = 0; j < lumps; j++) {
      const a = r() * Math.PI * 2, d = r() * 1.9 * s;
      crownG.push(placed(new THREE.IcosahedronGeometry(1.9 + r() * 1.2, 1), [cx + x + Math.cos(a) * d, y0 + (6.4 + r() * 2.6) * s, cz + z + Math.sin(a) * d * 0.6], r() * 3, [s * (1 + r() * 0.3), s * (0.8 + r() * 0.4), s]));
    }
  }
  const trunkMat = new THREE.MeshStandardMaterial({ color: col("#24160a"), roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({ color: col("#34401a"), roughness: 0.85 });
  const trunks = new THREE.Mesh(merge(trunkG), trunkMat), crowns = new THREE.Mesh(merge(crownG), leafMat);
  trunkG.concat(crownG).forEach((g) => g.dispose());
  const group = new THREE.Group();
  group.add(trunks, crowns);
  return { group, dispose() { trunks.geometry.dispose(); crowns.geometry.dispose(); trunkMat.dispose(); leafMat.dispose(); } };
}

/** An anglepoise desk lamp (base, two arms, a shade tipped forward); `bulb` is where its light sits, in the group's space. */
export function makeDeskLamp(o: { color?: string; scale?: number } = {}) {
  const s = o.scale ?? 1;
  const rod = (a: THREE.Vector3, b: THREE.Vector3, r0: number) => { const g = new THREE.CylinderGeometry(r0, r0, a.distanceTo(b), 8); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())); g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); return g; };
  const lb = new THREE.Vector3(0, 0.02, 0).multiplyScalar(s), le = new THREE.Vector3(0.1, 0.58, -0.12).multiplyScalar(s), lh = new THREE.Vector3(-0.28, 0.8, 0.22).multiplyScalar(s);
  const shade = new THREE.ConeGeometry(0.17 * s, 0.24 * s, 24, 1, true).translate(0, -0.06 * s, 0);
  shade.rotateZ(0.55); shade.rotateX(-0.35); shade.translate(lh.x, lh.y, lh.z);
  const geo = merge([placed(new THREE.CylinderGeometry(0.13 * s, 0.15 * s, 0.035 * s, 20), [0, 0.017 * s, 0]), rod(lb, le, 0.014 * s), rod(le, lh, 0.012 * s), placed(new THREE.SphereGeometry(0.03 * s, 10, 8), [le.x, le.y, le.z]), shade]);
  shade.dispose();
  const mat = new THREE.MeshStandardMaterial({ color: col(o.color ?? "#2c5a3c"), roughness: 0.35, metalness: 0.55, side: THREE.DoubleSide });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geo, mat));
  const bulb = new THREE.Vector3(lh.x - 0.06 * s, lh.y - 0.1 * s, lh.z + 0.04 * s);
  return { group, bulb, dispose() { geo.dispose(); mat.dispose(); } };
}

// ---------------------------------------------------------------------------
// Hardware: generic handhelds and consoles of each era (no logos, no marks)
// ---------------------------------------------------------------------------

export type DeviceKind = "gb" | "gbc" | "gba" | "ds" | "3ds" | "switch" | "switch2";

export const DEVICE_LABEL: Record<DeviceKind, string> = { gb: "1989", gbc: "1998", gba: "2001", ds: "2004", "3ds": "2011", switch: "2017", switch2: "2025" };

type Draw = (g: CanvasRenderingContext2D, w: number, h: number, t: number) => void;

/** Pea-green Game Boy screen with nothing on it. */
export const blankGreen: Draw = (g, w, h) => { g.fillStyle = "#9bbc0f"; g.fillRect(0, 0, w, h); };

export interface Device {
  group: THREE.Group;
  /** The main screen (and the second one on the dual-screen kinds). */
  screen: ReturnType<typeof makeCanvasPanel>;
  screen2?: ReturnType<typeof makeCanvasPanel>;
  /** Where a link cable plugs in (local). */
  port: THREE.Vector3;
  size: Vec3;
  dispose(): void;
}

export function makeDevice(kind: DeviceKind, o: { draw?: Draw; draw2?: Draw; px?: [number, number]; screenK?: number } = {}): Device {
  const group = new THREE.Group();
  const disposers: (() => void)[] = [];
  const mat = (c: string, rough = 0.55, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
    const m = new THREE.MeshStandardMaterial({ color: col(c), roughness: rough, metalness: 0.05, ...extra });
    disposers.push(() => m.dispose());
    return m;
  };
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, pos: Vec3, rot: Vec3 = [0, 0, 0], parent: THREE.Object3D = group) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(...pos);
    mesh.rotation.set(...rot);
    parent.add(mesh);
    disposers.push(() => geo.dispose());
    return mesh;
  };
  const rbox = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 3, r);
  const panel = (w: number, h: number, draw: Draw, px: [number, number]) => {
    const p = makeCanvasPanel({ w, h, px, draw, emissive: o.screenK ?? 1.25 });
    disposers.push(() => p.dispose());
    return p;
  };
  const dark = mat("#26262c", 0.4);
  const buttons = (cx: number, cy: number, z: number, s: number, color: string, horizontal = false) => {
    const bm = mat(color, 0.35);
    const g = new THREE.CylinderGeometry(s, s, 0.04, 20);
    g.rotateX(Math.PI / 2);
    add(g, bm, horizontal ? [cx + s * 1.3, cy + s * 0.5, z] : [cx + s * 1.25, cy + s * 0.55, z]);
    add(g.clone(), bm, horizontal ? [cx - s * 1.3, cy - s * 0.5, z] : [cx - s * 1.25, cy - s * 0.55, z]);
  };
  const dpad = (cx: number, cy: number, z: number, s: number) => {
    add(new THREE.BoxGeometry(s * 3, s, 0.05), dark, [cx, cy, z]);
    add(new THREE.BoxGeometry(s, s * 3, 0.05), dark, [cx, cy, z]);
  };
  let screen: ReturnType<typeof makeCanvasPanel>;
  let screen2: ReturnType<typeof makeCanvasPanel> | undefined;
  let port = new THREE.Vector3();
  let size: Vec3 = [1, 1, 0.3];
  const draw = o.draw ?? blankGreen;
  if (kind === "gb" || kind === "gbc") {
    const gb = kind === "gb";
    const [W, H, D] = gb ? [0.9, 1.48, 0.32] : [0.78, 1.33, 0.27];
    size = [W, H, D];
    add(rbox(W, H, D, gb ? 0.05 : 0.08), gb ? mat("#c8c4bb", 0.78) : mat("#6a3fb0", 0.3, { transparent: true, opacity: 0.92 }), [0, 0, 0]);
    // The bezel and the screen.
    add(rbox(W * 0.82, H * 0.42, 0.04, 0.02), mat(gb ? "#4a4c5a" : "#202028", 0.5), [0, H * 0.2, D / 2]);
    screen = panel(W * 0.52, W * 0.47, draw, o.px ?? [160, 144]);
    screen.mesh.position.set(0, H * 0.2, D / 2 + 0.025);
    group.add(screen.mesh);
    dpad(-W * 0.24, -H * 0.17, D / 2 + 0.02, W * 0.07);
    buttons(W * 0.22, -H * 0.15, D / 2 + 0.02, W * 0.06, gb ? "#8e1f5c" : "#2b2b33");
    port = new THREE.Vector3(-W * 0.38, H / 2, 0);
  } else if (kind === "gba") {
    const [W, H, D] = [1.45, 0.82, 0.25];
    size = [W, H, D];
    add(rbox(W, H, D, 0.16), mat("#4c3fae", 0.35), [0, 0, 0]);
    add(rbox(W * 0.5, H * 0.66, 0.03, 0.02), mat("#1d1d24", 0.4), [0, H * 0.04, D / 2]);
    screen = panel(W * 0.42, W * 0.28, draw, o.px ?? [240, 160]);
    screen.mesh.position.set(0, H * 0.04, D / 2 + 0.02);
    group.add(screen.mesh);
    dpad(-W * 0.37, H * 0.06, D / 2 + 0.01, W * 0.04);
    buttons(W * 0.37, H * 0.06, D / 2 + 0.01, W * 0.035, "#b8b8c8", true);
    port = new THREE.Vector3(0, H / 2, 0);
  } else if (kind === "ds" || kind === "3ds") {
    const ds = kind === "ds";
    const [W, H, D] = ds ? [1.33, 0.74, 0.11] : [1.34, 0.74, 0.1];
    size = [W, H * 2, D * 2];
    const body = mat(ds ? "#d6d8de" : "#1c7ec8", 0.35);
    add(rbox(W, H, D, 0.06), body, [0, -H / 2, 0]);
    const lid = new THREE.Group();
    lid.position.set(0, 0, -D / 2);
    lid.rotation.x = -0.18;
    group.add(lid);
    add(rbox(W, H, D, 0.06), body, [0, H / 2, 0], [0, 0, 0], lid);
    screen = panel(W * (ds ? 0.5 : 0.62), H * 0.66, draw, o.px ?? [256, 192]);
    screen.mesh.position.set(0, H / 2, D / 2 + 0.005);
    lid.add(screen.mesh);
    screen2 = panel(W * 0.5, H * 0.66, o.draw2 ?? draw, o.px ?? [256, 192]);
    screen2.mesh.position.set(0, -H / 2, D / 2 + 0.005);
    group.add(screen2.mesh);
    dpad(-W * 0.38, -H * 0.42, D / 2 + 0.01, W * 0.03);
    buttons(W * 0.38, -H * 0.42, D / 2 + 0.01, W * 0.025, "#9a9aa8", true);
    port = new THREE.Vector3(0, -H, 0);
  } else {
    const two = kind === "switch2";
    const [W, H, D] = two ? [2.0, 1.16, 0.14] : [1.73, 1.02, 0.14];
    const jw = two ? 0.36 : 0.32;
    size = [W + jw * 2, H, D];
    add(rbox(W, H, D, 0.04), mat("#18181c", 0.35), [0, 0, 0]);
    screen = panel(W * 0.9, H * 0.86, draw, o.px ?? [480, 270]);
    screen.mesh.position.set(0, 0, D / 2 + 0.005);
    group.add(screen.mesh);
    const jl = two ? mat("#2a2a30", 0.4) : mat("#00b6d6", 0.4);
    const jr = two ? mat("#2a2a30", 0.4) : mat("#ff3c28", 0.4);
    add(rbox(jw, H, D, 0.12), jl, [-W / 2 - jw / 2, 0, 0]);
    add(rbox(jw, H, D, 0.12), jr, [W / 2 + jw / 2, 0, 0]);
    if (two) {
      // Thin coloured accents where the controllers meet the screen.
      add(new THREE.BoxGeometry(0.012, H * 0.8, D * 0.6), mat("#3fb8ff", 0.3, { emissive: col("#3fb8ff"), emissiveIntensity: 0.6 }), [-W / 2 - 0.01, 0, 0]);
      add(new THREE.BoxGeometry(0.012, H * 0.8, D * 0.6), mat("#ff4d6d", 0.3, { emissive: col("#ff4d6d"), emissiveIntensity: 0.6 }), [W / 2 + 0.01, 0, 0]);
    }
    const stick = new THREE.CylinderGeometry(0.07, 0.08, 0.06, 18);
    stick.rotateX(Math.PI / 2);
    add(stick, dark, [-W / 2 - jw / 2, H * 0.22, D / 2 + 0.02]);
    add(stick.clone(), dark, [W / 2 + jw / 2, -H * 0.12, D / 2 + 0.02]);
    port = new THREE.Vector3(0, -H / 2, 0);
  }
  return { group, screen: screen!, screen2, port, size, dispose() { disposers.forEach((d) => d()); } };
}

/** A link cable between two points: a sagging curve as a tube, with a glow that can run along it (uFuse 0 → 1). */
export function makeCable(o: { from: Vec3; to: Vec3; sag?: number; radius?: number; color?: string; glow?: string; coils?: number; bow?: Vec3 }) {
  const a = v3(o.from), b = v3(o.to);
  const pts: THREE.Vector3[] = [];
  const n = 64;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = a.clone().lerp(b, t);
    p.y -= Math.sin(Math.PI * t) * (o.sag ?? 0.3);
    // A bow sideways (a cable leaves its ports, then lies in a loose curve).
    if (o.bow) { const k = Math.sin(Math.PI * t); p.x += o.bow[0] * k; p.z += o.bow[2] * Math.pow(k, 0.6); }
    // A loose coil in the middle (the cable lies curled on the table).
    const c = (o.coils ?? 0) * Math.exp(-(((t - 0.5) * 4.5) ** 2));
    p.z += Math.sin(t * Math.PI * 6) * c;
    p.x += Math.cos(t * Math.PI * 6) * c * 0.4;
    pts.push(p);
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const geo = new THREE.TubeGeometry(curve, 240, o.radius ?? 0.025, 8, false);
  const u = { uFuse: { value: 0 }, uHead: { value: -1 }, uGlow: { value: col(o.glow ?? "#c8ff5a") }, uBase: { value: col(o.color ?? "#2c2c32") }, uTime: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      uniform float uFuse, uHead, uTime; uniform vec3 uGlow, uBase; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        float t = vUv.x;
        float lit = smoothstep(uFuse, uFuse - 0.04, t);
        float hx = (t - uHead) * 40.0;
        float head = exp(-hx * hx);
        float fres = clamp(1.0 - abs(dot(vN, vV)), 0.0, 1.0);
        fres *= fres;
        vec3 c = uBase * (0.35 + 0.65 * max(dot(vN, normalize(vec3(0.3, 1.0, 0.4))), 0.0)) + uBase * fres * 0.6;
        c += uGlow * (lit * (0.8 + 0.2 * sin(t * 140.0 - uTime * 8.0)) * 0.85 + head * 4.5);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  return { mesh, u, curve, dispose() { geo.dispose(); mat.dispose(); } };
}

/** A glass display case on a wooden plinth, with a little lamp. */
export function makeGlassCase(o: { w: number; h: number; d: number; wood?: string }) {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: col(o.wood ?? "#5a3a22"), roughness: 0.55, metalness: 0.05 });
  const brass = new THREE.MeshStandardMaterial({ color: col("#c79a4a"), roughness: 0.3, metalness: 1 });
  const glass = new THREE.MeshStandardMaterial({ color: col("#cfe6ff"), roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.13, depthWrite: false, envMapIntensity: 1.6 });
  const plinthH = 0.9;
  const parts = [
    new THREE.Mesh(new THREE.BoxGeometry(o.w + 0.2, plinthH, o.d + 0.2), wood),
    new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.d), glass),
    new THREE.Mesh(new THREE.BoxGeometry(o.w + 0.08, 0.05, o.d + 0.08), brass),
    new THREE.Mesh(new THREE.BoxGeometry(o.w + 0.08, 0.05, o.d + 0.08), brass),
  ];
  parts[0].position.y = plinthH / 2;
  parts[1].position.y = plinthH + o.h / 2;
  parts[2].position.y = plinthH + 0.025;
  parts[3].position.y = plinthH + o.h;
  parts[1].renderOrder = 4;
  parts.forEach((p) => group.add(p));
  return {
    group,
    /** Where to stand an object on the shelf. */
    shelf: new THREE.Vector3(0, plinthH + 0.05, 0),
    dispose() { parts.forEach((p) => p.geometry.dispose()); wood.dispose(); brass.dispose(); glass.dispose(); },
  };
}

// ---------------------------------------------------------------------------
// A world of points, arcs of light, crowds
// ---------------------------------------------------------------------------

/** Points on a sphere where land would be (a noise mask), lit outward from a direction as `uSpread` grows. */
export function makeGlobe(o: { radius: number; count: number; land: string; lit: string; sea?: string; seed?: number }) {
  const r = rng(o.seed ?? 8);
  const nz = (x: number, y: number, z: number) => Math.sin(x * 2.1 + Math.sin(y * 3.3)) + Math.sin(y * 2.7 + Math.sin(z * 2.9)) + Math.sin(z * 2.3 + Math.sin(x * 3.1));
  const pos: number[] = [], seeds: number[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < o.count * 3 && pos.length / 3 < o.count; i++) {
    const y = 1 - (i / (o.count * 3 - 1)) * 2, rad = Math.sqrt(1 - y * y), th = golden * i;
    const x = Math.cos(th) * rad, z = Math.sin(th) * rad;
    if (nz(x * 1.6, y * 1.6, z * 1.6) < 0.35) continue;
    pos.push(x * o.radius, y * o.radius, z * o.radius);
    seeds.push(r());
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 1));
  const u = { uPixel: { value: 600 }, uSize: { value: o.radius * 0.016 }, uLand: { value: col(o.land) }, uLit: { value: col(o.lit) }, uFrom: { value: new THREE.Vector3(0.55, 0.55, 0.62).normalize() }, uSpread: { value: 0 }, uTime: { value: 0 }, uAll: { value: 0 }, uNight: { value: 0 }, uSun: { value: new THREE.Vector3(1, 0, 0) } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aSeed; uniform float uPixel, uSize, uSpread, uTime, uAll, uNight; uniform vec3 uFrom, uSun;
      varying float vLit; varying float vSeed; varying float vFacing;
      void main(){
        vec3 n = normalize(position);
        float ang = acos(clamp(dot(n, uFrom), -1.0, 1.0));
        float lit = smoothstep(uSpread, uSpread - 0.25, ang);
        lit = max(lit, uAll);
        vLit = lit * (0.6 + 0.4 * sin(uTime * 2.0 + aSeed * 40.0)); vSeed = aSeed;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFacing = smoothstep(-0.1, 0.35, dot(normalize(mat3(modelViewMatrix) * n), normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uSize * (1.0 + lit * 1.4 * step(0.82, aSeed)) * uPixel / -mv.z, 0.0, 24.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uLand, uLit; varying float vLit; varying float vSeed; varying float vFacing;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.1, d) * vFacing;
        vec3 c = mix(uLand * 0.6, uLit * (1.5 + 2.5 * step(0.82, vSeed)), vLit);
        gl_FragColor = vec4(c * a, a);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  // A body so the far side is hidden and the globe reads as a sphere: an ocean lit softly from the
  // upper left (a terminator, not a flat disc), with an atmosphere rim in the land's light.
  const bodyMat = new THREE.ShaderMaterial({
    uniforms: { uSea: { value: col(o.sea ?? "#04101c") }, uRim: { value: col(o.lit) } },
    transparent: true,
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSea, uRim; varying vec3 vN; varying vec3 vV;
      void main(){
        vec3 n = normalize(vN);
        float key = clamp(dot(n, normalize(vec3(-0.55, 0.6, 0.6))), 0.0, 1.0);
        float f = clamp(1.0 - dot(n, normalize(vV)), 0.0, 1.0);
        float rim = f * f * f;
        vec3 c = uSea * (0.4 + 1.25 * key) + uRim * rim * 0.35;
        gl_FragColor = vec4(c, 0.94);
      }`,
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(o.radius * 0.985, 48, 32), bodyMat);
  const atmo = makeGlow({ pos: [0, 0, 0], size: o.radius * 3.1, color: o.lit, intensity: 0.22 });
  const group = new THREE.Group();
  group.add(body, points, atmo.sprite);
  return { group, points, u, positions: new Float32Array(pos), dispose() { geo.dispose(); mat.dispose(); body.geometry.dispose(); bodyMat.dispose(); atmo.dispose(); } };
}

/** Arcs of light over a sphere between pairs of points: drawn as streams of motes that travel and grow in as uGrow goes 0 → 1. */
export function makeArcs(o: { radius: number; pairs: [Vec3, Vec3][]; color: string; perArc?: number; lift?: number; seed?: number }) {
  const per = o.perArc ?? 60;
  const r = rng(o.seed ?? 12);
  const n = o.pairs.length * per;
  const pos = new Float32Array(n * 3), t = new Float32Array(n), arc = new Float32Array(n);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), M = new THREE.Vector3();
  o.pairs.forEach(([a, b], k) => {
    A.set(...a).normalize().multiplyScalar(o.radius);
    B.set(...b).normalize().multiplyScalar(o.radius);
    M.copy(A).add(B).normalize().multiplyScalar(o.radius * (1 + (o.lift ?? 0.35) * A.distanceTo(B) / (o.radius * 2)));
    const curve = new THREE.QuadraticBezierCurve3(A.clone(), M.clone(), B.clone());
    const delay = r();
    for (let i = 0; i < per; i++) {
      const tt = i / (per - 1);
      const p = curve.getPoint(tt);
      pos.set([p.x, p.y, p.z], (k * per + i) * 3);
      t[k * per + i] = tt;
      arc[k * per + i] = delay;
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aT", new THREE.BufferAttribute(t, 1));
  geo.setAttribute("aArc", new THREE.BufferAttribute(arc, 1));
  const u = { uGrow: { value: 0 }, uTime: { value: 0 }, uPixel: { value: 600 }, uSize: { value: o.radius * 0.012 }, uColor: { value: col(o.color) } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aT; attribute float aArc; uniform float uGrow, uTime, uPixel, uSize; varying float vA;
      void main(){
        float start = aArc * 0.6;
        float g = clamp((uGrow - start) / 0.4, 0.0, 1.0);
        float shown = step(aT, g);
        float flow = fract(aT - uTime * 0.35 - aArc);
        vA = shown * (0.35 + 0.65 * smoothstep(0.85, 1.0, flow)) * (1.0 - smoothstep(0.95, 1.0, aT) * 0.5);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uSize * (0.8 + 1.6 * smoothstep(0.85, 1.0, flow)) * uPixel / -mv.z, 0.0, 20.0);
      }`,
    fragmentShader: /* glsl */ `uniform vec3 uColor; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA; gl_FragColor = vec4(uColor * 2.4 * a, a); }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { points, u, dispose() { geo.dispose(); mat.dispose(); } };
}

/** Random point on a unit sphere's upper band (for arcs and cities). */
export function spherePoint(r: () => number, band = 0.85): Vec3 {
  const y = (r() * 2 - 1) * band, th = r() * Math.PI * 2, rad = Math.sqrt(1 - y * y);
  return [Math.cos(th) * rad, y, Math.sin(th) * rad];
}

/** A crowd as warm points (people seen far off, or phones held up), optionally in a stadium bowl. */
export function makeCrowd(o: { points: Vec3[]; colors: [string, string]; size?: number; seed?: number; intensity?: number }) {
  const n = o.points.length;
  const r = rng(o.seed ?? 3);
  const pos = new Float32Array(n * 3), seed = new Float32Array(n);
  o.points.forEach((p, i) => { pos.set(p, i * 3); seed[i] = r(); });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  const u = { uTime: { value: 0 }, uPixel: { value: 600 }, uSize: { value: o.size ?? 0.18 }, uA: { value: col(o.colors[0]) }, uB: { value: col(o.colors[1]) }, uK: { value: o.intensity ?? 1.6 }, uCheer: { value: 0 }, uShow: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aSeed; uniform float uTime, uPixel, uSize, uCheer, uShow; varying float vS; varying float vOn;
      void main(){
        vec3 p = position;
        p.y += abs(sin(uTime * (6.0 + aSeed * 4.0) + aSeed * 30.0)) * uCheer * 0.25;
        vS = aSeed;
        vOn = step(aSeed, uShow);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uSize * uPixel / -mv.z, 0.0, 24.0) * vOn;
      }`,
    fragmentShader: /* glsl */ `uniform vec3 uA, uB; uniform float uK, uTime; varying float vS; varying float vOn; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d) * vOn; float tw = 0.7 + 0.3 * sin(uTime * 3.0 + vS * 50.0); gl_FragColor = vec4(mix(uA, uB, vS) * uK * tw * a, a); }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { points, u, dispose() { geo.dispose(); mat.dispose(); } };
}

/** Points in a stadium bowl (rings of seats rising outward). */
export function bowlPoints(o: { inner: number; outer: number; height: number; count: number; seed?: number; center?: Vec3 }): Vec3[] {
  const r = rng(o.seed ?? 9);
  const c = o.center ?? [0, 0, 0];
  const out: Vec3[] = [];
  for (let i = 0; i < o.count; i++) {
    const k = r(), a = r() * Math.PI * 2;
    const rad = o.inner + (o.outer - o.inner) * k;
    out.push([c[0] + Math.cos(a) * rad, c[1] + 0.6 + k * o.height, c[2] + Math.sin(a) * rad * 0.82]);
  }
  return out;
}

/** The stadium itself: tiers of seating as a stepped bowl, a pitch, and light towers. */
export function makeStadium(o: { inner: number; outer: number; height: number; pitch: string; stand?: string }) {
  const prof: THREE.Vector2[] = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const r = o.inner + ((o.outer - o.inner) * i) / steps, y = (o.height * i) / steps;
    prof.push(new THREE.Vector2(r, y), new THREE.Vector2(r + (o.outer - o.inner) / steps, y));
  }
  prof.push(new THREE.Vector2(o.outer + 1, o.height + 1.5), new THREE.Vector2(o.outer + 1.2, 0));
  const geo = new THREE.LatheGeometry(prof, 72);
  geo.scale(1, 1, 0.82);
  const mat = new THREE.MeshStandardMaterial({ color: col(o.stand ?? "#1c1f2c"), roughness: 0.8, side: THREE.DoubleSide });
  const bowl = new THREE.Mesh(geo, mat);
  const pitchMat = new THREE.MeshStandardMaterial({ color: col(o.pitch), roughness: 0.85 });
  const pitch = new THREE.Mesh(new THREE.CircleGeometry(o.inner, 64).rotateX(-Math.PI / 2).scale(1, 1, 0.82), pitchMat);
  pitch.position.y = 0.02;
  const group = new THREE.Group();
  group.add(bowl, pitch);
  return { group, pitchMat, dispose() { geo.dispose(); mat.dispose(); pitch.geometry.dispose(); pitchMat.dispose(); } };
}

// ---------------------------------------------------------------------------
// Cards, pixel creatures, type
// ---------------------------------------------------------------------------

/** An original trading-card face (gold frame, a holo window, lines of text), not any real card. */
function cardTexture(seed: number): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = 128;
  cv.height = 176;
  const g = cv.getContext("2d")!;
  const r = rng(seed);
  const hues = [48, 12, 205, 120, 280, 330];
  const hue = hues[Math.floor(r() * hues.length)];
  g.fillStyle = "#f2c94c";
  g.fillRect(0, 0, 128, 176);
  g.fillStyle = `hsl(${hue} 70% 55%)`;
  g.fillRect(7, 7, 114, 162);
  g.fillStyle = "#fff8e0";
  g.fillRect(14, 26, 100, 66);
  g.fillStyle = `hsl(${hue} 60% 40%)`;
  for (let i = 0; i < 4; i++) g.fillRect(16, 104 + i * 14, 60 + r() * 36, 6);
  g.fillRect(14, 12, 58, 8);
  drawCritter(g, 34, 30, 60, seed * 7 + 3, `hsl(${(hue + 180) % 360} 70% 45%)`);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Hundreds of cards bursting out (uBurst 0 → 1) and fanning round a centre, holo-foil shimmering. */
export function makeCardBurst(o: { count: number; center: Vec3; radius: number; size?: number; seed?: number }) {
  const n = Math.max(1, Math.round(o.count));
  const base = new THREE.PlaneGeometry(o.size ?? 0.6, (o.size ?? 0.6) * 1.38);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setAttribute("uv", base.getAttribute("uv"));
  const r = rng(o.seed ?? 4);
  const seeds = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) seeds[i] = r();
  geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = n;
  const texs = [1, 2, 3, 4].map((s) => cardTexture(s + (o.seed ?? 0)));
  const u = { uBurst: { value: 0 }, uTime: { value: 0 }, uCenter: { value: v3(o.center) }, uRadius: { value: o.radius }, uT0: { value: texs[0] }, uT1: { value: texs[1] }, uT2: { value: texs[2] }, uT3: { value: texs[3] }, uShow: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec4 aSeed; uniform float uBurst, uTime, uRadius; uniform vec3 uCenter;
      varying vec2 vUv; varying float vPick; varying vec3 vN; varying vec3 vV; varying float vSeed;
      mat3 rotY(float a){ float c = cos(a), s = sin(a); return mat3(c, 0., -s, 0., 1., 0., s, 0., c); }
      mat3 rotX(float a){ float c = cos(a), s = sin(a); return mat3(1., 0., 0., 0., c, s, 0., -s, c); }
      void main(){
        float k = clamp(uBurst * 1.25 - aSeed.w * 0.25, 0.0, 1.0);
        float ik = 1.0 - k;
        float e = 1.0 - ik * ik * ik;
        float th = aSeed.x * 6.2831853 + uTime * 0.12 * (0.5 + aSeed.y);
        float rad = uRadius * (0.35 + 0.65 * aSeed.y) * e;
        vec3 off = vec3(cos(th) * rad, (aSeed.z - 0.5) * uRadius * 0.9 * e + sin(uTime * 0.7 + aSeed.x * 9.0) * 0.15, sin(th) * rad * 0.7);
        mat3 R = rotY(th * 0.5 + uTime * (0.6 + aSeed.z) * e) * rotX((aSeed.y - 0.5) * 1.4 * e);
        vec3 p = R * (position * (0.15 + 0.85 * e));
        vec4 wp = modelMatrix * vec4(uCenter + off + p, 1.0);
        vUv = uv; vPick = floor(aSeed.w * 4.0); vSeed = aSeed.x;
        vN = normalize(mat3(modelMatrix) * (R * vec3(0.0, 0.0, 1.0)));
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uT0, uT1, uT2, uT3; uniform float uTime, uShow; varying vec2 vUv; varying float vPick; varying vec3 vN; varying vec3 vV; varying float vSeed;
      void main(){
        if (vSeed > uShow) discard;
        vec3 c = vPick < 0.5 ? texture2D(uT0, vUv).rgb : vPick < 1.5 ? texture2D(uT1, vUv).rgb : vPick < 2.5 ? texture2D(uT2, vUv).rgb : texture2D(uT3, vUv).rgb;
        float f = dot(vN, vV);
        // The back: deep navy with a gold border and a swirl (original, no marks).
        if (f < 0.0) {
          vec2 q = vUv - 0.5;
          float border = step(0.43, max(abs(q.x) * 1.0, abs(q.y) * 0.74));
          float sw = 0.5 + 0.5 * sin(atan(q.y, q.x) * 3.0 + length(q) * 26.0);
          c = mix(vec3(0.06, 0.09, 0.3) + vec3(0.08, 0.1, 0.3) * sw * smoothstep(0.42, 0.0, length(q)), vec3(0.85, 0.65, 0.25), border);
        }
        float af = abs(f);
        // Lit by the burst's light: brighter face-on, a moving sheen band, rainbow foil at grazing angles.
        float holo = sin((vUv.x + vUv.y) * 18.0 + f * 9.0 + uTime) * 0.5 + 0.5;
        vec3 rainbow = 0.5 + 0.5 * cos(6.2831 * (holo + vec3(0.0, 0.33, 0.67)));
        float band = smoothstep(0.12, 0.0, abs(fract(vUv.x * 0.7 + vUv.y * 0.5 - uTime * 0.25 + vSeed * 3.0) - 0.5) - 0.3);
        float g = clamp(1.0 - af, 0.0, 1.0);
        c = c * (0.4 + 0.42 * af) + rainbow * (0.12 + 0.4 * g * g) + vec3(1.0, 0.95, 0.85) * band * 0.3;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, u, dispose() { geo.dispose(); base.dispose(); mat.dispose(); texs.forEach((t) => t.dispose()); } };
}

/** A little creature drawn from a seed: a symmetric 8 × 8 pixel sprite (original, like a 1980s game's invaders). */
export function drawCritter(g: CanvasRenderingContext2D, x: number, y: number, size: number, seed: number, color: string) {
  const r = rng(seed);
  const cell = size / 8;
  g.fillStyle = color;
  for (let j = 0; j < 8; j++) {
    for (let i = 0; i < 4; i++) {
      const edge = j === 0 || j === 7 ? 0.25 : 0.55;
      if (r() < edge + (i > 1 ? 0.15 : 0)) {
        g.fillRect(x + (3 - i) * cell, y + j * cell, cell + 0.5, cell + 0.5);
        g.fillRect(x + (4 + i) * cell, y + j * cell, cell + 0.5, cell + 0.5);
      }
    }
  }
  // Eyes.
  g.clearRect(x + 2 * cell, y + 3 * cell, cell, cell);
  g.clearRect(x + 5 * cell, y + 3 * cell, cell, cell);
}

/** A plane with words (signs, titles stamped in): bright text on transparent, drawn once. */
export function makeWords(o: { text: string; font: string; w: number; color?: string; weight?: number; px?: number; glow?: string }) {
  const px = o.px ?? 120;
  const cv = document.createElement("canvas");
  const g = cv.getContext("2d")!;
  g.font = `${o.weight ?? 700} ${px}px ${o.font}`;
  const tw = Math.ceil(g.measureText(o.text).width) + px;
  cv.width = Math.min(4096, tw);
  cv.height = Math.ceil(px * 1.6);
  g.font = `${o.weight ?? 700} ${px}px ${o.font}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  if (o.glow) { g.shadowColor = o.glow; g.shadowBlur = px * 0.35; }
  g.fillStyle = o.color ?? "#ffffff";
  g.fillText(o.text, cv.width / 2, cv.height / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, color: col("#ffffff", 1.6), side: THREE.DoubleSide });
  const h = (o.w * cv.height) / cv.width;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(o.w, h), mat);
  mesh.renderOrder = 7;
  return { mesh, mat, dispose() { mesh.geometry.dispose(); mat.dispose(); tex.dispose(); } };
}

/** Glass: a faint body with a bright fresnel edge and a soft highlight (reads as glass without refraction). */
export function glassMaterial(o: { tint?: string; edge?: string; k?: number } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uTint: { value: col(o.tint ?? "#d8f5e6") }, uEdge: { value: col(o.edge ?? "#fff1c8") }, uK: { value: o.k ?? 1 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vV; varying vec3 vL; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); vL = position; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTint, uEdge; uniform float uK; varying vec3 vN; varying vec3 vV; varying vec3 vL;
      void main(){
        float f = clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
        float edge = f * f * f;
        float streak = smoothstep(0.92, 1.0, sin(atan(vL.z, vL.x) * 1.0 + 0.9)) * 0.6;
        float a = clamp(0.04 + edge * 0.9 + streak * 0.5, 0.0, 1.0) * uK;
        gl_FragColor = vec4(mix(uTint * 0.3, uEdge * 0.9, clamp(edge + streak, 0.0, 1.0)), a);
      }`,
  });
}

/** A ball that opens: red top, white bottom, a dark band and a button; open(k) lifts the lid back. */
export function makeBall(o: { radius: number; top?: string; bottom?: string }) {
  const group = new THREE.Group();
  const lid = new THREE.Group();
  const r = o.radius;
  const red = new THREE.MeshStandardMaterial({ color: col(o.top ?? "#e3262f"), roughness: 0.25, emissive: col("#3a0508"), emissiveIntensity: 0.5 });
  const white = new THREE.MeshStandardMaterial({ color: col(o.bottom ?? "#f4f1ea"), roughness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: col("#111111"), roughness: 0.5 });
  const topG = new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const botG = new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const bandG = new THREE.CylinderGeometry(r * 1.01, r * 1.01, r * 0.12, 32, 1, true);
  const btnG = new THREE.CylinderGeometry(r * 0.24, r * 0.24, r * 0.12, 20).rotateX(Math.PI / 2);
  const top = new THREE.Mesh(topG, red);
  top.position.set(0, 0, r);
  lid.position.set(0, 0, -r);
  lid.add(top);
  const bot = new THREE.Mesh(botG, white);
  const band = new THREE.Mesh(bandG, dark);
  const btn = new THREE.Mesh(btnG, white);
  btn.position.set(0, 0, r * 1.0);
  group.add(lid, bot, band, btn);
  const light = makeGlow({ pos: [0, r * 0.4, 0], size: r * 6, color: "#ffffff", intensity: 0 });
  group.add(light.sprite);
  return {
    group,
    open(k: number, color = "#ffffff") {
      lid.rotation.x = -k * 1.9;
      btn.visible = k < 0.05;
      light.set(color, 1.1 * Math.sin(Math.min(1, k) * Math.PI) + 0.25 * k);
    },
    dispose() { [topG, botG, bandG, btnG].forEach((g) => g.dispose()); [red, white, dark].forEach((m) => m.dispose()); light.dispose(); },
  };
}

/** Threads of light between pairs of points (house to house, city to city): motes that grow along each curve as uGrow goes 0 → 1. */
export function makeThreads(o: { pairs: [Vec3, Vec3][]; lift: number; color: string; per?: number; size?: number; seed?: number }) {
  const per = o.per ?? 40;
  const r = rng(o.seed ?? 3);
  const n = o.pairs.length * per;
  const pos = new Float32Array(n * 3), t = new Float32Array(n), arc = new Float32Array(n);
  o.pairs.forEach(([a, b], k) => {
    const A = v3(a), B = v3(b);
    const M = A.clone().lerp(B, 0.5);
    M.y += o.lift * (0.5 + A.distanceTo(B) * 0.05);
    const c = new THREE.QuadraticBezierCurve3(A, M, B);
    const d = r();
    for (let i = 0; i < per; i++) {
      const p = c.getPoint(i / (per - 1));
      pos.set([p.x, p.y, p.z], (k * per + i) * 3);
      t[k * per + i] = i / (per - 1);
      arc[k * per + i] = d;
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aT", new THREE.BufferAttribute(t, 1));
  geo.setAttribute("aArc", new THREE.BufferAttribute(arc, 1));
  const u = { uGrow: { value: 0 }, uTime: { value: 0 }, uPixel: { value: 600 }, uSize: { value: o.size ?? 0.08 }, uColor: { value: col(o.color) } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aT; attribute float aArc; uniform float uGrow, uTime, uPixel, uSize; varying float vA;
      void main(){
        float g = clamp((uGrow - aArc * 0.7) / 0.3, 0.0, 1.0);
        float flow = fract(aT - uTime * 0.5 - aArc);
        vA = step(aT, g) * (0.35 + 0.65 * smoothstep(0.8, 1.0, flow));
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uSize * (0.8 + smoothstep(0.8, 1.0, flow)) * uPixel / -mv.z, 0.0, 18.0);
      }`,
    fragmentShader: /* glsl */ `uniform vec3 uColor; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA; gl_FragColor = vec4(uColor * 2.0 * a, a); }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { points, u, dispose() { geo.dispose(); mat.dispose(); } };
}

/** A wall of little glowing creature shapes (an atlas of original pixel critters), each lighting up as uFill passes it. */
export function makeCritterWall(o: { count: number; cols: number; cell: number; center: Vec3; colors: [string, string]; seed?: number }) {
  const atlas = document.createElement("canvas");
  atlas.width = atlas.height = 512;
  const g = atlas.getContext("2d")!;
  for (let i = 0; i < 64; i++) drawCritter(g, (i % 8) * 64 + 8, Math.floor(i / 8) * 64 + 8, 48, (o.seed ?? 1) * 97 + i * 13, "#ffffff");
  const tex = new THREE.CanvasTexture(atlas);
  tex.magFilter = THREE.NearestFilter;
  const base = new THREE.PlaneGeometry(o.cell * 0.86, o.cell * 0.86);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setAttribute("uv", base.getAttribute("uv"));
  const rows = Math.ceil(o.count / o.cols);
  const off = new Float32Array(o.count * 4);
  const r = rng(o.seed ?? 1);
  for (let i = 0; i < o.count; i++) {
    const cx = i % o.cols, cy = Math.floor(i / o.cols);
    off.set([(cx - (o.cols - 1) / 2) * o.cell, ((rows - 1) / 2 - cy) * o.cell, i % 64, r()], i * 4);
  }
  geo.setAttribute("aOff", new THREE.InstancedBufferAttribute(off, 4));
  geo.instanceCount = o.count;
  const u = { uFill: { value: 0 }, uTime: { value: 0 }, uTex: { value: tex }, uA: { value: col(o.colors[0]) }, uB: { value: col(o.colors[1]) }, uDim: { value: 1 }, uCenter: { value: v3(o.center) } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec4 aOff; uniform float uFill, uTime; uniform vec3 uCenter; varying vec2 vUv; varying float vOn; varying float vSeed;
      void main(){
        float on = smoothstep(aOff.w, aOff.w + 0.08, uFill);
        vec3 p = uCenter + vec3(aOff.xy, 0.0) + position * (0.4 + 0.6 * on);
        p.z += (1.0 - on) * 3.0;
        p.y += sin(uTime * 1.3 + aOff.w * 30.0) * 0.02;
        float cell = aOff.z;
        vUv = (vec2(mod(cell, 8.0), 7.0 - floor(cell / 8.0)) + uv) / 8.0;
        vOn = on; vSeed = aOff.w;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uTex; uniform vec3 uA, uB; uniform float uDim, uTime; varying vec2 vUv; varying float vOn; varying float vSeed;
      void main(){
        float a = texture2D(uTex, vUv).a * vOn;
        vec3 c = mix(uA, uB, vSeed) * (1.6 + 0.4 * sin(uTime * 2.0 + vSeed * 40.0)) * uDim;
        gl_FragColor = vec4(c * a, a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, u, dispose() { geo.dispose(); base.dispose(); mat.dispose(); tex.dispose(); } };
}

// ---------------------------------------------------------------------------
// Region maps as glowing floors (the 3D Timeline's maps, public/geo/maps)
// ---------------------------------------------------------------------------

/**
 * A region map laid flat as a glowing floor: coastlines and routes light in
 * the tint, the land is a faint wash, the edges fade out. North is far (−z).
 */
export async function makeRegionFloor(o: { src: string; w: number; h: number; width: number; tint: string; signal?: AbortSignal }) {
  const tex = await new THREE.TextureLoader().loadAsync(o.src);
  if (o.signal?.aborted) { tex.dispose(); throw new DOMException("aborted", "AbortError"); }
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const height = (o.width * o.h) / o.w;
  const geo = new THREE.PlaneGeometry(o.width, height).rotateX(-Math.PI / 2);
  const u = { uMap: { value: tex }, uTint: { value: col(o.tint) }, uA: { value: 1 }, uTime: { value: 0 }, uTexel: { value: new THREE.Vector2(1 / o.w, 1 / o.h) }, uLand: { value: 0.06 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform vec3 uTint; uniform float uA, uTime, uLand; uniform vec2 uTexel; varying vec2 vUv; varying vec3 vW;
      float landAt(vec2 uv){ vec3 t = texture2D(uMap, uv).rgb; return smoothstep(-0.02, 0.1, max(t.r, t.g) - t.b); }
      void main(){
        vec4 t = texture2D(uMap, vUv);
        float land = smoothstep(-0.02, 0.1, max(t.r, t.g) - t.b);
        float lum = dot(t.rgb, vec3(0.3, 0.59, 0.11));
        float route = smoothstep(0.72, 0.9, lum) * land;
        vec2 o = uTexel * 1.5;
        float around = (landAt(vUv + vec2(o.x, 0.0)) + landAt(vUv - vec2(o.x, 0.0)) + landAt(vUv + vec2(0.0, o.y)) + landAt(vUv - vec2(0.0, o.y))) * 0.25;
        float coast = clamp(abs(land - around) * 3.0, 0.0, 1.0);
        vec2 e = min(vUv, 1.0 - vUv);
        float edge = smoothstep(0.0, 0.16, e.x) * smoothstep(0.0, 0.14, e.y);
        float scan = 0.75 + 0.25 * smoothstep(0.55, 1.0, sin(vW.z * 0.3 - uTime * 2.0));
        vec3 c = uTint * (land * uLand + coast * 0.9 + route * 0.55) * scan + t.rgb * land * 0.05;
        float a = edge * uA;
        gl_FragColor = vec4(c * a, a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  return { mesh, u, width: o.width, height, dispose() { geo.dispose(); mat.dispose(); tex.dispose(); } };
}

/** Stars: fixed points on a far sphere round a centre (no per-pixel sky noise, so no moiré). */
export function makeStars(o: { count: number; radius: number; center: Vec3; seed?: number; size?: number }) {
  const r = rng(o.seed ?? 17);
  const pos = new Float32Array(o.count * 3), c = new Float32Array(o.count * 3);
  for (let i = 0; i < o.count; i++) {
    const y = r() * 2 - 1, th = r() * Math.PI * 2, rad = Math.sqrt(1 - y * y);
    pos.set([o.center[0] + Math.cos(th) * rad * o.radius, o.center[1] + y * o.radius, o.center[2] + Math.sin(th) * rad * o.radius], i * 3);
    const k = 0.4 + r() * r() * 1.6;
    c.set([k, k * (0.9 + r() * 0.1), k * (0.85 + r() * 0.3)], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(c, 3));
  const mat = new THREE.PointsMaterial({ size: o.size ?? 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, opacity: 1 });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = -5;
  return { points, mat, dispose() { geo.dispose(); mat.dispose(); } };
}

// ---------------------------------------------------------------------------
// Night cities: towers with crafted facades, and street lamps
// ---------------------------------------------------------------------------

/** Merges geometries and gives every vertex of each source the same vec4 attribute `aB`. */
export function mergeWithAttr(list: [THREE.BufferGeometry, [number, number, number, number]][]) {
  const counts = list.map(([g]) => g.getAttribute("position").count);
  const geo = merge(list.map(([g]) => g));
  const a = new Float32Array(geo.getAttribute("position").count * 4);
  let o = 0;
  list.forEach(([, v], i) => { for (let j = 0; j < counts[i]; j++, o++) a.set(v, o * 4); });
  geo.setAttribute("aB", new THREE.BufferAttribute(a, 4));
  return geo;
}

export interface TowerSpec { x: number; z: number; w: number; d: number; h: number; rot?: number; kind?: number }

/**
 * Towers for a city at night, one draw call: each has a facade of floors and
 * bays (pilasters every few bays, slab lines, a cornice), windows by type
 * (glass curtain wall, punched concrete, tall stone), lit warm or cool or
 * whole office floors, a lit shopfront at street level with sign bands, a
 * parapet and rooftop plant (housings, tanks, an antenna on the tallest).
 * Distance haze (thicker near the ground) and warm light bounced up from the
 * streets are in the shader, so the city has depth without extra lights.
 */
export function makeTowers(o: { towers: TowerSpec[]; seed?: number; haze?: string; hazeHigh?: string; fog?: number; street?: string; moon?: Vec3 }) {
  const r = rng(o.seed ?? 3);
  const list: [THREE.BufferGeometry, [number, number, number, number]][] = [];
  const roofs: Vec3[] = [];
  const at = (t: TowerSpec, g: THREE.BufferGeometry, y: number, lx = 0, lz = 0) => placed(g, [t.x + lx * Math.cos(t.rot ?? 0) + lz * Math.sin(t.rot ?? 0), y, t.z - lx * Math.sin(t.rot ?? 0) + lz * Math.cos(t.rot ?? 0)], t.rot ?? 0);
  let tallest = 0;
  o.towers.forEach((t) => { tallest = Math.max(tallest, t.h); });
  o.towers.forEach((t) => {
    const seed = r(), kind = t.kind ?? (r() < 0.38 ? 0 : r() < 0.6 ? 1 : 2);
    // Main block, and on tall ones a setback upper block.
    const set = t.h > 9 && r() < 0.55;
    const h0 = set ? t.h * (0.55 + r() * 0.15) : t.h;
    list.push([at(t, new THREE.BoxGeometry(t.w, h0, t.d), h0 / 2), [seed, h0, kind, 0]]);
    let top = h0, tw = t.w, td = t.d;
    if (set) {
      tw = t.w * 0.72; td = t.d * 0.72;
      list.push([at(t, new THREE.BoxGeometry(tw, t.h - h0, td), h0 + (t.h - h0) / 2), [seed, t.h, kind, 0]]);
      // A parapet on the lower roof too.
      for (const [sx, sz, lx, lz] of [[t.w, 0.12, 0, t.d / 2], [t.w, 0.12, 0, -t.d / 2], [0.12, t.d, t.w / 2, 0], [0.12, t.d, -t.w / 2, 0]]) list.push([at(t, new THREE.BoxGeometry(sx, 0.35, sz), h0 + 0.17, lx, lz), [seed, 0, kind, 1]]);
      top = t.h;
    }
    for (const [sx, sz, lx, lz] of [[tw, 0.12, 0, td / 2], [tw, 0.12, 0, -td / 2], [0.12, td, tw / 2, 0], [0.12, td, -tw / 2, 0]]) list.push([at(t, new THREE.BoxGeometry(sx + 0.1, 0.4, sz + 0.02), top + 0.2, lx, lz), [seed, 0, kind, 1]]);
    // Rooftop plant.
    const n = 1 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const bw = 0.5 + r() * tw * 0.3, bd = 0.5 + r() * td * 0.3, bh = 0.4 + r() * 0.9;
      list.push([at(t, new THREE.BoxGeometry(bw, bh, bd), top + bh / 2, (r() - 0.5) * (tw - bw), (r() - 0.5) * (td - bd)), [seed, 0, kind, 1]]);
    }
    if (kind === 1 && r() < 0.5) list.push([at(t, new THREE.CylinderGeometry(0.45, 0.45, 1.1, 10), top + 0.95, tw * 0.25, -td * 0.2), [seed, 0, kind, 1]]);
    if (t.h > tallest * 0.82) list.push([at(t, new THREE.CylinderGeometry(0.03, 0.06, 3.2, 5), top + 1.6), [seed, top + 3.2, kind, 2]]);
    roofs.push([t.x, top, t.z]);
  });
  const geo = mergeWithAttr(list);
  const u = {
    uLit: { value: 1 }, uBody: { value: 0.42 }, uTime: { value: 0 }, uHaze: { value: col(o.haze ?? "#1a2236") }, uHazeHigh: { value: col(o.hazeHigh ?? "#0c1220") }, uFog: { value: o.fog ?? 0.012 },
    uStreet: { value: col(o.street ?? "#ff9a4a") }, uMoon: { value: v3(o.moon ?? [-0.4, 0.6, 0.5]).normalize() }, uSky: { value: col("#3a4a6a") },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: /* glsl */ `attribute vec4 aB; varying vec3 vW; varying vec3 vN; varying vec4 vB; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vB = aB; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform float uLit, uTime, uFog, uBody; uniform vec3 uHaze, uHazeHigh, uStreet, uMoon, uSky;
      varying vec3 vW; varying vec3 vN; varying vec4 vB;
      void main(){
        float seed = vB.x, kind = vB.z;
        vec3 n = normalize(vN);
        float top = step(0.6, n.y);
        float diff = 0.42 + 0.38 * max(dot(n, uMoon), 0.0) + 0.12 * n.y;
        vec3 concrete = mix(vec3(0.16, 0.15, 0.15), vec3(0.24, 0.21, 0.18), seed);
        vec3 stone = mix(vec3(0.3, 0.26, 0.2), vec3(0.36, 0.3, 0.22), seed);
        vec3 glassBody = mix(vec3(0.05, 0.07, 0.1), vec3(0.07, 0.09, 0.12), seed);
        vec3 body = (kind < 0.5 ? glassBody : kind < 1.5 ? concrete : stone) * uBody;
        vec3 c;
        if (vB.w > 0.5) {
          // Parapets and rooftop plant: dark metal and concrete; the antenna tip blinks red.
          c = mix(vec3(0.09, 0.09, 0.1), concrete * 0.8, step(vB.w, 1.5)) * diff * uBody;
          if (vB.w > 1.5) c += vec3(1.0, 0.1, 0.05) * 3.0 * step(0.5, fract(uTime * 0.6 + seed * 3.0)) * step(vB.y - 0.25, vW.y);
        } else if (top > 0.5) {
          vec2 g = fract(vW.xz * 0.5);
          c = concrete * uBody * 0.75 * diff * (0.85 + 0.15 * step(0.04, min(g.x, g.y)));
        } else {
          // Facade coordinates: across (along the face) and up.
          float across = abs(n.x) > 0.5 ? vW.z * sign(n.x) : -vW.x * sign(n.z);
          float floorH = kind < 0.5 ? 0.62 : 0.72;
          float bayW = kind < 0.5 ? 0.52 : kind < 1.5 ? 0.66 : 0.56;
          float y = vW.y;
          float fl = floor(y / floorH), fy = fract(y / floorH);
          float bay = floor(across / bayW + seed * 7.0), bx = fract(across / bayW + seed * 7.0);
          float pil = step(mod(bay, kind < 1.5 ? 4.0 : 3.0), 0.5);
          // The window opening in this cell, by type.
          vec2 lo = kind < 0.5 ? vec2(0.06, 0.12) : kind < 1.5 ? vec2(0.22, 0.24) : vec2(0.28, 0.16);
          vec2 hi = kind < 0.5 ? vec2(0.94, 0.9) : kind < 1.5 ? vec2(0.78, 0.8) : vec2(0.72, 0.86);
          float win = step(lo.x, bx) * step(bx, hi.x) * step(lo.y, fy) * step(fy, hi.y) * (1.0 - pil * step(0.5, kind));
          float crown = step(vB.y - 0.55, y);
          win *= 1.0 - crown;
          float ground = step(y, 1.15);
          // Lit or not: per building density, per window, with some whole office floors lit cool.
          float hw = whHash(vec3(bay, fl, seed * 91.0));
          float dens = mix(0.18, 0.62, fract(seed * 13.7));
          float office = step(0.88, whHash(vec3(fl, seed * 31.0, 2.0)));
          float on = max(step(1.0 - dens, hw), office) * win;
          vec3 warm = mix(vec3(1.0, 0.62, 0.3), vec3(1.0, 0.8, 0.52), whHash(vec3(bay, fl, 5.0)));
          vec3 cool = vec3(0.72, 0.86, 1.0);
          float tv = step(0.96, hw);
          vec3 lit = office > 0.5 ? cool * 0.75 : mix(warm, vec3(0.45, 0.6, 1.0) * (0.7 + 0.3 * sin(uTime * 7.0 + hw * 40.0)), tv);
          lit *= (0.55 + 0.35 * fract(hw * 17.0)) * (0.75 + 0.25 * smoothstep(0.12, 0.6, fy));
          vec3 glass = mix(vec3(0.02, 0.025, 0.04), uSky * 0.35, clamp(y * 0.03, 0.0, 1.0)) * (0.6 + 0.4 * fract(hw * 7.0));
          float slab = (1.0 - smoothstep(0.0, 0.05, fy)) * (1.0 - win);
          vec3 wall = body * diff * (1.0 + pil * 0.18 + slab * 0.35);
          wall *= 1.0 + crown * 0.25 * (1.0 - smoothstep(vB.y - 0.55, vB.y - 0.35, y)) ;
          c = mix(wall, glass + lit * on * uLit * 1.2, win);
          // The shopfronts: lit glass under a sign band of colour.
          if (ground > 0.5) {
            float shop = step(0.08, bx) * step(bx, 0.92) * step(0.12, y) * step(y, 0.86);
            float sign = step(0.92, y) * step(y, 1.08) * step(0.3, whHash(vec3(floor(bay / 2.0), seed, 9.0)));
            vec3 sc = mix(vec3(1.0, 0.4, 0.3), vec3(0.3, 0.9, 1.0), whHash(vec3(floor(bay / 2.0), seed, 4.0)));
            c = mix(body * diff * 0.7, vec3(1.0, 0.78, 0.5) * 0.9 * uLit + vec3(0.02), shop);
            c += sc * sign * 0.9 * uLit;
          }
          // Light bounced up from the lit street.
          c += uStreet * 0.16 * exp(-y * 0.5) * uLit;
        }
        // Haze: thicker low down, blue-violet up high.
        float dist = length(vW - cameraPosition);
        float f = 1.0 - exp(-dist * uFog);
        float low = exp(-max(vW.y, 0.0) * 0.12);
        vec3 hz = mix(uHazeHigh, uHaze, low);
        c = mix(c, hz, clamp(f * (0.65 + 0.35 * low), 0.0, 1.0));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  return { mesh, u, roofs, geo, dispose() { geo.dispose(); mat.dispose(); } };
}

/**
 * Street lamps (posts, one draw call) with soft heads (points, one draw
 * call), plus the sodium pools they throw, drawn on a ground plane by the
 * caller via `pools` (positions).
 */
export function makeStreetLamps(o: { points: Vec3[]; height?: number; color?: string; size?: number; pools?: number }) {
  const h = o.height ?? 3.2;
  const posts = merge(o.points.flatMap((p) => [placed(new THREE.CylinderGeometry(0.05, 0.08, h, 5), [p[0], h / 2, p[2]]), placed(new THREE.BoxGeometry(0.5, 0.05, 0.08), [p[0] + 0.2, h, p[2]])]));
  const postMat = new THREE.MeshStandardMaterial({ color: col("#14161a"), roughness: 0.6, metalness: 0.5 });
  const postMesh = new THREE.Mesh(posts, postMat);
  const hp = new Float32Array(o.points.length * 3);
  o.points.forEach((p, i) => hp.set([p[0] + 0.4, h - 0.06, p[2]], i * 3));
  const hg = new THREE.BufferGeometry();
  hg.setAttribute("position", new THREE.BufferAttribute(hp, 3));
  const u = { uPixel: { value: 600 }, uK: { value: 1 }, uColor: { value: col(o.color ?? "#ffc070") }, uSize: { value: o.size ?? 0.5 } };
  const hm = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `uniform float uPixel, uSize; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(uSize * uPixel / -mv.z, 1.5, 40.0); }`,
    fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uK; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = max(0.0, 1.0 - d); a = a * a * (0.35 + 0.65 * step(d, 0.25)); gl_FragColor = vec4(uColor * a * 1.6 * uK, a * uK); }`,
  });
  const heads = new THREE.Points(hg, hm);
  heads.frustumCulled = false;
  const group = new THREE.Group();
  group.add(postMesh, heads);
  // Optional pools of light on the ground under each lamp (instanced, one draw call).
  let pools: THREE.InstancedMesh | null = null, poolTex: THREE.CanvasTexture | null = null, poolMat: THREE.MeshBasicMaterial | null = null;
  if (o.pools) {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,255,255,0.45)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    poolTex = new THREE.CanvasTexture(c);
    poolMat = new THREE.MeshBasicMaterial({ map: poolTex, color: col(o.color ?? "#ffc070", o.pools), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMat, o.points.length);
    const m = new THREE.Matrix4();
    o.points.forEach((p, i) => { m.makeScale(h * 1.6, 1, h * 1.6).setPosition(p[0] + 0.4, (p[1] ?? 0) + 0.04, p[2]); pools!.setMatrixAt(i, m); });
    group.add(pools);
  }
  return { group, u, poolMat, dispose() { posts.dispose(); postMat.dispose(); hg.dispose(); hm.dispose(); if (pools) { pools.geometry.dispose(); pools.dispose(); } poolMat?.dispose(); poolTex?.dispose(); } };
}
