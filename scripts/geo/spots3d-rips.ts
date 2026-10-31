/**
 * Downloads the sprite games' full area maps ("rips") that the 3D remakes
 * share their layouts with (Diamond / Pearl / Platinum for Brilliant Diamond /
 * Shining Pearl), for scripts/geo/spots3d.ts to match the remakes' shots
 * against. Normal, rate-limited requests (scripts/geo/http.ts); everything is
 * cached in a local folder that is never committed.
 *
 *   npx tsx scripts/geo/spots3d-rips.ts <cache-dir> [family]
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { download, fileInfo } from "./bulbapedia";

/** The family a remake's shots are matched against, and the rips' Bulbapedia file names for each of its places. */
export const RIP_SETS: Record<string, { against: string; places: Record<string, string[]> }> = {
  bdsp: {
    against: "dppt",
    places: Object.fromEntries([
      ...Array.from({ length: 30 }, (_, i) => 201 + i).map((n) => [`Route ${n}`, [`Sinnoh_Route_${n}_DP.png`, `Sinnoh_Route_${n}_Pt.png`]]),
      ...[
        "Twinleaf Town",
        "Sandgem Town",
        "Jubilife City",
        "Oreburgh City",
        "Floaroma Town",
        "Eterna City",
        "Hearthome City",
        "Solaceon Town",
        "Veilstone City",
        "Pastoria City",
        "Celestic Town",
        "Canalave City",
        "Snowpoint City",
        "Sunyshore City",
        "Lake Verity",
        "Lake Valor",
        "Lake Acuity",
        "Floaroma Meadow",
        "Valley Windworks",
        "Fuego Ironworks",
        "Great Marsh",
        "Seabreak Path",
        "Fullmoon Island",
        "Resort Area",
        "Fight Area",
        "Survival Area",
        "Sendoff Spring",
        "Flower Paradise",
        "Pokémon League",
      ].map((p) => {
        const base = p === "Pokémon League" ? "Sinnoh_Pokémon_League" : p.replace(/ /g, "_");
        return [p, [`${base}_DP.png`, `${base}_Pt.png`, `${base}_DPPt.png`]];
      }),
    ]),
  },
};

/** A rip's file in the cache. */
export const ripPath = (dir: string, file: string) => path.join(dir, "rips", file);

async function main() {
  const [dir, family = "bdsp"] = process.argv.slice(2);
  if (!dir) throw new Error("usage: spots3d-rips.ts <cache-dir> [family]");
  const set = RIP_SETS[family];
  if (!set) throw new Error(`no rip set for ${family}`);
  mkdirSync(path.join(dir, "rips"), { recursive: true });
  const files = [...new Set(Object.values(set.places).flat())].filter((f) => !existsSync(ripPath(dir, f)));
  const info = await fileInfo(files);
  console.log(`${info.size} of ${files.length} new rips exist on Bulbapedia`);
  for (const [file, { url }] of info) {
    writeFileSync(ripPath(dir, file), await download(url));
    console.log("  got", file);
  }
}

if (process.argv[1]?.endsWith("spots3d-rips.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
