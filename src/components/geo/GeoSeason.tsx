"use client";

import { useEffect, useState } from "react";
import Link from "@/components/ui/Link";
import { CalendarClock, Check, Gift, History, Lock } from "lucide-react";
import { GEO_DIVISIONS, geoDivisionOf, type GeoDivisionId } from "@/lib/geo-ranked";
import { GEO_SEASON_TRACK, geoRewardLabel, geoSeasonTimeLeft, type GeoSeasonRecord, type GeoSeasonView } from "@/lib/geo-seasons";
import { cn } from "@/lib/utils";
import { GeoBallIcon, GeoDivisionBadge } from "./GeoRanked";
import { useT } from "@/i18n/client";
import { formatNumber, type Keys, type Translator } from "@/i18n/catalog";
import geoRecord from "@/messages/geo-record";
import geoNamesNs from "@/messages/geo-names";
import { localRegion, type GeoNamesT } from "@/lib/geo-i18n";

type RecordT = Translator<typeof geoRecord.en>;
type RecordKey = Keys<typeof geoRecord.en>;
const SEASON_REGIONS = ["Kanto", "Johto", "Hoenn", "Sinnoh", "Unova", "Kalos", "Alola", "Galar", "Paldea"];

/** A division's name ("Great Ball") in the page's language. */
const divisionName = (t: RecordT, id: GeoDivisionId) => (t.locale === "en" ? GEO_DIVISIONS.find((d) => d.id === id)!.name : t(`balls.${id}`));
/** A season's name ("Kanto Season"): English as the server named it. */
function seasonName(t: RecordT, n: GeoNamesT, season: { number: number; name: string }): string {
  if (t.locale === "en") return season.name;
  const region = SEASON_REGIONS[season.number - 1];
  return region ? t("season.name", { region: localRegion(n, region) }) : t("season.numbered", { n: season.number });
}
/** A reward's name: the track's own, or a season badge ("Kanto Season Master Ball badge"). */
function rewardName(t: RecordT, n: GeoNamesT, id: string): string {
  if (t.locale === "en") return geoRewardLabel(id);
  const badge = /^badge:guessr-s(\d+)-(\w+)$/.exec(id);
  if (badge && t.has(`balls.${badge[2]}`)) {
    return t("season.badge", { season: seasonName(t, n, { number: Number(badge[1]), name: "" }), ball: t(`balls.${badge[2]}` as RecordKey) });
  }
  return t.has(`rewards.${id}`) ? t(`rewards.${id}` as RecordKey) : geoRewardLabel(id);
}
/** "32 days left", "5 hours left", "Ends in 12 minutes", as geoSeasonTimeLeft counts them. */
function timeLeft(t: RecordT, endsAt: number, now: number): string {
  if (t.locale === "en") return geoSeasonTimeLeft(endsAt, now);
  const ms = Math.max(0, endsAt - now);
  const days = Math.floor(ms / 86_400_000);
  if (days >= 2) return t("season.days", { n: days });
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 2) return t("season.hours", { n: hours });
  return t("season.minutes", { n: Math.max(1, Math.ceil(ms / 60_000)) });
}

/**
 * Ranked PokéGuessr seasons in the browser: the season strip on the ranked
 * card (name, time left, current and peak division, the reward track), and
 * a trainer's finished seasons on their profile.
 */


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
  const t = useT(geoRecord);
  const n = useT(geoNamesNs);
  const top = peak ? GEO_DIVISIONS.findIndex((d) => d.id === peak) : -1;
  const next = GEO_SEASON_TRACK[top + 1];
  return (
    <div className={cn("space-y-2", className)} data-testid="geo-reward-track">
      <ol className="grid grid-cols-5 gap-1.5" aria-label={t("season.track")}>
        {GEO_SEASON_TRACK.map((tier, i) => {
          const reached = i <= top;
          const labels = tier.rewards.map((r) => rewardName(t, n, r.id)).join(", ");
          return (
            <li
              key={tier.division}
              className={cn(
                "relative flex min-w-0 flex-col items-center gap-1 rounded-md border px-1 py-2 text-center",
                reached ? "border-success/50 bg-success/10" : "border-border bg-foreground/[0.03]"
              )}
              title={`${divisionName(t, GEO_DIVISIONS[i].id)}: ${labels}`}
              data-reached={reached || undefined}
            >
              <GeoBallIcon division={tier.division} className={cn("h-6 w-6", !reached && "opacity-45 grayscale")} />
              <span className={cn("max-w-full truncate font-display text-[10px] font-bold uppercase sm:text-[11px]", reached ? "text-foreground" : "text-muted-foreground")}>{t(`short.${tier.division}`)}</span>
              <span className={cn("flex items-center", reached ? "text-success" : "text-muted-foreground")}>
                {reached ? <Check className="h-3 w-3" aria-hidden /> : <Lock className="h-3 w-3" aria-hidden />}
                <span className="sr-only">{reached ? t("season.reached") : t("season.locked")}{labels}</span>
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
              {t.rich(top >= 0 ? "season.next" : "season.reach", {
                ball: divisionName(t, GEO_DIVISIONS[top + 1].id),
                rewards: next.rewards.map((r) => rewardName(t, n, r.id)).join(", "),
                b: (c) => <b className="text-foreground">{c}</b>,
              })}
            </>
          ) : (
            <>{t("season.all")}</>
          )}{" "}
          {t("season.granted")}
        </span>
      </p>
    </div>
  );
}

/** The season on the ranked card: its name and time left, your division now and at its peak, and the reward track. */
export function GeoSeasonStrip({ season, elo }: { season: GeoSeasonView; elo: number | null }) {
  const t = useT(geoRecord);
  const n = useT(geoNamesNs);
  const now = useMinute();
  const you = season.you;
  const peak = you?.peakElo ?? null;
  const elapsed = now === null ? 0 : Math.min(1, Math.max(0, (now - season.startsAt) / (season.endsAt - season.startsAt)));
  return (
    <div className="space-y-3 rounded-md border border-warning/30 bg-warning/[0.04] p-3" data-testid="geo-season">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="font-display text-sm font-bold uppercase tracking-wide" data-testid="geo-season-name">
          {seasonName(t, n, season)}
        </p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="geo-season-left">
          <CalendarClock className="h-3.5 w-3.5" aria-hidden />
          {now === null ? " " : timeLeft(t, season.endsAt, now)}
        </p>
      </div>
      <span className="block h-1 overflow-hidden rounded-full bg-foreground/10" aria-hidden>
        <span className="block h-full rounded-full bg-warning/70" style={{ width: `${Math.max(2, elapsed * 100)}%` }} />
      </span>
      {you !== undefined && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="min-w-0 space-y-1">
            <p className="hud-label">{t("season.now")}</p>
            {elo !== null ? <GeoDivisionBadge elo={elo} size="sm" /> : <p className="text-muted-foreground">{t("season.unranked")}</p>}
          </div>
          <div className="min-w-0 space-y-1" data-testid="geo-season-peak">
            <p className="hud-label">{t("season.peakTitle")}</p>
            {peak !== null ? <GeoDivisionBadge elo={peak} size="sm" /> : <p className="text-muted-foreground">{t("season.playRanked")}</p>}
          </div>
        </div>
      )}
      <GeoRewardTrack peak={peak !== null ? geoDivisionOf(peak).id : null} />
    </div>
  );
}

/** The link to /pokeguessr/history. */
export function DuelHistoryLink({ className }: { className?: string }) {
  const t = useT(geoRecord);
  return (
    <Link href="/pokeguessr/history" className={cn("inline-flex items-center gap-1 font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline", className)} data-testid="geo-history-link">
      <History className="h-3.5 w-3.5" aria-hidden />{` ${t("season.history")}`}
    </Link>
  );
}

/** A trainer's finished seasons: peak division, record and what it earned. */
export function GeoSeasonHistory({ records, className }: { records: GeoSeasonRecord[]; className?: string }) {
  const t = useT(geoRecord);
  const n = useT(geoNamesNs);
  if (!records.length) return null;
  return (
    <ul className={cn("space-y-2", className)} data-testid="geo-season-history">
      {records.map((r) => (
        <li key={r.season} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border bg-foreground/[0.02] px-3 py-2">
          <span className="min-w-0 space-y-0.5">
            <span className="block font-display text-xs font-bold uppercase tracking-wide">{seasonName(t, n, { number: r.season, name: r.name })}</span>
            <span className="block text-[11px] text-muted-foreground">
              {t("season.record", { record: `${r.wins}–${r.losses}${r.draws ? `–${r.draws}` : ""}`, n: r.games, games: formatNumber(r.games, t.locale) })}
            </span>
          </span>
          <span className="flex min-w-0 items-center gap-2" title={r.rewards.map((id) => rewardName(t, n, id)).join(", ")}>
            <span className="hud-label">{t("season.peak")}</span>
            <GeoDivisionBadge elo={r.peakElo} division={r.peakDivision} size="sm" />
          </span>
        </li>
      ))}
    </ul>
  );
}
