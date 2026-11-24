"use client";

import { useState } from "react";
import { TrendingUp } from "lucide-react";
import type { GeoRegionInfo } from "@/lib/geo-types";
import { WORLD_REGION } from "@/lib/geo-types";
import { bestAndWorst } from "@/lib/geo-results";
import { useT } from "@/i18n/client";
import { formatNumber } from "@/i18n/format";
import { localeHref } from "@/i18n/href";
import huntNs from "@/messages/hunt";
import geoNs from "@/messages/geo";
import { GeoMap } from "@/components/geo/GeoMap";
import { END_MAP_PAD_PICKED, EndLines, EndRow, EndScreen, EndShareCard, EndTracker, ShareSquares, type TrackerCell } from "@/components/geo/EndScreen";
import type { HuntPokemonView } from "./HuntCard";
import { shortLabel, type HuntRevealPin, type HuntRevealSpot } from "./HuntReveal";
import { HUNT_ROUND_MAX, verdictOf } from "./hunt-ui";
import { formTagOf } from "./HuntCard";
import { huntShareText, huntSquare, type HuntShareRound } from "./share";

export interface HuntResultRound {
  pokemon: HuntPokemonView;
  score: number;
  regionsFound: number;
  regionsTotal: number;
  spots: HuntRevealSpot[];
  pins: HuntRevealPin[];
}

/**
 * The end of a hunt, PokéGuessr's end screen (GeoGuessr's): the total counting
 * up over the dimmed map, the bar, what the hunt did (a new best, the regions
 * found), the Daily Hunt's share card; NEXT hunts again (the Daily: back to the
 * hunts), the X goes to every hunt. BREAKDOWN shows the map: one round's spots
 * and the lines from its pins (the best round first), each round's Pokémon and
 * score in the tracker to pick another.
 */
export function HuntResults({ region, rounds, modeLine, newBest, share, onAgain, onHub }: {
  region: GeoRegionInfo;
  rounds: HuntResultRound[];
  modeLine: string;
  /** This hunt beat the mode's best on this device. */
  newBest?: boolean;
  /** The Daily Hunt's share card. */
  share?: { title: string; rounds: HuntShareRound[] };
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
  const [focus, setFocus] = useState(best ?? 0);
  const r = rounds[focus] ?? rounds[0];
  const world = region.id === WORLD_REGION;
  const found = rounds.reduce((s, x) => s + x.regionsFound, 0);
  const regions = rounds.reduce((s, x) => s + x.regionsTotal, 0);

  const cells: TrackerCell[] = rounds.map((x, i) => ({
    // eslint-disable-next-line @next/next/no-img-element -- the round's art, already cached
    top: <img src={x.pokemon.art} alt="" className="h-7 w-7 object-contain md:h-9 md:w-9" />,
    value: fmt(x.score),
    tone: i === best ? "best" : i === worst ? "worst" : undefined,
    label: `${t("results.show", { n: i + 1 })}: ${x.pokemon.name} · ${fmt(x.score)}`,
  }));

  const lines = [
    newBest && { key: "best", icon: <TrendingUp className="h-[1em] w-[1em]" aria-hidden />, text: g("end.newBest"), testId: "hunt-end-best" },
    world && regions > 0 && { key: "found", text: <span className="text-[0.85em]">{t("results.regions", { found, total: regions })}</span>, testId: "hunt-end-found" },
  ].filter((l): l is Exclude<typeof l, false | null | undefined> => !!l);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const formTag = r ? formTagOf(t, r.pokemon) : null;
  return (
    <EndScreen
      testId="hunt-results"
      nextTestId="hunt-again"
      map={
        r && (
          <GeoMap
            region={region}
            fill
            spots={r.spots.map((s, i) => ({ x: s.x, y: s.y, mask: s.mask, found: r.pins.some((p) => p.spot === i && (p.found ?? true)), tag: tagged(r).has(i) ? shortLabel(s.labels ?? [`${s.game} · ${s.method}`], t) : undefined }))}
            links={r.pins.map((p, i) => ({ pin: p.pin, spot: p.spot, n: i + 1 }))}
            fit={{ duration: 700, pad: END_MAP_PAD_PICKED }}
          />
        )
      }
      score={{ value: total, max, segments: rounds.length, label: g("end.yourScore"), unit: g("end.ofPoints", { max: fmt(max) }) }}
      title={t("results.title")}
      mode={modeLine}
      tracker={<EndTracker cells={cells} total={fmt(total)} focus={focus} onFocus={(i) => i !== null && setFocus(i)} wide />}
      aside={
        r && (
          <div className="flex w-[min(22rem,100%)] items-center gap-2.5 rounded-xl bg-[#1e1a3f]/95 p-2 pr-3 text-white shadow-[0_8px_28px_rgb(0_0_0/0.45)] ring-2 ring-[#5a4fb8]/70 backdrop-blur" data-testid="hunt-results-focus">
            {/* eslint-disable-next-line @next/next/no-img-element -- the round's art, already cached */}
            <img src={r.pokemon.art} alt="" className="h-10 w-10 shrink-0 object-contain" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-sm font-bold uppercase italic leading-tight">{r.pokemon.name}</span>
              <span className="block truncate text-xs text-white/70">
                {formTag ? `${formTag} · ` : ""}
                {world ? t("results.regions", { found: r.regionsFound, total: r.regionsTotal }) : t(`reveal.verdict.${verdictOf(r.score)}`)}
              </span>
            </span>
            <span className="shrink-0 font-display text-base font-bold italic tabular-nums text-[#ffd23c]">{fmt(r.score)}</span>
          </div>
        )
      }
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
            url={`${origin}${localeHref("/pokeguessr/hunt", t.locale).href}`}
            kind="hunt"
            picture={<ShareSquares rows={share.rounds.map((x) => (x.pins.length ? x.pins : [0]).map((p) => huntSquare(p, x.pinMax)))} label={t("share.legend")} />}
          />
        </EndRow>
      )}
    </EndScreen>
  );
}

/** The spots the map tags: those the pins scored against, and the first of each region nobody found. */
function tagged(r: HuntResultRound): Set<number> {
  const out = new Set(r.pins.map((p) => p.spot));
  for (const region of new Set(r.spots.map((s) => s.region))) if (!r.pins.some((p) => r.spots[p.spot]?.region === region)) out.add(r.spots.findIndex((s) => s.region === region));
  return out;
}
