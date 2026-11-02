import type { TcgCard, TcgSet } from "@/lib/tcg/types";
import { compareNumber, groupSetsBySeries } from "@/lib/tcg/prices";

/**
 * Previous / next links for the Pokédex detail pages. Everything here is
 * computed on the server from the same arrays (and in the same order) the
 * list tabs show, so only the two neighbour links ever reach the browser.
 * The first and last entries have no link on that side, like the Pokémon pages.
 */

export interface PagerLink {
  href: string;
  label: string;
}

export interface Pager {
  prev: PagerLink | null;
  next: PagerLink | null;
}

export const NO_PAGER: Pager = { prev: null, next: null };

/** The items either side of the first one matching `isCurrent`, or none when it isn't in the list. */
export function neighbours<T>(list: readonly T[], isCurrent: (t: T) => boolean): { prev: T | null; next: T | null } {
  const i = list.findIndex(isCurrent);
  if (i < 0) return { prev: null, next: null };
  return { prev: i > 0 ? list[i - 1] : null, next: i < list.length - 1 ? list[i + 1] : null };
}

/** `neighbours` mapped to links. */
export function pagerFor<T>(list: readonly T[], isCurrent: (t: T) => boolean, toLink: (t: T) => PagerLink): Pager {
  const { prev, next } = neighbours(list, isCurrent);
  return { prev: prev === null ? null : toLink(prev), next: next === null ? null : toLink(next) };
}

/** Places are listed by region, then name: name the region too when a neighbour is in another one. */
export function placeLabel(p: { name: string; region: string }, current: { region: string }): string {
  return p.region === current.region ? p.name : `${p.name} · ${p.region}`;
}

/** TCG sets in the order the TCG tab lists them: grouped by series, newest first. */
export function tcgSetOrder(sets: readonly TcgSet[]): TcgSet[] {
  return groupSetsBySeries([...sets]).flatMap((g) => g.sets);
}

/** A set's cards in the gallery's default order (by card number). */
export function tcgCardOrder<C extends Pick<TcgCard, "number">>(cards: readonly C[]): C[] {
  return [...cards].sort((a, b) => compareNumber(a.number ?? "", b.number ?? ""));
}

export const tcgCardLabel = (c: Pick<TcgCard, "name" | "number">) => (c.number ? `#${c.number} ${c.name}` : c.name);

/** A game's trainer areas in the order its page lists them: region, then kind, then area. */
export function trainerAreaOrder<A>(regions: readonly { groups: readonly { areas: readonly A[] }[] }[]): A[] {
  return regions.flatMap((r) => r.groups.flatMap((g) => g.areas));
}

/** Notable trainers in the Trainers tab's order: grouped by role, directory order within a role. */
export function notableOrder<N extends { role: R }, R>(directory: readonly N[], roleOrder: readonly R[]): N[] {
  return roleOrder.flatMap((role) => directory.filter((n) => n.role === role));
}
