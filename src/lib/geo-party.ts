import type { DuelLiveConfig } from "./geo-duel-live";
import type { DuelPlayerView, DuelStatus } from "./duel-types";
import type { GeoAnswer } from "./geo-types";
import type { PvpEmoteView } from "./pvp-types";
import { DUEL_HP, roundDamage, rampMultiplier } from "./geo-duel-rules";

/**
 * PokéGuessr parties: a private room of up to 16 trainers, opened with a
 * short code, where the host picks the game and starts it. Two games:
 *
 *   royale  Battle Royale. Everyone guesses the same place each round; the
 *           lowest score of the round loses a life, and a trainer out of
 *           lives is eliminated (and watches on). Last trainer standing wins.
 *   team    Team duel (2v2, up to 4v4). GeoGuessr's team duel rules: a
 *           team's score for a round is its best member's, and the lower
 *           team loses the gap times the duel's damage multiplier from its
 *           shared HP. Teammates see each other's pins as they place them.
 *
 * Shared by the server (which applies every rule, server/geo-party.ts) and
 * the page; the pure rules here are what the tests pin down.
 */

export const PARTY_MAX_PLAYERS = 16;
/** A team duel seats at most this many a side. */
export const PARTY_TEAM_MAX = 4;
export const PARTY_MAX_TOTAL_TEAM = PARTY_TEAM_MAX * 2;

/** Party codes: six letters and digits, without the ones that look alike (0/o, 1/l/i). Duel codes have eight, so the two never mix. */
export const PARTY_CODE_RE = /^[a-hjkmnp-z2-9]{6}$/;
export const PARTY_CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export type PartyMode = "royale" | "team";
export const PARTY_MODES: readonly PartyMode[] = ["royale", "team"];
export const PARTY_MODE_NAMES: Record<PartyMode, string> = { royale: "Battle Royale", team: "Team duel" };

/** Lives in a Battle Royale. */
export const PARTY_LIVES = [1, 2, 3, 4, 5] as const;
export const PARTY_DEFAULT_LIVES = 3;
/** Seconds a round is open at most. */
export const PARTY_ROUND_SECONDS = [30, 60, 90, 120] as const;
export const PARTY_DEFAULT_ROUND_SECONDS = 60;
/** Once the first pin lands, the rest have this many seconds. */
export const PARTY_COUNTDOWN_SECONDS = [10, 15, 20] as const;
export const PARTY_DEFAULT_COUNTDOWN_SECONDS = 15;
/** The most rounds a game runs before it's decided on lives (royale) or HP (team). */
export const PARTY_ROUND_CAPS = [5, 10, 15, 20] as const;
export const PARTY_DEFAULT_ROUNDS: Record<PartyMode, number> = { royale: 15, team: 10 };

/** "Round N" shows this long before the screenshot (longer before the first, for the line-up). */
export const PARTY_LEAD_MS = 3_000;
export const PARTY_FIRST_LEAD_MS = 5_000;
/** The reveal stays up this long, unless everyone still in presses Next sooner. */
export const PARTY_REVEAL_MS = 10_000;
/** A guess sent just before the bell still counts if it arrives within this long after it. */
export const PARTY_GRACE_MS = 1_000;
/** A trainer the server hasn't heard from in this long has left (out of the lobby, or out of the game). */
export const PARTY_AWAY_MS = 30_000;
export const PARTY_QUIET_MS = 10_000;

export interface PartySettings {
  mode: PartyMode;
  /** The map: the world, a region or a themed map. */
  region: string;
  /** Battle Royale lives. */
  lives: number;
  roundSeconds: number;
  countdownSeconds: number;
  /** The most rounds the game runs. */
  rounds: number;
}

export const defaultPartySettings = (region: string, mode: PartyMode = "royale"): PartySettings => ({
  mode,
  region,
  lives: PARTY_DEFAULT_LIVES,
  roundSeconds: PARTY_DEFAULT_ROUND_SECONDS,
  countdownSeconds: PARTY_DEFAULT_COUNTDOWN_SECONDS,
  rounds: PARTY_DEFAULT_ROUNDS[mode],
});

const oneOf = (list: readonly number[], n: unknown): n is number => typeof n === "number" && list.includes(n);

/** Settings as the host asked for them, checked (the map is checked by the server). Null if any is off the menu. */
export function parsePartySettings(raw: Partial<Record<keyof PartySettings, unknown>>, base: PartySettings): PartySettings | null {
  const mode = raw.mode ?? base.mode;
  if (mode !== "royale" && mode !== "team") return null;
  const region = raw.region ?? base.region;
  if (typeof region !== "string" || region.length > 20) return null;
  const lives = raw.lives ?? base.lives;
  const roundSeconds = raw.roundSeconds ?? base.roundSeconds;
  const countdownSeconds = raw.countdownSeconds ?? base.countdownSeconds;
  const rounds = raw.rounds ?? (raw.mode && raw.mode !== base.mode ? PARTY_DEFAULT_ROUNDS[mode] : base.rounds);
  if (!oneOf(PARTY_LIVES, lives) || !oneOf(PARTY_ROUND_SECONDS, roundSeconds) || !oneOf(PARTY_COUNTDOWN_SECONDS, countdownSeconds) || !oneOf(PARTY_ROUND_CAPS, rounds)) return null;
  return { mode, region, lives, roundSeconds, countdownSeconds, rounds };
}

// ---------------------------------------------------------------------------
// Battle Royale
// ---------------------------------------------------------------------------

/**
 * Who loses a life this round: every trainer still in (`alive`) with the
 * round's lowest score (no guess scores 0). Ties are fair both ways: all
 * trainers level on the lowest score lose one each, and when every trainer
 * still in is level, nobody does (an even round can't knock everyone out).
 */
export function royaleLosers(scores: readonly number[], alive: readonly boolean[]): number[] {
  const seats = alive.map((a, seat) => (a ? seat : -1)).filter((s) => s >= 0);
  if (seats.length < 2) return [];
  const low = Math.min(...seats.map((s) => scores[s] ?? 0));
  const losers = seats.filter((s) => (scores[s] ?? 0) === low);
  return losers.length === seats.length ? [] : losers;
}

/** Lives after the round: each loser one fewer (never below 0). */
export const livesAfter = (lives: readonly number[], losers: readonly number[]): number[] => lives.map((l, seat) => (losers.includes(seat) ? Math.max(0, l - 1) : l));

export interface RoyaleRecord {
  /** Lives left (0: out). */
  lives: number;
  /** The round (0-based) the trainer went out in; undefined while still in. */
  outRound?: number;
  /** Points over the whole game. */
  points: number;
}

/**
 * Final places: still-in trainers first (more lives, then more points),
 * then the rest by how long they lasted. Trainers who went out in the same
 * round with the same points share a place; points split everyone else.
 * Returns the place (1 = winner) per seat.
 */
export function royalePlaces(records: readonly RoyaleRecord[]): number[] {
  const key = (r: RoyaleRecord) => [r.outRound === undefined ? Infinity : r.outRound, r.lives, r.points];
  const better = (a: RoyaleRecord, b: RoyaleRecord) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i] > 0 ? 1 : -1;
    return 0;
  };
  return records.map((r) => 1 + records.filter((o) => better(r, o) > 0).length);
}

/** The winners once the game is decided: the seats in first place (more than one only when the rounds ran out level). */
export const royaleWinners = (records: readonly RoyaleRecord[]): number[] => royalePlaces(records).flatMap((p, seat) => (p === 1 ? [seat] : []));

// ---------------------------------------------------------------------------
// Team duels
// ---------------------------------------------------------------------------

export interface TeamRound {
  /** Each team's score: its best member's. */
  scores: [number, number];
  /** Each team's best member (the seat whose score counted), or null for a team with nobody playing. */
  best: [number | null, number | null];
  winner: 0 | 1 | null;
  hurt: 0 | 1 | null;
  damage: number;
  multiplier: number;
}

/**
 * A team duel round (GeoGuessr's rules): each team scores its best member's
 * score, and the lower team loses the gap times the round's multiplier, in
 * full. `teams[seat]` is each trainer's team; seats with no team (left the
 * room) don't count.
 */
export function teamRound(scores: readonly number[], teams: readonly (0 | 1 | null)[], index: number): TeamRound {
  const best: [number | null, number | null] = [null, null];
  const top: [number, number] = [0, 0];
  teams.forEach((t, seat) => {
    if (t === null) return;
    const s = scores[seat] ?? 0;
    if (best[t] === null || s > top[t]) {
      best[t] = seat;
      top[t] = s;
    }
  });
  const m = rampMultiplier(index);
  const hit = roundDamage(top, [m, m]);
  return { scores: top, best, winner: hit.winner as 0 | 1 | null, hurt: hit.hurt as 0 | 1 | null, damage: hit.damage, multiplier: hit.multiplier };
}

export const PARTY_TEAM_HP = DUEL_HP;
export const TEAM_NAMES = ["Red team", "Blue team"] as const;
export const TEAM_COLORS = ["#e2306f", "#38bdf8"] as const;

/** Twelve distinct pin colours for a Battle Royale (seat order, wrapping). */
export const PARTY_COLORS = ["#4cbb17", "#6c5ce7", "#e2306f", "#38bdf8", "#f59e0b", "#14b8a6", "#ef4444", "#a855f7", "#84cc16", "#ec4899", "#0ea5e9", "#f97316"] as const;
export const partyColor = (seat: number) => PARTY_COLORS[seat % PARTY_COLORS.length];

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface PartyPlayerView extends DuelPlayerView {
  /** Team duels: 0 (red) or 1 (blue). */
  team?: 0 | 1;
  /** Battle Royale: lives left. */
  lives?: number;
  /** Out of the game: eliminated (royale) or gone. */
  out?: boolean;
  /** Left the room mid-game (or was removed by the host). */
  left?: boolean;
}

export interface PartyLiveRound {
  index: number;
  multiplier: number;
  startsAt: number;
  shot?: string;
  endsAt: number;
  countdown: boolean;
  /** Who has locked in, per seat. */
  guessed: boolean[];
  /** Who is playing this round (still in, and not gone). */
  playing: boolean[];
  yours?: { x: number; y: number };
  /** Team duels: your teammates' pins (placed or locked), per seat; the other team's never before the reveal. */
  mates?: ({ x: number; y: number; locked: boolean } | null)[];
}

export interface PartyRoundResult {
  index: number;
  shot: string;
  answer: GeoAnswer;
  /** One per seat: the pin, its score and distance, or null (no guess, or not playing). */
  guesses: ({ x: number; y: number; score: number; squares: number } | null)[];
  /** Who played the round. */
  playing: boolean[];
  /** Battle Royale: who lost a life, who went out, and lives after. */
  losers?: number[];
  out?: number[];
  lives?: number[];
  /** Team duels: the round's team scores and damage, and team HP before and after. */
  team?: TeamRound & { hpBefore: [number, number]; hp: [number, number] };
}

export type PartyEndReason = "last" | "rounds" | "hp" | "left";

export interface PartyEnd {
  reason: PartyEndReason;
  at: number;
  /** Royale: the winning seats (one, unless the rounds ran out level). */
  winners: number[];
  /** Team duels: the winning team, or null for a draw. */
  team?: 0 | 1 | null;
  /** Each seat's final place (1 = first). */
  places: number[];
}

export interface PartyView {
  kind: "geo-party";
  code: string;
  status: DuelStatus;
  now: number;
  rev: number;
  you: number | null;
  /** The host's seat. */
  host: number;
  /** Games played in this room so far (Play again starts the next). */
  game: number;
  settings: PartySettings;
  players: PartyPlayerView[];
  /** Team duels: each team's HP. */
  hp?: [number, number];
  maxRounds: number;
  round?: PartyLiveRound;
  revealed: PartyRoundResult[];
  next?: { at: number; pressed: boolean[] };
  end?: PartyEnd;
  /** Points over the game, per seat. */
  totals: number[];
  emotes?: PvpEmoteView[];
  /** Your seat token's trainer was removed by the host. */
  removed?: boolean;
  live?: DuelLiveConfig | null;
}

export interface PartySeatResponse {
  code: string;
  token: string;
  view: PartyView;
}

export const partyPath = (code: string) => `/guessr/party/${code}`;
