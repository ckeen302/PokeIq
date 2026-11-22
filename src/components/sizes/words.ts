import { formatNumber, type Translator } from "@/i18n/catalog";
import sizesLines from "@/messages/sizes-lines";
import { PRESET_BY_ID, DEFAULT_PRESET } from "@/lib/sizes/presets";
import { HEIGHT_ORDER, inOrder, isDefaultOrder, isHeight, orderLeftOut, orderValue, type Order, type OrderKey } from "@/lib/sizes/order";
import { listItems, listOrder, type ListSpec } from "@/lib/sizes/list";
import type { SizeItem } from "@/lib/sizes/types";

/**
 * /pokedex/sizes' composed text (lineup titles, the table's caption and note, order labels) from the sizes-lines
 * namespace, in the page's language. These give exactly lib/sizes' English on English pages (tests/i18n-sizes keeps
 * them equal). The numbers-and-units text (sizes, weights, values, fun facts, badges) is lib/sizes' own on English
 * pages, with feet and pounds; the functions marked "other languages" word it in the page's language, metric only.
 */

type T = Translator<typeof sizesLines.en>;
type PresetId = keyof typeof sizesLines.en.presets;

/** A preset's id as the messages key it (an unknown one is the main lineup). */
const presetId = (id: string) => (PRESET_BY_ID.get(id) ?? DEFAULT_PRESET).id as PresetId;

/** An order's label: "Sp. Atk". */
export const orderLabel = (by: OrderKey, t: T) => t(`order.${by}.label`);

/** The direction's words: "Slowest first" / "Fastest first". */
export const dirText = (by: OrderKey, dir: "asc" | "desc", t: T) => t(dir === "desc" ? `order.${by}.highFirst` : `order.${by}.lowFirst`);

/** Lower case where the language writes these words in lower case mid-sentence (German nouns keep their capital). */
export const lowerIn = (s: string, t: T) => (t.locale === "de" || t.locale === "ja" ? s : s.toLowerCase());

/** What a title says the line is ordered by: "Speed" or "Speed, fastest first". */
const byPhrase = (o: Order, t: T) => t(o.dir === "desc" ? `order.${o.by}.byHigh` : `order.${o.by}.by`);

/** A preset's title in an order (lib/sizes/order's orderTitle of the preset's title). */
export function presetTitle(id: string, o: Order, t: T): string {
  const p = presetId(id);
  return isDefaultOrder(o) ? t(`presets.${p}.title`) : t(`presets.${p}.titleBy`, { by: byPhrase(o, t) });
}

/** A preset's hook in an order (orderTitle of the preset's hook). */
export function presetHook(id: string, o: Order, t: T): string {
  const p = presetId(id);
  return isDefaultOrder(o) ? t(`presets.${p}.hook`) : t(`presets.${p}.hookBy`, { by: byPhrase(o, t) });
}

/** A preset's label: "Legendaries & Mythicals". */
export const presetLabel = (id: string, t: T) => t(`presets.${presetId(id)}.label`);

/** "Wailord vs Eternatus". */
export const joinNames = (names: string[], t: T) => names.join(t("compare.sep"));

/** A comparison's hook: lib/sizes/lineup's compareHook. */
export function compareHookText(items: SizeItem[], o: Order, t: T): string {
  const names = items.filter((i) => i.kind !== "ref").map((i) => i.name);
  if (!names.length) return isDefaultOrder(o) ? t("compare.empty") : t("compare.emptyBy", { by: byPhrase(o, t) });
  const n = joinNames(names, t);
  return isDefaultOrder(o) ? t("compare.hook", { names: n }) : t("compare.hookBy", { names: n, by: byPhrase(o, t) });
}

/** A comparison's line title (its hook without the emoji, in Height order). */
export function compareTitle(items: SizeItem[], t: T): string {
  const names = items.filter((i) => i.kind !== "ref").map((i) => i.name);
  return names.length ? joinNames(names, t) : t("compare.empty").replace(/ 😳$/, "");
}

/** The table's name: lib/sizes/list's listCaption. */
export function listCaptionText(all: SizeItem[], spec: ListSpec, order: Order, t: T): string {
  const byKey = new Map(all.map((i) => [i.key, i]));
  const vs = (spec.vs ?? []).flatMap((k) => byKey.get(k) ?? []);
  if (vs.length >= 2) {
    const names = joinNames(vs.map((i) => i.name), t);
    return isDefaultOrder(order) ? t("compare.caption", { names }) : t("compare.captionBy", { names, by: byPhrase(order, t) });
  }
  const focus = spec.focus ? byKey.get(spec.focus) : undefined;
  if (focus) return t(`order.${listOrder(all, spec, order).by}.closeTo`, { name: focus.name });
  return presetTitle(spec.preset, order, t);
}

/** What the order leaves out of the table: lib/sizes/list's listNote. */
export function listNoteText(all: SizeItem[], spec: ListSpec, order: Order, t: T): string | null {
  const o = listOrder(all, spec, order);
  if (isHeight(o)) return null;
  const { forms, refs } = orderLeftOut(listItems(all, spec.focus ? { preset: DEFAULT_PRESET.id } : spec, HEIGHT_ORDER), o);
  const parts: string[] = [];
  if (forms.length) parts.push(t(`order.${o.by}.leftOut`));
  if (refs) parts.push(t("note.refs"));
  return parts.length ? parts.join(" ") : null;
}

// ---- Other languages: numbers and units as the language writes them, metric only.

const trimmed = (n: number, dp: number) => Number(n.toFixed(dp));

/** "14,5 m", "0,1 m" (other languages). */
export const metres = (m: number, t: T) => `${formatNumber(trimmed(m, m < 10 ? 2 : 1), t.locale, { maximumFractionDigits: 2 })} m`;

/** A figure's size: "14,5 m", "28 m+" (other languages). */
export const sizeText = (i: Pick<SizeItem, "m" | "min">, t: T) => `${metres(i.m, t)}${i.min ? "+" : ""}`;

/** "460 kg" (other languages). */
export const kgText = (kg: number, t: T) => `${formatNumber(kg, t.locale, { maximumFractionDigits: 1 })} kg`;

/** "12×", "1,5×" (other languages). */
const times = (k: number, t: T) => t("unit.times", { k: k >= 10 ? formatNumber(Math.round(k), t.locale) : formatNumber(Math.round(k * 10) / 10, t.locale) });

/** The value as shown: "460 kg", "130", "1,7 m" (other languages). */
export function valueText(i: SizeItem, o: Order, t: T): string | null {
  const v = orderValue(i, o.by);
  if (v === null) return null;
  if (o.by === "height") return sizeText({ m: v, min: i.min }, t);
  if (o.by === "weight") return kgText(v, t);
  return String(v);
}

/** "Weight 460 kg", "Speed 130" (other languages; null in the Height order). */
export function tagText(i: SizeItem, o: Order, t: T): string | null {
  if (isHeight(o)) return null;
  const v = valueText(i, o, t);
  return v === null ? null : t("tag", { label: orderLabel(o.by, t), value: v });
}

/** The hook card's range line: "0,1 m to 100 m", "Speed 5 to 200" (other languages). */
export function rangeText(line: SizeItem[], o: Order, t: T): string | null {
  const mons = line.filter((i) => i.kind !== "ref");
  if (!mons.length) return null;
  const first = mons[0], last = mons[mons.length - 1];
  if (isHeight(o)) return t("range.height", { a: sizeText(first, t), b: sizeText(last, t) });
  const a = valueText(first, o, t), b = valueText(last, o, t);
  return a && b ? t("range.other", { label: orderLabel(o.by, t), a, b }) : null;
}

/** lib/sizes/facts' factFor (other languages). */
export function factText(item: SizeItem, line: SizeItem[], t: T): string | null {
  if (item.kind === "ref") return null;
  const refs = line.filter((i) => i.kind === "ref" && !i.ref?.presets).sort((a, b) => b.m - a.m);
  const min = item.min ? "yes" : "no";
  const beaten = refs.find((r) => r.m < item.m && r.ref?.kind !== "human");
  const human = refs.find((r) => r.ref?.kind === "human");
  if (item.kind === "eternamax" || (beaten && item.m / beaten.m >= 1.15 && beaten.m >= 4)) {
    const r = beaten ?? human;
    const kind = r?.ref?.kind;
    if (r && (kind === "car" || kind === "bus" || kind === "house" || kind === "building" || kind === "human")) {
      const k = item.m / r.m;
      if (k >= 1.15) return t(`fact.refSize.${kind}`, { name: item.name, min, k: times(k, t) });
    }
  }
  if (human && item.m >= human.m * 1.3) return t(item.length ? "fact.longerThanHuman" : "fact.tallerThanHuman", { name: item.name, min, k: times(item.m / human.m, t) });
  if (human && item.m <= human.m / 3) return t("fact.youAre", { name: item.name, k: times(human.m / item.m, t) });
  if (item.kg != null && item.kg > 0) return t("fact.weighs", { name: item.name, weight: kgText(item.kg, t) });
  return t(item.length ? "fact.isLong" : "fact.isTall", { name: item.name, size: metres(item.m, t) });
}

/** lib/sizes/facts' spanFact (other languages). */
function spanText(line: SizeItem[], t: T): string | null {
  const mons = line.filter((i) => i.kind !== "ref");
  if (mons.length < 2) return null;
  const small = mons.reduce((a, b) => (b.m < a.m ? b : a));
  const big = mons.reduce((a, b) => (b.m > a.m ? b : a));
  const k = big.m / small.m;
  if (k < 1.5) return null;
  return t("fact.span", { big: big.name, small: small.name, k: times(k, t) });
}

/** lib/sizes/order's orderFact (other languages). */
function orderFactText(item: SizeItem, line: SizeItem[], o: Order, t: T): string | null {
  const v = orderValue(item, o.by);
  if (v === null || isHeight(o) || o.by === "height") return null;
  const vals = line.map((i) => orderValue(i, o.by)).filter((x): x is number => x !== null);
  if (vals.length < 2) return null;
  const lower = vals.filter((x) => x < v).length, higher = vals.filter((x) => x > v).length, same = vals.length - lower - higher;
  const what = o.by === "weight" ? t("fact.weighs", { name: item.name, weight: kgText(v, t) }) : t(`fact.stat.${o.by}`, { name: item.name, v });
  const joint = same > 1 ? "yes" : "no";
  if (!higher) return t("fact.rank", { what, joint, sup: t(`order.${o.by}.top`) });
  if (!lower) return t("fact.rank", { what, joint, sup: t(`order.${o.by}.bottom`) });
  const pct = Math.max(1, Math.min(99, Math.round((100 * lower) / (vals.length - 1))));
  return t("fact.more", { what, more: t(`order.${o.by}.more`), pct });
}

/** lib/sizes/order's orderSpanFact (other languages). */
function orderSpanText(line: SizeItem[], o: Order, t: T): string | null {
  if (isHeight(o) || o.by === "height") return null;
  const mons = line.filter((i) => orderValue(i, o.by) !== null);
  if (mons.length < 2) return null;
  const val = (i: SizeItem) => orderValue(i, o.by)!;
  const hi = mons.reduce((a, b) => (val(b) > val(a) ? b : a));
  const lo = mons.reduce((a, b) => (val(b) < val(a) ? b : a));
  const k = val(hi) / val(lo);
  if (k < 1.5) return null;
  if (o.by === "weight") return t("fact.spanWeight", { hi: hi.name, lo: lo.name, k: times(k, t) });
  return t(`fact.spanStat.${o.by}`, { hi: hi.name, lo: lo.name, k: times(k, t) });
}

/** lib/sizes/facts' stopCaption (other languages): the caption at one of Play's pauses and a video's. */
export function stopCaptionText(item: SizeItem | undefined, line: SizeItem[], order: Order, finale: boolean, t: T): string | null {
  if (isHeight(order)) return finale ? spanText(line, t) ?? (item ? factText(item, line, t) : null) : item ? factText(item, line, t) : null;
  return finale ? orderSpanText(line, order, t) ?? (item ? orderFactText(item, line, order, t) : null) : item ? orderFactText(item, line, order, t) : null;
}

/** What a badge says besides the name (other languages): its height box, "(LENGTH)", the order's box and the type names. */
export interface BadgeText {
  num: string;
  unit: string;
  sub: string;
  lengthTag: string;
  stat: { num: string; unit: string; sub: string } | null;
  types: string[];
}

/** The badge words for a figure (other languages; `types`: the page language's type names). */
export function badgeText(i: SizeItem, o: Order, types: Record<string, string>, t: T): BadgeText {
  const n = i.m >= 100 ? Math.round(i.m) : i.m < 10 ? Math.round(i.m * 100) / 100 : Math.round(i.m * 10) / 10;
  let stat: BadgeText["stat"] = null;
  const v = isHeight(o) || !inOrder(i, o) ? null : orderValue(i, o.by);
  if (v !== null) {
    if (o.by === "weight") stat = { num: formatNumber(v, t.locale, { maximumFractionDigits: 1 }), unit: t("order.weight.badge"), sub: "" };
    else stat = { num: String(v), unit: t(`order.${o.by}.badge`), sub: o.by === "bst" ? t("badge.baseStats") : t("badge.baseStat") };
  }
  return {
    num: `${formatNumber(n, t.locale, { maximumFractionDigits: 2 })}${i.min ? "+" : ""}`,
    unit: i.length ? t("badge.meterLength") : t("badge.meterHeight"),
    sub: "",
    lengthTag: t("badge.lengthTag"),
    stat,
    types: i.types.map((ty) => types[ty] ?? ty),
  };
}
