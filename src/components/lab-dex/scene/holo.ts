import * as THREE from "three";

/**
 * The lab's light-made things: the holo-table's projected rings, the
 * column over it, light shafts through the haze, capsule glass, and the
 * scan that runs over the figure on the table. All additive (or nearly):
 * they add light, never hide what's behind, and bloom where they're bright.
 */

export interface LabTime {
  value: number;
}

/** A strength that can be a fixed number or a shared, live value. */
export type Live = number | { value: number };
const live = (v: Live) => (typeof v === "number" ? { value: v } : v);

const VS_VIEW = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vW;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vec4 mv = viewMatrix * w;
    vV = -mv.xyz;
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;

const NOISE = /* glsl */ `
  float labHash(float n) { return fract(sin(n * 91.3458) * 47453.5453); }
  float labHash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

function additive(name: string, uniforms: Record<string, THREE.IUniform>, fragmentShader: string, side: THREE.Side = THREE.DoubleSide) {
  return new THREE.ShaderMaterial({
    name,
    uniforms,
    vertexShader: VS_VIEW,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side,
    toneMapped: true,
  });
}

/** The column of light over the holo-table: brightest at its foot, scanlines climbing, a bright edge where it turns away. */
export function holoColumn(color: THREE.Color, time: LabTime, strength: Live = 1) {
  return additive(
    "LabHoloColumn",
    { uColor: { value: color }, uTime: time, uStrength: live(strength) },
    /* glsl */ `
    uniform vec3 uColor; uniform float uTime; uniform float uStrength;
    varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vW;
    ${NOISE}
    void main() {
      float y = vUv.y;
      float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));
      float fall = pow(1.0 - y, 2.4);
      float lines = 0.55 + 0.45 * smoothstep(0.3, 0.7, fract(vW.y * 18.0 - uTime * 0.7));
      float streak = labHash(floor(vUv.x * 140.0)) ;
      streak = 0.4 + 0.6 * smoothstep(0.55, 1.0, streak);
      float a = fall * (0.025 + 0.9 * pow(rim, 3.0)) * lines * streak;
      // A brighter skin right at the table.
      a += exp(-y * 28.0) * 0.5;
      gl_FragColor = vec4(uColor * a * uStrength, 1.0);
    }`
  );
}

/** A soft round glow lying flat (under the figure, round a pod's lamp). */
export function glowDisc(color: THREE.Color, strength: Live, falloff = 2.2) {
  return additive(
    "LabGlowDisc",
    { uColor: { value: color }, uStrength: live(strength), uFall: { value: falloff } },
    /* glsl */ `
    uniform vec3 uColor; uniform float uStrength; uniform float uFall;
    varying vec2 vUv;
    void main() {
      float r = length(vUv - 0.5) * 2.0;
      float a = pow(max(0.0, 1.0 - r), uFall);
      gl_FragColor = vec4(uColor * a * uStrength, 1.0);
    }`
  );
}

/** A shaft of light through the haze (an open cone): visible face-on, gone at its silhouette, fading towards the floor. */
export function lightShaft(color: THREE.Color, strength: Live) {
  return additive(
    "LabShaft",
    { uColor: { value: color }, uStrength: live(strength) },
    /* glsl */ `
    uniform vec3 uColor; uniform float uStrength;
    varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vW;
    ${NOISE}
    void main() {
      float face = abs(dot(normalize(vN), normalize(vV)));
      float a = pow(face, 2.2) * smoothstep(0.0, 0.35, vUv.y) * (0.55 + 0.45 * vUv.y);
      // Haze isn't even: slow bands.
      a *= 0.75 + 0.25 * sin(vW.y * 2.1 + vW.x * 1.3) * sin(vW.z * 1.7 - vW.y);
      gl_FragColor = vec4(uColor * a * uStrength, 1.0);
    }`
  );
}

/** A flat projected ring: dashes round it (count, duty), ticks, turning at `speed`. */
export function holoRing(color: THREE.Color, time: LabTime, o: { dashes: number; duty: number; speed: number; strength: number; ticks?: number; phase?: number }) {
  return additive(
    "LabHoloRing",
    {
      uColor: { value: color },
      uTime: time,
      uDashes: { value: o.dashes },
      uDuty: { value: o.duty },
      uSpeed: { value: o.speed },
      uStrength: { value: o.strength },
      uTicks: { value: o.ticks ?? 0 },
      uPhase: { value: o.phase ?? 0 },
    },
    /* glsl */ `
    uniform vec3 uColor; uniform float uTime, uDashes, uDuty, uSpeed, uStrength, uTicks, uPhase;
    varying vec2 vUv; varying vec3 vW;
    void main() {
      // RingGeometry's uv: radius runs along the ring's width via its position; use the angle from the uv centre.
      vec2 p = vUv - 0.5;
      float ang = atan(p.y, p.x) / 6.2831853 + 0.5 + uTime * uSpeed + uPhase;
      float r = length(p) * 2.0;
      float d = uDashes > 0.0 ? step(fract(ang * uDashes), uDuty) : 1.0;
      float t = uTicks > 0.0 ? step(fract(ang * uTicks), 0.18) : 0.0;
      float edge = smoothstep(0.0, 0.06, fract(r * 0.5 + 0.5) ) ;
      float a = d * (0.75 + 0.25 * edge) + t * 0.6;
      gl_FragColor = vec4(uColor * a * uStrength, 1.0);
    }`
  );
}

/** Capsule glass: almost clear face-on, bright at its edges, two highlight streaks from the lamps above. */
export function capsuleGlass(tint: THREE.Color, strength: Live = 1) {
  return new THREE.ShaderMaterial({
    name: "LabGlass",
    uniforms: { uTint: { value: tint }, uStrength: live(strength) },
    vertexShader: VS_VIEW,
    fragmentShader: /* glsl */ `
      uniform vec3 uTint; uniform float uStrength;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        vec3 n = normalize(vN), v = normalize(vV);
        float f = 1.0 - abs(dot(n, v));
        float rim = pow(f, 3.0);
        // Streaks: where the glass turns ~40 degrees from the eye, a lamp's long reflection.
        float s1 = exp(-pow((f - 0.42) / 0.06, 2.0));
        float s2 = exp(-pow((f - 0.7) / 0.04, 2.0)) * 0.5;
        float y = vUv.y;
        float ends = smoothstep(0.0, 0.08, y) * smoothstep(1.0, 0.9, y);
        float a = (0.03 + rim * 0.28 + (s1 + s2) * 0.22 * ends) * uStrength;
        vec3 c = mix(uTint, vec3(1.0), 0.35 + 0.4 * (s1 + s2));
        gl_FragColor = vec4(c * (0.6 + 1.6 * (s1 + s2 + rim)), clamp(a, 0.0, 1.0));
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** Chains a shader patch onto a material's own (keeping the program cache apart). */
export function chainShader(m: THREE.Material, key: string, fn: (s: THREE.WebGLProgramParametersWithUniforms) => void) {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey?.bind(m);
  m.onBeforeCompile = (s, r) => {
    prev?.call(m, s, r);
    fn(s);
  };
  m.customProgramCacheKey = () => `${prevKey ? prevKey() : ""}|${key}`;
}

function withWorld(s: THREE.WebGLProgramParametersWithUniforms) {
  if (s.vertexShader.includes("vLabW")) return;
  s.vertexShader = s.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vLabW;")
    .replace("#include <project_vertex>", "#include <project_vertex>\n vec4 labW = vec4(transformed, 1.0);\n #ifdef USE_INSTANCING\n labW = instanceMatrix * labW;\n #endif\n vLabW = (modelMatrix * labW).xyz;");
  s.fragmentShader = s.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vLabW;");
}

export interface HoloScan {
  color: { value: THREE.Color };
  feetY: { value: number };
  scanY: { value: number };
  /** The hologram's share: light at the feet, faint scanlines over the figure. */
  amount: { value: number };
  /** The scan line passing over it (0: none). */
  band: { value: number };
}

/** The figure on the table: a glowing seam and scanlines where it meets the projector, one bright scan line passing over it. */
export function holoScan(m: THREE.Material, scan: HoloScan, time: LabTime) {
  chainShader(m, "labscan", (s) => {
    withWorld(s);
    s.uniforms.uScanCol = scan.color;
    s.uniforms.uFeetY = scan.feetY;
    s.uniforms.uScanY = scan.scanY;
    s.uniforms.uHoloAmt = scan.amount;
    s.uniforms.uBandAmt = scan.band;
    s.uniforms.uLabTime = time;
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uScanCol;\nuniform float uFeetY, uScanY, uHoloAmt, uBandAmt, uLabTime;")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          float hy = vLabW.y - uFeetY;
          float base = 1.0 - smoothstep(0.0, 0.42, hy);
          float lines = 0.5 + 0.5 * sin((vLabW.y * 34.0 - uLabTime * 0.8) * 6.2831853);
          float band = exp(-pow((vLabW.y - uScanY) / 0.016, 2.0)) * 1.6 + 0.4 * exp(-pow((vLabW.y - uScanY) / 0.07, 2.0));
          float faint = 0.0;
          totalEmissiveRadiance += uScanCol * uHoloAmt * (base * base * (0.45 + 0.55 * lines) * 0.8 + band * 1.6 * uBandAmt + faint);
          // Still materialising (the wheel mid-turn): above the scan line the figure is only light, in scanlines.
          if (uBandAmt > 0.0 && vLabW.y > uScanY) {
            float l2 = smoothstep(0.6, 0.95, 0.5 + 0.5 * sin(vLabW.y * 6.2831853 * 34.0));
            float fade = smoothstep(uScanY, uScanY + 0.25, vLabW.y);
            diffuseColor.rgb *= mix(1.0, 0.03, fade);
            totalEmissiveRadiance += uScanCol * uBandAmt * fade * (0.22 + 0.7 * l2);
          }
        }`
      );
  });
}

/**
 * The holo-table's (and pods') face: dark glass with a projected pattern in
 * light (fine rings, a bright ring the figure stands in, ticks round the
 * edge, turning dashes, a hex lattice, a sweep).
 */
export function holoTop(m: THREE.MeshStandardMaterial, color: THREE.Color, centre: THREE.Vector3, radius: number, time: LabTime, strength: Live = 1) {
  chainShader(m, `labtop`, (s) => {
    withWorld(s);
    s.uniforms.uTopCol = { value: color };
    s.uniforms.uTopC = { value: centre };
    s.uniforms.uTopR = { value: radius };
    s.uniforms.uTopS = live(strength);
    s.uniforms.uLabTime = time;
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform vec3 uTopCol; uniform vec3 uTopC; uniform float uTopR, uTopS, uLabTime;\n${NOISE}`)
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          vec2 q = (vLabW.xz - uTopC.xz) / uTopR;
          float r = length(q);
          float ang = atan(q.y, q.x) / 6.2831853 + 0.5;
          float aa = fwidth(r) * 1.5;
          float fine = (1.0 - smoothstep(0.0, aa * 1.2 + 0.004, abs(fract(r * 12.0) - 0.5) / 12.0)) * 0.22 * step(r, 0.68);
          float feet = 1.0 - smoothstep(0.0, aa + 0.012, abs(r - 0.74));
          float feet2 = (1.0 - smoothstep(0.0, aa + 0.004, abs(r - 0.79))) * 0.55;
          float tickBand = step(0.86, r) * step(r, 0.93);
          float ticks = tickBand * step(fract(ang * 144.0), 0.22) * (0.55 + 0.45 * step(fract(ang * 12.0), 0.08));
          float dashBand = step(0.955, r) * step(r, 0.975);
          float dashes = dashBand * step(fract(ang * 9.0 + uLabTime * 0.03), 0.62);
          // Hex lattice (inside the feet ring).
          vec2 hp = q * 9.0;
          vec2 hq = vec2(hp.x * 1.1547, hp.y + hp.x * 0.57735);
          vec2 hf = fract(hq) - 0.5;
          float hex = (1.0 - smoothstep(0.38, 0.47, max(abs(hf.x), abs(hf.y)))) ;
          hex = (1.0 - hex) * 0.18 * step(r, 0.7) * (0.6 + 0.4 * labHash2(floor(hq)));
          float sweep = pow(fract(ang - uLabTime * 0.05), 6.0) * step(r, 0.84) * 0.35;
          float centre = exp(-r * r * 9.0) * 0.4;
          float edgeGlow = smoothstep(0.82, 1.0, r) * 0.25;
          float k = fine + feet * 1.6 + feet2 + ticks * 0.9 + dashes * 1.2 + hex + sweep + centre + edgeGlow;
          totalEmissiveRadiance += uTopCol * k * uTopS * step(r, 1.0);
        }`
      );
  });
}

/** The world-position varying, for other patches (the floor's, see room.ts). */
export function withWorldPos(s: THREE.WebGLProgramParametersWithUniforms) {
  withWorld(s);
}

/**
 * What a pod shows until its figure arrives: a hologram of a specimen being
 * scanned in (a soft capsule of light, scanlines climbing it, a bright ring
 * at its feet), so a pod is never empty and a figure never pops in.
 */
export function holoPlaceholder(color: THREE.Color, time: LabTime, strength: { value: number }) {
  return additive(
    "LabHoloPlaceholder",
    { uColor: { value: color }, uTime: time, uStrength: strength },
    /* glsl */ `
    uniform vec3 uColor; uniform float uTime; uniform float uStrength;
    varying vec2 vUv; varying vec3 vW;
    ${NOISE}
    void main() {
      vec2 q = vUv - vec2(0.5, 0.0);
      // A capsule: rounded top, the base on the pod's floor.
      float body = length(vec2(q.x / 0.3, max(0.0, vUv.y - 0.62) / 0.36));
      float inside = 1.0 - smoothstep(0.86, 1.0, body);
      float edge = smoothstep(0.7, 0.95, body) * inside;
      float lines = smoothstep(0.35, 0.85, 0.5 + 0.5 * sin((vW.y * 30.0 - uTime * 1.6) * 6.2831853));
      float sweep = exp(-pow((fract(uTime * 0.45) * 1.2 - vUv.y) / 0.05, 2.0));
      float flick = 0.85 + 0.15 * labHash(floor(uTime * 14.0));
      float a = inside * (0.06 + 0.18 * lines) + edge * 0.5 + sweep * inside * 0.9;
      // Feet ring.
      float ring = exp(-pow(vUv.y / 0.025, 2.0)) * (1.0 - smoothstep(0.25, 0.32, abs(q.x)));
      a += ring * 0.8;
      a *= smoothstep(1.0, 0.85, vUv.y) * flick;
      gl_FragColor = vec4(uColor * a * uStrength, 1.0);
    }`
  );
}
