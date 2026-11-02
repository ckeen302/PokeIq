/** Whether this browser can draw WebGL (checked once; never creates a three.js renderer, so a missing GPU logs nothing). */
let cached: boolean | null = null;

export function webglAvailable(): boolean {
  if (cached !== null) return cached;
  if (typeof document === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    cached = !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    cached = false;
  }
  return cached;
}

let software: boolean | null = null;

/**
 * Whether WebGL here is drawn on the CPU (SwiftShader, llvmpipe and the
 * like: no usable GPU, or a blocklisted one). Compiling a 3D trainer's
 * shaders there can hold the page up for seconds, so the versus intro
 * shows its flat look instead. Unknown renderers count as hardware.
 */
export function softwareWebgl(): boolean {
  if (software !== null) return software;
  software = false;
  if (typeof document === "undefined") return software;
  try {
    const gl = (document.createElement("canvas").getContext("webgl") as WebGLRenderingContext | null) ?? null;
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    const name = info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    // unknown: hardware
  }
  return software;
}
