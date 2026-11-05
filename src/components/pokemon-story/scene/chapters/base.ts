import * as THREE from "three";
import { poseOnPath, type Key, type Pose, type Vec3 } from "@/lib/world-history/camera";
import { actionCurve, type Figure } from "@/components/world-history/scene/figures";
import { makeConverge } from "@/components/world-history/scene/kit";
import { figureStyle, floatFigure, pointPixel } from "@/components/world-history/scene/chapters/common";
import type { Look } from "@/components/world-history/scene/types";

/** Small shared pieces for the Story's chapters. */

/** Collects everything a chapter must dispose of. */
export function bag() {
  const items: { dispose(): void }[] = [];
  return {
    add<T extends { dispose(): void }>(x: T): T { items.push(x); return x; },
    dispose() { for (const x of items.splice(0)) { try { x.dispose(); } catch { /* already gone */ } } },
  };
}

/** The film-stock looks: warm 1970s grain early on, saturated pop in the middle, clean and bright at the end. */
export const STOCK: Record<"film70s" | "warm" | "pop" | "modern" | "clean", Partial<Look>> = {
  film70s: { grain: 0.11, vignette: 0.62, saturation: 0.92, contrast: 1.02, gain: [1.12, 1.0, 0.8], lift: [0.04, 0.025, 0.01], bloom: 0.8, bloomThreshold: 0.7 },
  warm: { grain: 0.07, vignette: 0.5, saturation: 1.02, contrast: 1.06, gain: [1.08, 1.0, 0.86], lift: [0.02, 0.012, 0.004], bloom: 0.85, bloomThreshold: 0.72 },
  pop: { grain: 0.045, vignette: 0.38, saturation: 1.22, contrast: 1.1, gain: [1.04, 1.0, 0.96], lift: [0.008, 0.006, 0.012], bloom: 0.95, bloomThreshold: 0.7 },
  modern: { grain: 0.03, vignette: 0.32, saturation: 1.12, contrast: 1.06, gain: [1, 1, 1], lift: [0.004, 0.006, 0.01], bloom: 1.0, bloomThreshold: 0.68 },
  clean: { grain: 0.02, vignette: 0.28, saturation: 1.06, contrast: 1.04, gain: [1.02, 1.0, 0.97], lift: [0.01, 0.01, 0.01], bloom: 1.25, bloomThreshold: 0.62 },
};

/**
 * A Pokémon that dissolves in out of light: rim light in the chapter's
 * accent, motes converging onto it as it forms, then a gentle bob.
 */
export function heroFigure(f: Figure | undefined, o: { pos: Vec3; height: number; rotY?: number; accent: string; scene: THREE.Object3D; motes?: number }) {
  if (!f) return null;
  f.setHeight(o.height);
  f.group.position.set(...o.pos);
  f.group.rotation.y = o.rotY ?? 0;
  o.scene.add(f.group);
  // Alive: breathing and sway, a solid relief with a darker back (the films-v2 figure shader).
  figureStyle(f, { rim: o.accent, rimK: 1.3, edge: o.accent, dissolve: 0, glow: o.accent, glowK: 0, alive: 1, flex: 0.8, depth: 1.35, back: 0.3 });
  f.castShadow(true);
  const conv = makeConverge(f.points, { radius: o.height * 0.9, colors: ["#ffffff", o.accent], size: [0.012, 0.03], intensity: 2.2, spin: 0.9 });
  conv.points.scale.setScalar(o.height / Math.max(1e-3, f.height));
  conv.points.position.set(...o.pos);
  conv.points.rotation.y = o.rotY ?? 0;
  o.scene.add(conv.points);
  let base: Vec3 = [...o.pos];
  /** The ambient time it finished forming (it settles with a little follow-through then). */
  let formedAt = -1;
  return {
    fig: f,
    /** k: 0 hidden … 1 formed; glow: extra light while it forms. */
    set(k: number, ambient: number, viewH: number, cam: THREE.PerspectiveCamera, bob = 0.06, glow = 0) {
      const d = Math.max(0, Math.min(1, k));
      if (d >= 0.995 && formedAt < 0) formedAt = ambient;
      if (d < 0.5) formedAt = -1;
      figureStyle(f, { dissolve: d, glowK: glow + (1 - d) * 0.6 * (d > 0 ? 1 : 0), act: formedAt >= 0 ? actionCurve(ambient, formedAt, { pre: 0, post: 0.8 }) * 0.8 : 0 });
      floatFigure(f, base, ambient, bob * (o.height / 3), o.pos[0], o.rotY ?? 0, 0.04);
      conv.u.uForm.value = Math.min(1, d * 1.15);
      conv.u.uTime.value = ambient;
      conv.u.uOpacity.value = d > 0 && d < 1 ? Math.sin(Math.PI * d) : 0;
      conv.u.uPixel.value = pointPixel(viewH, cam);
      conv.points.visible = d > 0.001 && d < 0.999;
      conv.points.position.copy(f.group.position);
      conv.points.rotation.y = f.group.rotation.y;
    },
    move(pos: Vec3, rotY?: number) {
      base = [...pos];
      if (rotY !== undefined) { f.group.rotation.y = rotY; o.rotY = rotY; }
    },
    dispose() { conv.dispose(); f.dispose(); },
  };
}

export type Hero = NonNullable<ReturnType<typeof heroFigure>>;

/** Wraps [−π, π] smoothly: an angle eased from a to b. */
export const lerpAngle = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * A camera made of shots: each shot is its own key path from its start
 * time, and the film cuts between them (a cut never bends the spline of the
 * shot before or after it).
 */
export function shots(list: [number, Key[]][]): (t: number) => Pose {
  const sorted = [...list].sort((a, b) => a[0] - b[0]);
  return (t) => {
    let k = sorted[0][1];
    for (const [t0, keys] of sorted) if (t >= t0) k = keys;
    return poseOnPath(k, t);
  };
}

/** Which stage a moment is in: the index of the last start ≤ t. */
export function stageAt(starts: number[], t: number) {
  let i = 0;
  for (let j = 0; j < starts.length; j++) if (t >= starts[j]) i = j;
  return i;
}
