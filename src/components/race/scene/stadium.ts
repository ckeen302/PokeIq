import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BOWL, KERB_R, LANE_W, LANES, OUTER_R, RUN_OUT, START_100_X, X0, lanePoint, type Distance } from "@/lib/race/track";
import { ClockFace, glowTexture, laneNumbersTexture, ledBoardTexture, paintLineTexture, rng, streakTexture } from "./textures";

/**
 * PokéIQ Stadium, built by the page: a modern athletics stadium at night.
 *
 * - The floor: a regulation 400 m track in red polyurethane (Poly Haven's
 *   CC0 "Rubberized Track"), its lane lines drawn analytically in the
 *   shader (crisp at any distance), the home straight extended for the
 *   100 m start and the run-out, the infield's striped grass (Poly Haven's
 *   "Leafy Grass", shared with Sizes), the high jump fan in the west D.
 * - Painted marks: the finish line, the 100 m start line, the staggered
 *   200 m and 400 m starts and the lane numbers, as mip-mapped decals.
 * - The bowl: a superellipse of two tiers of seats with a lit concourse
 *   fascia between them, LED boards round the track, a roof ring with
 *   lamps along its inner edge, four floodlight masts with glowing banks,
 *   two giant video screens at the ends, the trackside clock and the
 *   photo-finish camera at the line.
 *
 * No sports event's marks: the stadium's own name is on the boards.
 */

export const LAYER = { BASE: 0, MAIN: 1, PF: 2, SCREEN: 3, CROWD: 4 } as const;


const sgnPow = (v: number, p: number) => Math.sign(v) * Math.pow(Math.abs(v), p);

/** A point on the bowl's barrier curve at angle θ, offset outward by d (m), with its outward normal. */
export function bowlPoint(theta: number, d = 0): { x: number; z: number; nx: number; nz: number } {
  const { A, B, N } = BOWL;
  const c = Math.cos(theta), s = Math.sin(theta);
  const x = A * sgnPow(c, 2 / N), z = B * sgnPow(s, 2 / N);
  let nx = (N / A) * sgnPow(x / A, N - 1), nz = (N / B) * sgnPow(z / B, N - 1);
  const l = Math.hypot(nx, nz) || 1;
  nx /= l;
  nz /= l;
  return { x: x + nx * d, z: z + nz * d, nx, nz };
}

/** The barrier curve sampled evenly by arc length (n points), offset by d. */
export function bowlRing(n: number, d = 0): { x: number; z: number; nx: number; nz: number; u: number }[] {
  const dense: { x: number; z: number; nx: number; nz: number }[] = [];
  const M = 4096;
  for (let i = 0; i < M; i++) dense.push(bowlPoint((i / M) * Math.PI * 2, d));
  const cum = [0];
  for (let i = 1; i <= M; i++) {
    const a = dense[i - 1], b = dense[i % M];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
  }
  const L = cum[M];
  const out: { x: number; z: number; nx: number; nz: number; u: number }[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = (i / n) * L;
    while (cum[j + 1] < s) j++;
    const f = (s - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
    const a = dense[j], b = dense[(j + 1) % M];
    const nx = a.nx + (b.nx - a.nx) * f, nz = a.nz + (b.nz - a.nz) * f;
    const l = Math.hypot(nx, nz) || 1;
    out.push({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, nx: nx / l, nz: nz / l, u: s });
  }
  return out;
}

/** Perimeter of the barrier curve offset by d (m). */
export function bowlLength(d = 0): number {
  const r = bowlRing(512, d);
  let L = 0;
  for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; L += Math.hypot(b.x - a.x, b.z - a.z); }
  return L;
}

/** Cross-section of the stands: [offset from the barrier (m), height (m), colour]. */
const PROFILE: [number, number, string][] = [
  [0, 0, "#141c2b"],
  [0, 1.25, "#141c2b"],
  [0.5, 1.25, "#2b3445"],
  [0.7, 1.9, "#1d2a44"],
  [21, 12.6, "#1d2a44"],
  [21, 13.1, "#3a4150"],
  [22.4, 13.1, "#3a4150"],
  [22.4, 15.1, "#0d0f14"],
  [23.6, 15.5, "#22304d"],
  [50, 34.4, "#22304d"],
  [50.3, 38, "#161a22"],
  [54, 38, "#161a22"],
];
export const TIERS = {
  lower: { d0: 0.9, d1: 20.6, y0: 1.9, y1: 12.6 },
  upper: { d0: 23.9, d1: 49.6, y0: 15.5, y1: 34.4 },
};
/** Seat colours in sections round the bowl (a mosaic like a real stadium's). */
const SEAT_SECTIONS = ["#18294a", "#14324a", "#4a1820", "#18294a", "#123a44", "#14324a"];

export interface QualityBits {
  /** Floodlight beams through the night haze. */
  beams: boolean;
  /** Screens show the live race (rendered into a texture). */
  liveScreens: boolean;
  anisotropy: number;
}

export interface StadiumUrls {
  tex(name: string, map: "diff" | "nor" | "rough"): string;
}

export interface Stadium {
  group: THREE.Group;
  /** World positions of the four mast heads (the shadows fall away from them). */
  masts: THREE.Vector3[];
  /** The screens' surfaces (their texture is set by the scene). */
  screens: THREE.Mesh[];
  screenMaterial: THREE.MeshBasicMaterial;
  clock: ClockFace;
  /** Lamp positions for halos (mast banks and the roof ring). */
  update(t: number, cam: THREE.Camera): void;
  setRace(distance: Distance): void;
  textures: THREE.Texture[];
  dispose(): void;
}

interface Built { geos: THREE.BufferGeometry[]; mats: THREE.Material[]; texs: THREE.Texture[] }

function track<T extends THREE.BufferGeometry>(b: Built, g: T): T { b.geos.push(g); return g; }
function mat<T extends THREE.Material>(b: Built, m: T): T { b.mats.push(m); return m; }

/** Shared world-position varying for shader patches. */
function withWorld(s: THREE.WebGLProgramParametersWithUniforms) {
  if (s.vertexShader.includes("vRaceWorld")) return;
  s.vertexShader = s.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vRaceWorld;")
    .replace("#include <project_vertex>", "#include <project_vertex>\nvec4 raceW = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nraceW = instanceMatrix * raceW;\n#endif\nvRaceWorld = (modelMatrix * raceW).xyz;");
  s.fragmentShader = s.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vRaceWorld;");
}

const GLSL_CONST = /* glsl */ `
  const float X0 = ${X0.toFixed(4)};
  const float KERB = ${KERB_R.toFixed(4)};
  const float LANE = ${LANE_W.toFixed(4)};
  const float OUTER = ${OUTER_R.toFixed(4)};
  const float RUNOUT = ${RUN_OUT.toFixed(2)};
  const float EXT_X0 = ${(START_100_X - 4.5).toFixed(2)};
`;

/** The floor: track, aprons, infield grass and the west D, with lane lines drawn in the shader. */
function buildFloor(b: Built, urls: StadiumUrls, aniso: number, loader: THREE.TextureLoader): THREE.Mesh {
  const W = 2 * BOWL.A + 20, D = 2 * BOWL.B + 20;
  const geo = track(b, new THREE.PlaneGeometry(W, D, 1, 1).rotateX(-Math.PI / 2));
  // UVs in metres / 2.5 (the track texture's tile).
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 2.5, -pos.getZ(i) / 2.5);
  const tex = (name: string, map: "diff" | "nor" | "rough") => {
    const t = loader.load(urls.tex(name, map));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    t.colorSpace = map === "diff" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    b.texs.push(t);
    return t;
  };
  const grass = tex("leafy_grass", "diff");
  const m = mat(b, new THREE.MeshStandardMaterial({ map: tex("rubberized_track", "diff"), normalMap: tex("rubberized_track", "nor"), roughnessMap: tex("rubberized_track", "rough"), normalScale: new THREE.Vector2(0.7, 0.7), roughness: 1, metalness: 0, envMapIntensity: 0.55 }));
  m.onBeforeCompile = (s) => {
    withWorld(s);
    s.uniforms.uGrass = { value: grass };
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform sampler2D uGrass;\n${GLSL_CONST}\nfloat raceHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat raceNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(raceHash(i), raceHash(i+vec2(1,0)), f.x), mix(raceHash(i+vec2(0,1)), raceHash(i+vec2(1,1)), f.x), f.y); }\nfloat raceLine(float d, float w, float aa){ return 1.0 - smoothstep(w - aa, w + aa, d); }\nfloat raceLines;\nfloat raceRegion;`)
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        {
          vec2 p = vRaceWorld.xz;
          float ax = abs(p.x);
          float across = ax <= X0 ? abs(p.y) - KERB : length(vec2(ax - X0, p.y)) - KERB;
          float trackW = 8.0 * LANE;
          bool ext = p.y > KERB - 0.02 && p.y < OUTER + 0.55 && p.x > EXT_X0 && p.x < X0 + RUNOUT;
          bool ring = across > -0.01 && across < trackW + 0.55;
          bool westD = p.x < -X0 && across < 0.0 && !ext;
          bool infield = across < 0.0 && !westD && !ext;
          // Tartan: a touch of large-scale variation, polished and darker where everyone runs (lanes 1 and 2).
          vec3 col = diffuseColor.rgb * vec3(1.08, 0.92, 0.9);
          float macro = raceNoise(p * 0.11) * 0.6 + raceNoise(p * 0.53) * 0.4;
          col *= mix(0.9, 1.06, macro);
          if (ring || ext) {
            float a2 = ext && ax > X0 ? p.y - KERB : across;
            col *= mix(0.9, 1.0, smoothstep(0.0, 2.4, a2));
          }
          raceRegion = 0.0;
          if (infield) {
            vec3 g = texture2D(uGrass, vMapUv * (2.5 / 3.2)).rgb;
            float gl = dot(g, vec3(0.3, 0.59, 0.11));
            g = mix(vec3(gl), g, 1.35) * vec3(0.55, 0.78, 0.42);
            float stripe = step(0.5, fract((p.x + 3.0) / 8.0));
            g *= mix(0.72, 1.0, stripe) * mix(0.9, 1.05, macro);
            col = g;
            raceRegion = 1.0;
          } else if (!ring && !ext && !westD) {
            // Apron outside the track: the same surface, duller.
            float l = dot(col, vec3(0.299, 0.587, 0.114));
            col = mix(vec3(l), col, 0.72) * 0.72;
          }
          // Lane lines: the oval's (lines 1–8 out from the kerb) and the straight extension's.
          float aa = max(fwidth(across), 0.002) * 1.2;
          float k = across / LANE;
          float d1 = abs(fract(k + 0.5) - 0.5) * LANE;
          float l1 = raceLine(d1, 0.025, aa) * step(0.5, k) * step(k, 8.5) * (ring ? 1.0 : 0.0);
          float ah = p.y - KERB;
          float kh = ah / LANE;
          float aah = max(fwidth(ah), 0.002) * 1.2;
          float d2 = abs(fract(kh + 0.5) - 0.5) * LANE;
          float l2 = raceLine(d2, 0.025, aah) * step(-0.5, kh) * step(kh, 8.5) * ((ext && ax > X0 - 0.01) ? 1.0 : 0.0);
          raceLines = max(l1, l2);
          col = mix(col, vec3(0.93, 0.93, 0.9), raceLines);
          diffuseColor.rgb = col;
        }`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = raceRegion > 0.5 ? 0.92 : mix(clamp(roughnessFactor * 0.9 + 0.08, 0.45, 0.9), 0.5, raceLines);`
      );
  };
  m.customProgramCacheKey = () => "race-floor";
  const mesh = new THREE.Mesh(geo, m);
  mesh.receiveShadow = true;
  return mesh;
}

/** The raised kerb on the inside of lane 1 (white aluminium, 5 cm). */
function buildKerb(b: Built): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  const seg = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const g = new THREE.BoxGeometry(len, 0.05, 0.05);
    g.rotateY(-Math.atan2(z1 - z0, x1 - x0));
    g.translate((x0 + x1) / 2, 0.025, (z0 + z1) / 2);
    parts.push(g);
  };
  const r = KERB_R - 0.025;
  for (const side of [1, -1]) seg(-X0, side * r, X0, side * r);
  for (const cx of [X0, -X0]) {
    const n = 64;
    for (let i = 0; i < n; i++) {
      const a0 = -Math.PI / 2 + (i / n) * Math.PI, a1 = -Math.PI / 2 + ((i + 1) / n) * Math.PI;
      const s = cx > 0 ? 1 : -1;
      seg(cx + s * r * Math.cos(a0), r * Math.sin(a0), cx + s * r * Math.cos(a1), r * Math.sin(a1));
    }
  }
  const geo = track(b, mergeGeometries(parts));
  parts.forEach((p) => p.dispose());
  return new THREE.Mesh(geo, mat(b, new THREE.MeshStandardMaterial({ color: "#e9edf2", roughness: 0.35, metalness: 0.4 })));
}

/** Painted marks: finish line, start lines (100 m, staggered 200 m and 400 m) and lane numbers. */
function buildMarks(b: Built, font: string): THREE.Group {
  const g = new THREE.Group();
  const line = paintLineTexture();
  b.texs.push(line);
  const quads: THREE.BufferGeometry[] = [];
  /** A painted line across a lane at a track point (width 0.4 m quad, the texture's line is 5 cm). */
  const across = (x: number, z: number, dx: number, dz: number, lane: number, w = 0.4) => {
    const q = new THREE.PlaneGeometry(w, LANE_W - 0.05).rotateX(-Math.PI / 2);
    q.rotateY(Math.atan2(-dz, dx));
    // Centre on the lane's middle.
    void lane;
    q.translate(x, 0.004, z);
    quads.push(q);
  };
  for (let lane = 1; lane <= LANES; lane++) {
    for (const d of [100, 200, 400] as Distance[]) {
      const p = lanePoint(lane, d, 0);
      across(p.x, p.z, p.dx, p.dz, lane);
    }
    // The finish line (one quad per lane keeps the mesh simple).
    across(X0, KERB_R + LANE_W * (lane - 0.5), 1, 0, lane, 0.4);
  }
  const lines = new THREE.Mesh(track(b, mergeGeometries(quads)), mat(b, new THREE.MeshBasicMaterial({ map: line, transparent: true, depthWrite: false, color: "#f2f2ee", polygonOffset: true, polygonOffsetFactor: -2 })));
  quads.forEach((q) => q.dispose());
  g.add(lines);
  // Lane numbers just past the line (for the cameras) and at the 100 m start.
  const numTex = laneNumbersTexture(font);
  b.texs.push(numTex);
  const numMat = mat(b, new THREE.MeshBasicMaterial({ map: numTex, transparent: true, depthWrite: false, color: "#f4f4f0", polygonOffset: true, polygonOffsetFactor: -2 }));
  const nums: THREE.BufferGeometry[] = [];
  for (let lane = 1; lane <= LANES; lane++) {
    for (const [x, flip] of [[X0 + 2.2, true], [START_100_X - 2.0, false]] as [number, boolean][]) {
      const q = new THREE.PlaneGeometry(1.0, 1.1).rotateX(-Math.PI / 2);
      // Read from the main stand (+z) for the finish; from the start for the 100 m.
      q.rotateY(flip ? Math.PI / 2 : -Math.PI / 2);
      q.translate(x, 0.005, KERB_R + LANE_W * (lane - 0.5));
      const uv = q.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, (lane - 1) / 8 + uv.getX(i) / 8);
      nums.push(q);
    }
  }
  g.add(new THREE.Mesh(track(b, mergeGeometries(nums)), numMat));
  nums.forEach((q) => q.dispose());
  return g;
}

/** Long jump pit, high jump mat and standards: the infield's field-event furniture. */
function buildFieldEvents(b: Built): THREE.Group {
  const g = new THREE.Group();
  const sand = mat(b, new THREE.MeshStandardMaterial({ color: "#c8a46a", roughness: 1 }));
  const mat2 = mat(b, new THREE.MeshStandardMaterial({ color: "#1f5fbf", roughness: 0.8 }));
  const white = mat(b, new THREE.MeshStandardMaterial({ color: "#f0f0f0", roughness: 0.5 }));
  const pit = new THREE.Mesh(track(b, new THREE.BoxGeometry(9, 0.06, 2.9)), sand);
  pit.position.set(14, 0.02, -(KERB_R - 7.5));
  g.add(pit);
  const mattress = new THREE.Mesh(track(b, new THREE.BoxGeometry(6, 0.7, 4)), mat2);
  mattress.position.set(-X0 - 20, 0.35, 0);
  g.add(mattress);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(track(b, new THREE.CylinderGeometry(0.03, 0.03, 2.6, 8)), white);
    post.position.set(-X0 - 17.6, 1.3, s * 2.1);
    g.add(post);
  }
  const bar = new THREE.Mesh(track(b, new THREE.CylinderGeometry(0.015, 0.015, 4.2, 6)).rotateX(Math.PI / 2), mat(b, new THREE.MeshStandardMaterial({ color: "#f2c230", roughness: 0.5 })));
  bar.position.set(-X0 - 17.6, 2.05, 0);
  g.add(bar);
  return g;
}

/** Extrudes the stands' cross-section round the bowl, coloured per vertex. */
function buildBowl(b: Built): THREE.Mesh {
  const N = 220;
  const rings = PROFILE.map(([d]) => bowlRing(N, d));
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const c = new THREE.Color();
  // Flat-shaded quads: each profile segment × each slice gets its own 4 vertices.
  for (let j = 0; j < PROFILE.length - 1; j++) {
    const [, y0, hex] = PROFILE[j];
    const [, y1] = PROFILE[j + 1];
    const seats = j === 3 || j === 8;
    for (let i = 0; i < N; i++) {
      const a0 = rings[j][i], a1 = rings[j][(i + 1) % N], b0 = rings[j + 1][i], b1 = rings[j + 1][(i + 1) % N];
      const base = pos.length / 3;
      pos.push(a0.x, y0, a0.z, a1.x, y0, a1.z, b1.x, y1, b1.z, b0.x, y1, b0.z);
      if (seats) {
        const sec = Math.floor((i / N) * 72);
        c.set(SEAT_SECTIONS[sec % SEAT_SECTIONS.length]);
        if (j === 8) c.multiplyScalar(0.85);
      } else c.set(hex);
      for (let k = 0; k < 4; k++) col.push(c.r, c.g, c.b);
      idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }
  const geo = track(b, new THREE.BufferGeometry());
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = mat(b, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  return new THREE.Mesh(geo, m);
}

/** The roof ring: a cantilever from above the back wall to over the lower tier, with lamps along its inner edge. */
function buildRoof(b: Built): { mesh: THREE.Group; lamps: THREE.Vector3[] } {
  const N = 220;
  const inner = bowlRing(N, 13), outer = bowlRing(N, 58);
  const g = new THREE.Group();
  const topPos: number[] = [], botPos: number[] = [], edgePos: number[] = [];
  const idx: number[] = [], idxE: number[] = [];
  const yIn = 46.5, yOut = 43.5, th = 2.4;
  for (let i = 0; i < N; i++) {
    const a = inner[i], o = outer[i];
    topPos.push(a.x, yIn, a.z, o.x, yOut, o.z);
    botPos.push(a.x, yIn - th, a.z, o.x, yOut - 1, o.z);
    edgePos.push(a.x, yIn, a.z, a.x, yIn - th, a.z);
    const n = (i + 1) % N;
    idx.push(i * 2, n * 2, i * 2 + 1, n * 2, n * 2 + 1, i * 2 + 1);
    idxE.push(i * 2, i * 2 + 1, n * 2, n * 2, i * 2 + 1, n * 2 + 1);
  }
  const mk = (p: number[], ix: number[], color: string, side: THREE.Side, emissive = "#000000") => {
    const geo = track(b, new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    geo.setIndex(ix);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, mat(b, new THREE.MeshLambertMaterial({ color, side, emissive })));
  };
  g.add(mk(topPos, idx, "#2c3340", THREE.DoubleSide));
  g.add(mk(botPos, idx, "#1a2030", THREE.DoubleSide, "#06080d"));
  g.add(mk(edgePos, idxE, "#e8ecf2", THREE.DoubleSide, "#141820"));
  // Support trusses: a rib every few slices from the back wall to the inner edge (dark lines on the underside).
  const ribs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < N; i += 5) {
    const a = inner[i], o = outer[i];
    const len = Math.hypot(o.x - a.x, o.z - a.z, yOut - yIn);
    const rib = new THREE.BoxGeometry(0.5, 1.4, len);
    rib.lookAt(new THREE.Vector3(o.x - a.x, yOut - yIn, o.z - a.z));
    rib.translate((a.x + o.x) / 2, (yIn + yOut) / 2 - th - 0.4, (a.z + o.z) / 2);
    ribs.push(rib);
  }
  for (let i = 0; i < N; i += 10) {
    const a = inner[i], o = outer[i];
    const len = Math.hypot(o.x - a.x, o.z - a.z, yOut - yIn);
    const rib = new THREE.BoxGeometry(0.8, 0.5, len);
    rib.lookAt(new THREE.Vector3(o.x - a.x, yOut - yIn, o.z - a.z));
    rib.translate((a.x + o.x) / 2, (yIn + yOut) / 2 + 0.3, (a.z + o.z) / 2);
    ribs.push(rib);
  }
  const ribGeo = track(b, mergeGeometries(ribs));
  ribs.forEach((r) => r.dispose());
  g.add(new THREE.Mesh(ribGeo, mat(b, new THREE.MeshLambertMaterial({ color: "#0d1119" }))));
  const lamps: THREE.Vector3[] = [];
  const ring = bowlRing(150, 14);
  for (const p of ring) lamps.push(new THREE.Vector3(p.x, yIn - th - 0.3, p.z));
  return { mesh: g, lamps };
}

/** Four floodlight masts behind the stands, their banks aimed at the field. */
function buildMasts(b: Built): { group: THREE.Group; heads: THREE.Vector3[]; lamps: THREE.Vector3[]; normals: THREE.Vector3[] } {
  const g = new THREE.Group();
  const steel = mat(b, new THREE.MeshLambertMaterial({ color: "#2a2f38" }));
  const frame = mat(b, new THREE.MeshLambertMaterial({ color: "#1b1f27" }));
  const heads: THREE.Vector3[] = [], lamps: THREE.Vector3[] = [], normals: THREE.Vector3[] = [];
  for (const ang of [0.62, Math.PI - 0.62, Math.PI + 0.62, -0.62]) {
    const p = bowlPoint(ang, 64);
    const H = 74;
    const mast = new THREE.Mesh(track(b, new THREE.CylinderGeometry(0.9, 1.8, H, 10)), steel);
    mast.position.set(p.x, H / 2, p.z);
    g.add(mast);
    const head = new THREE.Vector3(p.x, H + 4, p.z);
    heads.push(head);
    // The bank faces the field centre, tilted down.
    const toC = new THREE.Vector3(-p.x, -H * 0.9, -p.z).normalize();
    const bank = new THREE.Group();
    bank.position.copy(head);
    bank.lookAt(head.clone().add(toC));
    const box = new THREE.Mesh(track(b, new THREE.BoxGeometry(17, 9, 1.2)), frame);
    box.position.z = -0.7;
    bank.add(box);
    g.add(bank);
    bank.updateMatrixWorld(true);
    for (let r = 0; r < 4; r++) {
      for (let cI = 0; cI < 8; cI++) {
        const lp = new THREE.Vector3(-7.4 + cI * 2.1, -3.3 + r * 2.2, 0.05).applyMatrix4(bank.matrixWorld);
        lamps.push(lp);
        normals.push(toC.clone());
      }
    }
  }
  return { group: g, heads, lamps, normals };
}

/** LED boards round the track and the ribbon on the tier fascia (one scrolling texture). */
function buildBoards(b: Built, font: string): { group: THREE.Group; material: THREE.MeshBasicMaterial; fascia: THREE.MeshBasicMaterial } {
  const tex = ledBoardTexture(font);
  b.texs.push(tex);
  const g = new THREE.Group();
  const strip = (d: number, y0: number, y1: number, panelLen: number, tilt: number) => {
    const N = 400;
    const ring = bowlRing(N, d);
    const L = bowlLength(d);
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= N; i++) {
      const p = ring[i % N];
      const u = (i === N ? L : p.u) / panelLen;
      pos.push(p.x + p.nx * tilt, y0, p.z + p.nz * tilt, p.x, y1, p.z);
      uv.push(u, 0, u, 1);
      if (i < N) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 2, i * 2 + 3, i * 2 + 1);
    }
    const geo = track(b, new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    return geo;
  };
  const m = mat(b, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, color: new THREE.Color(1.25, 1.25, 1.25), toneMapped: false }));
  const fascia = mat(b, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, color: new THREE.Color(1.6, 1.6, 1.6), toneMapped: false }));
  // The screens face the field; from behind (a camera in the stands) a board is just its dark casing.
  for (const mm of [m, fascia]) {
    mm.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", "#include <map_fragment>\n  if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.012, 0.014, 0.02);");
    };
    mm.customProgramCacheKey = () => "race-board";
  }
  // Track-side boards: 1 m tall, leaning back a little, on the apron.
  g.add(new THREE.Mesh(strip(-1.6, 0.05, 1.0, 64, -0.25), m));
  // The fascia between the tiers.
  const f = new THREE.Mesh(strip(22.35, 13.25, 14.95, 120, 0), fascia);
  g.add(f);
  return { group: g, material: m, fascia };
}

/** Lamp halos and lens streaks: instanced, additive, facing the camera. */
function buildHalos(b: Built, points: { p: THREE.Vector3; size: number; streak: boolean; color: THREE.Color }[]): { mesh: THREE.InstancedMesh; streaks: THREE.InstancedMesh | null; update(cam: THREE.Camera, t: number): void } {
  const glow = glowTexture(), streak = streakTexture();
  b.texs.push(glow, streak);
  const geo = track(b, new THREE.PlaneGeometry(1, 1));
  const m = mat(b, new THREE.MeshBasicMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, fog: false }));
  const mesh = new THREE.InstancedMesh(geo, m, points.length);
  points.forEach((pt, i) => mesh.setColorAt(i, pt.color));
  mesh.frustumCulled = false;
  const sPts = points.filter((p) => p.streak);
  let streaks: THREE.InstancedMesh | null = null;
  if (sPts.length) {
    const sm = mat(b, new THREE.MeshBasicMaterial({ map: streak, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, fog: false, color: new THREE.Color(0.55, 0.62, 0.9) }));
    streaks = new THREE.InstancedMesh(geo, sm, sPts.length);
    streaks.frustumCulled = false;
  }
  const q = new THREE.Quaternion(), s = new THREE.Vector3(), mtx = new THREE.Matrix4(), camPos = new THREE.Vector3();
  return {
    mesh,
    streaks,
    update(cam, t) {
      cam.getWorldQuaternion(q);
      cam.getWorldPosition(camPos);
      points.forEach((pt, i) => {
        const d = camPos.distanceTo(pt.p);
        // Halos keep a minimum size on screen (they read as glare far away).
        const k = pt.size * Math.max(1, d / 140) * (1 + 0.04 * Math.sin(t * 3 + i));
        s.set(k, k, k);
        mtx.compose(pt.p, q, s);
        mesh.setMatrixAt(i, mtx);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (streaks) {
        sPts.forEach((pt, i) => {
          const d = camPos.distanceTo(pt.p);
          const k = pt.size * Math.max(1, d / 140);
          s.set(k * 9, k * 0.5, 1);
          mtx.compose(pt.p, q, s);
          streaks!.setMatrixAt(i, mtx);
        });
        streaks.instanceMatrix.needsUpdate = true;
      }
    },
  };
}

/** Light beams through the haze: additive cones from each mast bank towards the field. */
function buildBeams(b: Built, heads: THREE.Vector3[]): THREE.Group {
  const g = new THREE.Group();
  const m = mat(b, new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(0.55, 0.62, 0.8) } },
    vertexShader: /* glsl */ `varying float vT; varying vec3 vN; varying vec3 vV;
      void main(){ vT = uv.y; vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `uniform vec3 uColor; varying float vT; varying vec3 vN; varying vec3 vV;
      void main(){ float edge = pow(abs(dot(vN, vV)), 1.5); float a = vT * vT * 0.016 * edge; gl_FragColor = vec4(uColor * a, a); }`,
  }));
  for (const h of heads) {
    const target = new THREE.Vector3(h.x * 0.12, 0, h.z * 0.12);
    const len = h.distanceTo(target);
    const geo = track(b, new THREE.CylinderGeometry(9, 26, len, 24, 1, true));
    geo.translate(0, -len / 2, 0);
    const cone = new THREE.Mesh(geo, m);
    cone.position.copy(h);
    cone.lookAt(target);
    cone.rotateX(-Math.PI / 2);
    g.add(cone);
  }
  return g;
}

/** Two giant screens at the ends of the bowl, facing the field. */
function buildScreens(b: Built): { group: THREE.Group; screens: THREE.Mesh[]; material: THREE.MeshBasicMaterial } {
  const g = new THREE.Group();
  const frame = mat(b, new THREE.MeshLambertMaterial({ color: "#0b0d12" }));
  const sm = mat(b, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.15, 1.15, 1.15), toneMapped: false }));
  const screens: THREE.Mesh[] = [];
  for (const ang of [0, Math.PI]) {
    const p = bowlPoint(ang, 30);
    const W = 26, H = W * 9 / 16;
    const holder = new THREE.Group();
    holder.position.set(p.x, 33, p.z);
    holder.lookAt(0, 22, 0);
    const box = new THREE.Mesh(track(b, new THREE.BoxGeometry(W + 1.2, H + 1.2, 1.4)), frame);
    box.position.z = -0.75;
    holder.add(box);
    const scr = new THREE.Mesh(track(b, new THREE.PlaneGeometry(W, H)), sm);
    scr.position.z = 0.02;
    scr.layers.set(LAYER.SCREEN);
    holder.add(scr);
    screens.push(scr);
    // Legs down to the upper tier.
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(track(b, new THREE.BoxGeometry(0.8, 14, 0.8)), frame);
      leg.position.set(s * W * 0.35, -H / 2 - 7, -0.8);
      holder.add(leg);
    }
    g.add(holder);
  }
  return { group: g, screens, material: sm };
}

/** The trackside clock past the finish line, and the photo-finish camera on its post at the line. */
function buildLineFurniture(b: Built, font: string): { group: THREE.Group; clock: ClockFace } {
  const g = new THREE.Group();
  const dark = mat(b, new THREE.MeshStandardMaterial({ color: "#14161b", roughness: 0.6, metalness: 0.3 }));
  const clock = new ClockFace(font);
  b.texs.push(clock.texture);
  const face = mat(b, new THREE.MeshBasicMaterial({ map: clock.texture, toneMapped: false, color: new THREE.Color(1.4, 1.4, 1.4) }));
  const board = new THREE.Group();
  board.position.set(X0 + 4.2, 0, KERB_R - 2.4);
  board.rotation.y = -0.35;
  const post = new THREE.Mesh(track(b, new THREE.BoxGeometry(0.12, 1.3, 0.12)), dark);
  post.position.y = 0.65;
  board.add(post);
  const box = new THREE.Mesh(track(b, new THREE.BoxGeometry(2.3, 0.78, 0.18)), dark);
  box.position.y = 1.62;
  board.add(box);
  const scr = new THREE.Mesh(track(b, new THREE.PlaneGeometry(2.16, 0.675)), face);
  scr.position.set(0, 1.62, 0.095);
  board.add(scr);
  g.add(board);
  // Photo-finish camera: a post at the line outside lane 8, lens along the line.
  const cam = new THREE.Group();
  cam.position.set(X0, 0, OUTER_R + 8);
  const pole = new THREE.Mesh(track(b, new THREE.CylinderGeometry(0.06, 0.08, 4.4, 8)), dark);
  pole.position.y = 2.2;
  cam.add(pole);
  const body = new THREE.Mesh(track(b, new THREE.BoxGeometry(0.34, 0.3, 0.6)), mat(b, new THREE.MeshStandardMaterial({ color: "#d9dde3", roughness: 0.4, metalness: 0.2 })));
  body.position.set(0, 4.55, 0);
  cam.add(body);
  const lens = new THREE.Mesh(track(b, new THREE.CylinderGeometry(0.09, 0.09, 0.3, 12)).rotateX(Math.PI / 2), dark);
  lens.position.set(0, 4.55, -0.42);
  cam.add(lens);
  const led = new THREE.Mesh(track(b, new THREE.SphereGeometry(0.035, 8, 6)), mat(b, new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.2, 0.15), toneMapped: false })));
  led.position.set(0.12, 4.73, -0.1);
  cam.add(led);
  g.add(cam);
  // Timing posts at each end of the line.
  for (const z of [KERB_R - 0.35, OUTER_R + 0.35]) {
    const tp = new THREE.Mesh(track(b, new THREE.BoxGeometry(0.06, 0.85, 0.06)), mat(b, new THREE.MeshStandardMaterial({ color: "#e8e8e8", roughness: 0.5 })));
    tp.position.set(X0 + 0.04, 0.425, z);
    g.add(tp);
  }
  return { group: g, clock };
}

/** The city around the stadium at night: dark ground to the horizon, scattered with lights. */
function buildSurroundings(b: Built): THREE.Group {
  const g = new THREE.Group();
  const ground = new THREE.Mesh(track(b, new THREE.RingGeometry(140, 3200, 64, 1).rotateX(-Math.PI / 2)), mat(b, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.006, 0.007, 0.01) })));
  ground.position.y = -0.3;
  g.add(ground);
  const r = rng(99);
  const pos: number[] = [], col: number[] = [];
  const palette = [[1, 0.78, 0.45], [1, 0.9, 0.7], [0.75, 0.85, 1], [1, 0.6, 0.35]];
  for (let i = 0; i < 2600; i++) {
    const a = r() * Math.PI * 2;
    const d = 220 + Math.pow(r(), 0.6) * 2600;
    pos.push(Math.cos(a) * d, r() < 0.08 ? 4 + r() * 40 : 0.5, Math.sin(a) * d);
    const c = palette[Math.floor(r() * palette.length)];
    const k = 0.5 + r() * 1.6;
    col.push(c[0] * k, c[1] * k, c[2] * k);
  }
  const geo = track(b, new THREE.BufferGeometry());
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  const lights = new THREE.Points(geo, mat(b, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, toneMapped: false, fog: false })));
  g.add(lights);
  g.traverse((o) => o.layers.set(LAYER.MAIN));
  return g;
}

/** Sky: night, with a faint glow over the bowl from the floodlights in the haze. */
function buildSky(b: Built): THREE.Mesh {
  const m = mat(b, new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }`,
    fragmentShader: /* glsl */ `varying vec3 vDir;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main(){
        float y = vDir.y;
        vec3 zen = vec3(0.004, 0.007, 0.018);
        vec3 hor = vec3(0.022, 0.026, 0.042);
        vec3 c = mix(hor, zen, smoothstep(-0.05, 0.6, y));
        // Light dome over the stadium.
        c += vec3(0.035, 0.035, 0.05) * exp(-max(y, 0.0) * 6.0);
        // A few stars.
        vec3 q = floor(vDir * 420.0);
        float s = step(0.9985, h(q)) * smoothstep(0.15, 0.6, y);
        c += vec3(s) * 0.5;
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  const sky = new THREE.Mesh(track(b, new THREE.SphereGeometry(4000, 32, 16)), m);
  sky.layers.set(LAYER.MAIN);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  return sky;
}

export function buildStadium(opts: { urls: StadiumUrls; font: string; q: QualityBits; upload?: (t: THREE.Texture) => void }): Stadium {
  const b: Built = { geos: [], mats: [], texs: [] };
  const loader = new THREE.TextureLoader();
  const load = loader.load.bind(loader);
  // Upload each texture as soon as it decodes, not on the frame that first draws it.
  loader.load = ((url: string, onLoad?: (t: THREE.Texture) => void) => load(url, (t) => { opts.upload?.(t); onLoad?.(t); })) as typeof loader.load;
  const group = new THREE.Group();
  const floor = buildFloor(b, opts.urls, opts.q.anisotropy, loader);
  group.add(floor);
  group.add(buildKerb(b));
  group.add(buildMarks(b, opts.font));
  group.add(buildFieldEvents(b));
  group.add(buildBowl(b));
  const roof = buildRoof(b);
  group.add(roof.mesh);
  const masts = buildMasts(b);
  group.add(masts.group);
  const boards = buildBoards(b, opts.font);
  group.add(boards.group);
  const scr = buildScreens(b);
  group.add(scr.group);
  const line = buildLineFurniture(b, opts.font);
  // The timing posts and the camera prop stand on the line itself: keep them out of the slit's view.
  line.group.traverse((o) => o.layers.set(LAYER.MAIN));
  group.add(line.group);
  group.add(buildSky(b));
  group.add(buildSurroundings(b));
  // Lamps: the masts' banks (bright, with streaks on the nearest) and the roof ring.
  const r = rng(7);
  const lampPts = [
    ...masts.lamps.map((p, i) => ({ p, size: 3.4 + r() * 0.8, streak: i % 8 === 3, color: new THREE.Color(1.0, 0.97, 0.9).multiplyScalar(0.9) })),
    ...roof.lamps.map((p) => ({ p, size: 2.6, streak: false, color: new THREE.Color(0.9, 0.93, 1.0).multiplyScalar(0.5) })),
  ];
  const halos = buildHalos(b, lampPts);
  halos.mesh.layers.set(LAYER.MAIN);
  group.add(halos.mesh);
  if (halos.streaks) { halos.streaks.layers.set(LAYER.MAIN); group.add(halos.streaks); }
  // Lamp faces: small bright discs (they bloom).
  const faceGeo = track(b, new THREE.CircleGeometry(0.55, 10));
  const faceMat = mat(b, new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.8, 5.2), toneMapped: false, side: THREE.DoubleSide }));
  const faces = new THREE.InstancedMesh(faceGeo, faceMat, masts.lamps.length + roof.lamps.length);
  const tmp = new THREE.Object3D();
  [...masts.lamps.map((p, i) => [p, masts.normals[i]] as const), ...roof.lamps.map((p) => [p, new THREE.Vector3(-p.x, -40, -p.z).normalize()] as const)].forEach(([p, n], i) => {
    tmp.position.copy(p);
    tmp.lookAt(p.clone().add(n));
    tmp.scale.setScalar(i < masts.lamps.length ? 1 : 0.7);
    tmp.updateMatrix();
    faces.setMatrixAt(i, tmp.matrix);
  });
  faces.layers.set(LAYER.MAIN);
  group.add(faces);
  if (opts.q.beams) {
    const beams = buildBeams(b, masts.heads);
    beams.traverse((o) => o.layers.set(LAYER.MAIN));
    group.add(beams);
  }
  return {
    group,
    masts: masts.heads,
    screens: scr.screens,
    screenMaterial: scr.material,
    clock: line.clock,
    textures: b.texs,
    update(t, cam) {
      halos.update(cam, t);
      if (boards.material.map) boards.material.map.offset.x = (t * 0.035) % 1;
    },
    setRace() {
      // Marks for every distance are painted; nothing to change per race yet.
    },
    dispose() {
      b.geos.forEach((g) => g.dispose());
      b.mats.forEach((m) => m.dispose());
      b.texs.forEach((t) => t.dispose());
    },
  };
}
