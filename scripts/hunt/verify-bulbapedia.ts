/**
 * Cross-check every answer against Bulbapedia's location tables.
 *
 *   python3 -I scripts/hunt/bulbapedia.py <downloads> <parsed.json>     # once, from the downloaded pages
 *   npx tsx scripts/hunt/verify-bulbapedia.ts <parsed.json> [out.json]
 *
 * For each entry and game: the places Bulbapedia lists for that form in the wild (or in Max Raid
 * dens, Sword / Shield only), matched to the map with the same game-aware matcher, against the
 * entry's places for that game. Prints the differences both ways.
 */
import fs from "node:fs";
import answers from "../../src/data/hunt/answers.json";
import geo from "../../src/data/geo.json";
import aboutForms from "../../src/data/about-forms.json";
import type { HuntAnswerFile } from "../../src/lib/hunt/types";
import { FORMS_IN_GAME, ORIGINAL_ONLY, formsInLabel, regionalForms, type EvidenceEntry } from "./forms";
import { buildPlaceIndex, isOffMap, matchPlace, type GeoPlace } from "./match";

/** Not a spot the table counts: Poké Pelago's visitors, Game Corner prizes. */
const IGNORED = /^(Poké Pelago|Isle Abeens|Game Corner|.*Game Corner|Terarium|League Club Room)$/;
const ZA_NAMES = /Wild Zone|District|Lumiose|Sewers|Lysandre|Sector|Quasartico|Research Lab|Old House/;

export interface Diff {
  id: string;
  version: string;
  /** In our answers, not on Bulbapedia's list for that game. */
  extra: string[];
  /** On Bulbapedia's list for that game, not in our answers. */
  missing: string[];
  /** Bulbapedia names we couldn't put on the map. */
  unplaced: string[];
}

export function compare(table: HuntAnswerFile, bulba: Record<string, EvidenceEntry[]>, locations: GeoPlace[], forms: [number, number, string, string, string][]): Diff[] {
  const idx = buildPlaceIndex(locations);
  const formsBy = regionalForms(forms);
  const out: Diff[] = [];
  for (const e of table.entries) {
    const fs_ = formsBy.get(e.dex);
    const ours = new Map<string, Set<string>>();
    for (const p of e.places) for (const m of p.methods) for (const v of m.versions) (ours.get(v) ?? ours.set(v, new Set()).get(v)!).add(`${p.geoRegion}|${p.name}`);
    const theirs = new Map<string, Set<string>>();
    const unplaced = new Map<string, Set<string>>();
    for (const be of bulba[String(e.dex)] ?? []) {
      for (const v of be.versions) {
        if (v === "legends-arceus") continue;
        for (const s of be.segments) {
          if (s.kind === "other") continue;
          if (s.kind === "raid" && v !== "sword" && v !== "shield") continue;
          // Which forms this line is about.
          let lineForms: (string | null)[] | undefined;
          if (!fs_?.length || ORIGINAL_ONLY.has(v) || !fs_.some((f) => (FORMS_IN_GAME[v] ?? []).includes(f.key.split("-")[0]))) lineForms = [null];
          else if (s.forms.length) {
            const parsed = s.forms.map((l) => formsInLabel(l, fs_));
            lineForms = parsed.every((x) => x) ? (parsed.flat() as (string | null)[]) : undefined;
          }
          if (!lineForms || !lineForms.includes(e.form)) continue;
          for (const name of s.places) {
            if (isOffMap(name) || IGNORED.test(name)) continue;
            // Z-A: only its own places (every one is Lumiose City); links to lists and guides aren't places.
            if (v === "legends-za" && !ZA_NAMES.test(name)) continue;
            const m = matchPlace(idx, name, v);
            if (m.kind === "place") (theirs.get(v) ?? theirs.set(v, new Set()).get(v)!).add(m.key);
            else if (/^[A-Z]/.test(name) && !/^(Route|Max Raid Battle|Wanderer|Type|Tera|Dynamax|List of|In-game|Trade|Pokémon|Sea|Kanto|Johto|Hoenn|Sinnoh|Unova|Kalos|Alola|Galar|Paldea)$/.test(name))
              (unplaced.get(v) ?? unplaced.set(v, new Set()).get(v)!).add(name);
          }
        }
      }
    }
    for (const v of new Set([...ours.keys(), ...theirs.keys()])) {
      const o = ours.get(v) ?? new Set();
      const t = theirs.get(v) ?? new Set();
      const extra = [...o].filter((k) => !t.has(k)).sort();
      const missing = [...t].filter((k) => !o.has(k)).sort();
      if (extra.length || missing.length) out.push({ id: e.id, version: v, extra, missing, unplaced: [...(unplaced.get(v) ?? [])].sort() });
    }
  }
  return out;
}

if (process.argv[1]?.endsWith("verify-bulbapedia.ts")) {
  const bulba = JSON.parse(fs.readFileSync(process.argv[2], "utf8")) as Record<string, EvidenceEntry[]>;
  const diffs = compare(answers as unknown as HuntAnswerFile, bulba, (geo as unknown as { world: { locations: GeoPlace[] } }).world.locations, aboutForms as unknown as [number, number, string, string, string][]);
  if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(diffs, null, 1));
  const ids = new Set(diffs.map((d) => d.id));
  console.log(`${diffs.length} game differences across ${ids.size} of ${(answers as unknown as HuntAnswerFile).entries.length} entries`);
  console.log(`  extra (ours only): ${diffs.filter((d) => d.extra.length).length}, missing (Bulbapedia only): ${diffs.filter((d) => d.missing.length).length}`);
}
