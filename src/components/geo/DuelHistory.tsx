"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Loader2, Swords, Trophy, Zap } from "lucide-react";
import { geoDivisionOf } from "@/lib/geo-ranked";
import { keepRankedId, rankedId } from "@/lib/ranked-client";
import type { GeoDuelHistoryItem, GeoDuelHistoryResponse } from "@/lib/geo-duel-history";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { GymLeaderTag } from "./GeoRanked";

/**
 * /guessr/history: your PokéGuessr duels, newest first (casual and ranked),
 * each opening its replay. Asked for with the browser's signed ranked id
 * (or the account, when signed in), a page at a time.
 */

const fmt = (n: number) => n.toLocaleString("en-US");

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
  win: { letter: "W", label: "Victory", className: "border-success/60 bg-success/15 text-success" },
  loss: { letter: "L", label: "Defeat", className: "border-destructive/60 bg-destructive/10 text-destructive" },
  draw: { letter: "D", label: "Draw", className: "border-[#a99cff]/60 bg-[#a99cff]/10 text-[#8b7cf6]" },
} as const;

export function formatDuelDate(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", year: new Date(ms).getFullYear() === new Date().getFullYear() ? undefined : "numeric", hour: "numeric", minute: "2-digit" });
}

/** "+16" where the division shows the number, else "Climbing" / "Slipping" / "Holding". */
export function EloChange({ before, after, className }: { before: number; after: number; className?: string }) {
  const delta = after - before;
  const tone = delta > 0 ? "text-success" : delta < 0 ? "text-destructive" : "text-muted-foreground";
  const shown = geoDivisionOf(after).showElo;
  return (
    <span className={cn("font-display font-bold tabular-nums", tone, className)} title={shown ? `${fmt(before)} → ${fmt(after)} Elo` : undefined} data-testid="geo-history-elo">
      {shown ? `${delta > 0 ? "+" : delta < 0 ? "−" : "±"}${fmt(Math.abs(delta))}` : delta > 0 ? "Climbing" : delta < 0 ? "Slipping" : "Holding"}
    </span>
  );
}

function Row({ duel, mapName }: { duel: GeoDuelHistoryItem; mapName: string }) {
  const r = RESULT[duel.result];
  return (
    <li>
      <Link
        href={`/guessr/history/${duel.code}`}
        className="group flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-primary/50 hover:bg-foreground/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-4 sm:p-4"
        data-testid="geo-history-row"
      >
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-md border-2 font-display text-lg font-extrabold", r.className)} aria-label={r.label}>
          {r.letter}
        </span>
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate font-semibold">
              <span className="text-muted-foreground">vs </span>
              {duel.opponent.name}
            </span>
            {duel.opponent.bot && <GymLeaderTag />}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span className={cn("inline-flex items-center gap-1 font-semibold uppercase", duel.ranked ? "text-warning" : "text-screen")}>
              {duel.ranked ? <Trophy className="h-3 w-3" aria-hidden /> : <Swords className="h-3 w-3" aria-hidden />}
              {duel.ranked ? "Ranked" : "Casual"}
            </span>
            <span>{duel.mode === "race" ? "Points race" : "HP battle"}</span>
            <span>{mapName}</span>
            {duel.turbo && (
              <span className="inline-flex items-center gap-0.5">
                <Zap className="h-3 w-3" aria-hidden /> Turbo
              </span>
            )}
            <span className="whitespace-nowrap">{formatDuelDate(duel.endedAt)}</span>
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
          {duel.totals ? (
            <span className="font-pixel text-xs tabular-nums">
              {fmt(duel.totals[0])} <span className="text-muted-foreground">–</span> {fmt(duel.totals[1])}
            </span>
          ) : (
            <span className="font-pixel text-xs tabular-nums" title="Final HP: yours – theirs">
              {fmt(duel.hp[0])} <span className="text-muted-foreground">–</span> {fmt(duel.hp[1])}
            </span>
          )}
          <span className="text-[10px] uppercase text-muted-foreground">{duel.totals ? "points" : "final HP"}</span>
          {duel.elo && <EloChange before={duel.elo.before} after={duel.elo.after} className="text-xs" />}
        </span>
        <ChevronRight className="hidden h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:block" aria-hidden />
      </Link>
    </li>
  );
}

export function DuelHistoryList({ mapNames }: { mapNames: Record<string, string> }) {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async (before: number | null): Promise<{ duels: GeoDuelHistoryItem[]; next: number | null } | "off"> => {
    const res = await fetch(`/api/geo/history${before ? `?before=${before}` : ""}`, { headers: historyHeaders(), cache: "no-store" });
    const data = (await res.json().catch(() => null)) as (GeoDuelHistoryResponse & { error?: string }) | null;
    if (data?.id) keepRankedId(data.id);
    if (!res.ok || !data) throw new Error(data?.error ?? "Couldn't load your duels.");
    if (!data.available) return "off";
    return { duels: data.duels, next: data.next };
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
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading your duels…
      </p>
    );
  }
  if (state.status === "off") {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">Duel history isn&apos;t switched on here yet. Your duels still count on your PokéGuessr record.</CardContent>
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
          <p className="text-sm text-muted-foreground">No duels yet. Finish a duel and it shows up here with a round-by-round replay.</p>
          <Link href="/guessr#ranked" className={buttonVariants({ variant: "default" })}>
            <Swords className="h-4 w-4" aria-hidden /> Find a duel
          </Link>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <ul className="space-y-2" data-testid="geo-history-list">
        {state.duels.map((d) => (
          <Row key={d.code} duel={d} mapName={mapNames[d.region] ?? d.region} />
        ))}
      </ul>
      {state.next !== null && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void more()} disabled={state.more} data-testid="geo-history-more">
            {state.more && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Load older duels
          </Button>
        </div>
      )}
    </div>
  );
}
