import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { POOL, poolLaneZ } from "@/lib/games/venues";
import { buildCrowd, type Crowd } from "@/components/race/scene/crowd";
import { rng } from "@/components/race/scene/textures";
import type { Props } from "../../show/types";

/**
 * The aquatics centre of the PokéIQ Games: a 50 m pool, ten 2.5 m lanes
 * (racing in 1–8), 3 m deep, in a bright hall:
 *
 * - the water: a shader with moving swell, the swimmers' bow waves and V
 *   wakes, foam where they kick, rain rings when the roof is open (the
 *   Swift Swim toggle), a Fresnel reflection of the hall's ceiling and its
 *   light panels, and the tiled pool seen through it;
 * - the pool's tiles and lane lines lit by caustics (a moving web of light
 *   from two layers of cellular noise);
 * - lane ropes of floats (red for the last 5 m, a marker at 15 m), the
 *   backstroke flags 5 m from each wall, starting blocks and touchpads;
 * - stands on both long sides with the Race's crowd, a video board.
 *
 * The scene passes the swimmers' positions and speeds each frame
 * (setProps), so the wakes follow the race exactly.
 */

export interface PoolWorld {
  group: THREE.Group;
  env: THREE.Texture;
  fog: THREE.FogExp2;
  update(t: number, cam: THREE.Camera, excitement: number): void;
  setProps(p: Props, t: number, cam: THREE.Camera): void;
  dispose(): void;
}

const MAX_SWIMMERS = 8;
const CAUSTICS = /* glsl */ `
  vec2 poolHash2(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
  // Distance to the nearest edge of a moving cellular (Worley) pattern: small along the cell walls.
  float poolCells(vec2 p, float t) {
    vec2 i = floor(p), f = fract(p);
    float d1 = 8.0, d2 = 8.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = poolHash2(i + g);
      o = 0.5 + 0.42 * sin(t + 6.2831 * o);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
    return sqrt(d2) - sqrt(d1);
  }
  // Caustics: the thin bright web where two drifting layers' cell walls cross.
  float poolCaustics(vec2 p, float t) {
    float a = poolCells(p * 0.85, t * 0.7);
    float b = poolCells(p * 1.21 + vec2(7.3, 2.1), -t * 0.55);
    return exp(-a * 7.0) * 0.6 + exp(-b * 8.0) * 0.5 + exp(-min(a, b) * 14.0) * 0.6;
  }
`;

export function buildAquatics(o: { renderer: THREE.WebGLRenderer; font: string; occupancy: number; flashes: number; aniso: number; quality: "low" | "high" }): PoolWorld {
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  const G = <X extends THREE.BufferGeometry>(g: X) => { geos.push(g); return g; };
  const M = <X extends THREE.Material>(m: X) => { mats.push(m); return m; };
  const T = <X extends THREE.Texture>(t: X) => { t.anisotropy = o.aniso; texs.push(t); return t; };
  const canvas = (w: number, h: number) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d")!] as const; };
  const r = rng(91);
  const L = POOL.length, Wd = POOL.width, D = POOL.depth, deck = POOL.deck;
  const x0 = -L / 2, x1 = L / 2, z0 = -Wd / 2, z1 = Wd / 2;
  const time = { value: 0 };

  // ---- The pool: floor and walls in tiles, lane lines on the floor, lit by caustics.
  const tileTex = (() => {
    const [c, g] = canvas(256, 256);
    g.fillStyle = "#cfe6f2";
    g.fillRect(0, 0, 256, 256);
    // 25 cm tiles in a 1 m texture: grout lines, each tile a touch different.
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      g.fillStyle = `hsl(${196 + r() * 8}, ${40 + r() * 12}%, ${82 + r() * 6}%)`;
      g.fillRect(i * 64 + 2, j * 64 + 2, 60, 60);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return T(t);
  })();
  const causticMat = (repeat: [number, number], lines: boolean) => {
    const tex = tileTex.clone();
    tex.repeat.set(...repeat);
    tex.needsUpdate = true;
    T(tex);
    const m = M(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0 }));
    m.onBeforeCompile = (s) => {
      s.uniforms.uTime = time;
      s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vPoolW;").replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvPoolW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      s.fragmentShader = s.fragmentShader
        .replace("#include <common>", `#include <common>\nuniform float uTime;\nvarying vec3 vPoolW;\n${CAUSTICS}`)
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
          {
            vec2 p = vPoolW.xz;
            ${lines ? `// Lane lines: dark blue down each racing lane's centre, ending 2 m from the walls in a T.
            float lane = (p.y + ${(Wd / 2).toFixed(2)}) / ${POOL.laneW.toFixed(2)};
            float off = abs(fract(lane) - 0.5) * ${POOL.laneW.toFixed(2)};
            float li = floor(lane);
            float inPool = step(0.5, li) * step(li, 8.5);
            float along = step(abs(p.x), ${(L / 2 - 2).toFixed(2)});
            float tee = step(abs(abs(p.x) - ${(L / 2 - 2).toFixed(2)}), 0.25) * step(off, 0.5);
            float stripe = max(step(off, 0.125) * along, tee) * inPool;
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02, 0.05, 0.16), stripe);` : ""}
            // Deeper is bluer; the caustics dance over everything under the water.
            float depth = clamp(-vPoolW.y / ${D.toFixed(1)}, 0.0, 1.0);
            diffuseColor.rgb *= mix(vec3(0.92, 1.0, 1.02), vec3(0.62, 0.84, 0.95), depth);
            float c = poolCaustics(p * 0.9, uTime * 1.1);
            diffuseColor.rgb *= 0.86 + 0.75 * c * step(vPoolW.y, 0.02);
          }`,
        );
    };
    m.customProgramCacheKey = () => `games-pool-${lines ? 1 : 0}`;
    return m;
  };
  const floor = new THREE.Mesh(G(new THREE.PlaneGeometry(L, Wd).rotateX(-Math.PI / 2)), causticMat([L, Wd], true));
  floor.position.y = -D;
  group.add(floor);
  const wallMat = causticMat([L, D + deck], false);
  const endMat = causticMat([Wd, D + deck], false);
  const walls: [number, number, number, number, THREE.Material][] = [
    [0, z0, 0, L, wallMat],
    [0, z1, Math.PI, L, wallMat],
    [x0, 0, Math.PI / 2, Wd, endMat],
    [x1, 0, -Math.PI / 2, Wd, endMat],
  ];
  for (const [x, z, ry, len, mat] of walls) {
    const w = new THREE.Mesh(G(new THREE.PlaneGeometry(len, D + deck)), mat);
    w.position.set(x, (deck - D) / 2, z);
    w.rotation.y = ry;
    group.add(w);
  }

  // ---- The deck round it (light non-slip tiles), and the gutter's edge.
  const deckTex = (() => {
    const [c, g] = canvas(256, 256);
    g.fillStyle = "#e9edf0";
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      g.fillStyle = `hsl(205, 8%, ${86 + r() * 6}%)`;
      g.fillRect(i * 64 + 2, j * 64 + 2, 60, 60);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return T(t);
  })();
  const deckMat = M(new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.6 }));
  const DX = 36, DZ = 26;
  const deckParts: THREE.BufferGeometry[] = [];
  const slab = (cx: number, cz: number, w: number, d: number) => { const b = new THREE.BoxGeometry(w, 0.4, d); b.translate(cx, deck - 0.2, cz); deckParts.push(b); };
  slab(0, (z1 + DZ) / 2, DX * 2, DZ - z1);
  slab(0, (z0 - DZ) / 2, DX * 2, DZ - z1);
  slab((x1 + DX) / 2, 0, DX - x1, Wd);
  slab((x0 - DX) / 2, 0, DX - x1, Wd);
  const deckMesh = new THREE.Mesh(G(mergeGeometries(deckParts)), deckMat);
  deckParts.forEach((p) => p.dispose());
  // The deck's texture is in world metres (boxes keep their own UVs, so tile it by world position).
  deckMat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace("#include <uv_vertex>", "#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = (modelMatrix * vec4(position, 1.0)).xz / 2.0;\n#endif");
  };
  deckMat.customProgramCacheKey = () => "games-deck";
  group.add(deckMesh);
  // The pool's coping: a blue rim round the edge.
  const rimParts: THREE.BufferGeometry[] = [];
  for (const [cx, cz, w, d] of [[0, z1 + 0.15, L + 0.6, 0.3], [0, z0 - 0.15, L + 0.6, 0.3], [x1 + 0.15, 0, 0.3, Wd], [x0 - 0.15, 0, 0.3, Wd]] as const) {
    const b = new THREE.BoxGeometry(w, 0.05, d);
    b.translate(cx, deck + 0.025, cz);
    rimParts.push(b);
  }
  const rim = new THREE.Mesh(G(mergeGeometries(rimParts)), M(new THREE.MeshStandardMaterial({ color: "#1d3b72", roughness: 0.5 })));
  rimParts.forEach((p) => p.dispose());
  group.add(rim);

  // ---- The water.
  const swimmers = Array.from({ length: MAX_SWIMMERS }, () => new THREE.Vector4(0, 0, 0, 0));
  const swimDir = Array.from({ length: MAX_SWIMMERS }, () => new THREE.Vector2(1, 0));
  const waterU = {
    uTime: time,
    uSwim: { value: swimmers },
    uSwimDir: { value: swimDir },
    uRain: { value: 0 },
    uCeil: { value: new THREE.Color(0.75, 0.82, 0.9) },
    uDeep: { value: new THREE.Color(0.0, 0.16, 0.28) },
    uShallow: { value: new THREE.Color(0.06, 0.42, 0.55) },
  };
  const hi = o.quality === "high";
  const water = new THREE.Mesh(
    G(new THREE.PlaneGeometry(L, Wd, hi ? 250 : 100, hi ? 125 : 50).rotateX(-Math.PI / 2)),
    M(new THREE.ShaderMaterial({
      uniforms: waterU,
      transparent: true,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform vec4 uSwim[${MAX_SWIMMERS}];
        uniform vec2 uSwimDir[${MAX_SWIMMERS}];
        varying vec3 vW;
        varying float vFoam;
        float sq(float x) { return x * x; }
        // Bow wave and wake for one swimmer: x along its direction from its front (− behind), z across.
        float wakeH(vec2 p, int i) {
          vec4 s = uSwim[i];
          if (s.z <= 0.0) return 0.0;
          vec2 d = uSwimDir[i];
          vec2 q = p - s.xy;
          float along = dot(q, d);
          float across = dot(q, vec2(-d.y, d.x));
          float len = max(0.3, s.w);
          // A hump at the head, a trough along the body, then the V spreading behind at about 19.5 degrees.
          float bow = exp(-sq(along / (0.25 + 0.15 * len)) - sq(across / (0.35 + 0.2 * len)));
          float behind = max(0.0, -along);
          float v = abs(across) - behind * 0.354;
          float wake = exp(-v * v * 9.0) * exp(-behind / (6.0 + 2.0 * s.z)) * step(along, 0.0) * sin(behind * 5.0 - uTime * 6.0);
          return s.z * (0.05 * bow + 0.03 * wake);
        }
        void main() {
          vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
          float h = 0.0, foam = 0.0;
          for (int i = 0; i < ${MAX_SWIMMERS}; i++) {
            h += wakeH(p.xz, i);
            vec4 s = uSwim[i];
            if (s.z > 0.0) {
              vec2 q = p.xz - s.xy;
              vec2 d = uSwimDir[i];
              float along = dot(q, d), across = dot(q, vec2(-d.y, d.x));
              float len = max(0.3, s.w);
              // White water over the body and kick behind it.
              foam += s.z * exp(-sq((along + len * 0.5) / (len * 0.75)) - sq(across / (0.3 + 0.25 * len)));
            }
          }
          p.y += h;
          vW = p;
          vFoam = foam;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uRain;
        uniform vec3 uCeil;
        uniform vec3 uDeep;
        uniform vec3 uShallow;
        varying vec3 vW;
        varying float vFoam;
        float wh(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        // The surface's slope: a light swell in two directions and finer chop.
        vec2 swell(vec2 p, float t) {
          vec2 g = vec2(0.0);
          g += vec2(0.8, 0.6) * cos(dot(p, vec2(0.8, 0.6)) * 1.3 + t * 1.1) * 0.035;
          g += vec2(-0.3, 0.95) * cos(dot(p, vec2(-0.3, 0.95)) * 2.1 + t * 1.6) * 0.025;
          g += vec2(0.95, -0.3) * cos(dot(p, vec2(0.95, -0.3)) * 4.7 + t * 2.4) * 0.018;
          g += vec2(0.2, 0.98) * cos(dot(p, vec2(0.2, 0.98)) * 9.3 - t * 3.1) * 0.012;
          return g;
        }
        // Raindrops: in each 0.6 m cell a ring every second or so, at a random spot and time.
        vec2 rain(vec2 p, float t) {
          vec2 g = vec2(0.0);
          vec2 cell = floor(p / 0.6);
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec2 c = cell + vec2(float(x), float(y));
            float h = wh(c);
            vec2 o = (c + vec2(wh(c + 3.1), wh(c + 7.7))) * 0.6;
            float age = fract(t * (0.8 + 0.5 * h) + h);
            vec2 q = p - o;
            float d = length(q);
            float ring = sin((d - age * 0.5) * 60.0) * exp(-abs(d - age * 0.5) * 30.0) * (1.0 - age);
            g += (d > 1e-4 ? q / d : vec2(0.0)) * ring * 0.25;
          }
          return g;
        }
        void main() {
          vec2 g = swell(vW.xz, uTime);
          if (uRain > 0.0) g += rain(vW.xz, uTime) * uRain;
          vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
          // The bow waves' slope, from the displaced surface (guarded where the derivatives vanish).
          vec3 cr = cross(dFdx(vW), dFdy(vW));
          float cl = length(cr);
          vec3 nd = cl > 1e-10 ? cr / cl : vec3(0.0, 1.0, 0.0);
          if (nd.y < 0.0) nd = -nd;
          n = normalize(n + (nd - vec3(0.0, 1.0, 0.0)) * 1.2);
          vec3 v = normalize(cameraPosition - vW);
          float cosv = clamp(dot(n, v), 0.0, 1.0);
          float fres = 0.02 + 0.98 * pow(1.0 - cosv, 5.0);
          // The ceiling reflected: a soft bright vault with rows of light panels (dark sky when the roof is open).
          vec3 rf = reflect(-v, n);
          float up = clamp(rf.y, 0.0, 1.0);
          vec2 cp = vW.xz + rf.xz / max(0.15, rf.y) * 14.0;
          float panels = step(0.82, fract(cp.x / 6.0)) * step(0.4, fract(cp.y / 9.0)) * step(0.3, up);
          vec3 ceil = mix(uCeil * 0.55, uCeil, up) + vec3(3.2, 3.1, 2.9) * panels * (1.0 - uRain);
          ceil = mix(ceil, vec3(0.08, 0.09, 0.11), uRain * 0.85);
          // The water's own colour: the tiles' light through it (shallower looking straight down).
          vec3 body = mix(uShallow, uDeep, clamp(1.0 - cosv, 0.0, 1.0));
          vec3 col = mix(body, ceil, fres);
          float foam = clamp(vFoam, 0.0, 1.0) * (0.55 + 0.45 * wh(floor(vW.xz * 40.0) + floor(uTime * 12.0)));
          col = mix(col, vec3(0.95, 0.98, 1.0), foam * 0.85);
          float a = mix(0.62, 0.97, fres);
          a = max(a, foam);
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    })),
  );
  water.position.y = POOL.water;
  water.renderOrder = 2;
  group.add(water);

  // ---- Lane ropes: floats every 0.15 m; red in the last 5 m, a marker at 15 m, then the rope's own colours.
  const ropes = (() => {
    const step = hi ? 0.14 : 0.2;
    const per = Math.floor(L / step);
    const nRopes = 9;
    const geo = G(new THREE.CylinderGeometry(0.06, 0.06, step * 0.82, hi ? 10 : 6, 1).rotateZ(Math.PI / 2));
    const mat = M(new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.1 }));
    const mesh = new THREE.InstancedMesh(geo, mat, per * nRopes);
    const m4 = new THREE.Matrix4();
    const red = new THREE.Color("#e63946"), white = new THREE.Color("#f1f1f1"), blue = new THREE.Color("#1d4ed8"), green = new THREE.Color("#16a34a"), yellow = new THREE.Color("#facc15"), pink = new THREE.Color("#ff4fa3");
    let k = 0;
    for (let j = 0; j < nRopes; j++) {
      const z = poolLaneZ(j) + POOL.laneW / 2;
      const main = j === 0 || j === 8 ? green : blue;
      for (let i = 0; i < per; i++) {
        const x = x0 + (i + 0.5) * step;
        const fromEnd = Math.min(x - x0, x1 - x);
        const c = fromEnd < 5 ? red : Math.abs(fromEnd - 15) < 0.25 ? pink : (Math.floor(i / 4) % 2 === 0 ? main : j === 0 || j === 8 ? yellow : white);
        m4.makeTranslation(x, 0.02, z);
        mesh.setMatrixAt(k, m4);
        mesh.setColorAt(k, c);
        k++;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
  })();
  group.add(ropes);

  // ---- Backstroke flags 5 m from each wall, 1.8 m over the water, and their posts.
  {
    const parts: THREE.BufferGeometry[] = [];
    const colors: number[] = [];
    const flagCols = [new THREE.Color("#e63946"), new THREE.Color("#f1f1f1"), new THREE.Color("#1d4ed8")];
    for (const fx of [x0 + 5, x1 - 5]) {
      for (let z = z0 - 1; z <= z1 + 1; z += 0.5) {
        const tri = new THREE.BufferGeometry();
        tri.setAttribute("position", new THREE.Float32BufferAttribute([fx, 1.8, z - 0.18, fx, 1.8, z + 0.18, fx, 1.5, z], 3));
        tri.setAttribute("normal", new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0], 3));
        const c = flagCols[Math.round((z - z0) * 2) % 3];
        for (let q = 0; q < 3; q++) colors.push(c.r, c.g, c.b);
        parts.push(tri);
      }
      for (const pz of [z0 - 1.6, z1 + 1.6]) {
        const indexed = new THREE.CylinderGeometry(0.04, 0.04, 2.1, 8);
        indexed.translate(fx, 0.95 + deck / 2, pz);
        indexed.deleteAttribute("uv");
        const post = indexed.toNonIndexed();
        indexed.dispose();
        const n = post.getAttribute("position").count;
        for (let q = 0; q < n; q++) colors.push(0.6, 0.62, 0.66);
        parts.push(post);
      }
    }
    const merged = mergeGeometries(parts);
    merged.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    parts.forEach((p) => p.dispose());
    const flags = new THREE.Mesh(G(merged), M(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.7 })));
    group.add(flags);
  }

  // ---- Starting blocks (lanes 1–8) at the start end, touchpads on both end walls.
  {
    const blockParts: THREE.BufferGeometry[] = [];
    for (let lane = 1; lane <= 8; lane++) {
      const z = poolLaneZ(lane);
      const base = new THREE.BoxGeometry(0.5, POOL.block - deck, 0.5);
      base.translate(x0 - 0.45, deck + (POOL.block - deck) / 2 - 0.05, z);
      blockParts.push(base);
      const top = new THREE.BoxGeometry(0.74, 0.06, 0.52);
      top.rotateZ(-0.17);
      top.translate(x0 - 0.36, POOL.block, z);
      blockParts.push(top);
      const kick = new THREE.BoxGeometry(0.06, 0.18, 0.5);
      kick.rotateZ(0.6);
      kick.translate(x0 - 0.66, POOL.block + 0.1, z);
      blockParts.push(kick);
    }
    const blocks = new THREE.Mesh(G(mergeGeometries(blockParts)), M(new THREE.MeshStandardMaterial({ color: "#f3f4f6", roughness: 0.35, metalness: 0.2 })));
    blockParts.forEach((p) => p.dispose());
    group.add(blocks);
    // Lane numbers on the blocks' fronts.
    const numTex = (() => {
      const [c, g] = canvas(1024, 128);
      g.fillStyle = "#0b1a3a";
      g.fillRect(0, 0, 1024, 128);
      g.fillStyle = "#ffffff";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = `800 96px ${o.font}`;
      for (let i = 0; i < 8; i++) g.fillText(String(i + 1), 64 + i * 128, 70);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return T(t);
    })();
    const numMat = M(new THREE.MeshBasicMaterial({ map: numTex }));
    for (let lane = 1; lane <= 8; lane++) {
      const g = new THREE.PlaneGeometry(0.42, 0.3);
      const uv = g.getAttribute("uv") as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, ((lane - 1) + uv.getX(i)) / 8);
      const plate = new THREE.Mesh(G(g), numMat);
      plate.position.set(x0 - 0.19, POOL.block - 0.28, poolLaneZ(lane));
      plate.rotation.y = Math.PI / 2;
      group.add(plate);
    }
    const padMat = M(new THREE.MeshStandardMaterial({ color: "#facc15", roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -1 }));
    const pads: THREE.BufferGeometry[] = [];
    for (const [x, ry] of [[x0 + 0.012, Math.PI / 2], [x1 - 0.012, -Math.PI / 2]] as const) {
      for (let lane = 1; lane <= 8; lane++) {
        const p = new THREE.PlaneGeometry(2.2, 0.9);
        p.rotateY(ry);
        p.translate(x, -0.3, poolLaneZ(lane));
        pads.push(p);
      }
    }
    const padMesh = new THREE.Mesh(G(mergeGeometries(pads)), padMat);
    pads.forEach((p) => p.dispose());
    group.add(padMesh);
  }

  // ---- The hall: stands on both long sides, walls, a ceiling of light panels (or the open roof in the rain).
  const rows: { pts: { x: number; z: number; nx: number; nz: number }[]; y: number; tier: 0 | 1 }[] = [];
  {
    const steps: THREE.BufferGeometry[] = [];
    for (const side of [1, -1]) {
      const n = side > 0 ? 14 : 8;
      for (let i = 0; i < n; i++) {
        const d = 17 + i * 0.86;
        const y = 1.4 + i * 0.45;
        const b = new THREE.BoxGeometry(60, y, 0.86);
        b.translate(0, y / 2, side * (d + 0.43));
        steps.push(b);
        const pts: { x: number; z: number; nx: number; nz: number }[] = [];
        for (let x = -28.5; x <= 28.5; x += 0.56) if (Math.round((x + 28.5) / 0.56) % 15 !== 14) pts.push({ x, z: side * (d + 0.3), nx: 0, nz: side });
        rows.push({ pts, y, tier: i < 7 ? 0 : 1 });
      }
    }
    const stands = new THREE.Mesh(G(mergeGeometries(steps)), M(new THREE.MeshStandardMaterial({ color: "#2b3f6b", roughness: 0.8 })));
    steps.forEach((p) => p.dispose());
    group.add(stands);
  }
  const crowd: Crowd = buildCrowd({ occupancy: o.occupancy, flashes: Math.round(o.flashes * 0.4), rows, light: { y: 24 } });
  group.add(crowd.group);
  const hall = new THREE.Mesh(G(new THREE.BoxGeometry(84, 30, 64)), M(new THREE.MeshStandardMaterial({ color: "#b9c8d8", roughness: 0.9, side: THREE.BackSide })));
  hall.position.y = 14.6;
  group.add(hall);
  // The roof: a white vault with rows of light panels; in the rain it's open to a dark sky.
  const roof = new THREE.Group();
  {
    const vault = new THREE.Mesh(G(new THREE.PlaneGeometry(84, 64).rotateX(Math.PI / 2)), M(new THREE.MeshStandardMaterial({ color: "#dfe7ef", roughness: 0.9 })));
    vault.position.y = 22;
    roof.add(vault);
    const panelParts: THREE.BufferGeometry[] = [];
    for (let i = -6; i <= 6; i++) for (let j = -3; j <= 3; j++) {
      const p = new THREE.PlaneGeometry(4.2, 1.1).rotateX(Math.PI / 2);
      p.translate(i * 6, 21.9, j * 9);
      panelParts.push(p);
    }
    const panels = new THREE.Mesh(G(mergeGeometries(panelParts)), M(new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.9, 3.7), toneMapped: false })));
    panelParts.forEach((p) => p.dispose());
    roof.add(panels);
  }
  group.add(roof);
  const sky = new THREE.Mesh(G(new THREE.PlaneGeometry(84, 64).rotateX(Math.PI / 2)), M(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.06, 0.08) })));
  sky.position.y = 22;
  sky.visible = false;
  group.add(sky);
  // Rain: streaks falling through the hall's open roof.
  const rainMesh = (() => {
    const n = hi ? 5000 : 1800;
    const geo = G(new THREE.BufferGeometry());
    const pos: number[] = [], seed: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = (r() - 0.5) * 70, z = (r() - 0.5) * 44, s = r();
      for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]) { pos.push(x, u, z); seed.push(s, v); }
    }
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 2));
    const mat = M(new THREE.ShaderMaterial({
      uniforms: { uTime: time },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec2 aSeed;
        uniform float uTime;
        varying float vA;
        void main() {
          // Each streak falls from 22 m at 9 m/s, 0.5 m long, 1.5 cm wide, facing the camera across.
          float fall = fract(aSeed.x * 7.13 + uTime * 0.41);
          vec3 p = vec3(position.x, 22.0 - fall * 22.0 + aSeed.y * 0.5, position.z);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          mv.x += (position.y - 0.5) * 0.015;
          vA = 0.35 * (1.0 - aSeed.y);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `varying float vA; void main() { gl_FragColor = vec4(0.8, 0.85, 0.95, vA); }`,
    }));
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.visible = false;
    return m;
  })();
  group.add(rainMesh);

  // The video board over the far end.
  const [boardC, boardG] = canvas(1024, 384);
  const boardTex = T(new THREE.CanvasTexture(boardC));
  boardTex.colorSpace = THREE.SRGBColorSpace;
  let boardText = "";
  const drawBoard = (title: string) => {
    if (title === boardText) return;
    boardText = title;
    const g = boardG;
    const grad = g.createLinearGradient(0, 0, 0, 384);
    grad.addColorStop(0, "#0b1a3a");
    grad.addColorStop(1, "#04070f");
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 384);
    g.fillStyle = "#3bceac";
    g.fillRect(0, 344, 1024, 10);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#ffffff";
    g.font = `800 84px ${o.font}`;
    g.fillText("THE POKÉIQ GAMES", 512, 130, 960);
    g.fillStyle = "#ffd23f";
    g.font = `800 64px ${o.font}`;
    g.fillText(title.toUpperCase(), 512, 250, 960);
    g.fillStyle = "rgba(0,0,0,0.25)";
    for (let x = 0; x < 1024; x += 4) g.fillRect(x, 0, 1, 384);
    boardTex.needsUpdate = true;
  };
  drawBoard("Swimming");
  const board = new THREE.Mesh(G(new THREE.PlaneGeometry(16, 6)), M(new THREE.MeshBasicMaterial({ map: boardTex, color: new THREE.Color(1.4, 1.4, 1.4) })));
  board.position.set(41.8, 9, 0);
  board.rotation.y = -Math.PI / 2;
  group.add(board);

  // ---- Light: bright and even, from the roof and the windows; dimmer in the rain.
  const lights = new THREE.Group();
  const hemi = new THREE.HemisphereLight(0xeaf3ff, 0x6b7c8c, 1.1);
  const sun = new THREE.DirectionalLight(0xfff4e6, 1.5);
  sun.position.set(18, 30, 14);
  const fill = new THREE.DirectionalLight(0xd8e6ff, 0.6);
  fill.position.set(-20, 24, -12);
  lights.add(hemi, sun, fill);
  group.add(lights);

  const env = (() => {
    const s = new THREE.Scene();
    s.add(new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.62, 0.7), side: THREE.BackSide })));
    const panelMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.8, 5.4) });
    for (let i = -3; i <= 3; i++) for (let j = -2; j <= 2; j++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(4, 1).rotateX(Math.PI / 2), panelMat);
      p.position.set(i * 7, 18, j * 9);
      s.add(p);
    }
    s.add(new THREE.Mesh(new THREE.CircleGeometry(30, 32).rotateX(-Math.PI / 2).translate(0, -2, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.3, 0.42) })));
    const pmrem = new THREE.PMREMGenerator(o.renderer);
    const rt = pmrem.fromScene(s, 0.03);
    pmrem.dispose();
    s.traverse((x) => { if (x instanceof THREE.Mesh) { x.geometry.dispose(); (x.material as THREE.Material).dispose(); } });
    return rt.texture;
  })();

  let raining = false;
  const setRain = (on: boolean) => {
    if (on === raining) return;
    raining = on;
    roof.visible = !on;
    sky.visible = on;
    rainMesh.visible = on;
    waterU.uRain.value = on ? 1 : 0;
    hemi.intensity = on ? 0.6 : 1.1;
    sun.intensity = on ? 0.5 : 1.5;
    fill.intensity = on ? 0.45 : 0.6;
  };

  return {
    group,
    env,
    fog: new THREE.FogExp2(new THREE.Color(0.55, 0.62, 0.7), 0.0035),
    update(t, _cam, ex) {
      time.value = t;
      crowd.update(t, ex);
    },
    setProps(p) {
      if (p.kind === "swim") {
        setRain(p.rain);
        for (let i = 0; i < MAX_SWIMMERS; i++) {
          const w = p.wakes[i];
          if (!w) { swimmers[i].set(0, 0, 0, 0); continue; }
          swimmers[i].set(w.x, w.z, Math.max(0, Math.min(3, w.v / 2)), w.len);
          swimDir[i].set(w.dir, 0);
        }
        drawBoard(p.board ? "Results" : "Swimming");
      } else {
        for (const s of swimmers) s.set(0, 0, 0, 0);
        if (p.kind === "podium") drawBoard("Medal ceremony");
      }
    },
    dispose() {
      crowd.dispose();
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      texs.forEach((t) => t.dispose());
      env.dispose();
    },
  };
}
