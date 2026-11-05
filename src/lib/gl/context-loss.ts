/**
 * A lost WebGL context (a GPU reset, the browser reclaiming memory, Safari
 * after sleep) leaves the canvas black. While it's lost the scene draws
 * nothing; once the browser gives it back, or if it hasn't within `ms`, the
 * page builds the scene again on a fresh canvas (`onGone`), which brings back
 * every texture and target without relying on what survived the loss.
 * (The same recovery as World History's film.)
 */
export interface ContextWatch {
  /** The context is lost: skip drawing. */
  readonly lost: boolean;
  dispose(): void;
}

export const CONTEXT_REBUILD_MS = 2500;

export function watchContext(canvas: HTMLCanvasElement, onGone: (() => void) | undefined, ms = CONTEXT_REBUILD_MS): ContextWatch {
  let lost = false;
  let fired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const gone = () => {
    if (fired) return;
    fired = true;
    clearTimeout(timer);
    onGone?.();
  };
  const onLost = (e: Event) => {
    // Asks the browser to restore it (three.js does this too).
    e.preventDefault();
    lost = true;
    clearTimeout(timer);
    timer = setTimeout(gone, ms);
  };
  const onRestored = () => gone();
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  return {
    get lost() { return lost; },
    dispose() {
      fired = true;
      clearTimeout(timer);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
    },
  };
}
