import "server-only";
import { CATEGORIES, type Category } from "@/lib/connections/categories";
import { FACTS, factsOf, type Facts } from "@/lib/connections/facts";
import { CONN_GROUP_SIZE, type ConnTile } from "@/lib/connections/types";
import { Rng } from "@/lib/rng";

/**
 * The puzzle creator's helpers, all from the same computed categories the
 * daily puzzles use:
 * - findLinks: the links (an ability, a type, a move, a colour...) that
 *   match what a creator typed;
 * - suggestGroup: four Pokémon that fit a link and don't also fit any
 *   other group's link;
 * - overlapWarnings: live warnings as tiles are added, for groups that are
 *   still being filled.
 * Creator puzzles are Pokémon-only, so mixed groups are never offered.
 */

export interface LinkOption {
  id: string;
  label: string;
  rule: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Links whose name, id or rule match every word typed (best matches first). */
export function findLinks(q: string, limit = 8): LinkOption[] {
  const words = norm(q).split(" ").filter(Boolean);
  if (!words.length) return [];
  const scored: { c: Category; score: number }[] = [];
  for (const c of CATEGORIES) {
    const label = norm(c.label);
    const id = norm(c.id);
    const hay = `${label} ${id} ${norm(c.rule)}`;
    if (!words.every((w) => hay.includes(w))) continue;
    const text = words.join(" ");
    const score = (label === text ? 6 : 0) + (label.includes(text) ? 4 : 0) + (id.endsWith(text) ? 3 : 0) + words.filter((w) => label.split(" ").includes(w)).length;
    scored.push({ c, score });
  }
  scored.sort((a, b) => b.score - a.score || a.c.label.localeCompare(b.c.label));
  return scored.slice(0, limit).map(({ c }) => ({ id: c.id, label: c.label, rule: c.rule }));
}

/** The links every one of these Pokémon shares (three or more: two share too many by chance). */
function sharedLinks(ids: readonly number[]): Category[] {
  if (ids.length < 3) return [];
  const facts = ids.map(factsOf);
  return CATEGORIES.filter((c) => facts.every((f) => c.test(f)));
}

const clashes = (links: readonly Category[], f: Facts) => links.some((c) => c.test(f) || c.guard?.(f));

export interface Suggestion {
  link: LinkOption;
  tiles: ConnTile[];
  /** Tiles the other groups already have that also fit the link (they'd make it ambiguous). */
  notes: string[];
  /** Fewer than asked for: there aren't enough that don't clash. */
  short: boolean;
}

/**
 * Up to four Pokémon for a group about `linkId` (fewer when `own`, the group's
 * members so far, already has some): all fit the link, none is used, none
 * shares an evolution family with a Pokémon already in the puzzle, and none
 * also fits a link that another group's members all share. `seed` varies
 * the pick ("suggest again").
 */
export function suggestGroup(linkId: string, own: readonly number[], others: readonly (readonly number[])[], seed = 0): Suggestion | null {
  const cat = CATEGORIES.find((c) => c.id === linkId);
  if (!cat) return null;
  const used = new Set([...own, ...others.flat()]);
  const families = new Set([...used].map((id) => factsOf(id).familyKey));
  const otherLinks = others.flatMap((m) => sharedLinks(m)).filter((c) => c.id !== cat.id);
  const need = Math.max(0, CONN_GROUP_SIZE - own.length);
  const fits = FACTS.filter((f) => f.pooled && cat.test(f) && !used.has(f.id) && !families.has(f.familyKey) && !clashes(otherLinks, f));
  const rng = new Rng(`suggest:${linkId}:${seed}`);
  const picked: Facts[] = [];
  for (const f of rng.shuffle(fits)) {
    if (picked.length >= need) break;
    if (picked.some((p) => p.familyKey === f.familyKey)) continue;
    picked.push(f);
  }
  const notes = others.flat().filter((id) => cat.test(factsOf(id))).map((id) => `${factsOf(id).name} is in another group but also fits “${cat.label}”.`);
  return {
    link: { id: cat.id, label: cat.label, rule: cat.rule },
    tiles: picked.map((f) => ({ id: f.id, name: f.name })),
    notes: notes.slice(0, 4),
    short: picked.length < need,
  };
}

export interface LiveGroup {
  name: string;
  members: number[];
}

/**
 * Warnings for a puzzle still being built: for every group with at least
 * three Pokémon, the links they all share and any Pokémon in another group
 * that fits one too; and any evolution family used twice.
 */
export function overlapWarnings(groups: readonly LiveGroup[]): string[] {
  const out: string[] = [];
  const all = groups.flatMap((g) => g.members.map(factsOf));
  const byFamily = new Map<number, string[]>();
  for (const f of all) byFamily.set(f.familyKey, [...(byFamily.get(f.familyKey) ?? []), f.name]);
  for (const names of byFamily.values()) if (names.length > 1) out.push(`${names.join(" and ")} are from one evolution family.`);
  const label = (g: LiveGroup, i: number) => g.name.trim() || `group ${i + 1}`;
  groups.forEach((g, gi) => {
    const links = sharedLinks(g.members);
    if (!links.length) return;
    groups.forEach((o, oi) => {
      if (oi === gi) return;
      for (const id of o.members) {
        const f = factsOf(id);
        const hit = links.find((c) => c.test(f)) ?? links.find((c) => c.guard?.(f));
        if (hit) out.push(`${f.name} (in “${label(o, oi)}”) also fits “${label(g, gi)}”: ${hit.label}.`);
      }
    });
  });
  return [...new Set(out)].slice(0, 12);
}
