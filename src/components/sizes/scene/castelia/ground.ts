import * as THREE from "three";
import { CASTELIA_STREET, type CasteliaPlan } from "@/lib/sizes/castelia";
import type { WorldPlan } from "@/lib/sizes/world";
import { groundVariation, plazaPattern, type Shared } from "../shaders";

/**
 * Castelia's ground: the bay (a dark evening sea with moving ripples that
 * mirror the sky), the land with its quay walls, asphalt streets, raised
 * pavements round every block, the main street's paved median the line
 * stands on, lane markings, the waterfront promenade and Central Plaza's
 * patterned paving. A few merged meshes in all.
 */

export interface GroundTextures {
  pbr(name: string, tileM: number, opts?: { color?: string; normalScale?: number }): THREE.MeshStandardMaterialParameters;
}

/** World-scaled UVs (metres / tile) on a geometry lying in x-z. */
function worldUv(g: THREE.BufferGeometry, tile: number) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) { uv[i * 2] = pos.getX(i) / tile; uv[i * 2 + 1] = -pos.getZ(i) / tile; }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

/** Flat quads and kerbs collected into one geometry (top faces, plus optional raised edges). */
class Slabs {
  private p: number[] = [];
  private n: number[] = [];
  private i: number[] = [];
  rect(x0: number, x1: number, z0: number, z1: number, y: number, kerb = 0) {
    if (x1 <= x0 || z1 <= z0) return;
    const b = this.p.length / 3;
    this.p.push(x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0);
    for (let k = 0; k < 4; k++) this.n.push(0, 1, 0);
    this.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
    if (kerb > 0) {
      const side = (ax: number, az: number, bx: number, bz: number, nx: number, nz: number) => {
        const s = this.p.length / 3;
        this.p.push(ax, y - kerb, az, bx, y - kerb, bz, bx, y, bz, ax, y, az);
        for (let k = 0; k < 4; k++) this.n.push(nx, 0, nz);
        this.i.push(s, s + 1, s + 2, s, s + 2, s + 3);
      };
      side(x0, z0, x1, z0, 0, -1);
      side(x1, z1, x0, z1, 0, 1);
      side(x0, z1, x0, z0, -1, 0);
      side(x1, z0, x1, z1, 1, 0);
    }
  }
  build(tile: number): THREE.BufferGeometry | null {
    if (!this.i.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setIndex(this.i);
    worldUv(g, tile);
    g.computeBoundingSphere();
    return g;
  }
}

/** Ripples for the bay: two scrolling noise normals, reflective, a little lighter far off (the sky's haze on the water). */
function waterMaterial(shared: Shared): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: "#16283f", roughness: 0.16, metalness: 0.55 });
  m.name = "castelia-water";
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = shared.uniforms.uTime;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWaterW;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvWaterW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    s.fragmentShader = s.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vWaterW;
        uniform float uTime;
        float wHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float wNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(wHash(i), wHash(i+vec2(1,0)), f.x), mix(wHash(i+vec2(0,1)), wHash(i+vec2(1,1)), f.x), f.y); }
        vec2 wGrad(vec2 p){ float e = 0.15; return vec2(wNoise(p + vec2(e, 0.0)) - wNoise(p - vec2(e, 0.0)), wNoise(p + vec2(0.0, e)) - wNoise(p - vec2(0.0, e))) / (2.0 * e); }`
      )
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
        {
          vec2 p = vWaterW.xz;
          float fade = 1.0 - smoothstep(200.0, 2200.0, length(vWaterW - cameraPosition));
          vec2 g = wGrad(p * 0.09 + vec2(uTime * 0.05, uTime * 0.03)) * 0.55 + wGrad(p * 0.31 - vec2(uTime * 0.11, -uTime * 0.07)) * 0.3;
          vec3 wn = normalize(vec3(-g.x * 0.22 * fade, 1.0, -g.y * 0.22 * fade));
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }`
      );
  };
  m.customProgramCacheKey = () => "castelia-water";
  return m;
}

export function buildGround(plan: WorldPlan, cp: CasteliaPlan, shared: Shared, tex: GroundTextures): { meshes: THREE.Mesh[]; dispose(): void } {
  const out: THREE.Mesh[] = [];
  const own: THREE.Material[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry | null, m: THREE.Material, name: string, receive = true) => {
    if (!g) return;
    const mesh = new THREE.Mesh(g, m);
    mesh.name = name;
    mesh.receiveShadow = receive;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    out.push(mesh);
    geos.push(g);
  };
  const mk = (name: string, tile: number, opts?: { color?: string; normalScale?: number; bright?: number; glow?: number }) => {
    const m = new THREE.MeshStandardMaterial(tex.pbr(name, tile, opts));
    if (opts?.bright) m.color.multiplyScalar(opts.bright);
    // The streetlights' warm wash on the ground, evenly (the lamps themselves cast no light).
    m.emissive.set("#ffb070").multiplyScalar(opts?.glow ?? 0.035);
    groundVariation(m);
    own.push(m);
    return m;
  };
  const asphalt = mk("asphalt_02", 3, { color: "#6e6c72" });
  const walk = mk("large_grey_tiles", 3, { color: "#b9b4ad" });
  const granite = mk("granite_tile", 2.3, { color: "#e9e3da", bright: 1.25, glow: 0.06 });
  const plazaStone = mk("granite_tile", 2.3, { color: "#efe8dc", bright: 1.3, glow: 0.08 });
  plazaPattern(plazaStone, new THREE.Vector2(cp.centre.x, cp.centre.z), plan.plaza.r);
  const quay = mk("sandstone_blocks_08", 3, { color: "#9c968e" });
  const water = waterMaterial(shared);
  own.push(water);
  const S = CASTELIA_STREET;
  const L = cp.land;

  // ---- The bay: one great sheet under everything, the land standing out of it.
  {
    const g = new THREE.PlaneGeometry(24000, 24000, 1, 1).rotateX(-Math.PI / 2);
    g.translate((L.x0 + L.x1) / 2, -1.6, (L.z0 + L.z1) / 2);
    add(g, water, "bay", false);
  }
  // ---- Land: asphalt everywhere (the streets), quay walls along the shore.
  {
    const s = new Slabs();
    s.rect(L.x0, L.x1, L.z0, L.z1, -0.05);
    add(s.build(3), asphalt, "land");
    const wall = new Slabs();
    // The land's edges as kerbs 3 m deep: a quay wall down into the water.
    wall.rect(L.x0, L.x1, L.z0, L.z1, -0.04, 3);
    const g = wall.build(3);
    if (g) {
      // Keep only the walls (drop the top quad: the land already has one).
      const idx = g.index!.array as ArrayLike<number>;
      g.setIndex(Array.from(idx).slice(6));
      // Walls get UVs from x/z and y.
      const pos = g.attributes.position as THREE.BufferAttribute;
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + pos.getZ(i)) / 3, pos.getY(i) / 3);
      add(g, quay, "quay");
    }
  }
  // ---- Pavements: every block, the waterfront promenade (granite), the main street's kerbs.
  {
    const s = new Slabs();
    for (const b of cp.blocks) s.rect(b.x0, b.x1, b.z0, b.z1, 0.16, 0.2);
    // The main street's pavements, up to the plaza.
    const xEnd = plan.x1 + 4;
    s.rect(cp.promenade.x1, xEnd, S.road, S.facade + 0.5, 0.16, 0.2);
    s.rect(cp.promenade.x1, xEnd, -S.facade - 0.5, -S.road, 0.16, 0.2);
    add(s.build(3), walk, "pavements");
    const p = new Slabs();
    p.rect(cp.promenade.x0, cp.promenade.x1, cp.promenade.z0, cp.promenade.z1, 0.18, 0.2);
    // Mall Street: paved from wall to wall (no cars).
    p.rect(cp.mall.x - cp.mall.w / 2 - 1, cp.mall.x + cp.mall.w / 2 + 1, cp.mall.z0, cp.mall.z1, 0.17, 0.18);
    p.rect(cp.narrow.x - cp.narrow.w / 2 - 1, cp.narrow.x + cp.narrow.w / 2 + 1, cp.narrow.z0, cp.narrow.z1, 0.17, 0.18);
    add(p.build(2.3), granite, "promenade");
  }
  // ---- The median the line stands on (exactly at y = 0, winning the depth test against what is just below), and Central Plaza.
  {
    const s = new Slabs();
    // Up to the plaza's edge: inside, the line stands on the plaza's own paving.
    s.rect(cp.promenade.x1 - 2, plan.x1 - 1, -S.median, S.median, 0);
    const g = s.build(2.3);
    const m = granite.clone();
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1;
    m.polygonOffsetUnits = -2;
    own.push(m);
    add(g, m, "median");
    const disc = new THREE.CircleGeometry(plan.plaza.r + 6, 160).rotateX(-Math.PI / 2);
    disc.translate(cp.centre.x, 0, cp.centre.z);
    worldUv(disc, 2.3);
    const pm = plazaStone;
    pm.polygonOffset = true;
    pm.polygonOffsetFactor = -1;
    pm.polygonOffsetUnits = -2;
    add(disc, pm, "central-plaza");
  }
  // ---- Lines of light set into Central Plaza's paving: round the fountain's plaza, just inside the giants' ring and round the edge.
  {
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.55, 0.85), fog: true });
    own.push(glow);
    for (const rad of [cp.centre.r + 3, cp.inner.r1 + 8, cp.edge - 7]) {
      const g = new THREE.RingGeometry(rad - 0.3, rad + 0.3, Math.max(64, Math.round(rad * 1.2)), 1).rotateX(-Math.PI / 2);
      g.translate(cp.centre.x, 0.03, cp.centre.z);
      add(g, glow, "plaza-lights", false);
    }
  }
  // ---- Lane markings on the main street.
  {
    const dash = new THREE.MeshStandardMaterial({ color: "#d8d4c8", roughness: 0.6 });
    own.push(dash);
    const s = new Slabs();
    const xEnd = plan.x1 - 10;
    for (const z of [-(S.median + S.road) / 2, (S.median + S.road) / 2]) {
      for (let x = cp.promenade.x1 + 6; x < xEnd; x += 12) s.rect(x, x + 6, z - 0.09, z + 0.09, 0.01);
    }
    add(s.build(1), dash, "markings", true);
  }
  return {
    meshes: out,
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of own) m.dispose();
    },
  };
}
