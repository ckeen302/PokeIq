import Link from "@/components/ui/Link";
import { Flame } from "lucide-react";
import type { GeoPlayerStats, GeoStatRow } from "@/lib/server/geo-round-scores";
import type { StreakBest } from "@/lib/server/geo-streak";
import { Card, CardContent } from "@/components/ui/card";
import type { GeoProgress } from "@/lib/geo-achievements";
import { AchievementGrid, GEO_ACHIEVEMENT_TOTAL, MasteryList } from "./GeoAchievements";
import { cn } from "@/lib/utils";
import { serverT } from "@/i18n/server";
import { formatNumber, type Translator } from "@/i18n/catalog";
import geoRecord from "@/messages/geo-record";
import geoNamesNs from "@/messages/geo-names";
import { GEO_MASTERY_SCORE } from "@/lib/geo-achievements";
import { localGame, localRegion } from "@/lib/geo-i18n";

type RecordT = Translator<typeof geoRecord.en>;

/** One row of the by-region / by-game table: accuracy as a bar, the best round, and streak picks where there are any. */
function StatRow({ r, label, t }: { r: GeoStatRow; label: string; t: RecordT }) {
  const fmt = (n: number) => formatNumber(n, t.locale);
  return (
    <li className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-2 text-sm sm:grid-cols-[9.5rem_1fr_auto]" data-testid="profile-geo-row">
      <span className="truncate font-semibold" title={label}>
        {label}
      </span>
      {r.rounds ? (
        <span className="flex items-center gap-2" title={t("profile.accuracyOver", { pct: r.accuracy, n: r.rounds, rounds: fmt(r.rounds) })}>
          <span className="meter h-2 flex-1">
            <span className={cn("block h-full", r.accuracy >= 70 ? "bg-success" : r.accuracy >= 40 ? "bg-warning" : "bg-primary")} style={{ width: `${r.accuracy}%` }} />
          </span>
          <span className="w-9 text-right font-pixel text-[10px] tabular-nums text-muted-foreground">{r.accuracy}%</span>
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">
          {t("profile.picks", { hits: r.streakHits, picks: r.streakPicks })}
        </span>
      )}
      <span className="text-right font-pixel text-[10px] tabular-nums text-muted-foreground">{r.rounds ? t("profile.bestRound", { score: fmt(r.best) }) : ""}</span>
    </li>
  );
}

/**
 * A trainer's PokéGuessr record on their public profile: games and rounds
 * played, accuracy and best round by region and by game, and their best
 * region streak. Everything comes from the rounds they played signed in.
 */
export function GeoProfileStats({ stats, streak, progress }: { stats: GeoPlayerStats | null; streak: StreakBest | null; progress?: GeoProgress | null }) {
  const t = serverT(geoRecord);
  const names = serverT(geoNamesNs);
  const fmt = (n: number) => formatNumber(n, t.locale);
  const played = !!stats && (stats.rounds > 0 || stats.streakPicks > 0);
  const avg = stats && stats.rounds ? Math.round(stats.byRegion.reduce((s, r) => s + r.accuracy * r.rounds, 0) / Math.max(1, stats.byRegion.reduce((s, r) => s + r.rounds, 0))) : null;
  const bestRound = stats ? Math.max(0, ...stats.byRegion.map((r) => r.best)) : 0;
  return (
    <Card data-testid="profile-geo-stats">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="hud-label text-screen">{t("profile.title")}</p>
          <Link href="/pokeguessr" className="hud-label hover:text-foreground">
            {t("profile.play")}
          </Link>
        </div>
        {played || (streak && streak.runs > 0) ? (
          <>
            <dl className="grid grid-cols-2 gap-3 text-center sm:grid-cols-5">
              {[
                [t("profile.games"), stats ? fmt(stats.games) : "0"],
                [t("profile.rounds"), stats ? fmt(stats.rounds) : "0"],
                [t("profile.accuracy"), avg === null ? "–" : t("profile.pct", { pct: avg })],
                [t("profile.best"), bestRound ? fmt(bestRound) : "–"],
                [t("profile.bestStreak"), streak ? `🔥${streak.best}` : "–"],
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
                    <p className="hud-label">{t("profile.byRegion")}</p>
                    <ul className="space-y-1.5">
                      {stats.byRegion.map((r) => (
                        <StatRow key={r.key} r={r} label={localRegion(names, r.key)} t={t} />
                      ))}
                    </ul>
                  </div>
                )}
                {stats.byGame.length > 0 && (
                  <div className="space-y-2">
                    <p className="hud-label">{t("profile.byGame")}</p>
                    <ul className="space-y-1.5">
                      {stats.byGame.slice(0, 9).map((r) => (
                        <StatRow key={r.key} r={r} label={localGame(names, r.key)} t={t} />
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            {streak && streak.runs > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Flame className="h-3.5 w-3.5 text-warning" aria-hidden />{` ${t("profile.runs", { n: streak.runs, runs: fmt(streak.runs), best: streak.best })}`}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("profile.empty")}</p>
        )}
        {progress && (progress.rounds > 0 || progress.achievements.some((a) => a.earned)) && (
          <div className="grid gap-5 border-t pt-4 lg:grid-cols-[3fr_2fr]" data-testid="profile-geo-progress">
            <div className="space-y-2">
              <p className="hud-label flex justify-between gap-2">
                <span>{t("achievements")}</span>
                <span className="tabular-nums">
                  {progress.achievements.filter((a) => a.earned).length}/{GEO_ACHIEVEMENT_TOTAL}
                </span>
              </p>
              <AchievementGrid achievements={progress.achievements} limit={4} />
            </div>
            <div className="space-y-2">
              <p className="hud-label">{t("mastery.title")}</p>
              <p className="text-xs text-muted-foreground">{t("mastery.blurb", { score: fmt(GEO_MASTERY_SCORE) })}</p>
              <MasteryList mastery={progress.mastery} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
