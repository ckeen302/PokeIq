/**
 * Captures real TCGCSV / TCGdex data for offline use:
 *
 * - tests/fixtures/tcg-price-match.json — the mapping test's cards (from
 *   pokemon-tcg-data) and, per TCGplayer group, every product sharing a
 *   collector number with one of them (matching only ever compares those).
 * - src/lib/tcg/price-fixture.json — what POKEIQ_TCG_FIXTURE=1 serves instead of
 *   tcgcsv.com / api.tcgdex.net: the groups of the sets in fixture.json, the
 *   group list, and a few TCGdex cards.
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/build-tcg-price-fixtures.ts
 *
 * Uses the download cache of build-tcg-price-sets.ts (TCG_CACHE, default
 * .tcg-cache/); prices and TCGdex cards are always fetched fresh, politely.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normNumber } from "../src/lib/tcg/price-match";

const UA = "PokeIQ/1.0 (+https://github.com/ckeen302/PokeIq)";
const RAW = "https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master";
const ROOT = path.resolve(import.meta.dirname, "..");
const CACHE = process.env.TCG_CACHE ?? path.join(ROOT, ".tcg-cache");

/** The mapping test's cards: every era, plus the tricky numbering and naming cases. Expectations live in the test. */
export const MATCH_CASES = [
  "base1-4", "base1-58", "base1-8", "base2-1", "base5-75", "basep-4", "gym1-2", "neo1-9", "neo2-14", "ecard2-H1", "ecard2-50",
  "ex13-1", "ex10-S", "pop1-17", "tk2a-9", "tk1a-8", "dp1-65", "dp1-121", "dpp-DP01", "pl1-1", "hgss1-111", "hgss1-112", "col1-1",
  "bw11-RC1", "bwp-BW40", "bw3-92", "xy1-141", "xy2-13", "xy2-88a", "xy4-92", "xy7-96", "g1-RC25", "sm5-58", "sm8-174", "sma-SV49",
  "smp-SM10", "sm115-1", "swsh1-178", "swsh9tg-TG01", "swsh12pt5gg-GG01", "swsh45sv-SV001", "cel25-1", "cel25c-4_A", "cel25c-15_A1",
  "swshp-SWSH001", "sv1-189", "sv2-172", "sv3-60", "sv3pt5-6", "sv3pt5-199", "svp-1", "sv8pt5-1", "sve-1", "me1-1", "me2pt5-3",
  "me55-150", "me55c-58",
];
/** Groups of the sets in fixture.json (base1, sv1, me55, me55c). */
const FIXTURE_GROUPS = [604, 22873, 24722, 24837];
/** TCGdex cards for fixture mode (TCGdex set id / number). */
const FIXTURE_TCGDEX = ["base1/4", "base1/8", "30th/150", "30th/54", "30th-c/58", "sv01/1"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function get(url: string): Promise<Response> {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    await sleep(150);
    if (res.ok || res.status === 404) return res;
  }
  throw new Error(`fetch ${url} failed`);
}
async function cachedJson<T>(file: string, url: string): Promise<T> {
  const f = path.join(CACHE, file);
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8")) as T;
  const text = await (await get(url)).text();
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, text);
  return JSON.parse(text) as T;
}

interface RawProduct {
  productId: number;
  name: string;
  extendedData?: { name: string; value: string }[];
}
const ext = (p: RawProduct, k: string) => p.extendedData?.find((e) => e.name === k)?.value;
/** TCGCSV's shape, cut down to the fields we read. Sealed product (no Number) is dropped. */
const trimProducts = (list: RawProduct[]) =>
  list
    .filter((p) => ext(p, "Number"))
    .map((p) => ({ productId: p.productId, name: p.name, extendedData: ["Number", "Rarity"].flatMap((k) => (ext(p, k) ? [{ name: k, value: ext(p, k)! }] : [])) }));

async function main() {
  const table = JSON.parse(readFileSync(path.join(ROOT, "src/lib/tcg/price-sets.json"), "utf8")).sets as Record<string, { tcgplayer: number[]; promo?: true }>;

  // 1. Mapping-test fixture.
  const cards: { id: string; name: string; number: string }[] = [];
  const wanted = new Map<number, Set<string>>();
  for (const id of MATCH_CASES) {
    const setId = id.slice(0, id.lastIndexOf("-"));
    const setCards = await cachedJson<{ id: string; name: string; number: string }[]>(`ptcg/${setId}.json`, `${RAW}/cards/en/${setId}.json`);
    const c = setCards.find((x) => x.id === id);
    if (!c) throw new Error(`${id} not in pokemon-tcg-data`);
    cards.push({ id: c.id, name: c.name, number: c.number });
    for (const g of table[setId].tcgplayer) (wanted.get(g) ?? wanted.set(g, new Set()).get(g)!).add(normNumber(c.number));
  }
  const products: Record<string, ReturnType<typeof trimProducts>> = {};
  for (const [g, numbers] of wanted) {
    const raw = await cachedJson<{ results: RawProduct[] }>(`tcgcsv/${g}.products.json`, `https://tcgcsv.com/tcgplayer/3/${g}/products`);
    products[g] = trimProducts(raw.results).filter((p) => numbers.has(normNumber(ext(p as RawProduct, "Number"))));
  }
  const sets = Object.fromEntries([...new Set(cards.map((c) => c.id.slice(0, c.id.lastIndexOf("-"))))].sort().map((s) => [s, table[s]]));
  writeFileSync(
    path.join(ROOT, "tests/fixtures/tcg-price-match.json"),
    `${JSON.stringify({ note: "Real TCGCSV products (trimmed to the test cards' collector numbers) and pokemon-tcg-data cards. Built by scripts/build-tcg-price-fixtures.ts.", sets, cards, products })}\n`
  );

  // 2. Fixture-mode data.
  const groups: Record<string, unknown> = {};
  for (const g of FIXTURE_GROUPS) {
    const raw = await cachedJson<{ results: RawProduct[] }>(`tcgcsv/${g}.products.json`, `https://tcgcsv.com/tcgplayer/3/${g}/products`);
    const kept = trimProducts(raw.results);
    const ids = new Set(kept.map((p) => p.productId));
    const res = await get(`https://tcgcsv.com/tcgplayer/3/${g}/prices`);
    const prices = ((await res.json()) as { results: { productId: number }[] }).results.filter((p) => ids.has(p.productId));
    const lm = res.headers.get("last-modified");
    const updatedAt = lm ? new Date(lm).toISOString().slice(0, 10).replace(/-/g, "/") : null;
    groups[g] = { updatedAt, products: { results: kept }, prices: { results: prices } };
  }
  const groupList = (await cachedJson<{ results: { groupId: number; name: string; abbreviation: string; publishedOn: string }[] }>("tcgcsv/groups.json", "https://tcgcsv.com/tcgplayer/3/groups")).results.map(
    ({ groupId, name, abbreviation, publishedOn }) => ({ groupId, name, abbreviation, publishedOn })
  );
  const tcgdex: Record<string, unknown> = {};
  for (const key of FIXTURE_TCGDEX) {
    const res = await get(`https://api.tcgdex.net/v2/en/sets/${key}`);
    if (!res.ok) continue;
    const c = (await res.json()) as Record<string, unknown>;
    tcgdex[key] = { id: c.id, localId: c.localId, name: c.name, variants: c.variants, pricing: c.pricing };
  }
  writeFileSync(
    path.join(ROOT, "src/lib/tcg/price-fixture.json"),
    `${JSON.stringify({ note: `Real TCGCSV and TCGdex responses, captured ${new Date().toISOString().slice(0, 10)} and trimmed; served under POKEIQ_TCG_FIXTURE=1. Built by scripts/build-tcg-price-fixtures.ts.`, groups, groupList, tcgdex })}\n`
  );
  console.log(`${cards.length} test cards over ${wanted.size} groups; fixture mode: ${FIXTURE_GROUPS.length} groups, ${Object.keys(tcgdex).length} TCGdex cards`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
