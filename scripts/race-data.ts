/**
 * Builds the form data behind /pokedex/race:
 *
 * - src/data/race-forms.json: the base stats, height, weight, types and
 *   abilities of every alternate form that has its own stats on PokéAPI
 *   (Megas, regional forms, Deoxys and Therian formes, Primal and Crowned
 *   forms…), read from PokéAPI's /pokemon/{id}. Default forms come from
 *   src/data/pokedex.json and are not repeated here.
 *
 *   Left out, with the reason recorded under `excluded`: Gigantamax forms
 *   (same base stats as the regular form, and their Pokédex size is only a
 *   minimum), Totem forms (boosted battle versions, not a separate
 *   Pokémon), forms PokéAPI lists without a weight, and colour-only forms
 *   whose stats, size and types are identical to a form already kept (the
 *   seven Minior cores).
 * - The visible box of each kept form's HOME render, for forms that
 *   src/data/sizes-art.json doesn't already cover (same method as
 *   scripts/sizes-data.ts: the bounding box of the opaque pixels).
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/race-data.ts
 *
 * Responses are cached on disk (SIZES_CACHE, shared with the Sizes scripts).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import FORMS from "../src/data/about-forms.json";
import ART from "../src/data/sizes-art.json";

const CACHE = process.env.SIZES_CACHE ?? join(tmpdir(), "pokeiq-sizes");
mkdirSync(CACHE, { recursive: true });
const UA = "PokeIQ-race-data/1.0 (https://pokeiq.vercel.app)";
const HOME = (id: number) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/${id}.png`;

type FormRow = [number, number, string, string, string];

async function cached(key: string, url: string): Promise<Buffer | null> {
  const file = join(CACHE, key);
  if (existsSync(file)) {
    const b = readFileSync(file);
    return b.length ? b : null;
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) });
      if (res.status === 404) {
        writeFileSync(file, "");
        return null;
      }
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(file, buf);
      return buf;
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  return null;
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

interface ApiPokemon {
  name: string;
  height: number;
  weight: number;
  types: { slot: number; type: { name: string } }[];
  stats: { base_stat: number; stat: { name: string } }[];
  abilities: { ability: { name: string }; is_hidden: boolean; slot: number }[];
}

const STAT_ORDER = ["hp", "attack", "defense", "special-attack", "special-defense", "speed"];

interface Row {
  id: number;
  species: number;
  slug: string;
  name: string;
  kind: string;
  height: number;
  weight: number;
  types: string[];
  /** hp, atk, def, spa, spd, spe */
  stats: number[];
  abilities: string[];
  /** HOME render box [x, y, w, h, size] when sizes-art.json has none. */
  box?: number[];
}

async function main() {
  const all = FORMS as FormRow[];
  const excluded: { slug: string; reason: string }[] = [];
  const candidates = all.filter(([, , slug, , kind]) => {
    if (kind === "gmax") { excluded.push({ slug, reason: "Gigantamax: same base stats as the regular form" }); return false; }
    if (slug.includes("totem")) { excluded.push({ slug, reason: "Totem: a boosted battle version, not a separate Pokémon" }); return false; }
    return true;
  });
  const rows: Row[] = [];
  await pool(candidates, 6, async ([id, species, slug, name, kind]) => {
    const buf = await cached(`pokemon-${id}.json`, `https://pokeapi.co/api/v2/pokemon/${id}`);
    if (!buf) throw new Error(`PokéAPI has no /pokemon/${id} (${slug})`);
    const d = JSON.parse(buf.toString("utf8")) as ApiPokemon;
    if (d.name !== slug) throw new Error(`PokéAPI /pokemon/${id} is ${d.name}, expected ${slug}`);
    const stats = STAT_ORDER.map((s) => d.stats.find((x) => x.stat.name === s)?.base_stat ?? -1);
    if (stats.some((s) => s < 1)) { excluded.push({ slug, reason: "PokéAPI lists no complete base stats" }); return; }
    if (!(d.weight > 0) || !(d.height > 0)) { excluded.push({ slug, reason: "PokéAPI lists no weight or height" }); return; }
    rows.push({
      id,
      species,
      slug,
      name,
      kind: kind === "other" ? "form" : kind,
      height: d.height,
      weight: d.weight,
      types: [...d.types].sort((a, b) => a.slot - b.slot).map((t) => t.type.name),
      stats,
      abilities: [...d.abilities].sort((a, b) => a.slot - b.slot).map((a) => a.ability.name),
    });
  });
  rows.sort((a, b) => a.id - b.id);
  // Colour-only duplicates (same species, stats, size and types as a form already kept).
  const seen = new Map<string, string>();
  const kept: Row[] = [];
  for (const r of rows) {
    const sig = `${r.species}|${r.stats.join(",")}|${r.height}|${r.weight}|${r.types.join("/")}`;
    const first = seen.get(sig);
    if (first) { excluded.push({ slug: r.slug, reason: `same stats, size and types as ${first}` }); continue; }
    seen.set(sig, r.slug);
    kept.push(r);
  }

  // HOME render boxes for forms the Sizes data doesn't cover.
  const boxes = ART as unknown as Record<string, number[]>;
  let missing = 0;
  await pool(kept.filter((r) => !boxes[String(r.id)]), 8, async (r) => {
    const buf = await cached(`home-${r.id}.png`, HOME(r.id));
    if (!buf) { missing++; return; }
    const { data, info } = await sharp(buf).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
    let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if (data[y * info.width + x] > 24) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) { missing++; return; }
    r.box = [x0, y0, x1 - x0 + 1, y1 - y0 + 1, info.width];
  });
  const withArt = kept.filter((r) => boxes[String(r.id)] || r.box);
  for (const r of kept) if (!boxes[String(r.id)] && !r.box) excluded.push({ slug: r.slug, reason: "no HOME render" });
  excluded.sort((a, b) => a.slug.localeCompare(b.slug));

  writeFileSync(
    "src/data/race-forms.json",
    JSON.stringify({
      source: "PokéAPI /pokemon/{id}: base stats (hp, atk, def, spa, spd, spe), height (dm), weight (hg), types and abilities; box = the HOME render's visible box [x, y, w, h, size] where src/data/sizes-art.json has none",
      excluded,
      forms: withArt,
    }).replace(/\},\{/g, "},\n{") + "\n"
  );
  console.log(`race forms: ${withArt.length} kept, ${excluded.length} excluded, ${missing} without art`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
