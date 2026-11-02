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
