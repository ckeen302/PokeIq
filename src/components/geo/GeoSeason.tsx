"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, Check, Gift, History, Lock } from "lucide-react";
import { GEO_DIVISIONS, geoDivisionOf, type GeoDivisionId } from "@/lib/geo-ranked";
import { GEO_SEASON_TRACK, geoRewardLabel, geoSeasonTimeLeft, type GeoSeasonRecord, type GeoSeasonView } from "@/lib/geo-seasons";
import { cn } from "@/lib/utils";
import { GeoBallIcon, GeoDivisionBadge } from "./GeoRanked";

/**
 * Ranked PokéGuessr seasons in the browser: the season strip on the ranked
 * card (name, time left, current and peak division, the reward track), and
 * a trainer's finished seasons on their profile.
 */

const fmt = (n: number) => n.toLocaleString("en-US");
const SHORT: Record<GeoDivisionId, string> = { poke: "Poké", great: "Great", ultra: "Ultra", master: "Master", beast: "Beast" };

/** The device clock, once a minute (season countdowns don't need more). */
function useMinute(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/**
 * The reward track: one cell per division, lit up to the season's peak.
 * Reaching a division earns its rewards (and every one below), granted when
 * the season ends.
 */
export function GeoRewardTrack({ peak, className }: { peak: GeoDivisionId | null; className?: string }) {
  const top = peak ? GEO_DIVISIONS.findIndex((d) => d.id === peak) : -1;
  const next = GEO_SEASON_TRACK[top + 1];
  return (
    <div className={cn("space-y-2", className)} data-testid="geo-reward-track">
      <ol className="grid grid-cols-5 gap-1.5" aria-label="Season reward track">
        {GEO_SEASON_TRACK.map((tier, i) => {
          const reached = i <= top;
          const labels = tier.rewards.map((r) => r.label).join(", ");
          return (
            <li
              key={tier.division}
              className={cn(
                "relative flex min-w-0 flex-col items-center gap-1 rounded-md border px-1 py-2 text-center",
                reached ? "border-success/50 bg-success/10" : "border-border bg-foreground/[0.03]"
              )}
              title={`${GEO_DIVISIONS[i].name}: ${labels}`}
              data-reached={reached || undefined}
            >
              <GeoBallIcon division={tier.division} className={cn("h-6 w-6", !reached && "opacity-45 grayscale")} />
              <span className={cn("max-w-full truncate font-display text-[10px] font-bold uppercase sm:text-[11px]", reached ? "text-foreground" : "text-muted-foreground")}>{SHORT[tier.division]}</span>
              <span className={cn("flex items-center", reached ? "text-success" : "text-muted-foreground")}>
                {reached ? <Check className="h-3 w-3" aria-hidden /> : <Lock className="h-3 w-3" aria-hidden />}
                <span className="sr-only">{reached ? "Reached: " : "Locked: "}{labels}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <Gift className="mt-0.5 h-3 w-3 shrink-0 text-warning" aria-hidden />
        <span>
          {next ? (
            <>
              {top >= 0 ? "Next" : "Reach"} <b className="text-foreground">{GEO_DIVISIONS[top + 1].name}</b>: {next.rewards.map((r) => r.label).join(", ")}
              {top < 0 ? ", plus a season badge" : ""}.
            </>
          ) : (
            <>Every reward this season is yours, with the Beast Ball season badge.</>
          )}{" "}
          Granted when the season ends, by your peak division.
        </span>
      </p>
    </div>
  );
}

/** The season on the ranked card: its name and time left, your division now and at its peak, and the reward track. */
export function GeoSeasonStrip({ season, elo }: { season: GeoSeasonView; elo: number | null }) {
  const now = useMinute();
  const you = season.you;
  const peak = you?.peakElo ?? null;
  const elapsed = now === null ? 0 : Math.min(1, Math.max(0, (now - season.startsAt) / (season.endsAt - season.startsAt)));
  return (
    <div className="space-y-3 rounded-md border border-warning/30 bg-warning/[0.04] p-3" data-testid="geo-season">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="font-display text-sm font-bold uppercase tracking-wide" data-testid="geo-season-name">
          {season.name}
        </p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="geo-season-left">
          <CalendarClock className="h-3.5 w-3.5" aria-hidden />
          {now === null ? " " : geoSeasonTimeLeft(season.endsAt, now)}
        </p>
      </div>
      <span className="block h-1 overflow-hidden rounded-full bg-foreground/10" aria-hidden>
        <span className="block h-full rounded-full bg-warning/70" style={{ width: `${Math.max(2, elapsed * 100)}%` }} />
      </span>
      {you !== undefined && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="min-w-0 space-y-1">
            <p className="hud-label">Now</p>
            {elo !== null ? <GeoDivisionBadge elo={elo} size="sm" /> : <p className="text-muted-foreground">Unranked</p>}
          </div>
          <div className="min-w-0 space-y-1" data-testid="geo-season-peak">
            <p className="hud-label">Season peak</p>
            {peak !== null ? <GeoDivisionBadge elo={peak} size="sm" /> : <p className="text-muted-foreground">Play a ranked duel</p>}
          </div>
        </div>
      )}
      <GeoRewardTrack peak={peak !== null ? geoDivisionOf(peak).id : null} />
    </div>
  );
}

/** The link to /guessr/history. */
export function DuelHistoryLink({ className }: { className?: string }) {
  return (
    <Link href="/guessr/history" className={cn("inline-flex items-center gap-1 font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline", className)} data-testid="geo-history-link">
      <History className="h-3.5 w-3.5" aria-hidden /> Duel history
    </Link>
  );
}

/** A trainer's finished seasons: peak division, record and what it earned. */
export function GeoSeasonHistory({ records, className }: { records: GeoSeasonRecord[]; className?: string }) {
  if (!records.length) return null;
  return (
    <ul className={cn("space-y-2", className)} data-testid="geo-season-history">
      {records.map((r) => (
        <li key={r.season} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border bg-foreground/[0.02] px-3 py-2">
          <span className="min-w-0 space-y-0.5">
            <span className="block font-display text-xs font-bold uppercase tracking-wide">{r.name}</span>
            <span className="block text-[11px] text-muted-foreground">
              {r.wins}–{r.losses}
              {r.draws ? `–${r.draws}` : ""} in {fmt(r.games)} duel{r.games === 1 ? "" : "s"}
            </span>
          </span>
          <span className="flex min-w-0 items-center gap-2" title={r.rewards.map(geoRewardLabel).join(", ")}>
            <span className="hud-label">Peak</span>
            <GeoDivisionBadge elo={r.peakElo} division={r.peakDivision} size="sm" />
          </span>
        </li>
      ))}
    </ul>
  );
}
