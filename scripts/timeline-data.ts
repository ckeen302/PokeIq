/**
 * Normalises src/data/pokemon-timeline.json in place: fills each entry's
 * starter and box-legendary species ids from the repo's own tables (see
 * src/lib/timeline/derive.ts), sets the generation era of non-game entries
 * from the generation openers, sets `source` to the first of `sources`, and
 * keeps the file in chronological order.
 *
 *   npx tsx scripts/timeline-data.ts
 *
 * Dates and sources are edited by hand in the JSON; every date must be
 * confirmed by both URLs in `sources` (a month-only "YYYY-MM" where the two
 * agree only on the month).
 */
import fs from "fs";
import path from "path";
import { compareEntries, deriveSpecies, generationAt, type BoxRow, type DexRow, type StarterRow } from "../src/lib/timeline/derive";
import { firstDate, yearFrac, type TimelineRaw } from "../src/lib/timeline/types";

const root = path.resolve(__dirname, "..");
const read = <T,>(p: string) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8")) as T;
const FILE = "src/data/pokemon-timeline.json";

const dex = read<DexRow[]>("src/data/pokedex.json");
const starters = read<StarterRow[]>("src/data/quiz/games/starters.json");
const box = read<BoxRow[]>("src/data/quiz/games/box-art.json");
const entries = read<TimelineRaw[]>(FILE);

const openers = entries.filter((e) => e.lane === "games" && e.kind === "opener").map((e) => ({ generation: e.generation, t: yearFrac(firstDate(e)) }));
const KEYS: (keyof TimelineRaw)[] = ["id", "lane", "title", "platform", "date_jp", "date_na", "date_eu", "worldwide", "generation", "region", "kind", "note", "series", "season", "film", "set", "featured", "basis", "starters", "legendaries", "source", "sources"];

const out = entries
  .map((e) => {
    const { starters: s, legendaries: l } = deriveSpecies(e, dex, starters, box);
    const next: TimelineRaw = { ...e, source: e.sources[0], starters: s, legendaries: l };
    if (e.lane !== "games") next.generation = generationAt(yearFrac(firstDate(e)), openers);
    // Stable key order, no empty fields.
    return Object.fromEntries(KEYS.filter((k) => next[k] !== undefined).map((k) => [k, next[k]])) as unknown as TimelineRaw;
  })
  .sort(compareEntries);

fs.writeFileSync(path.join(root, FILE), "[\n" + out.map((e) => "  " + JSON.stringify(e)).join(",\n") + "\n]\n");
console.log(`${out.length} entries written to ${FILE}`);
