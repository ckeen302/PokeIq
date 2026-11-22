import type { QuizLang } from "../i18n";
import { must } from "../localize";

/**
 * The names trivia questions are written with, in another language. Each throws through `must` when the language
 * has no official name for it (the question is then swapped), except the `…Option` forms, which return undefined for
 * one option so that only the options shown need a name.
 */

export const personIn = (L: QuizLang, name: string, context: "games" | "anime" = "games") => must(L.proper(name, context), name);
export const gameIn = (L: QuizLang, title: string) => must(L.game(title), title);
export const regionIn = (L: QuizLang, region: string) => must(L.name("regions", region), region);
export const placeIn = (L: QuizLang, place: string) => must(L.name("locations", place) ?? L.proper(place), place);
/** A type from its English name ("Fire"). */
export const typeIn = (L: QuizLang, type: string) => L.type(type.toLowerCase());
export const genIn = (L: QuizLang, gen: number) => L.t("trivia.gen", { n: gen });
/** "Generation III" → the language's label (the options of "which generation" questions). */
export const genOption = (L: QuizLang, label: string) => {
  const roman = label.replace(/^Generation /, "");
  const n = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"].indexOf(roman);
  return n > 0 ? genIn(L, n) : undefined;
};

/** Any proper name an option may be: a Pokémon, a person or team, an item, a move, a place, a region, a game. */
export function anyName(L: QuizLang, english: string, context: "games" | "anime" = "games"): string | undefined {
  const found =
    L.pokemonNamed(english) ??
    L.proper(english, context) ??
    L.name("items", english) ??
    L.name("moves", english) ??
    L.name("locations", english) ??
    L.name("regions", english) ??
    L.game(english);
  if (found) return found;
  // "HM04 Strength": the machine and its move.
  const hm = /^HM(\d\d) (.+)$/.exec(english);
  if (hm) {
    const move = L.name("moves", hm[2]);
    return move && L.t("trivia.hm", { n: hm[1], move });
  }
  // "Cheren and Bianca", "Hitmonlee or Hitmonchan": both names, joined as the language does.
  const pair = /^(.+) (and|or) (.+)$/.exec(english);
  if (pair) {
    const a = anyName(L, pair[1], context);
    const b = anyName(L, pair[3], context);
    return a && b ? (pair[2] === "and" ? L.and([a, b]) : L.or([a, b])) : undefined;
  }
  return undefined;
}
