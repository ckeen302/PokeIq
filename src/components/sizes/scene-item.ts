import { dims, type SizeItem } from "@/lib/sizes/types";
import type { SceneUrls } from "./scene";
import type { SceneItem } from "./scene/figures";

/**
 * What the 3D scene needs of a figure, and where its assets live. Kept apart
 * from the scene itself so the page can prepare a line without loading
 * three.js.
 */

export function toSceneItem(i: SizeItem): SceneItem {
  const d = dims(i);
  return { key: i.key, name: i.name, kind: i.kind, art: i.art, species: i.species, m: i.m, length: i.length, min: i.min, w: d.w, h: d.h, box: [i.bx, i.by, i.bw, i.bh, i.bs || 512], types: i.types, ref: i.ref?.kind };
}

export const SCENE_URLS: SceneUrls = {
  art: (id, size) => `/api/sizes/home/${id}?s=${size}`,
  relief: (id) => `/sizes/depth/${id}.webp`,
  tex: (name, map) => `/sizes/tex/${name}_${map}.webp`,
  hdr: "/sizes/env/wide_street_01_1k.hdr",
};
