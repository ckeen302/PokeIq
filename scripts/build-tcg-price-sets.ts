/**
 * Builds src/lib/tcg/price-sets.json: for every Pokémon TCG API set, the
 * TCGplayer group(s) on TCGCSV that hold its cards and the TCGdex set id.
 * Automatic matching (same name, else same code within a month) plus the
 * hand-checked OVERRIDES below for promos, subsets, Trainer Galleries, Shiny
 * Vaults, "151", Classic Collections and friends.
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/build-tcg-price-sets.ts            # write the table
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/build-tcg-price-sets.ts --report   # + card match rate by era
 *
 * --report downloads every mapped group's products (and each set's cards from
 * pokemon-tcg-data) into TCG_CACHE (default .tcg-cache/, git-ignored), politely:
 * one request at a time, 150 ms apart, with an identifying User-Agent.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { guessGroup, matchCard, normName, normSetName, type TcgcsvGroup, type TcgcsvProduct } from "../src/lib/tcg/price-match";
import { parseTcgcsvProducts } from "../src/lib/tcg/tcgcsv-parse";

const UA = "PokeIQ/1.0 (+https://github.com/ckeen302/PokeIq)";
const RAW = "https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master";
const ROOT = path.resolve(import.meta.dirname, "..");
const CACHE = process.env.TCG_CACHE ?? path.join(ROOT, ".tcg-cache");
const OUT = path.join(ROOT, "src/lib/tcg/price-sets.json");

/**
 * Hand-checked set → TCGplayer group ids. An entry replaces the automatic guess.
 * Several groups when TCGplayer splits a set (Radiant Collections) and one group
 * for two sets when it merges them (EX Trainer Kits).
 */
const OVERRIDES: Record<string, number[]> = {
  base1: [604], // "Base Set" (unlimited) — Shadowless is its own group, not this set
  base4: [605], // Base Set 2 (code BS2 on TCGplayer, B2 here)
  basep: [1418], // WoTC Promo
  si1: [648], // Southern Islands
  bp: [1455], // Best of Promos
  ecard1: [1375], // Expedition
  np: [1423], // Nintendo Promos
  tk1a: [1543], // EX Trainer Kit 1: Latias & Latios (both halves in one group)
  tk1b: [1543],
  tk2a: [1542], // EX Trainer Kit 2: Plusle & Minun
  tk2b: [1542],
  dpp: [1421], // Diamond and Pearl Promos
  dp1: [1430],
  ru1: [1433], // Rumble
  hsp: [1453], // HGSS Promos
  hgss1: [1402],
  bwp: [1407], // Black and White Promos
  bw1: [1400],
  mcd11: [1401],
  mcd12: [1427],
  mcd14: [1692],
  mcd15: [1694],
  mcd16: [3087],
  mcd17: [2148],
  mcd18: [2364],
  mcd19: [2555],
  mcd21: [2782], // McDonald's 25th Anniversary Promos
  mcd22: [3150],
  bw11: [1409, 1465], // Legendary Treasures + its Radiant Collection
  xyp: [1451], // XY Promos
  xy0: [1522], // Kalos Starter Set
  xy1: [1387], // XY Base Set
  g1: [1728, 1729], // Generations + Radiant Collection
  smp: [1861], // SM Promos
  sm1: [1863], // SM Base Set
  sm35: [2054], // Shining Legends
  sm115: [2480], // Hidden Fates
  sma: [2594], // Hidden Fates: Shiny Vault
  det1: [2409], // Detective Pikachu
  swshp: [2545], // SWSH Promo Cards
  swsh1: [2585],
  swsh35: [2685], // Champion's Path
  fut20: [2374], // Futsal promos live in "Miscellaneous Cards & Products"
  swsh45: [2754], // Shining Fates
  swsh45sv: [2781], // Shining Fates: Shiny Vault
  cel25: [2867], // Celebrations
  cel25c: [2931], // Celebrations: Classic Collection
  swsh9: [2948],
  swsh9tg: [3020], // Trainer Galleries
  swsh10tg: [3068],
  swsh11tg: [3172],
  swsh12tg: [17674],
  pgo: [3064],
  swsh12pt5: [17688], // Crown Zenith
  swsh12pt5gg: [17689], // Crown Zenith: Galarian Gallery
  svp: [22872], // SV Promo Cards
  sv1: [22873],
  sve: [24382], // Scarlet & Violet Energies
  sv3pt5: [23237], // "SV: Scarlet & Violet 151"
  sv4pt5: [23353], // Paldean Fates
  sv6pt5: [23529], // Shrouded Fable
  sv8pt5: [23821], // Prismatic Evolutions
  zsv10pt5: [24325], // Black Bolt
  rsv10pt5: [24326], // White Flare
  me1: [24380],
  me2pt5: [24541], // Ascended Heroes
  me55: [24722], // 30th Celebration
  me55c: [24837], // 30th Celebration Classic Collection
};

/** Hand-checked Pokémon TCG API set id → TCGdex set id where names differ. */
/** Black Star Promo sets: a prerelease-stamped product is the card itself there (see matchCard). */
const PROMO_SETS = new Set(["basep", "np", "dpp", "hsp", "bwp", "xyp", "smp", "swshp", "svp", "mep"]);

const TCGDEX_OVERRIDES: Record<string, string | null> = {
  tk1a: "tk-ex-latia",
  tk1b: "tk-ex-latio",
  tk2a: "tk-ex-p",
  tk2b: "tk-ex-m",
  svp: "svp",
  sve: "sve",
};

interface ApiSet {
  id: string;
  name: string;
  series: string;
  ptcgoCode?: string;
  releaseDate?: string;
  total?: number;
}
interface DexSet {
  id: string;
  name: string;
  releaseDate?: string;
  tcgOnline?: string | null;
  cardCount?: { official?: number; total?: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function cachedJson<T>(file: string, url: string, init?: RequestInit): Promise<T | null> {
  const f = path.join(CACHE, file);
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8")) as T;
  mkdirSync(path.dirname(f), { recursive: true });
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, { ...init, headers: { "User-Agent": UA, ...(init?.headers ?? {}) } });
    await sleep(150);
    if (res.status === 404) return null;
    if (res.ok) {
      const text = await res.text();
      writeFileSync(f, text);
      return JSON.parse(text) as T;
    }
  }
  throw new Error(`fetch ${url} failed`);
}

const day = (s?: string | null) => {
  const m = s?.match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86_400_000 : NaN;
};

/** Looser than the app's guessGroup (this table is reviewed by hand): the same name at any date, nearest first. TCGplayer re-dated some old groups (POP Series). */
function nearestByName(set: ApiSet, groups: TcgcsvGroup[]): number | null {
  const want = normSetName(set.name);
  const d = day(set.releaseDate);
  const named = groups.filter((g) => normSetName(g.name) === want).sort((a, b) => Math.abs(day(a.publishedOn) - d) - Math.abs(day(b.publishedOn) - d));
  return named[0]?.groupId ?? null;
}

function guessDex(set: ApiSet, dexSets: DexSet[]): string | null {
  if (set.id in TCGDEX_OVERRIDES) return TCGDEX_OVERRIDES[set.id];
  const d = day(set.releaseDate);
  const want = normSetName(set.name);
  const near = (x: DexSet) => Math.abs(day(x.releaseDate) - d);
  const named = dexSets.filter((x) => normSetName(x.name) === want && near(x) <= 120);
  if (named.length === 1) return named[0].id;
  // Same total card count and release day ("Hidden Fates Shiny Vault" ≈ "Shiny Vault").
  const counted = dexSets.filter((x) => near(x) <= 3 && (x.cardCount?.total === set.total || x.cardCount?.official === set.total));
  if (counted.length === 1) return counted[0].id;
  const coded = dexSets.filter((x) => set.ptcgoCode && x.tcgOnline === set.ptcgoCode && near(x) <= 3);
  if (coded.length === 1) return coded[0].id;
  return named.sort((a, b) => near(a) - near(b))[0]?.id ?? null;
}

async function main() {
  const apiSets = (await cachedJson<ApiSet[]>("ptcg-sets.json", `${RAW}/sets/en.json`)) ?? [];
  // Sets the live API has that the static dataset hasn't caught up with yet (from the captured fixture).
  const fixture = JSON.parse(readFileSync(path.join(ROOT, "src/lib/tcg/fixture.json"), "utf8")) as { sets: ApiSet[] };
  for (const s of fixture.sets) if (!apiSets.some((a) => a.id === s.id)) apiSets.push(s);
  const groups = (await cachedJson<{ results: TcgcsvGroup[] }>("tcgcsv/groups.json", "https://tcgcsv.com/tcgplayer/3/groups"))!.results;
  const dexSets = (await cachedJson<{ data: { sets: DexSet[] } }>("tcgdex-sets.json", "https://api.tcgdex.net/v2/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "{ sets { id name releaseDate tcgOnline cardCount { official total } } }" }),
  }))!.data.sets;

  const groupById = new Map(groups.map((g) => [g.groupId, g]));
  const table: Record<string, { tcgplayer: number[]; tcgdex: string | null; promo?: true }> = {};
  const rows: string[] = [];
  for (const set of [...apiSets].sort((a, b) => (a.releaseDate ?? "").localeCompare(b.releaseDate ?? ""))) {
    const auto = guessGroup(set, groups) ?? nearestByName(set, groups);
    const ids = OVERRIDES[set.id] ?? (auto ? [auto] : []);
    for (const id of ids) if (!groupById.has(id)) throw new Error(`${set.id}: group ${id} doesn't exist on TCGCSV`);
    const dex = guessDex(set, dexSets);
    table[set.id] = { tcgplayer: ids, tcgdex: dex, ...(PROMO_SETS.has(set.id) && { promo: true as const }) };
    rows.push(
      `${set.id.padEnd(12)} ${set.name.padEnd(36)} → ${ids.map((i) => `${i} ${groupById.get(i)!.name}`).join(" + ") || "—"}${OVERRIDES[set.id] ? " (override)" : ""} | tcgdex ${dex ?? "—"}`
    );
  }
  const sorted = Object.fromEntries(Object.entries(table).sort(([a], [b]) => a.localeCompare(b)));
  const note = "Pokémon TCG API set id → TCGplayer group ids on tcgcsv.com, TCGdex set id, and whether it is a Black Star Promo set. Built by scripts/build-tcg-price-sets.ts.";
  const lines = Object.entries(sorted).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  writeFileSync(OUT, `{\n"note": ${JSON.stringify(note)},\n"sets": {\n${lines.join(",\n")}\n}\n}\n`);
  console.log(rows.join("\n"));
  console.log(`\n${Object.keys(table).length} sets, ${Object.values(table).filter((t) => t.tcgplayer.length).length} with a TCGplayer group, ${Object.values(table).filter((t) => t.tcgdex).length} with a TCGdex set`);

  if (process.argv.includes("--report")) {
    interface ApiCard {
      id: string;
      name: string;
      number: string;
    }
    const bySeries = new Map<string, { cards: number; matched: number }>();
    const misses = new Map<string, number>();
    const missLines: string[] = [];
    for (const set of apiSets) {
      const cards = (await cachedJson<ApiCard[]>(`ptcg/${set.id}.json`, `${RAW}/cards/en/${set.id}.json`)) ?? [];
      const products: TcgcsvProduct[] = [];
      for (const g of table[set.id].tcgplayer) {
        const raw = await cachedJson<unknown>(`tcgcsv/${g}.products.json`, `https://tcgcsv.com/tcgplayer/3/${g}/products`);
        products.push(...parseTcgcsvProducts(raw));
      }
      const era = set.series || "Other";
      const tally = bySeries.get(era) ?? { cards: 0, matched: 0 };
      for (const c of cards) {
        tally.cards++;
        const r = matchCard(c, products, { promoSet: PROMO_SETS.has(set.id) });
        if (r.productId !== null) tally.matched++;
        else {
          misses.set(r.why, (misses.get(r.why) ?? 0) + 1);
          const near = products.filter((p) => p.number && normName(p.name).includes(normName(c.name).split(" ")[0])).slice(0, 3);
          missLines.push(`${c.id} "${c.name}" #${c.number}: ${r.why}${near.length ? ` (near: ${near.map((p) => `${p.productId} "${p.name}" ${p.number}`).join("; ")})` : ""}`);
        }
      }
      bySeries.set(era, tally);
    }
    const all = [...bySeries.values()].reduce((a, b) => ({ cards: a.cards + b.cards, matched: a.matched + b.matched }), { cards: 0, matched: 0 });
    const pct = (t: { cards: number; matched: number }) => `${((100 * t.matched) / Math.max(1, t.cards)).toFixed(1)}%`;
    writeFileSync(path.join(CACHE, "misses.txt"), missLines.join("\n"));
    console.log("\nCard match rate by era:");
    for (const [era, t] of [...bySeries.entries()].sort()) console.log(`  ${era.padEnd(24)} ${String(t.matched).padStart(5)} / ${String(t.cards).padStart(5)}  ${pct(t)}`);
    console.log(`  ${"All".padEnd(24)} ${String(all.matched).padStart(5)} / ${String(all.cards).padStart(5)}  ${pct(all)}`);
    console.log("Unmatched by reason:", Object.fromEntries(misses), `(details in ${path.join(CACHE, "misses.txt")})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
