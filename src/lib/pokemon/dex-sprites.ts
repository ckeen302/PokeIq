import "server-only";
import MANIFEST from "@/data/dex-sprites.json";
import { spriteColumns, type SpriteCode, type SpriteColumn } from "./sprites";

/**
 * Reads the sprites manifest (src/data/dex-sprites.json, written by
 * scripts/dex-sprites.ts): server-side only, so a species page carries just
 * its own row, never the whole table.
 */

const ROWS: readonly SpriteCode[] = MANIFEST.rows;

/** A species' manifest row, or null for a number outside the National Dex. */
export function spriteCode(id: number): SpriteCode | null {
  return Number.isInteger(id) && id >= 1 ? ROWS[id - 1] ?? null : null;
}

/** The sprites table's columns for a species (empty when it has no row). */
export function dexSpriteColumns(id: number): SpriteColumn[] {
  const code = spriteCode(id);
  return code ? spriteColumns(id, code) : [];
}
