/**
 * Spring easing for the Web Animations API, without an animation library: the motion a damped spring
 * (mass 1, starting at rest) makes from 0 to 1, sampled into a CSS `linear()` easing, and how long it takes
 * to settle. The site header used framer-motion's springs for its two small animations; this draws the same
 * curves, so the header (on every page) no longer needs the library.
 */

export type Spring = { stiffness: number; damping: number; mass?: number };

const cache = new Map<string, { easing: string; duration: number }>();

/** Whether the browser reads `linear()` easings (Chrome 113, Safari 17.2, Firefox 112); otherwise a close cubic-bezier. */
function linearSupported(): boolean {
  try {
    return typeof CSS !== "undefined" && CSS.supports("animation-timing-function", "linear(0, 1)");
  } catch {
    return false;
  }
}

/** The spring's easing and settle time (ms), for `element.animate(keyframes, { duration, easing })`. */
export function springEasing({ stiffness, damping, mass = 1 }: Spring): { easing: string; duration: number } {
  const key = `${stiffness}/${damping}/${mass}`;
  const hit = cache.get(key);
  if (hit) return hit;
  // Integrate x'' = (-k (x - 1) - c x') / m from x = 0, v = 0, in 1 ms steps, until it rests near 1.
  const dt = 0.001;
  let x = 0;
  let v = 0;
  const xs: number[] = [0];
  let t = 0;
  while (t < 2) {
    const a = (-stiffness * (x - 1) - damping * v) / mass;
    v += a * dt;
    x += v * dt;
    t += dt;
    xs.push(x);
    // At rest: within 0.1% of the target and all but still.
    if (Math.abs(x - 1) < 0.001 && Math.abs(v) < 0.01) break;
  }
  const duration = Math.round(t * 1000);
  let easing = "cubic-bezier(0.2, 0.8, 0.2, 1)";
  if (linearSupported()) {
    // One point every ~8 ms is smooth at any frame rate.
    const step = Math.max(1, Math.round(xs.length / Math.max(2, Math.round(duration / 8))));
    const pts: string[] = [];
    for (let i = 0; i < xs.length; i += step) pts.push(xs[i].toFixed(4).replace(/\.?0+$/, "") || "0");
    pts.push("1");
    easing = `linear(${pts.join(", ")})`;
  }
  const out = { easing, duration };
  cache.set(key, out);
  return out;
}
