"use client";

import Link from "next/link";
import { BarChart3, History, Medal, Trophy } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { masteryPercent } from "@/lib/geo-achievements";
import { HubSection, HubTile } from "./HubParts";
import { AchievementGrid, GEO_ACHIEVEMENT_TOTAL, MASTERY_BLURB, MasteryList, type MyGeoProgress } from "./GeoAchievements";

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * The hub's You section: the player's record (their profile when signed in),
 * duel history, the leaderboards, their achievements and their mastery of
 * each region. Everything is read from the server (/api/geo/progress).
 */
export function GeoYou({ progress }: { progress: MyGeoProgress | null }) {
  const earned = progress?.achievements.filter((a) => a.earned).length ?? 0;
  const mastered = progress?.mastery.reduce((s, r) => s + r.mastered, 0) ?? 0;
  const places = progress?.mastery.reduce((s, r) => s + r.places, 0) ?? 0;
  const top = progress ? [...progress.mastery].sort((a, b) => masteryPercent(b) - masteryPercent(a))[0] : undefined;
  return (
    <HubSection id="you" eyebrow="Your record" title="You">
      <div className="grid gap-4 sm:grid-cols-3">
        <HubTile
          testId="geo-you-stats"
          tone="screen"
          icon={<BarChart3 className="h-5 w-5" />}
          label={progress?.signedIn && progress.username ? progress.username : "This device"}
          title="Stats"
          blurb={
            progress && progress.rounds > 0
              ? `${fmt(progress.rounds)} round${progress.rounds === 1 ? "" : "s"} logged, ${fmt(progress.perfectRounds)} perfect. ${progress.signedIn ? "Accuracy by region and game on your profile." : "Sign in to keep your record on a profile."}`
              : progress?.signedIn
                ? "Play a game and your accuracy by region and game shows on your profile."
                : "Play a game to start your record. Sign in to keep it on your profile."
          }
          action={
            progress?.signedIn && progress.username ? (
              <Link href={`/u/${encodeURIComponent(progress.username)}`} className={cn(buttonVariants({ variant: "outline" }), "w-full")} data-testid="geo-you-profile">
                Your profile
              </Link>
            ) : (
              <Link href="/login" className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
                Sign in
              </Link>
            )
          }
        />
        <HubTile
          testId="geo-you-history"
          tone="primary"
          icon={<History className="h-5 w-5" />}
          label="Duels"
          title="Duel history"
          blurb="Your past duels and ranked matches, round by round."
          action={
            <Link href="/guessr/history" className={cn(buttonVariants({ variant: "outline" }), "w-full")} data-testid="geo-history-link">
              Duel history
            </Link>
          }
        />
        <HubTile
          testId="geo-you-boards"
          tone="warning"
          icon={<Trophy className="h-5 w-5" />}
          label="Daily · Weekly · Maps"
          title="Leaderboards"
          blurb="The Daily, the Weekly Challenge, every map's boards and the ranked ladder."
          action={
            <Link href="/leaderboard?board=geo" className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
              Leaderboards
            </Link>
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" data-testid="geo-you-achievements">
          <CardContent className="space-y-4 p-5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="hud-label flex items-center gap-1.5 text-warning">
                <Medal className="h-3.5 w-3.5" aria-hidden /> Achievements
              </p>
              <p className="font-pixel text-[10px] tabular-nums text-muted-foreground" data-testid="geo-achievement-count">
                {earned}/{GEO_ACHIEVEMENT_TOTAL} earned
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
                <p className="hud-label text-success">Mastery</p>
                {places > 0 && (
                  <p className="font-pixel text-[10px] tabular-nums text-muted-foreground">
                    {fmt(mastered)}/{fmt(places)} places
                  </p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {MASTERY_BLURB}
                {top && masteryPercent(top) > 0 ? ` Best: ${top.name}.` : ""}
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
