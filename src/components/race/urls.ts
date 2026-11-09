import { figureArtUrl } from "@/lib/figure-art";
import type { SceneUrls } from "./scene";

/** Where the race's assets live: HOME renders (static, same-origin for WebGL), relief maps, textures. */
export const RACE_URLS: SceneUrls = {
  art: (id, size) => figureArtUrl(id, size),
  relief: (e) => (e.depth === "sizes" ? `/sizes/depth/${e.art}.webp` : `/race/depth/${e.art}.webp`),
  tex: (name, map) => (name === "leafy_grass" ? `/sizes/tex/${name}_${map}.webp` : `/race/tex/${name}_${map}.webp`),
};
