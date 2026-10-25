/**
 * Spot-check src/data/items.json against the cached raw PokéAPI downloads.
 *
 *   DEX_RAW=<dir> npx tsx scripts/dex/verify-items.ts [count]
 *
 * Picks `count` (default 10) random items (plus Leftovers and TM01), re-reads
 * their raw JSON directly (no builder code) and compares category, generations,
 * holders with rarities, and TM/TR/HM moves. Prints counts only.
 */
import fs from "node:fs";
import path from "node:path";
import pokedex from "../../src/data/pokedex.json";
import type { ItemRecord } from "../../src/lib/dex/items-build";

const RAW = path.join(process.env.DEX_RAW ?? path.join(process.cwd(), ".cache", "dex-raw"), "items");
const items = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src", "data", "items.json"), "utf8")) as ItemRecord[];
const known = new Set((pokedex as { slug: string }[]).map((p) => p.slug));
const read = (kind: string, key: string) => JSON.parse(fs.readFileSync(path.join(RAW, `${kind}-${key}.json`), "utf8"));
const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix"];

const count = Number(process.argv[2] ?? 10);
const picks = new Set<string>(["leftovers", "tm01"]);
while (picks.size < count + 2) picks.add(items[Math.floor(Math.random() * items.length)].slug);

let failures = 0;
for (const slug of picks) {
  const rec = items.find((i) => i.slug === slug)!;
  const raw = read("item", slug);
  const errs: string[] = [];
  const gens = [...new Set((raw.game_indices as { generation: { name: string } }[]).map((g) => ROMAN.indexOf(g.generation.name.replace("generation-", "")) + 1))].filter((g) => g > 0).sort((a, b) => a - b);
  if (JSON.stringify(gens) !== JSON.stringify(rec.gens)) errs.push("gens");
  if (raw.category.name.split("-").map((w: string) => w[0].toUpperCase() + w.slice(1)).join(" ") !== rec.category) errs.push("category");
  const enName = raw.names.find((n: { language: { name: string } }) => n.language.name === "en")?.name;
  if (enName && enName !== rec.name) errs.push("name");
  const holders = (raw.held_by_pokemon as { pokemon: { name: string }; version_details: { rarity: number; version: { name: string } }[] }[]).filter((h) => known.has(h.pokemon.name));
  if (holders.length !== rec.held.length) errs.push(`holders ${holders.length}/${rec.held.length}`);
  for (const h of holders) {
    const r = rec.held.find((x) => x[0] === h.pokemon.name);
    const flat = h.version_details.map((d) => `${d.version.name}:${d.rarity}`).sort();
    const got = (r?.[1] ?? []).flatMap(([pct, vs]) => vs.map((v) => `${v}:${pct}`)).sort();
    if (JSON.stringify(flat) !== JSON.stringify(got)) errs.push(`rarity ${h.pokemon.name}`);
  }
  const machines = (raw.machines as { machine: { url: string }; version_group: { name: string } }[]).map((m) => {
    const mm = read("machine", m.machine.url.split("/").filter(Boolean).pop()!);
    return `${mm.version_group.name}:${mm.move.name}`;
  });
  const gotMachines = rec.machines.map(([, vg, mv]) => `${vg}:${mv}`);
  // The record keeps mainline version groups only, so every record entry must exist in raw.
  if (gotMachines.some((m) => !machines.includes(m))) errs.push("machines (extra)");
  if (machines.length > 0 && gotMachines.length === 0) errs.push("machines (missing)");
  if (errs.length) failures++;
  console.log(`${errs.length ? "FAIL" : "ok  "} ${slug} holders=${rec.held.length} machines=${rec.machines.length}${errs.length ? " " + errs.join(",") : ""}`);
}
console.log(`${picks.size - failures}/${picks.size} items match raw data`);
process.exit(failures ? 1 : 0);
