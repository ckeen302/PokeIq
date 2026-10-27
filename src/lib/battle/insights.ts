import type { BattleStats, StatsSide } from "./analysis/stats-types";
import type { BattleOutcome } from "./profile";

/**
 * Team insights across a trainer's battles: one summary per battle (who
 * they led with, the Pokémon they and their foe showed, which foes knocked
 * their Pokémon out), and what those add up to: their most common leads,
 * win rate per Pokémon, the foes that beat them most, and their rating
 * over time. The database does the same sums in battle_insights()
 * (migration 0041); this file is the in-memory version, and the shapes.
 */

export interface BattleSummary {
  code: string;
  key: string;
  format: string;
  ranked: boolean;
  result: BattleOutcome;
  /** There was a replay to read (a battle without one has nothing else filled in). */
  hasReplay: boolean;
  lead: string | null;
  team: string[];
  foes: string[];
  /** The foe credited with each KO on this trainer's Pokémon. */
  koBy: string[];
  at: number;
}

export interface UsageRow {
  species: string;
  games: number;
  wins: number;
}

export interface ThreatRow {
  species: string;
  /** Battles it was in against this trainer. */
  games: number;
  /** Of those, the ones this trainer lost. */
  losses: number;
  /** This trainer's Pokémon it knocked out. */
  kos: number;
}

export interface InsightTotals {
  battles: number;
  wins: number;
  leads: UsageRow[];
  mons: UsageRow[];
  threats: ThreatRow[];
}

export interface RatingPoint {
  at: number;
  rating: number;
  /** After this game (only for games since migration 0041). */
  gxe?: number;
}

export interface Insights extends InsightTotals {
  format: string | null;
  /** Battles in range that have no summary yet (summarised on later visits). */
  pending: number;
  trend: RatingPoint[];
}

/** How many of the latest battles the insights cover. */
export const INSIGHTS_WINDOW = 200;

/** A battle's summary for the trainer in `seat`, from its stats. */
export function summaryFromStats(stats: BattleStats, seat: StatsSide, base: Pick<BattleSummary, "code" | "key" | "format" | "ranked" | "result" | "at">): BattleSummary {
  const foe: StatsSide = seat === 0 ? 1 : 0;
  const speciesOf = (key: string) => stats.mons.find((m) => m.key === key)?.species ?? key.replace(/^p[12]: /, "");
  const uniq = (xs: string[]) => [...new Set(xs)];
  return {
    ...base,
    hasReplay: true,
    lead: stats.leads[seat],
    team: uniq(stats.mons.filter((m) => m.side === seat).map((m) => m.species)),
    foes: uniq(stats.mons.filter((m) => m.side === foe).map((m) => m.species)),
    koBy: stats.mons.filter((m) => m.side === seat && m.koBy).map((m) => speciesOf(m.koBy!)),
    at: base.at,
  };
}

/** The sums over a trainer's latest summaries with a replay (as battle_insights() does them). */
export function aggregateInsights(rows: readonly BattleSummary[], limit = INSIGHTS_WINDOW): InsightTotals {
  const recent = rows
    .filter((r) => r.hasReplay)
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
  const count = <T extends { species: string }>(map: Map<string, T>, species: string, make: () => T) => {
    let row = map.get(species);
    if (!row) map.set(species, (row = make()));
    return row;
  };
  const leads = new Map<string, UsageRow>();
  const mons = new Map<string, UsageRow>();
  const threats = new Map<string, ThreatRow>();
  for (const r of recent) {
    const win = r.result === "win" ? 1 : 0;
    if (r.lead) {
      const row = count(leads, r.lead, () => ({ species: r.lead!, games: 0, wins: 0 }));
      row.games++;
      row.wins += win;
    }
    for (const s of new Set(r.team)) {
      const row = count(mons, s, () => ({ species: s, games: 0, wins: 0 }));
      row.games++;
      row.wins += win;
    }
    for (const s of new Set(r.foes)) {
      const row = count(threats, s, () => ({ species: s, games: 0, losses: 0, kos: 0 }));
      row.games++;
      row.losses += r.result === "loss" ? 1 : 0;
      row.kos += r.koBy.filter((k) => k === s).length;
    }
  }
  const byUse = (a: UsageRow, b: UsageRow) => b.games - a.games || b.wins - a.wins || a.species.localeCompare(b.species);
  return {
    battles: recent.length,
    wins: recent.filter((r) => r.result === "win").length,
    leads: [...leads.values()].sort(byUse).slice(0, 6),
    mons: [...mons.values()].sort(byUse).slice(0, 24),
    threats: [...threats.values()]
      .filter((t) => t.kos > 0 || t.losses > 0)
      .sort((a, b) => b.kos - a.kos || b.losses - a.losses || a.species.localeCompare(b.species))
      .slice(0, 8),
  };
}

/** "62%", or "—" with no games. */
export const winRate = (wins: number, games: number) => (games ? `${Math.round((100 * wins) / games)}%` : "—");
