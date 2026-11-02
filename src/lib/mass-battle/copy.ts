import type { BattleOutcome, Winner } from "./types";

/**
 * The words around the numbers: answers, results and kill-feed lines.
 * Pokémon names don't take a plural ("48 Magikarp").
 */

export const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export function questionText(challenger: string, boss: string): string {
  return `How many ${challenger} beat ${boss}?`;
}

export function answerText(n: number, challenger: string): string {
  return `It takes ${fmt(n)} ${challenger}`;
}

export function spreadText(spread: number, runs: number): string {
  return `± ${fmt(spread)} over ${fmt(runs)} battles`;
}

export function winRateText(wins: number, runs: number, n: number): string {
  return `${fmt(n)} won ${fmt(wins)} of ${fmt(runs)} battles`;
}

export function noAnswerText(challenger: string, boss: string, cap: number): string {
  return `No army of ${challenger} up to ${fmt(cap)} beats ${boss}`;
}

/** The side's name: its species ("Magikarp", "Rattata and Raticate", "Bulbasaur, Charmander and Squirtle", or "Fire types…" for presets). */
export function armyName(names: string[], label?: string): string {
  if (label) return label;
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.slice(0, 2).join(", ")} and more`;
}

export function resultTitle(winner: Winner, names: [string, string], left: [number, number]): string {
  if (winner === 2) return "It's a draw";
  const w = names[winner];
  const one = left[winner] === 1;
  return `${w} ${one && !/ and /.test(w) ? "wins" : "win"}!`;
}

export function resultLine(o: BattleOutcome, names: [string, string]): string {
  if (o.winner === 2) return `Time ran out after ${o.seconds.toFixed(0)} seconds with both sides standing.`;
  const loser = names[1 - o.winner];
  return `${fmt(o.left[o.winner])} left standing after ${o.seconds.toFixed(1)} s · ${loser} KO'd ${fmt(o.kos[1 - o.winner])}`;
}

/** "Arceus' Earthquake KO'd 48 Magikarp". */
export function multiKoLine(actor: string, move: string, kos: number, target: string): string {
  const owner = /s$/i.test(actor) ? `${actor}'` : `${actor}'s`;
  return `${owner} ${move} KO'd ${fmt(kos)} ${target}`;
}

export function critLine(actor: string, move: string, target: string): string {
  const owner = /s$/i.test(actor) ? `${actor}'` : `${actor}'s`;
  return `Critical hit! ${owner} ${move} on ${target}`;
}

export function bossDownLine(actor: string, move: string, boss: string): string {
  const owner = /s$/i.test(actor) ? `${actor}'` : `${actor}'s`;
  return `${owner} ${move} knocked out ${boss}!`;
}
