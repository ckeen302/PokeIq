import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Protocol } from "@pkmn/protocol";
import { SimSession, randomTeam, type SideID } from "@/lib/server/battle-engine/engine";
import { randomChoice } from "@/lib/server/battle-engine/choices";
import { BattleModel, endNote, hpNote, isSilentLine } from "@/components/battle/play/model";
import { logLocal, type LogLocal } from "@/lib/battle/log/local";
import { battleNames, type BattleNameTable } from "@/lib/battle/log/names";
import type { OtherLocale } from "@/i18n/config";
import type { Tree } from "@/i18n/catalog";
import ja from "@/messages/ja/battle-log.json";
import es from "@/messages/es/battle-log.json";
import fr from "@/messages/fr/battle-log.json";
import de from "@/messages/de/battle-log.json";
import it_ from "@/messages/it/battle-log.json";

/**
 * The battle log in every language: real engine battles (and a hand-written protocol covering the rarer lines) go
 * through each language's formatter, and no line may carry any of the English table's words, an unfilled
 * placeholder or a leftover marker. Every key the formatter can ask for exists in every language (the message check
 * guarantees the files match English key for key; here the formatter really reads them).
 */

const MESSAGES: Record<OtherLocale, unknown> = { ja, es, fr, de, it: it_ };
const LOCALES = Object.keys(MESSAGES) as OtherLocale[];

const pack = (locale: OtherLocale): LogLocal => {
  const table = JSON.parse(readFileSync(`src/data/i18n/${locale}/battle-names.json`, "utf8")) as BattleNameTable;
  return logLocal(locale, MESSAGES[locale] as Tree, battleNames(table));
};

/** The English table's own words: every run of text between its placeholders that has a word in it. */
const ENGLISH = (() => {
  const out = new Set<string>();
  const walk = (tree: Record<string, unknown>) => {
    for (const v of Object.values(tree)) {
      if (typeof v === "object" && v) walk(v as Record<string, unknown>);
      else if (typeof v === "string")
        for (const piece of v.split(/\{[A-Z]+\}|\n|\*\*/)) {
          const p = piece.trim().replace(/^[([]+|[)\]]+$/g, "");
          if (p.length >= 6 && /[a-z]{3}/.test(p)) out.add(p);
        }
    }
  };
  walk(JSON.parse(readFileSync("src/messages/en/battle-log.json", "utf8")));
  return [...out].map((p) => ({ p, re: new RegExp(`(^|[^\\p{L}])${p.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}($|[^\\p{L}])`, "u") }));
})();

function englishIn(text: string): string | undefined {
  if (/\[[A-Z]+\]|[\u0001-\u0003]|\?\?\?|undefined/.test(text)) return text;
  return ENGLISH.find(({ re }) => re.test(text))?.p;
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Req = Parameters<typeof randomChoice>[0] & {
  active?: { canMegaEvo?: boolean; canDynamax?: boolean; canZMove?: unknown[]; canTerastallize?: string }[];
};

function choose(req: Req, doubles: boolean, rand: () => number): string {
  const base = randomChoice(req, doubles, rand);
  if (req.forceSwitch || req.teamPreview || !req.active?.[0]) return base;
  const parts = base.split(", ");
  const act = req.active[0];
  if (/^move \d+/.test(parts[0])) {
    if (act.canMegaEvo) parts[0] += " mega";
    else if (act.canDynamax) parts[0] += " dynamax";
    else if (act.canTerastallize && rand() < 0.3) parts[0] += " terastallize";
    else if (act.canZMove) {
      const z = act.canZMove.findIndex(Boolean);
      if (z >= 0) parts[0] = parts[0].replace(/^move \d+/, `move ${z + 1}`) + " zmove";
    }
  }
  return parts.join(", ");
}

function play(formatid: string, seed: number): Record<SideID, string[]> {
  const rand = mulberry(seed * 7919 + formatid.length);
  const s = (n: number) => `${seed},${n},${seed + n},9`;
  const session = SimSession.create({ formatid, seed: s(1), p1: { name: "Red", team: randomTeam(formatid, s(2)) }, p2: { name: "Blue", team: randomTeam(formatid, s(3)) } });
  const doubles = formatid.includes("doubles");
  const lines: Record<SideID, string[]> = { p1: [], p2: [] };
  const take = () => {
    const r = session.result().lines;
    lines.p1.push(...r.p1);
    lines.p2.push(...r.p2);
  };
  take();
  for (let i = 0; i < 300 && !session.ended; i++) {
    let chose = false;
    for (const side of ["p1", "p2"] as SideID[]) {
      const req = session.pending(side) as Req | null;
      if (req) {
        chose = true;
        if (!session.choose(side, choose(req, doubles, rand))) session.choose(side, randomChoice(req, doubles, rand));
      }
    }
    take();
    if (!chose) break;
  }
  return lines;
}

/** Lines real battles rarely reach: hazards, screens, weather, terrains, items, abilities, and the server's notes. */
const SAMPLE = [
  "|player|p1|Red||",
  "|player|p2|Blue||",
  "|gametype|doubles",
  "|gen|9",
  "|tier|[Gen 9] Random Doubles Battle",
  "|start",
  "|switch|p1a: Pikachu|Pikachu, L88, M|100/100",
  "|switch|p1b: Sparky|Raichu, L88, F|76/100 par",
  "|switch|p2a: Garchomp|Garchomp, L80, M|61/100 brn",
  "|switch|p2b: Abra|Abra, L80, M|100/100",
  "|turn|1",
  "|move|p1a: Pikachu|Thunderbolt|p2b: Abra",
  "|-supereffective|p2b: Abra",
  "|-crit|p2b: Abra",
  "|-damage|p2b: Abra|10/100",
  "|move|p2a: Garchomp|Earthquake|p1a: Pikachu|[spread] p1a,p1b",
  "|-supereffective|p1a: Pikachu",
  "|-resisted|p1b: Sparky",
  "|-damage|p1a: Pikachu|0 fnt",
  "|-damage|p1b: Sparky|30/100 par",
  "|faint|p1a: Pikachu",
  "|-weather|SunnyDay|[from] ability: Drought|[of] p2a: Garchomp",
  "|-weather|SunnyDay|[upkeep]",
  "|-weather|none",
  "|-fieldstart|move: Electric Terrain|[from] ability: Electric Surge|[of] p1b: Sparky",
  "|-fieldend|move: Electric Terrain",
  "|-fieldstart|move: Trick Room|[of] p2b: Abra",
  "|-sidestart|p2: Blue|move: Stealth Rock",
  "|-sidestart|p1: Red|Reflect",
  "|-sideend|p1: Red|Reflect",
  "|-sidestart|p2: Blue|move: Spikes",
  "|-damage|p2a: Garchomp|40/100 brn|[from] Stealth Rock",
  "|-boost|p2a: Garchomp|atk|2",
  "|-unboost|p1b: Sparky|spe|1",
  "|-boost|p2a: Garchomp|spe|0",
  "|-status|p2b: Abra|tox",
  "|-damage|p2b: Abra|5/100 tox|[from] psn",
  "|-status|p1b: Sparky|slp|[from] move: Rest",
  "|cant|p1b: Sparky|slp",
  "|-curestatus|p1b: Sparky|slp|[msg]",
  "|-heal|p2a: Garchomp|50/100 brn|[from] item: Leftovers",
  "|-damage|p2a: Garchomp|44/100 brn|[from] brn",
  "|-item|p2a: Garchomp|Choice Scarf|[from] ability: Frisk|[of] p1b: Sparky",
  "|-enditem|p2b: Abra|Focus Sash",
  "|-enditem|p1b: Sparky|Sitrus Berry|[eat]",
  "|-ability|p2b: Abra|Intimidate|boost",
  "|-start|p1b: Sparky|Substitute",
  "|-activate|p1b: Sparky|Substitute|[damage]",
  "|-end|p1b: Sparky|Substitute",
  "|-start|p2a: Garchomp|confusion",
  "|-activate|p2a: Garchomp|confusion",
  "|-damage|p2a: Garchomp|30/100 brn|[from] confusion",
  "|-end|p2a: Garchomp|confusion",
  "|-start|p1b: Sparky|typechange|Water|[from] move: Soak",
  "|-terastallize|p2a: Garchomp|Steel",
  "|-singleturn|p1b: Sparky|Protect",
  "|-activate|p1b: Sparky|move: Protect",
  "|-immune|p2a: Garchomp",
  "|-miss|p2b: Abra|p1b: Sparky",
  "|-fail|p2b: Abra",
  "|-hitcount|p1b: Sparky|3",
  "|-prepare|p2a: Garchomp|Solar Beam",
  "|-message|Blue forfeited.",
  "|inactive|Blue has 30 seconds left this turn.",
  "|inactive|Battle timer is ON: inactive players will automatically lose when time's up. (requested by Red)",
  "|inactiveoff|Battle timer is now OFF.",
  "|-message|All players are inactive.",
  "|-message|Red lost due to inactivity.",
  "|drag|p1b: Raichu|Raichu, L88, F|20/100",
  "|switch|p1a: Charizard|Charizard, L80, M|100/100",
  "|detailschange|p1a: Charizard|Charizard-Mega-Y, L80, M",
  "|-mega|p1a: Charizard|Charizard|Charizardite Y",
  "|win|Red",
];

/** Showdown's format rules: the descriptions are the simulator's own, in English (listed, not translated). */


describe("battle log in every language", () => {
  for (const locale of LOCALES) {
    it(`${locale}: no English in any line`, () => {
      const local = pack(locale);
      const leaks = new Map<string, string>();
      const check = (lines: string[], me: SideID) => {
        const model = new BattleModel(me, local);
        const english = new BattleModel(me);
        for (const line of lines) {
          const step = model.feed(line);
          const en = english.feed(line);

          const { args, kwArgs } = Protocol.parseBattleLine(line) as unknown as { args: string[]; kwArgs: Record<string, unknown> };
          // Showdown's hints are the simulator's own sentences (English).
          if (args[0] === "-hint") continue;
          const text = step?.text.trim() ?? "";
          // Writes a line exactly where English writes one.
          if (!!en?.text.trim() !== !!text && !isSilentLine(args, kwArgs, 9)) leaks.set(`${args[0]} (no text)`, line);
          const bad = text && englishIn(text);
          if (bad) leaks.set(`${line} → ${text}`, bad);
        }
      };
      check(SAMPLE, "p1");
      check(SAMPLE, "p2");
      for (const formatid of ["gen9randombattle", "gen9randomdoublesbattle", "gen8randombattle", "gen7randombattle", "gen4randombattle", "gen1randombattle"]) {
        for (const seed of [1, 2]) {
          const lines = play(formatid, seed);
          check(lines.p1, "p1");
          check(lines.p2, "p2");
        }
      }
      expect([...leaks.entries()].slice(0, 20)).toEqual([]);
    }, 180_000);
  }

  it("writes the games' own phrasing", () => {
    const lines = ["|player|p1|Red||", "|player|p2|Blue||", "|gen|9", "|start", "|switch|p1a: Pikachu|Pikachu, L88, M|100/100", "|switch|p2a: Charizard|Charizard, L80, M|100/100"];
    const said = (locale: OtherLocale, more: string[]) => {
      const model = new BattleModel("p1", pack(locale));
      for (const l of lines) model.feed(l);
      return more.map((l) => model.feed(l)?.text.trim());
    };
    expect(said("ja", ["|move|p1a: Pikachu|Thunderbolt|p2a: Charizard", "|-supereffective|p2a: Charizard", "|faint|p2a: Charizard"])).toEqual(["ピカチュウの**10まんボルト**！", "効果は抜群だ！", "相手のリザードンは倒れた！"]);
    expect(said("fr", ["|move|p2a: Charizard|Flamethrower|p1a: Pikachu", "|-boost|p2a: Charizard|atk|1"])).toEqual(["Le Dracaufeu adverse utilise **Lance-Flammes** !", "L’Attaque du Dracaufeu adverse augmente !"]);
    expect(said("es", ["|move|p2a: Charizard|Flamethrower|p1a: Pikachu", "|-boost|p2a: Charizard|atk|1"])).toEqual(["¡El Charizard rival usó **Lanzallamas**!", "¡El Ataque del Charizard rival aumentó!"]);
    expect(said("de", ["|move|p1a: Pikachu|Thunderbolt|p2a: Charizard", "|faint|p2a: Charizard"])).toEqual(["Pikachu setzt **Donnerblitz** ein!", "Glurak (Gegner) wurde besiegt!"]);
    expect(said("it", ["|move|p1a: Pikachu|Thunderbolt|p2a: Charizard", "|faint|p2a: Charizard"])).toEqual(["Pikachu usa **Fulmine**!", "Charizard avversario è esausto!"]);
  });

  it("keeps a Pokémon's own nickname, and names its species", () => {
    const model = new BattleModel("p1", pack("ja"));
    for (const l of ["|player|p1|Red||", "|player|p2|Blue||", "|gen|9", "|start"]) model.feed(l);
    expect(model.feed("|switch|p1a: Sparky|Raichu, L88, F|76/100 par")?.text.trim()).toBe("ゆけっ！Sparky (**ライチュウ**)！（76%・まひ）");
  });

  it("says the screen's own lines in the language", () => {
    const local = pack("de");
    expect(hpNote("54/100 par", local)).toBe("54 % · PAR");
    expect(endNote({ players: [{ name: "Red" }, { name: "Blue" }], end: { winner: 1, reason: "forfeit" } }, local)).toBe("Red hat aufgegeben.");
    // English is untouched.
    expect(hpNote("54/100 par")).toBe("54% · PAR");
  });
});
