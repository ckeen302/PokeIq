import * as THREE from "three";

/**
 * Procedural surface detail for the films' standard materials: a
 * world-space height pattern per kind of surface (ground, stone, wood,
 * bark, fabric, metal) that bends the shading normal (no texture: the
 * slope comes from screen-space derivatives, as three's bump maps do),
 * varies roughness, and mottles the colour a little. It fades out with
 * distance so far ground never shimmers. Patches the material in place
 * and keeps any patch it already has (stone grime, terrain lava).
 *
 *   withDetail(ground.mesh.material, { kind: "ground", scale: 1.5 })
 */

export type DetailKind = "ground" | "stone" | "wood" | "bark" | "fabric" | "metal";
const KIND: Record<DetailKind, number> = { ground: 0, stone: 1, wood: 2, bark: 3, fabric: 4, metal: 5 };

export interface DetailOpts {
  kind: DetailKind;
  /** Pattern frequency (per world unit; bigger: finer). */
  scale?: number;
  /** Bump strength. */
  bump?: number;
  /** Roughness variation (± share). */
  rough?: number;
  /** Colour mottling (± share). */
  tint?: number;
  /** The grain's direction for wood and bark (world space). */
  axis?: [number, number, number];
}

const DETAIL_PARS = /* glsl */ `
varying vec3 vDetW;
uniform float uDetScale, uDetBump, uDetRough, uDetTint; uniform vec3 uDetAxis;
float dtHash(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float dtNoise(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dtHash(i), dtHash(i + vec3(1,0,0)), f.x), mix(dtHash(i + vec3(0,1,0)), dtHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(dtHash(i + vec3(0,0,1)), dtHash(i + vec3(1,0,1)), f.x), mix(dtHash(i + vec3(0,1,1)), dtHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float dtHeight(vec3 p){
  float n1 = dtNoise(p), n2 = dtNoise(p * 2.1 + 3.7), n3 = dtNoise(p * 4.3 + 9.1);
  #if DETAIL_KIND == 0
    // Ground: soft undulation, grit and the odd pebble.
    return n1 * 0.45 + n2 * 0.3 + n3 * 0.25 + 0.5 * smoothstep(0.72, 0.86, dtNoise(p * 3.1 + 17.0));
  #elif DETAIL_KIND == 1
    // Stone: lumpy faces split by fine cracks.
    float crack = 1.0 - abs(dtNoise(p * 0.9 + 5.0) * 2.0 - 1.0);
    return n1 * 0.5 + n2 * 0.3 + n3 * 0.2 - 0.9 * smoothstep(0.9, 0.99, crack);
  #elif DETAIL_KIND == 2 || DETAIL_KIND == 3
    // Wood and bark: grain stretched along the axis.
    vec3 a = normalize(uDetAxis);
    vec3 q = p - a * dot(p, a) * 0.93;
    float g = dtNoise(q * 3.0) * 0.6 + dtNoise(q * 9.0 + a * dot(p, a) * 0.2) * 0.4;
    #if DETAIL_KIND == 3
      return smoothstep(0.35, 0.65, g) * 0.8 + n3 * 0.2;
    #else
      return sin(g * 18.0) * 0.25 + 0.5 + n3 * 0.15;
    #endif
  #elif DETAIL_KIND == 4
    // Fabric: a fine weave with soft folds.
    vec3 w = sin(p * 40.0);
    return (w.x * w.y + w.y * w.z + w.z * w.x) * 0.12 + n1 * 0.7;
  #else
    // Metal: hammered, faint.
    return n2 * 0.6 + n3 * 0.4;
  #endif
}
vec3 dtPerturb(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir){
  vec3 dx = dFdx(surfPos), dy = dFdy(surfPos);
  vec3 sx = dx / max(length(dx), 1e-8), sy = dy / max(length(dy), 1e-8);
  vec3 r1 = cross(sy, surfNorm), r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  vec3 n = abs(det) * surfNorm - grad;
  return n / max(length(n), 1e-8);
}
`;

export function withDetail(material: THREE.Material | THREE.Material[], o: DetailOpts) {
  const mat = (Array.isArray(material) ? material[0] : material) as THREE.MeshStandardMaterial;
  if (!mat || !(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
  const u = {
    uDetScale: { value: o.scale ?? 1 },
    uDetBump: { value: o.bump ?? 1 },
    uDetRough: { value: o.rough ?? 0.25 },
    uDetTint: { value: o.tint ?? 0.12 },
    uDetAxis: { value: new THREE.Vector3(...(o.axis ?? [0, 1, 0])) },
  };
  const prev = mat.onBeforeCompile;
  // The key of whatever patch it had (taken now: the default key is the patch's own source).
  const prevKey = mat.customProgramCacheKey.call(mat);
  mat.onBeforeCompile = (s, r) => {
    prev.call(mat, s, r);
    Object.assign(s.uniforms, u);
    s.defines = { ...(s.defines ?? {}), DETAIL_KIND: KIND[o.kind] };
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vDetW;")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        #ifdef USE_INSTANCING
          vDetW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vDetW = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`
      );
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>\n${DETAIL_PARS}`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec3 detP = vDetW * uDetScale;
        float detH = dtHeight(detP);
        float detFade = clamp(1.0 - length(vViewPosition) * uDetScale / 90.0, 0.0, 1.0);
        diffuseColor.rgb *= 1.0 + (detH - 0.5) * 2.0 * uDetTint * (0.4 + 0.6 * detFade);`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * (1.0 + (dtNoise(detP * 0.37 + 2.0) - 0.5) * 2.0 * uDetRough), 0.04, 1.0);`
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        if (detFade > 0.0) normal = dtPerturb(-vViewPosition, normal, vec2(dFdx(detH), dFdy(detH)) * uDetBump * detFade, faceDirection);`
      );
  };
  mat.customProgramCacheKey = () => `${prevKey}|detail-${o.kind}`;
  mat.needsUpdate = true;
  return u;
}
