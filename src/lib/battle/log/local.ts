import { LogFormatter, type Tracker } from "@pkmn/view";
import type { OtherLocale } from "@/i18n/config";
import { translator, type Translator, type Tree } from "@/i18n/catalog";
import battleLog from "@/messages/battle-log";
import REFS from "./refs.json";
import { loadBattleNames, nameKey, type BattleNames } from "./names";

/**
 * The battle log in another language: @pkmn/view's LogFormatter (Showdown's text parser) reading the language's
 * translation of Showdown's text table (src/messages/<locale>/battle-log.json) instead of its English one, with every
 * name in the language's official spelling. English pages never load this module: they keep @pkmn/view's formatter,
 * text and all, exactly as before.
 *
 * The formatter fills its templates by replacing "[POKEMON]", "[MOVE]" and the like with what the protocol line says
 * (English names). Here each placeholder comes out of the template wrapped in markers that remember its kind, so once
 * the line is written every name it took in can be turned into the language's (a move as a move, an item as an item).
 */

type LogT = Translator<typeof battleLog.en>;
type Refs = Record<string, Record<string, string>>;

const KINDS = ["POKEMON", "TARGET", "SOURCE", "NICKNAME", "FULLNAME", "TRAINER", "MOVE", "ITEM", "ABILITY", "EFFECT", "TYPE", "STAT", "NUMBER", "PERCENTAGE", "SPECIES", "TEAM", "PARTY", "NAME"] as const;
type Kind = (typeof KINDS)[number];
const OPEN = "\u0001";
const MID = "\u0002";
const CLOSE = "\u0003";
/** The template's placeholders as the formatter expects them ("[POKEMON]"), marked with their kind. */
const MARKED = Object.fromEntries(KINDS.map((k) => [k, `${OPEN}${k}${MID}[${k}]${CLOSE}`]));
/** The same, unmarked (the parts the formatter puts in on its own: "the opposing [NICKNAME]"). */
const PLAIN = Object.fromEntries(KINDS.map((k) => [k, `[${k}]`]));
const MARK_RE = new RegExp(`${OPEN}([A-Z]+)${MID}([^${CLOSE}]*)${CLOSE}`, "g");
const STAT_IDS = new Set(["hp", "atk", "def", "spa", "spd", "spe", "spc", "accuracy", "evasion"]);

const has = (tree: Tree, id: string, type: string) => {
  const entry = Object.hasOwn(tree, id) ? tree[id] : undefined;
  return typeof entry === "object" && Object.hasOwn(entry, type);
};

/**
 * Grammar the templates can't write on their own, once the names are in: French and Italian elide and contract the
 * article a Pokémon's name brings ("de le Abra adverse" → "de l’Abra adverse", "di il Charizard" → "del Charizard"),
 * Spanish contracts it ("de el" → "del"). The templates' own words are written contracted already.
 */
const VOWEL = "AEIOUYaeiouyÀ-ÖØ-öø-ÿ";
const IT_ART = ["il", "lo", "la", "i", "gli", "le", "l’"];
const IT_PREP: Record<string, string[]> = {
  di: ["del", "dello", "della", "dei", "degli", "delle", "dell’"],
  a: ["al", "allo", "alla", "ai", "agli", "alle", "all’"],
  da: ["dal", "dallo", "dalla", "dai", "dagli", "dalle", "dall’"],
  su: ["sul", "sullo", "sulla", "sui", "sugli", "sulle", "sull’"],
  in: ["nel", "nello", "nella", "nei", "negli", "nelle", "nell’"],
};
/** `to` with `from`'s first letter's case. */
const caseOf = (from: string, to: string) => (from.charAt(0) !== from.charAt(0).toLowerCase() ? to.charAt(0).toUpperCase() + to.slice(1) : to);
const GRAMMAR: Partial<Record<OtherLocale, (s: string) => string>> = {
  fr: (s) =>
    s
      .replace(new RegExp(`\\b([Ll])e (?=[${VOWEL}])`, "g"), "$1’")
      .replace(/\b([Dd])e le /g, "$1u ")
      .replace(/\b([Dd])e les /g, "$1es ")
      .replace(/(^|[^\p{L}])([Àà]) le /gu, (_m, b: string, a: string) => b + caseOf(a, "au "))
      .replace(/(^|[^\p{L}])([Àà]) les /gu, (_m, b: string, a: string) => b + caseOf(a, "aux ")),
  es: (s) => s.replace(/\b([Dd])e el /g, "$1el ").replace(/\b([Aa]) el /g, "$1l "),
  it: (s) =>
    s
      .replace(/\b([Ii])l (?=[Ss][^aeiouAEIOU\s]|[Zz]|[Gg]n|[Pp]s|[XxYy])/g, (_m, i: string) => caseOf(i, "lo "))
      .replace(new RegExp(`\\b([Ii]l|[Ll]o) (?=[${VOWEL}])`, "g"), (m) => caseOf(m, "l’"))
      .replace(/\b([Dd]i|[Aa]|[Dd]a|[Ss]u|[Ii]n) (il |lo |la |i |gli |le |l’)/g, (m, p: string, art: string) => {
        const to = IT_PREP[p.toLowerCase()]?.[IT_ART.indexOf(art.trim())];
        return to ? caseOf(p, to) + (art.endsWith(" ") ? " " : "") : m;
      }),
};

export class LocalLogFormatter extends LogFormatter {
  private readonly t: LogT;
  private readonly names: BattleNames;
  private readonly locale: OtherLocale;

  constructor(perspective: "p1" | "p2" | "p3" | "p4", tracker: Tracker, locale: OtherLocale, messages: Tree, names: BattleNames) {
    super(perspective, tracker);
    this.locale = locale;
    this.t = translator(battleLog, locale, messages);
    this.names = names;
  }

  /** A template of the language's table, by "id.type", its placeholders marked. */
  private text(key: string, marked = true): string {
    return this.t(key as Parameters<LogT>[0], marked ? MARKED : PLAIN);
  }

  override template(type: string, ...namespaces: (string | undefined)[]): string {
    const en = battleLog.en as unknown as Tree;
    for (const namespace of namespaces) {
      if (!namespace) continue;
      if (namespace === "OWN") return `${this.text(`_.${type}Own`)}\n`;
      if (namespace === "NODEFAULT") return "";
      let id: string = LogFormatter.effectId(namespace);
      const ref = (REFS as Refs)[id]?.[type];
      if (ref !== undefined || has(en, id, type)) {
        // Showdown's table: "#.start" is this entry's own start text; "#psn" is Poison's text of the same kind.
        if (ref?.charAt(1) === ".") type = ref.slice(2);
        else if (ref) id = ref.slice(1);
        if (!has(en, id, type)) return "";
        let key = `${id}.${type}`;
        for (let i = 8; i >= this.gen; i--) if (has(en, id, `${type}Gen${i}`)) key = `${id}.${type}Gen${i}`;
        return `${this.text(key)}\n`;
      }
    }
    if (!has(en, "_", type)) return "";
    return `${this.text(`_.${type}`)}\n`;
  }

  override pokemon(pokemon: Parameters<LogFormatter["pokemon"]>[0]): string {
    if (!pokemon) return "";
    const side = pokemon.slice(0, 2);
    if (!["p1", "p2", "p3", "p4"].includes(side)) return `???pokemon:${pokemon}???`;
    const name = this.names.pokemon(this.pokemonName(pokemon));
    const near = side === this.perspective || side === LogFormatter.allyID(side as "p1");
    return this.text(near ? "_.pokemon" : "_.opposingPokemon", false).replace("[NICKNAME]", name).replace(/\$/g, "$$$$");
  }

  override pokemonFull(pokemon: Parameters<LogFormatter["pokemonFull"]>[0], details: Parameters<LogFormatter["pokemonFull"]>[1]): [string, string] {
    const nickname = this.pokemonName(pokemon);
    const species = details.split(",")[0];
    const own = this.names.species(species);
    const name = this.names.pokemon(nickname);
    if (nickname === species || name === own) return [pokemon.slice(0, 2), `**${own}**`];
    return [pokemon.slice(0, 2), `${name} (**${own}**)`];
  }

  override team(side: string, them = false): string {
    const s = side.slice(0, 2);
    const us = s === this.perspective || s === LogFormatter.allyID(s as "p1");
    return this.text(us !== them ? "_.team" : "_.opposingTeam", false);
  }

  override party(side: string): string {
    const s = side.slice(0, 2);
    return this.text(s === this.perspective || s === LogFormatter.allyID(s as "p1") ? "_.party" : "_.opposingParty", false);
  }

  override ability(name: string | undefined, holder: Parameters<LogFormatter["ability"]>[1]): string {
    if (!name) return "";
    return `${this.text("_.abilityActivation").replace("[POKEMON]", this.pokemon(holder)).replace("[ABILITY]", this.effect(name))}\n`;
  }

  override stat(stat: Parameters<LogFormatter["stat"]>[0]): string {
    const id = stat || "stats";
    return has(battleLog.en as unknown as Tree, id, "statName") ? this.text(`${id}.statName`, false) : `???stat:${stat}???`;
  }

  /** Every name the line took in, in the language; then its grammar, and a capital at the start of each line. */
  override fixLowercase(input: string): string {
    let out = input.replace(MARK_RE, (_m, kind: Kind, value: string) => this.localName(kind, value));
    out = GRAMMAR[this.locale]?.(out) ?? out;
    // A line may start with an article a name or a stat brought in ("el Charizard rival…", "l’Attaque du…").
    return out.replace(/(^|\n)((?: {2})?[([]?[¡¿]?)(\p{Ll})/gu, (_m, nl: string, lead: string, c: string) => nl + lead + c.toUpperCase());
  }

  private localName(kind: Kind, value: string): string {
    switch (kind) {
      case "MOVE":
        return this.names.move(value);
      case "ITEM":
        return this.names.item(value);
      case "ABILITY":
        return this.names.ability(value);
      case "TYPE":
        return this.names.type(value);
      case "SPECIES":
        return this.names.species(value);
      case "EFFECT":
        return this.names.effect(value);
      case "NICKNAME":
        return this.names.pokemon(value);
      case "STAT":
        return STAT_IDS.has(value) ? this.stat(value as "atk") : value;
      default:
        return value;
    }
  }

  /** A line of the battle's own that isn't Showdown's table's (PokéIQ's notes, the timer, the server's messages). */
  note(key: string, values: Record<string, string | number>): string {
    return this.t(`pokeiq.${key}` as Parameters<LogT>[0], values);
  }
}

/** The server's English lines (the turn timer, forfeits and the like), as the language says them. */
const SERVER: [RegExp, string, string[]][] = [
  [/^(.+) has (\d+) seconds left this turn\.$/, "secondsLeftTurn", ["NAME", "N"]],
  [/^(.+) has (\d+) seconds left\.$/, "secondsLeft", ["NAME", "N"]],
  [/^Battle timer is ON: inactive players will automatically lose when time's up\. \(requested by (.+)\)$/, "timerOn", ["NAME"]],
  [/^(.+) also wants the timer to be on\.$/, "timerAlso", ["NAME"]],
  [/^(.+) no longer wants the timer on, but the timer is staying on because (.+) still does\.$/, "timerStays", ["NAME", "OTHERS"]],
  [/^Battle timer is now OFF\.$/, "timerOff", []],
  [/^All players are inactive\.$/, "allInactive", []],
  [/^(.+) lost due to inactivity\.$/, "lostInactive", ["NAME"]],
  [/^(.+) forfeited\.$/, "forfeited", ["NAME"]],
  [/^Sleep Clause Mod activated\.$/, "sleepClause", []],
  [/^Freeze Clause activated\.$/, "freezeClause", []],
  [/^This battle cannot progress\. Endless Battle Clause activated!$/, "endlessBattle", []],
];

/** What the battle screen's model needs to write its log in another language (src/components/battle/play/model.ts). */
export interface LogLocal {
  formatter(perspective: "p1" | "p2" | "p3" | "p4", tracker: Tracker): LocalLogFormatter;
  /** One of PokéIQ's own lines (pokeiq.* in the table). */
  note(key: string, values?: Record<string, string | number>): string;
  /** A line the server wrote in English, in the language (as it came when it's none we know). */
  server(text: string): string;
  /** A format rule's line ("Species Clause: Limit one of each Pokémon"), in the language where we know the rule. */
  rule(text: string): string;
  /** A status condition's short label ("par" → "PAR"). */
  status(id: string): string;
  names: BattleNames;
}

const packs = new Map<OtherLocale, Promise<LogLocal>>();

const MESSAGES: Record<OtherLocale, () => Promise<{ default: unknown }>> = {
  ja: () => import("@/messages/ja/battle-log.json"),
  es: () => import("@/messages/es/battle-log.json"),
  fr: () => import("@/messages/fr/battle-log.json"),
  de: () => import("@/messages/de/battle-log.json"),
  it: () => import("@/messages/it/battle-log.json"),
};

/** Everything for one language's log (its text table and names), from already loaded messages. */
export function logLocal(locale: OtherLocale, messages: Tree, names: BattleNames): LogLocal {
  const t: LogT = translator(battleLog, locale, messages);
  const note = (key: string, values: Record<string, string | number> = {}) => t(`pokeiq.${key}` as Parameters<LogT>[0], values);
  return {
    formatter: (perspective, tracker) => new LocalLogFormatter(perspective, tracker, locale, messages, names),
    note,
    server(text) {
      for (const [re, key, args] of SERVER) {
        const m = re.exec(text);
        if (m) return note(key, Object.fromEntries(args.map((a, i) => [a, m[i + 1]])));
      }
      return text;
    },
    rule(text) {
      const m = /^([^:]+): (.*)$/.exec(text);
      const id = m ? nameKey(m[1]) : "";
      if (id === "itemclause") return note("rules.itemclause", { N: /(\d+)/.exec(m![2])?.[1] ?? "1" });
      return id && Object.hasOwn(battleLog.en.pokeiq.rules, id) ? note(`rules.${id}`) : text;
    },
    status: (id) => (Object.hasOwn(battleLog.en.pokeiq.status, id) ? note(`status.${id}`) : id.toUpperCase()),
    names,
  };
}

/** The language's log, loaded once. */
export function loadLogLocal(locale: OtherLocale): Promise<LogLocal> {
  let p = packs.get(locale);
  if (!p) {
    p = Promise.all([MESSAGES[locale](), loadBattleNames(locale)]).then(([m, names]) => logLocal(locale, m.default as Tree, names));
    p.catch(() => packs.delete(locale));
    packs.set(locale, p);
  }
  return p;
}
