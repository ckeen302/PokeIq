import type { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

/**
 * Reads of an HDR scene go through this: a pixel that came out NaN or
 * infinite (a pow of a tiny negative, a normalize of zero: GPUs that follow
 * IEEE strictly, like Apple's, give NaN where others give 0) becomes black
 * instead of poisoning the bloom, whose blurs would spread it into large
 * black blocks across the frame. Checked on the bits, so no compiler's
 * fast-math can fold it away. (The same guard World History's post chain uses.)
 */
export const SAFE_HDR = /* glsl */ `
float glSafe1(float v){ return (floatBitsToUint(v) & 0x7f800000u) == 0x7f800000u ? 0.0 : clamp(v, 0.0, 60000.0); }
vec3 glSafe(vec3 c){ return vec3(glSafe1(c.r), glSafe1(c.g), glSafe1(c.b)); }
`;

/** The lines of three.js's shaders (bloom high pass, copy) that `scrubRead` patches (checked by tests). */
export const THREE_MAIN = "void main() {";
export const THREE_READ = "vec4 texel = texture2D( tDiffuse, vUv );";

/** A three.js fragment shader whose read of tDiffuse is scrubbed. */
export function scrubRead(fragmentShader: string): string {
  return fragmentShader.replace(THREE_MAIN, `${SAFE_HDR}\n${THREE_MAIN}`).replace(THREE_READ, `${THREE_READ} texel.rgb = glSafe( texel.rgb );`);
}

/** Scrubs the bloom's first read of the scene, so one bad pixel can't be blurred into a block. */
export function scrubBloom(bloom: UnrealBloomPass): void {
  const hp = bloom.materialHighPassFilter;
  hp.fragmentShader = scrubRead(hp.fragmentShader);
  hp.needsUpdate = true;
}
