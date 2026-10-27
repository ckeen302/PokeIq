/**
 * Cross-check the Gen V–IX trainer data (imported from Bulbapedia) against a
 * second source, Serebii's PokéEarth area pages and per-game Gym / Elite Four
 * pages, and write the teams both sources agree on to
 * tests/fixtures/trainers-verified.json (the spot-check fixture the tests
 * hold the committed data to), plus a report of every disagreement.
 *
 *   npx tsx scripts/trainers/crosscheck.ts [game…]
 *
 * Pages are cached under .data/serebii/ (gitignored); at least one second
 * between requests. Only facts are compared (species, levels, moves, items).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import pokedex from "../../src/data/pokedex.json";
import { TRAINER_GAMES } from "../../src/lib/trainers/games";
import type { TrainerGameFile, TrainerTeam } from "../../src/lib/trainers/types";
import { itemRef, moveSlug, norm } from "./common";

const UA = "Mozilla/5.0 (compatible; PokeIQ-trainer-crosscheck/1.0; contact cadenkeen@gmail.com)";
const CACHE = path.join(process.cwd(), ".data/serebii");
const OUT = path.join(process.cwd(), "tests/fixtures/trainers-verified.json");
const REPORT = path.join(process.cwd(), ".data/trainers-crosscheck.txt");

/** Serebii's PokéEarth folder per region, and the game pages listing Gym Leaders, Elite Four and the like. */
const REGION_DIR: Record<string, string> = { Unova: "unova", Kalos: "kalos", Hoenn: "hoenn", Alola: "alola", Kanto: "kanto", Galar: "galar", "Isle of Armor": "galar", "Crown Tundra": "galar", Sinnoh: "sinnoh", Paldea: "paldea", Kitakami: "kitakami", "Blueberry Academy": "terarium" };
const GAME_PAGES: Record<string, string[]> = {
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
    const t = fs.readFileSync(f, "utf8");
    return t === "404" ? null : t;
  }
  const wait = last + 1100 - Date.now();
  if (wait > 0) execFileSync("sleep", [(wait / 1000).toFixed(2)]);
  last = Date.now();
  let out = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      out = execFileSync("curl", ["-sS", "-m", "60", "-A", UA, "-w", "\n%{http_code}", `https://www.serebii.net/${rel}`], { encoding: "latin1", maxBuffer: 64 * 1024 * 1024 });
      break;
    } catch {
      execFileSync("sleep", [String(3 * 2 ** attempt)]);
    }
  }
  const nl = out.lastIndexOf("\n");
  const status = Number(out.slice(nl + 1));
  // Serebii serves Windows-1252; keep é and the gender symbols readable.
  const body = Buffer.from(out.slice(0, nl), "latin1").toString("latin1");
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(f, status === 200 ? body : "404");
  return status === 200 ? body : null;
}

export interface SerebiiMon {
  species: string;
  level: number;
  moves: string[];
  item?: string;
}
export interface SerebiiTeam {
  label: string;
  mons: SerebiiMon[];
}

const text = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&eacute;|&#233;|\xe9/g, "é")
    .replace(/&amp;/g, "&")
    .replace(/&#9792;|&#9794;|♀|♂/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Every <table class="trainer"> on a Serebii page: the trainer's label and their Pokémon. */
export function parseSerebii(html: string): SerebiiTeam[] {
  const out: SerebiiTeam[] = [];
  const parts = html.split(/<table class="trainer">/).slice(1);
  for (const chunk0 of parts) {
    const chunk = chunk0.split(/<table class="trainer">|<a name="/)[0];
    const label = /<tr>\s*<td[^>]*>([^<]+(?:<[^>]+>[^<]*)*?)<\/td>\s*<td align="center"><a href="\/pokedex/.exec(chunk);
    const species = [...chunk.matchAll(/<td align="center"><a href="\/pokedex[^"]*">([^<]+)<\/a>/g)].map((m) => text(m[1]));
    const levels = [...chunk.matchAll(/class="level"[^>]*>\s*Level (\d+)/g)].map((m) => Number(m[1]));
    const moves = [...chunk.matchAll(/<b>Attacks<\/b>:?<br \/>([\s\S]*?)<\/td>/g)].map((m) => [...m[1].matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((x) => text(x[1])));
    const items = [...chunk.matchAll(/<b>Hold Item<\/b>:?<br \/>([\s\S]*?)<\/td>/g)].map((m) => text(m[1]));
    if (!label || !species.length || species.length !== levels.length) continue;
    out.push({
      label: text(label[1]),
      mons: species.map((s, i) => ({ species: s, level: levels[i], moves: moves[i] ?? [], item: items[i] && !/^No Item$/i.test(items[i]) ? items[i] : undefined })),
    });
  }
  return out;
}

const SPECIES = new Map<string, number>();
for (const p of pokedex as { id: number; name: string }[]) SPECIES.set(norm(p.name), p.id);
function speciesOf(name: string): number | undefined {
  const n = norm(name.replace(/\b(Alolan|Galarian|Hisuian|Paldean)\b|\b(Alola|Galar|Hisui|Paldea)n? Form\b/gi, ""));
  if (SPECIES.has(n)) return SPECIES.get(n);
  for (const [k, v] of SPECIES) if (n.startsWith(k) && k.length >= 4) return v;
  return undefined;
}
function moveOf(name: string): string | undefined {
  try {
    return moveSlug(name);
  } catch {
    return undefined;
  }
}

interface Result {
  game: string;
  tables: number;
  matched: number;
  levelsAgree: number;
  movesCompared: number;
  movesAgree: number;
  itemsCompared: number;
  itemsAgree: number;
  disagreements: string[];
  verified: { id: string; n?: string; team: [number, number][]; moves?: string[][] }[];
}

const titleOf = (t: TrainerTeam) => (t.name ? `${t.cls} ${t.name}` : t.cls);
const serebiiSlug = (area: string) => area.toLowerCase().replace(/[()]/g, "").replace(/é/g, "e").replace(/\s+/g, "");

/** Serebii's Pokémon lined up with ours by species (the two sites sometimes list a party in a different order). */
function aligned(t: TrainerTeam, st: SerebiiTeam, sp: number[]): SerebiiMon[] {
  const free = st.mons.map((_, j) => j);
  return t.team.map((m) => {
    const opts = free.filter((j) => sp[j] === m.s);
    const j = opts.find((x) => st.mons[x].level === m.lv) ?? opts[0];
    free.splice(free.indexOf(j), 1);
    return st.mons[j];
  });
}

function crosscheck(game: string): Result {
  const f = JSON.parse(fs.readFileSync(path.join("src/data/trainers", `${game}.json`), "utf8")) as TrainerGameFile;
  const r: Result = { game, tables: 0, matched: 0, levelsAgree: 0, movesCompared: 0, movesAgree: 0, itemsCompared: 0, itemsAgree: 0, disagreements: [], verified: [] };
  const pages = new Set<string>(GAME_PAGES[game] ?? []);
  for (const a of f.areas) {
    const dir = REGION_DIR[a.region];
    if (dir) pages.add(`pokearth/${dir}/${serebiiSlug(a.name)}.shtml`);
  }
  const used = new Set<string>();
  const all: { rel: string; st: SerebiiTeam; sp: number[]; key: string }[] = [];
  const seenTable = new Set<string>();
  for (const rel of pages) {
    const html = get(rel);
    if (!html) continue;
    for (const st of parseSerebii(html)) {
      r.tables++;
      const sp = st.mons.map((m) => speciesOf(m.species));
      if (sp.some((x) => !x)) continue;
      const key = `${norm(st.label)}|${sp.join(",")}`;
      const full = `${key}|${st.mons.map((m) => m.level).join(",")}`;
      if (seenTable.has(full)) continue; // the same battle printed on two Serebii pages
      seenTable.add(full);
      all.push({ rel, st, sp: sp as number[], key });
    }
  }
  const tablesPerKey = new Map<string, number>();
  for (const x of all) tablesPerKey.set(x.key, (tablesPerKey.get(x.key) ?? 0) + 1);
  for (const { rel, st, sp, key } of all) {
    {
      const label = norm(st.label);
      // Same trainer (Serebii prints "Class Name"), same species in the same order.
      const sorted = [...sp].sort((a, b) => a - b).join(",");
      const same = (t: TrainerTeam) => t.team.length === sp.length && t.team.map((m) => m.s).sort((a, b) => a - b).join(",") === sorted && (t.name ? label.endsWith(norm(t.name)) : label.includes(norm(t.cls)));
      const cands = f.teams.filter((t) => !used.has(t.id) && same(t));
      if (!cands.length) continue;
      const exactLv = cands.find((t) => { const tm = aligned(t, st, sp); return t.team.every((m, i) => m.lv === tm[i].level); });
      // Without a level-exact counterpart, only compare when the trainer has a
      // single battle with this team on both sides; otherwise it is a
      // different battle (rematch, rival variant) and not a disagreement.
      if (!exactLv && (f.teams.filter(same).length !== 1 || tablesPerKey.get(key) !== 1)) continue;
      const exact = exactLv ?? cands[0];
      used.add(exact.id);
      r.matched++;
      const tm = aligned(exact, st, sp);
      if (exact.team.some((m, i) => m.s !== sp[i])) r.disagreements.push(`${exact.id} (${titleOf(exact)}) party order: ours ${exact.team.map((m) => m.s).join("/")} vs Serebii ${sp.join("/")} [${rel}]`);
      const lvOk = exact.team.every((m, i) => m.lv === tm[i].level);
      if (lvOk) r.levelsAgree++;
      else r.disagreements.push(`${exact.id} (${titleOf(exact)}) levels: ours ${exact.team.map((m) => m.lv).join("/")} vs Serebii ${tm.map((m) => m.level).join("/")} [${rel}]`);
      let movesOk = true;
      let compared = false;
      exact.team.forEach((m, i) => {
        const theirs = tm[i].moves.map(moveOf).filter(Boolean) as string[];
        if (!theirs.length || !m.m.length) return;
        compared = true;
        const same = theirs.length === m.m.length && theirs.every((x) => m.m.includes(x));
        if (!same) {
          movesOk = false;
          r.disagreements.push(`${exact.id} (${titleOf(exact)}) ${m.s} moves${m.d ? " (level-up default)" : ""}: ours ${m.m.join(",")} vs Serebii ${theirs.join(",")} [${rel}]`);
        }
      });
      if (compared) {
        r.movesCompared++;
        if (movesOk) r.movesAgree++;
      }
      exact.team.forEach((m, i) => {
        const theirs = tm[i].item;
        if (!theirs && !m.i) return;
        r.itemsCompared++;
        const ok = theirs && m.i && (m.i === itemRef(theirs.replace(/\s+/g, "_").toUpperCase(), theirs) || norm(m.i) === norm(theirs));
        if (ok) r.itemsAgree++;
        else r.disagreements.push(`${exact.id} (${titleOf(exact)}) ${m.s} item: ours ${m.i ?? "none"} vs Serebii ${theirs ?? "none"} [${rel}]`);
      });
      if (lvOk) r.verified.push({ id: exact.id, ...(exact.n ? { n: exact.n } : {}), team: exact.team.map((m) => [m.s, m.lv]), ...(compared && movesOk ? { moves: exact.team.map((m) => m.m) } : {}) });
    }
  }
  // Keep the fixture small: every notable team both sources agree on, plus a
  // fixed sample of 40 other trainers (chosen by a hash of the id, so reruns pick the same ones).
  const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const others = r.verified.filter((v) => !v.n).sort((a, b) => hash(a.id) - hash(b.id) || a.id.localeCompare(b.id));
  r.verified = [...r.verified.filter((v) => v.n), ...others.slice(0, 40)].sort((a, b) => a.id.localeCompare(b.id));
  return r;
}

function main() {
  const want = process.argv.slice(2);
  const prev = fs.existsSync(OUT) ? (JSON.parse(fs.readFileSync(OUT, "utf8")) as { games: Record<string, unknown> }) : { games: {} };
  const report: string[] = [];
  for (const g of TRAINER_GAMES) {
    if (!GAME_PAGES[g.key] || (want.length && !want.includes(g.key))) continue;
    const r = crosscheck(g.key);
    const line = `${g.key}: ${r.tables} Serebii tables, ${r.matched} matched to our teams; levels agree ${r.levelsAgree}/${r.matched}; moves agree ${r.movesAgree}/${r.movesCompared}; held items agree ${r.itemsAgree}/${r.itemsCompared}`;
    console.log(line);
    report.push(line, ...r.disagreements.map((d) => `  ${d}`), "");
    prev.games[g.key] = { summary: { tables: r.tables, matched: r.matched, levelsAgree: r.levelsAgree, movesCompared: r.movesCompared, movesAgree: r.movesAgree, itemsCompared: r.itemsCompared, itemsAgree: r.itemsAgree, disagreements: r.disagreements.length }, verified: r.verified };
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ source: "serebii.net PokéEarth area pages and per-game Gym / Elite Four pages", ...prev }) + "\n");
  fs.writeFileSync(REPORT, report.join("\n"));
  console.log(`report: ${REPORT}`);
}

if (process.argv[1] && /crosscheck\.ts$/.test(process.argv[1])) main();
