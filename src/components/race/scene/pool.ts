import * as THREE from "three";
import { POOL_INSET, POOL_X0, WATER_Y, poolBounds, poolWalls } from "@/lib/race/pool";
import { KERB_R, LANE_W, RUN_OUT, X0, type Distance } from "@/lib/race/track";
import { puffTexture } from "./textures";

/**
 * Pool lanes (lib/race/pool): for a swimmer, its lane is a tiled water
 * channel set into the track, built while the race loads. The floor's and
 * paint's shaders cut the channel out of the track (`POOL_GLSL`, shared
 * with the stadium); this draws its tiled walls and floor with moving
 * caustics, the water (ripples, a Fresnel sheen that reflects the
 * floodlights, and for each swimmer a Kelvin wake, a bow wave and foam at
 * its tail), bubbles rising off the swimmers and splashes from their
 * tails, big ones for big swimmers.
 */

export const MAX_SWIMMERS = 8;

/** The pool region in GLSL: `racePoolAt(xz)` is 1 in a channel (as lib/race/pool's poolAt). Needs X0, KERB, LANE, RUNOUT. */
export const POOL_GLSL = /* glsl */ `
  uniform vec4 uPoolA;
  uniform vec4 uPoolB;
  const float POOL_IN = ${POOL_INSET.toFixed(4)};
  const float POOL_X0 = ${POOL_X0.toFixed(3)};
  float raceLaneMode(int L) { return L < 4 ? uPoolA[L] : uPoolB[L - 4]; }
  // 1 in a channel; f: across the lane (0 at its inner line … LANE at its outer one).
  float racePool(vec2 p, out float f) {
    f = 0.0;
    if (dot(uPoolA, uPoolA) + dot(uPoolB, uPoolB) < 0.5) return 0.0;
    float ax = abs(p.x);
    float across = ax <= X0 ? abs(p.y) - KERB : length(vec2(ax - X0, p.y)) - KERB;
    if (across > 0.0 && across < 8.0 * LANE) {
      int L = int(floor(across / LANE));
      float m = raceLaneMode(L);
      f = across - float(L) * LANE;
      if (m > 0.5 && f > POOL_IN && f < LANE - POOL_IN) {
        bool home = ax <= X0 && p.y > 0.0;
        bool bend2 = p.x < -X0;
        if (m > 2.5 || (m > 1.5 && bend2) || home) return 1.0;
      }
    }
    float ah = p.y - KERB;
    if (ah > 0.0 && ah < 8.0 * LANE && ((p.x > X0 && p.x < X0 + RUNOUT) || (p.x < -X0 && p.x > POOL_X0))) {
      int L = int(floor(ah / LANE));
      float m = raceLaneMode(L);
      f = ah - float(L) * LANE;
      if (m > 0.5 && f > POOL_IN && f < LANE - POOL_IN && (p.x > X0 || m < 1.5)) return 1.0;
    }
    return 0.0;
  }
  float racePoolAt(vec2 p) { float f; return racePool(p, f); }
`;

export const POOL_CONST = /* glsl */ `
  const float X0 = ${X0.toFixed(4)};
  const float KERB = ${KERB_R.toFixed(4)};
  const float LANE = ${LANE_W.toFixed(4)};
  const float RUNOUT = ${RUN_OUT.toFixed(2)};
`;

export interface PoolUniforms {
  uPoolA: { value: THREE.Vector4 };
  uPoolB: { value: THREE.Vector4 };
}

export function poolUniforms(): PoolUniforms {
  return { uPoolA: { value: new THREE.Vector4() }, uPoolB: { value: new THREE.Vector4() } };
}

export function setPoolModes(u: PoolUniforms, modes: number[]) {
  u.uPoolA.value.set(modes[0] ?? 0, modes[1] ?? 0, modes[2] ?? 0, modes[3] ?? 0);
  u.uPoolB.value.set(modes[4] ?? 0, modes[5] ?? 0, modes[6] ?? 0, modes[7] ?? 0);
}

export interface SwimmerState {
  x: number;
  z: number;
  dx: number;
  dz: number;
  v: number;
  /** Body length and height (m) and weight (kg). */
  len: number;
  h: number;
  kg: number;
  /** Tail beats completed (the gait's phase). */
  phase: number;
}

export interface Pool {
  group: THREE.Group;
  update(t: number, swimmers: SwimmerState[], cam: THREE.Camera): void;
  dispose(): void;
}

const TILE_GLSL = /* glsl */ `
  float raceTile(vec2 q, float size) {
    vec2 g = abs(fract(q / size) - 0.5) * size;
    float grout = smoothstep(0.006, 0.0, min(size * 0.5 - g.x, size * 0.5 - g.y));
    return grout;
  }
  float raceCaustic(vec2 p, float t) {
    float c = 0.0;
    c += sin(p.x * 3.1 + t * 1.3 + sin(p.y * 2.3 + t));
    c += sin(p.y * 3.7 - t * 1.1 + sin(p.x * 2.9 - t * 0.7));
    c += sin((p.x + p.y) * 2.3 + t * 0.9);
    return pow(max(0.0, c / 3.0), 3.0);
  }
`;

/** Builds the pool for the swimmers' lanes (none: an empty group). */
export function buildPool(lanes: number[], distance: Distance, modes: number[], depth: number, shared: PoolUniforms, envMap: THREE.Texture | null, layer: number): Pool {
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  const time = { value: 0 };
  const swA = { value: Array.from({ length: MAX_SWIMMERS }, () => new THREE.Vector4()) };
  const swB = { value: Array.from({ length: MAX_SWIMMERS }, () => new THREE.Vector4()) };
  const swN = { value: 0 };
  if (!lanes.length) return { group, update() {}, dispose() {} };
  const [bx0, bz0, bx1, bz1] = poolBounds(modes);
  const bottom = -depth;

  // ---- Tiled floor (a plane cut to the channels) and walls.
  const tileMat = (kind: "floor" | "wall") => {
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.62, 0.8, 0.86), roughness: 0.35, metalness: 0, envMapIntensity: 0.4, side: THREE.FrontSide });
    m.onBeforeCompile = (s) => {
      s.uniforms.uPoolA = shared.uPoolA;
      s.uniforms.uPoolB = shared.uPoolB;
      s.uniforms.uTime = time;
      s.vertexShader = s.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vPoolW;\nvarying vec2 vPoolUv;\nvarying vec3 vPoolN;")
        .replace("#include <uv_vertex>", "#include <uv_vertex>\nvPoolUv = uv;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvPoolW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvPoolN = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);");
      s.fragmentShader = s.fragmentShader
        .replace("#include <common>", `#include <common>\nvarying vec3 vPoolW;\nvarying vec2 vPoolUv;\nvarying vec3 vPoolN;\nuniform float uTime;\n${POOL_CONST}\n${POOL_GLSL}\n${TILE_GLSL}`)
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
          {
            vec2 p = vPoolW.xz;
            float laneF;
            // The floor is cut to the channels; a wall that runs through another stretch of its channel (the 400 m's start, the run-out) is cut away.
            ${kind === "floor" ? "if (racePool(p, laneF) < 0.5) discard;" : "if (racePoolAt(p - vPoolN.xz * 0.07) > 0.5) discard;"}
            ${kind === "floor"
              ? `float g = raceTile(p, 0.25);
                 float a = abs(laneF - LANE * 0.5) / (LANE * 0.5 - POOL_IN);
                 // The dark lane stripe down the middle, as in a racing pool.
                 float stripe = smoothstep(0.2, 0.17, a);
                 diffuseColor.rgb = mix(vec3(0.6, 0.82, 0.88), vec3(0.05, 0.12, 0.2), stripe);`
              : `float g = raceTile(vPoolUv, 0.25);
                 // A band of darker tiles under the coping.
                 diffuseColor.rgb = mix(vec3(0.62, 0.82, 0.88), vec3(0.12, 0.32, 0.5), smoothstep(-0.14, -0.1, vPoolW.y) * 0.8);`}
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.9), g * 0.7);
            // Caustics from the waves above, fading with depth.
            float under = clamp((${WATER_Y.toFixed(3)} - vPoolW.y) / 3.0, 0.0, 1.0);
            diffuseColor.rgb *= 0.78 + 0.6 * raceCaustic(p * 1.6 + vec2(vPoolW.y * 0.7), uTime) * (1.0 - under * 0.6);
            // Water absorbs red light first: deeper is bluer and darker.
            diffuseColor.rgb *= mix(vec3(1.0), vec3(0.3, 0.62, 0.78), clamp((${WATER_Y.toFixed(3)} - vPoolW.y) / 2.2, 0.0, 1.0));
          }`
        );
    };
    m.customProgramCacheKey = () => `race-pool-${kind}`;
    mats.push(m);
    return m;
  };
  const floorGeo = new THREE.PlaneGeometry(bx1 - bx0, bz1 - bz0, 1, 1).rotateX(-Math.PI / 2).translate((bx0 + bx1) / 2, bottom, (bz0 + bz1) / 2);
  geos.push(floorGeo);
  const floor = new THREE.Mesh(floorGeo, tileMat("floor"));
  group.add(floor);
  // Walls: vertical strips along each wall polyline, facing into the water, from the floor up to the track.
  {
    const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
    for (const lane of lanes) {
      for (const w of poolWalls(lane, distance)) {
        let along = 0;
        const base = pos.length / 3;
        w.pts.forEach((p, i) => {
          if (i) along += Math.hypot(p.x - w.pts[i - 1].x, p.z - w.pts[i - 1].z);
          for (const y of [bottom, 0.001]) {
            pos.push(p.x, y, p.z);
            nor.push(p.nx, 0, p.nz);
            uv.push(along, y);
          }
        });
        for (let i = 0; i < w.pts.length - 1; i++) {
          const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
          // Wind so the face points along the normal (into the water).
          const p0 = w.pts[i], p1 = w.pts[i + 1];
          const tx = p1.x - p0.x, tz = p1.z - p0.z;
          // Face normal of (a, c, b) is (t × up) for this winding.
          const fx = -tz, fz = tx;
          if (fx * p0.nx + fz * p0.nz > 0) idx.push(a, c, b, b, c, d);
          else idx.push(a, b, c, b, d, c);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    geos.push(g);
    const wm = tileMat("wall");
    const walls = new THREE.Mesh(g, wm);
    group.add(walls);
  }

  // ---- The water.
  const waterGeo = new THREE.PlaneGeometry(bx1 - bx0, bz1 - bz0, 1, 1).rotateX(-Math.PI / 2).translate((bx0 + bx1) / 2, WATER_Y, (bz0 + bz1) / 2);
  geos.push(waterGeo);
  const water = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.05, 0.3, 0.38), roughness: 0.05, metalness: 0, transparent: true, depthWrite: false, envMap, envMapIntensity: 1.35 });
  water.onBeforeCompile = (s) => {
    s.uniforms.uPoolA = shared.uPoolA;
    s.uniforms.uPoolB = shared.uPoolB;
    s.uniforms.uTime = time;
    s.uniforms.uSwA = swA;
    s.uniforms.uSwB = swB;
    s.uniforms.uSwN = swN;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vPoolW;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvPoolW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    s.fragmentShader = s.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vPoolW;
        uniform float uTime;
        uniform vec4 uSwA[${MAX_SWIMMERS}];
        uniform vec4 uSwB[${MAX_SWIMMERS}];
        uniform int uSwN;
        ${POOL_CONST}
        ${POOL_GLSL}
        float raceFoam;
        // Surface height (m) and foam at p: wind ripples, and each swimmer's wake, bow wave and wash.
        float raceWaves(vec2 p) {
          float h = 0.004 * sin(p.x * 5.3 + uTime * 2.1) + 0.003 * sin(p.y * 7.1 - uTime * 2.7 + p.x * 1.3) + 0.002 * sin((p.x - p.y) * 11.0 + uTime * 3.4);
          for (int i = 0; i < ${MAX_SWIMMERS}; i++) {
            if (i >= uSwN) break;
            vec4 a = uSwA[i], b = uSwB[i];
            vec2 d = a.zw, n = vec2(-d.y, d.x);
            vec2 q = p - a.xy;
            float fwd = dot(q, d), lat = dot(q, n);
            float v = b.x, len = b.y, beam = b.z, k = b.w;
            float sp = clamp(v / 8.0, 0.0, 1.0);
            float behind = -fwd - len * 0.45;
            // Kelvin wake: the divergent waves on a 19.5° wedge behind it, fading with distance.
            if (behind > 0.0) {
              float edge = abs(lat) - behind * 0.354;
              float env = exp(-behind / (3.0 + 0.8 * v)) * exp(-edge * edge / (0.03 + 0.02 * behind));
              h += k * 0.05 * sp * env * sin(behind * 9.0 - uTime * 7.0);
              // Turbulent wash straight behind the tail.
              float wash = exp(-behind / (0.6 + 0.25 * v)) * exp(-lat * lat / (beam * beam * 1.6));
              h += k * 0.02 * sp * wash * sin(behind * 21.0 + lat * 13.0 - uTime * 11.0);
              raceFoam += wash * sp * 1.2;
            }
            // Bow wave: a crest pushed ahead of the nose, spilling out to the sides.
            float front = fwd - len * 0.45;
            float bow = exp(-front * front / 0.05) * exp(-lat * lat / (beam * beam * 2.5));
            h += k * 0.06 * sp * bow;
            raceFoam += bow * sp * 0.9;
            // Where the body cuts the surface.
            float body = length(vec2(fwd / (len * 0.5), lat / max(0.05, beam)));
            raceFoam += exp(-(body - 1.0) * (body - 1.0) / 0.02) * (0.25 + 0.75 * sp);
          }
          return h;
        }`
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        {
          if (racePoolAt(vPoolW.xz) < 0.5) discard;
          raceFoam = 0.0;
          float e = 0.025;
          float h0 = raceWaves(vPoolW.xz);
          float foam0 = raceFoam;
          float hx = raceWaves(vPoolW.xz + vec2(e, 0.0));
          float hz = raceWaves(vPoolW.xz + vec2(0.0, e));
          raceFoam = foam0;
          vec3 nW = normalize(vec3(-(hx - h0) / e, 1.0, -(hz - h0) / e));
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        }`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.55, clamp(raceFoam, 0.0, 1.0));`
      )
      .replace(
        "#include <opaque_fragment>",
        `{
          // Fresnel: clear looking down into it, a mirror at a glancing angle.
          float cosV = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          float fres = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
          float foam = clamp(raceFoam, 0.0, 1.0);
          outgoingLight = mix(outgoingLight, vec3(0.92, 0.96, 1.0) * 1.1, foam * 0.85);
          diffuseColor.a = clamp(mix(0.42, 0.97, fres) + foam * 0.5, 0.0, 1.0);
        }
        #include <opaque_fragment>`
      );
  };
  water.customProgramCacheKey = () => "race-pool-water";
  mats.push(water);
  const waterMesh = new THREE.Mesh(waterGeo, water);
  waterMesh.renderOrder = 4;
  group.add(waterMesh);

  // ---- Bubbles (under the surface) and splashes (above it).
  const puff = puffTexture();
  texs.push(puff);
  const sprite = new THREE.PlaneGeometry(1, 1);
  geos.push(sprite);
  const NB = 160, NS = 120;
  const bubbleMat = new THREE.MeshBasicMaterial({ map: puff, transparent: true, depthWrite: false, color: new THREE.Color(0.75, 0.92, 1), opacity: 0.55 });
  const splashMat = new THREE.MeshBasicMaterial({ map: puff, transparent: true, depthWrite: false, color: new THREE.Color(0.9, 0.97, 1), opacity: 0.85 });
  mats.push(bubbleMat, splashMat);
  const bubbles = new THREE.InstancedMesh(sprite, bubbleMat, NB);
  const splashes = new THREE.InstancedMesh(sprite, splashMat, NS);
  bubbles.renderOrder = 3;
  splashes.renderOrder = 5;
  bubbles.frustumCulled = splashes.frustumCulled = false;
  group.add(bubbles, splashes);
  type P = { x: number; y: number; z: number; vx: number; vy: number; vz: number; s: number; t0: number; life: number };
  const bub: P[] = Array.from({ length: NB }, () => ({ x: 0, y: -99, z: 0, vx: 0, vy: 0, vz: 0, s: 0, t0: -99, life: 1 }));
  const spl: P[] = Array.from({ length: NS }, () => ({ x: 0, y: -99, z: 0, vx: 0, vy: 0, vz: 0, s: 0, t0: -99, life: 1 }));
  let nb = 0, ns = 0, lastT = 0;
  const lastBeat = new Map<number, number>();
  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const q = new THREE.Quaternion(), m4 = new THREE.Matrix4(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
  group.traverse((o) => o.layers.set(layer));

  function update(t: number, swimmers: SwimmerState[], cam: THREE.Camera) {
    time.value = t;
    const dt = Math.max(0, Math.min(0.1, t - lastT));
    const jumped = t < lastT - 0.05 || t - lastT > 1;
    lastT = t;
    swN.value = Math.min(MAX_SWIMMERS, swimmers.length);
    swimmers.slice(0, MAX_SWIMMERS).forEach((w, i) => {
      swA.value[i].set(w.x, w.z, w.dx, w.dz);
      // Wake strength grows with size (a whale throws a bigger wake than a goldfish).
      swB.value[i].set(w.v, w.len, Math.max(0.12, Math.min(LANE_W * 0.45, w.h * 0.35)), Math.min(2.5, 0.6 + Math.cbrt(w.kg) / 6));
      // Bubbles: streaming off the body, more the faster it goes.
      const rate = (2 + w.v * 2.2) * Math.min(3, 0.5 + w.len);
      const count = jumped ? 0 : Math.min(6, Math.floor(rate * dt + rnd()));
      for (let k = 0; k < count; k++) {
        const back = (rnd() - 0.2) * w.len * 0.6;
        bub[nb] = { x: w.x - w.dx * back + (rnd() - 0.5) * 0.3, y: WATER_Y - 0.05 - rnd() * Math.min(depth - 0.2, w.h * 0.4), z: w.z - w.dz * back + (rnd() - 0.5) * 0.3, vx: 0, vy: 0.25 + rnd() * 0.45, vz: 0, s: 0.025 + rnd() * 0.05 * Math.min(2, 0.6 + w.len * 0.3), t0: t, life: 0.8 + rnd() * 1.2 };
        nb = (nb + 1) % NB;
      }
      // Splashes at each tail beat: spray thrown up and back, scaled by the swimmer's size and speed.
      const beat = Math.floor(w.phase * 2);
      const prev = lastBeat.get(i);
      lastBeat.set(i, beat);
      if (!jumped && prev != null && beat !== prev && w.v > 0.3) {
        const big = Math.cbrt(w.kg / 10);
        const n = Math.min(14, Math.round(3 + big * 2.2 + w.v * 0.3));
        for (let k = 0; k < n; k++) {
          const back = w.len * (0.35 + rnd() * 0.25);
          const up = (1.2 + rnd() * 1.6) * Math.min(2.6, 0.6 + big * 0.35);
          spl[ns] = { x: w.x - w.dx * back + (rnd() - 0.5) * 0.4, y: WATER_Y + 0.02, z: w.z - w.dz * back + (rnd() - 0.5) * 0.4, vx: -w.dx * (0.5 + rnd()) + (rnd() - 0.5) * 1.2, vy: up, vz: -w.dz * (0.5 + rnd()) + (rnd() - 0.5) * 1.2, s: (0.1 + rnd() * 0.16) * Math.min(4, 0.6 + big * 0.5), t0: t, life: 0.5 + rnd() * 0.5 };
          ns = (ns + 1) % NS;
        }
      }
    });
    cam.getWorldQuaternion(q);
    bub.forEach((b, i) => {
      const age = t - b.t0;
      const alive = age >= 0 && age < b.life;
      const y = Math.min(WATER_Y - 0.01, b.y + b.vy * age);
      const k = alive ? b.s * (1 + age * 0.3) : 0;
      v3.set(b.x + Math.sin((t + i) * 6) * 0.02, y, b.z);
      s3.setScalar(k);
      m4.compose(v3, q, s3);
      bubbles.setMatrixAt(i, m4);
    });
    spl.forEach((b, i) => {
      const age = t - b.t0;
      const alive = age >= 0 && age < b.life;
      const y = b.y + b.vy * age - 4.9 * age * age;
      const k = alive && y > WATER_Y - 0.05 ? b.s * (0.7 + age * 1.4) * (1 - age / b.life * 0.5) : 0;
      v3.set(b.x + b.vx * age, y, b.z + b.vz * age);
      s3.setScalar(k);
      m4.compose(v3, q, s3);
      splashes.setMatrixAt(i, m4);
    });
    bubbles.instanceMatrix.needsUpdate = true;
    splashes.instanceMatrix.needsUpdate = true;
  }

  return {
    group,
    update,
    dispose() {
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      texs.forEach((t) => t.dispose());
    },
  };
}
