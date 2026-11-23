import * as THREE from "three";
import { rng, type Tower } from "@/lib/sizes/castelia";

/**
 * Castelia's skyscrapers: every tower is a handful of flat faces (podium,
 * setback tiers, a crown), merged into one geometry per chunk of the city,
 * and all their windows are drawn by one shader: curtain walls of glass,
 * punched windows in warm stone, ribbon windows, dark glass between gold
 * piers, old brick, each floor and bay worked out from where the pixel is
 * on the facade, with a share of windows lit for the evening (no window
 * textures to download, and nothing that shimmers far off: a facade too
 * small to resolve its windows blends into their average).
 *
 * Towers between the camera and the line sink below the sight line (in the
 * vertex shader, so a whole tower stays a tower, only shorter): the camera
 * can stand back from a giant behind a street wall or fly the finale over
 * the skyline and always see the figures' feet. They cast no shadows: the
 * low sun stands on the camera's side and would leave the whole line in the
 * dark.
 */

/** Facade kinds past the window styles (castelia.ts FACADE_KINDS). */
export const K_METAL = 6, K_LIGHT = 7, K_ROOF = 8;
/** Added to a facade's kind when its crown is floodlit. */
const LIT_CROWN = 16;

const TINTS: Record<number, string[]> = {
  0: ["#b9c7d6", "#c9d3dc", "#aebfd0"],
  1: ["#d8c4a2", "#cfb68e", "#e0d0b2", "#c7ab86"],
  2: ["#e6e4de", "#d9d7d0", "#efece4"],
  3: ["#3a3f48", "#45403a", "#2f3540"],
  4: ["#b7d0c8", "#a9c6bd", "#c3d6cf"],
  5: ["#9a5a45", "#8a4e3c", "#a8674e", "#7d4a3a"],
};
/** Bay width and floor height (m) of each facade kind. */
const GRID: Record<number, [number, number]> = { 0: [1.6, 3.8], 1: [2.6, 3.6], 2: [3.2, 3.7], 3: [2.2, 4.0], 4: [1.8, 3.9], 5: [2.8, 3.3] };

/** A growable builder for tower faces with the facade attributes. */
export class TowerGeo {
  private p: number[] = [];
  private n: number[] = [];
  private u: number[] = [];
  private c: number[] = [];
  private s: number[] = [];
  private t: number[] = [];
  private i: number[] = [];
  get empty() { return this.i.length === 0; }

  private v(p: THREE.Vector3, n: THREE.Vector3, u: number, col: THREE.Color, st: number[], tw: number[]) {
    this.p.push(p.x, p.y, p.z);
    this.n.push(n.x, n.y, n.z);
    this.u.push(u, p.y);
    this.c.push(col.r, col.g, col.b);
    this.s.push(st[0], st[1], st[2], st[3]);
    this.t.push(tw[0], tw[1], tw[2], tw[3]);
    return this.p.length / 3 - 1;
  }

  /** A quad a-b-c-d (counter-clockwise from its front); u along the facade at a/d and b/c. */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, u0: number, u1: number, col: THREE.Color, st: number[], tw: number[]) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    const i0 = this.v(a, n, u0, col, st, tw), i1 = this.v(b, n, u1, col, st, tw), i2 = this.v(c, n, u1, col, st, tw), i3 = this.v(d, n, u0, col, st, tw);
    this.i.push(i0, i1, i2, i0, i2, i3);
  }

  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, col: THREE.Color, st: number[], tw: number[]) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    const i0 = this.v(a, n, 0, col, st, tw), i1 = this.v(b, n, 1, col, st, tw), i2 = this.v(c, n, 0.5, col, st, tw);
    this.i.push(i0, i1, i2);
  }

  /** A fan cap over a closed polygon at its own heights (counter-clockwise seen from above). */
  cap(pts: THREE.Vector3[], col: THREE.Color, st: number[], tw: number[]) {
    const n = new THREE.Vector3(0, 1, 0);
    const base = this.p.length / 3;
    for (const q of pts) this.v(q, n, q.x, col, st, tw);
    for (let k = 1; k < pts.length - 1; k++) this.i.push(base, base + k, base + k + 1);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute("aStyle", new THREE.Float32BufferAttribute(this.s, 4));
    g.setAttribute("aTower", new THREE.Float32BufferAttribute(this.t, 4));
    g.setIndex(this.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** One TowerGeo per chunk of the ground (square, `size` m). */
export class TowerChunks {
  private map = new Map<string, TowerGeo>();
  constructor(private size: number) {}
  at(x: number, z: number): TowerGeo {
    const key = `${Math.floor(x / this.size)},${Math.floor(z / this.size)}`;
    let g = this.map.get(key);
    if (!g) { g = new TowerGeo(); this.map.set(key, g); }
    return g;
  }
  meshes(mat: THREE.Material): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [key, g] of this.map) {
      if (g.empty) continue;
      const m = new THREE.Mesh(g.build(), mat);
      m.name = `castelia-towers|${key}`;
      m.castShadow = false;
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      out.push(m);
    }
    this.map.clear();
    return out;
  }
}

/** The footprint of a tower (or one of its tiers) at height y: corners counter-clockwise seen from above. */
function footprint(t: Tower, inset: number, y: number): THREE.Vector3[] {
  const cs = Math.cos(t.yaw), sn = Math.sin(t.yaw);
  const P = (lx: number, lz: number) => new THREE.Vector3(t.x + lx * cs + lz * sn, y, t.z - lx * sn + lz * cs);
  if (t.round) {
    const r = Math.min(t.w, t.d) / 2 - inset;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < 12; k++) { const a = (-k / 12) * Math.PI * 2; pts.push(P(Math.cos(a) * r, Math.sin(a) * r)); }
    return pts;
  }
  const hw = Math.max(2, t.w / 2 - inset), hd = Math.max(2, t.d / 2 - inset);
  // Seen from above (+y), counter-clockwise in x-z means clockwise in the usual x-y sense: walk -x-z, -x+z, +x+z, +x-z.
  return [P(-hw, -hd), P(-hw, hd), P(hw, hd), P(hw, -hd)];
}

/** Walls round a footprint between y0 and y1 (outward faces), u running on round the corners. */
function walls(g: TowerGeo, ring: THREE.Vector3[], y0: number, y1: number, col: THREE.Color, st: number[], tw: number[]) {
  let u = 0;
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k], b = ring[(k + 1) % ring.length];
    const len = a.distanceTo(b);
    // Outward: (b - a) × up points out of the footprint.
    g.quad(new THREE.Vector3(a.x, y0, a.z), new THREE.Vector3(b.x, y0, b.z), new THREE.Vector3(b.x, y1, b.z), new THREE.Vector3(a.x, y1, a.z), u, u + len, col, st, tw);
    u += len;
  }
}

/** Builds one tower into the chunk it stands in. */
export function addTower(chunks: TowerChunks, t: Tower) {
  const g = chunks.at(t.x, t.z);
  const r = rng(t.seed);
  const pal = TINTS[t.kind];
  // Evening: the walls a shade darker than by day (the low sun still gilds the faces turned to it).
  const col = new THREE.Color(pal[Math.floor(r() * pal.length)]).multiplyScalar(0.58 + r() * 0.14);
  const [bay, floor] = GRID[t.kind];
  const seed = Math.floor(r() * 997);
  const lit = t.crown === "lit" ? LIT_CROWN : 0;
  const style = (kind: number, f = floor, b = bay) => [kind, f, b * (0.9 + r() * 0.25), seed];
  const st = style(t.kind + lit);
  const rad = Math.hypot(t.w, t.d) / 2;
  const tw = [t.x, t.z, rad, t.h];
  const roofCol = new THREE.Color("#3b3d42").multiplyScalar(0.8 + r() * 0.4);
  const roofSt = [K_ROOF, floor, bay, seed];
  const minSide = Math.min(t.w, t.d);

  // Podium (shops), then the tiers, each set back from the one below.
  let y = 0;
  if (t.podium > 0) {
    const ring = footprint(t, 0, 0);
    const pst = style(r() < 0.5 ? 1 : 2, 4.4, 3);
    walls(g, ring, 0, t.podium, col.clone().multiplyScalar(1.05), pst, tw);
    g.cap(footprint(t, 0, t.podium), roofCol, roofSt, tw);
    y = t.podium;
  }
  const shares = t.tiers === 1 ? [1] : t.tiers === 2 ? [0.72, 1] : [0.58, 0.82, 1];
  let inset = t.podium > 0 ? Math.min(6, minSide * 0.12) : 0;
  let top = t.h;
  for (let k = 0; k < shares.length; k++) {
    const yEnd = Math.max(y + 8, t.podium + (t.h - t.podium) * shares[k]);
    const ring = footprint(t, inset, 0);
    walls(g, ring, y, yEnd, col, st, tw);
    g.cap(footprint(t, inset, yEnd), roofCol, roofSt, tw);
    y = yEnd;
    top = yEnd;
    inset += minSide * (t.tiers === 3 ? 0.1 : 0.13);
    if (minSide / 2 - inset < 5) break;
  }

  // The crown.
  const cx = t.x, cz = t.z;
  const half = Math.max(3, minSide / 2 - inset);
  if (t.crown === "spire") {
    const h = Math.min(90, top * 0.28);
    const s = Math.min(half * 0.45, 4);
    const base = footprint({ ...t, w: s * 2, d: s * 2, round: false }, 0, top);
    const tip = new THREE.Vector3(cx, top + h, cz);
    const mst = [K_METAL, floor, bay, seed];
    for (let k = 0; k < 4; k++) g.tri(base[k], base[(k + 1) % 4], tip, new THREE.Color("#c9ccd2"), mst, tw);
    beacon(g, tip, tw);
  } else if (t.crown === "stepped") {
    // Two little stepped tiers (an older skyscraper's crown).
    let ys = top, ins = inset;
    for (let k = 0; k < 2; k++) {
      ins += Math.min(half * 0.3, 4);
      const ring = footprint(t, ins, 0);
      if (minSide / 2 - ins < 2.5) break;
      walls(g, ring, ys, ys + 7, col, style(t.kind === 3 ? 3 : 1), tw);
      g.cap(footprint(t, ins, ys + 7), roofCol, roofSt, tw);
      ys += 7;
    }
    if (t.h > 150) beacon(g, new THREE.Vector3(cx, ys + 0.5, cz), tw);
  } else if (t.crown === "slant" && !t.round) {
    // A glass pyramid roof.
    const ring = footprint(t, inset - minSide * 0.13 + 0.5, top);
    const tip = new THREE.Vector3(cx, top + Math.min(30, half * 0.9), cz);
    const gst = [0 + LIT_CROWN, floor, bay, seed];
    for (let k = 0; k < 4; k++) g.tri(ring[k], ring[(k + 1) % 4], tip, new THREE.Color("#9fb3c8"), gst, tw);
  } else {
    // Plant on the roof.
    if (half > 6) {
      const s = half * 0.5;
      const ring = footprint({ ...t, w: s * 2, d: s * 1.4, round: false }, 0, 0);
      walls(g, ring, top, top + 4, roofCol.clone().multiplyScalar(1.4), [K_ROOF, floor, bay, seed], tw);
      g.cap(footprint({ ...t, w: s * 2, d: s * 1.4, round: false }, 0, top + 4), roofCol, roofSt, tw);
    }
    if (t.h > 160) beacon(g, new THREE.Vector3(cx, top + 4.5, cz), tw);
  }
}

/** A red aviation light. */
function beacon(g: TowerGeo, p: THREE.Vector3, tw: number[]) {
  const s = 0.9;
  const red = new THREE.Color(1, 0.08, 0.04);
  const st = [K_LIGHT, 1, 1, 0];
  const a = new THREE.Vector3(p.x - s, p.y, p.z - s), b = new THREE.Vector3(p.x + s, p.y, p.z - s), c = new THREE.Vector3(p.x + s, p.y, p.z + s), d = new THREE.Vector3(p.x - s, p.y, p.z + s);
  const top = (v: THREE.Vector3) => v.clone().setY(p.y + s * 1.6);
  g.quad(b, a, top(a), top(b), 0, 1, red, st, tw);
  g.quad(c, b, top(b), top(c), 0, 1, red, st, tw);
  g.quad(d, c, top(c), top(d), 0, 1, red, st, tw);
  g.quad(a, d, top(d), top(a), 0, 1, red, st, tw);
}

export interface FacadeUniforms {
  uCam: { value: THREE.Vector3 };
  uAim: { value: THREE.Vector3 };
  uTanH: { value: number };
  uClamp: { value: number };
}

export function facadeUniforms(): FacadeUniforms {
  return { uCam: { value: new THREE.Vector3() }, uAim: { value: new THREE.Vector3(0, 0, 1) }, uTanH: { value: 0.6 }, uClamp: { value: 1 } };
}

/** The towers' one material: the windows, the lit crowns, the sinking. */
export function facadeMaterial(u: FacadeUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
  m.name = "castelia-facade";
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (s, r) => {
    prev?.call(m, s, r);
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute vec4 aStyle;
        attribute vec4 aTower;
        uniform vec3 uCam;
        uniform vec3 uAim;
        uniform float uTanH;
        uniform float uClamp;
        varying vec4 vStyle;
        varying vec3 vFac;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        // Sink a tower that stands between the camera and the line below the sight line to the figures' feet.
        if (uClamp > 0.5 && aTower.z > 0.0) {
          vec2 A = uCam.xz, B = uAim.xz;
          vec2 ab = B - A;
          float L = max(length(ab), 1e-3);
          vec2 dir = ab / L;
          vec2 rel = aTower.xy - A;
          float t = dot(rel, dir);
          float lat = abs(dot(rel, vec2(-dir.y, dir.x)));
          if (t > -aTower.z && t < L) {
            float halfW = max(t, 0.0) * uTanH * 1.2 + aTower.z + 8.0;
            float k = 1.0 - smoothstep(halfW, halfW + 40.0, lat);
            float tt = clamp(t / L, 0.0, 1.0);
            float line = max(0.6, uCam.y * (1.0 - tt) - 3.0);
            float maxH = line + (1.0 - k) * 600.0;
            transformed.y = min(transformed.y, maxH);
          }
        }
        vStyle = aStyle;
        vFac = vec3(uv.x, transformed.y, aTower.w);`
      );
    s.fragmentShader = s.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec4 vStyle;
        varying vec3 vFac;
        float cHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        // A soft box from a to b along x (antialiased by w).
        float cBand(float x, float a, float b, float w) { return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x)); }`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float kindAll = floor(vStyle.x + 0.5);
        float litCrown = step(15.5, kindAll);
        float kind = kindAll - litCrown * 16.0;
        float fRough = 0.85, fMetal = 0.0;
        vec3 fEmit = vec3(0.0);
        vec3 wall = diffuseColor.rgb;
        if (kind > 7.5) {
          // Roofs: dark gravel and plant.
          fRough = 0.95;
        } else if (kind > 6.5) {
          // An aviation light.
          fEmit = vColor * (3.0 + 2.0 * step(0.5, fract(vStyle.w + 0.0)));
          diffuseColor.rgb = vec3(0.0);
        } else if (kind > 5.5) {
          fRough = 0.35; fMetal = 0.85;
        } else {
          float y = vFac.y, top = vFac.z;
          float ground = 4.6;
          float floorH = vStyle.y, bayW = vStyle.z, seed = vStyle.w;
          // Window shape per kind: width and height shares of a bay and floor, glass colour, how reflective.
          float ww = 0.5, wh = 0.55;
          vec3 glass = vec3(0.05, 0.07, 0.1);
          if (kind < 0.5) { ww = 0.9; wh = 0.74; glass = vec3(0.16, 0.26, 0.38); }
          else if (kind < 1.5) { ww = 0.46; wh = 0.56; glass = vec3(0.06, 0.07, 0.09); }
          else if (kind < 2.5) { ww = 0.97; wh = 0.46; glass = vec3(0.08, 0.11, 0.15); }
          else if (kind < 3.5) { ww = 0.66; wh = 0.72; glass = vec3(0.06, 0.07, 0.08); }
          else if (kind < 4.5) { ww = 0.88; wh = 0.7; glass = vec3(0.14, 0.27, 0.25); }
          else { ww = 0.42; wh = 0.58; glass = vec3(0.05, 0.05, 0.06); }
          float isGlassy = (kind < 0.5 || kind > 3.5 && kind < 4.5) ? 1.0 : 0.0;
          if (y < ground) {
            // Shopfronts and lobbies, nearly all lit.
            vec2 cell = vec2(vFac.x / 4.2, y / ground);
            vec2 fw = fwidth(cell);
            vec2 f = fract(cell);
            float win = cBand(f.x, 0.06, 0.94, fw.x) * cBand(f.y, 0.04, 0.82, fw.y);
            float shop = cHash(floor(cell) + seed);
            vec3 warm = mix(vec3(1.0, 0.62, 0.3), vec3(1.0, 0.8, 0.55), shop);
            fEmit = warm * win * (0.35 + 0.55 * step(0.25, shop));
            diffuseColor.rgb = mix(wall * 0.55, vec3(0.05), win);
            fRough = mix(0.8, 0.2, win);
          } else {
            vec2 cell = vec2(vFac.x / bayW, (y - ground) / floorH);
            vec2 fw = fwidth(cell);
            vec2 f = fract(cell);
            vec2 id = floor(cell);
            float sill = (1.0 - wh) * 0.45;
            float win = cBand(f.x, 0.5 - ww * 0.5, 0.5 + ww * 0.5, fw.x * 0.75) * cBand(f.y, sill, sill + wh, fw.y * 0.75);
            // Gold piers between the dark glass of kind 3, mullions on the curtain walls.
            float far = smoothstep(0.28, 0.75, max(fw.x, fw.y));
            float avg = ww * wh;
            win = mix(win, avg, far);
            // Which windows are lit: some floors all on (offices working late), the rest one by one.
            float fl = cHash(vec2(id.y, seed));
            float share = 0.14 + 0.24 * fract(seed * 0.618);
            float onFloor = step(0.9, fl);
            float lit = max(step(cHash(id + seed * 1.37), share), onFloor);
            lit = mix(lit, share + 0.1 * (1.0 - share), far);
            float tone = cHash(id.yx + seed);
            vec3 warm = mix(vec3(1.0, 0.6, 0.3), vec3(0.8, 0.88, 1.0), step(0.82, tone));
            fEmit = warm * win * lit * (0.45 + 0.6 * tone);
            vec3 wcol = wall;
            if (kind > 2.5 && kind < 3.5) wcol = mix(wall, vec3(0.78, 0.6, 0.32), cBand(f.x, -0.2, 0.12, fw.x) * (1.0 - far));
            diffuseColor.rgb = mix(wcol, glass, win);
            fRough = mix(0.82, 0.12, win);
            fMetal = win * mix(0.25, 0.75, isGlassy);
            // A glass tower is mostly glass: the wall between its windows reflects too.
            if (isGlassy > 0.5) { fRough = mix(0.25, 0.1, win); fMetal = mix(0.55, 0.75, win); diffuseColor.rgb = mix(glass * 1.4, glass, win); }
          }
          // Floodlit crowns: a band of light round the top and light washing up the last floors.
          if (litCrown > 0.5 && top > 0.0) {
            float band = cBand(y, top - 5.0, top - 2.0, fwidth(y));
            vec3 lc = mix(vec3(1.0, 0.86, 0.62), vec3(0.72, 0.9, 1.0), step(0.6, fract(vStyle.w * 0.37)));
            fEmit += lc * (band * 2.0 + smoothstep(top - 30.0, top, y) * 0.12);
          }
          // Darker towards the street (the canyon's own shade).
          diffuseColor.rgb *= mix(0.62, 1.0, smoothstep(0.0, 26.0, y));
        }`
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = fRough;")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = fMetal;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance = fEmit;");
  };
  const prevKey = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => `${prevKey ? prevKey() : ""}|castelia-facade`;
  return m;
}
