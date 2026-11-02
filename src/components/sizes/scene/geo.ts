import * as THREE from "three";

/**
 * A growable mesh builder for the city: quads, boxes and prisms with flat
 * normals, UVs and a per-vertex tint, merged into one BufferGeometry per
 * material and chunk so a whole stretch of boulevard is a handful of draw
 * calls (and chunks behind the camera are culled).
 */
export class Geo {
  private p: number[] = [];
  private n: number[] = [];
  private u: number[] = [];
  private c: number[] = [];
  private i: number[] = [];
  get empty() { return this.i.length === 0; }

  private vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, col: THREE.Color) {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.u.push(u, v);
    this.c.push(col.r, col.g, col.b);
    return this.p.length / 3 - 1;
  }

  /** A quad a-b-c-d (counter-clockwise seen from its front), with UVs per corner. */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, uv: [number, number, number, number, number, number, number, number], col: THREE.Color) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    const i0 = this.vert(a.x, a.y, a.z, n.x, n.y, n.z, uv[0], uv[1], col);
    const i1 = this.vert(b.x, b.y, b.z, n.x, n.y, n.z, uv[2], uv[3], col);
    const i2 = this.vert(c.x, c.y, c.z, n.x, n.y, n.z, uv[4], uv[5], col);
    const i3 = this.vert(d.x, d.y, d.z, n.x, n.y, n.z, uv[6], uv[7], col);
    this.i.push(i0, i1, i2, i0, i2, i3);
  }

  /** A triangle (counter-clockwise from its front). */
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, uv: [number, number, number, number, number, number], col: THREE.Color) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    const i0 = this.vert(a.x, a.y, a.z, n.x, n.y, n.z, uv[0], uv[1], col);
    const i1 = this.vert(b.x, b.y, b.z, n.x, n.y, n.z, uv[2], uv[3], col);
    const i2 = this.vert(c.x, c.y, c.z, n.x, n.y, n.z, uv[4], uv[5], col);
    this.i.push(i0, i1, i2);
  }

  /**
   * An oriented box: centre (x, z), base y0, size (w along the facing's
   * right, h, d along the facing), turned by `yaw` (radians, 0 faces +z).
   * UVs are world metres / `tile` on every face (for tiling materials).
   */
  box(x: number, y0: number, z: number, w: number, h: number, d: number, yaw: number, col: THREE.Color, tile = 1, faces = 0b111111) {
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const P = (lx: number, ly: number, lz: number) => new THREE.Vector3(x + lx * cs + lz * sn, y0 + ly, z - lx * sn + lz * cs);
    const hw = w / 2, hd = d / 2;
    const c = [P(-hw, 0, hd), P(hw, 0, hd), P(hw, h, hd), P(-hw, h, hd), P(-hw, 0, -hd), P(hw, 0, -hd), P(hw, h, -hd), P(-hw, h, -hd)];
    const t = 1 / tile;
    // front (+z), back, right, left, top, bottom
    if (faces & 1) this.quad(c[0], c[1], c[2], c[3], [0, 0, w * t, 0, w * t, h * t, 0, h * t], col);
    if (faces & 2) this.quad(c[5], c[4], c[7], c[6], [0, 0, w * t, 0, w * t, h * t, 0, h * t], col);
    if (faces & 4) this.quad(c[1], c[5], c[6], c[2], [0, 0, d * t, 0, d * t, h * t, 0, h * t], col);
    if (faces & 8) this.quad(c[4], c[0], c[3], c[7], [0, 0, d * t, 0, d * t, h * t, 0, h * t], col);
    if (faces & 16) this.quad(c[3], c[2], c[6], c[7], [0, 0, w * t, 0, w * t, d * t, 0, d * t], col);
    if (faces & 32) this.quad(c[4], c[5], c[1], c[0], [0, 0, w * t, 0, w * t, d * t, 0, d * t], col);
  }

  /** Appends another builder's triangles (same material). */
  merge(o: Geo) {
    const base = this.p.length / 3;
    this.p.push(...o.p);
    this.n.push(...o.n);
    this.u.push(...o.u);
    this.c.push(...o.c);
    for (const k of o.i) this.i.push(k + base);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Keeps one Geo per (material, chunk) and turns them into meshes. Chunks are squares on the ground (x, z). */
export class Buckets {
  private map = new Map<string, Geo>();
  constructor(private chunkSize: number) {}
  at(material: string, x: number, z = 0): Geo {
    const key = `${material}|${Math.floor(x / this.chunkSize)},${Math.floor(z / this.chunkSize)}`;
    let g = this.map.get(key);
    if (!g) { g = new Geo(); this.map.set(key, g); }
    return g;
  }
  meshes(materials: Record<string, THREE.Material>, opts: { cast?: (m: string) => boolean; receive?: (m: string) => boolean } = {}): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [key, g] of this.map) {
      if (g.empty) continue;
      const name = key.slice(0, key.indexOf("|"));
      const mat = materials[name];
      if (!mat) throw new Error(`city: no material ${name}`);
      const mesh = new THREE.Mesh(g.build(), mat);
      mesh.name = key;
      mesh.castShadow = opts.cast ? opts.cast(name) : true;
      mesh.receiveShadow = opts.receive ? opts.receive(name) : true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      out.push(mesh);
    }
    this.map.clear();
    return out;
  }
}

/** Deterministic pseudo-random numbers (mulberry32), so the city is the same on every load and in every video. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
