/**
 * Pokémon Sizes (/pokedex/sizes): the shared, client-safe model. Every
 * figure on the line is a SizeItem: a Pokémon (default form or a Mega,
 * Gigantamax, regional or Eternamax form) or a real-world scale reference.
 * Sizes are the documented numbers only (lib/sizes/data builds them from
 * the Pokédex, PokéAPI form data and sourced references).
 */

export type SizeKind = "pokemon" | "mega" | "gmax" | "regional" | "eternamax" | "ref";
export type RefKind = "phone" | "human" | "car" | "bus" | "house" | "building" | "whale" | "trainer";

export interface SizeItem {
  /** Unique slug: the Pokémon's or form's PokéAPI name, or "ref-<id>". */
  key: string;
  name: string;
  kind: SizeKind;
  /** National Dex number (0 for references). */
  species: number;
  /** PokéAPI id of the HOME render (the species id, or the form's 10xxx id; 0 for references). */
  art: number;
  /** The documented size in metres: a height, or a length when `length`. */
  m: number;
  /** Scaled by its longest side and labelled "(Length)". */
  length: boolean;
  /** A minimum ("28 m+"): Gigantamax forms. */
  min: boolean;
  /** Proportions of the visible figure (art bounding box, or the reference model): width and height in any unit. */
  bw: number;
  bh: number;
  /** The HOME render's visible box: left and top (px) in an image `bs` px square (0 for references). */
  bx: number;
  by: number;
  bs: number;
  /** Types in slot order ("fire", "flying"); none for references. */
  types: string[];
  gen: number;
  legendary: boolean;
  mythical: boolean;
  /** Weight in kg when documented (not for Gigantamax / Eternamax, whose weight is unknown). */
  kg: number | null;
  /** Evolution chain id (0 for references). */
  chain: number;
  /** A reference's model and source. */
  ref?: { kind: RefKind; detail?: string; source: string; url: string; fact: string; presets?: string[] };
}

/** The compact wire format of /api/sizes (one row per item). */
export type SizeRow = [key: string, name: string, kind: SizeKind, species: number, art: number, m: number, flags: number, bw: number, bh: number, gen: number, kg: number | null, chain: number, box: [bx: number, by: number, bs: number], types: string, ref: RefKind | 0];
export const F_LENGTH = 1, F_MIN = 2, F_LEGEND = 4, F_MYTH = 8;

export function toRow(i: SizeItem): SizeRow {
  const flags = (i.length ? F_LENGTH : 0) | (i.min ? F_MIN : 0) | (i.legendary ? F_LEGEND : 0) | (i.mythical ? F_MYTH : 0);
  return [i.key, i.name, i.kind, i.species, i.art, i.m, flags, i.bw, i.bh, i.gen, i.kg, i.chain, [i.bx, i.by, i.bs], i.types.join("/"), i.ref?.kind ?? 0];
}
/** A row back to an item (a reference's source details stay on the server; the kind is kept for its model). */
export function fromRow(r: SizeRow): SizeItem {
  const [key, name, kind, species, art, m, flags, bw, bh, gen, kg, chain, [bx, by, bs], types, ref] = r;
  return {
    key, name, kind, species, art, m, length: !!(flags & F_LENGTH), min: !!(flags & F_MIN), bw, bh, bx, by, bs, types: types ? types.split("/") : [], gen,
    legendary: !!(flags & F_LEGEND), mythical: !!(flags & F_MYTH), kg, chain,
    ...(ref ? { ref: { kind: ref, source: "", url: "", fact: "" } } : {}),
  };
}

/**
 * The "(Length)" rule: a serpentine or fish-shaped Pokémon (PokéAPI shape
 * "squiggle" or "fish") whose art is wider than it is tall is measured, and
 * scaled, along its longest side. Everything else is scaled by height.
 */
export function isLength(shape: string | null | undefined, boxW: number, boxH: number): boolean {
  return (shape === "squiggle" || shape === "fish") && boxW > boxH;
}

/** World size of a figure in metres: the documented size along its height, or along its longest side for a length. */
export function dims(i: Pick<SizeItem, "m" | "length" | "bw" | "bh">): { w: number; h: number } {
  const a = i.bw / i.bh;
  if (i.length) return a >= 1 ? { w: i.m, h: i.m / a } : { w: i.m * a, h: i.m };
  return { w: i.m * a, h: i.m };
}

const trim = (n: number, dp: number) => {
  const s = n.toFixed(dp);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
};

/** "14.5 m", "0.1 m", "100 m", "1.71 m". */
export function formatMetres(m: number): string {
  return `${trim(m, m < 10 ? 2 : 1)} m`;
}

/** "47 ft 7 in", "4 in", "328 ft 1 in". */
export function formatFeet(m: number): string {
  const inches = Math.round(m / 0.0254);
  const ft = Math.floor(inches / 12);
  const inch = inches - ft * 12;
  if (!ft) return `${inch} in`;
  return inch ? `${ft} ft ${inch} in` : `${ft} ft`;
}

/** The label's size line: "14.5 m / 47 ft 7 in", with "+" on a minimum (Gigantamax). */
export function formatSize(i: Pick<SizeItem, "m" | "min">): string {
  const plus = i.min ? "+" : "";
  return `${formatMetres(i.m)}${plus} / ${formatFeet(i.m)}${plus}`;
}

/** "(Length)" or "(Height)". */
export const measureOf = (i: Pick<SizeItem, "length">) => (i.length ? "Length" : "Height");

export const KIND_LABEL: Record<SizeKind, string> = {
  pokemon: "Pokémon",
  mega: "Mega Evolution",
  gmax: "Gigantamax",
  regional: "Regional form",
  eternamax: "Eternamax",
  ref: "Real-world size",
};

/** Ascending by size, then Dex order, so the line always reads small to large. */
export function bySize(a: SizeItem, b: SizeItem): number {
  return a.m - b.m || (a.species || 1e4) - (b.species || 1e4) || a.key.localeCompare(b.key);
}

/** Space between neighbours on the line: a share of the bigger one, so small and huge figures both breathe. */
export function gapBetween(a: { w: number; h: number }, b: { w: number; h: number }): number {
  return 0.16 * Math.max(a.h, b.h, a.w * 0.6, b.w * 0.6) + 0.04;
}

/** Centre x of each figure on the line (metres), standing in order from x = 0. */
export function layoutLine(items: Pick<SizeItem, "m" | "length" | "bw" | "bh">[]): { x: number; w: number; h: number }[] {
  const out: { x: number; w: number; h: number }[] = [];
  let edge = 0;
  for (let i = 0; i < items.length; i++) {
    const d = dims(items[i]);
    const prev = out[i - 1];
    const x = prev ? edge + gapBetween(prev, d) + d.w / 2 : d.w / 2;
    out.push({ x, w: d.w, h: d.h });
    edge = x + d.w / 2;
  }
  return out;
}
