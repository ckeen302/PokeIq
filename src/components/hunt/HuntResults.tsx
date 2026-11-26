"use client";

import { useMemo, useState } from "react";
import { Sparkles, TrendingUp } from "lucide-react";
import type { GeoRegionInfo } from "@/lib/geo-types";
import { BEST_COLOR, WORST_COLOR, bestAndWorst } from "@/lib/geo-results";
import { useT } from "@/i18n/client";
import { formatNumber } from "@/i18n/format";
import { localeHref } from "@/i18n/href";
import huntNs from "@/messages/hunt";
import geoNs from "@/messages/geo";
import { GeoMap, type HuntMapSpot, type RevealedRound } from "@/components/geo/GeoMap";
import { END_MAP_PAD, END_MAP_PAD_PICKED, EndLines, EndRow, EndScreen, EndShareCard, EndTracker, RoundTag, ShareSquares, type TrackerCell } from "@/components/geo/EndScreen";
import type { HuntPokemonView } from "./HuntCard";
import { formTagOf } from "./HuntCard";
import { revealMarks, squaresLine, type HuntRevealPin, type HuntRevealSpot } from "./HuntReveal";
import { HUNT_ROUND_MAX } from "./hunt-ui";
import { huntShareText, huntSquare, type HuntShareRound } from "./share";
import { HuntEndBoard } from "./HuntBoard";

export interface HuntResultRound {
  pokemon: HuntPokemonView;
  /** The round's points, after hints. */
  score: number;
  hintCost: number;
  spots: HuntRevealSpot[];
  pin: HuntRevealPin | null;
}

/** The picked round's pin and flag on the map. */
const FOCUS_COLOR = "#ffd23c";

/**
 * The end of a hunt: PokéGuessr's end screen (GeoGuessr's, #367), the same one Classic ends on. The
 * total counts up over the dimmed map, the bar, what the hunt did (a new best), and on the Daily the
 * share card and today's board. NEXT hunts again (the Daily: back to the setup); the X goes back to
 * PokéGuessr. BREAKDOWN shows the whole map with every round's pin, its numbered flag on the nearest
 * real spot and the line between them (the best round green, the worst red); picking a round in the
 * tracker frames it and brings in all its other real spots, tagged with their games and methods.
 */
export function HuntResults({ region, rounds, modeLine, newBest, share, daily, onAgain, onHub }: {
  region: GeoRegionInfo;
  rounds: HuntResultRound[];
  modeLine: string;
  /** This hunt beat the mode's best on this device. */
  newBest?: boolean;
  /** The Daily Hunt's share card. */
  share?: { title: string; rounds: HuntShareRound[] };
  /** The Daily Hunt: its date, and its signed result for the board (none for a Daily played again). */
  daily?: { date: string; resultToken?: string; practice?: boolean };
  onAgain: () => void;
  onHub: () => void;
}) {
  const t = useT(huntNs);
  const g = useT(geoNs);
  const fmt = (n: number) => formatNumber(n, t.locale);
  const scores = rounds.map((r) => r.score);
  const total = scores.reduce((a, b) => a + b, 0);
  const max = rounds.length * HUNT_ROUND_MAX;
  const { best, worst } = bestAndWorst(scores);
  const [focus, setFocus] = useState<number | null>(null);
  const tone = (i: number): "best" | "worst" | undefined => (i === best ? "best" : i === worst ? "worst" : undefined);

  // Every round's pin and its nearest spot (numbered flags); a picked round's other spots too.
  const marks = useMemo(() => rounds.map((r) => revealMarks(r.spots, r.pin, t)), [rounds, t]);
  const revealed = useMemo<RevealedRound[]>(
    () =>
      rounds.map((r, i) => {
        const m = marks[i].revealed[0];
        const first = r.spots[0];
        return {
          guess: m?.guess ?? null,
          answer: m?.answer ?? { pin: [first?.x ?? 0.5, first?.y ?? 0.5], mask: first?.mask ?? [] },
          flag: String(i + 1),
          color: focus === i ? FOCUS_COLOR : i === best ? BEST_COLOR : i === worst ? WORST_COLOR : undefined,
        };
      }),
    [rounds, marks, best, worst, focus]
  );
  const others: HuntMapSpot[] | undefined = focus !== null ? marks[focus]?.others.filter((_, k) => rounds[focus].pin || k > 0) : undefined;

  const cells: TrackerCell[] = rounds.map((x, i) => ({
    top: (
      <span className="relative inline-flex">
        {/* eslint-disable-next-line @next/next/no-img-element -- the round's art, already cached */}
        <img src={x.pokemon.art} alt="" className="h-7 w-7 object-contain md:h-9 md:w-9" />
        <span className="absolute -left-1.5 -top-1">
          <RoundTag n={i + 1} tone={tone(i)} />
        </span>
      </span>
    ),
    value: fmt(x.score),
    tone: tone(i),
    label: `${t("results.show", { n: i + 1 })}: ${x.pokemon.name} · ${fmt(x.score)}`,
  }));

  const lines = newBest ? [{ key: "best", icon: <TrendingUp className="h-[1em] w-[1em]" aria-hidden />, text: g("end.newBest"), testId: "hunt-end-best" }] : [];
  const picked = focus !== null ? rounds[focus] : null;
  const formTag = picked ? formTagOf(t, picked.pokemon) : null;
  const near = picked?.pin ? picked.spots[picked.pin.spot] : undefined;

  const aside = picked && focus !== null && (
    <div className="flex w-[min(22rem,100%)] items-center gap-2.5 rounded-xl bg-[#1e1a3f]/95 p-2 pr-3 text-white shadow-[0_8px_28px_rgb(0_0_0/0.45)] ring-2 ring-[#5a4fb8]/70 backdrop-blur" data-testid="hunt-results-focus">
      {/* eslint-disable-next-line @next/next/no-img-element -- the round's art, already cached */}
      <img src={picked.pokemon.art} alt="" className="h-10 w-10 shrink-0 object-contain" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-sm font-bold uppercase italic leading-tight">
          {picked.pokemon.name}
          {formTag ? <span className="text-[#ff8ab3]"> · {formTag}</span> : null}
        </span>
        <span className="block truncate text-xs text-white/70">
          {picked.pin ? [squaresLine(picked.pin.squares, g), near?.place].filter(Boolean).join(" · ") : t("reveal.timeUp")}
        </span>
        {picked.hintCost > 0 && (
          <span className="flex items-center gap-1 text-[11px] text-[#ffb3b3]">
            <Sparkles className="h-3 w-3" aria-hidden />
            {t("hints.spent", { cost: fmt(picked.hintCost) })}
          </span>
        )}
      </span>
      <span className="shrink-0 font-display text-base font-bold italic tabular-nums text-[#ffd23c]">{fmt(picked.score)}</span>
    </div>
  );

  const legend =
    best !== null ? (
      <div className="flex gap-2 font-display text-[11px] font-semibold uppercase tracking-wider text-white" aria-hidden>
        <span className="flex items-center gap-1.5 rounded bg-black/55 px-2 py-1 backdrop-blur">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: BEST_COLOR }} />
          {g("results.bestRound")}
        </span>
        <span className="flex items-center gap-1.5 rounded bg-black/55 px-2 py-1 backdrop-blur">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: WORST_COLOR }} />
          {g("results.worstRound")}
        </span>
      </div>
    ) : null;

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <EndScreen
      testId="hunt-results"
      nextTestId="hunt-again"
      map={<GeoMap region={region} revealed={revealed} spots={others} fill fit={{ duration: 900, pad: focus === null ? END_MAP_PAD : END_MAP_PAD_PICKED, whole: true }} focus={focus} />}
      score={{ value: total, max, segments: rounds.length, label: g("end.yourScore"), unit: g("end.ofPoints", { max: fmt(max) }) }}
      title={t("results.title")}
      mode={modeLine}
      tracker={<EndTracker cells={cells} total={fmt(total)} focus={focus} onFocus={setFocus} wide />}
      aside={aside}
      legend={legend}
      onNext={onAgain}
      onExit={onHub}
      exitLabel={t("results.hub")}
    >
      {lines.length > 0 && (
        <EndRow order={0}>
          <EndLines lines={lines} />
        </EndRow>
      )}
      {share && (
        <EndRow order={1}>
          <EndShareCard
            testId="hunt-share"
            buttonTestId="hunt-share-button"
            title={share.title}
            sub={g("end.scoreLine", { score: fmt(total) })}
            text={huntShareText({ title: share.title, rounds: share.rounds, locale: t.locale })}
            url={`${origin}${localeHref("/pokeguessr", t.locale).href}#hunt`}
            kind="hunt"
            picture={<ShareSquares rows={[share.rounds.map((x) => huntSquare(x.score))]} label={t("share.legend")} />}
          />
        </EndRow>
      )}
      {daily && (
        <EndRow order={2}>
          <HuntEndBoard date={daily.date} resultToken={daily.resultToken} practice={daily.practice} />
        </EndRow>
      )}
    </EndScreen>
  );
}
