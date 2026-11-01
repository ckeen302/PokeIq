/**
 * Second-source check for the game rounds of "Whose Team Is This?": each
 * round's team is looked up on Serebii's per-game Gym Leader and Elite Four
 * pages. A round counts as confirmed when a Serebii table near the trainer's
 * name lists exactly the same species (as a multiset).
 *
 *   npx tsx scripts/whose-team/verify-serebii.ts
 *
 * Writes scripts/whose-team/serebii.json ({ roundId: page URL }), which the
 * build reads. Pages are cached under .data/serebii-wt/ (gitignored); at
 * least 1.2 seconds between requests.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import pokedex from "../../src/data/pokedex.json";
import type { TeamEntry } from "../../src/lib/whose-team/types";

const UA = "Mozilla/5.0 (compatible; PokeIQ-crosscheck/1.0; contact cadenkeen@gmail.com)";
const CACHE = path.join(process.cwd(), ".data/serebii-wt");
const OUT = path.join(process.cwd(), "scripts/whose-team/serebii.json");
const CANDIDATES = path.join(process.cwd(), ".data/whose-team-candidates.json");

export const SEREBII_PAGES: Record<string, string[]> = {
  "red-blue": ["rb/gyms.shtml", "rb/elitefour.shtml"],
  yellow: ["yellow/gyms.shtml", "yellow/elitefour.shtml"],
  "gold-silver": ["gs/gyms.shtml", "gs/elitefour.shtml"],
  crystal: ["crystal/gyms.shtml", "crystal/elitefour.shtml"],
  "firered-leafgreen": ["fireredleafgreen/gyms.shtml", "fireredleafgreen/elitefour.shtml"],
  platinum: ["platinum/gyms.shtml", "platinum/elitefour.shtml"],
  "heartgold-soulsilver": ["heartgoldsoulsilver/elitefour.shtml"],
  "black-white": ["blackwhite/gyms.shtml", "blackwhite/elitefour.shtml"],
  "black-2-white-2": ["black2white2/gyms.shtml", "black2white2/elitefour.shtml"],
  "x-y": ["xy/gyms.shtml", "xy/elitefour.shtml"],
  "omega-ruby-alpha-sapphire": ["omegarubyalphasapphire/gyms.shtml", "omegarubyalphasapphire/elitefour.shtml"],
  "sun-moon": ["sunmoon/grandtrials.shtml", "sunmoon/elitefour.shtml"],
  "ultra-sun-ultra-moon": ["ultrasunultramoon/trials.shtml", "ultrasunultramoon/elitefour.shtml"],
  "lets-go-pikachu-eevee": ["letsgopikachueevee/gyms.shtml", "letsgopikachueevee/elitefour.shtml"],
  "sword-shield": ["swordshield/gyms.shtml", "swordshield/championcup.shtml"],
  "brilliant-diamond-shining-pearl": ["brilliantdiamondshiningpearl/gyms.shtml", "brilliantdiamondshiningpearl/elitefour.shtml"],
  "scarlet-violet": ["scarletviolet/gyms.shtml", "scarletviolet/elitefour.shtml"],
};

let last = 0;
function get(rel: string): string | null {
  const f = path.join(CACHE, rel.replace(/[^A-Za-z0-9._-]+/g, "_"));
  if (fs.existsSync(f)) {
    const t = fs.readFileSync(f, "latin1");
    return t === "404" ? null : t;
  }
  const wait = last + 1200 - Date.now();
  if (wait > 0) execFileSync("sleep", [(wait / 1000).toFixed(2)]);
  last = Date.now();
  const out = execFileSync("curl", ["-sS", "-m", "60", "-A", UA, "-w", "\n%{http_code}", `https://www.serebii.net/${rel}`], { encoding: "latin1", maxBuffer: 64 * 1024 * 1024 });
  const nl = out.lastIndexOf("\n");
  const status = Number(out.slice(nl + 1));
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(f, status === 200 ? out.slice(0, nl) : "404", "latin1");
  return status === 200 ? out.slice(0, nl) : null;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const SPECIES = new Map<string, number>();
for (const p of pokedex as { id: number; name: string }[]) SPECIES.set(norm(p.name), p.id);
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&eacute;|&#233;|\xe9/g, "é").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

function speciesOfCell(cell: string): number | undefined {
  const t = text(cell).replace(/\bLv\.? ?\d+\b/g, "").replace(/\b(Alolan|Galarian|Hisuian|Paldean)\b|\b(Alola|Galar|Hisui|Paldea)n? Form\b|\(.*?\)/gi, "").trim();
  if (!t || t.length > 24) return undefined;
  return SPECIES.get(norm(t));
}

interface Table {
  species: number[];
  context: string;
}

/** Every table on the page with the species named in its cells (or, failing that, pictured by Dex number), plus the text around it. */
function tables(html: string): Table[] {
  const out: Table[] = [];
  const starts = [...html.matchAll(/<table/g)].map((m) => m.index!);
  starts.forEach((start, i) => {
    const seg = html.slice(start, starts[i + 1] ?? html.length);
    const named = [...seg.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => speciesOfCell(m[1])).filter((x): x is number => x !== undefined);
    const pictured = [...seg.matchAll(/\/(?:pokedex[^"/]*\/(?:evo|icon|small)|[a-z0-9]+\/pokemon)\/(\d{3,4})(?:-[a-z0-9]+)?\.(?:png|gif)/g)].map((m) => Number(m[1]));
    const context = text(html.slice(Math.max(0, start - 1500), start) + seg);
    if (named.length >= 2) out.push({ species: named, context });
    if (pictured.length >= 2 && multiset(pictured) !== multiset(named)) out.push({ species: pictured, context });
  });
  return out;
}

const multiset = (xs: number[]) => [...xs].sort((a, b) => a - b).join(",");

function main() {
  // The build writes every candidate (kept or not) here, so rounds left out for want of a second source can be confirmed.
  const rounds = JSON.parse(fs.readFileSync(CANDIDATES, "utf8")) as TeamEntry[];
  const result: Record<string, string> = {};
  const byGame = new Map<string, Table[]>();
  for (const [game, pages] of Object.entries(SEREBII_PAGES)) {
    const all: Table[] = [];
    for (const p of pages) {
      const html = get(p);
      if (html) all.push(...tables(html).map((t) => ({ ...t, context: `${p}\u0000${t.context}` })));
    }
    byGame.set(game, all);
  }
  let checked = 0;
  const misses: string[] = [];
  for (const r of rounds) {
    if (r.kind !== "game" || !r.game) continue;
    const list = byGame.get(r.game);
    if (!list?.length) continue;
    checked++;
    const want = multiset(r.team.map((m) => m.dex));
    const names = [r.trainer, r.trainer.replace(/^(Professor|Chairman) /, ""), r.trainer === "Blue" ? "Rival" : r.trainer].map(norm);
    const hit = list.find((t) => multiset(t.species) === want && names.some((n) => norm(t.context).includes(n)));
    if (hit) result[r.id] = `https://www.serebii.net/${hit.context.split("\u0000")[0]}`;
    else {
      // Same trainer named right above a table of the same size: worth a look by eye.
      const near = list.filter((t) => t.species.length === r.team.length && names.some((n) => norm(t.context.slice(-400)).includes(n)));
      for (const t of near) misses.push(`${r.id}: ours ${r.team.map((m) => m.species).join(", ")} | Serebii ${t.species.join(",")} (${t.context.split("\u0000")[0]})`);
    }
  }
  fs.writeFileSync(OUT, JSON.stringify(result, null, 1) + "\n");
  fs.writeFileSync(path.join(process.cwd(), ".data/whose-team-serebii-misses.txt"), misses.join("\n") + "\n");
  console.log(`${misses.length} near misses (see .data/whose-team-serebii-misses.txt)`);
  console.log(`checked ${checked} rounds on Serebii, confirmed ${Object.keys(result).length}`);
}

if (!process.env.WT_NO_MAIN) main();
export { tables };
