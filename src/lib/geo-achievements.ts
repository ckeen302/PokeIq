/**
 * PokéGuessr achievements: every badge, its rule and its threshold, in one
 * place. They are worked out on the server (src/lib/server/geo-progress.ts)
 * from the rounds a trainer has played (geo_round_scores), their region
 * streak runs, their ranked rating and the Weekly Challenge boards; nothing
 * here is counted in the browser. Tune a threshold here and nowhere else.
 */
import { GEO_DIVISIONS } from "./geo-ranked";
import { GEO_STREAK_REGIONS } from "./geo-streak-types";

/** What a trainer's record adds up to (the server fills it in). */
export interface GeoProgressMetrics {
  /** Pin rounds (games, dailies, weeklies, challenges, pin streaks, duels). */
  rounds: number;
  /** Rounds scored a full 5,000. */
  perfectRounds: number;
  /** The longest run of places in a row: a pin streak or a Region Streak. */
  bestStreak: number;
  /** The longest run of days in a row with a Daily played. */
  dailyStreakBest: number;
  /** The highest ranked division held (0: Poké Ball … 4: Beast Ball), or null before a ranked game. */
  rankedDivision: number | null;
  /** The best place on a finished week's Weekly Challenge board, or null. */
  weeklyBestPlace: number | null;
  /** Pin rounds and their mean score, by region (Kanto … Paldea). */
  regions: Record<string, { rounds: number; avg: number }>;
}

export type GeoAchievementGroup = "precision" | "regions" | "streaks" | "dailies" | "ranked" | "weekly";
export const GEO_ACHIEVEMENT_GROUPS: { id: GeoAchievementGroup; name: string }[] = [
  { id: "precision", name: "Precision" },
  { id: "regions", name: "Region experts" },
  { id: "streaks", name: "Streaks" },
  { id: "dailies", name: "Dailies" },
  { id: "ranked", name: "Ranked" },
  { id: "weekly", name: "Weekly Challenge" },
];

export interface GeoAchievementProgress {
  /** How far along (shown as have / need). */
  have: number;
  need: number;
  /** Met now (some rules need more than the count, e.g. a region expert's average). */
  met: boolean;
  /** A line under the bar ("Average 3,812, needs 3,500"). */
  note?: string;
}

export interface GeoAchievement {
  id: string;
  name: string;
  /** What it takes, in a line. */
  blurb: string;
  group: GeoAchievementGroup;
  progress: (m: GeoProgressMetrics) => GeoAchievementProgress;
}

/** A round scored this many points counts as perfect. */
export const GEO_PERFECT_SCORE = 5000;
/** Region expert: at least this many rounds in the region … */
export const GEO_EXPERT_ROUNDS = 30;
/** … averaging at least this many points. */
export const GEO_EXPERT_AVG = 3500;
/** Mastery: a place counts once a round there has scored at least this. */
export const GEO_MASTERY_SCORE = 4000;

const fmt = (n: number) => n.toLocaleString("en-US");
const count = (have: number, need: number): GeoAchievementProgress => ({ have: Math.min(have, need), need, met: have >= need });

const perfect = (n: number, id: string, name: string): GeoAchievement => ({
  id,
  name,
  blurb: n === 1 ? `Score a perfect ${fmt(GEO_PERFECT_SCORE)} on a round.` : `Score a perfect ${fmt(GEO_PERFECT_SCORE)} on ${fmt(n)} rounds.`,
  group: "precision",
  progress: (m) => count(m.perfectRounds, n),
});

const expert = (region: string): GeoAchievement => ({
  id: `expert-${region.toLowerCase()}`,
  name: `${region} Expert`,
  blurb: `Average ${fmt(GEO_EXPERT_AVG)}+ over ${GEO_EXPERT_ROUNDS}+ rounds in ${region}.`,
  group: "regions",
  progress: (m) => {
    const r = m.regions[region] ?? { rounds: 0, avg: 0 };
    return {
      have: Math.min(r.rounds, GEO_EXPERT_ROUNDS),
      need: GEO_EXPERT_ROUNDS,
      met: r.rounds >= GEO_EXPERT_ROUNDS && r.avg >= GEO_EXPERT_AVG,
      ...(r.rounds ? { note: `Average ${fmt(Math.round(r.avg))} of ${fmt(GEO_EXPERT_AVG)} needed` } : {}),
    };
  },
});

const streak = (n: number, id: string, name: string): GeoAchievement => ({
  id,
  name,
  blurb: `${n} places in a row in a streak (pin streak or Region Streak).`,
  group: "streaks",
  progress: (m) => count(m.bestStreak, n),
});

const daily = (n: number, id: string, name: string): GeoAchievement => ({
  id,
  name,
  blurb: `Play the Daily ${n} days in a row.`,
  group: "dailies",
  progress: (m) => count(m.dailyStreakBest, n),
});

const ranked = (index: number): GeoAchievement => ({
  id: `ranked-${GEO_DIVISIONS[index].id}`,
  name: `${GEO_DIVISIONS[index].name} rank`,
  blurb: `Reach ${GEO_DIVISIONS[index].name} in ranked duels.`,
  group: "ranked",
  progress: (m) => ({ have: Math.min(m.rankedDivision ?? 0, index), need: index, met: (m.rankedDivision ?? -1) >= index }),
});

const weekly = (place: number, id: string, name: string, blurb: string): GeoAchievement => ({
  id,
  name,
  blurb,
  group: "weekly",
  progress: (m) => ({ have: m.weeklyBestPlace !== null && m.weeklyBestPlace <= place ? 1 : 0, need: 1, met: m.weeklyBestPlace !== null && m.weeklyBestPlace <= place }),
});

export const GEO_ACHIEVEMENTS: GeoAchievement[] = [
  perfect(1, "perfect-1", "Pinpoint"),
  perfect(10, "perfect-10", "Sharpshooter"),
  perfect(100, "perfect-100", "Living Map"),
  ...GEO_STREAK_REGIONS.map(expert),
  streak(10, "streak-10", "On a Roll"),
  streak(25, "streak-25", "Unstoppable"),
  streak(50, "streak-50", "Pathfinder"),
  daily(3, "daily-3", "Regular"),
  daily(7, "daily-7", "Week of Dailies"),
  daily(30, "daily-30", "Daily Devotee"),
  ...[1, 2, 3, 4].map(ranked),
  weekly(3, "weekly-podium", "Weekly Podium", "Finish a Weekly Challenge in the top 3 (by the name you saved it under)."),
  weekly(1, "weekly-champion", "Weekly Champion", "Finish first on a Weekly Challenge."),
];

export const geoAchievement = (id: string) => GEO_ACHIEVEMENTS.find((a) => a.id === id) ?? null;

/** An achievement as the server sends it. */
export interface GeoAchievementState {
  id: string;
  earned: boolean;
  /** When it was first recorded (with migration 0048), ms. */
  earnedAt?: number;
  have: number;
  need: number;
  note?: string;
}

/** A region's mastery: places scored GEO_MASTERY_SCORE+ at least once, of its places. */
export interface GeoMasteryRow {
  id: string;
  name: string;
  mastered: number;
  places: number;
}

export interface GeoProgress {
  achievements: GeoAchievementState[];
  mastery: GeoMasteryRow[];
  rounds: number;
  perfectRounds: number;
}

/** Mastery as a whole percent (floored, so 100% means every place). */
export const masteryPercent = (r: Pick<GeoMasteryRow, "mastered" | "places">) => (r.places ? Math.floor((r.mastered / r.places) * 100) : 0);
