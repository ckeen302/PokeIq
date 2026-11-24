"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { GEO_MAX_ROUND_SCORE, type GeoGuessResponse, type GeoKind, type GeoRegionInfo } from "@/lib/geo-types";
import { isWorldwide } from "@/lib/geo-themes";
import { placeLabel, squaresText } from "@/lib/geo-names";
import { BEST_COLOR, WORST_COLOR, bestAndWorst } from "@/lib/geo-results";
import { GeoMap, type MapPin, type RevealedRound } from "./GeoMap";
import { END_MAP_PAD, END_MAP_PAD_PICKED, EndScreen, EndTracker, RoundTag, type TrackerCell } from "./EndScreen";
import { CrowdPanel, useGeoCrowd } from "./GeoCrowdMap";
import { useT } from "@/i18n/client";
import { formatNumber } from "@/i18n/format";
import geoNs from "@/messages/geo";
import { useGeoNames } from "@/lib/geo-i18n-client";

/** What the end screen needs of a finished game: the map and the rounds as graded. */
export interface ResultsGame {
  region: GeoRegionInfo;
  kind: GeoKind;
  rounds: number;
  daily?: string;
  /** The Weekly Challenge's week: like the Daily, played once. */
  weekly?: string;
}
export interface ResultsRound {
  guess: MapPin | null;
  graded: GeoGuessResponse;
}

/** The picked round's pins on the map. */
const FOCUS_COLOR = "#ffd23c";

/**
 * The end of a PokéGuessr game (solo, a region or a themed map, the Daily, the
 * Weekly, a challenge, a pin streak, Region Streak), GeoGuessr's: the score over
 * the dimmed map with `children` (the rows) under it, and the breakdown: every
 * round's pin, numbered flag and line, the tracker with each round's score (the
 * best and the worst lit), the picked round's place, and on the Daily the crowd
 * map. See EndScreen.
 */
export function GeoResults({
  game,
  played,
  pinImage,
  mode,
  resultToken,
  rival,
  onNext,
  onExit,
  children,
}: {
  game: ResultsGame;
  played: ResultsRound[];
  pinImage?: string;
  /** The map and the mode, under the title ("World · Daily #12"). */
  mode?: string;
  /** The signed result (the Daily's crowd map asks with it). */
  resultToken?: string;
  /** A challenge: the friend's score on the bar, and each of their rounds in the breakdown. */
  rival?: { name: string; score: number; rounds: number[] };
  onNext: () => void;
  onExit: () => void;
  children?: React.ReactNode;
}) {
  const t = useT(geoNs);
  const names = useGeoNames();
  const fmt = (n: number) => formatNumber(n, t.locale);
  const isStreak = game.kind === "streak";
  const isWorld = isWorldwide(game.region.id);
  const scores = played.map((p) => p.graded.score);
  const total = scores.reduce((s, x) => s + x, 0);
  const streak = played.filter((p) => p.graded.hit).length;
  const { best, worst } = isStreak ? { best: null, worst: null } : bestAndWorst(scores);
  const [focus, setFocus] = useState<number | null>(null);
  const crowd = useGeoCrowd(game.daily && !isStreak ? game.daily : undefined, resultToken, played.length);
  const [crowdOn, setCrowdOn] = useState(false);
  // The crowd map is one round's: switched on, it shows the picked round (the first one with a crowd, if none is picked).
  useEffect(() => {
    if (crowdOn && focus === null && crowd) setFocus(crowd.rounds[0].round - 1);
  }, [crowdOn, focus, crowd]);
  const crowdRound = crowdOn && crowd && focus !== null ? (crowd.rounds.find((r) => r.round === focus + 1) ?? null) : null;

  const toneOf = (i: number): "best" | "worst" | undefined => (i === best ? "best" : i === worst || (isStreak && !played[i]?.graded.hit) ? "worst" : undefined);
  const revealed = useMemo<RevealedRound[]>(
    () =>
      played.map((p, i) => ({
        guess: p.guess,
        answer: p.graded.answer,
        flag: String(i + 1),
        image: pinImage,
        color: focus === i ? FOCUS_COLOR : i === best ? BEST_COLOR : i === worst ? WORST_COLOR : undefined,
      })),
    [played, pinImage, best, worst, focus]
  );

  const max = game.rounds * GEO_MAX_ROUND_SCORE;
  /** "2.4 squares away", or spot on, in the page's language. */
  const squares = (n: number) => (n === 0 ? t("results.spotOn") : t("results.squares", { n, d: formatNumber(n, t.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }));
  const place = (i: number) => (t.locale === "en" ? placeLabel(played[i].graded.answer, game.region) : names.placeLabel(played[i].graded.answer, game.region));

  const cells: TrackerCell[] = played.map((p, i) => {
    const n = i + 1;
    if (isStreak) {
      return {
        top: <RoundTag n={n} tone={p.graded.hit ? undefined : "worst"} />,
        value: p.graded.hit ? <Check className="h-4 w-4 text-[#9be15d]" aria-hidden /> : <X className="h-4 w-4 text-[#ff5a5a]" aria-hidden />,
        label: `${t("roundN", { n })}: ${place(i)} · ${p.graded.hit ? t("results.correct") : t("results.missed")}`,
      };
    }
    const theirs = rival?.rounds[i];
    return {
      top: <RoundTag n={n} tone={toneOf(i)} />,
      value: fmt(p.graded.score),
      sub: theirs !== undefined ? <span className={theirs > p.graded.score ? "text-[#ffd23c]" : undefined}>{fmt(theirs)}</span> : undefined,
      tone: toneOf(i),
      label: `${t("roundN", { n })}: ${place(i)} · ${fmt(p.graded.score)}`,
    };
  });

  const picked = focus !== null ? played[focus] : null;
  const pickedLine = picked
    ? [
        names.game(picked.graded.answer.game),
        picked.graded.timedOut
          ? t("results.timeUp")
          : isStreak && isWorld
            ? picked.graded.hit
              ? t("results.rightRegion")
              : t("results.wrongRegion")
            : t.locale === "en"
              ? squaresText(picked.graded.answer.squares)
              : squares(picked.graded.answer.squares),
      ].join(" · ")
    : "";

  const aside = (
    <>
      {picked && focus !== null && (
        <div className="flex w-[min(22rem,100%)] items-start gap-2.5 rounded-xl bg-[#1e1a3f]/95 p-2.5 text-white shadow-[0_8px_28px_rgb(0_0_0/0.45)] ring-2 ring-[#5a4fb8]/70 backdrop-blur" data-testid="geo-end-place">
          <span className="pt-0.5">
            <RoundTag n={focus + 1} tone={toneOf(focus)} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-sm font-bold uppercase italic leading-tight">{place(focus)}</span>
            <span className="mt-0.5 block text-xs text-white/70">
              {pickedLine}
              {picked.graded.gameGuess?.correct ? <span className="text-[#9be15d]"> · +{fmt(picked.graded.gameGuess.bonus)}</span> : null}
            </span>
          </span>
          {!isStreak && <span className="shrink-0 font-display text-base font-bold italic tabular-nums text-[#ffd23c]">{fmt(picked.graded.score)}</span>}
        </div>
      )}
      {crowd && game.daily && resultToken && (
        <CrowdPanel crowd={crowd} date={game.daily} resultToken={resultToken} round={(focus ?? crowd.rounds[0].round - 1) + 1} on={crowdOn} onToggle={() => setCrowdOn((on) => !on)} />
      )}
    </>
  );

  const legend =
    best !== null ? (
      <div className="flex gap-2 font-display text-[11px] font-semibold uppercase tracking-wider text-white" aria-hidden>
        <span className="flex items-center gap-1.5 rounded bg-black/55 px-2 py-1 backdrop-blur">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: BEST_COLOR }} />
          {t("results.bestRound")}
        </span>
        <span className="flex items-center gap-1.5 rounded bg-black/55 px-2 py-1 backdrop-blur">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: WORST_COLOR }} />
          {t("results.worstRound")}
        </span>
      </div>
    ) : null;

  return (
    <EndScreen
      map={<GeoMap region={game.region} revealed={revealed} fill fit={{ duration: 900, pad: focus === null ? END_MAP_PAD : END_MAP_PAD_PICKED, whole: true }} focus={focus} density={crowdRound} />}
      score={
        isStreak
          ? { value: streak, label: t("end.yourStreak"), unit: t("end.inARow") }
          : { value: total, max, segments: game.rounds, label: t("end.yourScore"), unit: t("end.ofPoints", { max: fmt(max) }), ...(rival ? { rival: { value: rival.score, name: rival.name } } : {}) }
      }
      title={isStreak ? t("results.streakOver") : t("results.complete")}
      mode={mode ?? names.map(game.region)}
      tracker={
        <EndTracker
          cells={cells}
          total={isStreak ? fmt(streak) : fmt(total)}
          totalSub={rival && !isStreak ? `${rival.name} ${fmt(rival.score)}` : undefined}
          focus={focus}
          onFocus={setFocus}
          perRow={isStreak ? 10 : 5}
        />
      }
      aside={aside}
      legend={legend}
      onNext={onNext}
      onExit={onExit}
    >
      {children}
    </EndScreen>
  );
}
