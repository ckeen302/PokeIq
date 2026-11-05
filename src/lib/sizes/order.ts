import { bySize, formatMetres, type SizeItem } from "./types";

/**
 * "Order by" on /pokedex/sizes: the line can stand in order of height (the
 * default), weight, any base stat or the base stat total, lowest or highest
 * first. Every figure still stands at its real size; only the order
 * changes. Values are the documented ones only: a figure without one (a
 * Gigantamax form has no listed weight; a real-world reference has no
 * stats) is left out of that order, never given a guessed or borrowed
 * number, and the references stand in the Height order only. Ties go by
 * National Dex number, then name. Client-safe and unit-tested.
 */

export type OrderKey = "height" | "weight" | "hp" | "atk" | "def" | "spa" | "spd" | "spe" | "bst";
export type OrderDir = "asc" | "desc";
export interface Order {
  by: OrderKey;
  dir: OrderDir;
}

export const HEIGHT_ORDER: Order = { by: "height", dir: "asc" };

export interface OrderInfo {
  key: OrderKey;
  /** The control's label: "Sp. Atk". */
  label: string;
  /** The label where room is short (the order menu's grid): "Stat total". */
  short: string;
  /** In the address: ?by=sp-atk. */
  param: string;
  /** In a title: "Every Pokémon by Sp. Atk". */
  hook: string;
  /** Lowest first, highest first: "Slowest first". */
  low: string;
  high: string;
  /** Comparing up: "faster than". */
  more: string;
  /** In the list's note: "a listed weight". */
  missing: string;
}

const STAT = (key: OrderKey, label: string, param: string, hook = label, short = label): OrderInfo => ({ key, label, short, param, hook, low: "Lowest", high: "Highest", more: "higher than", missing: "listed base stats" });

export const ORDERS: OrderInfo[] = [
  { key: "height", label: "Height", short: "Height", param: "height", hook: "size", low: "Smallest", high: "Largest", more: "bigger than", missing: "a listed height" },
  { key: "weight", label: "Weight", short: "Weight", param: "weight", hook: "Weight", low: "Lightest", high: "Heaviest", more: "heavier than", missing: "a listed weight" },
  STAT("hp", "HP", "hp"),
  STAT("atk", "Attack", "attack"),
  STAT("def", "Defense", "defense"),
  STAT("spa", "Sp. Atk", "sp-atk"),
  STAT("spd", "Sp. Def", "sp-def"),
  { ...STAT("spe", "Speed", "speed"), low: "Slowest", high: "Fastest", more: "faster than" },
  STAT("bst", "Base stat total", "bst", "Base Stat Total", "Stat total"),
];
export const ORDER_INFO = new Map(ORDERS.map((o) => [o.key, o])) as Map<OrderKey, OrderInfo>;
export const orderInfo = (o: Order | OrderKey) => ORDER_INFO.get(typeof o === "string" ? o : o.by)!;

const STAT_INDEX: Partial<Record<OrderKey, number>> = { hp: 0, atk: 1, def: 2, spa: 3, spd: 4, spe: 5 };

/** Other spellings an address may use (?by=spe, ?by=total…). */
const ALIASES: Record<string, OrderKey> = {
  size: "height", height: "height", weight: "weight", kg: "weight", hp: "hp",
  attack: "atk", atk: "atk", defense: "def", defence: "def", def: "def",
  "sp-atk": "spa", spa: "spa", "special-attack": "spa", spatk: "spa",
  "sp-def": "spd", spd: "spd", "special-defense": "spd", spdef: "spd",
  speed: "spe", spe: "spe", bst: "bst", total: "bst", "base-stat-total": "bst", stats: "bst",
};

export const isHeight = (o: Order) => o.by === "height";
/** The camera framing an order needs (lib/sizes/glide): sizes grow smoothly in Height, jump about in any other order. */
export const framingFor = (o: Order): "size" | "mixed" => (isHeight(o) ? "size" : "mixed");
/** Where the line meets the ring round Prism Tower (lib/sizes/world): a line that grows circles it from its first giant; any other only for a tail of giants. */
export const ringRuleFor = (o: Order): "first-big" | "tail" => (o.by === "height" && o.dir === "asc" ? "first-big" : "tail");
export const isDefaultOrder = (o: Order) => o.by === "height" && o.dir === "asc";
export const sameOrder = (a: Order, b: Order) => a.by === b.by && a.dir === b.dir;

/** The order an address asks for (?by=speed&dir=desc); anything unknown is Height, smallest first. */
export function parseOrder(by: string | string[] | null | undefined, dir?: string | string[] | null): Order {
  const one = (v: string | string[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const key = ALIASES[one(by).trim().toLowerCase().replace(/[\s_.]+/g, "-").replace(/-+/g, "-")] ?? "height";
  return { by: key, dir: one(dir).trim().toLowerCase() === "desc" ? "desc" : "asc" };
}

/** The address's query for an order: "" for Height (smallest first), else "by=speed" or "by=speed&dir=desc". */
export function orderQuery(o: Order): string {
  if (isDefaultOrder(o)) return "";
  return `by=${orderInfo(o).param}${o.dir === "desc" ? "&dir=desc" : ""}`;
}

/** A path with the order's query added (it may already have one: ?vs=). */
export function withOrder(path: string, o: Order): string {
  const q = orderQuery(o);
  if (!q) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${q}`;
}

/** The internal route segment an order is rendered at ("speed", "speed-desc"): next.config rewrites ?by= to it. */
export const orderSegment = (o: Order) => `${orderInfo(o).param}${o.dir === "desc" ? "-desc" : ""}`;
export function parseOrderSegment(seg: string): Order | null {
  const desc = seg.endsWith("-desc");
  const param = desc ? seg.slice(0, -5) : seg;
  const info = ORDERS.find((o) => o.param === param);
  return info ? { by: info.key, dir: desc ? "desc" : "asc" } : null;
}
/** Every order but the default, as route segments. */
export const ORDER_SEGMENTS = ORDERS.flatMap((o) => (["asc", "desc"] as const).map((dir) => ({ by: o.key, dir }))).filter((o) => !isDefaultOrder(o)).map(orderSegment);

/** A figure's value in an order, or null when it has none (it is then left out of that order). */
export function orderValue(i: SizeItem, by: OrderKey): number | null {
  if (by === "height") return i.m;
  // The references are real-world sizes: they stand in the Height order only.
  if (i.kind === "ref") return null;
  if (by === "weight") return i.kg != null && i.kg > 0 ? i.kg : null;
  if (!i.stats) return null;
  if (by === "bst") return i.stats.reduce((a, b) => a + b, 0);
  return i.stats[STAT_INDEX[by]!] ?? null;
}

export const inOrder = (i: SizeItem, o: Order) => orderValue(i, o.by) !== null;

/** The line's comparator: Height smallest first is exactly `bySize`; every other order breaks ties by Dex number, then name. */
export function orderCompare(o: Order): (a: SizeItem, b: SizeItem) => number {
  if (isDefaultOrder(o)) return bySize;
  const sign = o.dir === "desc" ? -1 : 1;
  const ties = (a: SizeItem, b: SizeItem) => (a.species || 1e4) - (b.species || 1e4) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
  return (a, b) => sign * ((orderValue(a, o.by) ?? 0) - (orderValue(b, o.by) ?? 0)) || ties(a, b);
}

/** The figures that have a value in the order, in that order. */
export function orderItems(items: SizeItem[], o: Order): SizeItem[] {
  return items.filter((i) => inOrder(i, o)).sort(orderCompare(o));
}

/** Pokémon and forms of a set that an order leaves out (references aside), and whether references were dropped. */
export function orderLeftOut(items: SizeItem[], o: Order): { forms: SizeItem[]; refs: boolean } {
  if (isHeight(o)) return { forms: [], refs: false };
  return { forms: items.filter((i) => i.kind !== "ref" && !inOrder(i, o)), refs: items.some((i) => i.kind === "ref") };
}

/** The list's note on what an order leaves out ("Forms without a listed weight are left out."), or null. */
export function orderNote(items: SizeItem[], o: Order): string | null {
  const { forms, refs } = orderLeftOut(items, o);
  const parts: string[] = [];
  if (forms.length) parts.push(`Forms without ${orderInfo(o).missing} are left out.`);
  if (refs) parts.push("Real-world sizes stand in the Height order only.");
  return parts.length ? parts.join(" ") : null;
}

const kgText = (kg: number) => `${kg.toLocaleString("en-US", { maximumFractionDigits: 1 })} kg`;
const lbText = (kg: number) => `${Math.round(kg * 2.20462).toLocaleString("en-US")} lb`;

/** The value as shown: "460 kg", "130", "1.7 m". */
export function orderValueText(i: SizeItem, o: Order): string | null {
  const v = orderValue(i, o.by);
  if (v === null) return null;
  if (o.by === "height") return `${formatMetres(v)}${i.min ? "+" : ""}`;
  if (o.by === "weight") return kgText(v);
  return String(v);
}

/** The labelled value for captions and the bottom bar: "Weight 460 kg", "Speed 130" (null in the Height order, whose size is always shown). */
export function orderTag(i: SizeItem, o: Order): string | null {
  if (isHeight(o)) return null;
  const t = orderValueText(i, o);
  return t === null ? null : `${orderInfo(o).label} ${t}`;
}

/** The badge's second box in a stat or weight order: the number, what it is, and a line under it. */
export function badgeStat(i: SizeItem, o: Order): { num: string; unit: string; sub: string } | null {
  if (isHeight(o)) return null;
  const v = orderValue(i, o.by);
  if (v === null) return null;
  if (o.by === "weight") return { num: v.toLocaleString("en-US", { maximumFractionDigits: 1 }), unit: "kg weight", sub: lbText(v) };
  if (o.by === "bst") return { num: String(v), unit: "base total", sub: "base stats" };
  return { num: String(v), unit: orderInfo(o).label.toLowerCase(), sub: "base stat" };
}

/** The direction toggle's words for an order: "Slowest first" / "Fastest first". */
export const dirLabel = (by: OrderKey, dir: OrderDir) => `${dir === "desc" ? orderInfo(by).high : orderInfo(by).low} first`;


/**
 * A lineup's title in an order: "Every Pokémon by size 😳" becomes "Every
 * Pokémon by Speed 😳" ("…, fastest first" when highest first); a title
 * without "by size" gets ", by Speed". Height smallest first keeps the title.
 */
export function orderTitle(title: string, o: Order): string {
  if (isDefaultOrder(o)) return title;
  const m = title.match(/^(.*?)((?:\s*[\p{Extended_Pictographic}‍️])*)$/u);
  const body = m?.[1] ?? title, tail = m?.[2] ?? "";
  const by = `by ${orderInfo(o).hook}${o.dir === "desc" ? `, ${orderInfo(o).high.toLowerCase()} first` : ""}`;
  const out = / by size\b/.test(body) ? body.replace(/ by size\b/, ` ${by}`) : `${body}, ${by}`;
  return `${out}${tail}`;
}

/** The hook card's range line: "0.1 m to 100 m" in Height, "Speed 5 to 200" otherwise (first to last of the line). */
export function orderRange(line: SizeItem[], o: Order): string | null {
  const mons = line.filter((i) => i.kind !== "ref");
  if (!mons.length) return null;
  const first = mons[0], last = mons[mons.length - 1];
  if (isHeight(o)) return `${formatMetres(first.m)}${first.min ? "+" : ""} to ${formatMetres(last.m)}${last.min ? "+" : ""}`;
  const a = orderValueText(first, o), b = orderValueText(last, o);
  return a && b ? `${orderInfo(o).label} ${a} to ${b}` : null;
}

const times = (k: number) => (k >= 10 ? `${Math.round(k).toLocaleString("en-US")}×` : `${(Math.round(k * 10) / 10).toString()}×`);
const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

/**
 * A caption for a figure in a stat or weight order, worked out from the
 * line's own values: where it stands among them ("faster than 62% of this
 * line", "the heaviest in this line").
 */
export function orderFact(item: SizeItem, line: SizeItem[], o: Order): string | null {
  const v = orderValue(item, o.by);
  if (v === null || isHeight(o)) return null;
  const info = orderInfo(o);
  const vals = line.map((i) => orderValue(i, o.by)).filter((x): x is number => x !== null);
  if (vals.length < 2) return null;
  const lower = vals.filter((x) => x < v).length, higher = vals.filter((x) => x > v).length, same = vals.length - lower - higher;
  const what = o.by === "weight" ? `${item.name} weighs ${kgText(v)} (${lbText(v)})` : `${possessive(item.name)} base ${o.by === "bst" ? "stat total" : info.label} is ${v}`;
  const joint = same > 1 ? "joint " : "";
  if (!higher) return `${what}: the ${joint}${info.high.toLowerCase()} in this line`;
  if (!lower) return `${what}: the ${joint}${info.low.toLowerCase()} in this line`;
  const pct = Math.max(1, Math.min(99, Math.round((100 * lower) / (vals.length - 1))));
  return `${what}: ${info.more} ${pct}% of this line`;
}

/** The finale's caption in a stat or weight order: the line's top value against its bottom one. */
export function orderSpanFact(line: SizeItem[], o: Order): string | null {
  if (isHeight(o)) return null;
  const mons = line.filter((i) => orderValue(i, o.by) !== null);
  if (mons.length < 2) return null;
  const val = (i: SizeItem) => orderValue(i, o.by)!;
  const hi = mons.reduce((a, b) => (val(b) > val(a) ? b : a));
  const lo = mons.reduce((a, b) => (val(b) < val(a) ? b : a));
  const k = val(hi) / val(lo);
  if (k < 1.5) return null;
  if (o.by === "weight") return `${hi.name} is ${times(k)} as heavy as ${lo.name}`;
  const label = o.by === "bst" ? "stat total" : orderInfo(o).label;
  return `${possessive(hi.name)} base ${label} is ${times(k)} ${possessive(lo.name)}`;
}
