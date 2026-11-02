import { formatMetres, type SizeItem } from "./types";

/**
 * Fun-fact captions for the pauses in a glide and in videos. Every caption
 * is worked out from the documented numbers on the line (sizes, the
 * Pokédex weight, the references' sourced sizes); nothing is made up.
 */

const times = (k: number) => (k >= 10 ? `${Math.round(k)}×` : `${(Math.round(k * 10) / 10).toString()}×`);

/** One caption for a figure, comparing it with the references (and the smallest figure) in the line. */
export function factFor(item: SizeItem, line: SizeItem[]): string | null {
  if (item.kind === "ref") return item.ref?.fact ?? null;
  const refs = line.filter((i) => i.kind === "ref" && !i.ref?.presets).sort((a, b) => b.m - a.m);
  const verb = item.length ? "long" : "tall";
  const plus = item.min ? " at least" : "";
  // The biggest reference it beats.
  const beaten = refs.find((r) => r.m < item.m && r.ref?.kind !== "human");
  const human = refs.find((r) => r.ref?.kind === "human");
  if (item.kind === "eternamax" || (beaten && item.m / beaten.m >= 1.15 && beaten.m >= 4)) {
    const r = beaten ?? human;
    if (r) {
      const k = item.m / r.m;
      if (k >= 1.15) return `${item.name} is${plus} ${times(k)} the size of a ${r.name.toLowerCase()}`;
    }
  }
  if (human && item.m >= human.m * 1.3) return `${item.name} is${plus} ${times(item.m / human.m)} as ${verb} as an adult human`;
  if (human && item.m <= human.m / 3) {
    const k = human.m / item.m;
    return `You are ${times(k)} as tall as ${item.name}`;
  }
  if (item.kg != null && item.kg > 0) return `${item.name} weighs ${item.kg.toLocaleString("en-US")} kg (${Math.round(item.kg * 2.20462).toLocaleString("en-US")} lb)`;
  return `${item.name} is ${formatMetres(item.m)} ${verb}`;
}

/** The smallest-vs-largest caption for the end of a line. */
export function spanFact(line: SizeItem[]): string | null {
  const mons = line.filter((i) => i.kind !== "ref");
  if (mons.length < 2) return null;
  const small = mons.reduce((a, b) => (b.m < a.m ? b : a));
  const big = mons.reduce((a, b) => (b.m > a.m ? b : a));
  const k = big.m / small.m;
  if (k < 1.5) return null;
  return `${big.name} is ${times(k)} the size of ${small.name}`;
}
