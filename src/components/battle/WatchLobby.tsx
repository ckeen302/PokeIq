"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Eye, Loader2, Radio, Swords, Trophy } from "lucide-react";
import { PLAY_FORMAT_INFO, PLAY_FORMATS, type PlayFormatId } from "@/lib/battle/play";
import { startedAgo, type WatchEntry, type WatchResponse } from "@/lib/battle/watch";
import { startPoller } from "@/lib/polling";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { NameAvatar } from "@/components/avatar/Avatar";
import type { AvatarMap } from "@/lib/avatar";

/** The lobby refreshes this often while it's in view (and not at all while hidden). */
const REFRESH_MS = 15_000;

const FILTERS: (PlayFormatId | null)[] = [null, ...PLAY_FORMATS, "factory"];

function BattleCard({ b, now, avatars }: { b: WatchEntry; now: number; avatars?: AvatarMap }) {
  return (
    <Link
      href={`/battle/live/${b.code}`}
      className="menu-item hud group flex flex-col gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-screen/60"
      data-testid="watch-battle"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="hud-label truncate text-screen">{b.formatName}</span>
        {b.ranked && (
          <span className="hud-label flex shrink-0 items-center gap-1 rounded-sm border border-warning/50 px-1.5 py-0.5 text-warning">
            <Trophy className="h-3 w-3" aria-hidden /> Ranked
          </span>
        )}
      </span>
      <span className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 font-display text-lg font-bold uppercase leading-tight">
        {b.players.map((p, i) => (
          <span key={i} className={cn("min-w-0", i === 1 && "order-3 text-right")}>
            <NameAvatar name={p.name} avatars={avatars} size={28} className={cn("mb-1", i === 1 && "ml-auto")} />
            <span className={cn("block truncate", i === 0 ? "text-primary" : "text-screen")}>{p.name}</span>
            {p.rating !== undefined && <span className="block font-pixel text-[10px] font-normal tabular-nums text-muted-foreground">{p.elo ?? p.rating}</span>}
          </span>
        ))}
        <span className="order-2 font-pixel text-[11px] text-muted-foreground">VS</span>
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-pixel tabular-nums">Turn {Math.max(1, b.turn)}</span>
        <span className="flex items-center gap-1">
          <Eye className="h-3.5 w-3.5" aria-hidden /> {b.spectators} watching
        </span>
        <span>Started {startedAgo(b.startedAt, now)}</span>
        <span className="ml-auto font-display font-bold uppercase tracking-wider text-foreground opacity-0 transition-opacity group-hover:opacity-100">Watch →</span>
      </span>
    </Link>
  );
}

/**
 * Live battles to watch, filtered by format, refreshed on the shared poller
 * at a slow pace (only while the tab is in view).
 */
export function WatchLobby() {
  const [format, setFormat] = useState<PlayFormatId | null>(null);
  const [data, setData] = useState<WatchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formatRef = useRef(format);
  formatRef.current = format;
  const kick = useRef<() => void>(() => {});

  useEffect(() => {
    let stopped = false;
    const poller = startPoller({
      async poll() {
        try {
          const f = formatRef.current;
          const res = await fetch(`/api/battle/watch${f ? `?format=${f}` : ""}`, { cache: "no-store" });
          const body = (await res.json().catch(() => null)) as (WatchResponse & { error?: string }) | null;
          if (stopped || f !== formatRef.current) return;
          if (!res.ok || !body) throw new Error(body?.error ?? "Couldn't load live battles.");
          setData(body);
          setError(null);
        } catch (err) {
          if (!stopped) setError(err instanceof Error ? err.message : "Couldn't load live battles.");
        }
      },
      delay: () => (stopped ? null : REFRESH_MS),
    });
    kick.current = poller.kick;
    return () => {
      stopped = true;
      poller.stop();
    };
  }, []);

  useEffect(() => {
    setData(null);
    kick.current();
  }, [format]);

  const battles = data?.battles ?? [];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by format">
        {FILTERS.map((f) => (
          <button
            key={f ?? "all"}
            type="button"
            onClick={() => setFormat(f)}
            aria-pressed={format === f}
            className={cn(
              "rounded-md border px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wider transition-colors",
              format === f ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:border-screen/60 hover:text-foreground"
            )}
          >
            {f ? PLAY_FORMAT_INFO[f].short : "All formats"}
          </button>
        ))}
        <span className="hud-label ml-auto flex items-center gap-1.5">
          <Radio className="h-3 w-3 animate-pulse text-success" aria-hidden /> Refreshes on its own
        </span>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {!data && !error ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-screen" aria-label="Loading live battles" />
        </div>
      ) : battles.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="watch-list">
          {battles.map((b) => (
            <BattleCard key={b.code} b={b} now={data!.now} avatars={data!.avatars} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="space-y-3 p-8 text-center">
            <p className="font-display text-xl font-bold uppercase">No live battles {format ? `in ${PLAY_FORMAT_INFO[format].short}` : "right now"}</p>
            <p className="text-sm text-muted-foreground">Matchmade battles show up here as they start. Start one and others can watch you.</p>
            <Link href="/battle/play?vs=anyone" className={buttonVariants()}>
              <Swords className="h-4 w-4" aria-hidden /> Find an opponent
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
