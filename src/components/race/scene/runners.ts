import * as THREE from "three";
import type { ReliefMap } from "@/lib/sizes/relief";
import type { Joint } from "@/lib/race/figure";
import { artFacing } from "@/lib/race/facing";
import { GROUNDED, poseFor, swimStyle } from "@/lib/race/gait";
import { celebrationAt, dipAt, jointAngles, swayAt, type LimbPart } from "@/lib/race/limbs";
import { MAX_PARTS } from "@/lib/race/parts";
import { LANE_WATER, WATER_Y, beamOf, clipsUnderwater, needsBigPool, swimmerY, waterAround } from "@/lib/race/pool";
import { runnerAt, type Race, type RaceLane } from "@/lib/race/race";
import { lanePoint } from "@/lib/race/track";
import type { Entrant } from "@/lib/race/types";
import { buildFigure } from "./figure-build";
import type { Pool, SwimmerState } from "./pool";
import { LAYER } from "./stadium";
import { puffTexture, streakTexture } from "./textures";

/**
 * The eight runners: each Pokémon's HOME render on a relief mesh with a
 * sculpted back (lib/race/figure, built in a worker), moved down its lane
 * by the race model and animated by its gait (lib/race/gait):
 *
 * - Its moving parts (lib/race/parts) swing in the vertex shader, each
 *   about its joint: legs stride (knees folding in the swing), arms pump,
 *   wings beat, tails wag, timed by the gait's cycle count (lib/race/limbs).
 * - The body: stance and push-off, flight and landing for runners; bounds,
 *   hops, wingbeats, a body wave for serpents, rolling for balls, and for
 *   swimmers a carangiform or anguilliform wave in their pool lane.
 * - The finish: sprinters dip at the line; the winner eases off, then
 *   jumps for joy, arms up; the rest ease off and stand.
 *
 * Each figure turns towards the camera, at most a little past its running
 * direction, and its art is mirrored so its head leads. Shadows are soft
 * blobs cast away from each of the four floodlight masts. Runners kick up
 * puffs of rubber dust (more and bigger the heavier they are), the fastest
 * trail speed streaks, and heavy ones shake the camera.
 */

export interface RunnerUrls {
  art(id: number, size: 256 | 512): string;
  relief(e: Entrant): string;
}

export interface RunnerOptions {
  texSize: 256 | 512;
  segments: number;
  anisotropy: number;
}

export interface FigureUniforms {
  uWave: { value: number };
  uWaveK: { value: number };
  uWavePhase: { value: number };
  /** Per part: joint A (pivot, angle), joint B (pivot, angle), their axes (and modes). */
  uJA: { value: THREE.Vector4[] };
  uJB: { value: THREE.Vector4[] };
  uXA: { value: THREE.Vector4[] };
  uXB: { value: THREE.Vector4[] };
  /** Swimmers: amplitude (mesh units), waves along the body, phase (rad), on; lateral axis and the head's x; direction and body length. */
  uSwim: { value: THREE.Vector4 };
  uSwimAx: { value: THREE.Vector4 };
  uSwimLen: { value: THREE.Vector2 };
  /** World height below which the figure isn't drawn (a giant swimmer under the water). */
  uClipY: { value: number };
  /** Under the water instead of cut: the water's glow (rgb) and its clarity (1 a clear pool; 0 cuts it, as above). */
  uUnder: { value: THREE.Vector4 };
  /** A bend of the whole body along its height (mesh units across, at mid-height; 0 off), its height, for arched backs in other sports (the PokéIQ Games). */
  uBend: { value: THREE.Vector2 };
}

export interface Figure {
  lane: RaceLane;
  root: THREE.Group;
  lean: THREE.Group;
  yaw: THREE.Group;
  spin: THREE.Group;
  body: THREE.Mesh;
  /** Flat cut-out for the photo-finish camera. */
  cut: THREE.Mesh;
  uniforms: FigureUniforms;
  joints: Joint[];
  /** Which way the render faces: −1 left, 1 right. */
  facing: -1 | 1;
  /** Mesh size (units of the box's longest side). */
  meshW: number;
  meshH: number;
  /** How far a swimmer may turn from side-on towards the camera (radians) without leaving the water. */
  turnMax: number;
  /** Running towards the right of the screen (with hysteresis). */
  runsRight: boolean;
  /** Steps on stubby feet (and sways). */
  stubby: boolean;
  mirrored: boolean;
  lastStep: number;
  dispose(): void;
}

export interface Footfall {
  x: number;
  z: number;
  kg: number;
}

async function fetchBitmap(url: string, signal: AbortSignal): Promise<ImageBitmap> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const blob = await res.blob();
  return createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

function bitmapPixels(bmp: ImageBitmap): ReliefMap {
  const cv = document.createElement("canvas");
  cv.width = bmp.width;
  cv.height = bmp.height;
  const g = cv.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  const img = g.getImageData(0, 0, bmp.width, bmp.height);
  return { w: bmp.width, h: bmp.height, data: img.data, channels: 4 };
}

/** Crisp, slightly richer HOME renders; moving parts, the serpent's and the swimmer's body waves. */
function figureMaterial(tex: THREE.Texture, texSize: number, uniforms: FigureUniforms): THREE.MeshStandardMaterial {
  // Some HOME renders are partly see-through (Pheromosa, ghosts): a low cut-off keeps them solid.
  const m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.28, roughness: 0.58, metalness: 0, envMapIntensity: 0.85 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uTexel = { value: 1 / texSize };
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uWave;
        uniform float uWaveK;
        uniform float uWavePhase;
        uniform vec4 uJA[${MAX_PARTS}];
        uniform vec4 uJB[${MAX_PARTS}];
        uniform vec4 uXA[${MAX_PARTS}];
        uniform vec4 uXB[${MAX_PARTS}];
        uniform vec4 uSwim;
        uniform vec4 uSwimAx;
        uniform vec2 uSwimLen;
        uniform vec2 uBend;
        attribute vec3 aPart;
        varying float vRaceY;
        varying vec3 vRaceW;
        vec3 raceRot(vec3 v, vec3 a, float ang) { float c = cos(ang), s = sin(ang); return v * c + cross(a, v) * s + a * dot(a, v) * (1.0 - c); }`
      )
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
        vec3 racePos = position;
        {
          // A moving part: its far half bends about joint B (a knee, elbow, wingtip or the tail's curl), then the whole part turns about joint A.
          int k = int(aPart.x + 0.5) - 1;
          if (k >= 0 && aPart.y > 0.0) {
            vec4 ja = uJA[k], jb = uJB[k], xa = uXA[k], xb = uXB[k];
            float w = aPart.y, al = aPart.z;
            float angB = jb.w * w * (xb.w > 0.5 ? al : smoothstep(0.4, 0.6, al));
            racePos = jb.xyz + raceRot(racePos - jb.xyz, xb.xyz, angB);
            objectNormal = raceRot(objectNormal, xb.xyz, angB);
            float angA = ja.w * w * (xa.w > 0.5 ? al : 1.0);
            racePos = ja.xyz + raceRot(racePos - ja.xyz, xa.xyz, angA);
            objectNormal = raceRot(objectNormal, xa.xyz, angA);
          }
          // Swimmers: a travelling wave down the body, its amplitude growing towards the tail (carangiform) or along it all (anguilliform).
          if (uSwim.w > 0.5) {
            float xi = clamp((racePos.x - uSwimAx.w) * uSwimLen.x / max(1e-3, uSwimLen.y), 0.0, 1.0);
            float env = uSwim.w > 1.5 ? 0.55 + 0.45 * xi : 0.06 + 0.94 * xi * xi;
            float arg = 6.2831853 * xi * uSwim.y - uSwim.z;
            racePos += uSwimAx.xyz * (uSwim.x * env * sin(arg));
            // Turn the surface with the wave's slope so the light moves along the body.
            float slope = uSwim.x * env * cos(arg) * 6.2831853 * uSwim.y / max(1e-3, uSwimLen.y);
            objectNormal = normalize(objectNormal - uSwimAx.xyz * slope * dot(objectNormal, vec3(0.0, 0.0, 1.0)));
          }
          // An arch along the body's height (0 at the head and feet, most at the middle).
          if (uBend.x != 0.0) {
            float hb = clamp(racePos.y / max(1e-3, uBend.y), 0.0, 1.0);
            racePos.x += uBend.x * sin(3.14159265 * hb);
          }
        }`
      )
      .replace("#include <project_vertex>", "#include <project_vertex>\nvRaceW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvRaceY = vRaceW.y;")
      .replace("#include <begin_vertex>", "vec3 transformed = racePos;\ntransformed.y += uWave * sin(transformed.x * uWaveK - uWavePhase) * (0.35 + 0.65 * smoothstep(0.0, 0.5, abs(transformed.x)));");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uTexel;\nuniform float uClipY;\nuniform vec4 uUnder;\nvarying float vRaceY;\nvarying vec3 vRaceW;")
      .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\nif (vRaceY < uClipY && uUnder.w <= 0.0) discard;")
      // Under the water (the Games' pool), seen through it from above: the light down to it and back up the
      // refracted ray loses its red first, and the water's own blue glows in along the way.
      .replace(
        "#include <opaque_fragment>",
        `#include <opaque_fragment>
        if (uUnder.w > 0.0 && vRaceY < uClipY && cameraPosition.y > uClipY) {
          float dep = uClipY - vRaceY;
          vec3 rd = normalize(vRaceW - cameraPosition);
          float st = sqrt(max(0.0, 1.0 - rd.y * rd.y)) / 1.333;
          float L = dep / sqrt(max(0.05, 1.0 - st * st));
          gl_FragColor.rgb = gl_FragColor.rgb * exp(-(L + dep) * vec3(0.55, 0.2, 0.11) * uUnder.w) + uUnder.rgb * (1.0 - exp(-L * 0.5 * uUnder.w));
        }`,
      )
      .replace(
        "#include <map_fragment>",
        `#ifdef USE_MAP
          vec4 c0 = texture2D(map, vMapUv);
          vec4 n1 = texture2D(map, vMapUv + vec2(uTexel, 0.0)), n2 = texture2D(map, vMapUv - vec2(uTexel, 0.0));
          vec4 n3 = texture2D(map, vMapUv + vec2(0.0, uTexel)), n4 = texture2D(map, vMapUv - vec2(0.0, uTexel));
          // Sharpen inside the figure only: next to the cut-out edge the neighbours are transparent.
          float inside = min(min(n1.a, n2.a), min(n3.a, n4.a));
          vec3 blur = (n1.rgb + n2.rgb + n3.rgb + n4.rgb) * 0.25;
          vec3 sharp = clamp(c0.rgb + (c0.rgb - blur) * 0.45 * smoothstep(0.85, 1.0, inside), 0.0, 1.0);
          float l = dot(sharp, vec3(0.299, 0.587, 0.114));
          sharp = clamp(mix(vec3(l), sharp, 1.08), 0.0, 1.0);
          diffuseColor *= vec4(sharp, c0.a);
        #endif`
      );
  };
  m.customProgramCacheKey = () => "race-figure-6";
  return m;
}

const v4s = () => Array.from({ length: MAX_PARTS }, () => new THREE.Vector4());

/**
 * A swimmer lies side-on along its channel and turns towards the camera
 * only as far as the water each side of it allows (its body `depth` m
 * across, its tail beating about a tenth of its length to each side), so
 * no part of it ever reaches over the coping onto the track.
 */
export function swimTurn(lane: RaceLane, depth: number): number {
  const { w, h } = lane;
  const len = Math.max(w, h);
  const water = needsBigPool(w, h) ? beamOf(w, h) + 2 * waterAround(w, h) : LANE_WATER;
  return Math.asin(Math.max(0, Math.min(0.75, (water - depth - 0.2 * len) / Math.max(0.05, len))));
}

export async function loadFigure(renderer: THREE.WebGLRenderer, lane: RaceLane, urls: RunnerUrls, o: RunnerOptions, signal: AbortSignal): Promise<Figure> {
  const e = lane.entrant;
  const [bx, by, bw, bh, size] = e.box;
  const [artBmp, reliefBmp] = await Promise.all([fetchBitmap(urls.art(e.art, o.texSize), signal), fetchBitmap(urls.relief(e), signal)]);
  if (signal.aborted) { artBmp.close(); reliefBmp.close(); throw new DOMException("aborted", "AbortError"); }
  const map = bitmapPixels(reliefBmp);
  reliefBmp.close();
  // The parts and the mesh are worked out off the main thread.
  const pixels = new Uint8ClampedArray(map.data);
  const rm = await buildFigure({ w: map.w, h: map.h, data: pixels.buffer, box: { x: bx, y: by, w: bw, h: bh, size }, segments: o.segments, motion: e.motion, shape: e.shape, facing: artFacing(e.art) });
  if (signal.aborted) { artBmp.close(); throw new DOMException("aborted", "AbortError"); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(rm.position, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(rm.normal, 3));
  const uv = new Float32Array(rm.uv.length);
  for (let i = 0; i < uv.length; i += 2) { uv[i] = rm.uv[i]; uv[i + 1] = 1 - rm.uv[i + 1]; }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setAttribute("aPart", new THREE.BufferAttribute(rm.part, 3));
  geo.setIndex(new THREE.BufferAttribute(rm.index, 1));
  geo.computeBoundingSphere();
  // Swinging parts reach a little outside the rest pose.
  if (geo.boundingSphere) geo.boundingSphere.radius *= 1.25;
  const tex = new THREE.Texture(artBmp as unknown as HTMLImageElement);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = o.anisotropy;
  tex.needsUpdate = true;
  // Upload now (while the crane shot plays), not on the first frame it's drawn.
  renderer.initTexture(tex);
  const uniforms: FigureUniforms = {
    uWave: { value: 0 }, uWaveK: { value: 9 }, uWavePhase: { value: 0 },
    uJA: { value: v4s() }, uJB: { value: v4s() }, uXA: { value: v4s() }, uXB: { value: v4s() },
    uSwim: { value: new THREE.Vector4() }, uSwimAx: { value: new THREE.Vector4() }, uSwimLen: { value: new THREE.Vector2(1, 1) },
    uClipY: { value: e.motion === "swim" && clipsUnderwater(lane.h) ? WATER_Y + 0.004 : -1e5 },
    uUnder: { value: new THREE.Vector4(0, 0, 0, 0) },
    uBend: { value: new THREE.Vector2(0, rm.height) },
  };
  const mat = figureMaterial(tex, artBmp.width, uniforms);
  // Both sheets are drawn (the back is sculpted, not a flipped copy of the front).
  mat.side = THREE.FrontSide;
  const body = new THREE.Mesh(geo, mat);
  const s = lane.h / rm.height;
  body.scale.setScalar(s);
  body.layers.set(LAYER.MAIN);
  body.castShadow = false;
  const spin = new THREE.Group();
  const yaw = new THREE.Group();
  const lean = new THREE.Group();
  const root = new THREE.Group();
  // Balls roll about their middle.
  if (e.motion === "roll") { spin.position.y = lane.h / 2; body.position.y = -lane.h / 2; }
  // A swimmer's body is centred across its channel (the relief's front and sculpted back aren't symmetric about the render's plane).
  if (e.motion === "swim") body.position.z = -((rm.zMax + rm.zMin) / 2) * s;
  spin.add(body);
  yaw.add(spin);
  lean.add(yaw);
  root.add(lean);
  // Photo-finish cut-out: the render on a plane, facing +z, mirrored so the head leads.
  const L = Math.max(bw, bh);
  const cgeo = new THREE.PlaneGeometry(bw / L, bh / L);
  cgeo.translate(0, bh / L / 2, 0);
  const cuv = cgeo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < cuv.count; i++) {
    const u = cuv.getX(i), v = cuv.getY(i);
    cuv.setXY(i, (bx + u * bw) / size, (by + (1 - v) * bh) / size);
  }
  const cmat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.28, side: THREE.DoubleSide });
  const cut = new THREE.Mesh(cgeo, cmat);
  cut.scale.set(rm.facing * lane.h / (bh / L), lane.h / (bh / L), 1);
  cut.layers.set(LAYER.PF);
  return {
    lane,
    root,
    lean,
    yaw,
    spin,
    body,
    cut,
    uniforms,
    joints: rm.joints,
    facing: rm.facing,
    meshW: rm.width,
    meshH: rm.height,
    turnMax: swimTurn(lane, (rm.zMax - rm.zMin) * s),
    runsRight: true,
    stubby: rm.joints.some((j) => j.stub),
    mirrored: false,
    lastStep: 0,
    dispose() {
      geo.dispose();
      mat.dispose();
      cgeo.dispose();
      cmat.dispose();
      tex.dispose();
      artBmp.close();
    },
  };
}

/** Start blocks for the runners that sprint from them. */
function startBlocks(race: Race): { group: THREE.Group; dispose(): void } {
  const g = new THREE.Group();
  const rail = new THREE.BoxGeometry(0.07, 0.05, 0.78);
  const plate = new THREE.BoxGeometry(0.13, 0.2, 0.05);
  const railMat = new THREE.MeshStandardMaterial({ color: "#2e3238", roughness: 0.5, metalness: 0.6 });
  const plateMat = new THREE.MeshStandardMaterial({ color: "#c9302c", roughness: 0.6 });
  for (const r of race.lanes) {
    if (r.entrant.motion !== "run") continue;
    const p = lanePoint(r.lane, race.distance, 0);
    const blk = new THREE.Group();
    blk.position.set(p.x - p.dx * 0.55, 0, p.z - p.dz * 0.55);
    blk.rotation.y = Math.atan2(p.dx, p.dz);
    const rr = new THREE.Mesh(rail, railMat);
    rr.position.y = 0.025;
    blk.add(rr);
    for (const [dx, dz] of [[-0.09, 0.16], [0.09, -0.18]]) {
      const pl = new THREE.Mesh(plate, plateMat);
      pl.position.set(dx, 0.1, dz);
      pl.rotation.x = -0.75;
      blk.add(pl);
    }
    g.add(blk);
  }
  return { group: g, dispose() { rail.dispose(); plate.dispose(); railMat.dispose(); plateMat.dispose(); } };
}

/** Soft blob shadows (instanced): one core under each runner and one away from each mast. */
function blobShadows(n: number): { mesh: THREE.InstancedMesh; dispose(): void } {
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `varying vec2 vUv; varying float vA;
      void main(){ vUv = uv; vA = instanceColor.r; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `varying vec2 vUv; varying float vA;
      void main(){ vec2 q = (vUv - 0.5) * 2.0; float d = dot(q, q); float a = exp(-d * 3.2) * vA * (1.0 - smoothstep(0.85, 1.0, d)); gl_FragColor = vec4(0.0, 0.0, 0.0, a); }`,
    polygonOffset: true,
    polygonOffsetFactor: -3,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return { mesh, dispose() { geo.dispose(); mat.dispose(); } };
}

/** Puffs of red rubber dust kicked up behind runners' feet: more, bigger and longer-lived the heavier the runner. */
function dustPuffs(n: number): { mesh: THREE.InstancedMesh; spawn(x: number, z: number, size: number, t: number, vx: number, vz: number, life: number): void; update(t: number, cam: THREE.Camera): void; dispose(): void } {
  const tex = puffTexture();
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: new THREE.Color(0.42, 0.24, 0.21) });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.frustumCulled = false;
  mesh.layers.set(LAYER.MAIN);
  const puffs = Array.from({ length: n }, () => ({ x: 0, z: 0, size: 0, t0: -99, vx: 0, vz: 0, life: 1.2 }));
  let next = 0;
  const q = new THREE.Quaternion(), mtx = new THREE.Matrix4(), v = new THREE.Vector3(), s = new THREE.Vector3();
  const update = (t: number, cam: THREE.Camera) => {
    cam.getWorldQuaternion(q);
    puffs.forEach((p, i) => {
      const age = t - p.t0;
      const k = age < 0 || age > p.life ? 0 : p.size * (0.5 + age * 1.6) * (1 - 0.35 * (age / p.life));
      // Thrown back, then drifting to a stop (air drag).
      const d = 1 - Math.exp(-age * 2.2);
      v.set(p.x + (p.vx * d) / 2.2, k * 0.35 + age * 0.12, p.z + (p.vz * d) / 2.2);
      s.setScalar(k);
      mtx.compose(v, q, s);
      mesh.setMatrixAt(i, mtx);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  return {
    mesh,
    spawn(x, z, size, t, vx, vz, life) { puffs[next] = { x, z, size, t0: t, vx, vz, life }; next = (next + 1) % n; },
    update,
    dispose() { tex.dispose(); geo.dispose(); mat.dispose(); },
  };
}

/** Speed streaks behind the fastest runners: thin bright lines along their path, longer the faster they go. */
function speedStreaks(n: number): { mesh: THREE.InstancedMesh; begin(): void; add(x: number, y: number, z: number, dx: number, dz: number, len: number, thick: number, k: number, cam: THREE.Vector3): void; end(): void; dispose(): void } {
  const tex = streakTexture();
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(0.75, 0.85, 1) });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  mesh.frustumCulled = false;
  mesh.layers.set(LAYER.MAIN);
  mesh.renderOrder = 6;
  let used = 0;
  const m = new THREE.Matrix4(), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), P = new THREE.Vector3();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  return {
    mesh,
    begin() { used = 0; },
    add(x, y, z, dx, dz, len, thick, k, cam) {
      if (used >= n) return;
      X.set(dx, 0, dz).normalize();
      // Face the camera, turning about the streak's own line.
      Z.set(cam.x - x, cam.y - y, cam.z - z);
      Z.addScaledVector(X, -Z.dot(X)).normalize();
      Y.crossVectors(Z, X);
      P.set(x, y, z);
      m.makeBasis(X.multiplyScalar(len), Y.multiplyScalar(thick), Z);
      m.setPosition(P);
      mesh.setMatrixAt(used, m);
      mesh.instanceColor!.setXYZ(used, k, k, k);
      used++;
    },
    end() {
      for (let i = used; i < n; i++) mesh.setMatrixAt(i, zero);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
    },
    dispose() { tex.dispose(); geo.dispose(); mat.dispose(); },
  };
}

export interface Runners {
  group: THREE.Group;
  pfGroup: THREE.Group;
  figures: Figure[];
  /** Pose every runner for race time `raceT`; returns the footfalls of heavy runners since the last call. */
  update(raceT: number, showT: number, cam: THREE.Camera, pre: "idle" | "marks" | "set" | "race", focus?: number): Footfall[];
  /** Pose the photo-finish cut-outs (only) at race time t. */
  posePhoto(t: number): void;
  /** Screen anchor (top centre) of each runner, for name tags. */
  heads(): { lane: number; pos: THREE.Vector3; h: number }[];
  dispose(): void;
}

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function makeRunners(race: Race, figures: Figure[], masts: THREE.Vector3[], pool: Pool | null = null): Runners {
  const group = new THREE.Group();
  const pfGroup = new THREE.Group();
  for (const f of figures) { group.add(f.root); pfGroup.add(f.cut); }
  const blocks = startBlocks(race);
  blocks.group.traverse((o) => o.layers.set(LAYER.MAIN));
  group.add(blocks.group);
  const per = 1 + masts.length;
  const shadows = blobShadows(figures.length * per);
  shadows.mesh.layers.set(LAYER.MAIN);
  group.add(shadows.mesh);
  const dust = dustPuffs(140);
  group.add(dust.mesh);
  const streaks = speedStreaks(72);
  group.add(streaks.mesh);
  const camPos = new THREE.Vector3(), camRight = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const qLean = new THREE.Quaternion(), qRoll = new THREE.Quaternion(), axis = new THREE.Vector3(), mtx = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  const inv = new THREE.Matrix4(), dLoc = new THREE.Vector3(), upLoc = new THREE.Vector3(), S = new THREE.Vector3(), Zl = new THREE.Vector3(0, 0, 1), tmp = new THREE.Vector3();
  const headsOut: { lane: number; pos: THREE.Vector3; h: number }[] = figures.map((f) => ({ lane: f.lane.lane, pos: new THREE.Vector3(), h: f.lane.h }));
  const winner = race.order[0];
  // Gait phase at each runner's finish (fliers keep beating their wings after the line).
  const phaseAtLine = figures.map((f) => (Number.isFinite(f.lane.time) ? runnerAt(race, f.lane, f.lane.time).phase : 0));
  let lastShow = 0, lastRace = -1e9, frozen = 0;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  /** Screen rectangle (NDC) of a runner standing at a point, for the lane intros' framing. */
  const ndc = new THREE.Vector3();
  function rectOf(x: number, z: number, w: number, h: number, cam: THREE.Camera, right: THREE.Vector3): [number, number, number, number] | null {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [sx, sy] of [[-0.5, 0], [0.5, 0], [-0.5, 1], [0.5, 1]]) {
      ndc.set(x + right.x * w * sx, h * sy, z + right.z * w * sx).project(cam);
      if (ndc.z > 1) return null;
      x0 = Math.min(x0, ndc.x); x1 = Math.max(x1, ndc.x); y0 = Math.min(y0, ndc.y); y1 = Math.max(y1, ndc.y);
    }
    return [x0, y0, x1, y1];
  }

  function update(raceT: number, showT: number, cam: THREE.Camera, pre: "idle" | "marks" | "set" | "race", focus?: number): Footfall[] {
    const steps: Footfall[] = [];
    const hidden = new Set<number>();
    if (focus != null) {
      cam.updateMatrixWorld();
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
      const me = figures.find((f) => f.lane.lane === focus);
      if (me) {
        const p0 = runnerAt(race, me.lane, 0).point;
        const a = rectOf(p0.x, p0.z, me.lane.w, me.lane.h, cam, right);
        if (a) {
          const padX = (a[2] - a[0]) * 0.35, padY = (a[3] - a[1]) * 0.2;
          for (const f of figures) {
            if (f === me) continue;
            const p = runnerAt(race, f.lane, 0).point;
            const b = rectOf(p.x, p.z, f.lane.w, f.lane.h, cam, right);
            if (b && b[0] < a[2] + padX && b[2] > a[0] - padX && b[1] < a[3] + padY && b[3] > a[1] - padY) hidden.add(f.lane.lane);
          }
        }
      }
    }
    cam.getWorldPosition(camPos);
    camRight.setFromMatrixColumn(cam.matrixWorld, 0);
    const dtShow = Math.max(0, showT - lastShow);
    lastShow = showT;
    // After the race the clock stands still: the winner's celebration and the idle motion run on the show clock.
    if (raceT === lastRace && raceT > race.first) frozen += dtShow;
    else if (raceT !== lastRace) frozen = 0;
    lastRace = raceT;
    const swimmers: SwimmerState[] = [];
    streaks.begin();
    figures.forEach((f, i) => {
      const r = f.lane;
      const e = r.entrant;
      const st = runnerAt(race, r, raceT);
      const p = st.point;
      const swim = e.motion === "swim";
      const flier = e.motion === "fly" || e.motion === "hover";
      const since = raceT - r.time + (st.finished ? frozen : 0);
      // Fliers keep beating their wings after the line.
      const phase = st.finished && flier ? phaseAtLine[i] + since * r.profile.rateFinish : st.phase;
      const pose = poseFor(e.motion, { phase, v: st.v, a: st.a, h: r.h, hip: r.hip, distance: st.x, time: raceT > 0 ? raceT : showT });
      let lift = pose.lift, lean = pose.lean, squash = pose.squash, turn = 0;
      if (raceT <= 0) {
        const breath = Math.sin(showT * 2.1 + i * 1.7);
        squash = 0.012 * breath;
        if (e.motion === "run") {
          if (pre === "marks") { lean = 0.32; squash = -0.06; }
          if (pre === "set") { lean = 0.55; squash = -0.03; lift = 0.03 * r.h; }
        }
        if (e.motion === "hover") lift = pose.lift;
      }
      // The finish: a dip at the line.
      const dip = raceT > 0 && !flier && !swim ? dipAt(raceT, r.time) : 0;
      if (dip > 0.001) {
        if (e.motion === "run") lean += 0.5 * dip;
        else if (e.motion === "gallop" || e.motion === "scuttle") lean += 0.18 * dip;
      }
      // Standing after the race: breathing.
      if (st.finished && st.v < 0.4) squash += 0.012 * Math.sin(showT * 2.1 + i * 1.7) * smooth(0.4, 0, st.v);
      // The winner celebrates.
      let raise = 0;
      if (r === winner && st.finished && raceT > 0) {
        const c = celebrationAt(since);
        raise = c.raise;
        const hop = Math.min(1, Math.pow(60 / Math.max(1, e.kg), 0.12));
        if (swim) lift += c.jump * (0.5 * r.h + 0.4);
        else if (flier) lift += c.jump * 0.35 * r.h;
        else lift += c.jump * (0.18 + 0.12 * hop) * r.h;
        // Stretched in the air, braced on landing.
        squash += c.jump > 0.2 ? 0.05 * c.jump : c.raise * -0.04 * (1 - c.jump / 0.2) * (c.jump > 0 ? 1 : 0);
        turn = c.turn;
        lean = lean * (1 - c.raise) - 0.05 * c.raise;
      }
      const yBase = swim ? swimmerY(r.h) : 0;
      f.root.position.set(p.x, yBase + lift, p.z);
      f.root.visible = !hidden.has(r.lane);
      axis.set(p.dx, 0, p.dz).cross(up).normalize();
      qLean.setFromAxisAngle(axis, -(lean + pose.pitch));
      // On stubby feet the body rocks over each foot as it steps.
      if (f.stubby && raceT > 0) {
        qRoll.setFromAxisAngle(tmp.set(p.dx, 0, p.dz), swayAt({ motion: e.motion, phase: st.phase, v: st.v, hip: r.hip, time: showT }));
        qLean.multiply(qRoll);
      }
      f.lean.quaternion.copy(qLean);
      // Face the camera, turned a little towards the running direction; mirror so the head leads.
      const cx = camPos.x - p.x, cz = camPos.z - p.z;
      const cl = Math.hypot(cx, cz) || 1;
      let nx = cx / cl + p.dx * 0.32, nz = cz / cl + p.dz * 0.32;
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl; nz /= nl;
      if (swim) {
        // Side-on along its channel (the side the camera is on), turned towards the camera only as far as its water allows.
        let lx = -p.dz, lz = p.dx;
        if (lx * cx + lz * cz < 0) { lx = -lx; lz = -lz; }
        const a = Math.max(-f.turnMax, Math.min(f.turnMax, Math.atan2(lx * cz - lz * cx, lx * cx + lz * cz)));
        nx = lx * Math.cos(a) - lz * Math.sin(a);
        nz = lx * Math.sin(a) + lz * Math.cos(a);
      }
      f.yaw.rotation.y = Math.atan2(nx, nz) + turn;
      const side = p.dx * camRight.x + p.dz * camRight.z;
      if (side > 0.12) f.runsRight = true;
      else if (side < -0.12) f.runsRight = false;
      f.mirrored = f.runsRight === (f.facing < 0);
      const flap = pose.flap;
      // Tentacled swimmers pulse: contract and stretch with each stroke.
      const pulse = swim && swimStyle(e.shape) === "pulse" ? 0.07 * Math.sin(2 * Math.PI * phase) * Math.min(1, st.v / 1.5) : 0;
      squash += pulse;
      f.yaw.scale.set((f.mirrored ? -1 : 1) * flap * (1 - squash * 0.5), 1 + squash, 1 - squash * 0.5);
      f.spin.rotation.z = e.motion === "roll" ? pose.spin * (f.mirrored ? -1 : 1) : 0;
      f.uniforms.uWave.value = e.motion === "slither" ? 0.035 * Math.min(1, st.v / 2 + 0.25) : 0;
      f.uniforms.uWavePhase.value = (raceT > 0 ? st.phase : showT * 0.4) * Math.PI * 2 * (f.mirrored ? -1 : 1);

      // ---- Moving parts and the swimmer's wave, in the mesh's own frame.
      f.root.updateMatrixWorld(true);
      inv.copy(f.body.matrixWorld).invert();
      dLoc.set(p.dx, 0, p.dz).transformDirection(inv);
      upLoc.set(0, 1, 0).transformDirection(inv);
      S.crossVectors(dLoc, upLoc).normalize();
      // Strides stay mostly in the render's plane, where the relief is solid (swinging far out of it would pull a leg off the body).
      S.set(S.x * 0.45, S.y * 0.45, S.z).normalize();
      const clock = { motion: e.motion, phase: raceT > 0 ? phase : showT * 0.5, v: raceT > 0 ? st.v : 0, hip: r.hip, time: showT };
      const U = f.uniforms;
      f.joints.forEach((j, k) => {
        if (k >= MAX_PARTS) return;
        const out = Math.sign(j.tip[0] - j.pivot[0]) || (j.pivot[0] >= 0 ? 1 : -1);
        const part: LimbPart = { kind: j.kind, side: j.side, front: j.front, out, stub: j.stub, reach: j.reach };
        const ang = jointAngles(part, clock);
        const JA = U.uJA.value[k], JB = U.uJB.value[k], XA = U.uXA.value[k], XB = U.uXB.value[k];
        switch (j.kind) {
          case "leg":
            JA.set(j.pivot[0], j.pivot[1], j.pivot[2], ang.a);
            XA.set(S.x, S.y, S.z, 0);
            JB.set(j.knee[0], j.knee[1], j.knee[2], ang.b);
            XB.set(S.x, S.y, S.z, 0);
            break;
          case "arm": {
            // Arms swing back in the dip, and go up in the winner's celebration.
            const a = ang.a - 0.7 * dip;
            tmp.copy(S).multiplyScalar(1 - raise).addScaledVector(Zl, raise).normalize();
            JA.set(j.pivot[0], j.pivot[1], j.pivot[2], a * (1 - raise) + out * (1.25 + 0.12 * Math.sin(showT * 9)) * raise);
            XA.set(tmp.x, tmp.y, tmp.z, 0);
            JB.set(j.knee[0], j.knee[1], j.knee[2], ang.b * (1 - raise));
            XB.set(S.x, S.y, S.z, 0);
            break;
          }
          case "wing":
            JA.set(j.pivot[0], j.pivot[1], j.pivot[2], ang.a * (1 + 0.4 * raise));
            XA.set(0, 0, 1, 0);
            JB.set(j.knee[0], j.knee[1], j.knee[2], ang.b);
            XB.set(0, 0, 1, 1);
            break;
          case "tail":
            JA.set(j.pivot[0], j.pivot[1], j.pivot[2], ang.a + 0.35 * raise * Math.sin(showT * 11));
            XA.set(upLoc.x, upLoc.y, upLoc.z, 1);
            JB.set(j.pivot[0], j.pivot[1], j.pivot[2], ang.b);
            XB.set(0, 0, 1, 1);
            break;
        }
      });
      if (swim) {
        const style = swimStyle(e.shape);
        const go = Math.min(1, st.v / 1.2);
        // Tail-beat amplitude about a tenth of the body length (Bainbridge measured about a fifth, side to side).
        const amp = (style === "pulse" ? 0.02 : style === "anguilliform" ? 0.07 : 0.1) * (0.25 + 0.75 * go) * f.meshW;
        const lat = tmp.crossVectors(upLoc, dLoc).normalize();
        const headX = f.facing < 0 ? -f.meshW / 2 : f.meshW / 2;
        U.uSwim.value.set(amp, style === "anguilliform" ? 1.6 : 0.9, 2 * Math.PI * (raceT > 0 ? phase : showT * 0.6), style === "anguilliform" ? 2 : 1);
        U.uSwimAx.value.set(lat.x, lat.y, lat.z, headX);
        U.uSwimLen.value.set(-f.facing, f.meshW);
        swimmers.push({ x: p.x, z: p.z, dx: p.dx, dz: p.dz, v: st.v, len: Math.max(r.w, r.h), h: r.h, kg: e.kg, phase: raceT > 0 ? phase : 0 });
      } else U.uSwim.value.w = 0;

      headsOut[i].pos.set(p.x, yBase + lift + r.h * 1.02, p.z);
      // Footfalls: dust behind every grounded runner (scaled by weight), and the heavy ones for the sound and the camera.
      const step = Math.floor(st.phase);
      if (raceT > 0 && step !== f.lastStep && GROUNDED.has(e.motion) && st.v > 0.2 && !hidden.has(r.lane)) {
        if (e.kg >= 150) steps.push({ x: p.x, z: p.z, kg: e.kg });
        if (e.kg >= 20) {
          const n = Math.min(5, 1 + Math.floor(Math.log2(e.kg / 20)));
          const size = Math.min(2.2, 0.16 * Math.cbrt(e.kg / 20));
          for (let k = 0; k < n; k++) {
            const back = r.w * (0.15 + rnd() * 0.3);
            const sideOff = (rnd() - 0.5) * Math.min(1.1, r.w * 0.5);
            dust.spawn(p.x - p.dx * back - p.dz * sideOff, p.z - p.dz * back + p.dx * sideOff, size * (0.7 + rnd() * 0.6), showT, -p.dx * st.v * 0.18 * (0.5 + rnd()), -p.dz * st.v * 0.18 * (0.5 + rnd()), 0.9 + Math.min(1.4, e.kg / 600));
          }
        }
      }
      f.lastStep = step;
      // Speed streaks on the fastest.
      const fast = smooth(11, 17, st.v);
      if (fast > 0.02 && raceT > 0 && !hidden.has(r.lane)) {
        for (let k = 0; k < 6; k++) {
          const hy = yBase + lift + r.h * (0.12 + 0.8 * ((k * 0.618 + i * 0.37) % 1));
          const len = (0.6 + 0.9 * ((k * 0.43 + 0.2) % 1)) * st.v * 0.09 * (0.7 + 0.3 * Math.sin(showT * 23 + k));
          const off = r.w * 0.45 + len * 0.5 + ((k * 0.29) % 1) * 0.4;
          const lat = ((k * 0.71 + i * 0.13) % 1 - 0.5) * Math.min(1, r.w * 0.6);
          streaks.add(p.x - p.dx * off - p.dz * lat, hy, p.z - p.dz * off + p.dx * lat, p.dx, p.dz, len, 0.035 + 0.02 * r.h, 0.55 * fast, camPos);
        }
      }
      // Shadows: a core under the runner, and one away from each mast (none on the water).
      const fade = hidden.has(r.lane) || swim ? 0 : Math.max(0, 1 - lift / (r.h * 0.8 + 0.6));
      const w = Math.max(0.25, r.w * 0.55);
      const base = i * per;
      quat.identity();
      pos.set(p.x, 0.012, p.z);
      scl.set(w * 1.1, 1, Math.max(0.3, w * 0.75));
      mtx.compose(pos, quat, scl);
      shadows.mesh.setMatrixAt(base, mtx);
      shadows.mesh.instanceColor!.setXYZ(base, 0.55 * fade, 0, 0);
      masts.forEach((m, k) => {
        const dx = p.x - m.x, dz = p.z - m.z;
        const dh = Math.hypot(dx, dz);
        const ux = dx / dh, uz = dz / dh;
        const len = Math.max(0.3, ((r.h + lift) * dh) / m.y);
        const off = (lift * dh) / m.y + len / 2;
        pos.set(p.x + ux * off * 0.9, 0.011, p.z + uz * off * 0.9);
        quat.setFromAxisAngle(up, Math.atan2(ux, uz));
        scl.set(w * 0.85, 1, len * 1.05);
        mtx.compose(pos, quat, scl);
        shadows.mesh.setMatrixAt(base + 1 + k, mtx);
        shadows.mesh.instanceColor!.setXYZ(base + 1 + k, 0.2 * fade, 0, 0);
      });
    });
    streaks.end();
    shadows.mesh.instanceMatrix.needsUpdate = true;
    shadows.mesh.instanceColor!.needsUpdate = true;
    dust.update(showT, cam);
    pool?.update(showT, swimmers, cam);
    return steps;
  }

  function posePhoto(t: number) {
    for (const f of figures) {
      const st = runnerAt(race, f.lane, t);
      const pose = poseFor(f.lane.entrant.motion, { phase: st.phase, v: st.v, a: st.a, h: f.lane.h, hip: f.lane.hip, distance: st.x, time: t });
      f.cut.position.set(st.point.x, pose.lift + (f.lane.entrant.motion === "swim" ? swimmerY(f.lane.h) : 0), st.point.z);
      f.cut.updateMatrixWorld();
    }
  }

  return {
    group,
    pfGroup,
    figures,
    update,
    posePhoto,
    heads: () => headsOut,
    dispose() {
      figures.forEach((f) => f.dispose());
      blocks.dispose();
      shadows.dispose();
      dust.dispose();
      streaks.dispose();
    },
  };
}
