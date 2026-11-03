import * as THREE from "three";

/**
 * Move effects, all of them 3D and all animated on the GPU. Each kind of
 * piece is one instanced draw with a ring buffer of slots: spawning writes
 * a few slots, the shader does the rest from the battle clock (so slow
 * motion slows the effects too, and nothing is touched per frame).
 *
 * - glow: soft balls of light (fire, energy, auras, projectiles in flight);
 * - smoke: dust, smoke, steam and gas, lit by the sun;
 * - sparks: streaks stretched along their flight (hit sparks, embers, spray);
 * - debris: solid lit chunks (rocks, ice, leaves, droplets) that bounce;
 * - beams: tubes from the attacker to its target (lightning zigzags);
 * - rings and walls: shockwaves on the ground and rising waves;
 * - marks: scorches, cracks, frost and puddles left on the ground;
 * - Poké Balls: the recall of a fainted Pokémon, with its red beam.
 *
 * The recipes per type (Fire, Water, Electric, Grass, Ice, Psychic, Dragon,
 * Ghost, Fighting, Ground and the rest) combine these pieces. A budget per
 * frame and a size check on screen keep a clash of thousands smooth.
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
  Normal: look("#ffe2b8", "#fff6e6", -6),
  Fire: look("#ff5a0a", "#ffd23a", 6, 3),
  Water: look("#2f8cff", "#b8ecff", -12, 2),
  Electric: look("#ffd81a", "#fffbd0", -2, 9),
  Grass: look("#3fcf4a", "#c8ff7a", -2.5, 7),
  Ice: look("#7fe0ff", "#eefcff", -10, 6),
  Fighting: look("#ff6a2e", "#ffd0a8", -7),
  Poison: look("#b44cff", "#f0b8ff", 2, 2),
  Ground: look("#c8913c", "#f0d29a", -9, 2),
  Flying: look("#cfe2ff", "#ffffff", 1, 6),
  Psychic: look("#ff3f9e", "#ffc8ea", 1.5, 5),
  Bug: look("#a6d22e", "#eeffa8", -4, 8),
  Rock: look("#a8916a", "#e8d8b8", -14, 3),
  Ghost: look("#7b4cff", "#d0c0ff", 2.5, 3),
  Dragon: look("#6a3cff", "#c0b0ff", 0.5, 5),
  Dark: look("#5a3a7e", "#c09ae8", -3, 4),
  Steel: look("#b8c8de", "#ffffff", -10, 6),
  Fairy: look("#ff8fd6", "#fff2fb", 1.2, 6),
};
export const typeLook = (t: string) => TYPE_LOOK[t] ?? TYPE_LOOK.Normal;

/** How a ranged move is drawn, from its name (pictures only: the battle maths never reads this). */
export type MoveStyle = "beam" | "bolt" | "stream" | "orb" | "sky" | "erupt" | "wave" | "wind" | "volley" | "strike";

export function moveStyle(name: string, type: string, contact: boolean): MoveStyle {
  if (contact) return "strike";
  const n = name.toLowerCase();
  if (/thunder$|^thunder |judgment|draco meteor|meteor|blizzard|hurricane|dragon rush|future sight|doom desire|sky attack/.test(n)) return "sky";
  if (/beam|ray|laser|prismatic|moongeist|photon|eternabeam|dynamax cannon/.test(n)) return "beam";
  if (/thunderbolt|bolt|shock|spark|zap|volt|discharge|charge/.test(n)) return "bolt";
  if (/thrower|gun|pump|cannon|spout|hydro|scald|flame|fire spin|whirlpool|steam|sludge wave|burn up|overheat|surf|muddy|bubble|hose|breath/.test(n)) return "stream";
  if (/edge|stone|rock|spike|pillar|eruption|precipice|earth power|bonemerang|crash|quake|tomb|slide|horn drill|fissure|drill run/.test(n)) return "erupt";
  if (/psychic|psyshock|confusion|extrasensory|psywave|nasty|dazzling|moonblast|boomburst|hyper voice|snarl|bug buzz|dark pulse|dragon pulse|water pulse|aura|heat wave|icy wind|sludge/.test(n) && !/ball|bomb|sphere/.test(n)) return "wave";
  if (/wind|gust|air|blade|cutter|slash|razor|leaf|petal|needle|pin|seed|shard|arrow|dart|star|swift|storm|hail|icicle|tornado/.test(n)) return "volley";
  if (/ball|bomb|sphere|blast|shot|orb|pulse|focus|energy|mist|shadow|fire|ember|wisp|gyro/.test(n)) return "orb";
  return type === "Electric" ? "bolt" : type === "Water" || type === "Fire" ? "stream" : "orb";
}

const RED = new THREE.Color("#ff2236");
const RED_GLOW = new THREE.Color("#ff9aa6");
const WHITE = new THREE.Color("#ffffff");
const DUST = new THREE.Color("#b89a72");
const tmpC = new THREE.Color();

interface Spawner {
  slot(): number;
  set(attr: number, i: number, a: number, b: number, c: number, d: number): void;
}

class Pool implements Spawner {
  readonly mesh: THREE.Mesh;
  readonly geo: THREE.InstancedBufferGeometry;
  readonly attrs: THREE.InstancedBufferAttribute[];
  private next = 0;
  private used = 0;
  private dirtyFrom = Infinity;
  private dirtyTo = -1;
  constructor(base: THREE.BufferGeometry, readonly capacity: number, names: string[], material: THREE.ShaderMaterial, private birthAttr = 0, private birthComp = 3) {
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
    const first = this.attrs[birthAttr].array as Float32Array;
    for (let i = 0; i < capacity; i++) first[i * 4 + birthComp] = -1e6;
    this.geo.instanceCount = 0;
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
  }
  /** The next slot to write (overwrites the oldest). */
  slot(): number {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    if (i + 1 > this.used) this.used = i + 1;
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
  /** Draws every slot once (for compiling before the battle). */
  primeAll() {
    this.geo.instanceCount = this.capacity;
  }
  flush() {
    this.geo.instanceCount = this.used;
    this.mesh.visible = this.used > 0;
    if (this.dirtyTo < 0) return;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(this.dirtyFrom * 4, (this.dirtyTo - this.dirtyFrom + 1) * 4);
      a.needsUpdate = true;
    }
    this.dirtyFrom = Infinity;
    this.dirtyTo = -1;
  }
  /** Forgets everything (a new battle: its clock starts again at 0). */
  clear() {
    for (const a of this.attrs) (a.array as Float32Array).fill(0);
    const birth = this.attrs[this.birthAttr].array as Float32Array;
    for (let i = 0; i < this.capacity; i++) birth[i * 4 + this.birthComp] = -1e6;
    this.next = 0;
    this.used = 0;
    this.dirtyFrom = Infinity;
    this.dirtyTo = -1;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.needsUpdate = true;
    }
  }
  dispose() {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

const DEAD = "gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; vColor = vec3(0.0);";

/** Soft balls of light: bursts, projectiles in flight, swirls. Additive, a bright core fading to a soft edge. */
const GLOW_VS = /* glsl */ `
uniform float uTime;
attribute vec4 aA; // start xyz, birth
attribute vec4 aB; // velocity xyz (or the target, in flight), life
attribute vec4 aC; // colour at birth, size at birth
attribute vec4 aD; // colour at death, size at death
attribute vec4 aE; // gravity (or arc height in flight), drag, flicker, mode (0 burst, 1 flight, 2 swirl)
varying vec3 vColor;
varying float vAlpha;
varying float vFres;
float h1(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float age = uTime - aA.w;
  if (age < 0.0 || age > aB.w) { ${DEAD} vFres = 0.0; return; }
  float k = age / aB.w;
  vec3 p;
  if (aE.w > 1.5) {
    // Swirl: round the start point, rising, the radius opening out.
    float ang = aB.x + age * aB.y;
    float r = aB.z * (0.3 + k);
    p = aA.xyz + vec3(cos(ang) * r, aE.x * age, sin(ang) * r);
  } else if (aE.w > 0.5) {
    // In flight from the start to the target, along an arc.
    float e = k * k * (3.0 - 2.0 * k) * 0.35 + k * 0.65;
    p = mix(aA.xyz, aB.xyz, e) + vec3(0.0, aE.x * 4.0 * e * (1.0 - e), 0.0);
  } else {
    float drag = max(aE.y, 0.001);
    float s = (1.0 - exp(-drag * age)) / drag;
    p = aA.xyz + aB.xyz * s + vec3(0.0, 0.5 * aE.x * age * age, 0.0);
    p.y = max(p.y, 0.05);
  }
  float flick = 1.0 + aE.z * (h1(floor(uTime * 24.0) + aA.x * 13.0) - 0.5);
  float size = mix(aC.w, aD.w, k) * flick;
  vec3 wp = p + position * size;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vec3 n = normalize(mat3(viewMatrix) * normal);
  vFres = max(dot(n, normalize(-mv.xyz)), 0.0);
  vColor = mix(aC.rgb, aD.rgb, k);
  // A projectile stays bright all the way to its target; everything else fades as it goes.
  vAlpha = aE.w > 0.5 && aE.w < 1.5 ? smoothstep(0.0, 0.03, age) * (1.0 - smoothstep(0.88, 1.0, k)) : (1.0 - k) * (1.0 - k) * smoothstep(0.0, 0.06, age);
  gl_Position = projectionMatrix * mv;
}`;

const GLOW_FS = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vFres;
void main() {
  float a = vAlpha * pow(vFres, 1.6);
  if (a <= 0.003) discard;
  // The core runs hot, the edge keeps its colour (pushed toward its strongest channel), so a pile of glows reads as
  // fire, water or psychic energy instead of burning out to white.
  float m = max(max(vColor.r, vColor.g), vColor.b);
  vec3 deep = vColor * vColor / max(m, 1e-3);
  vec3 c = mix(vColor, deep, smoothstep(0.25, 0.85, 1.0 - vFres) * 0.85);
  gl_FragColor = vec4(c * a, a);
}`;

/** Smoke and dust: soft lit puffs, alpha-blended (they darken as well as glow). */
const SMOKE_VS = /* glsl */ `
uniform float uTime;
uniform vec3 uSun;
attribute vec4 aA; // start xyz, birth
attribute vec4 aB; // velocity xyz, life
attribute vec4 aC; // colour, size at birth
attribute vec4 aD; // rise (m/s²), drag, size at death, opacity
varying vec3 vColor;
varying float vAlpha;
varying float vFres;
void main() {
  float age = uTime - aA.w;
  if (age < 0.0 || age > aB.w) { ${DEAD} vFres = 0.0; return; }
  float k = age / aB.w;
  float drag = max(aD.y, 0.001);
  float s = (1.0 - exp(-drag * age)) / drag;
  vec3 p = aA.xyz + aB.xyz * s + vec3(0.0, 0.5 * aD.x * age * age, 0.0);
  p.y = max(p.y, 0.0);
  float size = mix(aC.w, aD.z, 1.0 - (1.0 - k) * (1.0 - k));
  vec3 wp = p + position * size * vec3(1.0, 0.8, 1.0);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vec3 n = normalize(mat3(viewMatrix) * normal);
  vFres = max(dot(n, normalize(-mv.xyz)), 0.0);
  float lit = 0.62 + 0.38 * max(dot(normal, uSun), 0.0) + 0.12 * normal.y;
  vColor = aC.rgb * lit;
  vAlpha = aD.w * smoothstep(0.0, 0.12, k) * (1.0 - k);
  gl_Position = projectionMatrix * mv;
}`;

const SMOKE_FS = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vFres;
void main() {
  float a = vAlpha * smoothstep(0.0, 0.85, vFres);
  if (a <= 0.004) discard;
  gl_FragColor = vec4(vColor, a);
}`;

/** Sparks: little crystals stretched along their flight. */
const SPARK_VS = /* glsl */ `
uniform float uTime;
attribute vec4 aA; // start xyz, birth
attribute vec4 aB; // velocity xyz, life
attribute vec4 aC; // rgb, size
attribute vec4 aD; // gravity, drag, stretch, glow
varying vec3 vColor;
varying float vAlpha;
varying float vFres;
void main() {
  float age = uTime - aA.w;
  if (age < 0.0 || age > aB.w) { ${DEAD} vFres = 0.0; return; }
  float k = age / aB.w;
  float drag = max(aD.y, 0.001);
  float s = (1.0 - exp(-drag * age)) / drag;
  vec3 p = aA.xyz + aB.xyz * s + vec3(0.0, 0.5 * aD.x * age * age, 0.0);
  p.y = max(p.y, 0.03);
  vec3 vel = aB.xyz * exp(-drag * age) + vec3(0.0, aD.x * age, 0.0);
  float sp = length(vel);
  vec3 dir = sp > 1e-3 ? vel / sp : vec3(0.0, 1.0, 0.0);
  vec3 up = abs(dir.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 u = normalize(cross(dir, up));
  vec3 v = cross(u, dir);
  float size = aC.w * (1.0 - 0.6 * k);
  float len = size * (1.0 + sp * aD.z);
  vec3 wp = p + (u * position.x + v * position.z) * size + dir * position.y * len;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vFres = 1.0;
  vColor = aC.rgb * aD.w;
  vAlpha = 1.0 - k * k;
  gl_Position = projectionMatrix * mv;
}`;

const SPARK_FS = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vFres;
void main() {
  if (vAlpha <= 0.01) discard;
  gl_FragColor = vec4(vColor * vAlpha, vAlpha);
}`;

/** Debris: solid chunks, lit by the sun, tumbling and bouncing once. */
const DEBRIS_VS = /* glsl */ `
uniform float uTime;
uniform vec3 uSun;
uniform vec3 uSunColor;
uniform vec3 uSky;
uniform vec3 uGround;
attribute vec4 aA; // start xyz, birth
attribute vec4 aB; // velocity xyz, life
attribute vec4 aC; // rgb, size
attribute vec4 aD; // shape scale xyz, spin
attribute vec4 aE; // gravity, glow, -, -
varying vec3 vColor;
varying float vAlpha;
varying float vFres;
mat3 rotAxis(vec3 a, float t) {
  float c = cos(t), s = sin(t), ic = 1.0 - c;
  return mat3(c + a.x * a.x * ic, a.y * a.x * ic + a.z * s, a.z * a.x * ic - a.y * s,
              a.x * a.y * ic - a.z * s, c + a.y * a.y * ic, a.z * a.y * ic + a.x * s,
              a.x * a.z * ic + a.y * s, a.y * a.z * ic - a.x * s, c + a.z * a.z * ic);
}
void main() {
  float age = uTime - aA.w;
  if (age < 0.0 || age > aB.w) { ${DEAD} vFres = 0.0; return; }
  float k = age / aB.w;
  vec3 p = aA.xyz + aB.xyz * age + vec3(0.0, 0.5 * aE.x * age * age, 0.0);
  // Down on the ground it stops (a chunk lands, it doesn't sink).
  float landed = 0.0;
  float settled = 0.0;
  if (p.y < 0.0 && aE.x < 0.0) {
    float a = 0.5 * aE.x, b = aB.y, c = aA.y;
    float tl = (-b - sqrt(max(0.0, b * b - 4.0 * a * c))) / (2.0 * a);
    tl = clamp(tl, 0.0, age);
    p = aA.xyz + aB.xyz * tl + vec3(0.0, 0.5 * aE.x * tl * tl, 0.0);
    p.y = 0.0;
    landed = 1.0;
    settled = age - tl;
    age = tl + (age - tl) * 0.15;
  }
  vec3 axis = normalize(vec3(sin(aA.x * 7.1), cos(aA.z * 5.3), sin(aA.w * 3.7) + 0.2));
  mat3 R = rotAxis(axis, aD.w * age);
  // Landed pieces sink into the ground in a moment.
  float size = aC.w * (1.0 - smoothstep(0.75, 1.0, k)) * (1.0 - smoothstep(0.25, 0.7, settled));
  vec3 wp = p + R * (position * aD.xyz) * size + vec3(0.0, size * 0.4 * landed, 0.0);
  vec3 n = normalize(R * (normal / max(aD.xyz, vec3(0.05))));
  float sun = max(dot(n, uSun), 0.0);
  vec3 amb = mix(uGround, uSky, n.y * 0.5 + 0.5);
  vColor = aC.rgb * (uSunColor * sun + amb) + aC.rgb * aE.y;
  vAlpha = 1.0;
  vFres = 1.0;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const DEBRIS_FS = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vFres;
void main() {
  if (vAlpha <= 0.0) discard;
  gl_FragColor = vec4(vColor, 1.0);
}`;

/** Beams from the attacker to the target: they shoot out, then thin away; lightning zigzags and flickers. */
const BEAM_VS = /* glsl */ `
uniform float uTime;
attribute vec4 aA; // from xyz, birth
attribute vec4 aB; // to xyz, life
attribute vec4 aC; // rgb, width
attribute vec4 aD; // zigzag, travel time, wobble, core
varying vec3 vColor;
varying float vAlpha;
varying float vFres;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float age = uTime - aA.w;
  if (age < 0.0 || age > aB.w) { ${DEAD} vFres = 0.0; return; }
  float k = age / aB.w;
  vec3 axis = aB.xyz - aA.xyz;
  float len = max(0.001, length(axis));
  vec3 dir = axis / len;
  vec3 up = abs(dir.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 u = normalize(cross(dir, up));
  vec3 v = cross(u, dir);
  float reach = clamp(age / max(0.001, aD.y), 0.0, 1.0);
  float along = position.y * reach;
  float swell = 0.35 + 0.65 * sin(min(1.0, k * 1.8 + 0.1) * 3.14159);
  float w = aC.w * swell * (1.0 - k * 0.5) * (1.0 + 0.25 * sin(along * 30.0 - uTime * 40.0) * aD.z);
  vec3 p = aA.xyz + dir * (along * len) + (u * position.x + v * position.z) * w;
  if (aD.x > 0.0) {
    float seg = floor(along * 11.0 + floor(uTime * 26.0) * 3.0);
    float env = sin(along * 3.14159);
    p += (u * (hash(seg + aA.x) - 0.5) + v * (hash(seg * 1.7 + aA.z) - 0.5)) * aD.x * env;
  }
  if (aD.z > 0.0) p += v * sin(along * 12.0 - uTime * 18.0) * w * 0.4 * aD.z;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vec3 n = normalize(mat3(viewMatrix) * (u * position.x + v * position.z));
  vFres = max(dot(n, normalize(-mv.xyz)), 0.0);
  // A white-hot core, the type's colour round it.
  vColor = mix(aC.rgb * 2.2, vec3(2.6), aD.w * pow(vFres, 3.0));
  vAlpha = (1.0 - k * k) * (0.85 + 0.15 * hash(floor(uTime * 30.0) + aA.y));
  gl_Position = projectionMatrix * mv;
}`;

const BEAM_FS = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vFres;
void main() {
  float a = vAlpha * (0.25 + 0.75 * vFres);
  if (a <= 0.01) discard;
  gl_FragColor = vec4(vColor * a, a);
}`;

/** Rings on the ground: a shockwave's bright front racing outwards, ripples, glowing discs. */
const RING_VS = /* glsl */ `
uniform float uTime;
attribute vec4 aA; // centre xyz, birth
attribute vec4 aB; // radius, life, width, kind (0 shockwave, 1 glow disc, 2 ripples)
attribute vec4 aC; // rgb, strength
varying vec3 vColor;
varying float vAlpha;
varying float vFres;
varying vec2 vLocal;
varying float vR;
varying float vKind;
varying float vWidth;
void main() {
  float age = uTime - aA.w;
  if (age < 0.0 || age > aB.y) { ${DEAD} vFres = 0.0; vLocal = vec2(0.0); vR = 0.0; vKind = 0.0; vWidth = 0.0; return; }
  float k = age / aB.y;
  float r = aB.w > 0.5 && aB.w < 1.5 ? aB.x * (0.6 + 0.4 * sin(min(1.0, k * 3.0) * 1.5708)) : aB.x * (1.0 - (1.0 - k) * (1.0 - k) * (1.0 - k));
  vec3 p = aA.xyz + vec3(position.x * r, 0.05 + aA.y * 0.0, position.y * r);
  vLocal = position.xy;
  vR = r;
  vKind = aB.w;
  vWidth = aB.z;
  vColor = aC.rgb;
  vAlpha = aC.w * (1.0 - k) * smoothstep(0.0, 0.04, age);
  vFres = k;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const RING_FS = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vFres;
varying vec2 vLocal;
varying float vR;
varying float vKind;
varying float vWidth;
void main() {
  float d = length(vLocal);
  float a;
  if (vKind > 1.5) {
    a = pow(0.5 + 0.5 * sin(d * 18.0 - vFres * 22.0), 6.0) * smoothstep(1.0, 0.6, d) * smoothstep(0.0, 0.2, d);
  } else if (vKind > 0.5) {
    a = smoothstep(1.0, 0.0, d) * (0.6 + 0.4 * smoothstep(0.7, 0.95, d));
  } else {
    float w = clamp(vWidth / max(vR, 0.01), 0.03, 0.6);
    a = smoothstep(1.0 - w, 1.0 - w * 0.25, d) * smoothstep(1.0, 0.97, d) + smoothstep(1.0, 0.0, d) * 0.12;
  }
  a *= vAlpha;
  if (a <= 0.004) discard;
  gl_FragColor = vec4(vColor * a, a);
}`;

/** A rising wave or wall of energy round a spread move's user. */
const WALL_VS = /* glsl */ `
uniform float uTime;
attribute vec4 aA; // centre xyz, birth
attribute vec4 aB; // radius, life, height, -
attribute vec4 aC; // rgb, strength
varying vec3 vColor;
varying float vAlpha;
varying float vFres;
void main() {
  float age = uTime - aA.w;
  if (age < 0.0 || age > aB.y) { ${DEAD} vFres = 0.0; return; }
  float k = age / aB.y;
  float r = aB.x * (1.0 - (1.0 - k) * (1.0 - k));
  float hgt = aB.z * sin(min(1.0, k * 1.6) * 3.14159) * (1.0 - k * 0.4);
  float wav = 1.0 + 0.18 * sin(atan(position.z, position.x) * 7.0 + uTime * 6.0) * position.y;
  vec3 p = aA.xyz + vec3(position.x * r, position.y * hgt * wav, position.z * r);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vFres = position.y;
  vColor = aC.rgb;
  vAlpha = aC.w * (1.0 - k) * smoothstep(0.0, 0.05, age);
  gl_Position = projectionMatrix * mv;
}`;

const WALL_FS = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vFres;
void main() {
  float a = vAlpha * (1.0 - vFres) * (0.3 + 0.7 * smoothstep(0.0, 0.35, vFres));
  if (a <= 0.004) discard;
  gl_FragColor = vec4(vColor * a, a);
}`;

/** Marks on the ground: scorches, cracks, frost, puddles, craters. Alpha-blended over the terrain. */
const MARK_VS = /* glsl */ `
uniform float uTime;
attribute vec4 aA; // x, z, birth, life
attribute vec4 aB; // size, rotation, kind, strength
attribute vec4 aC; // rgb, glow
varying vec2 vUv;
varying float vAge;
varying float vK;
varying float vKind;
varying float vStrength;
varying vec3 vColor;
varying float vGlow;
varying float vSeed;
void main() {
  float age = uTime - aA.z;
  if (age < 0.0 || age > aA.w) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vUv = vec2(0.0); vAge = 0.0; vK = 1.0; vKind = 0.0; vStrength = 0.0; vColor = vec3(0.0); vGlow = 0.0; vSeed = 0.0; return; }
  float c = cos(aB.y), s = sin(aB.y);
  float grow = 0.55 + 0.45 * smoothstep(0.0, 0.18, age);
  vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * aB.x * grow;
  vUv = position.xy;
  vAge = age;
  vK = age / aA.w;
  vKind = aB.z;
  vStrength = aB.w;
  vColor = aC.rgb;
  vGlow = aC.w;
  vSeed = aA.x * 0.37 + aA.y * 0.71;
  gl_Position = projectionMatrix * viewMatrix * vec4(aA.x + q.x, 0.035, aA.y + q.y, 1.0);
}`;

const MARK_FS = /* glsl */ `
varying vec2 vUv;
varying float vAge;
varying float vK;
varying float vKind;
varying float vStrength;
varying vec3 vColor;
varying float vGlow;
varying float vSeed;
float mh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 mh2(vec2 p) { return vec2(mh(p), mh(p + 17.3)); }
float mn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mh(i), mh(i + vec2(1.0, 0.0)), u.x), mix(mh(i + vec2(0.0, 1.0)), mh(i + vec2(1.0, 1.0)), u.x), u.y); }
// Distance to the nearest cell edge of a Voronoi pattern (for cracks).
float edges(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = mh2(i + g + vSeed);
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return d2 - d1;
}
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float fade = 1.0 - smoothstep(0.7, 1.0, vK);
  float n = mn(vUv * 3.0 + vSeed) * 0.6 + mn(vUv * 7.0 - vSeed) * 0.4;
  float edge = smoothstep(1.0, 0.55 + n * 0.3, r);
  vec3 col = vColor;
  float a = 0.0;
  vec3 glow = vec3(0.0);
  if (vKind < 0.5) {
    // Scorch: dark and sooty, embers glowing in the middle at first.
    a = edge * (0.55 + 0.3 * n);
    glow = vec3(1.0, 0.35, 0.05) * vGlow * smoothstep(0.6, 0.0, r) * exp(-vAge * 1.2) * (0.6 + n);
  } else if (vKind < 1.5) {
    // Cracks: jagged lines running out from the middle (a Voronoi web), darker near the centre.
    vec2 p = vUv * 3.2;
    float e = edges(p + vec2(mn(p * 2.0), mn(p * 2.0 + 4.0)) * 0.35);
    float line = 1.0 - smoothstep(0.02, 0.09 * (1.2 - r), e);
    float spoke = smoothstep(0.92, 1.0, sin(atan(vUv.y, vUv.x) * 7.0 + n * 3.0) * 0.5 + 0.5) * smoothstep(1.0, 0.2, r);
    a = max(line, spoke * 0.7) * smoothstep(1.0, 0.3, r) + smoothstep(0.35, 0.0, r) * 0.35;
    glow = vColor * vGlow * max(line, spoke) * exp(-vAge * 0.8) * smoothstep(1.0, 0.2, r);
    col = vec3(0.08, 0.06, 0.05);
  } else if (vKind < 2.5) {
    // Frost: pale, glittering crystals.
    float c = smoothstep(0.55, 0.9, mn(vUv * 14.0 + vSeed));
    a = edge * (0.45 + 0.4 * c);
    col = mix(vec3(0.82, 0.93, 1.0), vec3(1.0), c);
    glow = vec3(0.5, 0.8, 1.0) * c * 0.3 * exp(-vAge * 0.5);
  } else if (vKind < 3.5) {
    // Puddle: dark and wet with a bright rim of sky.
    a = edge * 0.55;
    col = mix(vColor * 0.35, vec3(0.75, 0.85, 1.0), smoothstep(0.7, 0.95, r) * 0.5);
  } else {
    // Crater: a dark bowl with a raised lighter rim.
    float rim = smoothstep(0.55, 0.8, r) * smoothstep(1.0, 0.82, r);
    a = max(smoothstep(0.75, 0.0, r) * 0.6, rim * 0.5) * (0.7 + 0.3 * n);
    col = mix(vColor * 0.3, vColor * 1.25, rim);
  }
  a *= vStrength * fade;
  if (a <= 0.004 && dot(glow, glow) < 1e-4) discard;
  gl_FragColor = vec4(col + glow * 2.0 / max(a, 0.05), clamp(a, 0.0, 1.0));
}`;

/** The Poké Ball: red top, white bottom, a black band and its button facing the camera. Pops in, wobbles, shrinks away. */
const BALL_VS = /* glsl */ `
uniform float uTime;
uniform vec3 uSun;
attribute vec4 aA; // x, y, z, birth
attribute vec4 aB; // size, life, -, -
varying vec3 vN;
varying vec3 vP;
varying float vAlpha;
varying vec3 vSunDir;
void main() {
  float age = uTime - aA.w;
  if (age < 0.0 || age > aB.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vN = vec3(0.0); vP = vec3(0.0); vAlpha = 0.0; vSunDir = vec3(0.0); return; }
  float k = age / aB.y;
  float pop = age < 0.18 ? 1.0 + 0.25 * sin(age / 0.18 * 3.14159) : 1.0;
  float scale = aB.x * smoothstep(0.0, 0.12, age) * pop * (1.0 - smoothstep(0.82, 1.0, k));
  // Turn the button toward the camera, with a wobble as it takes the Pokémon in.
  vec3 toCam = normalize(vec3(cameraPosition.x - aA.x, 0.0, cameraPosition.z - aA.z));
  float yaw = atan(toCam.x, toCam.z);
  float wob = sin(age * 22.0) * 0.35 * smoothstep(0.35, 0.5, k) * (1.0 - smoothstep(0.7, 0.8, k));
  vec3 q = position;
  float cw = cos(wob), sw = sin(wob);
  q = vec3(q.x * cw - q.y * sw, q.x * sw + q.y * cw, q.z);
  vec3 nq = vec3(normal.x * cw - normal.y * sw, normal.x * sw + normal.y * cw, normal.z);
  float cy = cos(yaw), sy = sin(yaw);
  vec3 wq = vec3(q.x * cy + q.z * sy, q.y, -q.x * sy + q.z * cy);
  vec3 wn = vec3(nq.x * cy + nq.z * sy, nq.y, -nq.x * sy + nq.z * cy);
  vP = position;
  vN = normalize(mat3(viewMatrix) * wn);
  vSunDir = normalize(mat3(viewMatrix) * uSun);
  vAlpha = 1.0;
  gl_Position = projectionMatrix * viewMatrix * vec4(aA.xyz + wq * scale + vec3(0.0, sin(age * 3.0) * 0.04 * aB.x * 4.0, 0.0), 1.0);
}`;

const BALL_FS = /* glsl */ `
uniform vec3 uSunColor;
uniform vec3 uSky;
varying vec3 vN;
varying vec3 vP;
varying float vAlpha;
varying vec3 vSunDir;
void main() {
  if (vAlpha <= 0.0) discard;
  vec3 col = vP.y > 0.0 ? vec3(0.86, 0.06, 0.08) : vec3(0.92, 0.93, 0.95);
  float band = smoothstep(0.075, 0.06, abs(vP.y));
  float bd = length(vec2(vP.x, vP.y));
  float front = smoothstep(0.0, 0.3, vP.z);
  float ring = smoothstep(0.36, 0.33, bd) * front;
  float button = smoothstep(0.22, 0.2, bd) * front;
  col = mix(col, vec3(0.05), max(band, ring));
  col = mix(col, vec3(0.95), button);
  vec3 n = normalize(vN);
  float sun = max(dot(n, vSunDir), 0.0);
  vec3 lit = col * (uSunColor * sun * 0.9 + uSky * 0.55);
  float spec = pow(max(dot(reflect(-vSunDir, n), vec3(0.0, 0.0, 1.0)), 0.0), 40.0);
  lit += vec3(1.0) * spec * 1.2 + vec3(1.0, 0.3, 0.3) * button * 0.6;
  gl_FragColor = vec4(lit, 1.0);
}`;

function fxMaterial(vs: string, fs: string, uniforms: Record<string, THREE.IUniform>, blending: THREE.Blending, opts: { side?: THREE.Side; transparent?: boolean; depthWrite?: boolean } = {}) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vs,
    fragmentShader: fs,
    transparent: opts.transparent ?? true,
    depthWrite: opts.depthWrite ?? false,
    blending,
    side: opts.side ?? THREE.FrontSide,
  });
}

export interface FxLight {
  sun: THREE.Vector3;
  sunColor: THREE.Color;
  sky: THREE.Color;
  ground: THREE.Color;
}

export interface EffectCaps {
  glow: number;
  smoke: number;
  sparks: number;
  debris: number;
  beams: number;
  rings: number;
  walls: number;
  marks: number;
  balls: number;
}

/** Pool sizes for a particle budget. */
export function effectCaps(particles: number): EffectCaps {
  return {
    glow: Math.round(particles * 0.6),
    smoke: Math.round(particles * 0.35),
    sparks: Math.round(particles * 1.0),
    debris: Math.round(particles * 0.3),
    beams: Math.max(96, Math.round(particles / 14)),
    rings: Math.max(64, Math.round(particles / 24)),
    walls: 24,
    marks: Math.max(96, Math.round(particles / 16)),
    balls: Math.max(64, Math.round(particles / 20)),
  };
}

type V3 = THREE.Vector3Like;

export class Effects {
  readonly group = new THREE.Group();
  readonly time = { value: 0 };
  readonly light = {
    uSun: { value: new THREE.Vector3(0.4, 0.8, 0.45).normalize() },
    uSunColor: { value: new THREE.Color(2.4, 2.3, 2.1) },
    uSky: { value: new THREE.Color(0.55, 0.65, 0.8) },
    uGround: { value: new THREE.Color(0.35, 0.3, 0.25) },
  };
  private glow: Pool;
  private smoke: Pool;
  private sparks: Pool;
  private debris: Pool;
  private beams: Pool;
  private rings: Pool;
  private walls: Pool;
  private marks: Pool;
  private balls: Pool;
  private pools: Pool[];
  private seed = 1;
  /** Particle budget per burst scales with quality. */
  density = 1;
  /** Pieces still allowed this frame (refilled each frame). */
  private budget = 400;
  private budgetMax = 400;
  /** For the size check: the camera, and px per metre at 1 m. */
  private cam = new THREE.Vector3();
  private pxPerM = 800;
  /** Ground marks can be switched off (the lightest quality). */
  marksOn = true;
  /** The colour of this arena's dust (sand, earth, ash, snow). */
  dustColor = DUST.clone();

  constructor(caps: EffectCaps) {
    const t = this.time;
    const L = this.light;
    const ico = new THREE.IcosahedronGeometry(1, 1);
    const ico0 = new THREE.IcosahedronGeometry(1, 1);
    this.glow = new Pool(ico, caps.glow, ["aA", "aB", "aC", "aD", "aE"], fxMaterial(GLOW_VS, GLOW_FS, { uTime: t }, THREE.AdditiveBlending));
    this.smoke = new Pool(ico0, caps.smoke, ["aA", "aB", "aC", "aD"], fxMaterial(SMOKE_VS, SMOKE_FS, { uTime: t, uSun: L.uSun }, THREE.NormalBlending));
    const spark = new THREE.OctahedronGeometry(1, 0);
    this.sparks = new Pool(spark, caps.sparks, ["aA", "aB", "aC", "aD"], fxMaterial(SPARK_VS, SPARK_FS, { uTime: t }, THREE.AdditiveBlending));
    const chunk = new THREE.DodecahedronGeometry(1, 0);
    this.debris = new Pool(chunk, caps.debris, ["aA", "aB", "aC", "aD", "aE"], fxMaterial(DEBRIS_VS, DEBRIS_FS, { uTime: t, ...L }, THREE.NormalBlending, { transparent: false, depthWrite: true }));
    const tube = new THREE.CylinderGeometry(1, 1, 1, 8, 14, true).translate(0, 0.5, 0);
    this.beams = new Pool(tube, caps.beams, ["aA", "aB", "aC", "aD"], fxMaterial(BEAM_VS, BEAM_FS, { uTime: t }, THREE.AdditiveBlending, { side: THREE.DoubleSide }));
    const disc = new THREE.CircleGeometry(1, 48);
    this.rings = new Pool(disc, caps.rings, ["aA", "aB", "aC"], fxMaterial(RING_VS, RING_FS, { uTime: t }, THREE.AdditiveBlending, { side: THREE.DoubleSide }));
    const band = new THREE.CylinderGeometry(1, 1, 1, 48, 4, true).translate(0, 0.5, 0);
    this.walls = new Pool(band, caps.walls, ["aA", "aB", "aC"], fxMaterial(WALL_VS, WALL_FS, { uTime: t }, THREE.AdditiveBlending, { side: THREE.DoubleSide }));
    const quad = new THREE.PlaneGeometry(2, 2);
    const markMat = fxMaterial(MARK_VS, MARK_FS, { uTime: t }, THREE.NormalBlending);
    markMat.polygonOffset = true;
    markMat.polygonOffsetFactor = -2;
    markMat.polygonOffsetUnits = -2;
    this.marks = new Pool(quad, caps.marks, ["aA", "aB", "aC"], markMat, 0, 2);
    const sphere = new THREE.SphereGeometry(1, 20, 14);
    this.balls = new Pool(sphere, caps.balls, ["aA", "aB"], fxMaterial(BALL_VS, BALL_FS, { uTime: t, ...L }, THREE.NormalBlending, { transparent: false, depthWrite: true }));
    this.pools = [this.marks, this.rings, this.debris, this.balls, this.smoke, this.walls, this.glow, this.sparks, this.beams];
    // Draw order: ground marks first, then solids, then the soft and glowing pieces over them.
    this.pools.forEach((p, i) => {
      p.mesh.renderOrder = 3 + i;
      this.group.add(p.mesh);
    });
    this.marks.mesh.renderOrder = 1;
  }

  private rand() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }
  private rs(a = 1) {
    return (this.rand() - 0.5) * 2 * a;
  }

  /** Pieces for a spawn of `n`, scaled down far away, off screen and when the frame's budget runs low. */
  private count(n: number, at: V3, size: number): number {
    if (n <= 0) return 0;
    const d = Math.max(1, Math.hypot(at.x - this.cam.x, at.y - this.cam.y, at.z - this.cam.z));
    const px = (size * this.pxPerM) / d;
    if (px < 1.2) return 0;
    const lod = px < 6 ? 0.3 : px < 18 ? 0.6 : 1;
    const want = Math.max(1, Math.round(n * this.density * lod));
    const got = Math.min(want, Math.max(0, Math.floor(this.budget)));
    this.budget -= got;
    return got;
  }

  /** Refills the frame's budget and notes the camera (call once a frame before spawning). */
  frame(camera: THREE.PerspectiveCamera, viewportH: number) {
    this.cam.copy(camera.position);
    this.pxPerM = viewportH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    this.budget = this.budgetMax * this.density;
  }

  setBudget(perFrame: number) {
    this.budgetMax = perFrame;
  }

  // ---- The pieces.

  private puff(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, c0: THREE.Color, s0: number, c1: THREE.Color, s1: number, gravity: number, drag: number, flicker: number, at: number, k0 = 1, k1 = 1) {
    const i = this.glow.slot();
    this.glow.set(0, i, x, y, z, at);
    this.glow.set(1, i, vx, vy, vz, life);
    this.glow.set(2, i, c0.r * k0, c0.g * k0, c0.b * k0, s0);
    this.glow.set(3, i, c1.r * k1, c1.g * k1, c1.b * k1, s1);
    this.glow.set(4, i, gravity, drag, flicker, 0);
  }

  /** A ball of light flying from one point to another (a projectile). */
  private flight(from: V3, to: V3, life: number, c: THREE.Color, size: number, arc: number, at: number, k = 2.5) {
    const i = this.glow.slot();
    this.glow.set(0, i, from.x, from.y, from.z, at);
    this.glow.set(1, i, to.x, to.y, to.z, life);
    this.glow.set(2, i, c.r * k, c.g * k, c.b * k, size * 0.7);
    this.glow.set(3, i, c.r * k, c.g * k, c.b * k, size);
    this.glow.set(4, i, arc, 0, 0.3, 1);
  }

  private swirl(x: number, y: number, z: number, angle: number, spin: number, radius: number, rise: number, life: number, c: THREE.Color, size: number, at: number, k = 1.6) {
    const i = this.glow.slot();
    this.glow.set(0, i, x, y, z, at);
    this.glow.set(1, i, angle, spin, radius, life);
    this.glow.set(2, i, c.r * k, c.g * k, c.b * k, size);
    this.glow.set(3, i, c.r * k * 0.5, c.g * k * 0.5, c.b * k * 0.5, size * 0.4);
    this.glow.set(4, i, rise, 0, 0.2, 2);
  }

  private cloud(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, c: THREE.Color, s0: number, s1: number, rise: number, drag: number, opacity: number, at: number) {
    const i = this.smoke.slot();
    this.smoke.set(0, i, x, y, z, at);
    this.smoke.set(1, i, vx, vy, vz, life);
    this.smoke.set(2, i, c.r, c.g, c.b, s0);
    this.smoke.set(3, i, rise, drag, s1, opacity);
  }

  private spark(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, c: THREE.Color, size: number, gravity: number, drag: number, stretch: number, glow: number, at: number) {
    const i = this.sparks.slot();
    this.sparks.set(0, i, x, y, z, at);
    this.sparks.set(1, i, vx, vy, vz, life);
    this.sparks.set(2, i, c.r, c.g, c.b, size);
    this.sparks.set(3, i, gravity, drag, stretch, glow);
  }

  private chunk(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, c: THREE.Color, size: number, sx: number, sy: number, sz: number, spin: number, gravity: number, glow: number, at: number) {
    const i = this.debris.slot();
    this.debris.set(0, i, x, y, z, at);
    this.debris.set(1, i, vx, vy, vz, life);
    this.debris.set(2, i, c.r, c.g, c.b, size);
    this.debris.set(3, i, sx, sy, sz, spin);
    this.debris.set(4, i, gravity, glow, 0, 0);
  }

  private ringAt(x: number, z: number, radius: number, life: number, width: number, kind: number, c: THREE.Color, strength: number, at: number) {
    const i = this.rings.slot();
    this.rings.set(0, i, x, 0, z, at);
    this.rings.set(1, i, radius, life, width, kind);
    this.rings.set(2, i, c.r, c.g, c.b, strength);
  }

  private wallAt(x: number, z: number, radius: number, life: number, height: number, c: THREE.Color, strength: number, at: number) {
    const i = this.walls.slot();
    this.walls.set(0, i, x, 0, z, at);
    this.walls.set(1, i, radius, life, height, 0);
    this.walls.set(2, i, c.r, c.g, c.b, strength);
  }

  /** Kinds: 0 scorch, 1 cracks, 2 frost, 3 puddle, 4 crater. */
  mark(kind: number, x: number, z: number, size: number, life: number, strength: number, c: THREE.Color, glow: number, at = this.time.value) {
    if (!this.marksOn) return;
    const d = Math.hypot(x - this.cam.x, z - this.cam.z) + Math.abs(this.cam.y);
    if ((size * this.pxPerM) / Math.max(1, d) < 3) return;
    const i = this.marks.slot();
    this.marks.set(0, i, x, z, at, life);
    this.marks.set(1, i, size, this.rand() * Math.PI * 2, kind, strength);
    this.marks.set(2, i, c.r, c.g, c.b, glow);
  }

  private beamAt(from: V3, to: V3, c: THREE.Color, width: number, life: number, travel: number, zigzag: number, wobble: number, core: number, at: number) {
    const i = this.beams.slot();
    this.beams.set(0, i, from.x, from.y, from.z, at);
    this.beams.set(1, i, to.x, to.y, to.z, life);
    this.beams.set(2, i, c.r, c.g, c.b, width);
    this.beams.set(3, i, zigzag, travel, wobble, core);
  }

  // ---- What the battle calls.

  /**
   * A ranged move leaving its user, timed to land at `at + travel`: a beam, a bolt, a stream, a projectile, a strike
   * from the sky, rocks erupting under the target, a wave. Returns the travel time (the impact follows it).
   */
  launch(type: string, style: MoveStyle, from: V3, to: V3, size: number, arrive = this.time.value): number {
    const L = typeLook(type);
    let at = arrive;
    const dist = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    const w = Math.max(0.05, Math.min(0.7, size * 0.09));
    switch (style) {
      case "beam": {
        const travel = this.lead(Math.min(0.16, 0.05 + dist * 0.01), arrive);
        at = arrive - travel;
        this.beamAt(from, to, L.color, w * 1.3, 0.45, travel, 0, 0, 1, at);
        this.beamAt(from, to, L.glow, w * 0.45, 0.4, travel, 0, 0, 1, at);
        if (this.count(1, from, size) > 0) this.puff(from.x, from.y, from.z, 0, 0, 0, 0.35, L.glow, w * 2.5, L.color, w * 4, 0, 1, 0.4, at, 3, 1.5);
        return travel;
      }
      case "bolt": {
        const travel = this.lead(0.05, arrive);
        at = arrive - travel;
        this.beamAt(from, to, L.color, w * 0.7, 0.3, travel, Math.max(0.15, dist * 0.06), 0, 1, at);
        this.beamAt(from, to, L.glow, w * 0.35, 0.22, travel, Math.max(0.1, dist * 0.04), 0, 1, at + 0.06);
        return travel;
      }
      case "stream": {
        const travel = this.lead(Math.min(0.22, 0.08 + dist * 0.015), arrive);
        at = arrive - travel;
        this.beamAt(from, to, L.color, w * 1.6, 0.5, travel, 0, 1, 0.5, at);
        const n = this.count(5, from, size);
        for (let k = 0; k < n; k++) {
          const e = (k + 1) / (n + 1);
          const p = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, z: from.z + (to.z - from.z) * e };
          this.puff(p.x, p.y, p.z, this.rs(0.6), this.rs(0.4) + 0.4, this.rs(0.6), 0.35 + this.rand() * 0.2, L.glow, w * 1.6, L.color, w * 3.2, L.gravity * 0.2, 2, 0.5, at + travel * e, 2.2, 1.2);
        }
        return travel;
      }
      case "sky": {
        // From high above (Thunder, Judgment, Draco Meteor, Blizzard…).
        const top = { x: to.x + this.rs(2), y: to.y + 14 + size * 3, z: to.z + this.rs(2) };
        const travel = this.lead(type === "Dragon" || type === "Rock" ? 0.3 : 0.1, arrive);
        at = arrive - travel;
        if (type === "Electric" || type === "Normal" || type === "Flying") {
          this.beamAt(top, to, type === "Normal" ? WHITE : L.color, w * 1.6, 0.4, travel, type === "Electric" ? 1.8 : 0, 0, 1, at);
          this.beamAt(top, to, L.glow, w * 0.6, 0.35, travel, type === "Electric" ? 1.2 : 0, 0, 1, at);
        } else {
          const n = this.count(3, to, size);
          for (let k = 0; k < n; k++) this.flight({ x: top.x + this.rs(3), y: top.y, z: top.z + this.rs(3) }, { x: to.x + this.rs(0.8), y: to.y, z: to.z + this.rs(0.8) }, travel + k * 0.05, L.color, w * 2.4, 0, at - k * 0.03);
        }
        return travel;
      }
      case "erupt": {
        // The ground bursts under the target: rocks shoot up round it.
        at = Math.max(this.time.value, arrive - 0.08);
        const n = this.count(6, to, size);
        const c = type === "Ground" ? this.dustColor : L.color;
        for (let k = 0; k < n; k++) {
          const a = this.rand() * Math.PI * 2, r = this.rand() * size * 0.5;
          this.chunk(to.x + Math.cos(a) * r, 0, to.z + Math.sin(a) * r, Math.cos(a) * 1.5, 6 + this.rand() * 5, Math.sin(a) * 1.5, 1.0, c, Math.min(0.35, Math.max(0.06, size * (0.05 + this.rand() * 0.06))), 1, 1.6, 1, 4, -18, 0, at);
        }
        return arrive - at;
      }
      case "wave": {
        const travel = this.lead(Math.min(0.25, 0.08 + dist * 0.02), arrive);
        at = arrive - travel;
        // Rings of energy rolling out from the user to the target.
        const n = this.count(3, to, size);
        for (let k = 0; k < n; k++) {
          const e = (k + 1) / (n + 1);
          this.puff(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e, from.z + (to.z - from.z) * e, 0, 0, 0, 0.3, L.glow, w * 2, L.color, w * 6, 0, 1, 0.2, at + travel * e, 1.6, 0.8);
        }
        return travel;
      }
      case "volley": {
        const travel = this.lead(Math.min(0.3, 0.1 + dist * 0.02), arrive);
        at = arrive - travel;
        const n = this.count(4, from, size);
        for (let k = 0; k < n; k++) {
          const d = { x: to.x + this.rs(0.4), y: to.y + this.rs(0.3), z: to.z + this.rs(0.4) };
          this.flight(from, d, travel + this.rand() * 0.06, L.color, w * 0.8, 0.3 + this.rand() * 0.4, at + k * 0.03, 2);
        }
        return travel;
      }
      case "orb":
      default: {
        const travel = this.lead(Math.min(0.35, 0.12 + dist * 0.025), arrive);
        at = arrive - travel;
        this.flight(from, to, travel, L.color, w * 2.2, Math.min(1.5, dist * 0.08), at, 2.6);
        this.flight(from, to, travel, L.glow, w * 1.1, Math.min(1.5, dist * 0.08), at, 3.4);
        return travel;
      }
    }
  }

  /** How long a launch flies: its natural time, or what's left before it lands. */
  private lead(natural: number, arrive: number) {
    return Math.max(0.03, Math.min(natural, arrive - this.time.value));
  }

  /** A hit landing: sparks and pieces of its type, scaled by how hard it hit (`power` 0..1) and the figures' size. */
  impact(type: string, x: number, y: number, z: number, size: number, power: number, crit: boolean, at = this.time.value) {
    const L = typeLook(type);
    const s = Math.max(0.25, size);
    const p = Math.min(1, power);
    const at3 = { x, y, z };
    const n = this.count(Math.round(4 + p * 10) + (crit ? 6 : 0), at3, s);
    if (n <= 0) return;
    const speed = 1.5 + p * 4 + s;
    // A flash of light at the point of impact.
    this.puff(x, y, z, 0, 0, 0, 0.16 + p * 0.1, tmpC.copy(L.glow).lerp(L.color, 0.6), s * 0.12, L.color, s * (0.26 + p * 0.3), 0, 1, 0.5, at, 1.4 + p * 0.8, 1);
    this.ringAt(x, z, s * (0.45 + p * 0.5), 0.35, s * 0.08, 0, L.color, 0.9, at);
    if (crit) this.puff(x, y, z, 0, 0, 0, 0.28, WHITE, s * 0.2, L.glow, s * 0.75, 0, 1, 0.6, at, 3.6, 1.4);
    // Type-specific pieces.
    switch (type) {
      case "Fire": {
        for (let k = 0; k < n; k++) {
          const a = this.rand() * Math.PI * 2, u = 0.3 + this.rand();
          this.puff(x + this.rs(s * 0.2), y + this.rs(s * 0.2), z + this.rs(s * 0.2), Math.cos(a) * speed * 0.35, u * speed * 0.45, Math.sin(a) * speed * 0.35, 0.5 + this.rand() * 0.4, tmpC.set(k % 3 ? "#ffb02a" : "#ffe27a"), s * 0.22, L.color, s * (0.38 + this.rand() * 0.3), 3.5, 2.5, 0.6, at, 1.45, 1.15);
        }
        for (let k = 0; k < n; k++) this.spark(x, y, z, this.rs(speed), this.rand() * speed, this.rs(speed), 0.6 + this.rand() * 0.6, L.glow, s * 0.025, 2.5, 1.2, 0.04, 2.4, at);
        this.cloud(x, y + s * 0.2, z, 0, 0.6, 0, 1.6, tmpC.set("#3a3330"), s * 0.25, s * 0.9, 0.4, 1, 0.35, at + 0.15);
        if (p > 0.3) this.mark(0, x, z, s * (0.5 + p * 0.5), 6, 0.7, tmpC.set("#1a1410"), 1, at);
        break;
      }
      case "Water": {
        for (let k = 0; k < n; k++) {
          const a = this.rand() * Math.PI * 2;
          this.chunk(x, y, z, Math.cos(a) * speed * 0.6, 2 + this.rand() * speed, Math.sin(a) * speed * 0.6, 0.9, tmpC.set(k % 3 ? "#5aa8ff" : "#d8f2ff"), s * (0.04 + this.rand() * 0.04), 1, 1, 1, 2, -14, 0.6, at);
        }
        for (let k = 0; k < n; k++) this.spark(x, y, z, this.rs(speed * 0.8), this.rand() * speed, this.rs(speed * 0.8), 0.5, L.glow, s * 0.02, -12, 0.5, 0.05, 1.6, at);
        this.ringAt(x, z, s * (0.8 + p), 0.7, s * 0.15, 2, L.glow, 0.8, at);
        this.cloud(x, y, z, 0, 0.8, 0, 0.9, tmpC.set("#e8f4ff"), s * 0.25, s * 0.7, 0.6, 2, 0.35, at);
        if (p > 0.25) this.mark(3, x, z, s * (0.5 + p * 0.4), 7, 0.6, tmpC.set("#3a5a7a"), 0, at);
        break;
      }
      case "Electric": {
        for (let k = 0; k < Math.min(4, n); k++) {
          const a = this.rand() * Math.PI * 2, r = s * (0.5 + this.rand() * 0.8);
          this.beamAt(at3, { x: x + Math.cos(a) * r, y: Math.max(0.05, y + this.rs(s * 0.5)), z: z + Math.sin(a) * r }, L.color, s * 0.03, 0.18 + this.rand() * 0.1, 0.03, s * 0.25, 0, 1, at + k * 0.03);
        }
        for (let k = 0; k < n; k++) this.spark(x, y, z, this.rs(speed * 1.3), this.rand() * speed, this.rs(speed * 1.3), 0.25 + this.rand() * 0.2, L.glow, s * 0.025, -3, 0.8, 0.06, 3, at);
        break;
      }
      case "Grass":
      case "Bug": {
        for (let k = 0; k < n; k++) {
          const a = this.rand() * Math.PI * 2;
          const c = type === "Grass" ? tmpC.set(k % 2 ? "#4fbf3a" : "#8ee05a") : tmpC.set(k % 2 ? "#a6d22e" : "#e0f070");
          this.chunk(x, y, z, Math.cos(a) * speed * 0.6, 1 + this.rand() * speed * 0.6, Math.sin(a) * speed * 0.6, 1.2 + this.rand() * 0.5, c, s * (0.06 + this.rand() * 0.04), 1.2, 0.12, 0.7, 9, -2.5, 0.3, at);
        }
        for (let k = 0; k < n / 2; k++) this.spark(x, y, z, this.rs(speed), this.rand() * speed, this.rs(speed), 0.5, L.glow, s * 0.02, -2, 1, 0.03, 2, at);
        break;
      }
      case "Ice": {
        for (let k = 0; k < n; k++) {
          const a = this.rand() * Math.PI * 2;
          this.chunk(x, y, z, Math.cos(a) * speed * 0.7, 1 + this.rand() * speed * 0.8, Math.sin(a) * speed * 0.7, 1.1, tmpC.set(k % 2 ? "#bdf0ff" : "#ffffff"), s * (0.05 + this.rand() * 0.05), 0.45, 1.6, 0.45, 5, -12, 0.8, at);
        }
        for (let k = 0; k < n; k++) this.spark(x, y, z, this.rs(speed), this.rand() * speed, this.rs(speed), 0.6, L.glow, s * 0.02, -4, 1.5, 0.02, 2.4, at);
        this.cloud(x, y, z, 0, 0.3, 0, 1.2, tmpC.set("#f0faff"), s * 0.3, s * 0.9, -0.2, 1.5, 0.45, at);
        if (p > 0.2) this.mark(2, x, z, s * (0.6 + p * 0.5), 8, 0.75, WHITE, 0, at);
        break;
      }
      case "Psychic":
      case "Fairy": {
        this.ringAt(x, z, s * (1 + p), 0.6, s * 0.12, 0, L.color, 1.2, at);
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2;
          this.swirl(x, y - s * 0.3, z, a, 5 + this.rand() * 3, s * 0.65, 1.4, 0.8 + this.rand() * 0.3, k % 2 ? L.glow : L.color, s * 0.1, at, 2.2);
        }
        if (type === "Fairy") for (let k = 0; k < n; k++) this.spark(x, y, z, this.rs(speed * 0.6), this.rand() * speed * 0.8, this.rs(speed * 0.6), 0.8, WHITE, s * 0.03, -1, 2, 0.01, 2.6, at);
        break;
      }
      case "Ghost":
      case "Dark": {
        for (let k = 0; k < n; k++) {
          const a = this.rand() * Math.PI * 2;
          this.swirl(x, y - s * 0.2, z, a, (this.rand() < 0.5 ? -1 : 1) * (2 + this.rand() * 2), s * 0.45, 1.5, 1 + this.rand() * 0.5, L.color, s * 0.2, at, 1.8);
        }
        this.cloud(x, y, z, 0, 0.5, 0, 1.2, tmpC.set(type === "Ghost" ? "#2a1a40" : "#1a1424"), s * 0.3, s * 1.1, 0.5, 1.5, 0.55, at);
        break;
      }
      case "Dragon": {
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2;
          this.swirl(x, y - s * 0.3, z, a, 7, s * 0.7, 2.2, 0.75, k % 3 ? L.color : tmpC.set("#40d0ff"), s * 0.15, at, 2.4);
        }
        for (let k = 0; k < n; k++) this.spark(x, y, z, this.rs(speed), this.rand() * speed, this.rs(speed), 0.6, L.glow, s * 0.025, 0, 1, 0.04, 2.6, at);
        break;
      }
      case "Fighting":
      case "Normal": {
        // An impact star: streaks flung out flat, a shockwave ring, a puff of dust.
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + this.rand() * 0.3;
          this.spark(x, y, z, Math.cos(a) * speed * 1.7, this.rs(1.5), Math.sin(a) * speed * 1.7, 0.24 + this.rand() * 0.1, k % 2 ? L.glow : WHITE, s * 0.055, 0, 6, 0.1, 3, at);
        }
        this.ringAt(x, z, s * (0.8 + p * 1.2), 0.42, s * 0.12, 0, L.glow, 1.3, at);
        this.cloud(x, 0.1, z, 0, 0.3, 0, 0.9, this.dustColor, s * 0.2, s * 0.6, 0.2, 3, 0.4, at);
        break;
      }
      case "Ground":
      case "Rock": {
        for (let k = 0; k < n; k++) {
          const a = this.rand() * Math.PI * 2;
          this.chunk(x, Math.max(0.1, y * 0.5), z, Math.cos(a) * speed * 0.5, 2 + this.rand() * speed * 0.8, Math.sin(a) * speed * 0.5, 1.1, tmpC.set(type === "Rock" ? (k % 2 ? "#a08a68" : "#7a6a50") : k % 2 ? "#a07a48" : "#6a5034"), s * (0.025 + this.rand() * 0.035), 1, 0.8, 1, 6, -16, 0, at);
        }
        for (let k = 0; k < Math.ceil(n / 5); k++) this.cloud(x + this.rs(s * 0.3), 0.15, z + this.rs(s * 0.3), this.rs(1.5), 0.6, this.rs(1.5), 1.2 + this.rand() * 0.5, this.dustColor, s * 0.22, s * 0.8, 0.2, 1.6, 0.4, at);
        if (p > 0.3) this.mark(4, x, z, s * (0.5 + p * 0.5), 7, 0.65, tmpC.set("#6a5034"), 0, at);
        break;
      }
      case "Poison": {
        for (let k = 0; k < n; k++) {
          this.puff(x + this.rs(s * 0.3), y + this.rs(s * 0.2), z + this.rs(s * 0.3), this.rs(0.8), 0.5 + this.rand(), this.rs(0.8), 0.8 + this.rand() * 0.4, L.glow, s * 0.06, L.color, s * 0.15, 1, 1.5, 0.3, at, 1.8, 1);
        }
        this.cloud(x, y, z, 0, 0.4, 0, 1.6, tmpC.set("#7a3aa8"), s * 0.3, s * 1.1, 0.3, 1.2, 0.45, at);
        break;
      }
      case "Steel": {
        for (let k = 0; k < n; k++) this.spark(x, y, z, this.rs(speed * 1.4), this.rand() * speed, this.rs(speed * 1.4), 0.45 + this.rand() * 0.3, k % 3 ? tmpC.set("#fff2c0") : WHITE, s * 0.02, -9.8, 0.5, 0.07, 3.2, at);
        this.ringAt(x, z, s * (0.6 + p), 0.35, s * 0.08, 0, L.glow, 1, at);
        break;
      }
      case "Flying": {
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2;
          this.swirl(x, 0.2, z, a, 9, s * 0.6, 2.5, 0.6, WHITE, s * 0.05, at, 1.2);
        }
        this.cloud(x, 0.1, z, 0, 0.2, 0, 0.8, tmpC.set("#e8eef8"), s * 0.2, s * 0.9, 0.3, 2.5, 0.3, at);
        break;
      }
      default: {
        for (let k = 0; k < n; k++) this.spark(x, y, z, this.rs(speed), this.rand() * speed, this.rs(speed), 0.4 + this.rand() * 0.3, k % 2 ? L.glow : L.color, s * 0.03, L.gravity, 1, 0.04, 2.4, at);
      }
    }
  }

  /** A spread move round its user (Earthquake, Surf, Discharge, Blizzard, Heat Wave…): a shockwave and its type's wave. */
  spread(type: string, x: number, z: number, radius: number, size: number, at = this.time.value) {
    const L = typeLook(type);
    const s = Math.max(0.4, size);
    this.ringAt(x, z, radius, 0.7, Math.max(0.4, radius * 0.12), 0, L.color, 1.4, at);
    this.ringAt(x, z, radius * 0.75, 0.9, 0, 1, L.color, 0.35, at);
    const around = (n: number, fn: (cx: number, cz: number, a: number) => void) => {
      const c = this.count(n, { x, y: 0.5, z }, radius);
      for (let k = 0; k < c; k++) {
        const a = (k / c) * Math.PI * 2 + this.rand() * 0.4;
        const r = radius * (0.35 + this.rand() * 0.6);
        fn(x + Math.cos(a) * r, z + Math.sin(a) * r, a);
      }
    };
    switch (type) {
      case "Ground":
      case "Rock": {
        around(14, (cx, cz, a) => this.chunk(cx, 0.05, cz, Math.cos(a) * 2, 3 + this.rand() * 4, Math.sin(a) * 2, 1.1, tmpC.set(this.rand() < 0.5 ? "#8a6a44" : "#6a5236"), Math.min(0.14, s * (0.02 + this.rand() * 0.03)), 1, 0.7, 1, 5, -16, 0, at + this.rand() * 0.25));
        around(7, (cx, cz, a) => this.cloud(cx, 0.2, cz, Math.cos(a) * 3, 0.5, Math.sin(a) * 3, 1.5 + this.rand() * 0.8, this.dustColor, s * 0.35, s * 1.2, 0.15, 1.2, 0.42, at + this.rand() * 0.3));
        this.mark(1, x, z, radius * 0.9, 9, 0.9, tmpC.set("#ffb060"), type === "Ground" ? 0.6 : 0, at);
        break;
      }
      case "Water": {
        this.wallAt(x, z, radius, 0.9, Math.max(0.8, s * 1.4), L.color, 1, at);
        around(16, (cx, cz, a) => this.chunk(cx, 0.1, cz, Math.cos(a) * 3, 3 + this.rand() * 3, Math.sin(a) * 3, 0.9, tmpC.set("#8ac8ff"), s * 0.05, 1, 1, 1, 2, -14, 0.6, at + this.rand() * 0.2));
        this.ringAt(x, z, radius * 1.05, 1.1, 0, 2, L.glow, 0.7, at);
        break;
      }
      case "Fire": {
        this.wallAt(x, z, radius, 0.8, Math.max(0.7, s * 1.1), L.color, 1.2, at);
        around(16, (cx, cz) => this.puff(cx, 0.3, cz, 0, 1 + this.rand(), 0, 0.6 + this.rand() * 0.3, tmpC.set("#fff0a0"), s * 0.2, L.color, s * 0.45, 3, 1, 0.6, at + this.rand() * 0.2, 2.6, 1.6));
        this.mark(0, x, z, radius * 0.9, 7, 0.6, tmpC.set("#1a1410"), 0.8, at);
        break;
      }
      case "Electric": {
        const c = this.count(8, { x, y: 0.5, z }, radius);
        for (let k = 0; k < c; k++) {
          const a = (k / c) * Math.PI * 2 + this.rand() * 0.3;
          this.beamAt({ x, y: s * 0.5, z }, { x: x + Math.cos(a) * radius, y: 0.1, z: z + Math.sin(a) * radius }, L.color, s * 0.05, 0.3, 0.05, radius * 0.08, 0, 1, at + this.rand() * 0.12);
        }
        break;
      }
      case "Ice": {
        this.wallAt(x, z, radius, 0.9, Math.max(0.6, s), L.glow, 0.8, at);
        around(16, (cx, cz, a) => this.chunk(cx, 0.1, cz, Math.cos(a) * 1.5, 2 + this.rand() * 2, Math.sin(a) * 1.5, 1.3, WHITE, s * 0.07, 0.4, 1.8, 0.4, 4, -10, 0.9, at + this.rand() * 0.2));
        this.mark(2, x, z, radius, 9, 0.8, WHITE, 0, at);
        break;
      }
      case "Grass":
      case "Bug":
      case "Flying": {
        around(18, (cx, cz, a) => this.swirl(cx, 0.2, cz, a, 6, radius * 0.15, 1.5, 0.9, type === "Flying" ? WHITE : L.color, s * 0.06, at + this.rand() * 0.2, 1.4));
        break;
      }
      default: {
        this.wallAt(x, z, radius, 0.7, Math.max(0.6, s), L.color, 0.9, at);
        around(12, (cx, cz) => this.puff(cx, 0.4, cz, 0, 0.6, 0, 0.6, L.glow, s * 0.12, L.color, s * 0.3, 0.5, 1, 0.3, at + this.rand() * 0.2, 2, 1));
      }
    }
  }

  /** The recall of a fainted Pokémon: a Poké Ball appears over it, its red beam takes the Pokémon in, then it's gone. */
  recall(x: number, y: number, z: number, h: number, ballY: number, at = this.time.value) {
    const size = Math.max(0.1, Math.min(0.42, h * 0.16));
    const i = this.balls.slot();
    this.balls.set(0, i, x, ballY, z, at);
    this.balls.set(1, i, size, 1.25, 0, 0);
    // The beam from the ball's button to the Pokémon.
    this.beamAt({ x, y: ballY - size * 0.6, z }, { x, y: y + h * 0.4, z }, RED, Math.max(0.04, size * 0.35), 0.6, 0.08, 0, 0, 0.8, at + 0.15);
    const n = this.count(6, { x, y: y + h * 0.5, z }, h);
    for (let k = 0; k < n; k++) {
      const a = this.rand() * Math.PI * 2;
      this.spark(x + Math.cos(a) * h * 0.25, y + h * (0.2 + this.rand() * 0.6), z + Math.sin(a) * h * 0.25, Math.cos(a) * 0.3, 1.5 + this.rand() * 2, Math.sin(a) * 0.3, 0.5 + this.rand() * 0.3, k % 2 ? RED : RED_GLOW, Math.max(0.02, h * 0.04), 1, 1, 0.03, 2.4, at + 0.25 + this.rand() * 0.2);
    }
    // A sparkle as the ball goes.
    this.puff(x, ballY, z, 0, 0, 0, 0.3, WHITE, size * 0.6, RED_GLOW, size * 2.4, 0, 1, 0.3, at + 1.0, 2.4, 1);
  }

  /** Dust kicked up by a charging figure. */
  dust(x: number, z: number, size: number, color: THREE.Color = DUST, at = this.time.value) {
    if (this.count(1, { x, y: 0.2, z }, size) <= 0) return;
    this.cloud(x + this.rs(size * 0.3), size * 0.15, z + this.rs(size * 0.3), this.rs(0.4), 0.3, this.rs(0.4), 1 + this.rand() * 0.6, color, size * 0.25, size * 0.8, 0.1, 1.5, 0.38, at);
  }

  /** A boss's footfall: cracks in the ground, a ring of dust, a few stones. */
  step(x: number, z: number, size: number, color: THREE.Color = DUST, glow: THREE.Color | null = null, at = this.time.value) {
    const s = Math.max(0.5, size);
    this.mark(1, x + this.rs(s * 0.15), z + this.rs(s * 0.15), s * (0.45 + this.rand() * 0.15), 7, 0.85, glow ?? tmpC.set("#000000"), glow ? 0.7 : 0, at);
    const n = this.count(6, { x, y: 0.2, z }, s);
    for (let k = 0; k < n; k++) {
      const a = (k / Math.max(1, n)) * Math.PI * 2 + this.rand() * 0.5;
      this.cloud(x + Math.cos(a) * s * 0.25, 0.1, z + Math.sin(a) * s * 0.25, Math.cos(a) * s * 0.9, 0.25, Math.sin(a) * s * 0.9, 1.3 + this.rand() * 0.5, color, s * 0.12, s * 0.38, 0.05, 2.2, 0.45, at);
    }
    for (let k = 0; k < Math.ceil(n / 2); k++) {
      const a = this.rand() * Math.PI * 2;
      this.chunk(x, 0.05, z, Math.cos(a) * s * 0.8, 2 + this.rand() * 2, Math.sin(a) * s * 0.8, 0.9, tmpC.copy(color).multiplyScalar(0.7), Math.min(0.08, s * 0.015), 1, 0.8, 1, 6, -14, 0, at);
    }
    this.ringAt(x, z, s * 0.9, 0.5, s * 0.08, 0, tmpC.copy(color).multiplyScalar(0.6), 0.5, at);
  }

  /** A boss's aura, called every frame: motes of its type rising round it. */
  aura(type: string, x: number, z: number, h: number, w: number, dt: number, at = this.time.value) {
    const L = typeLook(type);
    const rate = dt * (12 + h * 3);
    let n = Math.floor(rate) + (this.rand() < rate % 1 ? 1 : 0);
    n = Math.min(n, this.count(n, { x, y: h * 0.5, z }, h));
    for (let k = 0; k < n; k++) {
      const a = this.rand() * Math.PI * 2, r = w * (0.3 + this.rand() * 0.35);
      this.puff(x + Math.cos(a) * r, h * this.rand() * 0.5, z + Math.sin(a) * r, Math.cos(a) * 0.15, 0.6 + this.rand() * 0.8, Math.sin(a) * 0.15, 1.2 + this.rand() * 0.6, L.glow, h * 0.025, L.color, h * 0.05, 0.4, 0.5, 0.5, at, 1.5, 0.6);
    }
  }

  /** The aura's glowing disc on the ground under a boss (every few tenths of a second). */
  auraDisc(type: string, x: number, z: number, radius: number, at = this.time.value) {
    const L = typeLook(type);
    this.ringAt(x, z, radius, 0.9, radius * 0.2, 1, L.color, 0.28, at);
  }

  /** A lightning strike from the sky (thunderstorms). */
  lightning(x: number, z: number, height: number, at = this.time.value) {
    const top = { x: x + this.rs(6), y: height, z: z + this.rs(6) };
    this.beamAt(top, { x, y: 0, z }, tmpC.set("#bcd4ff"), 0.35, 0.35, 0.04, 5, 0, 1, at);
    this.beamAt(top, { x, y: 0, z }, WHITE, 0.15, 0.3, 0.04, 4, 0, 1, at + 0.05);
    this.ringAt(x, z, 6, 0.5, 1, 1, tmpC.set("#bcd4ff"), 0.6, at);
  }

  setTime(t: number) {
    this.time.value = t;
    for (const p of this.pools) p.flush();
  }

  /** A new battle: everything from the last one goes (its clock starts again at 0). */
  clear() {
    for (const p of this.pools) p.clear();
  }

  /** Every pool drawn once (for compiling before the battle starts). */
  primeAll() {
    for (const p of this.pools) {
      p.primeAll();
      p.mesh.visible = true;
    }
  }

  materials(): THREE.Material[] {
    return this.pools.map((p) => p.mesh.material as THREE.Material);
  }

  dispose() {
    for (const p of this.pools) p.dispose();
  }
}
