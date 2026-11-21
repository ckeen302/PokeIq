"use client";

import { useEffect, useState } from "react";
import { Swords, Trophy, Zap } from "lucide-react";
import { DUEL_HP, DUEL_TURBO_CAP_MS, type DuelMode } from "@/lib/duel-types";
import type { GeoRegionInfo, GeoRounds } from "@/lib/geo-types";
import type { GeoEra } from "@/lib/geo-families";
import { NewDuelCard } from "@/components/duel/NewDuelCard";
import { cn } from "@/lib/utils";
import { RoundsPicker } from "./GeoSettings";
import { PARTY_TEAM_HP, partyPath } from "@/lib/geo-party";
import { GeoRankedCard } from "./GeoRanked";
import { useT } from "@/i18n/client";
import { formatNumber } from "@/i18n/catalog";
import cards from "@/messages/guessr-cards";

/** A team duel (2v2) is a party room in team mode: it opens at /pokeguessr/party/<code>. */
type CardMode = DuelMode | "team";
const MODES: { id: CardMode }[] = [{ id: "hp" }, { id: "race" }, { id: "team" }];

const QUEUES = [
  { id: "casual", icon: Swords },
  { id: "ranked", icon: Trophy },
] as const;
export type DuelQueue = (typeof QUEUES)[number]["id"];
type Queue = DuelQueue;

/**
 * Duels on /pokeguessr: Casual opens a duel on the chosen map (and era) for a
 * friend, or finds an opponent for the same; Ranked queues a rated
 * head-to-head on the world map (see GeoRanked.tsx).
 */
export function DuelCard({
  region,
  era,
  places = Infinity,
  queue: shownQueue,
  onQueue,
  heading,
}: {
  region: GeoRegionInfo;
  era?: GeoEra;
  places?: number;
  /** The queue shown, when the hub's tiles pick it (else the card keeps its own). */
  queue?: Queue;
  onQueue?: (q: Queue) => void;
  heading?: string;
}) {
  const t = useT(cards);
  const [ownQueue, setOwnQueue] = useState<Queue>("casual");
  const queue = shownQueue ?? ownQueue;
  const setQueue = (q: Queue) => {
    setOwnQueue(q);
    onQueue?.(q);
  };
  // /pokeguessr#ranked (the ladder's link) opens on the ranked queue.
  useEffect(() => {
    const read = () => {
      if (window.location.hash === "#ranked") {
        setOwnQueue("ranked");
        onQueue?.("ranked");
      }
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the hash on load and when it changes
  }, []);
  const [mode, setMode] = useState<CardMode>("hp");
  const [rounds, setRounds] = useState<GeoRounds>(5);
  const [turbo, setTurbo] = useState(false);
  const games = era ? ` · ${t(`duel.eras.${era}`)}` : "";
  const hp = (n: number) => formatNumber(n, t.locale);
  const race = mode === "race";
  const team = mode === "team";
  const raceRounds: GeoRounds = rounds <= places ? rounds : 5;
  const toggle = (
    <div className="flex gap-1.5" role="radiogroup" aria-label={t("duel.queueLabel")}>
      {QUEUES.map((q) => (
        <button
          key={q.id}
          type="button"
          role="radio"
          aria-checked={queue === q.id}
          onClick={() => setQueue(q.id)}
          data-testid={`geo-duel-queue-${q.id}`}
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider transition-colors",
            queue === q.id ? (q.id === "ranked" ? "border-warning bg-warning/15 text-foreground" : "border-screen bg-screen/15 text-foreground") : "bg-card text-muted-foreground hover:border-screen/50 hover:text-foreground"
          )}
        >
          <q.icon className="h-3.5 w-3.5" aria-hidden />
          {t(`duel.queues.${q.id}`)}
        </button>
      ))}
    </div>
  );
  return (
    <div id="ranked" className="scroll-mt-24 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display text-xl font-bold uppercase">{heading ?? t("duel.heading")}</h3>
        {toggle}
      </div>
      {queue === "ranked" ? (
        <GeoRankedCard />
      ) : (
        <NewDuelCard
          endpoint={team ? "/api/geo/party" : "/api/geo/duel"}
          body={team ? { region: region.id, mode: "team" } : { region: region.id, ...(era ? { era } : {}), mode, ...(race ? { rounds: raceRounds } : {}), ...(turbo ? { turbo: true } : {}) }}
          // Quick matching pairs HP battles only.
          match={race || team ? undefined : { game: "geo", region: region.id, ...(era ? { era } : {}) }}
          href={(code) => (team ? partyPath(code) : `/pokeguessr/duel/${code}`)}
          heading={team ? t("duel.headingTeam", { map: region.name }) : `${t("duel.headingHp", { map: region.name })}${games}`}
          blurb={
            team
              ? t("duel.teamBlurb", { hp: hp(PARTY_TEAM_HP) })
              : race
              ? t(era ? "duel.raceBlurbEra" : "duel.raceBlurb", { n: raceRounds })
              : t(era ? "duel.hpBlurbEra" : "duel.hpBlurb", { hp: hp(DUEL_HP) })
          }
          info={team ? undefined : <p>{t("duel.turboInfo", { s: DUEL_TURBO_CAP_MS / 1000 })}</p>}
        >
          <div className="space-y-2 pt-1">
            <div className="space-y-1.5">
              <p className="hud-label">{t("duel.mode")}</p>
              <div className="flex gap-1.5" role="radiogroup" aria-label={t("duel.modeLabel")}>
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={mode === m.id}
                    onClick={() => setMode(m.id)}
                    data-testid={`geo-duel-mode-${m.id}`}
                    className={cn(
                      "rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider transition-colors",
                      mode === m.id ? "border-screen bg-screen/15 text-foreground" : "bg-card text-muted-foreground hover:border-screen/50 hover:text-foreground"
                    )}
                  >
                    {t(`duel.modes.${m.id}`)}
                  </button>
                ))}
              </div>
            </div>
            {race && <RoundsPicker value={raceRounds} onChange={setRounds} max={places} testId="geo-duel-rounds" label={t("duel.raceRounds")} />}
            {!team && <div className="space-y-1.5">
              <p className="hud-label">{t("duel.partySettings")}</p>
              <button
                type="button"
                role="switch"
                aria-checked={turbo}
                onClick={() => setTurbo((t) => !t)}
                data-testid="geo-duel-turbo"
                className={cn("tap",
                  "flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider transition-colors",
                  turbo ? "border-warning bg-warning/15 text-foreground" : "bg-card text-muted-foreground hover:border-warning/50 hover:text-foreground"
                )}
              >
                <Zap className="h-3.5 w-3.5" aria-hidden />
                {turbo ? t("duel.turboOn") : t("duel.turboOff")}
              </button>
            </div>}
          </div>
        </NewDuelCard>
      )}
    </div>
  );
}
