/**
 * Whether this browser can draw WebGL: a throwaway canvas asks for a context, which is then given straight back.
 * Browsers cap the live WebGL contexts on a page (about 16) and drop the oldest when a new one is made, so a probe
 * that kept its context could cost a later scene its own; it also held the context's memory until collected.
 */
export function webglProbe(kinds: readonly ("webgl2" | "webgl")[] = ["webgl2"]): boolean {
  if (typeof document === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    for (const kind of kinds) {
      const gl = c.getContext(kind) as WebGLRenderingContext | WebGL2RenderingContext | null;
      if (gl) {
        gl.getExtension("WEBGL_lose_context")?.loseContext();
        return true;
      }
    }
  } catch {
    // no WebGL
  }
  return false;
}
