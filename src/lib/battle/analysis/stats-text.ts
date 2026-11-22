import { composeShare } from "@/lib/share/text";
import { keySwings, pct, swings, type Swing, type WinPoint } from "./maths";
import type { BattleStats, MonStats, NoteKind, SideLuck, StatsSide, TurnNote } from "./stats-types";
import { translator, type Translator } from "@/i18n/catalog";
import battleAnalysis from "@/messages/battle-analysis";

/** The analysis' words in the page's language. */
export type AnalysisT = Translator<typeof battleAnalysis.en>;

/**
 * The words for a battle's stats, from one player's side: the turning
 * points (the biggest swings in the win chance, each with the cause the log
 * shows, or plainly what happened when it shows none), the luck verdict,
 * the MVP and the share card. Light on purpose: the analysis panel loads
 * this, not the simulator.
 */

const foeOf = (s: StatsSide): StatsSide => (s === 0 ? 1 : 0);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "your Garchomp" or "Blue's Garchomp". */
const whose = (stats: BattleStats, viewer: StatsSide, side: StatsSide, mon: string) => (side === viewer ? `your ${mon}` : `${stats.players[side]}'s ${mon}`);

const STATUS_WORDS: Record<string, string> = { brn: "burned", par: "paralyzed", psn: "poisoned", tox: "badly poisoned", slp: "put to sleep", frz: "frozen" };
const WEATHER_WORDS: Record<string, string> = { raindance: "rain", primordialsea: "heavy rain", sunnyday: "harsh sunlight", desolateland: "extremely harsh sunlight", sandstorm: "a sandstorm", hail: "hail", snow: "snow", snowscape: "snow", deltastream: "strong winds" };
const toId = (s: string | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Which side a note was good for. */
function helped(n: TurnNote): StatsSide {
  // A miss is good for the side that was missed; everything else for the side that did it.
  return n.kind === "miss" ? foeOf(n.side) : n.side;
}

/** How much a kind of note explains a swing (higher first). */
const WEIGHT: Partial<Record<NoteKind, number>> = { crit: 10, miss: 9, flinch: 8, ko: 7, status: 6, proc: 5, hazard: 4, weather: 3, terrain: 3, tera: 2 };

/** The note that best explains a swing toward `good` (the side the swing helped), or null when the log shows none. */
export function causeOf(notes: readonly TurnNote[], good: StatsSide): TurnNote | null {
  let best: TurnNote | null = null;
  for (const n of notes) {
    const w = WEIGHT[n.kind];
    if (!w || helped(n) !== good) continue;
    // Weather nobody can be pinned on helps no side in particular.
    if ((n.kind === "weather" || n.kind === "terrain") && !n.mon) continue;
    if (!best || w > WEIGHT[best.kind]!) best = n;
  }
  return best;
}

function causeText(stats: BattleStats, viewer: StatsSide, n: TurnNote, notes: readonly TurnNote[]): string {
  const foe = foeOf(n.side);
  switch (n.kind) {
    case "crit": {
      const ko = notes.find((k) => k.kind === "ko" && k.side === n.side && k.target === n.target && k.mon === n.mon);
      if (ko) return `${whose(stats, viewer, n.side, n.mon)} knocking out ${whose(stats, viewer, foe, n.target ?? "")} with a critical ${n.move}`;
      return `a critical ${n.move} from ${whose(stats, viewer, n.side, n.mon)}`;
    }
    case "miss":
      return `${whose(stats, viewer, n.side, n.mon)} missing ${n.move} (${pct(1 - (n.chance ?? 0))} to hit)`;
    case "flinch":
      return `${whose(stats, viewer, foe, n.target ?? "")} flinching from ${n.move} (${pct(n.chance ?? 0)} chance)`;
    case "ko":
      if (n.detail) return `${whose(stats, viewer, foe, n.target ?? "")} going down to ${n.detail}`;
      if (!n.mon) return `${whose(stats, viewer, foe, n.target ?? "")} fainting`;
      return `${whose(stats, viewer, n.side, n.mon)} knocking out ${whose(stats, viewer, foe, n.target ?? "")}`;
    case "status": {
      const how = n.move ? ` by ${n.move}` : "";
      const odds = n.chance ? ` (${pct(n.chance)} chance)` : "";
      return `${whose(stats, viewer, foe, n.target ?? "")} being ${STATUS_WORDS[n.detail ?? ""] ?? "statused"}${how}${odds}`;
    }
    case "proc":
    {
      // "lowered Drifblim's Sp. Def" → "lowering your Drifblim's Sp. Def".
      let what = n.detail ?? "";
      if (n.target) what = what.replace(`${n.target}'s`, `${whose(stats, viewer, foe, n.target)}'s`).replace(/^confused (.+)$/, () => `confusing ${whose(stats, viewer, foe, n.target!)}`);
      what = what.replace(/^lowered /, "lowering ").replace(/^raised /, "raising ");
      return `${whose(stats, viewer, n.side, n.mon)}'s ${n.move} ${what}${n.chance ? ` (${pct(n.chance)} chance)` : ""}`;
    }
    case "hazard":
      return `${n.side === viewer ? "you" : stats.players[n.side]} setting up ${n.detail}`;
    case "weather":
      return `${WEATHER_WORDS[toId(n.detail)] ?? n.detail} starting${n.mon ? ` (from ${whose(stats, viewer, n.side, n.mon)})` : ""}`;
    case "terrain":
      return `${n.detail} starting${n.mon ? ` (from ${whose(stats, viewer, n.side, n.mon)})` : ""}`;
    case "tera":
      return `${n.side === viewer ? "you" : stats.players[n.side]} Terastallizing ${n.mon} into ${n.detail}`;
    default:
      return "";
  }
}

/** "you used Earthquake and Blue switched to Corviknight", then any KOs: the turn as it happened, with no cause claimed. */
export function plainTurn(stats: BattleStats, viewer: StatsSide, notes: readonly TurnNote[]): string {
  const choices = plainChoices(stats, viewer, notes);
  const kos = notes.filter((n) => n.kind === "ko").map((n) => causeText(stats, viewer, n, notes).replace(" knocking out ", " knocked out ").replace(/ going down to /, " went down to ").replace(/ fainting$/, " fainted"));
  return [choices, ...kos].filter(Boolean).join(", and ");
}

/** Doubles: one move with its targets ("your Garchomp used Earthquake on both foes and your Rotom", "Blue's Amoonguss used Spore on your Garchomp"). */
function doublesMove(stats: BattleStats, viewer: StatsSide, n: TurnNote): string {
  const foe = foeOf(n.side);
  const who = whose(stats, viewer, n.side, n.mon);
  const partner = (species: string) => (n.side === viewer ? `your ${species}` : `its partner ${species}`);
  let on = "";
  if (n.spread?.length) {
    const foes = n.spread.filter((t) => !t.ally);
    const allies = n.spread.filter((t) => t.ally);
    on = foes.length === 2 ? (n.side === viewer ? "both foes" : "both of your Pokémon") : foes.map((t) => whose(stats, viewer, foe, t.species)).join(" and ");
    if (allies.length) on += `${on ? " and " : ""}${allies.map((t) => partner(t.species)).join(" and ")}`;
  } else if (n.target) on = whose(stats, viewer, foe, n.target);
  else if (n.ally) on = partner(n.ally);
  return `${who} used ${n.move}${on ? ` on ${on}` : ""}`;
}

function plainChoices(stats: BattleStats, viewer: StatsSide, notes: readonly TurnNote[]): string {
  if (stats.doubles) {
    // Both Pokémon of each side, each with its targets.
    const parts: string[] = [];
    for (const side of [viewer, foeOf(viewer)]) {
      for (const n of notes) {
        if (n.side !== side) continue;
        if (n.kind === "move") parts.push(doublesMove(stats, viewer, n));
        else if (n.kind === "switch") parts.push(`${side === viewer ? "you" : stats.players[side]} switched in ${n.mon}`);
      }
    }
    return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? "");
  }
  const part = (side: StatsSide) => {
    const who = side === viewer ? "you" : stats.players[side];
    const first = notes.find((n) => n.side === side && (n.kind === "move" || n.kind === "switch"));
    if (!first) return "";
    return first.kind === "switch" ? `${who} switched to ${first.mon}` : `${who} used ${first.move}`;
  };
  return [part(viewer), part(foeOf(viewer))].filter(Boolean).join(" and ");
}

export interface TurningPoint {
  turn: number;
  delta: number;
  before: number;
  /** The win chance after, or the result (1 won, 0 lost, ½ a draw) when the battle ended. */
  after: number;
  ended: boolean;
  text: string;
  /** The log showed a cause (a crit, a miss, a KO…), not just the turn's moves. */
  caused: boolean;
}

function oddsText(s: Swing): string {
  if (!s.after.n) {
    const end = s.after.p === 1 ? "the win" : s.after.p === 0 ? "the loss" : "a draw";
    return `took your odds from ${pct(s.before.p)} to ${end}`;
  }
  return `${s.delta < 0 ? "dropped" : "raised"} your odds from ${pct(s.before.p)} to ${pct(s.after.p)}`;
}

/** The 2–3 turns that swung the win chance most (beyond the simulations' noise), each with its reason. */
export function turningPoints(points: readonly WinPoint[], stats: BattleStats, viewer: StatsSide, max = 3): TurningPoint[] {
  return keySwings(swings(points), max).map((s) => {
    const notes = stats.notes[s.turn] ?? [];
    const good: StatsSide = s.delta >= 0 ? viewer : foeOf(viewer);
    const cause = causeOf(notes, good);
    const odds = oddsText(s);
    let text: string;
    if (cause) text = `${capital(causeText(stats, viewer, cause, notes))} on turn ${s.turn} ${odds}.`;
    else {
      const plain = plainTurn(stats, viewer, notes);
      const end = s.after.n ? pct(s.after.p) : s.after.p === 1 ? "the win" : s.after.p === 0 ? "the loss" : "a draw";
      text = plain ? `On turn ${s.turn} ${plain}; your odds went from ${pct(s.before.p)} to ${end}.` : `Turn ${s.turn} ${odds}.`;
    }
    return { turn: s.turn, delta: s.delta, before: s.before.p, after: s.after.p, ended: !s.after.n, text, caused: !!cause };
  });
}

// ---------------------------------------------------------------------------
// Luck, MVP
// ---------------------------------------------------------------------------

/** "+2.1", "−0.4", "0.0". */
export const signed = (n: number) => (Math.abs(n) < 0.05 ? "0.0" : `${n > 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`);

/** The verdict on a side's luck: how far from expected, against the spread luck alone gives. */
export function luckVerdict(l: SideLuck, t: Translator<typeof battleAnalysis.en> = translator(battleAnalysis, "en", undefined)): { label: string; tone: "good" | "bad" | "even" } {
  const z = l.sd > 0 ? l.score / l.sd : 0;
  if (Math.abs(l.score) < 0.5 || Math.abs(z) < 0.5) return { label: t("words.verdict.even"), tone: "even" };
  if (Math.abs(z) < 1.5) return l.score > 0 ? { label: t("words.verdict.bitLucky"), tone: "good" } : { label: t("words.verdict.bitUnlucky"), tone: "bad" };
  return l.score > 0 ? { label: t("words.verdict.lucky"), tone: "good" } : { label: t("words.verdict.unlucky"), tone: "bad" };
}

/** How much a Pokémon did: damage dealt (its moves and its hazards, status and weather), and a KO counts as 30 more. */
export const workScore = (m: MonStats) => m.dealt + m.dealtIndirect + 30 * m.kos;

/** The side's MVP: who did the most work (null if nobody did any). */
export function mvpOf(mons: readonly MonStats[], side: StatsSide): MonStats | null {
  let best: MonStats | null = null;
  for (const m of mons) if (m.side === side && workScore(m) > 0 && (!best || workScore(m) > workScore(best))) best = m;
  return best;
}

/** "212% dealt · 3 KOs". */
export function workLine(m: MonStats, t: Translator<typeof battleAnalysis.en> = translator(battleAnalysis, "en", undefined)): string {
  const dealt = Math.round(m.dealt + m.dealtIndirect);
  return m.kos ? t("words.workKos", { dealt, n: m.kos }) : t("words.work", { dealt });
}

// ---------------------------------------------------------------------------
// The share card
// ---------------------------------------------------------------------------

/** The card's headline: the result with the luck that went into it. */
export function shareHeadline(stats: BattleStats, viewer: StatsSide, t: Translator<typeof battleAnalysis.en> = translator(battleAnalysis, "en", undefined)): string {
  const l = stats.luck[viewer];
  const crits = l.critsReceived.observed;
  // As shown (one decimal), so "Luck −1.0" never reads as "about even".
  const score = Math.round(l.score * 10) / 10;
  const result = stats.winner === null ? "draw" : stats.winner === viewer ? "win" : "loss";
  const lucky = score >= 1;
  const unlucky = score <= -1;
  if (result === "loss" && unlucky && crits >= 2) return t("words.share.crits", { n: crits });
  if (result === "loss" && unlucky) return t("words.share.badLuck");
  if (result === "loss" && lucky) return t("words.share.despite");
  if (result === "win" && unlucky) return t("words.share.through");
  if (result === "win" && lucky) return t("words.share.little");
  return result === "win" ? t("words.share.won") : result === "loss" ? t("words.share.lost") : t("words.share.drew");
}

/** `species`: a Pokémon's name as the page shows it (English by default). */
export function shareText(
  stats: BattleStats,
  viewer: StatsSide,
  opts: { formatName: string; url: string; turning?: TurningPoint | null },
  t: Translator<typeof battleAnalysis.en> = translator(battleAnalysis, "en", undefined),
  species: (name: string) => string = (s) => s
): string {
  const l = stats.luck[viewer];
  const mvp = mvpOf(stats.mons, viewer);
  const foe = stats.players[foeOf(viewer)];
  const headline = [shareHeadline(stats, viewer, t), t("words.share.luck", { score: signed(l.score) }), mvp ? t("words.share.mvp", { species: species(mvp.species) }) : null].filter(Boolean).join(" · ");
  const tp = opts.turning;
  return composeShare({
    title: t("words.share.title"),
    lines: [
      headline,
      t("words.share.vs", { foe, format: opts.formatName, n: stats.turns }),
      t("words.share.dice", { landed: l.critsLanded.observed, taken: l.critsReceived.observed, misses: l.missesOwn.observed, against: l.missesFoe.observed }),
      mvp ? t("words.share.mvpLine", { species: species(mvp.species), work: workLine(mvp, t) }) : null,
      tp ? t("words.share.turn", { turn: tp.turn, before: pct(tp.before), after: tp.ended ? (tp.after === 1 ? t("words.share.endWon") : tp.after === 0 ? t("words.share.endLost") : t("words.share.endDraw")) : pct(tp.after) }) : null,
    ],
    url: opts.url,
  });
}
