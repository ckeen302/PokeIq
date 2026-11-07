/**
 * Builds src/data/games-records.json: every event of the PokéIQ Games
 * pre-run for every athlete (the 1,025 Pokémon and every form with its own
 * stats) at neutral form (lib/games/records), plus each type nation's three
 * best all-rounders. The records pages (/lab/games/records/<event>) and
 * each Pokémon's Games page read it; tests/games-records.test.ts fails if it
 * drifts from the model, so run this after changing a constant:
 *
 *   npx tsx --conditions=react-server scripts/games-records.ts [--log=<file>]
 *
 * It also prints the sanity table (the results the design asks to check by
 * eye) and a plausibility review of every event: the top and bottom marks,
 * and any mark outside the bounds below, with every outlier listed.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { GAMES_ATHLETES, GAMES_BY_KEY } from "../src/lib/games/data";
import { formatMark } from "../src/lib/games/events";
import { buildRecords, indexRecords, RECORD_EVENTS, type RecordEvent } from "../src/lib/games/records";

const t0 = Date.now();
const file = buildRecords(GAMES_ATHLETES);
writeFileSync(join(process.cwd(), "src/data/games-records.json"), JSON.stringify(file));
const lines: string[] = [];
const say = (s = "") => { lines.push(s); console.log(s); };
say(`games-records: ${file.rows.length} athletes × ${file.events.length} events in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const all = indexRecords(file);
const species = indexRecords(file, (k) => GAMES_BY_KEY.get(k)?.entrant.kind === "pokemon");
const name = (k: string) => GAMES_BY_KEY.get(k)?.name ?? k;
const fmt = (e: RecordEvent, v: number | null) => (e === "wrestling" ? (v == null ? "—" : `${Math.round(v).toLocaleString("en-US")} N`) : formatMark(e, v));

say("\nSanity table");
const top = (ix: typeof all, e: RecordEvent, n = 3) => ix.ranking(e).slice(0, n).map((k, i) => `${i + 1}. ${name(k)} ${fmt(e, ix.mark(k, e))}`).join(", ");
say(`- 100 m (Pokémon): ${top(species, "100m")}  [expect Regieleki first]`);
say(`- 100 m (with forms): ${top(all, "100m")}`);
say(`- Weightlifting (Pokémon): ${top(species, "weightlifting")}  [expect a heavy, strong Pokémon: Groudon or Copperajah]`);
say(`- Weightlifting (with forms): ${top(all, "weightlifting")}`);
{
  const p4p = species.ranking("weightlifting").map((k) => ({ k, v: (species.mark(k, "weightlifting") ?? 0) / Math.max(0.01, GAMES_BY_KEY.get(k)!.kg) })).sort((a, b) => b.v - a.v).slice(0, 3);
  say(`- Pound for pound (Pokémon): ${p4p.map((x, i) => `${i + 1}. ${name(x.k)} ${x.v.toFixed(1)}× its weight (${GAMES_BY_KEY.get(x.k)!.kg} kg)`).join(", ")}  [expect a strong lightweight]`);
}
say(`- 50 m freestyle: ${top(species, "50m-freestyle")}  [expect a Water/fish Pokémon]`);
say(`- 100 m freestyle: ${top(species, "100m-freestyle")}`);
for (const k of ["shuckle", "blissey"]) for (const e of ["100m", "200m", "400m"] as RecordEvent[]) say(`- ${name(k)} ${e}: ${fmt(e, species.mark(k, e))}, ${species.rank(k, e)} of ${species.ranking(e).length}`);
say(`- Long jump: ${top(species, "long-jump")}`);
say(`- High jump: ${top(species, "high-jump")}`);
say(`- Shot put: ${top(species, "shot-put")}`);
say(`- Javelin: ${top(species, "javelin")}`);
say(`- Wrestling (ring strength): ${top(species, "wrestling")}`);
say(`- All-around: ${top(species, "all-around", 5)}`);
say(`- Magikarp: ${RECORD_EVENTS.map((e) => `${e} ${fmt(e, all.mark("magikarp", e))}`).join(" · ")}`);

/** Bounds no result should cross (an absurd mark is a model bug, never a record). */
const BOUNDS: Partial<Record<RecordEvent, [number, number]>> = {
  "100m": [4, 400],
  "200m": [8, 800],
  "400m": [16, 1600],
  "long-jump": [0, 30],
  "high-jump": [0, 16],
  "shot-put": [0, 100],
  javelin: [0, 115],
  weightlifting: [2, 3000],
  "50m-freestyle": [10, 600],
  "100m-freestyle": [22, 1300],
};
say("\nPlausibility review (every athlete; forms included)");
let flagged = 0;
for (const e of RECORD_EVENTS) {
  const r = all.ranking(e);
  const none = all.keys.filter((k) => all.mark(k, e) == null);
  const b = BOUNDS[e];
  const out = b ? r.filter((k) => { const v = all.mark(k, e)!; return !(v >= b[0] && v <= b[1]); }) : [];
  flagged += out.length;
  say(`${e}: best ${r.slice(0, 5).map((k) => `${name(k)} ${fmt(e, all.mark(k, e))}`).join(", ")} | worst ${r.slice(-3).map((k) => `${name(k)} ${fmt(e, all.mark(k, e))}`).join(", ")} | no mark: ${none.length}${none.length ? ` (${none.slice(0, 8).map(name).join(", ")}${none.length > 8 ? "…" : ""})` : ""}${out.length ? ` | OUTSIDE ${b}: ${out.map((k) => `${name(k)} ${fmt(e, all.mark(k, e))}`).join(", ")}` : ""}`);
}
say(`\n${flagged} marks outside the bounds.`);
say(`Nations: ${Object.entries(file.nations).map(([t, ks]) => `${t}: ${ks.map(name).join(", ")}`).join(" · ")}`);
const log = process.argv.find((a) => a.startsWith("--log="))?.slice(6);
if (log) {
  // Every athlete's every mark, for review.
  const rows = file.rows.map((r) => [name(r[0]), ...RECORD_EVENTS.map((e) => fmt(e, all.mark(r[0], e)))].join("\t"));
  writeFileSync(log, `${lines.join("\n")}\n\nname\t${RECORD_EVENTS.join("\t")}\n${rows.join("\n")}\n`);
}
if (flagged) process.exitCode = 1;
