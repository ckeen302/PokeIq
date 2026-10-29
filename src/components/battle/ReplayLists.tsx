"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Clapperboard, FileUp, Loader2, Play, Trophy } from "lucide-react";
import { IMPORT_MAX_BYTES, parseShowdownReplay } from "@/lib/battle/replay-file";
import type { ReplayData } from "@/lib/battle/replay";
import { Button } from "@/components/ui/button";
import { PLAY_FORMAT_INFO, PLAY_FORMATS, type PlayFormatId } from "@/lib/battle/play";
import { replayResult, type ReplayListResponse, type ReplaySummary } from "@/lib/battle/replay";
import { battleIdHeaders, ensureBattleId, rememberedReplays } from "@/lib/battle/replay-client";
import { startedAgo } from "@/lib/battle/watch";
import { HudHeading } from "@/components/game/HudHeading";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function ReplayRow({ r, now }: { r: ReplaySummary; now: number }) {
  return (
    <Link
      href={`/battle/replay/${r.id}`}
      className="menu-item flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-card px-4 py-3 transition-colors hover:border-screen/60"
      data-testid="replay-row"
    >
      <Clapperboard className="h-4 w-4 shrink-0 text-screen" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display font-bold uppercase">
          {r.players[0]} <span className="text-muted-foreground">vs</span> {r.players[1]}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {replayResult(r)} · {r.turns} turn{r.turns === 1 ? "" : "s"}
        </span>
      </span>
      <span className="hud-label flex items-center gap-1.5">
        {r.ranked && <Trophy className="h-3 w-3 text-warning" aria-label="Ranked" />}
        {r.formatName}
      </span>
      <span className="w-24 text-right text-xs text-muted-foreground">{startedAgo(r.uploadedAt, now).replace("just now", "now")}</span>
    </Link>
  );
}

function useReplays(scope: "recent" | "mine", format: PlayFormatId | null) {
  const [state, setState] = useState<{ loading: boolean; data: ReplayListResponse | null; error: string | null }>({ loading: true, data: null, error: null });
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      try {
        let url = `/api/battle/replays?scope=${scope}`;
        let headers: Record<string, string> = {};
        if (scope === "mine") {
          await ensureBattleId();
          headers = battleIdHeaders();
          const ids = rememberedReplays();
          if (ids.length) url += `&ids=${ids.join(",")}`;
        } else if (format) url += `&format=${format}`;
        const res = await fetch(url, { headers, cache: "no-store" });
        const data = (await res.json().catch(() => null)) as (ReplayListResponse & { error?: string }) | null;
        if (!live) return;
        if (!res.ok || !data) throw new Error(data?.error ?? "Couldn't load replays.");
        setState({ loading: false, data, error: null });
      } catch (err) {
        if (live) setState({ loading: false, data: null, error: err instanceof Error ? err.message : "Couldn't load replays." });
      }
    })();
    return () => {
      live = false;
    };
  }, [scope, format]);
  return state;
}

function List({ state, empty }: { state: ReturnType<typeof useReplays>; empty: string }) {
  const [now, setNow] = useState(0);
  useEffect(() => setNow(Date.now()), [state.data]);
  if (state.loading) return <Loader2 className="mx-auto my-8 h-5 w-5 animate-spin text-screen" aria-label="Loading replays" />;
  if (state.error) return <p className="text-sm text-destructive">{state.error}</p>;
  if (!state.data?.available) return <p className="text-sm text-muted-foreground">Replays aren&apos;t available on this server yet.</p>;
  if (!state.data.replays.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="space-y-2">
      {state.data.replays.map((r) => (
        <ReplayRow key={r.id} r={r} now={now} />
      ))}
    </div>
  );
}

/** "My replays" and the recent public ones, filtered by format. */
export function ReplayLists() {
  const [format, setFormat] = useState<PlayFormatId | null>(null);
  const mine = useReplays("mine", null);
  const recent = useReplays("recent", format);
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="space-y-3" data-testid="my-replays">
        <HudHeading index={1} title="My replays" />
        <Card>
          <CardContent className="p-3">
            <List state={mine} empty="No replays yet. Ranked and public battles save theirs; after any other, press Save replay." />
          </CardContent>
        </Card>
      </section>
      <section className="space-y-3" data-testid="recent-replays">
        <HudHeading index={2} title="Recent replays" />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by format">
          {[null, ...PLAY_FORMATS].map((f) => (
            <button
              key={f ?? "all"}
              type="button"
              onClick={() => setFormat(f)}
              aria-pressed={format === f}
              className={cn(
                "rounded-md border px-2.5 py-1 font-display text-[11px] font-bold uppercase tracking-wider",
                format === f ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"
              )}
            >
              {f ? PLAY_FORMAT_INFO[f].short : "All"}
            </button>
          ))}
        </div>
        <Card>
          <CardContent className="p-3">
            <List state={recent} empty="No public replays in this format yet." />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

const ReplayViewer = dynamic(() => import("./ReplayViewer").then((m) => m.ReplayViewer), { ssr: false });

/**
 * Watch a Showdown battle in our viewer: paste its log, or open a replay
 * file Showdown saved (.html) or a raw log (.log, .txt, .json). Read in the
 * browser only: nothing is uploaded.
 */
export function ReplayImport() {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [replay, setReplay] = useState<ReplayData | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = (input: string) => {
    const res = parseShowdownReplay(input, PLAY_FORMAT_INFO);
    if (res.ok) {
      setError(null);
      setReplay(res.replay);
      window.scrollTo({ top: 0 });
    } else setError(res.error);
  };

  if (replay) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground" data-testid="import-summary">
          <strong className="text-foreground">
            {replay.players[0]} vs {replay.players[1]}
          </strong>{" "}
          · {replay.formatName} · {replay.turns} turn{replay.turns === 1 ? "" : "s"}
        </p>
        <ReplayViewer replay={replay} imported={{ onReset: () => setReplay(null) }} />
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-6">
        <label className="block space-y-2">
          <span className="hud-label">Battle log</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            spellCheck={false}
            placeholder={"|player|p1|Red|\n|player|p2|Blue|\n|tier|[Gen 9] OU\n|start\n|switch|p1a: Garchomp|Garchomp, M|100/100\n..."}
            className="w-full resize-y rounded-md border bg-background p-3 font-mono text-xs leading-relaxed focus:border-screen focus:outline-none"
            data-testid="import-text"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-destructive" data-testid="import-error">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => load(text)} disabled={!text.trim()} data-testid="import-watch">
            <Play className="h-4 w-4" aria-hidden /> Watch
          </Button>
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} data-testid="import-file-button">
            <FileUp className="h-4 w-4" aria-hidden /> Open a replay file
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".html,.htm,.log,.txt,.json,text/html,text/plain,application/json"
            className="hidden"
            data-testid="import-file"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (file.size > IMPORT_MAX_BYTES) return setError("That file is too big to be a battle replay.");
              load(await file.text());
            }}
          />
          <span className="text-xs text-muted-foreground">Showdown&apos;s saved replays (.html) and battle logs (.log). Read on your device, never uploaded.</span>
        </div>
      </CardContent>
    </Card>
  );
}
