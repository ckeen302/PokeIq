"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "@/components/ui/Link";
import { ChevronRight, Loader2, Swords, Trophy, Zap } from "lucide-react";
import { geoDivisionOf } from "@/lib/geo-ranked";
import { keepRankedId, rankedId } from "@/lib/ranked-client";
import type { GeoDuelHistoryItem, GeoDuelHistoryResponse } from "@/lib/geo-duel-history";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { GymLeaderTag, useShownName } from "./GeoRanked";
import { useT } from "@/i18n/client";
import { type Translator } from "@/i18n/catalog";
import { INTL_LOCALE, formatNumber } from "@/i18n/format";
import type { Locale } from "@/i18n/config";
import geoReplay from "@/messages/geo-replay";

type ReplayT = Translator<typeof geoReplay.en>;

/**
 * /pokeguessr/history: your PokéGuessr duels, newest first (casual and ranked),
 * each opening its replay. Asked for with the browser's signed ranked id
 * (or the account, when signed in), a page at a time.
 */


export const historyHeaders = (): Record<string, string> => {
  const id = rankedId();
  return id ? { "x-ranked-id": id } : {};
};

type State =
  | { status: "loading" }
  | { status: "off" }
  | { status: "error"; message: string }
  | { status: "ready"; duels: GeoDuelHistoryItem[]; next: number | null; more: boolean };

const RESULT = {
  win: { className: "border-success/60 bg-success/15 text-success" },
  loss: { className: "border-destructive/60 bg-destructive/10 text-destructive" },
  draw: { className: "border-[#a99cff]/60 bg-[#a99cff]/10 text-[#8b7cf6]" },
} as const;

/** When a duel ended ("Nov 21, 3:05 PM"), as the page's language writes dates. */
export function formatDuelDate(ms: number, locale: Locale = "en"): string {
  return new Date(ms).toLocaleString(INTL_LOCALE[locale], { month: "short", day: "numeric", year: new Date(ms).getFullYear() === new Date().getFullYear() ? undefined : "numeric", hour: "numeric", minute: "2-digit" });
}

/** "+16" where the division shows the number, else "Climbing" / "Slipping" / "Holding". */
export function EloChange({ before, after, className }: { before: number; after: number; className?: string }) {
  const t = useT(geoReplay);
  const fmt = (n: number) => formatNumber(n, t.locale);
  const delta = after - before;
  const tone = delta > 0 ? "text-success" : delta < 0 ? "text-destructive" : "text-muted-foreground";
  const shown = geoDivisionOf(after).showElo;
  return (
    <span className={cn("font-display font-bold tabular-nums", tone, className)} title={shown ? t("elo.title", { before: fmt(before), after: fmt(after) }) : undefined} data-testid="geo-history-elo">
      {shown ? `${delta > 0 ? "+" : delta < 0 ? "−" : "±"}${fmt(Math.abs(delta))}` : delta > 0 ? t("elo.climbing") : delta < 0 ? t("elo.slipping") : t("elo.holding")}
    </span>
  );
}

function Row({ duel, mapName, t }: { duel: GeoDuelHistoryItem; mapName: string; t: ReplayT }) {
  const r = RESULT[duel.result];
  const shownName = useShownName();
  const fmt = (n: number) => formatNumber(n, t.locale);
  return (
    <li>
      <Link
        href={`/pokeguessr/history/${duel.code}`}
        className="group flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-primary/50 hover:bg-foreground/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-4 sm:p-4"
        data-testid="geo-history-row"
      >
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-md border-2 font-display text-lg font-extrabold", r.className)} aria-label={t(`result.${duel.result}.label`)}>
          {t(`result.${duel.result}.letter`)}
        </span>
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate font-semibold">
              <span className="text-muted-foreground">{t("vs")} </span>
              {shownName(duel.opponent)}
            </span>
            {duel.opponent.bot && <GymLeaderTag />}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span className={cn("inline-flex items-center gap-1 font-semibold uppercase", duel.ranked ? "text-warning" : "text-screen")}>
              {duel.ranked ? <Trophy className="h-3 w-3" aria-hidden /> : <Swords className="h-3 w-3" aria-hidden />}
              {duel.ranked ? t("ranked") : t("casual")}
            </span>
            <span>{duel.mode === "race" ? t("race") : t("hp")}</span>
            <span>{mapName}</span>
            {duel.turbo && (
              <span className="inline-flex items-center gap-0.5">
                <Zap className="h-3 w-3" aria-hidden />{` ${t("turbo")}`}
              </span>
            )}
            <span className="whitespace-nowrap">{formatDuelDate(duel.endedAt, t.locale)}</span>
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
          {duel.totals ? (
            <span className="font-pixel text-xs tabular-nums">
              {fmt(duel.totals[0])} <span className="text-muted-foreground">–</span> {fmt(duel.totals[1])}
            </span>
          ) : (
            <span className="font-pixel text-xs tabular-nums" title={t("finalHpTitle")}>
              {fmt(duel.hp[0])} <span className="text-muted-foreground">–</span> {fmt(duel.hp[1])}
            </span>
          )}
          <span className="text-[10px] uppercase text-muted-foreground">{duel.totals ? t("points") : t("finalHp")}</span>
          {duel.elo && <EloChange before={duel.elo.before} after={duel.elo.after} className="text-xs" />}
        </span>
        <ChevronRight className="hidden h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:block" aria-hidden />
      </Link>
    </li>
  );
}

export function DuelHistoryList({ mapNames }: { mapNames: Record<string, string> }) {
  const t = useT(geoReplay);
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async (before: number | null): Promise<{ duels: GeoDuelHistoryItem[]; next: number | null } | "off"> => {
    const res = await fetch(`/api/geo/history${before ? `?before=${before}` : ""}`, { headers: historyHeaders(), cache: "no-store" });
    const data = (await res.json().catch(() => null)) as (GeoDuelHistoryResponse & { error?: string }) | null;
    if (data?.id) keepRankedId(data.id);
    if (!res.ok || !data) throw new Error(data?.error ?? t("list.failed"));
    if (!data.available) return "off";
    return { duels: data.duels, next: data.next };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the message is the page's, it never changes
  }, []);

  useEffect(() => {
    let live = true;
    load(null).then(
      (out) => live && setState(out === "off" ? { status: "off" } : { status: "ready", ...out, more: false }),
      (err: Error) => live && setState({ status: "error", message: err.message })
    );
    return () => {
      live = false;
    };
  }, [load]);

  const more = async () => {
    if (state.status !== "ready" || state.next === null) return;
    setState({ ...state, more: true });
    try {
      const out = await load(state.next);
      if (out === "off") return;
      setState({ status: "ready", duels: [...state.duels, ...out.duels.filter((d) => !state.duels.some((x) => x.code === d.code))], next: out.next, more: false });
    } catch {
      setState({ ...state, more: false });
    }
  };

  if (state.status === "loading") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />{` ${t("list.loading")}`}
      </p>
    );
  }
  if (state.status === "off") {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">{t("list.off")}</CardContent>
      </Card>
    );
  }
  if (state.status === "error") {
    return (
      <p role="alert" className="text-sm text-destructive">
        {state.message}
      </p>
    );
  }
  if (!state.duels.length) {
    return (
      <Card data-testid="geo-history-empty">
        <CardContent className="space-y-4 p-6 text-center">
          <Swords className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">{t("list.empty")}</p>
          <Link href="/pokeguessr#ranked" className={buttonVariants({ variant: "default" })}>
            <Swords className="h-4 w-4" aria-hidden />{` ${t("list.find")}`}
          </Link>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <ul className="space-y-2" data-testid="geo-history-list">
        {state.duels.map((d) => (
          <Row key={d.code} duel={d} mapName={mapNames[d.region] ?? d.region} t={t} />
        ))}
      </ul>
      {state.next !== null && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void more()} disabled={state.more} data-testid="geo-history-more">
            {state.more && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{` ${t("list.more")}`}
          </Button>
        </div>
      )}
    </div>
  );
}
