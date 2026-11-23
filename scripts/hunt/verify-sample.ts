/**
 * Blind verification of a sample of the answer table against Bulbapedia and Serebii.
 *
 *   npx tsx scripts/hunt/verify-sample.ts pick <seed> <size>                   # prints the sample's dex numbers (for fetching)
 *   npx tsx scripts/hunt/verify-sample.ts check <seed> <size> <bulbapedia.json> <serebii.json>… [--out file]
 *
 * The sample is drawn from the table with a seeded generator, weighted to rare entries
 * (weight 1 / number of places, so a one-spot legendary is far likelier than a route regular)
 * and always including every regional-form entry. The two sources are read first, on their
 * own: each one's place list per game is built from its pages alone and matched to the map
 * (the same game-aware matcher), and only then compared with ours.
 *
 * Per entry and game, a place of ours is "confirmed" when either source lists it; it's an
 * error when neither does. A place both sources list that we don't have is an error too.
 * A place only one source lists is "disputed" (shown, not an error).
 */
import fs from "node:fs";
import answers from "../../src/data/hunt/answers.json";
import geo from "../../src/data/geo.json";
import aboutForms from "../../src/data/about-forms.json";
import type { HuntAnswerFile, HuntEntry } from "../../src/lib/hunt/types";
import { normPlace } from "../../src/lib/pokemon/encounter-transform";
import { FORMS_IN_GAME, ORIGINAL_ONLY, formsInLabel, regionalForms, type EvidenceEntry, type FormInfo } from "./forms";
import { buildPlaceIndex, isOffMap, matchPlace, type GeoPlace, type PlaceIndex } from "./match";

const table = answers as unknown as HuntAnswerFile;
const idx = buildPlaceIndex((geo as unknown as { world: { locations: GeoPlace[] } }).world.locations);
const formsBy = regionalForms(aboutForms as unknown as [number, number, string, string, string][]);

/** mulberry32 on a string seed. */
function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `exclude`: entries checked in earlier rounds, so a fresh sample is fresh. */
export function pickSample(seed: string, size: number, exclude: Set<string> = new Set()): HuntEntry[] {
  const pool = table.entries.filter((e) => !exclude.has(e.id));
  const forms = pool.filter((e) => e.form || formsBy.has(e.dex));
  const rest = pool.filter((e) => !forms.includes(e));
  const out = [...forms];
  const r = rng(seed);
  // Weighted sampling without replacement (Efraimidis–Spirakis keys).
  const keyed = rest.map((e) => ({ e, k: Math.pow(r(), e.places.length) }));
  keyed.sort((a, b) => b.k - a.k || a.e.id.localeCompare(b.e.id));
  for (const { e } of keyed) {
    if (out.length >= size) break;
    out.push(e);
  }
  return out.sort((a, b) => a.dex - b.dex || a.id.localeCompare(b.id));
}

type Sets = Map<string, Set<string>>;
const add = (m: Sets, v: string, k: string) => (m.get(v) ?? m.set(v, new Set()).get(v)!).add(k);

/** Which forms a source's line is about, for one game: the original only when the game has no other. */
function lineForms(dex: number, v: string, labels: string[]): (string | null)[] | undefined {
  const fs_: FormInfo[] | undefined = formsBy.get(dex);
  if (!fs_?.length || ORIGINAL_ONLY.has(v) || !fs_.some((f) => (FORMS_IN_GAME[v] ?? []).includes(f.key.split("-")[0]))) return [null];
  if (!labels.length) return undefined;
  const parsed = labels.map((l) => formsInLabel(l, fs_));
  return parsed.every((x) => x) ? (parsed.flat() as (string | null)[]) : undefined;
}

const ZA_NAMES = /Wild Zone|District|Lumiose|Sewers|Lysandre|Sector|Quasartico|Research Lab|Old House/;
const IGNORED = /^(Poké Pelago|Isle Abeens|.*Game Corner|Terarium|League Club Room|Route|Max Raid Battle|Wanderer|Type)$/;

function place(m: Sets, unplaced: Sets, v: string, name: string) {
  if (isOffMap(name) || IGNORED.test(name)) return;
  if (v === "legends-za" && !ZA_NAMES.test(name)) return;
  const pm = matchPlace(idx, name, v);
  if (pm.kind === "place") add(m, v, pm.key);
  else add(unplaced, v, name);
}

export function bulbapediaSets(e: HuntEntry, bulba: Record<string, EvidenceEntry[]>) {
  const sets: Sets = new Map();
  const unplaced: Sets = new Map();
  for (const be of bulba[String(e.dex)] ?? [])
    for (const v of be.versions) {
      if (v === "legends-arceus") continue;
      for (const s of be.segments) {
        if (s.kind === "other" || (s.kind === "raid" && v !== "sword" && v !== "shield")) continue;
        const f = lineForms(e.dex, v, s.forms);
        if (!f || !f.includes(e.form)) continue;
        for (const p of s.places) place(sets, unplaced, v, p);
      }
    }
  return { sets, unplaced };
}

interface SerebiiRow {
  group: string;
  game: string;
  segments: { text: string; places: string[] }[];
}
const SEREBII_GAMES: Record<string, string> = {
  Red: "red", "Blue (Intl.)": "blue", Yellow: "yellow", Gold: "gold", Silver: "silver", Crystal: "crystal",
  Ruby: "ruby", Sapphire: "sapphire", Emerald: "emerald", FireRed: "firered", LeafGreen: "leafgreen",
  Diamond: "diamond", Pearl: "pearl", Platinum: "platinum", HeartGold: "heartgold", SoulSilver: "soulsilver",
  Black: "black", White: "white", "Black 2": "black-2", "White 2": "white-2", X: "x", Y: "y",
  "Omega Ruby": "omega-ruby", "Alpha Sapphire": "alpha-sapphire", Sun: "sun", Moon: "moon", "Ultra Sun": "ultra-sun", "Ultra Moon": "ultra-moon",
  "Let's Go, Pikachu!": "lets-go-pikachu", "Let's Go, Eevee!": "lets-go-eevee", Sword: "sword", Shield: "shield",
  "Brilliant Diamond": "brilliant-diamond", "Shining Pearl": "shining-pearl", Scarlet: "scarlet", Violet: "violet", "Legends: Z-A": "legends-za",
};
/** Serebii lines that aren't a wild spot. */
const SEREBII_OTHER = /Trade|Gift|Evolve|Breed|Tera Raid|Transfer|Event|Hatch|Received|Island Scan|Pelago|Friend Safari|Hyperspace|Dynamax Adventure|Max Lair|Gigantamax|Pok.walker|Dual|Swarm|Mass Outbreak|Underground|Not in|Unobtainable|Roam|Pal Park|HOME|Pok.mon Bank|Starter|Revive|Fossil|Game Corner|Prize|Only obtainable|Cannot|Celebration|Distribution|Mystery Gift|Ultra Space|Ultra Wormhole/i;

export function serebiiSets(e: HuntEntry, serebii: Record<string, SerebiiRow[]>) {
  const sets: Sets = new Map();
  const unplaced: Sets = new Map();
  for (const [key, rows] of Object.entries(serebii)) {
    if (key.split("/")[1] !== String(e.dex)) continue;
    for (const r of rows) {
      const v = SEREBII_GAMES[r.game] ?? (r.game.startsWith("Legends: Z-A") && !/Mega Dimension/.test(r.game) ? "legends-za" : undefined);
      if (!v) continue;
      let current: string[] = [];
      for (const s of r.segments) {
        const label = /^(\w+) Form$/.exec(s.text.trim());
        if (label) {
          current = [s.text.trim()];
          continue;
        }
        if (SEREBII_OTHER.test(s.text)) continue;
        if (/Max Raid/.test(s.text) && v !== "sword" && v !== "shield") continue;
        const tail = /\((\w+)(?: Form)?\)\s*$/.exec(s.text);
        const labels = tail ? [`${tail[1].replace(/^Alola$/, "Alolan").replace(/^Kanto$/, "Kantonian").replace(/^Galar$/, "Galarian")} Form`] : current;
        const f = lineForms(e.dex, v, labels);
        if (!f || !f.includes(e.form)) continue;
        const names = s.places.length ? s.places : s.text.replace(/^[^:]*:\s*/, "").split(/,\s*|\s+and\s+/);
        for (const n of names) if (n.trim()) place(sets, unplaced, v, n.trim().replace(/\s*\([^)]*\)$/, ""));
      }
    }
  }
  return { sets, unplaced };
}

export interface SampleResult {
  id: string;
  name: string;
  places: number;
  games: { version: string; ours: string[]; bulbapedia: string[]; serebii: string[]; errorsExtra: string[]; errorsMissing: string[]; disputed: string[] }[];
  ok: boolean;
}

export function check(sample: HuntEntry[], bulba: Record<string, EvidenceEntry[]>, serebii: Record<string, SerebiiRow[]>): SampleResult[] {
  return sample.map((e) => {
    const ours: Sets = new Map();
    for (const p of e.places) for (const m of p.methods) for (const v of m.versions) add(ours, v, `${p.geoRegion}|${p.name}`);
    // Sources first, on their own.
    const b = bulbapediaSets(e, bulba).sets;
    const s = serebiiSets(e, serebii).sets;
    const games: SampleResult["games"] = [];
    for (const v of [...new Set([...ours.keys(), ...b.keys(), ...s.keys()])].sort()) {
      const o = ours.get(v) ?? new Set<string>();
      const bv = b.get(v) ?? new Set<string>();
      const sv = s.get(v) ?? new Set<string>();
      const errorsExtra = [...o].filter((k) => !bv.has(k) && !sv.has(k));
      const errorsMissing = [...bv].filter((k) => sv.has(k) && !o.has(k));
      const disputed = [...new Set([...bv, ...sv])].filter((k) => !o.has(k) && !(bv.has(k) && sv.has(k)));
      games.push({ version: v, ours: [...o].sort(), bulbapedia: [...bv].sort(), serebii: [...sv].sort(), errorsExtra, errorsMissing, disputed });
    }
    return { id: e.id, name: e.name, places: e.places.length, games, ok: games.every((g) => !g.errorsExtra.length && !g.errorsMissing.length) };
  });
}

if (process.argv[1]?.endsWith("verify-sample.ts")) {
  const [cmd, seed, sizeS, ...rest] = process.argv.slice(2);
  const outAt = rest.indexOf("--out");
  const out = outAt >= 0 ? rest[outAt + 1] : undefined;
  const excludeAt = rest.indexOf("--exclude");
  const exclude = new Set<string>(excludeAt >= 0 ? (JSON.parse(fs.readFileSync(rest[excludeAt + 1], "utf8")) as string[]) : []);
  const files = rest.filter((x, i) => !x.startsWith("--") && i !== outAt + 1 && i !== excludeAt + 1);
  const sample = pickSample(seed, Number(sizeS), exclude);
  if (cmd === "pick") {
    console.log([...new Set(sample.map((e) => e.dex))].join(" "));
  } else {
    const bulba = JSON.parse(fs.readFileSync(files[0], "utf8")) as Record<string, EvidenceEntry[]>;
    const serebii: Record<string, SerebiiRow[]> = {};
    for (const f of files.slice(1)) Object.assign(serebii, JSON.parse(fs.readFileSync(f, "utf8")));
    const res = check(sample, bulba, serebii);
    if (out) fs.writeFileSync(out, JSON.stringify(res, null, 1));
    const bad = res.filter((r) => !r.ok);
    console.log(`${res.length} entries checked, ${bad.length} with an error (${((100 * bad.length) / res.length).toFixed(1)}%)`);
    for (const r of bad.slice(0, 60))
      for (const g of r.games.filter((x) => x.errorsExtra.length || x.errorsMissing.length)) console.log(`  ${r.id} ${r.name} ${g.version}: extra ${g.errorsExtra.join(", ") || "-"} | missing ${g.errorsMissing.join(", ") || "-"}`);
  }
  void normPlace;
}
