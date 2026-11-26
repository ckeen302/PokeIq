"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { formatNumber } from "@/i18n/format";
import huntNs from "@/messages/hunt";
import communityNs from "@/messages/community";
import { useProgress } from "@/lib/progress";
import { isCleanName } from "@/lib/name-filter";
import type { HuntBoardRow } from "@/lib/hunt/types";

/**
 * The Daily Hunt's leaderboard: today's best hunters, read from /api/geo/hunt/leaderboard. Until the
 * board's table exists (or with no database) the API says it's unavailable, and every part of it here
 * draws nothing: the setup and the end screen look as they did before it.
 */

export type HuntBoardState = { status: "loading" } | { status: "hidden" } | { status: "ready"; rows: HuntBoardRow[] };

export function useHuntBoard(date: string | null): HuntBoardState & { reload: () => void } {
  const [state, setState] = useState<HuntBoardState>({ status: "loading" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!date) return;
    let off = false;
    fetch(`/api/geo/hunt/leaderboard?date=${date}${tick ? `&t=${tick}` : ""}`)
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((b: { available?: boolean; rows?: HuntBoardRow[] }) => !off && setState(b.available && b.rows ? { status: "ready", rows: b.rows } : { status: "hidden" }))
      .catch(() => !off && setState({ status: "hidden" }));
    return () => {
      off = true;
    };
  }, [date, tick]);
  const reload = useCallback(() => setTick(Date.now()), []);
  return { ...state, reload };
}

/** The board's rows: rank, name, score. `tone`: the setup's card (the site's theme) or the end screen (navy). */
export function HuntBoardList({ rows, tone = "page", limit = 5, className }: { rows: HuntBoardRow[]; tone?: "page" | "game"; limit?: number; className?: string }) {
  const t = useT(huntNs);
  const fmt = (n: number) => formatNumber(n, t.locale);
  const game = tone === "game";
  return (
    <div className={cn("min-w-0", className)} data-testid="hunt-board">
      <p className={cn("flex items-center gap-1.5 font-display text-xs font-bold uppercase tracking-[0.14em]", game ? "text-[#ffd23c]" : "text-warning")}>
        <Trophy className="h-3.5 w-3.5" aria-hidden />
        {t("board.title")}
      </p>
      {rows.length ? (
        <ol className="mt-1.5 space-y-1">
          {rows.slice(0, limit).map((r) => (
            <li
              key={r.rank}
              className={cn("flex items-center gap-2 rounded-md px-2 py-1 text-sm", game ? "bg-white/[0.06] text-white" : "bg-muted/60")}
              aria-label={t("board.row", { rank: r.rank, name: r.name, score: fmt(r.score) })}
              data-testid="hunt-board-row"
            >
              <span className={cn("w-5 shrink-0 text-center font-display font-bold tabular-nums", r.rank === 1 ? (game ? "text-[#ffd23c]" : "text-warning") : game ? "text-white/60" : "text-muted-foreground")}>{r.rank}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
              <span className="shrink-0 font-display font-bold tabular-nums">{fmt(r.score)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className={cn("mt-1.5 text-sm", game ? "text-white/70" : "text-muted-foreground")} data-testid="hunt-board-empty">
          {t("board.empty")}
        </p>
      )}
    </div>
  );
}

/**
 * The end screen's board row: the name field and Save for a Daily that can be ranked (else why it can't),
 * then today's top hunters. Nothing at all while the board is unavailable.
 */
export function HuntEndBoard({ date, resultToken, practice }: { date: string; resultToken?: string; practice?: boolean }) {
  const t = useT(huntNs);
  const ct = useT(communityNs);
  const board = useHuntBoard(date);
  const progress = useProgress();
  const [name, setName] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (progress?.name && !name) setName(progress.name);
  }, [progress?.name, name]);
  if (board.status !== "ready") return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!isCleanName(name)) {
      setError(ct("nameRejected"));
      setState("error");
      return;
    }
    setState("saving");
    setError(null);
    try {
      const res = await fetch("/api/geo/hunt/leaderboard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resultToken, playerName: name.trim() }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? t("board.failed"));
      setState("saved");
      board.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("board.failed"));
      setState("error");
    }
  }

  return (
    <div className="flex w-[min(100%,26rem)] flex-col gap-2 rounded-xl bg-[#1e1a3f]/85 p-2.5 text-left text-white ring-1 ring-white/15 backdrop-blur xl:w-[min(100%,28rem)]" data-testid="hunt-end-board">
      {resultToken ? (
        <form className="flex items-end gap-2" onSubmit={save}>
          <label className="min-w-0 flex-1">
            <span className="block truncate font-display text-[10px] font-bold uppercase italic leading-none tracking-wide text-[#c8bfff]">{t("board.label")}</span>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              maxLength={24}
              required
              placeholder={t("board.placeholder")}
              disabled={state === "saved"}
              autoComplete="nickname"
              className="mt-1 h-8 w-full min-w-0 rounded-md border border-white/20 bg-[#120f24]/80 px-2.5 text-sm text-white placeholder:text-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a99cff] disabled:opacity-60"
              data-testid="hunt-board-name"
            />
          </label>
          <button
            type="submit"
            disabled={state === "saving" || state === "saved" || !name.trim()}
            className={cn(
              "flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3.5 font-display text-sm font-bold uppercase italic tracking-wide transition-colors disabled:cursor-not-allowed",
              state === "saved" ? "bg-[#4cbb17]/25 text-[#9be15d]" : "bg-[#6c5ce7] text-white hover:bg-[#7d6ff0] disabled:opacity-50"
            )}
            data-testid="hunt-board-save"
          >
            {state === "saved" && <Check className="h-4 w-4" aria-hidden />}
            {state === "saved" ? t("board.saved") : t("board.submit")}
          </button>
        </form>
      ) : (
        practice && (
          <p className="text-xs leading-snug text-white/75" data-testid="hunt-board-note">
            {t("board.practice")}
          </p>
        )
      )}
      {error && (
        <p role="alert" className="text-sm text-[#ff8a8a]">
          {error}
        </p>
      )}
      <HuntBoardList rows={board.rows} tone="game" limit={5} />
    </div>
  );
}
