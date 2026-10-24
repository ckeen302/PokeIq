import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { EncGen } from "./encounter-types";

const DIR = path.join(process.cwd(), "src/data/encounters");

/**
 * "Where to find it" rows for one species (built by scripts/dex/build-encounters.ts).
 * One small JSON file per species so no page ships anyone else's data; read at
 * build time only. Null when the pipeline hasn't been run for this species.
 */
export function getEncounters(id: number): EncGen[] | null {
  try {
    const gens = (JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), "utf8")) as { gens: EncGen[] }).gens;
    return gens.length ? gens : null;
  } catch {
    return null;
  }
}
