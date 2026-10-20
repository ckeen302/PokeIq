/**
 * "Who Am I?": deduce a secret Pokémon with yes/no questions paid for in PP.
 * The rules, the question menu and what the browser is shown, shared by the
 * server (which holds the secret and answers every question) and the client.
 */

import type { DuelPlayerView } from "./duel-types";
import type { PvpEmoteView, PvpEnd, PvpSeriesView } from "./pvp-types";
import type { DuelStatus } from "./duel-types";
import type { ChatLine } from "./chat";

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** PP each trainer starts a round with. */
export const WHOAMI_PP = 100;
/** A round lasts three minutes at most. */
export const WHOAMI_ROUND_MS = 180_000;
/** Once someone solves, the other has this long to solve too (or until the clock runs out). */
export const WHOAMI_LAST_CALL_MS = 30_000;
/** A wrong guess locks you out of guessing and asking for this long. */
export const WHOAMI_LOCK_MS = 12_000;
/** A solve scores this, plus WHOAMI_PP_POINTS for every PP left. */
export const WHOAMI_SOLVE_POINTS = 1_000;
export const WHOAMI_PP_POINTS = 5;
/** PvP: the first to win this many rounds takes the duel (at most WHOAMI_ROUNDS). */
export const WHOAMI_ROUNDS = 3;
export const WHOAMI_ROUND_WINS = 2;
/** The reveal between rounds stays up this long, unless both press Next. */
export const WHOAMI_REVEAL_MS = 12_000;
/** A sealed clue drops this often in a PvP round, and bids on it are open this long. */
export const WHOAMI_DROP_EVERY_MS = 40_000;
export const WHOAMI_BID_MS = 8_000;
export const WHOAMI_MAX_BID = 30;
/** Taunt silences the opponent's questions for this long. */
export const WHOAMI_TAUNT_MS = 10_000;

export const whoamiScore = (pp: number) => WHOAMI_SOLVE_POINTS + pp * WHOAMI_PP_POINTS;

/** The bid that wins a clue (null: nobody, on a tie or no bids), and what each bidder gets back. */
export function resolveBids(bids: readonly (number | null)[]): { winner: number | null; refunds: number[] } {
  const b = bids.map((x) => x ?? 0);
  const winner = b[0] === b[1] ? null : b[0] > b[1] ? 0 : 1;
  return { winner, refunds: b.map((x, seat) => (seat === winner ? 0 : Math.floor(x / 2))) };
}

// ---------------------------------------------------------------------------
// Trainer abilities
// ---------------------------------------------------------------------------

export const WHOAMI_ABILITIES = ["taunt", "trace", "frisk"] as const;
export type WhoamiAbility = (typeof WHOAMI_ABILITIES)[number];
export const WHOAMI_DEFAULT_ABILITY: WhoamiAbility = "frisk";
export const ABILITY_INFO: Record<WhoamiAbility, { label: string; blurb: string }> = {
  taunt: { label: "Taunt", blurb: `Your opponent can't ask questions for ${WHOAMI_TAUNT_MS / 1000} s.` },
  trace: { label: "Trace", blurb: "See the last question your opponent asked, and its answer." },
  frisk: { label: "Frisk", blurb: "See how many Pokémon are left in your opponent's grid." },
};

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export const WHOAMI_TYPES = [
  "normal", "fire", "water", "grass", "electric", "ice", "fighting", "poison", "ground",
  "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy",
] as const;
/** Colour families: each Pokédex colour belongs to one. */
export const COLOR_FAMILIES: Record<string, { label: string; colors: string[] }> = {
  red: { label: "red or pink", colors: ["red", "pink"] },
  blue: { label: "blue or purple", colors: ["blue", "purple"] },
  green: { label: "green", colors: ["green"] },
  yellow: { label: "yellow or brown", colors: ["yellow", "brown"] },
  mono: { label: "white, grey or black", colors: ["white", "gray", "black"] },
};
export const STAT_KEYS = ["hp", "atk", "def", "spa", "spd", "spe"] as const;
export type WhoamiStat = (typeof STAT_KEYS)[number];
export const STAT_NAMES: Record<WhoamiStat, string> = { hp: "HP", atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed" };
/** Thresholds offered for each "over" question. */
export const HEIGHTS_DM = [5, 10, 15, 20];
export const WEIGHTS_KG = [10, 25, 50, 100];
export const STAT_STEPS = [50, 70, 90, 110];
export const BST_STEPS = [300, 400, 500, 600];
/** Moves asked about (their learners: src/data/whoami-moves.json). */
export const WHOAMI_MOVES: Record<string, string> = {
  surf: "Surf",
  fly: "Fly",
  earthquake: "Earthquake",
  thunderbolt: "Thunderbolt",
  flamethrower: "Flamethrower",
  icebeam: "Ice Beam",
  psychic: "Psychic",
  swordsdance: "Swords Dance",
  solarbeam: "Solar Beam",
  shadowball: "Shadow Ball",
  dragonclaw: "Dragon Claw",
  sludgebomb: "Sludge Bomb",
  closecombat: "Close Combat",
  dig: "Dig",
  uturn: "U-turn",
  recover: "Recover",
};
export const MAX_GEN_WHOAMI = 9;

/**
 * A question, by id:
 *   type:fire  from:4  dual  final  legend  basic  color:red   (broad: 10 PP)
 *   gen:4  height:15  weight:50  stat:spe:90  bst:500         (specific: 20 PP)
 *   ability:levitate  move:surf                               (specific: 25 PP)
 */
export type WhoamiQuestion =
  | { kind: "type"; type: string }
  | { kind: "from"; gen: number }
  | { kind: "dual" | "final" | "legend" | "basic" }
  | { kind: "color"; family: string }
  | { kind: "gen"; gen: number }
  | { kind: "height"; dm: number }
  | { kind: "weight"; kg: number }
  | { kind: "stat"; stat: WhoamiStat; over: number }
  | { kind: "bst"; over: number }
  | { kind: "ability"; ability: string }
  | { kind: "move"; move: string };

const SLUG_RE = /^[a-z0-9-]{1,40}$/;

/** A question id read back, or null if it isn't one on the menu. */
export function parseQuestion(id: string): WhoamiQuestion | null {
  const [kind, a, b] = id.split(":");
  const n = Number(a);
  switch (kind) {
    case "type":
      return (WHOAMI_TYPES as readonly string[]).includes(a) ? { kind, type: a } : null;
    case "from":
      return Number.isInteger(n) && n >= 2 && n <= MAX_GEN_WHOAMI && id === `from:${n}` ? { kind, gen: n } : null;
    case "gen":
      return Number.isInteger(n) && n >= 1 && n <= MAX_GEN_WHOAMI && id === `gen:${n}` ? { kind, gen: n } : null;
    case "dual":
    case "final":
    case "legend":
    case "basic":
      return id === kind ? { kind } : null;
    case "color":
      return Object.hasOwn(COLOR_FAMILIES, a) ? { kind, family: a } : null;
    case "height":
      return HEIGHTS_DM.includes(n) && id === `height:${n}` ? { kind, dm: n } : null;
    case "weight":
      return WEIGHTS_KG.includes(n) && id === `weight:${n}` ? { kind, kg: n } : null;
    case "stat": {
      const over = Number(b);
      return (STAT_KEYS as readonly string[]).includes(a) && STAT_STEPS.includes(over) && id === `stat:${a}:${over}` ? { kind, stat: a as WhoamiStat, over } : null;
    }
    case "bst":
      return BST_STEPS.includes(n) && id === `bst:${n}` ? { kind, over: n } : null;
    case "ability":
      return SLUG_RE.test(a ?? "") && id === `ability:${a}` ? { kind, ability: a } : null;
    case "move":
      return Object.hasOwn(WHOAMI_MOVES, a) && id === `move:${a}` ? { kind, move: a } : null;
    default:
      return null;
  }
}

/** What a question costs in PP. */
export function questionCost(q: WhoamiQuestion): number {
  switch (q.kind) {
    case "ability":
    case "move":
      return 25;
    case "gen":
    case "height":
    case "weight":
    case "stat":
    case "bst":
      return 20;
    default:
      return 10;
  }
}

export const titleCase = (slug: string) => slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

/** The question as the trainer asks it. */
export function questionText(q: WhoamiQuestion): string {
  switch (q.kind) {
    case "type":
      return `Am I ${titleCase(q.type)}-type?`;
    case "from":
      return `Am I from Gen ${q.gen} or later?`;
    case "gen":
      return `Am I from Gen ${q.gen}?`;
    case "dual":
      return "Am I dual-typed?";
    case "final":
      return "Am I fully evolved?";
    case "legend":
      return "Am I legendary or mythical?";
    case "basic":
      return "Am I a first-stage Pokémon?";
    case "color":
      return `Am I mostly ${COLOR_FAMILIES[q.family].label}?`;
    case "height":
      return `Am I taller than ${q.dm / 10} m?`;
    case "weight":
      return `Do I weigh over ${q.kg} kg?`;
    case "stat":
      return `Is my base ${STAT_NAMES[q.stat]} over ${q.over}?`;
    case "bst":
      return `Are my base stats over ${q.over} in total?`;
    case "ability":
      return `Do I have ${titleCase(q.ability)}?`;
    case "move":
      return `Can I learn ${WHOAMI_MOVES[q.move]}?`;
  }
}

/** A clue drop's sealed category (its content stays on the server until someone wins it). */
export const CLUE_KINDS = ["gen", "type", "ability"] as const;
export type WhoamiClueKind = (typeof CLUE_KINDS)[number];
export const CLUE_LABEL: Record<WhoamiClueKind, string> = { gen: "My generation", type: "One of my types", ability: "One of my abilities" };

/** The statement a won clue (or a yes answer) makes. */
export function factText(q: string, yes: boolean): string {
  const parsed = parseQuestion(q);
  if (!parsed) return q;
  return `${questionText(parsed)} ${yes ? "Yes" : "No"}`;
}

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

/** Which Pokémon a game can be: the curated set, within a generation range, optionally without legendaries. */
export interface WhoamiPoolSettings {
  from: number;
  to: number;
  casual: boolean;
}
export const WHOAMI_DEFAULT_POOL: WhoamiPoolSettings = { from: 1, to: MAX_GEN_WHOAMI, casual: false };
export const poolSettingsText = (s: WhoamiPoolSettings) =>
  `${s.from === 1 && s.to === MAX_GEN_WHOAMI ? "All generations" : s.from === s.to ? `Gen ${s.from}` : `Gen ${s.from}–${s.to}`}${s.casual ? " · no legendaries" : ""}`;

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** Something you know about the secret: a question you asked, a clue you won, or a question you traced. */
export interface WhoamiKnown {
  q: string;
  yes: boolean;
  via: "ask" | "clue" | "trace";
}

/** Your own deduction: only ever sent to you. */
export interface WhoamiMine {
  pp: number;
  known: WhoamiKnown[];
  /** Pokémon still possible given everything you know (and not guessed wrong). */
  alive: number[];
  wrong: number[];
  lockUntil: number;
}

/** Practice and the daily: one trainer against the clock. */
export interface WhoamiSoloView extends WhoamiMine {
  mode: "daily" | "practice";
  date?: string;
  settings: WhoamiPoolSettings;
  pool: number[];
  startedAt: number;
  endsAt: number;
  now: number;
  solvedAt?: number;
  score?: number;
  /** Once the game is over (solved or out of time): who it was. */
  answer?: { id: number; name: string; genus: string };
}

/** A seat in a PvP round, as both trainers may see it: no questions, no answers, no grid. */
export interface WhoamiBoard {
  pp: number;
  asked: number;
  wrong: number;
  solvedMs?: number;
  lockUntil: number;
  tauntUntil: number;
  abilityUsed: boolean;
  score: number;
}

export interface WhoamiDropView {
  index: number;
  kind: WhoamiClueKind;
  opensAt: number;
  closesAt: number;
  /** Your bid, and whether your rival has bid (never how much, until it's settled). */
  bid: number | null;
  rivalBid: boolean;
  result?: { winner: number | null; bids: number[] };
}

export interface WhoamiRoundResult {
  index: number;
  answer: { id: number; name: string; genus: string };
  boards: WhoamiBoard[];
  winner: number | null;
  timedOut: boolean;
}

export interface WhoamiDuelView {
  kind: "whoami";
  code: string;
  status: DuelStatus;
  now: number;
  rev: number;
  you: number | null;
  players: DuelPlayerView[];
  end?: PvpEnd;
  rematch?: string;
  series?: PvpSeriesView;
  emotes?: PvpEmoteView[];
  chat?: ChatLine[];
  settings: WhoamiPoolSettings;
  /** Each seat's trainer ability. */
  abilities: WhoamiAbility[];
  pool: number[];
  rounds: number;
  wins: number[];
  totals: number[];
  round?: {
    index: number;
    startsAt: number;
    endsAt: number;
    boards: WhoamiBoard[];
    mine?: WhoamiMine;
    drop?: WhoamiDropView;
    /** What your ability showed you this round. */
    traced?: { q: string; yes: boolean } | null;
    frisked?: number;
  };
  revealed: WhoamiRoundResult[];
  next?: { at: number; pressed: boolean[] };
  queue?: "casual";
}
