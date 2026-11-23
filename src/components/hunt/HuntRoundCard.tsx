"use client";

import { useT } from "@/i18n/client";
import huntNs from "@/messages/hunt";
import { HUNT_MAX_PINS, type HuntMode, type HuntRoundPublic } from "@/lib/hunt/types";

export interface HuntRoundCardProps {
  round: HuntRoundPublic;
  mode: HuntMode;
  /** Region mode: the map's name ("Found in Kanto"). */
  mapName?: string;
}

/** The round's Pokémon: its art in this exact form, its name, and how many regions it lives in. Presentation: owned by hunt design. */
export function HuntRoundCard({ round, mode, mapName }: HuntRoundCardProps) {
  const t = useT(huntNs);
  const line =
    mode === "region" && mapName
      ? t("round.inRegion", { region: mapName })
      : round.regions > HUNT_MAX_PINS
        ? t("round.dropUpTo", { n: round.regions, max: round.pins })
        : t("round.found", { n: round.regions });
  return (
    <div className="flex h-full w-full items-center justify-center p-6 pb-28 pt-24" data-testid="hunt-round-card">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <p className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-[#c8bfff]">{t("round.where")}</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- the official art of this exact form, transcoded and cached by /api/art */}
        <img key={round.id} src={round.art} alt={round.name} width={320} height={320} className="h-[min(42vh,320px)] w-[min(42vh,320px)] object-contain drop-shadow-[0_12px_30px_rgba(0,0,0,0.5)]" draggable={false} />
        <h2 className="font-display text-4xl font-bold uppercase italic leading-none" data-testid="hunt-name">
          {round.name}
        </h2>
        <p className="rounded-full bg-[#1e1a3f] px-4 py-1.5 font-display text-sm font-bold text-[#9be15d] ring-2 ring-[#a99cff]/50" data-testid="hunt-regions">
          {line}
        </p>
      </div>
    </div>
  );
}
