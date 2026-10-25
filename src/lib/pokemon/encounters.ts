import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { EncGen } from "./encounter-types";
import placesData from "@/data/places.json";
import { versionRegions } from "@/lib/dex/places";

const ENC = (placesData as unknown as { enc: Record<string, { k: string }> }).enc;

/** The Places page key of a row the atlas didn't match, from the places build's label map (first version that maps). */
function placeOf(loc: string, versions: string[]): string | undefined {
  for (const v of versions) for (const r of versionRegions(v)) if (ENC[`${loc}|${r}`]) return ENC[`${loc}|${r}`].k;
  return undefined;
}

const DIR = path.join(process.cwd(), "src/data/encounters");

/**
 * "Where to find it" rows for one species (built by scripts/dex/build-encounters.ts).
 * One small JSON file per species so no page ships anyone else's data; read at
 * build time only. Null when the pipeline hasn't been run for this species.
 */
export function getEncounters(id: number): EncGen[] | null {
  try {
    const gens = (JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), "utf8")) as { gens: EncGen[] }).gens;
    for (const g of gens)
      for (const r of g.rows) {
        if (r.a || r.x || !r.loc) continue;
        const p = placeOf(r.loc, r.v);
        if (p) r.p = p;
      }
    return gens.length ? gens : null;
  } catch {
    return null;
  }
}
