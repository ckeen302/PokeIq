import type * as THREE from "three";
import { createHistoryScene, HALL_LOOK, type HistoryScene, type SceneOptions } from "@/components/world-history/scene";
import type { Look } from "@/components/world-history/scene/types";
import type { Chapter as HistoryChapter } from "@/lib/world-history/types";
import { CHAPTERS } from "@/lib/pokemon-story/data";
import { buildArchive } from "./archive";

/**
 * The Story of Pokémon's 3D side: World History's engine (chapters built
 * on demand, portals in the hall, the film grade, video cuts) with the
 * Story's own chapter builders, its Archive hall and a warmer hall grade.
 */

const BUILDERS: SceneOptions["builders"] = {
  collector: () => import("./chapters/collector"),
  "game-freak": () => import("./chapters/game-freak"),
  cable: () => import("./chapters/cable"),
  "six-years": () => import("./chapters/six-years"),
  "red-green": () => import("./chapters/red-green"),
  pokemania: () => import("./chapters/pokemania"),
  growing: () => import("./chapters/growing"),
  together: () => import("./chapters/together"),
  outside: () => import("./chapters/outside"),
  "open-worlds": () => import("./chapters/open-worlds"),
  thirty: () => import("./chapters/thirty"),
};

const ARCHIVE_LOOK: Look = { ...HALL_LOOK, exposure: 1.1, bloom: 0.85, gain: [1.08, 1.0, 0.88], lift: [0.02, 0.012, 0.006], saturation: 1.0, vignette: 0.55, grain: 0.05 };

/** The prologue opens on black and lamps; the epilogue dims them again. */
export function archiveLook(h: { from: number; to: number; k: number }): Look {
  if (h.from < 0) return { ...ARCHIVE_LOOK, fade: Math.max(0, 1 - h.k * 2.2), grain: 0.07 };
  if (h.to >= CHAPTERS.length) return { ...ARCHIVE_LOOK, fade: Math.max(0, (h.k - 0.6) * 1.6), bloom: 1.05 };
  return ARCHIVE_LOOK;
}

export function createStoryScene(host: HTMLElement, opts: Omit<SceneOptions, "chapters" | "builders" | "hall" | "hallLook">): HistoryScene {
  return createHistoryScene(host, {
    ...opts,
    // The engine reads a chapter's id, accent and figures; the Story's chapters have all three.
    chapters: CHAPTERS as unknown as HistoryChapter[],
    builders: BUILDERS,
    hall: (renderer: THREE.WebGLRenderer) => buildArchive(CHAPTERS, opts.font, renderer),
    hallLook: archiveLook,
  });
}

export type { HistoryScene, Quality } from "@/components/world-history/scene";
