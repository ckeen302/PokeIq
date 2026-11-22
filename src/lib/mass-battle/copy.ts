import { translator, type Translator } from "@/i18n/catalog";
import { localNum } from "@/lib/games/events";
import mbCopy from "@/messages/mass-battle-copy";
import type { ArmySpec, BattleOutcome, GroupRule, Winner } from "./types";

/**
 * The words around the numbers: answers, results and kill-feed lines.
 * Pokémon names don't take a plural ("48 Magikarp"). Each takes the page's
 * mass-battle-copy translator (English when left out).
 */

export type CopyT = Translator<typeof mbCopy.en>;

/** A whole number as the language writes it ("1,234"; "1.234" in German). */
export const fmt = (n: number, locale = "en") => localNum(Math.round(n).toLocaleString("en-US"), locale);

export function questionText(challenger: string, boss: string, t: CopyT = translator(mbCopy, "en", undefined)): string {
  return t("question", { challenger, boss });
}

export function answerText(n: number, challenger: string, t: CopyT = translator(mbCopy, "en", undefined)): string {
  return t("answer", { n: fmt(n, t.locale), challenger });
}

export function spreadText(spread: number, runs: number, t: CopyT = translator(mbCopy, "en", undefined)): string {
  return t("spread", { spread: fmt(spread, t.locale), runs: fmt(runs, t.locale) });
}

export function winRateText(wins: number, runs: number, n: number, t: CopyT = translator(mbCopy, "en", undefined)): string {
  return t("winRate", { n: fmt(n, t.locale), wins: fmt(wins, t.locale), runs: fmt(runs, t.locale) });
}

export function noAnswerText(challenger: string, boss: string, cap: number, t: CopyT = translator(mbCopy, "en", undefined)): string {
  return t("noAnswer", { challenger, boss, cap: fmt(cap, t.locale) });
}

/** The side's name: its species ("Magikarp", "Rattata and Raticate", "Bulbasaur, Charmander and Squirtle", or "Fire types…" for presets). */
export function armyName(names: string[], label?: string, t: CopyT = translator(mbCopy, "en", undefined)): string {
  if (label) return label;
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return t("two", { a: names[0], b: names[1] });
  if (names.length === 3) return t("three", { a: names[0], b: names[1], c: names[2] });
  return t("more", { a: names[0], b: names[1] });
}

/** A group's short name: "Fire types", "Water/Flying types", "Legendaries", "Gen 1 Pokémon" (types by `typeName`, capitalised English by default). */
export function groupName(g: GroupRule, t: CopyT = translator(mbCopy, "en", undefined), typeName?: (type: string) => string): string {
  const cap = (x: string) => typeName?.(x) ?? x[0].toUpperCase() + x.slice(1);
  if (g.types?.length) return t("group.types", { types: g.types.map(cap).join("/") });
  if (g.legendary === true && g.mythical) return t("group.legendariesMythicals");
  if (g.legendary === true) return t("group.legendaries");
  if (g.mythical) return t("group.mythicals");
  if (g.gen) return t("group.gen", { gen: g.gen });
  return t(g.fullyEvolved ? "group.fullyEvolved" : "group.pokemon");
}

/** An army's name from its rows (a group by its short name). */
export function sideName(army: Pick<ArmySpec, "units">, nameOf: (id: number) => string, label?: string, t: CopyT = translator(mbCopy, "en", undefined), typeName?: (type: string) => string): string {
  return armyName(army.units.map((u) => (u.group ? groupName(u.group, t, typeName) : nameOf(u.id))), label, t);
}

export function resultTitle(winner: Winner, names: [string, string], left: [number, number], t: CopyT = translator(mbCopy, "en", undefined)): string {
  if (winner === 2) return t("draw");
  const w = names[winner];
  const one = left[winner] === 1;
  return t(one && !/ and /.test(w) ? "winsOne" : "winsMany", { w });
}

export function resultLine(o: BattleOutcome, names: [string, string], t: CopyT = translator(mbCopy, "en", undefined)): string {
  if (o.winner === 2) return t("timeUp", { s: o.seconds.toFixed(0) });
  const loser = names[1 - o.winner];
  return t("resultLine", { n: fmt(o.left[o.winner], t.locale), s: localNum(o.seconds.toFixed(1), t.locale), loser, kos: fmt(o.kos[1 - o.winner], t.locale) });
}

/** "Arceus'", "Mewtwo's". */
export const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

/** The actor as a kill-feed line names it: English's possessive, the name itself in other languages (their lines place it). */
const pos = (actor: string, t: CopyT) => (t.locale === "en" ? possessive(actor) : actor);

/** "Arceus' Earthquake KO'd 48 Magikarp". */
export function multiKoLine(actor: string, move: string, kos: number, target: string, t: CopyT = translator(mbCopy, "en", undefined)): string {
  return t("multiKo", { pos: pos(actor, t), move, n: fmt(kos, t.locale), target });
}

export function critLine(actor: string, move: string, target: string, t: CopyT = translator(mbCopy, "en", undefined)): string {
  return t("crit", { pos: pos(actor, t), move, target });
}

export function bossDownLine(actor: string, move: string, boss: string, t: CopyT = translator(mbCopy, "en", undefined)): string {
  return t("bossDown", { pos: pos(actor, t), move, boss });
}
