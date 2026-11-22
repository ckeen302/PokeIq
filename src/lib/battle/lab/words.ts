import { translator, type Translator } from "@/i18n/catalog";
import type { Locale } from "@/i18n/config";
import { formatNumber } from "@/i18n/format";
import battleLab from "@/messages/battle-lab";
import type { BattleNames } from "@/components/battle/use-battle-names";
import type { SetupIssue } from "./setup";
import { count, margin, medianTurns, pct, wilson, type LabTotals, type Pair } from "./stats";

/**
 * The Battle Lab's words in the page's language: numbers, the one-line summary, why a setup can't run, and the
 * simulator's own messages (the workers report in English; the page translates what it recognises). English pages
 * get exactly the English the Lab always showed.
 */

export type LabT = Translator<typeof battleLab.en>;
export type LabNames = Pick<BattleNames, "species" | "move" | "item" | "ability" | "nature">;

export interface LabNumbers {
  /** 1234 → "1,234" (en) / "1.234" (de). */
  count(n: number): string;
  /** 0.6321 → "63.2%" (en) / "63,2 %" (fr). */
  pct(x: number, digits?: number): string;
  /** A number with a fixed number of decimals. */
  fixed(x: number, digits: number): string;
}

const EN_NUMBERS: LabNumbers = { count, pct, fixed: (x, digits) => x.toFixed(digits) };

export function labNumbers(locale: Locale): LabNumbers {
  if (locale === "en") return EN_NUMBERS;
  return {
    count: (n) => formatNumber(n, locale),
    pct: (x, digits = 1) => formatNumber(x, locale, { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits }),
    fixed: (x, digits) => formatNumber(x, locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }),
  };
}

/** The one-line summary (stats.summaryLine) in the page's language. */
export function labSummary(totals: LabTotals, labels: Pair<string>, num: LabNumbers = EN_NUMBERS, t: LabT = translator(battleLab, "en", undefined)): string {
  if (!totals.battles) return t("results.none");
  const fav: 0 | 1 = totals.wins[1] > totals.wins[0] ? 1 : 0;
  const ci = wilson(totals.wins[fav], totals.battles);
  const median = medianTurns(totals);
  const values = {
    p: num.pct(ci.p),
    m: num.pct(margin(ci)),
    battles: totals.battles,
    draws: totals.draws ? num.pct(totals.draws / totals.battles) : "none",
    median,
    turns: Number.isInteger(median) ? String(median) : num.fixed(median, 1),
  };
  return totals.wins[0] === totals.wins[1] ? t("results.even", values) : t("results.fav", { ...values, side: labels[fav] });
}

/** A side's name: "Side A" / "Side B". */
export function sideName(side: 0 | 1, t: LabT = translator(battleLab, "en", undefined)): string {
  return side === 0 ? t("side.a") : t("side.b");
}

/** Why the setup can't run (setup.setupProblem's sentence) in the page's language. */
export function setupIssueText(issue: SetupIssue, names: LabNames, t: LabT = translator(battleLab, "en", undefined)): string {
  const side = sideName(issue.side, t);
  if (issue.key === "needsMove") return t("msg.needsMove", { who: t("msg.who", { side, name: issue.mon.set.name || names.species(issue.mon.set.species) }) });
  return issue.key === "needsMon" ? t("msg.needsMon", { side }) : t("msg.needsTwo", { side });
}

// ---------------------------------------------------------------------------
// The simulator's messages (simulate.ts, pool.ts, lab.worker.ts, use-lab-run.ts)
// ---------------------------------------------------------------------------

type MsgKey = keyof (typeof battleLab.en)["msg"];
type Kind = "side" | "mon" | "species" | "move" | "item" | "ability" | "nature" | "raw" | "status";

/** Each English sentence the Lab's simulator code can produce, and what its parts are. */
const MESSAGES: [RegExp, Exclude<MsgKey, "who">, [string, Kind][]][] = [
  [/^(Side [AB]) needs a Pokémon\.$/, "needsMon", [["side", "side"]]],
  [/^(Side [AB]) needs two Pokémon for a double battle\.$/, "needsTwo", [["side", "side"]]],
  [/^(Side [AB])'s (.+) needs at least one move\.$/, "needsMove", [["side", "side"], ["mon", "mon"]]],
  [/^(Side [AB])'s (.+?): there's no Pokémon called "(.*)" in Gen (\d)\.$/, "noSpecies", [["side", "side"], ["mon", "mon"], ["name", "raw"], ["gen", "raw"]]],
  [/^(Side [AB])'s (.+?): (.+) is a forme it only takes in battle\. Start it as (.+)\.$/, "battleOnly", [["side", "side"], ["mon", "mon"], ["forme", "species"], ["base", "species"]]],
  [/^(Side [AB])'s (.+?): there's no move called "(.*)" in Gen (\d)\.$/, "noMove", [["side", "side"], ["mon", "mon"], ["name", "move"], ["gen", "raw"]]],
  [/^(Side [AB])'s (.+?): Gen 1 has no held items, so it holds nothing\.$/, "gen1Item", [["side", "side"], ["mon", "mon"]]],
  [/^(Side [AB])'s (.+?): there's no item called "(.*)" in Gen (\d)\.$/, "noItem", [["side", "side"], ["mon", "mon"], ["name", "item"], ["gen", "raw"]]],
  [/^(Side [AB])'s (.+?): there's no ability called "(.*)" in Gen (\d)\.$/, "noAbility", [["side", "side"], ["mon", "mon"], ["name", "ability"], ["gen", "raw"]]],
  [/^(Side [AB])'s (.+?): there's no nature called "(.*)"\.$/, "noNature", [["side", "side"], ["mon", "mon"], ["name", "nature"]]],
  [/^(Side [AB])'s (.+) can't start asleep\.$/, "cantSleep", [["side", "side"], ["mon", "mon"]]],
  [/^(Side [AB])'s (.+) can't start with that status \((\w+)\)\.$/, "cantStatus", [["side", "side"], ["mon", "mon"], ["status", "status"]]],
  [/^The weather didn't take\.$/, "weather", []],
  [/^The terrain didn't take\.$/, "terrain", []],
  [/^The simulator stopped responding\. Try again\.$/, "stalled", []],
  [/^The simulator stopped: ([\s\S]*)$/, "stopped", [["error", "raw"]]],
  [/^The run failed\.$/, "failed", []],
  [/^Couldn't replay that battle\.$/, "replayFailed", []],
];

const STATUSES = new Set(["brn", "par", "slp", "frz", "psn", "tox"]);

/** Which of the Lab's messages a sentence is, and its parts (null for anything else, such as a browser's own error). */
export function parseLabMessage(text: string): { key: Exclude<MsgKey, "who">; parts: Record<string, string>; kinds: Record<string, Kind> } | null {
  for (const [re, key, spec] of MESSAGES) {
    const m = re.exec(text);
    if (!m) continue;
    const parts: Record<string, string> = {};
    const kinds: Record<string, Kind> = {};
    spec.forEach(([name, kind], i) => {
      parts[name] = m[i + 1];
      kinds[name] = kind;
    });
    return { key, parts, kinds };
  }
  return null;
}

/** One of the simulator's English sentences in the page's language (untouched on English pages, or when it isn't one of ours). */
export function labMessage(text: string, names: LabNames, t: LabT = translator(battleLab, "en", undefined)): string {
  if (t.locale === "en") return text;
  const parsed = parseLabMessage(text);
  if (!parsed) return text;
  const values: Record<string, string> = {};
  for (const [name, raw] of Object.entries(parsed.parts)) {
    const kind = parsed.kinds[name];
    if (kind === "side") values.side = t(raw === "Side A" ? "side.a" : "side.b");
    else if (kind === "mon" || kind === "species") values[name] = names.species(raw);
    else if (kind === "move") values[name] = names.move(raw);
    else if (kind === "item") values[name] = names.item(raw);
    else if (kind === "ability") values[name] = names.ability(raw);
    else if (kind === "nature") values[name] = names.nature(raw);
    else if (kind === "status") values[name] = STATUSES.has(raw) ? t(`status.${raw as "brn"}`) : raw;
    else values[name] = raw;
  }
  if ("mon" in values) values.who = t("msg.who", { side: values.side, name: values.mon });
  return t(`msg.${parsed.key}`, values);
}
