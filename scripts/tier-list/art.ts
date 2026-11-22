/**
 * Which pictures the Tier List Maker can show for each species and form: PokéAPI's sprite repository (the host the
 * rest of the site uses) has a Pokémon HOME render and a pixel sprite, normal and shiny, for most of them. Battle forms
 * map to PokéAPI ids (src/data/battle-sprites.json); cosmetic forms (Unown's letters, Vivillon's patterns) are looked
 * up on PokéAPI by name. Every file is HEAD-checked, so the maker never asks for one that 404s.
 *
 *   npx tsx --conditions=react-server scripts/tier-list/art.ts    (one-off; re-run when new forms land)
 *
 * Output: src/data/tier-list-art.json — { mons: { [showdownId]: [artKey, bits] }, local: artKey[] } (bits: lib/tier-list/types ART).
 */
import fs from "node:fs";
import path from "node:path";
import POKEDEX from "../../src/data/pokedex.json";
import { rosterSources } from "../../src/lib/tier-list/roster.server";
import { ART } from "../../src/lib/tier-list/types";

const OUT = path.join(process.cwd(), "src/data/tier-list-art.json");
const SPRITES = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";
const SLUG = new Map((POKEDEX as { id: number; slug: string }[]).map((p) => [p.id, p.slug]));

async function get(url: string, method: "HEAD" | "GET"): Promise<Response | null> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { method }).catch(() => null);
    if (res && (res.ok || res.status === 404)) return res.ok ? res : null;
    if (attempt >= 4) throw new Error(`${url}: ${res?.status ?? "network error"}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

const slugify = (s: string) => s.toLowerCase().replace(/é/g, "e").replace(/['’.%]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const FORME_SLUG: Record<string, string> = { pokeball: "poke-ball" };
/** Forms the battles' map misses, by their PokéAPI pokemon name. */
const POKEMON_ALIAS: Record<string, string> = {
  toxtricitygmax: "toxtricity-amped-gmax",
  urshifugmax: "urshifu-single-strike-gmax",
  zygardemega: "zygarde-mega",
  meowsticmmega: "meowstic-male-mega",
  rockruffdusk: "rockruff-own-tempo",
};

async function aliasKey(id: string): Promise<string | null> {
  const res = POKEMON_ALIAS[id] ? await get(`https://pokeapi.co/api/v2/pokemon/${POKEMON_ALIAS[id]}/`, "GET") : null;
  return res ? String(((await res.json()) as { id: number }).id) : null;
}

/** A cosmetic form's file name on PokéAPI ("201-b"), from its pokemon-form record. */
async function cosmeticKey(num: number, forme: string): Promise<string | null> {
  const f = slugify(forme);
  for (const name of [`${SLUG.get(num)}-${FORME_SLUG[f] ?? f}`]) {
    const res = await get(`https://pokeapi.co/api/v2/pokemon-form/${name}/`, "GET");
    if (!res) continue;
    const json = (await res.json()) as { sprites?: { front_default?: string | null } };
    const m = /\/([^/]+)\.png$/.exec(json.sprites?.front_default ?? "");
    if (m) return m[1];
  }
  return null;
}

async function bits(key: string): Promise<number> {
  const urls: [number, string][] = [
    [ART.home, `${SPRITES}/other/home/${key}.png`],
    [ART.homeShiny, `${SPRITES}/other/home/shiny/${key}.png`],
    [ART.pixel, `${SPRITES}/${key}.png`],
    [ART.pixelShiny, `${SPRITES}/shiny/${key}.png`],
  ];
  let m = 0;
  for (const [bit, url] of urls) if (await get(url, "HEAD")) m |= bit;
  return m;
}

async function main() {
  const sources = rosterSources();
  const keys = await inBatches(sources, 16, async (s) => (s.f ? (s.pokeapi ? String(s.pokeapi) : (await aliasKey(s.k)) ?? (await cosmeticKey(s.d, s.forme!))) : String(s.d)));
  const todo = sources.map((s, i) => [s, keys[i]] as const).filter(([, k]) => k);
  const found = await inBatches(todo, 16, async ([s, k]) => [s.k, [k!, await bits(k!)]] as const);
  const mons = Object.fromEntries(found.filter(([, [, m]]) => m));
  const local = fs.readdirSync(path.join(process.cwd(), "public/sizes/art/256")).map((f) => f.replace(/\.webp$/, "")).sort((a, b) => Number(a) - Number(b));
  fs.writeFileSync(OUT, JSON.stringify({ mons, local }) + "\n");
  const missing = sources.filter((s) => !mons[s.k]).map((s) => s.n);
  console.log(`✓ ${Object.keys(mons).length}/${sources.length} with pictures; ${local.length} local renders`);
  if (missing.length) console.log(`  no pictures: ${missing.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
