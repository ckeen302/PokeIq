"use client";
import { useEffect, useRef, useState } from "react";
import { Crown, Sparkles, Swords, TrendingUp } from "lucide-react";
import { geoBoardKey, type GeoChallenge } from "@/lib/geo-types";
import { dailyNumber } from "@/lib/daily";
import { geoWeeklyBoard, geoWeeklyNumber } from "@/lib/geo-weekly";
import { guessrShareText, shareUrl, type GuessrShareResult } from "@/lib/share";
import { COMPARE_MIN_PLAYERS, bucketOf, percentBeaten, type GeoDailyStats } from "@/lib/geo-compare";
import { geoAchievement, type GeoAchievementState } from "@/lib/geo-achievements";
import { achievementText } from "@/lib/geo-achievements-text";
import { BadgeMedal } from "@/components/game/BadgeMedal";
import { NextDailyCountdown } from "@/components/NextDailyCountdown";
import { DailyEmailNudge } from "@/components/email/DailyEmailNudge";
import { achievementIcon } from "./GeoAchievements";
import { EndBoard, EndLines, EndMedals, EndProgress, EndRow, EndShareCard, ShareSquares, medalName } from "./EndScreen";
import { cn } from "@/lib/utils";
import { type Game, type Played, type Reward, emoji, post } from "./GeoGame";
import { useT } from "@/i18n/client";
import { type Translator } from "@/i18n/catalog";
import { formatNumber } from "@/i18n/format";
import geoNs from "@/messages/geo";
import geoSolo from "@/messages/geo-solo";
import badgesNs from "@/messages/badges";
import geoRecord from "@/messages/geo-record";
import geoNamesNs from "@/messages/geo-names";
import share from "@/messages/share";
import { localeHref } from "@/i18n/href";
import { useGeoNames } from "@/lib/geo-i18n-client";

type SoloT = Translator<typeof geoSolo.en>;

/** Squares in a row on the share card, and rows at most. */
const PER_ROW = 5;

/**
 * The end screen's rows for a solo game, the Daily, the Weekly and a challenge
 * (GeoResults draws the score, the map and the breakdown), in GeoGuessr's order:
 *  1. what the game did: beat the friend who sent the challenge, a new personal best, the game bonus;
 *  2. the Daily: how the day's players compared;
 *  3. the badges and achievements it earned (GeoGuessr's medal row), or, if none, the achievement it brought closer;
 *  4. sharing: the result with its link (the challenge link: a friend plays the same places);
 *  5. the leaderboard: a name to save the result under, or why this game isn't ranked;
 *  6. the Daily and the Weekly: when the next one comes.
 * Nothing here is made up: a row with nothing real to say isn't shown.
 */
export function GeoSummary({
  game,
  played,
  resultToken,
  challengeToken,
  challenge,
  reward,
  earned = [],
  closer = null,
  next,
  onSeen,
}: {
  game: Pick<Game, "region" | "kind" | "rounds" | "daily" | "weekly" | "practice" | "filter" | "guessGame" | "difficulty">;
  played: Played[];
  resultToken?: string;
  challengeToken?: string;
  challenge?: GeoChallenge;
  reward: Reward | null;
  /** Achievements this game earned (the server's record, read after the game). */
  earned?: string[];
  /** The achievement this game brought closest, not yet earned. */
  closer?: GeoAchievementState | null;
  /** The Weekly's "Next Weekly in …". */
  next?: React.ReactNode;
  /** The achievements shown here have been seen (no toast for them after). */
  onSeen?: (id: string) => void;
}) {
  const t = useT(geoSolo);
  const g = useT(geoNs);
  const bt = useT(badgesNs);
  const rt = useT(geoRecord);
  const nt = useT(geoNamesNs);
  const names = useGeoNames();
  const shareT = useT(share);
  const fmt = (n: number) => formatNumber(n, t.locale);
  const { region } = game;
  const isStreak = game.kind === "streak";
  const total = played.reduce((s, p) => s + p.graded.score, 0);
  const bonus = game.guessGame ? (played.at(-1)?.graded.bonusTotal ?? 0) : null;
  const streak = played.filter((p) => p.graded.hit).length;

  // The achievements shown here are seen: they don't pop up again as toasts once this screen goes.
  const seen = useRef<string[]>([]);
  seen.current = earned;
  const seenBy = useRef(onSeen);
  seenBy.current = onSeen;
  useEffect(() => () => seen.current.forEach((id) => seenBy.current?.(id)), []);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const shareResult: GuessrShareResult = {
    game: "guessr",
    ...(game.daily ? { daily: dailyNumber(game.daily) } : game.weekly ? { weekly: geoWeeklyNumber(game.weekly) } : {}),
    region: region.id,
    ...(isStreak ? { streak } : { rounds: played.map((p) => p.graded.score) }),
  };
  // The Daily and the Weekly are the same places for everyone: a friend plays their own (ranked) game from the result's link,
  // never a challenge replay of them (unranked, and it would use up their places). Other games challenge with the same places.
  const sharedPlaces = !!(game.daily || game.weekly);
  const challengeUrl = challengeToken && !sharedPlaces ? `${origin}${localeHref(`/pokeguessr/c/${encodeURIComponent(challengeToken)}`, t.locale).href}` : null;
  const canRank = !game.practice && !!resultToken;
  const modeName = game.difficulty ? names.difficulty(game.difficulty) : undefined;
  // The result, then the challenge link (same places) when there is one, else the result's own page.
  const shareBody = guessrShareText(shareResult, names.map(region), undefined, { mode: modeName }, shareT);
  const shareLink = challengeUrl ?? shareUrl(shareResult, t.locale);

  const theirs = challenge?.score ?? 0;
  const outcome = challenge ? (total > theirs ? "win" : total < theirs ? "lose" : "tie") : null;
  const them = challenge?.name;

  // 1. What the game did.
  const lines = [
    outcome && {
      key: "challenge",
      icon: outcome === "win" ? <Crown className="h-[1em] w-[1em]" aria-hidden /> : <Swords className="h-[1em] w-[1em]" aria-hidden />,
      text: outcome === "win" ? (them ? t("summary.beat", { name: them }) : t("summary.beatThem")) : outcome === "lose" ? (them ? t("summary.lost", { name: them }) : t("summary.lostThem")) : t("summary.tie"),
      tone: outcome === "win" ? ("win" as const) : outcome === "lose" ? ("lose" as const) : ("gold" as const),
      testId: "geo-end-challenge",
    },
    // A best beaten (a first game on a board has none to beat: its badge says enough).
    reward?.best && reward.previous ? { key: "best", icon: <TrendingUp className="h-[1em] w-[1em]" aria-hidden />, text: g("end.newBestWas", { score: fmt(reward.previous) }), testId: "geo-end-best" } : null,
    bonus !== null && {
      key: "bonus",
      icon: <Sparkles className="h-[1em] w-[1em]" aria-hidden />,
      text: <span className="text-[0.8em]">{t("summary.bonus", { bonus: fmt(bonus), total: fmt(total + bonus) })}</span>,
      testId: "geo-bonus-total",
    },
  ].filter((l): l is Exclude<typeof l, false | null | undefined> => !!l);

  // 3. The badges and achievements this game earned.
  const medals = [
    ...(reward?.newBadges ?? []).map((b) => {
      const key = b.id as keyof typeof badgesNs.en & string;
      return { key: `badge:${b.id}`, medal: <BadgeMedal id={b.id} />, text: g.rich("end.earned", { name: bt(`${key}.name`), b: medalName }) };
    }),
    ...earned.flatMap((id) => {
      const def = geoAchievement(id);
      return def ? [{ key: `geo:${id}`, medal: <BadgeMedal id={id} icon={achievementIcon(id)} />, text: g.rich("end.earned", { name: achievementText(def, rt, nt).name, b: medalName }) }] : [];
    }),
  ];
  const closerDef = closer ? geoAchievement(closer.id) : null;

  const rows: { key: string; node: React.ReactNode; testId?: string }[] = [];
  if (lines.length) rows.push({ key: "lines", node: <EndLines lines={lines} /> });
  if (game.daily && !isStreak) rows.push({ key: "compare", node: <DailyCompare date={game.daily} score={total} t={t} /> });
  if (medals.length) rows.push({ key: "medals", node: <EndMedals items={medals.slice(0, 2)} more={medals.length > 2 ? g("end.more", { n: medals.length - 2 }) : undefined} /> });
  else if (closer && closerDef)
    rows.push({
      key: "closer",
      node: (
        <EndProgress
          medal={<BadgeMedal id={closer.id} icon={achievementIcon(closer.id)} unlocked={false} />}
          text={g.rich("end.progress", { name: achievementText(closerDef, rt, nt).name, have: fmt(closer.have), need: fmt(closer.need), b: medalName })}
          have={closer.have}
          need={closer.need}
        />
      ),
    });
  rows.push({
    key: "share",
    node: (
      <EndShareCard
        title={challengeUrl ? g("end.challengeTitle") : g("end.shareTitle")}
        sub={isStreak ? g("inARow", { n: streak }) : g("end.scoreLine", { score: fmt(total) })}
        text={shareBody}
        url={shareLink}
        kind="guessr"
        picture={<ShareSquares rows={squares(isStreak ? streak : null, played.map((p) => p.graded.score))} label={isStreak ? g("inARow", { n: streak }) : played.map((p) => fmt(p.graded.score)).join(" · ")} />}
      />
    ),
  });
  rows.push({
    key: "board",
    node: (
      <EndBoard
        href={
          game.daily
            ? `/leaderboard?board=geo&date=${game.daily}`
            : game.weekly
              ? `/leaderboard?board=geo&format=${geoWeeklyBoard(game.weekly)}`
              : `/leaderboard?board=geo&format=${geoBoardKey({ region: region.id, kind: game.kind, era: game.filter.era, rounds: game.rounds })}`
        }
        boardLabel={t("summary.leaderboard")}
        save={
          canRank
            ? {
                label: t("summary.save"),
                placeholder: t("summary.name"),
                submit: t("summary.submit"),
                saved: t("summary.saved"),
                failed: t("summary.saveFailed"),
                onSave: (name) => post("/api/geo/leaderboard", { resultToken, playerName: name }).then(() => undefined),
              }
            : undefined
        }
        note={
          game.practice === "repeat-daily"
            ? t("summary.practice.daily")
            : game.practice === "repeat-weekly"
              ? t("summary.practice.weekly")
              : game.practice === "challenge"
                ? t("summary.practice.challenge")
                : game.practice === "filtered"
                  ? t("summary.practice.filtered")
                  : game.practice === "difficulty"
                    ? t("summary.practice.difficulty")
                    : undefined
        }
      />
    ),
  });
  // 6. The Daily and the Weekly are played once: when the next one comes (and the Daily by email).
  if (game.daily)
    rows.push({
      key: "next",
      testId: "geo-results-next-daily",
      node: (
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
          <NextDailyCountdown label={g("results.nextDaily")} />
          <DailyEmailNudge className="border-none p-0 underline-offset-2 hover:underline" />
        </div>
      ),
    });
  else if (next) rows.push({ key: "next", node: next });

  return (
    <>
      {rows.map((r, i) => (
        <EndRow key={r.key} order={i} testId={r.testId}>
          {r.node}
        </EndRow>
      ))}
    </>
  );
}

/** The share card's squares: a round's colour each (five a row), or a streak's ticks and its cross. */
function squares(streak: number | null, scores: number[]): string[][] {
  const all = streak !== null ? [...Array<string>(Math.min(streak, PER_ROW * 2 - 1)).fill("✅"), "❌"] : scores.map(emoji);
  const rows: string[][] = [];
  for (let i = 0; i < all.length && rows.length < 2; i += PER_ROW) rows.push(all.slice(i, i + PER_ROW));
  return rows;
}

/**
 * The Daily's "how you compared": the share of the day's ranked players you
 * beat, with the day's scores in ten small bars (yours lit). Shown only with
 * enough players (games saved to the daily leaderboard); otherwise nothing.
 */
function DailyCompare({ date, score, t }: { date: string; score: number; t: SoloT }) {
  const fmt = (n: number) => formatNumber(n, t.locale);
  const [stats, setStats] = useState<GeoDailyStats | null>(null);
  useEffect(() => {
    let off = false;
    fetch(`/api/geo/daily-stats?date=${encodeURIComponent(date)}&score=${score}`)
      .then((r) => (r.ok ? (r.json() as Promise<GeoDailyStats>) : null))
      .then((s) => !off && setStats(s))
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [date, score]);
  if (!stats || stats.players < COMPARE_MIN_PLAYERS) return null;
  const beaten = percentBeaten(stats);
  const mine = bucketOf(score);
  const tallest = Math.max(1, ...stats.buckets);
  return (
    <div className="flex items-center gap-3" data-testid="geo-daily-compare">
      <div className="flex h-8 items-end gap-[2px]" role="img" aria-label={t("compare.spread", { bar: mine + 1, bars: stats.buckets.length })}>
        {stats.buckets.map((n, i) => (
          <span key={i} className={cn("w-1.5 rounded-t-[1px]", i === mine ? "bg-[#ffd23c]" : "bg-white/30")} style={{ height: `${Math.max(n ? 12 : 6, (n / tallest) * 100)}%` }} />
        ))}
      </div>
      <div className="text-left">
        {beaten !== null && (
          <p className="font-display text-[clamp(1rem,2.9vh,1.4rem)] font-bold italic leading-tight text-[#ffd23c] [text-shadow:0_2px_0_#120f24]" data-testid="geo-daily-percent">
            {t("compare.better", { pct: beaten })}
          </p>
        )}
        <p className="text-xs text-white/70">
          {t("compare.players", { n: fmt(stats.players) })}
          {stats.median !== undefined ? ` · ${t("compare.median", { score: fmt(stats.median) })}` : ""}
        </p>
      </div>
    </div>
  );
}

