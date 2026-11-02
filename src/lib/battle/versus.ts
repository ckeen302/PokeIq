import type { BattleOutcome, BattleProfile } from "./profile";
import type { PlayFormatId } from "./play";

/**
 * A trainer's battle record for the versus intro before a battle: live
 * battles won, lost and drawn (every format), their ladder rating in this
 * battle's format, and their latest results. Nothing beyond what their
 * battle profile already shows.
 */
export interface BattleVersusRecord {
  battles: number;
  wins: number;
  losses: number;
  draws: number;
  /** The ladder's Elo (the headline rating) in this format, when they're on it. */
  elo?: number;
  /** Place on this format's ladder. */
  position?: number | null;
  /** Newest first, at most five. */
  recent: BattleOutcome[];
}

export interface BattleVersusResponse {
  /** The trainer asking (their account, or this browser's id); null when there's nothing to show. */
  you: BattleVersusRecord | null;
  /** By lower-cased account name; null for a name that isn't an account. */
  names: Record<string, BattleVersusRecord | null>;
}

/** A battle profile boiled down to the versus card. */
export function versusRecord(profile: BattleProfile | null, format: PlayFormatId | null): BattleVersusRecord | null {
  if (!profile) return null;
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const f of profile.formats) {
    wins += f.wins;
    losses += f.losses;
    draws += f.draws;
  }
  const here = format ? profile.formats.find((f) => f.format === format) : undefined;
  const out: BattleVersusRecord = { battles: wins + losses + draws, wins, losses, draws, recent: profile.recent.slice(0, 5).map((r) => r.result) };
  const elo = here?.elo ?? (here?.rating !== undefined ? Math.round(here.rating) : undefined);
  if (elo !== undefined) out.elo = elo;
  if (here?.position !== undefined) out.position = here.position;
  return out;
}
