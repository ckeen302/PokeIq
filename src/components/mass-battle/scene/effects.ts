import * as THREE from "three";

/**
 * Move effects, all of them 3D and all animated on the GPU: bursts of small
 * crystals (fire embers rise, water and ice fall, leaves spin…), beams for
 * moves fired from range (a zigzag for electric ones), shockwave rings on
 * the ground for spread moves, and the red Poké Ball beam that recalls a
 * fainted Pokémon. Each kind is one instanced draw with a ring buffer of
 * slots; spawning writes a few slots, the shader does the rest from the
 * battle clock (so slow motion slows the effects too).
 */

export interface TypeLook {
  color: THREE.Color;
  glow: THREE.Color;
  /** Vertical acceleration of its particles (m/s², + rises). */
  gravity: number;
  spin: number;
}

const look = (c: string, g: string, gravity: number, spin = 4): TypeLook => ({ color: new THREE.Color(c), glow: new THREE.Color(g), gravity, spin });

export const TYPE_LOOK: Record<string, TypeLook> = {
  Normal: look("#f4f1e8", "#ffffff", -6),
  Fire: look("#ff7a1a", "#ffd23a", 7, 3),
  Water: look("#2f8cff", "#a8e6ff", -12, 2),
  Electric: look("#ffe23a", "#fff8b0", -2, 9),
  Grass: look("#3fcf4a", "#b8ff7a", -2.5, 7),
  Ice: look("#8fe8ff", "#e6fbff", -10, 6),
  Fighting: look("#ff5a2e", "#ffc39a", -7),
  Poison: look("#b44cff", "#e6a8ff", 3, 2),
  Ground: look("#c8913c", "#f0d29a", -9, 2),
  Flying: look("#bfd8ff", "#ffffff", 1, 6),
  Psychic: look("#ff4fa3", "#ffc2e2", 1.5, 5),
  Bug: look("#a6d22e", "#e8ff9a", -4, 8),
  Rock: look("#a8916a", "#e0d0ae", -14, 3),
  Ghost: look("#7b5cff", "#c8b8ff", 3.5, 3),
  Dragon: look("#6c4cff", "#b6a6ff", 0, 5),
  Dark: look("#4a3a5e", "#9a84b8", -3, 4),
  Steel: look("#b8c4d6", "#ffffff", -10, 6),
  Fairy: look("#ff8fd6", "#fff0fa", 1.2, 6),
};
export const typeLook = (t: string) => TYPE_LOOK[t] ?? TYPE_LOOK.Normal;

const RED = new THREE.Color("#ff2236");
const RED_GLOW = new THREE.Color("#ff9aa6");

class Pool {
  readonly mesh: THREE.Mesh;
  readonly geo: THREE.InstancedBufferGeometry;
  readonly attrs: THREE.InstancedBufferAttribute[];
  private next = 0;
  private dirtyFrom = Infinity;
  private dirtyTo = -1;
  constructor(base: THREE.BufferGeometry, readonly capacity: number, names: string[], material: THREE.ShaderMaterial) {
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    for (const [k, v] of Object.entries(base.attributes)) this.geo.setAttribute(k, v);
    this.attrs = names.map((nm) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      this.geo.setAttribute(nm, a);
      return a;
    });
    // Every slot starts long dead (birth far in the past).
    const first = this.attrs[0].array as Float32Array;
    for (let i = 0; i < capacity; i++) first[i * 4 + 3] = -1e6;
    this.geo.instanceCount = capacity;
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
  }
  /** The next slot to write (overwrites the oldest). */
  slot(): number {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    if (i < this.dirtyFrom) this.dirtyFrom = i;
    if (i > this.dirtyTo) this.dirtyTo = i;
    return i;
  }
  set(attr: number, i: number, a: number, b: number, c: number, d: number) {
    const arr = this.attrs[attr].array as Float32Array;
    arr[i * 4] = a;
    arr[i * 4 + 1] = b;
    arr[i * 4 + 2] = c;
    arr[i * 4 + 3] = d;
  }
  flush() {
    if (this.dirtyTo < 0) return;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(this.dirtyFrom * 4, (this.dirtyTo - this.dirtyFrom + 1) * 4);
      a.needsUpdate = true;
    }
    this.dirtyFrom = Infinity;
    this.dirtyTo = -1;
  }
  dispose() {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

const SPARK_VS = `
uniform float uTime;
attribute vec4 aA; // start xyz, birth
attribute vec4 aB; // velocity xyz, life
attribute vec4 aC; // rgb, size
attribute vec4 aD; // gravity, spin, glow, -
varying vec3 vColor;
varying float vAlpha;
void main() {
  float age = uTime - aA.w;
  if (age < 0.0 || age > aB.w) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; vColor = vec3(0.0); return; }
  float k = age / aB.w;
  vec3 p = aA.xyz + aB.xyz * age + vec3(0.0, 0.5 * aD.x * age * age, 0.0);
  p.y = max(p.y, 0.03);
  float s = aC.w * (1.0 - 0.75 * k);
  float a = aD.y * age + aA.x * 3.1;
  vec3 q = position * s;
  q = vec3(q.x * cos(a) - q.y * sin(a), q.x * sin(a) + q.y * cos(a), q.z);
  q = vec3(q.x, q.y * cos(a * 0.7) - q.z * sin(a * 0.7), q.y * sin(a * 0.7) + q.z * cos(a * 0.7));
  vColor = aC.rgb * (1.0 + aD.z * (1.0 - k));
  vAlpha = 1.0 - k * k;
  gl_Position = projectionMatrix * viewMatrix * vec4(p + q, 1.0);
}`;

const GLOW_FS = `
varying vec3 vColor;
varying float vAlpha;
void main() {
  if (vAlpha <= 0.01) discard;
  gl_FragColor = vec4(vColor * vAlpha, vAlpha);
}`;

const BEAM_VS = `
uniform float uTime;
attribute vec4 aA; // from xyz, birth
attribute vec4 aB; // to xyz, life
attribute vec4 aC; // rgb, width
attribute vec4 aD; // zigzag, travel time, -, -
varying vec3 vColor;
varying float vAlpha;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float age = uTime - aA.w;
  if (age < 0.0 || age > aB.w) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; vColor = vec3(0.0); return; }
  float k = age / aB.w;
  vec3 axis = aB.xyz - aA.xyz;
  float len = max(0.001, length(axis));
  vec3 dir = axis / len;
  vec3 up = abs(dir.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 u = normalize(cross(dir, up));
  vec3 v = cross(u, dir);
  // The beam shoots out over its travel time, then thins away.
  float reach = clamp(age / max(0.001, aD.y), 0.0, 1.0);
  float along = position.y * reach;
  float w = aC.w * (0.35 + 0.65 * sin(min(1.0, k * 1.6) * 3.14159)) * (1.0 - k * 0.6);
  vec3 p = aA.xyz + dir * (along * len) + (u * position.x + v * position.z) * w;
  if (aD.x > 0.0) {
    float seg = floor(along * 9.0 + uTime * 30.0);
    p += (u * (hash(seg + aA.x) - 0.5) + v * (hash(seg * 1.7 + aA.z) - 0.5)) * aD.x * sin(along * 3.14159);
  }
  vColor = aC.rgb * 1.6;
  vAlpha = (1.0 - k) * 0.95;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const RING_VS = `
uniform float uTime;
attribute vec4 aA; // centre xyz, birth
attribute vec4 aB; // radius, life, -, -
attribute vec4 aC; // rgb, alpha
varying vec3 vColor;
varying float vAlpha;
void main() {
  float age = uTime - aA.w;
  if (age < 0.0 || age > aB.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; vColor = vec3(0.0); return; }
  float k = age / aB.y;
  float r = aB.x * (1.0 - (1.0 - k) * (1.0 - k));
  vec3 p = aA.xyz + vec3(position.x * r, 0.04 + position.y * 0.3 * (1.0 - k), position.z * r);
  vColor = aC.rgb;
  vAlpha = aC.w * (1.0 - k);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

function glowMaterial(vs: string, time: { value: number }, side: THREE.Side = THREE.FrontSide) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: time },
    vertexShader: vs,
    fragmentShader: GLOW_FS,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side,
  });
}

export class Effects {
  readonly group = new THREE.Group();
  readonly time = { value: 0 };
  private sparks: Pool;
  private beams: Pool;
  private rings: Pool;
  private seed = 1;
  /** Particle budget per burst scales with quality. */
  density = 1;

  constructor(capacity: number) {
    const crystal = new THREE.OctahedronGeometry(1, 0);
    this.sparks = new Pool(crystal, capacity, ["aA", "aB", "aC", "aD"], glowMaterial(SPARK_VS, this.time));
    const tube = new THREE.CylinderGeometry(1, 1, 1, 6, 8, true).translate(0, 0.5, 0);
    this.beams = new Pool(tube, Math.max(64, Math.floor(capacity / 8)), ["aA", "aB", "aC", "aD"], glowMaterial(BEAM_VS, this.time, THREE.DoubleSide));
    const ring = new THREE.TorusGeometry(1, 0.06, 4, 48).rotateX(Math.PI / 2);
    this.rings = new Pool(ring, Math.max(32, Math.floor(capacity / 24)), ["aA", "aB", "aC"], glowMaterial(RING_VS, this.time, THREE.DoubleSide));
    this.group.add(this.sparks.mesh, this.beams.mesh, this.rings.mesh);
    this.group.renderOrder = 3;
  }

  private rand() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /** A burst of `count` crystals of a type at a point, flung out at `power` m/s. */
  burst(type: string, x: number, y: number, z: number, count: number, power: number, size: number, at = this.time.value) {
    const L = typeLook(type);
    const n = Math.max(1, Math.round(count * this.density));
    for (let k = 0; k < n; k++) {
      const i = this.sparks.slot();
      const a = this.rand() * Math.PI * 2;
      const up = 0.2 + this.rand() * 0.9;
      const sp = power * (0.35 + this.rand() * 0.75);
      const c = this.rand() < 0.35 ? L.glow : L.color;
      this.sparks.set(0, i, x + (this.rand() - 0.5) * size, y + (this.rand() - 0.5) * size, z + (this.rand() - 0.5) * size, at + this.rand() * 0.04);
      this.sparks.set(1, i, Math.cos(a) * sp, up * sp * 0.9, Math.sin(a) * sp, 0.35 + this.rand() * 0.45);
      this.sparks.set(2, i, c.r, c.g, c.b, size * (0.12 + this.rand() * 0.14));
      this.sparks.set(3, i, L.gravity, L.spin * (this.rand() - 0.5) * 2, 0.6, 0);
    }
  }

  /** A beam from one point to another (a move fired from range). */
  beam(type: string, from: THREE.Vector3Like, to: THREE.Vector3Like, width: number, life = 0.32, at = this.time.value) {
    const L = typeLook(type);
    const i = this.beams.slot();
    this.beams.set(0, i, from.x, from.y, from.z, at);
    this.beams.set(1, i, to.x, to.y, to.z, life);
    this.beams.set(2, i, L.color.r, L.color.g, L.color.b, width);
    this.beams.set(3, i, type === "Electric" ? width * 2.2 : 0, Math.min(0.12, life * 0.4), 0, 0);
  }

  /** A shockwave on the ground. */
  ring(type: string, x: number, z: number, radius: number, life = 0.55, at = this.time.value) {
    const L = typeLook(type);
    const i = this.rings.slot();
    this.rings.set(0, i, x, 0, z, at);
    this.rings.set(1, i, radius, life, 0, 0);
    this.rings.set(2, i, L.color.r, L.color.g, L.color.b, 0.9);
  }

  /** The red Poké Ball beam that takes a fainted Pokémon back. */
  recall(x: number, y: number, z: number, h: number, at = this.time.value) {
    const i = this.beams.slot();
    this.beams.set(0, i, x, y + h * 0.5, z, at);
    this.beams.set(1, i, x, y + Math.max(6, h * 6), z, 0.75);
    this.beams.set(2, i, RED.r, RED.g, RED.b, Math.max(0.08, h * 0.16));
    this.beams.set(3, i, 0, 0.18, 0, 0);
    const n = Math.max(2, Math.round(6 * this.density));
    for (let k = 0; k < n; k++) {
      const s = this.sparks.slot();
      const a = this.rand() * Math.PI * 2;
      this.sparks.set(0, s, x + Math.cos(a) * h * 0.2, y + h * (0.2 + this.rand() * 0.6), z + Math.sin(a) * h * 0.2, at + 0.1 + this.rand() * 0.2);
      this.sparks.set(1, s, Math.cos(a) * 0.3, 2 + this.rand() * 2, Math.sin(a) * 0.3, 0.5 + this.rand() * 0.3);
      const c = this.rand() < 0.5 ? RED : RED_GLOW;
      this.sparks.set(2, s, c.r, c.g, c.b, Math.max(0.03, h * 0.07));
      this.sparks.set(3, s, 2, 6, 1, 0);
    }
  }

  setTime(t: number) {
    this.time.value = t;
    this.sparks.flush();
    this.beams.flush();
    this.rings.flush();
  }

  materials(): THREE.Material[] {
    return [this.sparks.mesh.material as THREE.Material, this.beams.mesh.material as THREE.Material, this.rings.mesh.material as THREE.Material];
  }

  dispose() {
    this.sparks.dispose();
    this.beams.dispose();
    this.rings.dispose();
  }
}
