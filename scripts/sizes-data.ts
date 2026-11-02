/**
 * Builds the data behind /pokedex/sizes:
 *
 * - src/data/sizes-forms.json: the height, weight and types of every Mega,
 *   Gigantamax, regional and Eternamax form listed in
 *   src/data/about-forms.json, read from PokéAPI's /pokemon/{id}. Gigantamax
 *   and Eternamax heights are cross-checked against Serebii's Sword & Shield
 *   Pokédex page for the species; a form whose two sources disagree is left
 *   out (listed under `excluded`) rather than guessed.
 * - src/data/sizes-art.json: the bounding box of the visible pixels of each
 *   Pokémon HOME render (PokéAPI sprites, other/home/{id}.png), so the page
 *   knows each figure's proportions before its image loads and can apply
 *   the "(Length)" rule. Only the boxes are kept, not the images.
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/sizes-data.ts
 *
 * Responses are cached on disk (SIZES_CACHE, default the OS temp dir) so a
 * re-run is fast.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import FORMS from "../src/data/about-forms.json";
import DEX from "../src/data/pokedex.json";

const CACHE = process.env.SIZES_CACHE ?? join(tmpdir(), "pokeiq-sizes");
mkdirSync(CACHE, { recursive: true });
const UA = "PokeIQ-sizes-data/1.0 (https://pokeiq.vercel.app)";
const HOME = (id: number) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/${id}.png`;

type FormRow = [number, number, string, string, string];
const KINDS = new Set(["mega", "gmax", "regional"]);
const forms = (FORMS as FormRow[]).filter(([, , slug, , kind]) => KINDS.has(kind) || slug === "eternatus-eternamax");

async function cached(key: string, url: string, binary: boolean): Promise<Buffer | null> {
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
  void binary;
  return null;
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

/** Gigantamax / Eternamax heights in metres from a Serebii SwSh page, in page order, keyed by the form's title. */
function serebiiHeights(html: string): { title: string; m: number }[] {
  const text = html.replace(/<[^>]+>/g, " | ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const out: { title: string; m: number }[] = [];
  const re = /\| ((?:Gigantamax|Eternamax) [^|]+?) \|(?:[^|]*\|){0,160}? Height \|(?:[^|]*\|){0,60}? ([\d.]+)m \|/g;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push({ title: m[1].trim(), m: Number(m[2]) });
  return out;
}

async function main() {
  // ---- forms
  const rows: { id: number; species: number; slug: string; name: string; kind: string; height: number; weight: number; types: string[]; serebii?: number }[] = [];
  await pool(forms, 6, async ([id, species, slug, name, kind]) => {
    const buf = await cached(`pokemon-${id}.json`, `https://pokeapi.co/api/v2/pokemon/${id}`, false);
    if (!buf) throw new Error(`PokéAPI has no /pokemon/${id} (${slug})`);
    const d = JSON.parse(buf.toString("utf8")) as { name: string; height: number; weight: number; types: { slot: number; type: { name: string } }[] };
    if (d.name !== slug) throw new Error(`PokéAPI /pokemon/${id} is ${d.name}, expected ${slug}`);
    rows.push({ id, species, slug, name, kind: slug === "eternatus-eternamax" ? "eternamax" : kind, height: d.height, weight: d.weight, types: [...d.types].sort((a, b) => a.slot - b.slot).map((t) => t.type.name) });
  });
  rows.sort((a, b) => a.id - b.id);

  // Serebii cross-check for Gigantamax and Eternamax.
  const bySpecies = new Map<number, typeof rows>();
  for (const r of rows) if (r.kind === "gmax" || r.kind === "eternamax") bySpecies.set(r.species, [...(bySpecies.get(r.species) ?? []), r]);
  const problems: string[] = [];
  for (const [species, list] of bySpecies) {
    const slug = (DEX as { id: number; slug: string }[]).find((p) => p.id === species)!.slug;
    const page = slug.replace(/-.*$/, "");
    const buf = await cached(`serebii-${page}.html`, `https://www.serebii.net/pokedex-swsh/${page}/`, false);
    const found = buf ? serebiiHeights(buf.toString("latin1")) : [];
    for (const r of list) {
      const want = r.height / 10;
      const hit = found.find((f) => Math.abs(f.m - want) < 0.051) ?? (found.length === 1 ? found[0] : undefined);
      if (!hit) { problems.push(`${r.slug}: PokéAPI ${want} m, Serebii ${found.map((f) => `${f.title} ${f.m} m`).join(", ") || "nothing found"}`); continue; }
      r.serebii = hit.m;
      if (Math.abs(hit.m - want) > 0.051) problems.push(`${r.slug}: PokéAPI ${want} m ≠ Serebii ${hit.m} m`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  // A form whose sources disagree is left out rather than guessed.
  const excluded = problems.map((p) => ({ slug: p.slice(0, p.indexOf(":")), reason: p.slice(p.indexOf(":") + 2) }));
  if (excluded.length) console.warn(`excluded:\n${problems.join("\n")}`);
  const kept = rows.filter((r) => !excluded.some((e) => e.slug === r.slug));
  writeFileSync(
    "src/data/sizes-forms.json",
    JSON.stringify({
      source: "PokéAPI /pokemon/{id} (height dm, weight hg, types); Gigantamax and Eternamax cross-checked against Serebii's Sword & Shield Pokédex (serebii = metres listed there)",
      excluded,
      forms: kept,
    }, null, 0).replace(/\},\{/g, "},\n{") + "\n"
  );
  console.log(`forms: ${kept.length}`);

  // ---- HOME render bounding boxes
  const ids = [...(DEX as { id: number }[]).map((p) => p.id), ...rows.map((r) => r.id)];
  const art: Record<string, number[]> = {};
  let missing = 0;
  await pool(ids, 12, async (id) => {
    const buf = await cached(`home-${id}.png`, HOME(id), true);
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
    // [left, top, width, height, image size]
    art[id] = [x0, y0, x1 - x0 + 1, y1 - y0 + 1, info.width];
  });
  const sorted = Object.fromEntries(Object.entries(art).sort((a, b) => Number(a[0]) - Number(b[0])));
  writeFileSync("src/data/sizes-art.json", JSON.stringify(sorted).replace(/\],"/g, '],\n"') + "\n");
  console.log(`art boxes: ${Object.keys(sorted).length}, missing ${missing}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
