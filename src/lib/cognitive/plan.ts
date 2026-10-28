import { ANCHORS } from "./anchors";
import { maxRaw } from "./adaptive";
import { matrixItem, numberItem } from "./fluid";
import { arithItem, spanItem } from "./memory";
import { SPEED_MS } from "./speed";
import { pathItem, pileItem, rotationItem } from "./spatial";
import type { CogItem, CogSection, Level } from "./types";

/**
 * The shape of the test: how many items each section has, which kind sits
 * in each slot, and how an item is built from (run seed, slot, level).
 * Every item is a pure function of those three, so a retake with a new seed
 * is a new test and a unit test can rebuild any item.
 */

export const PLAN = {
  fluid: { items: 12 },
  memory: { items: 12 },
  speed: { ms: SPEED_MS },
  spatial: { items: 12 },
} as const;

/** Item slots: three matrices then a number sequence, and so on. */
export const fluidKind = (index: number): "matrix" | "number" => (index % 4 === 3 ? "number" : "matrix");
/** Six spans (forward, then reverse) and six sums, alternating so the recall isn't one long block. */
export const memoryKind = (index: number): "forward" | "reverse" | "arith" => (index % 2 === 1 ? "arith" : index < 6 ? "forward" : "reverse");
export const spatialKind = (index: number): "rotation" | "path" | "pile" => (["rotation", "path", "pile"] as const)[index % 3];

/** The item for a slot. `usedAnchors` lets the reasoning section place each fixed anchor once per run. */
export function sectionItem(section: CogSection, seed: string, index: number, level: Level, usedAnchors?: Set<string>): CogItem {
  const slot = `${seed}:${section}:${index}`;
  switch (section) {
    case "fluid": {
      const kind = fluidKind(index);
      if (usedAnchors) {
        const anchor = ANCHORS.find((a) => a.level === level && a.kind === kind && !usedAnchors.has(a.id));
        if (anchor) {
          usedAnchors.add(anchor.id);
          return anchor;
        }
      }
      return kind === "number" ? numberItem(slot, level) : matrixItem(slot, level);
    }
    case "memory": {
      const kind = memoryKind(index);
      return kind === "arith" ? arithItem(slot, level) : spanItem(slot, level, kind === "reverse");
    }
    case "spatial": {
      const kind = spatialKind(index);
      return kind === "rotation" ? rotationItem(slot, level) : kind === "path" ? pathItem(slot, level) : pileItem(slot, level);
    }
    case "speed":
      throw new Error("the speed section has rows, not items");
  }
}

/** The top of each raw scale (the speed section's is where the norm table stops). */
export const MAX_RAW: Record<CogSection, number> = {
  fluid: maxRaw(PLAN.fluid.items),
  memory: maxRaw(PLAN.memory.items),
  speed: 120,
  spatial: maxRaw(PLAN.spatial.items),
};
