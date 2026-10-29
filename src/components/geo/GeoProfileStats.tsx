import Link from "next/link";
import { Flame } from "lucide-react";
import type { GeoPlayerStats, GeoStatRow } from "@/lib/server/geo-round-scores";
import type { StreakBest } from "@/lib/server/geo-streak";
import { Card, CardContent } from "@/components/ui/card";
import type { GeoProgress } from "@/lib/geo-achievements";
import { AchievementGrid, GEO_ACHIEVEMENT_TOTAL, MASTERY_BLURB, MasteryList } from "./GeoAchievements";
import { cn } from "@/lib/utils";

const fmt = (n: number) => n.toLocaleString("en-US");

/** One row of the by-region / by-game table: accuracy as a bar, the best round, and streak picks where there are any. */
function StatRow({ r }: { r: GeoStatRow }) {
  return (
    <li className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-2 text-sm sm:grid-cols-[9.5rem_1fr_auto]" data-testid="profile-geo-row">
      <span className="truncate font-semibold" title={r.key}>
        {r.key}
      </span>
      {r.rounds ? (
        <span className="flex items-center gap-2" title={`${r.accuracy}% average accuracy over ${fmt(r.rounds)} round${r.rounds === 1 ? "" : "s"}`}>
          <span className="meter h-2 flex-1">
            <span className={cn("block h-full", r.accuracy >= 70 ? "bg-success" : r.accuracy >= 40 ? "bg-warning" : "bg-primary")} style={{ width: `${r.accuracy}%` }} />
          </span>
          <span className="w-9 text-right font-pixel text-[10px] tabular-nums text-muted-foreground">{r.accuracy}%</span>
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">
          {r.streakHits}/{r.streakPicks} streak picks
        </span>
      )}
      <span className="text-right font-pixel text-[10px] tabular-nums text-muted-foreground">{r.rounds ? `best ${fmt(r.best)}` : ""}</span>
    </li>
  );
}

/**
 * A trainer's PokéGuessr record on their public profile: games and rounds
 * played, accuracy and best round by region and by game, and their best
 * region streak. Everything comes from the rounds they played signed in.
 */
export function GeoProfileStats({ stats, streak, progress }: { stats: GeoPlayerStats | null; streak: StreakBest | null; progress?: GeoProgress | null }) {
  const played = !!stats && (stats.rounds > 0 || stats.streakPicks > 0);
  const avg = stats && stats.rounds ? Math.round(stats.byRegion.reduce((s, r) => s + r.accuracy * r.rounds, 0) / Math.max(1, stats.byRegion.reduce((s, r) => s + r.rounds, 0))) : null;
  const bestRound = stats ? Math.max(0, ...stats.byRegion.map((r) => r.best)) : 0;
  return (
    <Card data-testid="profile-geo-stats">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="hud-label text-screen">PokéGuessr record</p>
          <Link href="/guessr" className="hud-label hover:text-foreground">
            Play →
          </Link>
        </div>
        {played || (streak && streak.runs > 0) ? (
          <>
            <dl className="grid grid-cols-2 gap-3 text-center sm:grid-cols-5">
              {[
                ["Games", stats ? fmt(stats.games) : "0"],
                ["Rounds", stats ? fmt(stats.rounds) : "0"],
                ["Accuracy", avg === null ? "–" : `${avg}%`],
                ["Best round", bestRound ? fmt(bestRound) : "–"],
                ["Best streak", streak ? `🔥${streak.best}` : "–"],
              ].map(([label, value]) => (
                <div key={label} className="flex flex-col-reverse rounded-md border bg-shade/20 p-2">
                  <dt className="text-[11px] text-muted-foreground">{label}</dt>
                  <dd className="font-display text-xl font-bold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            {stats && (stats.byRegion.length > 0 || stats.byGame.length > 0) && (
              <div className="grid gap-4 md:grid-cols-2">
                {stats.byRegion.length > 0 && (
                  <div className="space-y-2">
                    <p className="hud-label">By region</p>
                    <ul className="space-y-1.5">
                      {stats.byRegion.map((r) => (
                        <StatRow key={r.key} r={r} />
                      ))}
                    </ul>
                  </div>
                )}
                {stats.byGame.length > 0 && (
                  <div className="space-y-2">
                    <p className="hud-label">By game</p>
                    <ul className="space-y-1.5">
                      {stats.byGame.slice(0, 9).map((r) => (
                        <StatRow key={r.key} r={r} />
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            {streak && streak.runs > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Flame className="h-3.5 w-3.5 text-warning" aria-hidden /> {fmt(streak.runs)} Region Streak run{streak.runs === 1 ? "" : "s"}, best {streak.best} in a row.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No PokéGuessr rounds on record yet: games played signed in count here.</p>
        )}
        {progress && (progress.rounds > 0 || progress.achievements.some((a) => a.earned)) && (
          <div className="grid gap-5 border-t pt-4 lg:grid-cols-[3fr_2fr]" data-testid="profile-geo-progress">
            <div className="space-y-2">
              <p className="hud-label flex justify-between gap-2">
                <span>Achievements</span>
                <span className="tabular-nums">
                  {progress.achievements.filter((a) => a.earned).length}/{GEO_ACHIEVEMENT_TOTAL}
                </span>
              </p>
              <AchievementGrid achievements={progress.achievements} limit={4} />
            </div>
            <div className="space-y-2">
              <p className="hud-label">Mastery</p>
              <p className="text-xs text-muted-foreground">{MASTERY_BLURB}</p>
              <MasteryList mastery={progress.mastery} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
