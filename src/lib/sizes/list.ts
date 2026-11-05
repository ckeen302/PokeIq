import { HEIGHT_ORDER, inOrder, isHeight, orderCompare, orderInfo, orderNote, orderTitle, type Order } from "./order";
import { DEFAULT_PRESET, PRESET_BY_ID, compareLineup, presetLineup } from "./presets";
import type { SizeItem, SizeKind } from "./types";

/**
 * The table under the 3D view on /pokedex/sizes (and the whole page without
 * WebGL): which figures it lists, in which order, and its compact rows.
 * Pure, so the server renders it for the order in the address and the
 * browser builds the same table when the order changes on the page.
 */

/** Which table: a preset's, a Pokémon's neighbours, or a comparison. */
export interface ListSpec {
  preset: string;
  focus?: string | null;
  vs?: string[];
}

/** One table row, compact on the wire: key, name, kind, Dex number, metres, length?, minimum?, kg, types ("fire/flying"), Pokédex slug, base stats ("45/49/49/65/65/45", "" for none). */
export type ListRow = [key: string, name: string, kind: SizeKind, dex: number, m: number, length: 0 | 1, min: 0 | 1, kg: number | null, types: string, dexSlug: string, stats: string];

const isForm = (i: SizeItem) => i.kind !== "pokemon" && i.kind !== "ref";

/** The full line with every form too (the main page's table), in an order. */
export function everythingLine(all: SizeItem[], order: Order = HEIGHT_ORDER): SizeItem[] {
  const base = presetLineup(DEFAULT_PRESET, all, order);
  const have = new Set(base.map((i) => i.key));
  return [...base, ...all.filter((f) => isForm(f) && !have.has(f.key) && inOrder(f, order))].sort(orderCompare(order));
}

/** A Pokémon's neighbours in an order (and, by height, the adult human), for its own page's table. */
export function neighbourLine(all: SizeItem[], focus: SizeItem, order: Order = HEIGHT_ORDER, n = 12): SizeItem[] {
  const line = everythingLine(all, order);
  const at = line.findIndex((i) => i.key === focus.key);
  const near = line.slice(Math.max(0, at - n), at + n + 1);
  if (!isHeight(order)) return near;
  const human = all.find((i) => i.ref?.kind === "human");
  return !human || near.some((i) => i.key === human.key) ? near : [...near, human].sort(orderCompare(order));
}

/**
 * The order a page can show: a focus without a value in it (a Gigantamax form by weight), or a lineup with nothing
 * to show in it (the Gigantamax lineup by weight), falls back to Height.
 */
export function listOrder(all: SizeItem[], spec: ListSpec, order: Order): Order {
  if (isHeight(order)) return order;
  if (spec.focus) {
    const f = all.find((i) => i.key === spec.focus);
    return f && inOrder(f, order) ? order : HEIGHT_ORDER;
  }
  return listItems(all, spec, order).some((i) => i.kind !== "ref") ? order : HEIGHT_ORDER;
}

/** The figures a table lists, in its order. */
export function listItems(all: SizeItem[], spec: ListSpec, order: Order = HEIGHT_ORDER): SizeItem[] {
  const byKey = new Map(all.map((i) => [i.key, i]));
  const vs = (spec.vs ?? []).flatMap((k) => byKey.get(k) ?? []);
  if (vs.length >= 2) return compareLineup(vs, all, order);
  const focus = spec.focus ? byKey.get(spec.focus) : undefined;
  if (focus) return neighbourLine(all, focus, listOrder(all, spec, order));
  const preset = PRESET_BY_ID.get(spec.preset) ?? DEFAULT_PRESET;
  return preset.id === DEFAULT_PRESET.id ? everythingLine(all, order) : presetLineup(preset, all, order);
}

/** What the order leaves out of this table, as a short note (null when nothing is). */
export function listNote(all: SizeItem[], spec: ListSpec, order: Order): string | null {
  const o = listOrder(all, spec, order);
  if (isHeight(o)) return null;
  return orderNote(listItems(all, spec.focus ? { preset: DEFAULT_PRESET.id } : spec, HEIGHT_ORDER), o);
}

/** The table's name (and the structured data's): "Every Pokémon by Speed", "Pokémon close to Pikachu's Speed". */
export function listCaption(all: SizeItem[], spec: ListSpec, order: Order): string {
  const byKey = new Map(all.map((i) => [i.key, i]));
  const vs = (spec.vs ?? []).flatMap((k) => byKey.get(k) ?? []);
  if (vs.length >= 2) return orderTitle(`${vs.map((i) => i.name).join(" vs ")} by size`, order);
  const focus = spec.focus ? byKey.get(spec.focus) : undefined;
  if (focus) {
    const o = listOrder(all, spec, order);
    return isHeight(o) ? `Pokémon close to ${focus.name}'s size` : `Pokémon close to ${focus.name}'s ${orderInfo(o).label}`;
  }
  return orderTitle((PRESET_BY_ID.get(spec.preset) ?? DEFAULT_PRESET).title, order);
}

/** Compact rows for the table (sent once, rendered on the server and in the browser). */
export function listRows(items: SizeItem[], all: SizeItem[]): ListRow[] {
  const dexSlug = new Map(all.filter((i) => i.kind === "pokemon").map((i) => [i.species, i.key]));
  return items.map((i) => [i.key, i.name, i.kind, i.species, i.m, i.length ? 1 : 0, i.min ? 1 : 0, i.kg, i.types.join("/"), i.kind === "ref" ? "" : i.kind === "pokemon" ? i.key : dexSlug.get(i.species) ?? i.key, i.stats ? i.stats.join("/") : ""]);
}
