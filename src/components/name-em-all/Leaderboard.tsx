"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Loader2, Share2, Trophy } from "lucide-react";
import { dlePlayerId } from "@/lib/dle-player";
import { neaClock } from "@/lib/name-em-all/share";
import type { NeaBoard, NeaBoardResponse, NeaBoardRow } from "@/lib/name-em-all/types";
import { shareOrCopy } from "@/lib/share";
import { Button } from "@/components/ui/button";
import { CopyFallback } from "@/components/quiz/CopyFallback";
import { cn } from "@/lib/utils";

/** A category's ranked boards: fastest full clear, and most named inside the standard time. */
export function NeaLeaderboard({ scope, standardLabel, daily, refresh = 0 }: { scope: string; standardLabel: string; daily?: boolean; refresh?: number }) {
  const [board, setBoard] = useState<NeaBoard>(daily ? "count" : "clear");
  const [rows, setRows] = useState<NeaBoardRow[] | null | undefined>(undefined);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    setRows(undefined);
    setError(false);
    const player = (() => {
      try {
        return dlePlayerId();
      } catch {
        return "";
      }
    })();
    fetch(`/api/name-em-all/leaderboard?scope=${encodeURIComponent(scope)}&board=${board}${player ? `&player=${player}` : ""}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<NeaBoardResponse>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => live && setRows(d.rows))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [scope, board, refresh]);

  if (rows === null) return null; // boards off on this server
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4" aria-labelledby="nea-board" data-testid="nea-board">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="nea-board" className="flex items-center gap-2 font-display text-lg font-bold uppercase tracking-wide">
          <Trophy className="h-4 w-4 text-warning" aria-hidden /> {daily ? "Today's board" : "Leaderboard"}
        </h2>
        {!daily && (
          <div className="flex rounded-md border p-0.5 text-xs font-semibold" role="tablist" aria-label="Board">
            {(["clear", "count"] as const).map((b) => (
              <button
                key={b}
                role="tab"
                aria-selected={board === b}
                onClick={() => setBoard(b)}
                className={cn("rounded px-2.5 py-1.5 transition-colors", board === b ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {b === "clear" ? "Fastest clear" : `Most in ${standardLabel}`}
              </button>
            ))}
          </div>
        )}
      </div>
      {error ? (
        <p className="text-sm text-muted-foreground">Couldn&apos;t load the leaderboard.</p>
      ) : rows === undefined ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No ranked runs yet. Be the first!</p>
      ) : (
        <ol className="divide-y divide-border/60 text-sm">
          {rows.map((r, i) => (
            <li key={`${r.name}-${i}`} className={cn("flex items-center gap-3 px-1 py-2", r.you && "rounded bg-screen/[0.08]")} data-testid="nea-board-row">
              <span className="w-7 shrink-0 text-right font-display font-bold tabular-nums text-muted-foreground">{r.you && i >= 50 ? "…" : i + 1}</span>
              <span className="min-w-0 flex-1 truncate font-semibold">
                {r.name}
                {r.you && <span className="hud-label ml-1.5">You</span>}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {board === "count" && (
                  <b className="mr-2 text-foreground">
                    {r.named}/{r.total}
                  </b>
                )}
                {neaClock(r.ms)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Share the result: the share sheet on phones, the clipboard elsewhere, with a visible "Copied" and a manual-copy fallback. */
export function NeaShareButton({ text, testId = "nea-share" }: { text: string; testId?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "shared" | "failed">("idle");
  useEffect(() => {
    if (state !== "copied" && state !== "shared") return;
    const t = window.setTimeout(() => setState("idle"), 2200);
    return () => window.clearTimeout(t);
  }, [state]);
  return (
    <div className="space-y-2">
      <Button
        size="lg"
        onClick={async () => {
          const out = await shareOrCopy(text);
          setState(out === "copied" ? "copied" : out === "shared" ? "shared" : out === "failed" ? "failed" : "idle");
        }}
        data-testid={testId}
        aria-live="polite"
      >
        {state === "copied" ? <Check className="h-4 w-4" aria-hidden /> : state === "failed" ? <Copy className="h-4 w-4" aria-hidden /> : <Share2 className="h-4 w-4" aria-hidden />}
        {state === "copied" ? "Copied!" : state === "shared" ? "Shared!" : "Share result"}
      </Button>
      {state === "failed" && <CopyFallback text={text} />}
    </div>
  );
}
