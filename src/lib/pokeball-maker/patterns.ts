/**
 * The patterns a half of the ball can wear. Each is a mask computed in the fragment shader from the point's
 * direction on the ball (no textures, so there are no seams, and a pattern is one byte in a link plus its colours,
 * scale and rotation). Every mask gives three weights, one per pattern colour, applied in order over the part's own
 * colour.
 *
 * The coordinates: q is the unit direction from the ball's centre, turned so the half's pole is +y and the band
 * is y = 0 (the bottom half is mirrored, so a pattern reads the same way up on both halves), with the button at +z.
 * Patterns made of motifs (dots, stars, hearts, scales…) lay them out in rows of latitude with as many cells as fit
 * each row, so they keep their size from the band to the pole; the rest are functions of the direction itself.
 */

export interface PatternDef {
  /** Message key (patterns.<key>). */
  key: string;
  /** Default colours (sRGB hex) and scale byte when it is chosen. */
  colours: [string, string, string];
  scale?: number;
  /** How many of its colours it uses. */
  uses: 1 | 2 | 3;
}

export const PATTERNS: PatternDef[] = [
  { key: "none", colours: ["#ffffff", "#202024", "#e62832"], uses: 1 },
  { key: "great", colours: ["#e3262f", "#1b1b1f", "#ffffff"], uses: 1 },
  { key: "ultra", colours: ["#f2c230", "#1b1b1f", "#ffffff"], uses: 1 },
  { key: "net", colours: ["#1b2a36", "#2a8fb8", "#ffffff"], uses: 1 },
  { key: "dive", colours: ["#bfe8ff", "#ffffff", "#2a6fd1"], uses: 2 },
  { key: "stripes", colours: ["#ffffff", "#1b1b1f", "#e3262f"], uses: 2 },
  { key: "rings", colours: ["#ffffff", "#1b1b1f", "#e3262f"], uses: 2 },
  { key: "chevrons", colours: ["#ffffff", "#f2c230", "#1b1b1f"], uses: 1 },
  { key: "zigzag", colours: ["#ffffff", "#f2c230", "#1b1b1f"], uses: 2 },
  { key: "flames", colours: ["#ff5a1f", "#ffb02e", "#fff1a8"], uses: 3 },
  { key: "waves", colours: ["#ffffff", "#9bd8ff", "#1b1b1f"], uses: 2 },
  { key: "lightning", colours: ["#ffd23a", "#fffbe0", "#1b1b1f"], uses: 2 },
  { key: "scales", colours: ["#1f8a5a", "#9fe0b8", "#ffffff"], uses: 2 },
  { key: "stars", colours: ["#ffd23a", "#ffffff", "#ff7aa8"], uses: 2 },
  { key: "dots", colours: ["#ffffff", "#ffd23a", "#1b1b1f"], uses: 1 },
  { key: "hearts", colours: ["#ff4f8b", "#ffffff", "#ffd23a"], uses: 2 },
  { key: "heart", colours: ["#e8336f", "#ffffff", "#ffd23a"], uses: 1 },
  { key: "crescent", colours: ["#ffd23a", "#ffffff", "#1b1b1f"], uses: 1 },
  { key: "checks", colours: ["#1b1b1f", "#ffffff", "#e3262f"], uses: 1 },
  { key: "plaid", colours: ["#1b3a6b", "#c81e2e", "#f2c230"], uses: 3 },
  { key: "argyle", colours: ["#2d55c8", "#f6f6f2", "#f2c230"], uses: 3 },
  { key: "hexagons", colours: ["#f2c230", "#1b1b1f", "#ffffff"], uses: 2 },
  { key: "camo", colours: ["#4e6b2a", "#2f3d1c", "#a8a878"], uses: 3 },
  { key: "leopard", colours: ["#2a1d12", "#c98a3c", "#ffffff"], uses: 2 },
  { key: "safari", colours: ["#4e6b2a", "#2f3d1c", "#ffffff"], uses: 1 },
  { key: "galaxy", colours: ["#6a3fd6", "#ff5fb8", "#ffffff"], uses: 3 },
  { key: "gradient", colours: ["#ff7a59", "#ffd23a", "#ffffff"], uses: 2 },
  { key: "split", colours: ["#2f6fe0", "#ffffff", "#1b1b1f"], uses: 1 },
  { key: "spiral", colours: ["#ffffff", "#1b1b1f", "#e3262f"], uses: 1 },
  { key: "sunburst", colours: ["#ffd23a", "#ff8a3d", "#ffffff"], uses: 2 },
  { key: "quick", colours: ["#f5d132", "#1b1b1f", "#ffffff"], uses: 1 },
  { key: "beast", colours: ["#f2c230", "#1b1b1f", "#ffffff"], uses: 1 },
  { key: "master", colours: ["#ef6fb0", "#ffffff", "#1b1b1f"], uses: 1 },
];

export const PATTERN_COUNT = PATTERNS.length;
export const patternId = (key: string) => Math.max(0, PATTERNS.findIndex((p) => p.key === key));

/**
 * The masks, in GLSL (WebGL2). `pbmPattern(id, q, s, rot)` returns the three colour weights. `s` is the scale
 * (0.5..3), `rot` the rotation in radians.
 */
export const PATTERN_GLSL = /* glsl */ `
#define PBM_PI 3.14159265
#define PBM_TAU 6.28318531
float pbmHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float pbmHash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float pbmNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(pbmHash3(i), pbmHash3(i + vec3(1.0, 0.0, 0.0)), f.x);
  float b = mix(pbmHash3(i + vec3(0.0, 1.0, 0.0)), pbmHash3(i + vec3(1.0, 1.0, 0.0)), f.x);
  float c = mix(pbmHash3(i + vec3(0.0, 0.0, 1.0)), pbmHash3(i + vec3(1.0, 0.0, 1.0)), f.x);
  float d = mix(pbmHash3(i + vec3(0.0, 1.0, 1.0)), pbmHash3(i + vec3(1.0, 1.0, 1.0)), f.x);
  return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
}
float pbmFbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int k = 0; k < 4; k++) { s += a * pbmNoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.9375;
}
/** 1 inside (d < 0), 0 outside, softened over w. */
float pbmFill(float d, float w) { return 1.0 - smoothstep(-w, w, d); }
vec2 pbmRot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
float pbmStar(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-0.809016994375, -0.587785252292);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
float pbmHeart(vec2 p) {
  p.x = abs(p.x);
  p.y += 0.55;
  if (p.y + p.x > 1.0) return length(p - vec2(0.25, 0.75)) - 0.35355339;
  vec2 a = p - vec2(0.0, 1.0);
  vec2 b = p - 0.5 * max(p.x + p.y, 0.0);
  return sqrt(min(dot(a, a), dot(b, b))) * sign(p.x - p.y);
}
float pbmHex(vec2 p, float r) {
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}
/**
 * Even cells over the half: a cap at the pole, then rows of latitude with as many cells as fit each row (every
 * other row staggered by half a cell). .xy is the point's place in its cell (about -0.5..0.5, square), .z a random
 * number per cell.
 */
vec3 pbmCell(vec3 r, float az, float pol, float rows) {
  float dv = 1.5707963 / rows;
  if (pol < dv * 0.5) return vec3(r.x / dv, r.z / dv, 0.37);
  float ri = floor(pol / dv + 0.5);
  float pc = ri * dv;
  float n = max(1.0, floor(PBM_TAU * sin(pc) / dv + 0.5));
  float u = (az + PBM_PI) / PBM_TAU * n + fract(ri * 0.5);
  float ci = floor(u);
  vec2 l = vec2((fract(u) - 0.5) * (PBM_TAU * sin(pc) / n) / dv, (pol - pc) / dv);
  return vec3(l, pbmHash(vec2(ri, mod(ci, n)) + 0.5));
}

vec3 pbmPattern(int id, vec3 q, float s, float rot) {
  vec3 w = vec3(0.0);
  if (id <= 0) return w;
  // A pixel's size in units of the ball's radius (for smooth edges).
  float px = max(length(fwidth(q)), 1e-4);
  vec2 xz = pbmRot(q.xz, rot);
  vec3 r = vec3(xz.x, q.y, xz.y);
  float az = atan(r.x, r.z);
  float pol = acos(clamp(r.y, -1.0, 1.0));
  float pf = pol / 1.5707963;
  float front = smoothstep(-0.05, 0.12, r.z);
  if (id == 1) {
    // Great Ball: a rounded panel on each side, rising from the band.
    float d = length(vec2((abs(r.x) - 0.82) / (0.26 * s), (r.y - 0.26) / (0.36 * s))) - 1.0;
    w.x = pbmFill(d, px * 3.0);
  } else if (id == 2) {
    // Ultra Ball: the H's two uprights, over the top from front to back.
    float d = abs(abs(r.x) - 0.42) - 0.11 * s;
    w.x = pbmFill(d, px * 1.5);
  } else if (id == 3) {
    // Net Ball: a diagonal mesh.
    float n = floor(7.0 * s + 0.5);
    float a = az / PBM_TAU * n + pf * n * 0.25, b = az / PBM_TAU * n - pf * n * 0.25;
    float m = max(abs(fract(a) - 0.5), abs(fract(b) - 0.5));
    w.x = pbmFill(0.43 - m, fwidth(m) * 1.2);
  } else if (id == 4) {
    // Dive Ball: a wave crest round the band and bubbles above it.
    float n = floor(5.0 * s + 0.5);
    float d = (1.0 - pf) - (0.3 + 0.07 * sin(az * n) + 0.04 * sin(az * n * 2.0 + 1.3));
    w.x = pbmFill(d, fwidth(d) * 1.2);
    vec3 c = pbmCell(r, az, pol, 6.0 * s);
    float bub = abs(length(c.xy) - 0.22 * (0.6 + c.z)) - 0.06;
    w.y = pbmFill(bub, px / (1.5707963 / (6.0 * s)) * 2.0) * step(0.45, c.z) * step(0.0, d - 0.08);
  } else if (id == 5) {
    // Stripes: straight bands across the ball (turn them to tilt).
    float v = pbmRot(q.xy, rot).x * 2.6 * s;
    float d = abs(fract(v) - 0.5) - 0.24;
    w.x = pbmFill(d, fwidth(v) * 1.2);
    float d2 = abs(fract(v + 0.5) - 0.5) - 0.035;
    w.y = pbmFill(d2, fwidth(v) * 1.2);
  } else if (id == 6) {
    // Rings of latitude.
    float v = pf * 3.0 * s;
    float d = abs(fract(v) - 0.5) - 0.2;
    w.x = pbmFill(d, fwidth(v) * 1.2);
    w.y = pbmFill(abs(fract(v + 0.5) - 0.5) - 0.04, fwidth(v) * 1.2);
  } else if (id == 7) {
    // Chevrons pointing up.
    float n = floor(5.0 * s + 0.5);
    float tri = abs(fract(az / PBM_TAU * n) - 0.5);
    float v = pf * 2.6 * s + tri * 1.6;
    float d = abs(fract(v) - 0.5) - 0.18;
    w.x = pbmFill(d, fwidth(v) * 1.2);
  } else if (id == 8) {
    // A zigzag band round the middle, a thinner one above it.
    float n = floor(6.0 * s + 0.5);
    float tri = abs(fract(az / PBM_TAU * n) - 0.5) - 0.25;
    float d = abs(pf - 0.6 - tri * 0.32) - 0.08;
    w.x = pbmFill(d, fwidth(pf) * 1.5);
    float d2 = abs(pf - 0.3 - tri * 0.32) - 0.035;
    w.y = pbmFill(d2, fwidth(pf) * 1.5);
  } else if (id == 9) {
    // Flames licking up from the band, in three colours.
    float n = floor(4.0 * s + 0.5);
    float wob = pbmNoise(vec3(cos(az), sin(az), 0.0) * 2.5 * s + 4.0) - 0.5;
    float ht = 0.3 + 0.38 * pow(0.5 + 0.5 * cos(az * n), 2.0) + 0.22 * wob;
    float d = (1.0 - pf) - ht;
    float aa = fwidth(d) * 1.3;
    w.x = pbmFill(d, aa);
    w.y = pbmFill(d + 0.11, aa);
    w.z = pbmFill(d + 0.22, aa);
  } else if (id == 10) {
    // Waves round the ball.
    float n = floor(5.0 * s + 0.5);
    float v = pf * 2.8 * s + 0.16 * sin(az * n);
    float d = abs(fract(v) - 0.5) - 0.16;
    w.x = pbmFill(d, fwidth(v) * 1.2);
    w.y = pbmFill(abs(fract(v + 0.5) - 0.5) - 0.04, fwidth(v) * 1.2);
  } else if (id == 11) {
    // Lightning bolts rising from the band.
    float n = floor(5.0 * s + 0.5);
    float cx = fract(az / PBM_TAU * n) - 0.5;
    float zig = (abs(fract(pf * 2.4) - 0.5) - 0.25) * 0.5;
    float d = abs(cx - zig) - 0.06 * (0.4 + pf);
    float fade = smoothstep(0.12, 0.3, pf);
    w.x = pbmFill(d, fwidth(cx) * 1.3) * fade;
    w.y = pbmFill(d + 0.03, fwidth(cx) * 1.3) * fade;
  } else if (id == 12) {
    // Scales, row on row.
    float rows = 7.0 * s;
    vec3 c = pbmCell(r, az, pol, rows);
    float d = length(c.xy - vec2(0.0, -0.32)) - 0.66;
    float aa = px / (1.5707963 / rows) * 1.5;
    w.x = pbmFill(abs(d + 0.06) - 0.05, aa);
    w.y = pbmFill(d + 0.18, aa) * 0.55;
  } else if (id == 13) {
    // Stars, a few in the second colour.
    float rows = 5.0 * s;
    vec3 c = pbmCell(r, az, pol, rows);
    float d = pbmStar(pbmRot(c.xy, rot + c.z * 1.2), 0.3, 0.45);
    float m = pbmFill(d, px / (1.5707963 / rows) * 1.5);
    w.x = m * step(c.z, 0.7);
    w.y = m * step(0.7, c.z);
  } else if (id == 14) {
    // Polka dots.
    float rows = 5.0 * s;
    vec3 c = pbmCell(r, az, pol, rows);
    w.x = pbmFill(length(c.xy) - 0.27, px / (1.5707963 / rows) * 1.5);
  } else if (id == 15) {
    // Hearts, a few in the second colour.
    float rows = 5.0 * s;
    vec3 c = pbmCell(r, az, pol, rows);
    float d = pbmHeart(pbmRot(c.xy, rot) / 0.62) * 0.62;
    float m = pbmFill(d, px / (1.5707963 / rows) * 1.5);
    w.x = m * step(c.z, 0.72);
    w.y = m * step(0.72, c.z);
  } else if (id == 16) {
    // One big heart on the front.
    vec2 p = (r.xy - vec2(0.0, 0.46)) / (0.36 * s);
    w.x = pbmFill(pbmHeart(p), px * 3.0 / (0.36 * s)) * front;
  } else if (id == 17) {
    // A crescent moon on the front.
    vec2 p = (r.xy - vec2(0.0, 0.48)) / (0.3 * s);
    float d = max(length(p) - 1.0, -(length(p - vec2(0.42, 0.24)) - 0.86));
    w.x = pbmFill(d, px * 3.0 / (0.3 * s)) * front;
  } else if (id == 18) {
    // Checks.
    float n = 2.0 * floor(4.0 * s + 0.5);
    float v = sin(az * n * 0.5) * sin(pf * floor(3.0 * s + 0.5) * PBM_PI);
    w.x = pbmFill(v, fwidth(v) * 1.2);
  } else if (id == 19) {
    // Plaid: crossing bands in two colours, where they cross the third, and fine lines.
    float n = floor(6.0 * s + 0.5);
    float a = fract(az / PBM_TAU * n), b = fract(pf * 3.0 * s);
    float sa = pbmFill(abs(a - 0.5) - 0.17, fwidth(a) * 1.5);
    float sb = pbmFill(abs(b - 0.5) - 0.17, fwidth(b) * 1.5);
    w.x = sa * 0.8;
    w.y = sb * 0.8;
    w.z = sa * sb * 0.85 + pbmFill(abs(a - 0.08) - 0.015, fwidth(a) * 1.5) * 0.7;
  } else if (id == 20) {
    // Argyle: diamonds in two colours with a fine line.
    float n = floor(6.0 * s + 0.5);
    float a = az / PBM_TAU * n, b = pf * 2.0 * s;
    float dd = abs(fract(a) - 0.5) + abs(fract(b) - 0.5) - 0.5;
    float odd = mod(floor(a) + floor(b), 2.0);
    float m = pbmFill(dd, fwidth(dd) * 1.2);
    w.x = m * odd;
    w.y = m * (1.0 - odd);
    float line = min(abs(fract(a + b + 0.5) - 0.5), abs(fract(a - b + 0.5) - 0.5));
    w.z = pbmFill(line - 0.018, fwidth(a) * 1.5);
  } else if (id == 21) {
    // Honeycomb.
    float rows = 6.0 * s;
    vec3 c = pbmCell(r, az, pol, rows);
    float d = pbmHex(pbmRot(c.xy, 1.5707963), 0.44);
    float aa = px / (1.5707963 / rows) * 1.5;
    w.x = pbmFill(d, aa);
    w.y = pbmFill(abs(d) - 0.035, aa);
  } else if (id == 22) {
    // Camouflage.
    float n = pbmFbm(q * 2.4 * s + 3.1);
    float aa = fwidth(n) * 1.2;
    w.x = pbmFill(0.5 - n, aa);
    w.y = pbmFill(0.6 - n, aa);
    w.z = pbmFill(n - 0.34, aa);
  } else if (id == 23) {
    // Leopard rosettes.
    float rows = 6.0 * s;
    vec3 c = pbmCell(r, az, pol, rows);
    vec2 j = (vec2(pbmHash(c.zz + 1.7), pbmHash(c.zz + 3.1)) - 0.5) * 0.2;
    float ang = atan(c.y - j.y, c.x - j.x);
    float d = length(c.xy - j) - 0.24 * (0.8 + 0.4 * c.z) - 0.04 * sin(ang * 3.0 + c.z * 9.0);
    float aa = px / (1.5707963 / rows) * 1.5;
    w.y = pbmFill(d + 0.04, aa);
    w.x = pbmFill(abs(d) - 0.06, aa) * step(0.25, fract(ang / PBM_TAU * 3.0 + c.z));
  } else if (id == 24) {
    // Safari spots.
    float rows = 4.0 * s;
    vec3 c = pbmCell(r, az, pol, rows);
    vec2 j = (vec2(pbmHash(c.zz + 1.7), pbmHash(c.zz + 3.1)) - 0.5) * 0.3;
    float ang = atan(c.y - j.y, c.x - j.x);
    float d = length(c.xy - j) - 0.2 * (0.7 + 0.6 * c.z) - 0.035 * sin(ang * 2.0 + c.z * 7.0);
    w.x = pbmFill(d, px / (1.5707963 / rows) * 1.5) * step(0.25, c.z);
  } else if (id == 25) {
    // Galaxy: two nebulae and stars.
    float a = pbmFbm(q * 1.7 * s + 2.0), b = pbmFbm(q * 3.1 * s + 9.0);
    w.x = smoothstep(0.42, 0.78, a);
    w.y = smoothstep(0.58, 0.9, b) * 0.85;
    vec3 g = q * 26.0 * s;
    float h = pbmHash3(floor(g));
    float st = length(fract(g) - 0.5) - 0.16 * smoothstep(0.9, 1.0, h);
    w.z = pbmFill(st, fwidth(g.x) * 1.5) * step(0.9, h);
  } else if (id == 26) {
    // A gradient from the pole to the band (turn it to tilt).
    vec3 dir = vec3(sin(rot), cos(rot), 0.0);
    float t = clamp(1.0 - dot(q, dir), 0.0, 1.0);
    w.x = smoothstep(0.0, 0.75, t);
    w.y = smoothstep(0.6, 1.0, t);
  } else if (id == 27) {
    // Split: one side in the first colour.
    w.x = pbmFill(-r.x, px * 1.5);
  } else if (id == 28) {
    // A spiral from the pole.
    float n = floor(3.0 * s + 0.5);
    float v = az / PBM_TAU * n + pf * 2.0 * s;
    w.x = pbmFill(abs(fract(v) - 0.5) - 0.2, fwidth(v) * 1.2);
  } else if (id == 29) {
    // Sunburst: rays from the pole round a disc.
    float n = 2.0 * floor(6.0 * s + 0.5);
    float v = sin(az * n * 0.5);
    w.x = pbmFill(v, fwidth(v) * 1.2);
    w.y = pbmFill(pf - 0.2, fwidth(pf) * 1.5);
  } else if (id == 30) {
    // Quick Ball: a cross over the top.
    float d = min(abs(r.x), abs(r.z)) - 0.13 * s;
    w.x = pbmFill(d, px * 1.5);
  } else if (id == 31) {
    // Beast Ball: a band over the top and a ring round it.
    float d = min(abs(r.x) - 0.06 * s, abs(r.y - 0.64) - 0.045 * s);
    w.x = pbmFill(d, px * 1.5);
  } else if (id == 32) {
    // Master Ball: a round spot on each side of the front.
    vec2 p = vec2(abs(r.x) - 0.5, r.y - 0.55);
    w.x = pbmFill(length(p) - 0.2 * s, px * 1.5) * front;
  }
  return clamp(w, 0.0, 1.0);
}
`;
