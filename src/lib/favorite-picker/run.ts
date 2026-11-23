import { resolveBracket, roundLabel, type Resolved } from "@/lib/tier-list/bracket";
import { shuffled } from "@/lib/tier-list/rng";

/**
 * The Favorite Pokémon Picker's run: narrowing rounds, then a head-to-head bracket, then a ranking.
 *
 * A run is its pool (roster keys, fixed when it starts), a seed and the list of picks made so far; everything on
 * screen is replayed from those, so undo is "drop the last pick" and a saved run is a few numbers.
 *
 * - While more than BRACKET_MAX Pokémon are left, a narrowing round shuffles them into screens of up to
 *   MAX_SCREEN and the player keeps up to KEEP from each screen. A round has at least MIN_SCREENS screens, so one
 *   where every screen is used fully leaves at most KEEP × MIN_SCREENS (the bracket's size): a pool near the bracket's
 *   size goes there in one short round, and a whole Pokédex takes a couple of rounds. A pick is the screen's kept
 *   tiles as a bit mask.
 * - Then the rest meet head to head in a single-elimination bracket (tier-list/bracket: top seeds get the byes). A
 *   pick is 0 (the first card) or 1 (the second).
 * - The ranking: the champion first, then by the round each one went out in, and within a round by how the one that
 *   knocked it out finished (losing to the champion beats losing to the runner-up). That orders every finalist.
 */

/** At most this many go to the bracket. */
export const BRACKET_MAX = 16;
/** Kept per screen, at most. */
export const KEEP = 4;
/** Pokémon per screen, at most. */
export const MAX_SCREEN = 24;
export const MIN_SCREENS = BRACKET_MAX / KEEP;
/** The fewest a narrowing round may leave (a bracket needs two). */
export const MIN_LEFT = 2;

export interface Run {
  /** Roster keys, in roster order. */
  pool: string[];
  seed: string;
  /** Narrowing screens' kept masks, then bracket picks (0/1). */
  picks: number[];
}

export interface CullView {
  phase: "cull";
  /** 0-based round. */
  round: number;
  /** This screen's Pokémon. */
  screen: string[];
  screenIndex: number;
  screens: number;
  /** Kept so far in this round (before this screen). */
  keptSoFar: number;
  /** Pokémon left when the round started. */
  left: number;
  /** Most that may be kept on this screen. */
  cap: number;
  /** Fewest that must be kept on this screen (only the round's last screen, if the round would end too small). */
  min: number;
  /** The round's next screen, if it has one (its pictures can load early). */
  next: string[] | null;
}

export interface DuelView {
  phase: "duel";
  /** The two cards. */
  a: string;
  b: string;
  /** Round name: kind and size. */
  label: { kind: "final" | "semi" | "quarter" | "round"; n: number };
  /** Picks made in the bracket and needed in all. */
  done: number;
  total: number;
  entrants: string[];
}

export interface DoneView {
  phase: "done";
  /** Every finalist, best first. */
  ranking: string[];
}

export type View = (CullView | DuelView | DoneView) & {
  /** Steps taken in all, and a fair estimate of the steps still to come (if every screen were used fully). */
  steps: number;
  estimate: number;
};

/** How a round of `left` Pokémon is cut into screens (sizes as even as can be). */
export function screenSizes(left: number): number[] {
  const n = Math.max(MIN_SCREENS, Math.ceil(left / MAX_SCREEN));
  const base = Math.floor(left / n), extra = left % n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0)).filter((s) => s > 0);
}

/** Steps a pool of `left` still needs if every screen keeps the most it can: narrowing screens, then bracket picks. */
export function estimateSteps(left: number): number {
  let steps = 0;
  let n = left;
  while (n > BRACKET_MAX) {
    const sizes = screenSizes(n);
    steps += sizes.length;
    n = sizes.reduce((a, s) => a + Math.min(KEEP, s), 0);
  }
  return steps + Math.max(0, n - 1);
}

export const bitCount = (mask: number) => {
  let c = 0;
  for (let m = mask >>> 0; m; m &= m - 1) c++;
  return c;
};

/** The kept keys of a screen from its mask. */
export const keptOf = (screen: readonly string[], mask: number) => screen.filter((_, j) => (mask >>> j) & 1);

/**
 * Where a run stands, replayed from its picks. Picks that don't fit (a mask keeping too many, a round left too
 * small) end the replay there, so a damaged save shows the last good screen instead of breaking.
 */
export function viewRun(run: Run): View & { valid: number } {
  let left = run.pool.slice();
  let i = 0;
  let round = 0;
  while (left.length > BRACKET_MAX) {
    const order = shuffled(left, `${run.seed}:r${round}`);
    const sizes = screenSizes(order.length);
    const kept: string[] = [];
    let at = 0;
    for (let s = 0; s < sizes.length; s++) {
      const screen = order.slice(at, at + sizes[s]);
      at += sizes[s];
      const last = s === sizes.length - 1;
      const cap = Math.min(KEEP, screen.length);
      const min = last ? Math.max(0, Math.min(cap, MIN_LEFT - kept.length)) : 0;
      const mask = run.picks[i];
      const ok = mask !== undefined && Number.isInteger(mask) && mask >= 0 && mask < 2 ** screen.length && bitCount(mask) <= cap && bitCount(mask) >= min;
      if (!ok) {
        const rest = sizes.slice(s).reduce((a, n) => a + Math.min(KEEP, n), 0) + kept.length;
        return {
          phase: "cull",
          round,
          screen,
          screenIndex: s,
          screens: sizes.length,
          keptSoFar: kept.length,
          left: order.length,
          cap,
          min,
          next: s + 1 < sizes.length ? order.slice(at, at + sizes[s + 1]) : null,
          steps: i,
          estimate: sizes.length - s + (rest > BRACKET_MAX ? estimateSteps(rest) : Math.max(0, rest - 1)),
          valid: i,
        };
      }
      kept.push(...keptOf(screen, mask));
      i++;
    }
    left = kept;
    round++;
  }
  if (left.length <= 1) return { phase: "done", ranking: left, steps: i, estimate: 0, valid: i };
  const entrants = shuffled(left, `${run.seed}:b`);
  const bracketPicks: number[] = [];
  while (i < run.picks.length && (run.picks[i] === 0 || run.picks[i] === 1) && bracketPicks.length < entrants.length - 1) bracketPicks.push(run.picks[i++]);
  const res = resolveBracket(entrants, bracketPicks);
  if (res.current) {
    const m = res.rounds[res.current.round][res.current.index];
    return {
      phase: "duel",
      a: m.a!,
      b: m.b!,
      label: roundLabel(res.current.round, res.rounds.length),
      done: bracketPicks.length,
      total: res.totalPicks,
      entrants,
      steps: i,
      estimate: res.totalPicks - bracketPicks.length,
      valid: i,
    };
  }
  return { phase: "done", ranking: rankBracket(res), steps: i, estimate: 0, valid: i };
}

/** Every entrant of a finished bracket, best first (see the file's notes). */
export function rankBracket(res: Resolved): string[] {
  if (!res.champion) return [];
  const rank = new Map<string, number>([[res.champion, 0]]);
  const out = [res.champion];
  for (let r = res.rounds.length - 1; r >= 0; r--) {
    const losers: { k: string; by: number }[] = [];
    for (const m of res.rounds[r]) {
      if (m.bye || !m.winner) continue;
      const loser = m.winner === m.a ? m.b : m.a;
      if (loser) losers.push({ k: loser, by: rank.get(m.winner) ?? Infinity });
    }
    losers.sort((x, y) => x.by - y.by);
    for (const l of losers) {
      rank.set(l.k, out.length);
      out.push(l.k);
    }
  }
  return out;
}

/** The run with one more pick. */
export const pick = (run: Run, p: number): Run => ({ ...run, picks: [...run.picks, p] });
/** The run with its last pick taken back. */
export const undoPick = (run: Run): Run => ({ ...run, picks: run.picks.slice(0, -1) });
