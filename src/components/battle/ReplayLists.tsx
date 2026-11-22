"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "@/components/ui/Link";
import { Clapperboard, FileUp, Loader2, Play, Trophy } from "lucide-react";
import { IMPORT_MAX_BYTES, parseShowdownReplay } from "@/lib/battle/replay-file";
import type { ReplayData } from "@/lib/battle/replay";
import { Button } from "@/components/ui/button";
import { GROUP_FORMATS, PLAY_FORMAT_INFO, PLAY_FORMATS, type PlayFormatId } from "@/lib/battle/play";
import { replayMatchup, replayResult, replayTitle, type ReplayListResponse, type ReplaySummary } from "@/lib/battle/replay";
import { battleIdHeaders, ensureBattleId, rememberedReplays } from "@/lib/battle/replay-client";
import { HudHeading } from "@/components/game/HudHeading";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import type { Translator } from "@/i18n/catalog";
import battleReplays from "@/messages/battle-replays";
import battleReplayWords from "@/messages/battle-replay-words";

/** "now", "12 min ago", "2 h 5 min ago". */
function ago(w: Translator<typeof battleReplayWords.en>, at: number, now: number): string {
  const min = Math.floor(Math.max(0, now - at) / 60_000);
  if (min < 1) return w("ago.now");
  if (min < 60) return w("ago.min", { min });
  return w("ago.hours", { h: Math.floor(min / 60), min: min % 60 });
}

export function ReplayRow({ r, now }: { r: ReplaySummary; now: number }) {
  const w = useT(battleReplayWords);
  return (
    <Link
      href={`/battle/replay/${r.id}`}
      className="menu-item flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-card px-4 py-3 transition-colors hover:border-screen/60"
      data-testid="replay-row"
    >
      <Clapperboard className="h-4 w-4 shrink-0 text-screen" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display font-bold uppercase">
          {replayMatchup(r).a} <span className="text-muted-foreground">{w(`joiner.${replayMatchup(r).joiner}`)}</span> {replayMatchup(r).b}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {replayResult(r, w)} · {w("turns", { n: r.turns })}
        </span>
      </span>
      <span className="hud-label flex items-center gap-1.5">
        {r.ranked && <Trophy className="h-3 w-3 text-warning" aria-label={w("ranked")} />}
        {r.formatName}
      </span>
      <span className="w-24 text-right text-xs text-muted-foreground">{ago(w, r.uploadedAt, now)}</span>
    </Link>
  );
}

function useReplays(scope: "recent" | "mine", format: PlayFormatId | null, failed: string) {
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
        if (!res.ok || !data) throw new Error(data?.error ?? failed);
        setState({ loading: false, data, error: null });
      } catch (err) {
        if (live) setState({ loading: false, data: null, error: err instanceof Error ? err.message : failed });
      }
    })();
    return () => {
      live = false;
    };
  }, [scope, format, failed]);
  return state;
}

/** `hold`: while loading, keep the room a full list takes, so the page below doesn't jump when it arrives. */
function List({ state, empty, hold }: { state: ReturnType<typeof useReplays>; empty: string; hold?: boolean }) {
  const [now, setNow] = useState(0);
  const t = useT(battleReplays);
  useEffect(() => setNow(Date.now()), [state.data]);
  if (state.loading) {
    return (
      <div className={cn(hold && "min-h-[30rem]")}>
        <Loader2 className="mx-auto my-8 h-5 w-5 animate-spin text-screen" aria-label={t("lists.loading")} />
      </div>
    );
  }
  if (state.error) return <p className="text-sm text-destructive">{state.error}</p>;
  if (!state.data?.available) return <p className="text-sm text-muted-foreground">{t("lists.unavailable")}</p>;
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
  const t = useT(battleReplays);
  const mine = useReplays("mine", null, t("lists.loadFailed"));
  const recent = useReplays("recent", format, t("lists.loadFailed"));
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="space-y-3" data-testid="my-replays">
        <HudHeading index={1} title={t("lists.mine")} />
        <Card>
          <CardContent className="p-3">
            <List state={mine} empty={t("lists.mineEmpty")} />
          </CardContent>
        </Card>
      </section>
      <section className="space-y-3" data-testid="recent-replays">
        <HudHeading index={2} title={t("lists.recent")} />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("lists.filter")}>
          {[null, ...PLAY_FORMATS, ...GROUP_FORMATS].map((f) => (
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
              {f ? PLAY_FORMAT_INFO[f].short : t("lists.all")}
            </button>
          ))}
        </div>
        <Card>
          <CardContent className="p-3">
            <List state={recent} empty={t("lists.recentEmpty")} hold />
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
  const t = useT(battleReplays);
  const w = useT(battleReplayWords);

  const load = (input: string) => {
    const res = parseShowdownReplay(input, PLAY_FORMAT_INFO, t);
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
            {replayTitle(replay, w)}
          </strong>{" "}
          · {replay.formatName} · {w("turns", { n: replay.turns })}
        </p>
        <ReplayViewer replay={replay} imported={{ onReset: () => setReplay(null) }} />
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-6">
        <label className="block space-y-2">
          <span className="hud-label">{t("import.log")}</span>
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
            <Play className="h-4 w-4" aria-hidden /> {t("import.watch")}
          </Button>
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} data-testid="import-file-button">
            <FileUp className="h-4 w-4" aria-hidden /> {t("import.open")}
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
              if (file.size > IMPORT_MAX_BYTES) return setError(t("import.tooBig"));
              load(await file.text());
            }}
          />
          <span className="text-xs text-muted-foreground">{t("import.hint")}</span>
        </div>
      </CardContent>
    </Card>
  );
}
