/**
 * What Bulbapedia and Serebii agree on, for the build's completeness checks.
 *
 *   npx tsx scripts/hunt/make-agreed.ts <bulbapedia parsed.json> --detail <serebii detail.json> <serebii overview.json>…
 *
 * For every species and form, and every game both sources list places for: the map places both
 * list (with the method a source names, if any), and the map places either lists. Writes
 * scripts/hunt/evidence/agreed.json. The build uses it two ways (scripts/hunt/build-lib.ts):
 *  - a place both sources list that the encounter data doesn't have is added ("Wild" unless a
 *    source names the method), so a correct pin there scores;
 *  - a place of ours that neither source lists for that game is dropped, as unconfirmed.
 * Only games where both sources have a list count, so a page that wasn't fetched changes nothing.
 */
import fs from "node:fs";
import path from "node:path";
import pokedex from "../../src/data/pokedex.json";
import aboutForms from "../../src/data/about-forms.json";
import { regionalForms, type EvidenceEntry } from "./forms";
import { bulbapediaSets, serebiiSets, type SerebiiDetail } from "./verify-sample";

export interface AgreedGame {
  /** Map places ("Region|Name") both sources list, each with a method label when one names it. */
  both: [string, string | null][];
  /** Map places either source lists. */
  any: string[];
}
export type Agreed = Record<string, Record<string, Record<string, AgreedGame>>>;

if (process.argv[1]?.endsWith("make-agreed.ts")) {
  const args = process.argv.slice(2);
  const di = args.indexOf("--detail");
  const detail: SerebiiDetail = di >= 0 ? JSON.parse(fs.readFileSync(args.splice(di, 2)[1], "utf8")) : {};
  const [bulbaFile, ...serebiiFiles] = args;
  const bulba = JSON.parse(fs.readFileSync(bulbaFile, "utf8")) as Record<string, EvidenceEntry[]>;
  const serebii: Parameters<typeof serebiiSets>[1] = {};
  for (const f of serebiiFiles) Object.assign(serebii, JSON.parse(fs.readFileSync(f, "utf8")));
  const fetched = new Set(Object.keys(serebii).map((k) => k.split("/")[1]));
  const formsBy = regionalForms(aboutForms as unknown as [number, number, string, string, string][]);
  const out: Agreed = {};
  let games = 0;
  for (const mon of pokedex as { id: number }[]) {
    if (!fetched.has(String(mon.id))) continue;
    for (const form of [null, ...(formsBy.get(mon.id) ?? []).map((f) => f.key)]) {
      const who = { dex: mon.id, form };
      const b = bulbapediaSets(who, bulba);
      const s = serebiiSets(who, serebii, detail);
      for (const [v, bset] of b.sets) {
        const sset = s.sets.get(v);
        if (!sset?.size || !bset.size) continue;
        const both = [...bset].filter((k) => sset.has(k)).sort().map((k): [string, string | null] => [k, b.hints.get(`${v}|${k}`) ?? s.hints.get(`${v}|${k}`) ?? null]);
        ((out[String(mon.id)] ??= {})[form ?? ""] ??= {})[v] = { both, any: [...new Set([...bset, ...sset])].sort() };
        games++;
      }
    }
  }
  const file = path.join(process.cwd(), "scripts/hunt/evidence/agreed.json");
  fs.writeFileSync(file, JSON.stringify({ note: "Places Bulbapedia and Serebii both list, and either lists, per species, form and game (scripts/hunt/make-agreed.ts)", agreed: out }) + "\n");
  console.log(`${Object.keys(out).length} species, ${games} games with both sources`);
}
