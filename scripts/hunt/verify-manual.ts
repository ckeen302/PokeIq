/**
 * Compare a hand-checked sample with the table.
 *
 *   npx tsx scripts/hunt/verify-manual.ts <sample.json> <sources.json> [serebii-detail.json]
 *
 * <sources.json> is what someone read on Bulbapedia and Serebii for each sampled Pokémon,
 * without seeing the table: { "<name>": { "<game>": { "bulbapedia": [...], "serebii": [...] } } }.
 * An error is a place of ours neither source lists, or a map place both list that we don't have.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from "node:fs";
import answers from "../../src/data/hunt/answers.json";
import geo from "../../src/data/geo.json";
import { buildPlaceIndex, isOffMap, matchPlace } from "./match";
const idx = buildPlaceIndex((geo as any).world.locations);
const G: Record<string, string[]> = { "Red": ["red"], "Blue": ["blue"], "Yellow": ["yellow"], "Gold": ["gold"], "Silver": ["silver"], "Crystal": ["crystal"], "Ruby": ["ruby"], "Sapphire": ["sapphire"], "Emerald": ["emerald"], "FireRed": ["firered"], "LeafGreen": ["leafgreen"], "Diamond": ["diamond"], "Pearl": ["pearl"], "Platinum": ["platinum"], "HeartGold": ["heartgold"], "SoulSilver": ["soulsilver"], "Black": ["black"], "White": ["white"], "Black 2": ["black-2"], "White 2": ["white-2"], "X": ["x"], "Y": ["y"], "Omega Ruby": ["omega-ruby"], "Alpha Sapphire": ["alpha-sapphire"], "Sun": ["sun"], "Moon": ["moon"], "Ultra Sun": ["ultra-sun"], "Ultra Moon": ["ultra-moon"], "Let's Go Pikachu": ["lets-go-pikachu"], "Let's Go, Pikachu!": ["lets-go-pikachu"], "Let's Go Eevee": ["lets-go-eevee"], "Let's Go, Eevee!": ["lets-go-eevee"], "Sword": ["sword"], "Shield": ["shield"], "Brilliant Diamond": ["brilliant-diamond"], "Shining Pearl": ["shining-pearl"], "Scarlet": ["scarlet"], "Violet": ["violet"], "Legends: Z-A": ["legends-za"] };
const [sampleFile, sourcesFile, detailFile] = process.argv.slice(2);
/** Optional: Serebii's detailed location pages (scripts/hunt/serebii-detail.ts), which list spots its summary pages leave out. */
const detail: Record<string, Record<string, string[]>> = detailFile ? JSON.parse(fs.readFileSync(detailFile, "utf8")) : {};
const man: Record<string, any> = JSON.parse(fs.readFileSync(sourcesFile, "utf8"));
const ids = JSON.parse(fs.readFileSync(sampleFile, "utf8"));
const A = new Map((answers as any).entries.map((e: any) => [e.id, e]));
const clean = (s: string) => s.replace(/\s*\((Paldea|Kitakami|Blueberry Academy|Isle of Armor|Crown Tundra|Galar|The Teal Mask|The Indigo Disk)\)\s*$/, "").replace(/^(North|South|East|West) Province:\s*/, "").trim();
let bad = 0;
const unknownGames = new Set<string>();
for (const id of ids) {
  const e: any = A.get(id);
  if (!e) { console.log(id, "left out of table now"); continue; }
  const m = man[e.name]; if (!m) { console.log(id, e.name, "NO MANUAL"); continue; }
  const ours = new Map<string, Set<string>>();
  for (const p of e.places) for (const mm of p.methods) for (const v of mm.versions) (ours.get(v) ?? ours.set(v, new Set()).get(v)!).add(`${p.geoRegion}|${p.name}`);
  const theirs = new Map<string, { b: Set<string>; s: Set<string>; un: string[] }>();
  for (const [game, src] of Object.entries<any>(m)) {
    const vs = G[game] ?? (game.includes("/") ? game.split("/").flatMap((g) => G[g.trim()] ?? []) : []);
    if (!vs.length) { unknownGames.add(game); continue; }
    for (const v of vs) {
      const t = theirs.get(v) ?? theirs.set(v, { b: new Set(), s: new Set(), un: [] }).get(v)!;
      for (const [k, list] of [["b", src.bulbapedia ?? []], ["s", src.serebii ?? []]] as const)
        for (const raw of list as string[]) {
          const n = clean(raw);
          if (isOffMap(n) || /Hyperspace/.test(raw)) continue;
          const pm = matchPlace(idx, n, v);
          if (pm.kind === "place") (t as any)[k].add(pm.key); else t.un.push(`${k}:${raw}`);
        }
    }
  }
  for (const [v, names] of Object.entries(detail[String(e.dex)] ?? {})) {
    if (e.form || !theirs.has(v)) continue;
    for (const n of names) {
      const pm = matchPlace(idx, n, v);
      if (pm.kind === "place") theirs.get(v)!.s.add(pm.key);
    }
  }
  const lines: string[] = [];
  for (const v of new Set([...ours.keys(), ...theirs.keys()])) {
    const o = ours.get(v) ?? new Set(); const t = theirs.get(v) ?? { b: new Set(), s: new Set(), un: [] };
    const extra = [...o].filter((k) => !t.b.has(k) && !t.s.has(k));
    const missing = [...t.b].filter((k) => t.s.has(k) && !o.has(k));
    if (extra.length || missing.length) lines.push(`   ${v}: extra ${extra.join(", ") || "-"} | missing ${missing.join(", ") || "-"} ${t.un.length ? "| unplaced " + t.un.join("; ") : ""}`);
  }
  if (lines.length) { bad++; console.log(id, e.name); lines.forEach((l) => console.log(l)); }
}
console.log("entries with errors:", bad, "of", ids.length, "unknown games", [...unknownGames]);
