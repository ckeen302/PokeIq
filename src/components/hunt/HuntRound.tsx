"use client";

import { X } from "lucide-react";
import { WORLD_REGION, type GeoRegionInfo } from "@/lib/geo-types";
import { useGeoNames } from "@/lib/geo-i18n-client";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { formatNumber } from "@/i18n/format";
import geoNs from "@/messages/geo";
import { BAR_BTN, CountdownPill, ExitButton, FullscreenButton, GuessButton, HudDials, MapDock, Notch, RoundBadge, RoundReadout, ScoreTracker, TimerDial, usePhone } from "@/components/geo/GameShell";
import { GeoMap, mapAspect, type MapPin } from "@/components/geo/GeoMap";
import huntNs from "@/messages/hunt";
import type { HuntHint, HuntHintKind } from "@/lib/hunt/types";
import { HuntCard, type HuntPokemonView } from "./HuntCard";
import { HuntHints } from "./HuntHints";

export interface HuntRoundProps {
  /** The map the pin goes on: the world, or the region being hunted. */
  region: GeoRegionInfo;
  pokemon: HuntPokemonView;
  /** The pin, once it's down. */
  pin: MapPin | null;
  onPlace: (pin: MapPin) => void;
  onGuess: () => void;
  /** The guess is being sent. */
  busy?: boolean;
  /** The hints this round offers, those taken, the one on its way and one that failed. */
  hints: HuntHintKind[];
  taken: Partial<Record<HuntHintKind, HuntHint>>;
  hintBusy?: HuntHintKind | null;
  hintFailed?: HuntHintKind | null;
  onHint: (kind: HuntHintKind) => void;
  /** 0-based round index (the map recentres for each). */
  roundIndex: number;
  rounds: number;
  /** Every finished round's score so far. */
  scores: number[];
  /** "Pokémon Hunt · World", "Daily Hunt #12 · World": the line under the round number. */
  modeLine: string;
  /** The countdown, or null when the round has none. */
  msLeft: number | null;
  totalMs: number;
  onExit: () => void;
  /** GameShell's browser full screen. */
  fs: boolean;
  onFullscreen: () => void;
}

/**
 * A Pokémon Hunt round, laid out exactly as a PokéGuessr round: the exit and full-screen buttons top
 * left, the notch with the round and the 1:30 pill under it, GeoGuessr's score tracker top right, and
 * the corner map dock with the Guess button; the phone gets the dials, the round badge and the bottom
 * bar. The Pokémon card takes the screenshot's place, with the round's hints under its question. One pin,
 * as PokéGuessr's.
 */
export function HuntRound(p: HuntRoundProps) {
  const t = useT(geoNs);
  const h = useT(huntNs);
  const phone = usePhone();
  const names = useGeoNames();
  const fmt = (n: number) => formatNumber(n, t.locale);
  const total = p.scores.reduce((a, b) => a + b, 0);
  const round = Math.min(p.roundIndex + 1, p.rounds);
  const map = ({ fill, land }: { fill: boolean; land: boolean | "fit" }) => <GeoMap land={land} round={p.roundIndex} region={p.region} fill={fill} pick={p.pin} onPick={p.onPlace} />;
  return (
    <div className="relative h-full" data-testid="hunt-round">
      <div className="absolute inset-0" style={{ bottom: "var(--geo-bar)" }}>
        <HuntCard pokemon={p.pokemon} priority={p.roundIndex === 0} mapName={p.region.id === WORLD_REGION ? undefined : names.map(p.region)}>
          <HuntHints offered={p.hints} taken={p.taken} busy={p.hintBusy} failed={p.hintFailed} onTake={p.onHint} />
        </HuntCard>
      </div>

      {phone ? (
        <>
          <HudDials>
            {p.msLeft !== null && <TimerDial ms={p.msLeft} totalMs={p.totalMs} urgentMs={10_000} testId="geo-time-left" clock />}
            <RoundReadout round={round} rounds={p.rounds} total={fmt(total)} />
          </HudDials>
          <RoundBadge testId="geo-round" value={round} of={p.rounds} mode={p.modeLine} />
        </>
      ) : (
        <>
          <div className="geo-safe-tl absolute left-3 top-3 z-20 flex items-center gap-2">
            <ExitButton onClick={p.onExit} />
            <FullscreenButton fs={p.fs} onClick={p.onFullscreen} />
          </div>
          <Notch below={p.msLeft !== null ? <CountdownPill ms={p.msLeft} totalMs={p.totalMs} urgentMs={10_000} testId="geo-time-left" clock /> : undefined}>
            <div className="min-w-0 text-center">
              <div className="font-display text-xl font-bold uppercase italic leading-none tracking-wide sm:text-2xl" data-testid="geo-round">
                {t("roundN", { n: round })}
                <span className="text-white/50">/{p.rounds}</span>
              </div>
              <div className="mt-0.5 truncate font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c8bfff]">{p.modeLine}</div>
            </div>
          </Notch>
          <div className="geo-safe-tr absolute right-3 top-3 z-20 flex items-start gap-2">
            <ScoreTracker className="max-lg:hidden" rounds={p.rounds} scores={p.scores} current={round - 1} total={fmt(total)} />
            <RoundReadout className="!h-9 lg:hidden" testId="geo-score-compact" round={round} rounds={p.rounds} total={fmt(total)} />
          </div>
        </>
      )}

      <MapDock
        aspect={mapAspect(p.region)}
        resetKey={p.roundIndex}
        hasPin={!!p.pin}
        hint={p.pin ? h("pins.hintMoveOne") : h("pins.hintOne")}
        map={map}
        tools={
          <>
            <button type="button" onClick={p.onExit} className={BAR_BTN} aria-label={t("shell.back")} title={t("shell.back")} data-testid="geo-exit" data-keep>
              <X className="h-5 w-5" />
            </button>
            <FullscreenButton fs={p.fs} onClick={p.onFullscreen} className={cn(BAR_BTN, "!h-11 !w-11 !rounded-full !bg-[#4a3f9e] !backdrop-blur-none")} />
          </>
        }
        button={<GuessButton hasPin={!!p.pin} busy={p.busy} disabled={p.busy} onClick={p.onGuess} />}
      />
    </div>
  );
}
