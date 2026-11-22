import "server-only";
import type { OtherLocale } from "@/i18n/config";
import type { Keys, Translator } from "@/i18n/catalog";
import { serverT } from "@/i18n/server";
import dataNs from "@/messages/pokemon-data";
import pageNs from "@/messages/pokemon-page";
import pikadokuPage from "@/messages/pikadoku-page";
import ids from "@/data/quiz/i18n/pokeapi-ids.json";
import { speciesName } from "@/lib/names/species";
import { formName } from "@/lib/pikadoku/local";
import { SITE_URL } from "@/lib/site";
import type { DexEntryData, EvolutionNode } from "./dex-types";
import type { EncGen, EncRow } from "./encounter-types";
import { VERSIONS } from "./encounter-types";
import { POKEDEX, type Pokemon } from "./pokedex";
import { defensiveProfile } from "./type-matrix";
import { dataKey, dexTable, dexTexts, genusIn, listIn, nameIn, orIn, regionNames, typeNames } from "./dex-local";

/**
 * A species page in another language (/<lang>/pokemon/[slug]): its data (details.ts' getDexEntry) re-worded with the
 * language's official names and the games' own texts in it (src/data/i18n), and its metadata and summary from the
 * pokemon-page messages. Server-only; English pages never call any of it. Anything the data has no official name for
 * (some places, encounter notes, unusual forms) keeps its English wording.
 */

type DataKey = Keys<typeof dataNs.en>;

const BY_NAME = new Map<string, Pokemon>(POKEDEX.map((p) => [dataKey(p.name), p]));
const ABILITY_IDS = (ids as { abilities: Record<string, string> }).abilities;

/** PokéAPI's egg group names (the data tables' keys) for the names the details carry. */
const EGG_GROUPS: Record<string, string> = { plant: "grass", ground: "field", noeggs: "undiscovered", humanshape: "humanlike", indeterminate: "amorphous" };
const DLC: Record<string, string> = { isleofarmor: "swordtheisleofarmor", crowntundra: "swordthecrowntundra", tealmask: "scarletthetealmask", indigodisk: "scarlettheindigodisk" };

/** The words and names of one language, for one render. */
function context(locale: OtherLocale, t: Translator<typeof dataNs.en> = serverT(dataNs)) {
  const has = (key: string) => t.has(key);
  const say = (key: string, values?: Record<string, string | number>) => t(key as DataKey, values);
  const types = typeNames(locale);
  const versions = dexTable(locale, "versions");
  const locations = dexTable(locale, "locations");
  const regions = dexTable(locale, "regions");
  const species = (english: string) => {
    const p = BY_NAME.get(dataKey(english));
    return p ? speciesName(p.id, p.name, locale) : english;
  };
  const item = (english: string) => nameIn(locale, "items", english);
  const move = (english: string) => nameIn(locale, "moves", english);
  const region = (english: string) => regions[dataKey(english)] ?? english;
  const place = (english: string): string => {
    const own = locations[dataKey(english)];
    if (own) return own;
    const route = /^Route (\d+)$/.exec(english);
    if (route) return say("x.route", { n: route[1] });
    const regional = /^(\w+) Route (\d+)$/.exec(english);
    if (regional && regions[dataKey(regional[1])]) return say("x.inRegion", { place: say("x.route", { n: regional[2] }), region: region(regional[1]) });
    return english;
  };
  const places = (list: string) => orIn(locale, list.split(/, | or /).map(place));
  /** A DLC ("The Isle of Armor", "Crown Tundra") by its official name, from the language's game titles. */
  const dlc = (english: string): string | null => {
    const key = DLC[dataKey(english.replace(/^The /, ""))];
    const title = key && versions[key];
    return title ? title.split(/[:：]\s*/).slice(1).join(": ") || null : null;
  };
  const version = (key: string) => versions[dataKey(key)] ?? VERSIONS.find((v) => v.key === key)?.name ?? key;
  return { t, has, say, types, species, item, move, region, place, places, dlc, version, locale };
}
type Ctx = ReturnType<typeof context>;

/** One evolution method in the language; the English one when it isn't a pattern this knows. */
function evolution(c: Ctx, english: string): string {
  const { say } = c;
  const whole: [RegExp, (m: RegExpExecArray) => string][] = [
    [/^Feed 400 (.+) in Pokémon GO$/, (m) => say("evo.candy", { item: c.item(m[1]) })],
    [/^Walk 1,000 steps in Let's Go mode, then level up$/, () => say("evo.steps")],
    [/^Use (.+) 20 times, then level up$/, (m) => say("evo.useMove", { move: c.move(m[1]) })],
    [/^Use (.+) 20 times in (Agile|Strong) Style$/, (m) => say("evo.useMoveStyle", { move: c.move(m[1]), style: say(m[2] === "Agile" ? "evo.agile" : "evo.strong") })],
    [/^Defeat 3 (.+) holding a (.+), then level up$/, (m) => say("evo.defeat", { name: c.species(m[1]), item: c.item(m[2]) })],
    [/^Land three critical hits in one battle$/, () => say("evo.crits")],
    [/^Take 49\+ damage, then walk under the (.+) arch$/, (m) => say("evo.dustyBowl", { place: c.place(m[1]) })],
    [/^Spin around holding a Sweet$/, () => say("evo.spin")],
    [/^Train in the Tower of Darkness$/, () => say("evo.towerDark")],
    [/^Train in the Tower of Waters$/, () => say("evo.towerWater")],
    [/^Take 294 recoil damage without fainting$/, () => say("evo.recoil")],
    [/^Use (.+) or (.+)$/, (m) => say("evo.useEither", { a: c.item(m[1]), b: c.item(m[2]) })],
  ];
  for (const [re, f] of whole) {
    const m = re.exec(english);
    if (m) return f(m);
  }
  const parts: string[] = [];
  let rest: string;
  let m: RegExpExecArray | null;
  if ((m = /^Level (\d+)/.exec(english))) parts.push(say("evo.level", { n: m[1] }));
  else if ((m = /^Level up/.exec(english))) parts.push(say("evo.levelUp"));
  else if ((m = /^Use (.+?)(?= \((?:male|female)\)$|$)/.exec(english))) parts.push(say("evo.use", { item: c.item(m[1]) }));
  else if ((m = /^Trade holding (.+)$/.exec(english))) parts.push(say("evo.tradeHolding", { item: c.item(m[1]) }));
  else if ((m = /^Trade for (.+)$/.exec(english))) parts.push(say("evo.tradeFor", { name: c.species(m[1]) }));
  else if ((m = /^Trade$/.exec(english))) parts.push(say("evo.trade"));
  else return english;
  rest = english.slice(m[0].length);
  const mods: [RegExp, (m: RegExpExecArray) => string][] = [
    [/^at night/, () => say("evo.night")],
    [/^during the day/, () => say("evo.day")],
    [/^at dusk/, () => say("evo.dusk")],
    [/^\(female\)/, () => say("evo.female")],
    [/^\(male\)/, () => say("evo.male")],
    [/^with high friendship/, () => say("evo.friendship")],
    [/^with high affection/, () => say("evo.affection")],
    [/^with high Beauty/, () => say("evo.beauty")],
    [/^holding (.+?)(?=,|$)/, (x) => say("evo.holding", { item: c.item(x[1]) })],
    [/^knowing a (\w+)-type move/, (x) => say("evo.knowingType", { type: c.types[x[1].toLowerCase()] ?? x[1] })],
    [/^knowing (.+?)(?=,|$)/, (x) => say("evo.knowing", { move: c.move(x[1]) })],
    [/^when Attack > Defense/, () => say("evo.atkGt")],
    [/^when Attack < Defense/, () => say("evo.atkLt")],
    [/^when Attack = Defense/, () => say("evo.atkEq")],
    [/^with a (\w+)-type in the party/, (x) => say("evo.partyType", { type: c.types[x[1].toLowerCase()] ?? x[1] })],
    [/^with an empty party slot and a spare Poké Ball/, () => say("evo.emptySlot")],
    [/^with the console upside down/, () => say("evo.upsideDown")],
    [/^while it's raining/, () => say("evo.rain")],
    [/^while in a Union Circle with another player/, () => say("evo.union")],
    [/^with 999 Gimmighoul Coins in the bag/, () => say("evo.coins", { item: c.item("Gimmighoul Coin") })],
    [/^in a special magnetic field \((.+)\)/, (x) => say("evo.magnetic", { places: c.places(x[1]) })],
    [/^with (.+) in the party/, (x) => say("evo.party", { name: c.species(x[1]) })],
    [/^at (.+)$/, (x) => say("evo.at", { places: c.places(x[1]) })],
  ];
  while ((rest = rest.replace(/^,?\s+/, ""))) {
    const found = mods.map(([re, f]) => [re.exec(rest), f] as const).find(([x]) => x);
    if (!found) return english;
    const [x, f] = found;
    parts.push(f(x!));
    rest = rest.slice(x![0].length);
  }
  return parts.join(say("evo.sep"));
}

/**
 * Evolution methods ("Level 36", "Use Water Stone") in a language, for callers outside a page render (an API route
 * passes the pokemon-data translator it loaded with getT).
 */
export function evolutionIn(locale: OtherLocale, t?: Translator<typeof dataNs.en>): (english: string) => string {
  const c = context(locale, t);
  return (english) => evolution(c, english);
}

function evolutionTree(c: Ctx, node: EvolutionNode): EvolutionNode {
  return {
    ...node,
    name: speciesName(node.id, node.name, c.locale),
    conditions: node.conditions.map((x) => evolution(c, x)),
    children: node.children.map((n) => evolutionTree(c, n)),
  };
}

/** A note's word ("Fog", "Area 2", "Fire zone", "towards Viridian City"); English when it has no translation. */
function noteWord(c: Ctx, word: string): string {
  const key = `note.${dataKey(word)}`;
  if (c.has(key)) return c.say(key);
  if (/^B?\d+F$/.test(word) || /^\d+★$/.test(word)) return word;
  let m: RegExpExecArray | null;
  if ((m = /^Area (\d+)$/.exec(word))) return c.say("x.area", { n: m[1] });
  if ((m = /^(\w+) zone$/.exec(word)) && c.types[m[1].toLowerCase()]) return c.say("x.zone", { type: c.types[m[1].toLowerCase()] });
  if ((m = /^towards (.+)$/.exec(word))) return c.say("x.towards", { place: c.place(m[1]) });
  return c.dlc(word) ?? c.place(word);
}

/** A free-text row ("Evolve from Pichu", "Trade from Sword (in The Crown Tundra)"). */
function freeText(c: Ctx, english: string): string {
  const { say } = c;
  const dlcPart = /^(.+) \(in (.+)\)$/.exec(english);
  if (dlcPart) {
    const dlc = c.dlc(dlcPart[2]);
    const inner = freeText(c, dlcPart[1]);
    return dlc && inner !== dlcPart[1] ? say("x.inDlc", { text: inner, dlc }) : english;
  }
  const fixed: Record<string, DataKey> = {
    "Not in this game": "x.notInGame",
    "Not found in the wild": "x.notWild",
    Breed: "x.breed",
    "Revive its fossil": "x.fossil",
    "Event only": "x.event",
    "Dynamax Adventures": "x.dynamaxAdventures",
    "Transfer from Pokémon HOME": "x.home",
    "Transfer from Pokémon HOME or get it from an event": "x.homeEvent",
  };
  if (fixed[english]) return say(fixed[english]);
  let m: RegExpExecArray | null;
  if ((m = /^Transfer from Pokémon HOME or trade \(needs (the Expansion Pass|The Hidden Treasure of Area Zero)\)$/.exec(english)))
    return say("x.homeTradeDlc", { dlc: say(m[1] === "the Expansion Pass" ? "x.expansionPass" : "x.areaZero") });
  if ((m = /^Evolve from (.+)$/.exec(english))) return say("x.evolveFrom", { name: orIn(c.locale, m[1].split(/, | or /).map(c.species)) });
  if ((m = /^Evolve (.+)$/.exec(english)) && BY_NAME.has(dataKey(m[1]))) return say("x.evolve", { name: c.species(m[1]) });
  if ((m = /^Trade from (.+)$/.exec(english)) && VERSIONS.some((v) => v.name === m![1])) return say("x.tradeFrom", { game: c.version(VERSIONS.find((v) => v.name === m![1])!.key) });
  return english;
}

function method(c: Ctx, english: string): string {
  const key = `method.${dataKey(english)}`;
  if (c.has(key)) return c.say(key);
  const items = dexTable(c.locale, "items");
  const moves = dexTable(c.locale, "moves");
  return items[dataKey(english)] ?? moves[dataKey(english)] ?? english;
}

function encounterRow(c: Ctx, r: EncRow): EncRow {
  return {
    ...r,
    ...(r.loc && { loc: c.place(r.loc) }),
    ...(r.m && { m: method(c, r.m) }),
    ...(r.n && { n: r.n.split(" · ").map((part) => part.split(", ").map((w) => noteWord(c, w)).join(c.locale === "ja" ? "、" : ", ")).join(" · ") }),
    ...(r.x && { x: freeText(c, r.x) }),
  };
}

const NEGATIVE = /^Not (in this game|found in the wild)$/;
/** encounter-types' genSummary, as a kind the page words in its language. */
function encKind(gen: EncGen): "entries" | "notInGames" | "notWild" {
  if (gen.rows.some((r) => r.loc || (r.x && !NEGATIVE.test(r.x)))) return "entries";
  return gen.rows.every((r) => r.x === "Not in this game") ? "notInGames" : "notWild";
}

/** A regional Pokédex's name ("Original Johto", "Kalos Central", "Isle Of Armor"). */
function dexName(c: Ctx, english: string): string {
  const { say } = c;
  const key = dataKey(english);
  const own: Record<string, DataKey> = { kaloscentral: "dex.central", kaloscoastal: "dex.coastal", kalosmountain: "dex.mountain", letsgokanto: "dex.letsgo", isleofarmor: "dex.isleofarmor", crowntundra: "dex.crowntundra", blueberry: "dex.blueberry", kitakami: "dex.kitakami" };
  if (own[key]) return say(own[key]);
  const m = /^(Original|Updated|Extended) (.+)$/.exec(english);
  const area = (name: string) => {
    const r = c.region(name);
    if (r !== name) return r;
    return dexTable(c.locale, "locations")[`${dataKey(name)}island`] ?? name;
  };
  if (m) return say(m[1] === "Original" ? "dex.original" : m[1] === "Updated" ? "dex.updated" : "dex.extended", { region: area(m[2]) });
  return area(english);
}

/** The newest of the games' texts in the language for a PokéAPI id. */
const newest = (texts: Record<string, { text: string }[]>, id: number | string | undefined) => (id === undefined ? undefined : texts[String(id)]?.[0]?.text);

/** getDexEntry's data for a page in another language. */
export function localizeDexEntry(data: DexEntryData, locale: OtherLocale): DexEntryData {
  const c = context(locale);
  const p = data.core;
  const name = speciesName(p.id, p.name, locale);
  const abilityTexts = dexTexts(locale, "abilities");
  const moveTexts = dexTexts(locale, "moves");
  const ability = (a: DexEntryData["abilities"][number]) => ({
    ...a,
    label: nameIn(locale, "abilities", a.name),
    effect: newest(abilityTexts, ABILITY_IDS[dataKey(a.name)]) ?? "",
  });
  const pdk = serverT(pikadokuPage);
  const neighbour = <N extends { id: number; name: string }>(n: N): N => ({ ...n, name: speciesName(n.id, n.name, locale) });
  const lists = (items: string[]) => (locale === "ja" ? items.join("・") : listIn(locale, items));
  const growthKey = `growth.${dataKey(data.growthRate ?? "")}`;
  const shapeKey = `shape.${dataKey(p.shape ?? "")}`;
  const eggGroups = dexTable(locale, "egg-groups");
  const versions = Object.fromEntries(VERSIONS.map((v) => [v.key, c.version(v.key)]));
  const texts = dexTexts(locale, "species")[p.id] ?? [];
  return {
    ...data,
    core: {
      ...p,
      name,
      genus: genusIn(locale, p.genus),
      color: dexTable(locale, "colors")[p.color] ?? p.color,
      shape: p.shape && c.has(shapeKey) ? c.say(shapeKey) : p.shape,
      habitat: p.habitat ? (dexTable(locale, "habitats")[dataKey(p.habitat)] ?? p.habitat) : null,
    },
    names: [{ lang: "en", label: "English", name: p.name }, ...data.names.filter((n) => n.lang !== locale)],
    growthRate: data.growthRate && c.has(growthKey) ? c.say(growthKey) : data.growthRate,
    eggGroups: data.eggGroups.map((g) => eggGroups[EGG_GROUPS[dataKey(g)] ?? dataKey(g)] ?? g),
    abilities: data.abilities.map(ability),
    // The games' own entries in the language, oldest first like the English ones (none after Generation 8).
    entries: [...texts].reverse().map((e) => ({ text: e.text, games: e.versions.map((v) => v.replace(/-/g, " ")), labels: e.versions.map((v) => c.version(v)) })),
    dexNumbers: data.dexNumbers.map((d) => ({ ...d, dex: dexName(c, d.dex) })),
    forms: data.forms.map((f) => ({
      ...f,
      name: formName(f.slug, p.slug, name, pdk) ?? f.name.replace(p.name, name),
      abilities: f.abilities.map(ability),
    })),
    evolutionTree: data.evolutionTree && evolutionTree(c, data.evolutionTree),
    learnset: data.learnset && {
      game: lists(data.learnset.game.split(" & ").map((g) => c.version(VERSIONS.find((v) => v.name === g)?.key ?? g))),
      moves: data.learnset.moves.map((m) => ({ ...m, name: nameIn(locale, "moves", m.name), effect: newest(moveTexts, m.id) ?? "" })),
    },
    encounters: data.encounters && data.encounters.map((g) => ({ ...g, rows: g.rows.map((r) => encounterRow(c, r)) })),
    prev: data.prev && neighbour(data.prev),
    next: data.next && neighbour(data.next),
    lookalikes: data.lookalikes.map(neighbour),
    local: {
      types: c.types,
      region: regionNames(locale)[p.gen - 1] ?? "",
      english: p.name,
      versions,
      encKinds: Object.fromEntries((data.encounters ?? []).map((g) => [g.g, encKind(g)])),
    },
  };
}

/* ---- The page's own text: metadata, the summary, structured data. ---- */

type PageT = Translator<typeof pageNs.en>;

function words(t: PageT, p: Pokemon, locale: OtherLocale) {
  const types = typeNames(locale);
  const list = (items: string[]) => listIn(locale, items);
  const weak = [...defensiveProfile(p.types)]
    .filter(([, m]) => m > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, m]) => ({ name: types[type], x4: m > 2 }));
  return {
    name: speciesName(p.id, p.name, locale),
    typing: p.types.map((x) => types[x]).join(t("typesSep")),
    weak,
    list,
  };
}

export function localDexTitle(p: Pokemon, locale: OtherLocale): string {
  return serverT(pageNs)("title", { name: speciesName(p.id, p.name, locale) });
}

export function localDexDescription(p: Pokemon, locale: OtherLocale): string {
  const t = serverT(pageNs);
  const w = words(t, p, locale);
  return [
    t("desc", { name: w.name, id: p.id, types: w.typing, bst: p.bst }),
    w.weak.length ? t("descWeak", { list: w.list(w.weak.map((x) => x.name)) }) : "",
    t("descEnd"),
  ]
    .filter(Boolean)
    .join(" ");
}

export function localDexSummary(p: Pokemon, locale: OtherLocale): string {
  const t = serverT(pageNs);
  const w = words(t, p, locale);
  const ability = (a: { name: string }) => nameIn(locale, "abilities", a.name.replace(/-/g, " "));
  const abilities = p.abilities.filter((a) => !a.hidden).map(ability);
  const hidden = p.abilities.filter((a) => a.hidden).map(ability);
  const s = p.stats;
  return [
    t("sum", { name: w.name, types: w.typing, genus: genusIn(locale, p.genus), gen: p.gen, id: p.id, bst: p.bst, hp: s.hp, atk: s.atk, def: s.def, spa: s.spa, spd: s.spd, spe: s.spe }),
    w.weak.length ? t("sumWeak", { list: w.list(w.weak.map((x) => (x.x4 ? t("x4", { type: x.name }) : x.name))) }) : t("sumNoWeak"),
    abilities.length ? (hidden.length ? t("sumAbilitiesHidden", { list: w.list(abilities), hidden: w.list(hidden) }) : t("sumAbilities", { list: w.list(abilities) })) : "",
  ]
    .filter(Boolean)
    .join(locale === "ja" ? "" : " ");
}

export function localDexBreadcrumbs(p: Pokemon, locale: OtherLocale) {
  const t = serverT(pageNs);
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "PokéIQ", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: t("pokedex"), item: `${SITE_URL}/pokedex` },
      { "@type": "ListItem", position: 3, name: speciesName(p.id, p.name, locale), item: `${SITE_URL}/pokemon/${p.slug}` },
    ],
  };
}
