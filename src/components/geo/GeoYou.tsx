"use client";

import Link from "@/components/ui/Link";
import { BarChart3, History, Medal, Trophy } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { GEO_MASTERY_SCORE, masteryPercent } from "@/lib/geo-achievements";
import { HubSection, HubTile } from "./HubParts";
import { AchievementGrid, GEO_ACHIEVEMENT_TOTAL, MasteryList, type MyGeoProgress } from "./GeoAchievements";
import { useT } from "@/i18n/client";
import { formatNumber } from "@/i18n/catalog";
import geoSolo from "@/messages/geo-solo";
import geoRecord from "@/messages/geo-record";
import { useGeoNames } from "@/lib/geo-i18n-client";

/**
 * The hub's You section: the player's record (their profile when signed in),
 * duel history, the leaderboards, their achievements and their mastery of
 * each region. Everything is read from the server (/api/geo/progress).
 */
export function GeoYou({ progress }: { progress: MyGeoProgress | null }) {
  const t = useT(geoSolo);
  const r = useT(geoRecord);
  const names = useGeoNames();
  const fmt = (n: number) => formatNumber(n, t.locale);
  const earned = progress?.achievements.filter((a) => a.earned).length ?? 0;
  const mastered = progress?.mastery.reduce((s, r) => s + r.mastered, 0) ?? 0;
  const places = progress?.mastery.reduce((s, r) => s + r.places, 0) ?? 0;
  const top = progress ? [...progress.mastery].sort((a, b) => masteryPercent(b) - masteryPercent(a))[0] : undefined;
  return (
    <HubSection id="you" eyebrow={t("you.eyebrow")} title={t("you.title")}>
      <div className="grid gap-4 sm:grid-cols-3">
        <HubTile
          testId="geo-you-stats"
          tone="screen"
          icon={<BarChart3 className="h-5 w-5" />}
          label={progress?.signedIn && progress.username ? progress.username : t("you.device")}
          title={t("you.stats")}
          blurb={
            progress && progress.rounds > 0
              ? `${t("you.logged", { n: progress.rounds, rounds: fmt(progress.rounds), perfect: fmt(progress.perfectRounds) })} ${progress.signedIn ? t("you.onProfile") : t("you.signInToKeep")}`
              : progress?.signedIn
                ? t("you.firstSignedIn")
                : t("you.first")
          }
          action={
            progress?.signedIn && progress.username ? (
              <Link href={`/u/${encodeURIComponent(progress.username)}`} className={cn(buttonVariants({ variant: "outline" }), "w-full")} data-testid="geo-you-profile">
                {t("you.profile")}
              </Link>
            ) : (
              <Link href="/login" className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
                {t("you.signIn")}
              </Link>
            )
          }
        />
        <HubTile
          testId="geo-you-history"
          tone="primary"
          icon={<History className="h-5 w-5" />}
          label={t("hub.multi.duels")}
          title={t("you.history")}
          blurb={t("you.historyBlurb")}
          action={
            <Link href="/pokeguessr/history" className={cn(buttonVariants({ variant: "outline" }), "w-full")} data-testid="geo-history-link">
              {t("you.history")}
            </Link>
          }
        />
        <HubTile
          testId="geo-you-boards"
          tone="warning"
          icon={<Trophy className="h-5 w-5" />}
          label={t("you.boardsLabel")}
          title={t("you.boards")}
          blurb={t("you.boardsBlurb")}
          action={
            <Link href="/leaderboard?board=geo" className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
              {t("you.boards")}
            </Link>
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" data-testid="geo-you-achievements">
          <CardContent className="space-y-4 p-5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="hud-label flex items-center gap-1.5 text-warning">
                <Medal className="h-3.5 w-3.5" aria-hidden />{` ${r("achievements")}`}
              </p>
              <p className="font-pixel text-[10px] tabular-nums text-muted-foreground" data-testid="geo-achievement-count">
                {r("earnedOf", { n: earned, total: GEO_ACHIEVEMENT_TOTAL })}
              </p>
            </div>
            {progress ? (
              <AchievementGrid achievements={progress.achievements} limit={6} />
            ) : (
              <div className="grid gap-2 sm:grid-cols-2" aria-hidden>
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="h-[4.5rem] animate-pulse rounded-md border bg-shade/20" />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card data-testid="geo-you-mastery">
          <CardContent className="space-y-4 p-5">
            <div className="space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="hud-label text-success">{r("mastery.title")}</p>
                {places > 0 && (
                  <p className="font-pixel text-[10px] tabular-nums text-muted-foreground">
                    {r("mastery.places", { n: fmt(mastered), total: fmt(places) })}
                  </p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {r("mastery.blurb", { score: fmt(GEO_MASTERY_SCORE) })}
                {top && masteryPercent(top) > 0 ? ` ${r("mastery.best", { region: names.region(top.name) })}` : ""}
              </p>
            </div>
            {progress ? (
              <MasteryList mastery={progress.mastery} />
            ) : (
              <div className="space-y-2" aria-hidden>
                {Array.from({ length: 9 }, (_, i) => (
                  <div key={i} className="h-4 animate-pulse rounded-sm bg-shade/20" />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </HubSection>
  );
}
