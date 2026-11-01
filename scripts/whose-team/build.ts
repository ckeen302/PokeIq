/**
 * Builds src/data/trainer-teams.json, the rounds of the "Whose Team Is
 * This?" quiz.
 *
 *   npx tsx scripts/whose-team/build.ts [--print]
 *
 * Game teams are taken from the committed trainer data (src/data/trainers),
 * never typed by hand: Gen I–IV from the pret decompilations (the games' own
 * party tables), Gen V–IX from the Bulbapedia import. A Gen V–IX team is only
 * used when Serebii agrees with it (tests/fixtures/trainers-verified.json, see
 * scripts/trainers/crosscheck.ts). Anime teams come from anime.ts, each
 * checked by hand against the page it cites.
 *
 * Per game and trainer: the first battle in their League role (Gym, Elite
 * Four, Champion, kahuna) and their strongest rematch in it; for rivals,
 * villain leaders and Red, their strongest battle in the game. Rivals whose
 * team depends on the player's starter use one variant, recorded in
 * `variant`. Rounds that two different trainers would share (the same set of
 * species) and teams of fewer than two Pokémon are left out.
 */
import fs from "node:fs";
import path from "node:path";
import pokedex from "../../src/data/pokedex.json";
import sprites from "../../src/data/battle-sprites.json";
import verifiedFixture from "../../tests/fixtures/trainers-verified.json";
import { TRAINER_GAMES, type TrainerGame } from "../../src/lib/trainers/games";
import { NOTABLE, type NotableTrainer } from "../../src/lib/trainers/notable";
import type { TrainerGameFile, TrainerMon, TrainerTeam } from "../../src/lib/trainers/types";
import { ANIME_TEAMS } from "./anime";
import type { TeamEntry, TeamMon } from "../../src/lib/whose-team/types";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "src/data/trainer-teams.json");
const NAMES_OUT = path.join(ROOT, "src/data/trainer-team-names.json");
const EXCLUDED_OUT = path.join(ROOT, "scripts/whose-team/excluded.txt");

const DEX = new Map((pokedex as { id: number; slug: string; name: string }[]).map((p) => [p.id, p]));
const FORMS = (sprites as { forms: Record<string, number> }).forms;

/** Form names as the imported data prints them -> the battle-sprite key suffix (null: the base form's art). */
const FORM_SUFFIX: Record<string, string | null> = {
  Alola: "alola",
  Galar: "galar",
  Midnight: "midnight",
  "Pom-Pom": "pompom",
  "Low Key": "lowkey",
  Heat: "heat",
  Wash: "wash",
  Terastal: "terastal",
  "Rapid Strike": "rapidstrike",
  // Base forms: the default artwork is the right one.
  Baile: null,
  Full: null,
  West: null,
  "Single Strike": null,
  Shield: null,
};
const FORM_LABEL: Record<string, string> = { Alola: "Alolan", Galar: "Galarian" };
/** Gen IV form indices the decompilations use. */
const GEN4_FORMS: Record<number, Record<number, string>> = {
  412: { 1: "Sandy Cloak", 2: "Trash Cloak" },
  413: { 1: "Sandy Cloak", 2: "Trash Cloak" },
  422: { 1: "East Sea" },
  423: { 1: "East Sea" },
};
const GEN4_FORM_ART: Record<string, number> = {
  "413:1": FORMS["wormadamsandy"],
  "413:2": FORMS["wormadamtrash"],
};

const VERSION_NAMES: Record<string, string> = {
  red: "Red", blue: "Blue", ruby: "Ruby", sapphire: "Sapphire", black: "Black", white: "White", "black-2": "Black 2", "white-2": "White 2",
  "omega-ruby": "Omega Ruby", "alpha-sapphire": "Alpha Sapphire", sun: "Sun", moon: "Moon", "ultra-sun": "Ultra Sun", "ultra-moon": "Ultra Moon",
  "lets-go-pikachu": "Let's Go, Pikachu!", "lets-go-eevee": "Let's Go, Eevee!", sword: "Sword", shield: "Shield", scarlet: "Scarlet", violet: "Violet",
  gold: "Gold", silver: "Silver", heartgold: "HeartGold", soulsilver: "SoulSilver", diamond: "Diamond", pearl: "Pearl", firered: "FireRed", leafgreen: "LeafGreen",
};

/** The trainers a round can be about, and how they're named in answers. */
const ROLES = new Set(["Gym Leader", "Elite Four", "Champion", "Kahuna", "Rival"]);
/** Villain team leaders (not admins). */
const LEADERS = new Set(["giovanni", "maxie", "archie", "cyrus", "ghetsis", "n", "lysandre", "lusamine", "guzma", "rose", "penny"]);
/** Red is a "Trainer" in the notable list; his Mt. Silver battle is in. */
const EXTRA = new Set(["red"]);

/** Answer names that differ from the notable list's display name, and accepted alternate names for the same person. */
const ANSWER_NAME: Record<string, string> = { rose: "Chairman Rose", kukui: "Professor Kukui" };
export const ALIASES: Record<string, { aliases: string[]; note?: string }> = {
  Blue: { aliases: ["Green"], note: "Called Green in the Japanese games" },
  "Lt. Surge": { aliases: ["Surge"] },
  Steven: { aliases: ["Steven Stone"] },
  "Crasher Wake": { aliases: ["Wake"] },
  "Tate and Liza": { aliases: ["Tate & Liza"] },
  "Professor Kukui": { aliases: ["Kukui"] },
  "Chairman Rose": { aliases: ["Rose"] },
  Silver: { aliases: [], note: "The player names him; Silver is the usual name" },
  Ash: { aliases: ["Ash Ketchum", "Satoshi"], note: "Satoshi in Japanese" },
  Gary: { aliases: ["Gary Oak", "Shigeru"], note: "Shigeru in Japanese" },
};

/** Bulbapedia page per trainer (same titles the Mainline Games quiz cites). */
const BULBA_TITLE: Record<string, string> = {
  blue: "Blue_(game)", red: "Red_(game)", silver: "Silver_(game)", drake: "Drake_(game)", steven: "Steven_Stone", kukui: "Professor_Kukui",
  may: "May_(game)", brendan: "Brendan", "tate-and-liza": "Tate_and_Liza", "lt-surge": "Lt._Surge", "crasher-wake": "Crasher_Wake",
  serena: "Serena_(game)", rose: "Rose", n: "N", bianca: "Bianca_(game)",
};
const bulbapedia = (n: NotableTrainer) =>
  `https://bulbapedia.bulbagarden.net/wiki/${BULBA_TITLE[n.slug] ?? n.name.replace(/ /g, "_")}`;

/** Ace overrides where the last Pokémon in the party isn't the trainer's signature. */
const ACE_OVERRIDE: Record<string, number> = { red: 25 };

/** League role classes (Gen I prints the leader's own name as the class). */
const ROLE_CLASS = /^((Gym )?Leader|Elite Four|Champion|Top Champion|Island Kahuna|Kahuna|BB League Elite Four|BB League Champion)$/;

function load(key: string): TrainerGameFile {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/trainers", `${key}.json`), "utf8")) as TrainerGameFile;
}

function mon(m: TrainerMon): TeamMon {
  const p = DEX.get(m.s);
  if (!p) throw new Error(`Unknown species ${m.s}`);
  let art = m.s;
  let form: string | undefined;
  if (m.fn) {
    if (!(m.fn in FORM_SUFFIX)) throw new Error(`Unmapped form ${m.fn} for ${p.name}`);
    const suffix = FORM_SUFFIX[m.fn];
    if (suffix) {
      const id = FORMS[p.slug.replace(/-/g, "") + suffix];
      if (!id) throw new Error(`No art for ${p.slug} ${suffix}`);
      art = id;
      form = FORM_LABEL[m.fn] ?? m.fn;
    }
  } else if (m.f) {
    form = GEN4_FORMS[m.s]?.[m.f];
    if (!form) throw new Error(`Unmapped form index ${m.f} for ${p.name}`);
    art = GEN4_FORM_ART[`${m.s}:${m.f}`] ?? m.s;
  }
  return { species: p.name, dex: m.s, ...(art !== m.s && { art }), ...(form && { form }) };
}

const levelSum = (t: TrainerTeam) => t.team.reduce((s, m) => s + m.lv, 0);
const setKey = (team: { dex: number; form?: string }[]) =>
  team
    .map((m) => `${m.dex}${m.form ? `-${m.form}` : ""}`)
    .sort()
    .join(",");

function gameName(g: TrainerGame, ver?: string[]): string {
  if (ver?.length === 1) return `Pokémon ${VERSION_NAMES[ver[0]] ?? ver[0]}`;
  return `Pokémon ${g.name}`;
}

const VERIFIED = new Map<string, Set<string>>(
  Object.entries((verifiedFixture as { games: Record<string, { verified: { id: string }[] }> }).games).map(([k, v]) => [k, new Set(v.verified.map((x) => x.id))])
);

interface Candidate extends TeamEntry {
  battleLevel: number;
}

const excluded: string[] = [];
/** Every game team considered, for verify-serebii.ts. */
const CANDIDATES: Pick<TeamEntry, "id" | "trainer" | "kind" | "game" | "team">[] = [];
const SEREBII_FILE = path.join(ROOT, "scripts/whose-team/serebii.json");
const SEREBII: Record<string, string> = fs.existsSync(SEREBII_FILE) ? JSON.parse(fs.readFileSync(SEREBII_FILE, "utf8")) : {};

function place(file: TrainerGameFile, t: TrainerTeam): string {
  const spot = t.at[0];
  if (!spot) return "";
  const area = file.areas[spot.a]?.name ?? "";
  return spot.s && spot.s !== area ? `${area} (${spot.s})` : area;
}

function roleTitle(cls: string): string {
  if (/Elite Four/.test(cls)) return "Elite Four";
  if (/Champion/.test(cls)) return "Champion";
  if (/Kahuna/.test(cls)) return "Kahuna";
  if (/Leader/.test(cls)) return "Gym Leader";
  return cls;
}

function entryFor(g: TrainerGame, file: TrainerGameFile, n: NotableTrainer, t: TrainerTeam, label: string): Candidate | null {
  const team = t.team.map(mon);
  if (team.length < 2) {
    excluded.push(`${g.key} ${n.name} ${t.id}: only ${team.length} Pokémon`);
    return null;
  }
  const isWiki = g.repo === "Bulbapedia";
  const id = `${g.key}:${n.slug}:${t.id}`.toLowerCase();
  CANDIDATES.push({ id, trainer: ANSWER_NAME[n.slug] ?? n.name, kind: "game", game: g.key, team });
  const serebiiPage = SEREBII[id];
  const fixtureOk = VERIFIED.get(g.key)?.has(t.id);
  if (isWiki && !fixtureOk && !serebiiPage) {
    excluded.push(`${g.key} ${n.name} ${t.id}: Bulbapedia import not confirmed by Serebii`);
    return null;
  }
  const checks = [
    isWiki ? "Bulbapedia (imported location page)" : `${g.repo}@${file.source.commit.slice(0, 7)} party data`,
    fixtureOk ? "Serebii (trainer crosscheck fixture)" : null,
    serebiiPage ?? null,
  ].filter(Boolean);
  const trainer = ANSWER_NAME[n.slug] ?? n.name;
  // The ace: the highest-level Pokémon (the later one on a tie), unless overridden.
  let aceIndex = 0;
  t.team.forEach((m, i) => {
    if (m.lv >= t.team[aceIndex].lv) aceIndex = i;
  });
  if (ACE_OVERRIDE[n.slug]) aceIndex = Math.max(0, t.team.findIndex((m) => m.s === ACE_OVERRIDE[n.slug]));
  const ace = team[aceIndex];
  const chose = (t.tag ?? "").split(" · ").find((p) => /^If you chose /.test(p));
  const variant = chose ? chose.replace(/^If you chose/, "Player chose") : undefined;
  const where = place(file, t);
  return {
    id,
    trainer,
    kind: "game",
    gen: g.gen,
    game: g.key,
    appearance: `${gameName(g, t.ver)} — ${label}${where ? `, ${where}` : ""}`,
    ...(variant && { variant }),
    team,
    ace: ace.species + (ace.form ? ` (${ace.form})` : ""),
    source: bulbapedia(n),
    data: `${t.id}: ${checks.join("; ")}`,
    battleLevel: levelSum(t),
  };
}

/** A tag that only says which variant of a battle this is (the player's starter, the version). */
const VARIANT_TAG = /^(If you chose .+|Let's Go, (Pikachu|Eevee)!)$/;
const REMATCH_TAG = /Rematch|Post-game|After the Hall of Fame|After entering the Hall of Fame/i;
/** Where a League role is fought (Gen I prints the leader's name as the class, so the place tells a Gym battle from a hideout). */
const LEAGUE_PLACE = /Gym|Stadium|Pokémon League|Indigo Plateau|Ever Grande|Champion|Elite Four|Grand trial|Plaza/;

/** The battle a team belongs to: variants (starter, version) of one battle share it. */
function battleKey(t: TrainerTeam): string {
  const tag = (t.tag ?? "")
    .split(" · ")
    .filter((p) => !VARIANT_TAG.test(p))
    .join(" · ");
  return `${t.g ?? t.id}|${tag}`;
}

/** The tag minus its variant part ("Rematch · If you chose Bulbasaur" -> "Rematch"). */
function battleTag(t: TrainerTeam): string | undefined {
  const tag = (t.tag ?? "")
    .split(" · ")
    .filter((p) => !VARIANT_TAG.test(p))
    .join(" · ");
  return tag || undefined;
}

function gameEntries(): Candidate[] {
  const out: Candidate[] = [];
  for (const g of TRAINER_GAMES) {
    const file = load(g.key);
    for (const n of NOTABLE) {
      const roles = [n.role, ...(n.alsoRoles ?? [])];
      const leader = LEADERS.has(n.slug);
      if (!roles.some((r) => ROLES.has(r)) && !leader && !EXTRA.has(n.slug)) continue;
      const teams = file.teams.filter((t) => t.n === n.slug);
      if (!teams.length) continue;
      // One variant per battle: the first the data lists.
      const battles = new Map<string, TrainerTeam>();
      for (const t of teams) if (!battles.has(battleKey(t))) battles.set(battleKey(t), t);
      const list = [...battles.values()];
      const isRole = (t: TrainerTeam) => ROLE_CLASS.test(t.cls) || (!t.name && t.cls === n.name && LEAGUE_PLACE.test(place(file, t)));
      const role = list.filter(isRole);
      const picked: [TrainerTeam, string][] = [];
      const titleOf = (t: TrainerTeam) => (t.cls === n.name ? (/Indigo Plateau|League/.test(place(file, t)) ? "Elite Four" : "Gym Leader") : roleTitle(t.cls));

      const firsts = role
        .filter((t) => !REMATCH_TAG.test(battleTag(t) ?? ""))
        .sort((a, b) => Number(!!a.double) - Number(!!b.double) || Number(!LEAGUE_PLACE.test(place(file, a))) - Number(!LEAGUE_PLACE.test(place(file, b))) || levelSum(a) - levelSum(b));
      if (firsts[0]) {
        const t = firsts[0];
        picked.push([t, [titleOf(t), battleTag(t)].filter(Boolean).join(", ")]);
      }
      const rematch = role.filter((t) => REMATCH_TAG.test(battleTag(t) ?? "")).sort((a, b) => levelSum(b) - levelSum(a))[0];
      if (rematch) picked.push([rematch, `${titleOf(rematch)}, ${battleTag(rematch)!.replace(/^Rematch/, "rematch")}`]);

      // Rivals, villain leaders and Red: their strongest battle outside a League role (a rival who is the
      // Champion in this game is already in through the Champion battle).
      const others = list.filter((t) => !isRole(t));
      const wantsOther = leader || EXTRA.has(n.slug) || (role.length === 0 && roles.some((r) => ROLES.has(r)));
      if (others.length && wantsOther) {
        const best = others.sort((a, b) => levelSum(b) - levelSum(a))[0];
        const kind = leader ? "Boss battle" : roles.includes("Rival") ? "Rival battle" : n.role === "Champion" ? "Champion battle" : "Battle";
        picked.push([best, [kind, battleTag(best)].filter(Boolean).join(", ")]);
      }
      for (const [t, label] of picked) {
        const e = entryFor(g, file, n, t, label);
        if (e) out.push(e);
      }
    }
  }
  return out;
}

function build(): TeamEntry[] {
  const game = gameEntries();
  const anime: Candidate[] = ANIME_TEAMS.map((a) => ({ ...a, kind: "anime" as const, battleLevel: 0 }));
  for (const a of anime) if (!a.team.some((m) => m.species === a.ace)) throw new Error(`${a.id}: ace ${a.ace} not in the team`);
  let all = [...game, ...anime];

  // The same trainer, the same game, the same Pokémon: keep one round.
  const seen = new Set<string>();
  all = all.filter((e) => {
    const k = `${e.trainer}|${e.game ?? e.series}|${setKey(e.team)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // A set of species two different trainers both use can't be told apart: drop every such round.
  const owners = new Map<string, Set<string>>();
  for (const e of all) {
    const k = setKey(e.team);
    if (!owners.has(k)) owners.set(k, new Set());
    owners.get(k)!.add(e.trainer);
  }
  all = all.filter((e) => {
    const who = owners.get(setKey(e.team))!;
    if (who.size > 1) {
      excluded.push(`${e.id}: same Pokémon as ${[...who].filter((w) => w !== e.trainer).join(", ")}`);
      return false;
    }
    return true;
  });
  return all.map((e) => {
    const out: TeamEntry & { battleLevel?: number } = { ...e };
    delete out.battleLevel;
    return out;
  });
}

const entries = build();
if (process.argv.includes("--print")) {
  for (const e of entries) console.log(`${e.trainer.padEnd(16)} ${e.appearance}${e.variant ? ` [${e.variant}]` : ""} :: ${e.team.map((m) => m.species + (m.form ? `(${m.form})` : "")).join(", ")} | ace ${e.ace}`);
}
// One round per line: reviewable diffs, a third of the size of indented JSON.
fs.writeFileSync(OUT, `[\n${entries.map((e) => JSON.stringify(e)).join(",\n")}\n]\n`);
const names = [...new Set(entries.map((e) => e.trainer))].sort((a, b) => a.localeCompare(b));
fs.writeFileSync(
  NAMES_OUT,
  JSON.stringify(names.map((name) => ({ name, ...(ALIASES[name]?.aliases.length && { aliases: ALIASES[name].aliases }), ...(ALIASES[name]?.note && { note: ALIASES[name].note }) })), null, 1) + "\n"
);
fs.writeFileSync(EXCLUDED_OUT, excluded.join("\n") + "\n");
fs.mkdirSync(path.join(ROOT, ".data"), { recursive: true });
fs.writeFileSync(path.join(ROOT, ".data/whose-team-candidates.json"), JSON.stringify(CANDIDATES));
const byKind = entries.reduce<Record<string, number>>((acc, e) => ((acc[`${e.kind}${e.kind === "game" ? ` gen ${e.gen}` : ""}`] = (acc[`${e.kind}${e.kind === "game" ? ` gen ${e.gen}` : ""}`] ?? 0) + 1), acc), {});
console.log(`${entries.length} rounds, ${names.length} trainers, ${excluded.length} left out`, byKind);
