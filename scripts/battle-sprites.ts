/**
 * Sprite ids for the Battle section: maps Showdown's species ids (what
 * @pkmn/dex and @smogon/calc use) to PokéAPI ids, whose sprite repo the site
 * already uses, and checks which sprites actually exist.
 *
 *   npm run battle:sprites    (one-off; re-run when new forms land)
 *
 * Base species share their National Dex number with PokéAPI. Forms (Rotom-Wash,
 * Ogerpon-Wellspring, Tauros-Paldea-Combat…) live at PokéAPI ids from 10001
 * up, matched here by name. Every id is then HEAD-checked against the
 * Showdown-style animated GIF and the static PNG: forms PokéAPI has no PNG
 * for fall back to their base species, and ids with no GIF are listed so the
 * client goes straight to the PNG instead of a 404.
 *
 * Output: src/data/battle-sprites.json — { forms: { [showdownId]: pokeapiId }, noGif: number[] }.
 */
import fs from "node:fs";
import path from "node:path";
import { Dex, toID } from "@pkmn/dex";

const OUT = path.join(process.cwd(), "src/data/battle-sprites.json");
const SPRITES = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";

/** Words PokéAPI adds to a form's default look: "ogerpon-wellspring-mask", "darmanitan-galar-standard". */
const DEFAULT_LOOKS = ["standard", "mask", "breed", "plumage", "cap", "disguised"];

/** Showdown suffixes that PokéAPI spells out in full. */
const SUFFIXES: [RegExp, string][] = [
  [/f$/, "female"],
  [/m$/, "male"],
  [/duskmane$/, "dusk"],
  [/dawnwings$/, "dawn"],
  [/bond$/, "battlebond"],
  [/four$/, "familyoffour"],
  [/10$/, "10powerconstruct"],
];

async function exists(url: string): Promise<boolean> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { method: "HEAD" }).catch(() => null);
    if (res && (res.ok || res.status === 404)) return res.ok;
    if (attempt >= 4) throw new Error(`${url}: ${res?.status ?? "network error"}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

async function main() {
  const res = await fetch("https://pokeapi.co/api/v2/pokemon?limit=2000");
  const list = (await res.json()) as { results: { name: string; url: string }[] };
  const byId = new Map<string, number>();
  for (const { name, url } of list.results) {
    const id = Number(url.match(/\/(\d+)\/$/)![1]);
    if (id > 10000) byId.set(toID(name), id);
  }
  const forms: Record<string, number> = {};
  const unmatched: string[] = [];
  for (const species of Dex.species.all()) {
    if (species.num <= 0 || !species.forme || species.isCosmeticForme) continue;
    const id = species.id as string;
    let match = byId.get(id);
    for (const look of DEFAULT_LOOKS) match ??= byId.get(id + look);
    for (const [re, full] of SUFFIXES) match ??= byId.get(id.replace(re, full));
    // Battle-only formes (Ogerpon-Wellspring-Tera) share the sprite of the forme they come from.
    if (!match && typeof species.battleOnly === "string") match = forms[toID(species.battleOnly)];
    if (match) forms[id] = match;
    else unmatched.push(species.name);
  }

  // Drop forms PokéAPI has no sprite for, so they use their base species'.
  const formIds = [...new Set(Object.values(forms))];
  const pngs = await inBatches(formIds, 24, (id) => exists(`${SPRITES}/${id}.png`));
  const missingPng = new Set(formIds.filter((_, i) => !pngs[i]));
  for (const [id, num] of Object.entries(forms)) if (missingPng.has(num)) delete forms[id];

  const numbers = [...new Set([...Dex.species.all()].filter((s) => s.num > 0).map((s) => s.num))];
  const all = [...numbers, ...new Set(Object.values(forms))].sort((a, b) => a - b);
  const gifs = await inBatches(all, 24, (id) => exists(`${SPRITES}/other/showdown/${id}.gif`));
  const noGif = all.filter((_, i) => !gifs[i]);

  const sorted = Object.fromEntries(Object.entries(forms).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(OUT, JSON.stringify({ forms: sorted, noGif }) + "\n");
  console.log(`✓ ${Object.keys(forms).length} forms, ${all.length - noGif.length}/${all.length} with animated sprites`);
  if (missingPng.size) console.log(`  forms without a PokéAPI sprite (use the base species): ${[...missingPng].join(", ")}`);
  if (unmatched.length) console.log(`  forms with no PokéAPI id (use the base species): ${unmatched.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
