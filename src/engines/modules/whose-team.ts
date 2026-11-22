import type { Rng } from "@/lib/rng";
import ROUNDS from "@/data/trainer-teams.json";
import { toRomaji } from "wanakana";
import { ANSWER_NAMES, TRAINER_NAMES, monLabel, revealOrder, teamKey, type TeamEntry, type TeamMon } from "@/lib/whose-team";
import type { GenerateOptions, Question, QuestionBuilder } from "../types";
import type { QuizLang } from "../i18n";
import { localizable, must } from "../localize";

/**
 * Whose Team Is This? — a famous trainer's team, name the trainer. The guess
 * is typed, autocompleting over every trainer with a round (`options`, the
 * same list for every question, so it says nothing about the answer).
 *
 * Normal shows the whole team in party order. Hard (`difficulty: "hard"`)
 * puts the team in reveal order, ace last, and serves only the first card:
 * the session layer hands out the rest one at a time (see `reveal`).
 *
 * The rounds (src/data/trainer-teams.json) are built and checked by
 * scripts/whose-team/build.ts; this file only picks from them.
 */

export const TEAM_ROUNDS = ROUNDS as TeamEntry[];

/** Ids for the session's `used` set: clear of the Pokédex ids other modes use. */
const USED_OFFSET = 300_000;
const SIBLINGS = new Map<string, number[]>();
TEAM_ROUNDS.forEach((r, i) => {
  // The same trainer with the same Pokémon (Lorelei in Red, Yellow and FireRed): one per run.
  const k = `${r.trainer}|${teamKey(r.team)}`;
  SIBLINGS.set(k, [...(SIBLINGS.get(k) ?? []), i]);
});

/** Prior difficulty: the anime and Gens I–IV are the most familiar; Hard starts with a single Pokémon. */
function rating(r: TeamEntry, hard: boolean): number {
  const base = r.kind === "anime" ? 1150 : r.gen <= 2 ? 1100 : r.gen <= 4 ? 1180 : 1260;
  return base + (hard ? 160 : 0);
}

export function roundsFor(opts: Pick<GenerateOptions, "gens" | "scope">): number[] {
  const gens = opts.gens?.length ? new Set(opts.gens) : null;
  const out: number[] = [];
  TEAM_ROUNDS.forEach((r, i) => {
    if (gens && !gens.has(r.gen)) return;
    if (opts.scope === "games" && r.kind !== "game") return;
    if (opts.scope === "anime" && r.kind !== "anime") return;
    out.push(i);
  });
  return out;
}

export function teamQuestion(r: TeamEntry, hard: boolean): Question {
  const team = hard ? revealOrder(r) : r.team;
  const q: Question = {
    itemKey: `whose-team:${r.id}${hard ? ":hard" : ""}`,
    module: "whose-team",
    prompt: "Whose team is this?",
    cards: team.map((m) => ({ pokemonId: m.art ?? m.dex, label: monLabel(m) })),
    options: ANSWER_NAMES,
    answer: r.trainer,
    explanation: [r.appearance, r.variant].filter(Boolean).join(" · "),
    source: r.source,
    rating: rating(r, hard),
    input: "type",
    ...(hard && { reveal: 1 }),
  };
  return localizable(q, (L) => {
    const names = answerNames(L);
    return {
      prompt: L.t("team.prompt"),
      cards: team.map((m) => ({ pokemonId: m.art ?? m.dex, label: monIn(L, m) })),
      options: names.options,
      answer: names.options[ANSWER_NAMES.indexOf(r.trainer)],
      optionAliases: names.aliases,
      explanation: appearanceIn(L, r),
    };
  });
}

/** Form labels in the language (the team cards say "Ninetales (Alolan)"). */
const FORM_KEY: Record<string, "alolan" | "galarian" | "midnight" | "lowKey"> = { Alolan: "alolan", Galarian: "galarian", Midnight: "midnight", "Low Key": "lowKey" };

function monIn(L: QuizLang, m: TeamMon): string {
  const name = must(L.pokemon(m.dex), m.species);
  if (!m.form) return name;
  return L.t(`team.form.${must(FORM_KEY[m.form], m.form)}`, { name });
}

/**
 * Every trainer's name in the language, in the English order, with the other spellings the guess box takes: the
 * English name and its aliases, and in Japanese the rōmaji. Two trainers the language names alike (Italian's Grant
 * and Wally are both Lino) are told apart by their English names.
 */
const namesCache = new Map<string, { options: string[]; aliases: string[][] }>();
function answerNames(L: QuizLang): { options: string[]; aliases: string[][] } {
  const cached = namesCache.get(L.locale);
  if (cached) return cached;
  const own = TRAINER_NAMES.map((n) => must(L.proper(n.name), n.name));
  const count = new Map<string, number>();
  own.forEach((n) => count.set(n, (count.get(n) ?? 0) + 1));
  const options = own.map((n, i) => (count.get(n)! > 1 && n !== TRAINER_NAMES[i].name ? `${n} (${TRAINER_NAMES[i].name})` : n));
  const aliases = TRAINER_NAMES.map((n, i) => {
    const out = new Set([n.name, ...(n.aliases ?? [])]);
    if (L.locale === "ja") out.add(toRomaji(own[i]));
    out.delete(options[i]);
    return [...out];
  });
  const names = { options, aliases };
  namesCache.set(L.locale, names);
  return names;
}

/** The roles an appearance starts with ("Gym Leader, Pewter City (Gym)"). */
const ROLE_KEY: Record<string, "gymLeader" | "eliteFour" | "champion" | "rival" | "boss" | "battle" | "kahuna"> = {
  "Gym Leader": "gymLeader",
  "Elite Four": "eliteFour",
  Champion: "champion",
  "Champion battle": "champion",
  "Rival battle": "rival",
  "Boss battle": "boss",
  Battle: "battle",
  Kahuna: "kahuna",
};
const REGIONS = ["Kanto", "Johto", "Hoenn", "Sinnoh", "Unova", "Kalos", "Alola", "Galar", "Paldea"];

/**
 * Where the team is from, in the language: the game and the trainer's role there (and the place when the language
 * data names it), or, for the anime, the series' region. Shorter than the English, never different.
 */
function appearanceIn(L: QuizLang, r: TeamEntry): string {
  const [where, what = ""] = r.appearance.split(" — ");
  let text: string;
  if (r.kind === "anime") {
    const region = REGIONS.find((g) => r.appearance.includes(`(${g}`) || r.appearance.includes(` ${g})`));
    text = region ? L.t("team.animeIn", { region: must(L.name("regions", region), region) }) : L.t("team.anime");
  } else {
    const game = must(L.game(where), where);
    const parts = what.split(", ");
    const role = ROLE_KEY[parts[0]];
    if (!role) {
      text = game;
    } else {
      const rematch = parts.some((p) => /^rematch/i.test(p));
      const placeText = parts.find((p, i) => i > 0 && !/^rematch/i.test(p))?.replace(/\s*\(.*\)$/, "");
      const place = placeText ? L.name("locations", placeText) : undefined;
      const label = L.t(`team.role.${role}`);
      text = L.t("team.gameRole", { game, role: rematch ? L.t("team.rematch", { role: label }) : label, place: place ?? "", hasPlace: place ? "yes" : "no" });
    }
  }
  const chose = /^Player chose (.+)$/.exec(r.variant ?? "");
  return chose ? `${text}${L.t("team.sep")}${L.t("team.chose", { name: must(L.pokemonNamed(chose[1]), chose[1]) })}` : text;
}

export const whoseTeam: QuestionBuilder = (rng: Rng, opts: GenerateOptions): Question | null => {
  const open = roundsFor(opts).filter((i) => !opts.used.has(USED_OFFSET + i));
  if (open.length === 0) return null;
  const i = rng.pick(open);
  const r = TEAM_ROUNDS[i];
  for (const j of SIBLINGS.get(`${r.trainer}|${teamKey(r.team)}`) ?? [i]) opts.used.add(USED_OFFSET + j);
  return teamQuestion(r, opts.difficulty === "hard");
};
