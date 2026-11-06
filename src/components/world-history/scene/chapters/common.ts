import * as THREE from "three";
import type { Pose, Vec3 } from "@/lib/world-history/camera";
import type { Figure } from "../figures";
import { BASE_LOOK, type ChapterCtx, type Look } from "../types";
import { col, keyed } from "../kit";
import { castShadows, keyShadow, receiveShadows, type KeyShadow } from "../light";
import { withDetail, type DetailOpts } from "../materials";

/** Shared pieces for the chapters: figures by art id, keyed looks, shakes and billboards. */

export async function loadFigures(ctx: ChapterCtx, arts: number[]): Promise<Map<number, Figure>> {
  const out = new Map<number, Figure>();
  const figs = await Promise.all(arts.map((a) => ctx.figures.load(a, ctx.signal).catch((e) => { if (ctx.signal.aborted) throw e; console.warn("[world-history] figure", a, e); return null; })));
  figs.forEach((f, i) => { if (f) out.set(arts[i], f); });
  return out;
}

/** Places a figure: feet at `pos`, a world height, turned about y. */
export function place(f: Figure | undefined, pos: Vec3, height: number, rotY = 0, scene?: THREE.Object3D) {
  if (!f) return;
  f.setHeight(height);
  f.group.position.set(...pos);
  f.group.rotation.y = rotY;
  scene?.add(f.group);
}

export function figureStyle(
  f: Figure | undefined,
  o: {
    rim?: string; rimK?: number; glow?: string; glowK?: number; edge?: string; dissolve?: number; shadow?: number; stone?: number;
    /** Opt-in life (see figures.ts): idle breathing and sway, extra secondary motion, an action curve, a hit, a lean. */
    alive?: number; flex?: number; act?: number; hit?: number; lean?: number;
    /** Opt-in solidity: depth scale and a darker back. */
    depth?: number; back?: number;
  }
) {
  if (!f) return;
  if (o.alive !== undefined) f.u.uAlive.value = o.alive;
  if (o.flex !== undefined) f.u.uFlex.value = o.flex;
  if (o.act !== undefined) f.u.uAct.value = o.act;
  if (o.hit !== undefined) f.u.uHit.value = o.hit;
  if (o.lean !== undefined) f.u.uLean.value = o.lean;
  if (o.depth !== undefined) f.u.uDepthK.value = o.depth;
  if (o.back !== undefined) f.u.uBack.value = o.back;
  if (o.rim) f.u.uRimColor.value.copy(col(o.rim));
  if (o.rimK !== undefined) f.u.uRim.value = o.rimK;
  if (o.glow) f.u.uGlowColor.value.copy(col(o.glow));
  if (o.glowK !== undefined) f.u.uGlow.value = o.glowK;
  if (o.edge) f.u.uEdgeColor.value.copy(col(o.edge));
  if (o.dissolve !== undefined) f.u.uDissolve.value = o.dissolve;
  if (o.shadow !== undefined) f.u.uShadow.value = o.shadow;
  if (o.stone !== undefined) f.u.uStone.value = o.stone;
  f.mesh.visible = (o.dissolve ?? f.u.uDissolve.value) > 0.001;
}

/**
 * The crafted-film defaults for a figure that lives on screen: solid from
 * the side, breathing, a soft contact shadow where it stands (pass the
 * ground height for one that hovers), and a cast shadow from the
 * chapter's shadow light.
 */
export function livingFigure(f: Figure | undefined, o: { alive?: number; depth?: number; back?: number; contact?: number; ground?: number; cast?: boolean } = {}) {
  if (!f) return;
  figureStyle(f, { alive: o.alive ?? 1, depth: o.depth ?? 1.4, back: o.back ?? 0.35 });
  if ((o.contact ?? 0.55) > 0) f.setContact(o.contact ?? 0.55, o.ground);
  f.castShadow(o.cast ?? true);
}

/**
 * The film treatment for a chapter in one call: the key light casts soft
 * shadows (box `radius`), the grounds receive them, the casters and living
 * figures cast them, figures come alive (with a contact shadow where they
 * stand: give `ground` for each one that hovers, or null for none), and
 * materials get procedural detail. Returns the shadow, to `follow()` the
 * action in update().
 */
export function craft(
  ctx: ChapterCtx,
  L: { key: THREE.DirectionalLight },
  o: {
    radius: number;
    center?: Vec3;
    receive?: (THREE.Object3D | null | undefined)[];
    cast?: (THREE.Object3D | null | undefined)[];
    figures?: [Figure | undefined, { ground?: number | null; alive?: number; depth?: number; contact?: number }?][];
    detail?: [THREE.Material | THREE.Material[] | undefined, DetailOpts][];
  }
): KeyShadow {
  const sh = keyShadow(ctx.q, L.key, { radius: o.radius, center: o.center });
  receiveShadows(...(o.receive ?? []));
  castShadows(...(o.cast ?? []));
  for (const [f, fo = {}] of o.figures ?? []) {
    if (!f) continue;
    livingFigure(f, { alive: fo.alive, depth: fo.depth, contact: fo.ground === null ? 0 : fo.contact, ground: fo.ground ?? undefined });
  }
  for (const [m, d] of o.detail ?? []) if (m) withDetail(m, d);
  return sh;
}

/** A look built from the base and a few keyed channels. */
export type LookKeys = Partial<Record<"exposure" | "bloom" | "bloomThreshold" | "saturation" | "contrast" | "vignette" | "chroma" | "flash" | "fade" | "grain" | "rays", [number, number][]>> & {
  gain?: [number, Vec3][];
  lift?: [number, Vec3][];
};

function keyed3(keys: [number, Vec3][], t: number): Vec3 {
  return [keyed(keys.map(([k, v]) => [k, v[0]]), t), keyed(keys.map(([k, v]) => [k, v[1]]), t), keyed(keys.map(([k, v]) => [k, v[2]]), t)];
}

export function lookAt(t: number, base: Partial<Look>, k: LookKeys, rays?: { pos: Vec3; color: Vec3 }): Look {
  const L: Look = { ...BASE_LOOK, ...base };
  for (const name of ["exposure", "bloom", "bloomThreshold", "saturation", "contrast", "vignette", "chroma", "flash", "fade", "grain"] as const) {
    const keys = k[name];
    if (keys) L[name] = keyed(keys, t);
  }
  if (k.gain) L.gain = keyed3(k.gain, t);
  if (k.lift) L.lift = keyed3(k.lift, t);
  if (rays && k.rays) {
    const s = keyed(k.rays, t);
    if (s > 0.001) L.rays = { pos: rays.pos, color: rays.color, strength: s };
  }
  return L;
}

/**
 * The crafted-film lens on top of a chapter's look (all opt-in fields of
 * Look): the filmic tone curve, gentle edge fringing, an anamorphic streak
 * on hot lights, camera motion blur on fast moves, and, when given, height
 * fog and a focus pull. Each quality keeps only what it can afford.
 */
export function cine(
  L: Look,
  o: {
    fog?: Look["fog"]; dof?: Look["dof"]; streak?: number; streakColor?: Vec3; fringe?: number; mblur?: number; whip?: Look["whip"]; tone?: Look["tone"];
    hueKeep?: number; black?: number; split?: Look["split"]; bloomKnee?: number; bloomCap?: number; flashHdr?: boolean;
  } = {}
): Look {
  return {
    ...L,
    // Pass 2 defaults: hot lights keep their colour, real blacks, cool shadows against warm highlights, and bloom only on what is truly hot.
    // Colour fringing on hits stays a hint (strong fringing reads as a cheap glitch).
    chroma: Math.min(L.chroma, 0.22),
    hueKeep: o.hueKeep ?? 0.75,
    black: o.black ?? 0.035,
    split: o.split ?? { shadows: [-0.012, 0.0, 0.03], highlights: [0.03, 0.012, -0.02] },
    bloomKnee: o.bloomKnee ?? 0.7,
    bloomCap: o.bloomCap ?? 6,
    flashHdr: o.flashHdr ?? true,
    tone: o.tone ?? "filmic",
    fringe: o.fringe ?? 0.25,
    streak: o.streak ?? 0.18,
    streakColor: o.streakColor ?? L.streakColor,
    mblur: o.mblur ?? 0.8,
    fog: o.fog ?? L.fog,
    dof: o.dof ?? L.dof,
    whip: o.whip ?? L.whip,
  };
}

/** A spike: 0 before `at`, up to 1 quickly, then decaying. */
export function spike(t: number, at: number, rise = 0.06, fall = 0.8): number {
  if (t < at) return 0;
  const d = t - at;
  return d < rise ? d / rise : Math.exp(-(d - rise) / fall);
}

/** A decaying shake added to a pose. */
export function shake(p: Pose, t: number, hits: { at: number; k: number; dur?: number }[]): Pose {
  let a = 0;
  for (const h of hits) {
    const d = t - h.at;
    if (d < 0 || d > (h.dur ?? 1.4)) continue;
    a += h.k * Math.exp(-d * 3.2);
  }
  if (a < 1e-4) return p;
  const s = (f: number, o: number) => Math.sin(t * f + o) * a;
  return { ...p, pos: [p.pos[0] + s(37, 0.3), p.pos[1] + s(43, 1.7), p.pos[2] + s(31, 2.9) * 0.5], look: [p.look[0] + s(29, 4.1) * 0.6, p.look[1] + s(41, 0.9) * 0.6, p.look[2]], roll: (p.roll ?? 0) + s(23, 0.5) * 0.004 };
}

/** Turns a flat object to face the camera. */
export function billboard(o: THREE.Object3D, cam: THREE.Camera) {
  o.quaternion.copy(cam.quaternion);
}

/** A gentle float: bob and sway. */
export function floatFigure(f: Figure | undefined, base: Vec3, ambient: number, amp = 0.15, phase = 0, rotY = 0, sway = 0.06) {
  if (!f) return;
  f.group.position.set(base[0], base[1] + Math.sin(ambient * 0.8 + phase) * amp, base[2]);
  f.group.rotation.y = rotY + Math.sin(ambient * 0.37 + phase) * sway;
}

export function pointPixel(viewH: number, cam: THREE.PerspectiveCamera) {
  return viewH / (2 * Math.tan((cam.fov * Math.PI) / 360));
}

/** Standard light rig: hemisphere fill, a key, a rim. */
export function lights(scene: THREE.Scene, o: { sky: string; ground: string; fill?: number; key: string; keyK: number; keyPos: Vec3; rim?: string; rimK?: number; rimPos?: Vec3 }) {
  const hemi = new THREE.HemisphereLight(col(o.sky), col(o.ground), o.fill ?? 0.5);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(col(o.key), o.keyK);
  key.position.set(...o.keyPos);
  scene.add(key, key.target);
  let rim: THREE.DirectionalLight | null = null;
  if (o.rim) {
    rim = new THREE.DirectionalLight(col(o.rim), o.rimK ?? 0.8);
    rim.position.set(...(o.rimPos ?? [0, 5, -20]));
    scene.add(rim, rim.target);
  }
  return { hemi, key, rim };
}
