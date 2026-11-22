import "server-only";
import { toRomaji } from "wanakana";
import type { Locale, OtherLocale } from "@/i18n/config";
import type { Keys, Translator } from "@/i18n/catalog";
import type dexRef from "@/messages/dex-ref";
import { speciesName } from "@/lib/names/species";
import { capitalize } from "@/lib/pokemon/type-matrix";
import { versionGroupLabel, versionLabel } from "./build";

/**
 * The Moves / Abilities / Items pages' official names and in-game descriptions in the page's language
 * (src/data/i18n/<locale>, from PokéAPI), for the server. English gets the records' own text back untouched and loads
 * nothing; another language loads its own tables once per server, on its first page.
 */

type Table = Record<string, string>;
type Texts = Record<string, { text: string; versions: string[] }[]>;

export interface DexLocal {
  locale: Locale;
  move(english: string): string;
  ability(english: string): string;
  item(english: string): string;
  /** A type by id ("fire" → "Feu"); English capitalises it as the pages always did. */
  type(id: string): string;
  species(id: number, english: string): string;
  /** The games' newest description in this language, by PokéAPI number (moves) or our slug (abilities, items). */
  moveText(id: number): string | undefined;
  abilityText(slug: string): string | undefined;
  itemText(slug: string): string | undefined;
  /** "red-blue" → "Rouge / Bleu". */
  versionGroup(vg: string): string;
  /** "omega-ruby" → "Rubis Oméga". */
  version(v: string): string;
  /** What else a search box takes for a name shown in this language: the English one, and rōmaji for Japanese. */
  aliases(own: string, english: string): string[];
  /** Every type's name, for the client's type filter (English pages send none). */
  types(): Record<string, string>;
}

/** A name's key in src/data/i18n: the English, without accents, lower case letters and digits only. */
const dataKey = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const ENGLISH: DexLocal = {
  locale: "en",
  move: (s) => s,
  ability: (s) => s,
  item: (s) => s,
  type: capitalize,
  species: (_id, s) => s,
  moveText: () => undefined,
  abilityText: () => undefined,
  itemText: () => undefined,
  versionGroup: versionGroupLabel,
  version: versionLabel,
  aliases: () => [],
  types: () => ({}),
};

/** Version groups as the games' titles: the versions they pair ("x-y" → x, y), or a DLC (its name after the colon). */
const GROUP_VERSIONS: Record<string, string[]> = {
  "red-blue": ["red", "blue"],
  "gold-silver": ["gold", "silver"],
  "ruby-sapphire": ["ruby", "sapphire"],
  "firered-leafgreen": ["firered", "leafgreen"],
  "diamond-pearl": ["diamond", "pearl"],
  "heartgold-soulsilver": ["heartgold", "soulsilver"],
  "black-white": ["black", "white"],
  "black-2-white-2": ["black2", "white2"],
  "x-y": ["x", "y"],
  "omega-ruby-alpha-sapphire": ["omegaruby", "alphasapphire"],
  "sun-moon": ["sun", "moon"],
  "ultra-sun-ultra-moon": ["ultrasun", "ultramoon"],
  "lets-go-pikachu-lets-go-eevee": ["letsgopikachu", "letsgoeevee"],
  "sword-shield": ["sword", "shield"],
  "brilliant-diamond-and-shining-pearl": ["brilliantdiamond", "shiningpearl"],
  "scarlet-violet": ["scarlet", "violet"],
};
const DLC: Record<string, string> = {
  "the-isle-of-armor": "swordtheisleofarmor",
  "the-crown-tundra": "swordthecrowntundra",
  "the-teal-mask": "scarletthetealmask",
  "the-indigo-disk": "scarlettheindigodisk",
};

interface Data {
  moves: Table;
  abilities: Table;
  items: Table;
  types: Table;
  versions: Table;
  moveTexts: Texts;
  abilityTexts: Texts;
  itemTexts: Texts;
  ids: { abilities: Record<string, number>; items: Record<string, number> };
}

async function load(l: OtherLocale): Promise<Data> {
  const json = async <T,>(p: Promise<{ default: unknown }>) => (await p).default as T;
  const [moves, abilities, items, types, versions, moveTexts, abilityTexts, itemTexts, ids] = await Promise.all([
    json<Table>(import(`@/data/i18n/${l}/moves.json`)),
    json<Table>(import(`@/data/i18n/${l}/abilities.json`)),
    json<Table>(import(`@/data/i18n/${l}/items.json`)),
    json<Table>(import(`@/data/i18n/${l}/types.json`)),
    json<Table>(import(`@/data/i18n/${l}/versions.json`)),
    json<Texts>(import(`@/data/i18n/${l}/texts/moves.json`)),
    json<Texts>(import(`@/data/i18n/${l}/texts/abilities.json`)),
    json<Texts>(import(`@/data/i18n/${l}/texts/items.json`)),
    json<Data["ids"]>(import("@/data/dex-text-ids.json")),
  ]);
  return { moves, abilities, items, types, versions, moveTexts, abilityTexts, itemTexts, ids };
}

/**
 * The games' stand-in texts, which describe nothing: Sword / Shield's "This move can't be used…" on every move it
 * dropped, Scarlet / Violet's line for the unused Dynamax crystals, "Dummy data", "- - -".
 */
function placeholders(texts: Texts): Set<string> {
  const count = new Map<string, number>();
  for (const list of Object.values(texts)) for (const e of list) count.set(e.text, (count.get(e.text) ?? 0) + 1);
  const out = new Set<string>();
  for (const [text, n] of count) if (n >= 100 || /^[\s\-ー－―]*$/.test(text) || /dummy|ダミー|\[VAR/i.test(text)) out.add(text);
  return out;
}

function build(l: OtherLocale, d: Data): DexLocal {
  const named = (table: Table, english: string) => table[dataKey(english)] ?? english;
  const skip = new Map<Texts, Set<string>>([d.moveTexts, d.abilityTexts, d.itemTexts].map((t) => [t, placeholders(t)]));
  const newest = (texts: Texts, id: number | undefined) => (id === undefined ? undefined : texts[id]?.find((e) => !skip.get(texts)?.has(e.text))?.text);
  const version = (v: string) => d.versions[v.replace(/-/g, "")] ?? versionLabel(v);
  return {
    locale: l,
    move: (s) => named(d.moves, s),
    ability: (s) => named(d.abilities, s),
    item: (s) => named(d.items, s),
    type: (id) => d.types[id] ?? capitalize(id),
    species: (id, s) => speciesName(id, s, l),
    moveText: (id) => newest(d.moveTexts, id),
    abilityText: (slug) => newest(d.abilityTexts, d.ids.abilities[slug]),
    itemText: (slug) => newest(d.itemTexts, d.ids.items[slug]),
    versionGroup(vg) {
      const dlc = DLC[vg] && d.versions[DLC[vg]];
      if (dlc) return dlc.replace(/^[^:]*:\s*/, "");
      const pair = GROUP_VERSIONS[vg];
      if (pair) {
        const names = pair.map((v) => d.versions[v]);
        if (names.every(Boolean)) return names.join(" / ");
        return versionGroupLabel(vg);
      }
      return d.versions[vg.replace(/-/g, "")] ?? versionGroupLabel(vg);
    },
    version,
    aliases(own, english) {
      const out = new Set<string>([english]);
      if (l === "ja") {
        // The games write digits and Latin letters full width ("１０まんボルト"): a keyboard types them half width.
        const plain = own.normalize("NFKC");
        out.add(plain);
        out.add(toRomaji(plain));
      }
      out.delete(own);
      return [...out];
    },
    types: () => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(d.types)) if (k) out[k] = v;
      return out;
    },
  };
}

/** An item category in the page's language ("Stat Boosts" → "Stimulants"); English, or one the messages lack, as given. */
export function itemCategory(t: Translator<typeof dexRef.en>, category: string): string {
  if (t.locale === "en") return category;
  const key = `categories.${dataKey(category)}`;
  return t.has(key) ? t(key as Keys<typeof dexRef.en>) : category;
}

const cache = new Map<OtherLocale, Promise<DexLocal>>();

/** The page's names and descriptions (English: the records' own, with nothing loaded). */
export function dexLocal(locale: Locale): Promise<DexLocal> {
  if (locale === "en") return Promise.resolve(ENGLISH);
  let p = cache.get(locale);
  if (!p) {
    p = load(locale).then((d) => build(locale, d));
    cache.set(locale, p);
    p.catch(() => cache.delete(locale));
  }
  return p;
}
