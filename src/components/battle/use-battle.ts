"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BattleSeatResponse, BattleView } from "@/lib/battle/play";
import { loadBattleSeat, saveBattleSeat } from "@/lib/battle/seat";
import { setTrainerName, useProgress } from "@/lib/progress";
import { battleHiddenDelay, battlePollDelay, fingerprint, startPoller } from "@/lib/polling";
import { unlockAudio } from "@/lib/sound";
import { ensureBattleId } from "@/lib/battle/replay-client";

/**
 * A battle as this player may see it, kept fresh: polls the server with the
 * seat token, keeps the player's channel of the battle protocol as one
 * growing list of lines (each poll asks only for lines it doesn't have yet),
 * sends choices with the request counter they answer, and keeps a clock on
 * the server's time.
 *
 * Polling (lib/polling): every second while waiting on the opponent, every
 * 2 s while it's your move, with a poll right after a clock runs out; slower
 * in the lobby and after the end (for a rematch). Against the computer every
 * answer comes back with the choice itself, so polling there is only a
 * safety net. A hidden tab only sends a heartbeat while its player is seated
 * in a live battle, and catches up at once when it's shown again.
 */

/** This tab's anonymous spectator id: it only counts heads in the "watching" number. */
function viewerId(): string {
  try {
    let id = window.sessionStorage.getItem("pokeiq:battle:viewer");
    if (!id) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"[b & 63]).join("");
      window.sessionStorage.setItem("pokeiq:battle:viewer", id);
    }
    return id;
  } catch {
    return "anonymous-viewer";
  }
}

async function post<T>(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: T & { error?: string; view?: BattleView } }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; view?: BattleView };
  return { ok: res.ok, status: res.status, data };
}

export function useBattle(code: string) {
  const api = `/api/battle/${code}`;
  const progress = useProgress();
  const [view, setView] = useState<BattleView | null>(null);
  /** The player's channel so far; `reset` counts restarts from scratch (the screen rebuilds). */
  const [log, setLog] = useState<{ lines: string[]; reset: number }>({ lines: [], reset: 0 });
  const [offset, setOffset] = useState(0);
  const [gone, setGone] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const token = useRef<string | null>(null);
  const rev = useRef(-1);
  const lines = useRef<string[]>([]);
  const resets = useRef(0);
  const current = useRef<BattleView | null>(null);
  const kick = useRef<() => void>(() => {});
  const touch = useRef<() => void>(() => {});
  /** Polls in a row that found nothing new, and the last thing found. */
  const quiet = useRef(0);
  const lastSeen = useRef("");
  const skew = useRef(0);

  const receive = useCallback((next: BattleView, sentAt: number) => {
    // A slow response from before the latest change.
    if (next.rev < rev.current) return;
    rev.current = next.rev;
    const have = lines.current.length;
    const { from, total, lines: incoming } = next.log;
    // A seated player's own channel; a spectator's is the spectator channel (the server picks which).
    if (current.current && current.current.you !== next.you && have > 0) {
      // Another channel altogether: start over from it.
      lines.current = from === 0 ? [...incoming] : [];
      resets.current += 1;
      setLog({ lines: lines.current, reset: resets.current });
      if (from > 0) window.setTimeout(() => kick.current(), 0);
    } else {
      if (from <= have && total > have) {
        lines.current = [...lines.current, ...incoming.slice(have - from)];
        setLog({ lines: lines.current, reset: resets.current });
      } else if (from === 0 && total < have) {
        // The server's channel is shorter than ours: start over from it.
        lines.current = [...incoming];
        resets.current += 1;
        setLog({ lines: lines.current, reset: resets.current });
      } else if (from > have) {
        // A gap (a response raced past another): ask again from where we are.
        window.setTimeout(() => kick.current(), 0);
      }
    }
    // Heartbeats move `rev` on without changing anything to see.
    const seen = fingerprint(next);
    quiet.current = seen === lastSeen.current ? quiet.current + 1 : 0;
    lastSeen.current = seen;
    current.current = next;
    skew.current = next.now - (sentAt + Date.now()) / 2;
    setOffset(skew.current);
    setView(next);
  }, []);

  useEffect(() => {
    token.current = loadBattleSeat(code);
    let stopped = false;
    let throttledUntil = 0;
    const poller = startPoller({
      async poll() {
        const sentAt = Date.now();
        try {
          const res = await fetch(`${api}?since=${lines.current.length}`, {
            cache: "no-store",
            headers: token.current ? { "x-battle-token": token.current } : { "x-battle-viewer": viewerId() },
          });
          const data = await res.json().catch(() => ({}));
          if (stopped) return;
          if (res.status === 404) {
            setGone((data as { error?: string }).error ?? "This battle has ended or never existed.");
            stopped = true;
          } else if (res.status === 429) throttledUntil = Date.now() + 30_000;
          else if (!res.ok) throw new Error(`Request failed (${res.status})`);
          else {
            receive(data as BattleView, sentAt);
            setOffline(false);
          }
        } catch {
          if (!stopped) setOffline(true);
        }
      },
      delay() {
        if (stopped) return null;
        const wait = battlePollDelay(current.current, quiet.current, Date.now() + skew.current);
        return wait !== null && Date.now() < throttledUntil ? Math.max(wait, 5000) : wait;
      },
      hiddenDelay: () => (stopped ? null : battleHiddenDelay(current.current)),
    });
    kick.current = poller.kick;
    touch.current = poller.touch;
    return () => {
      stopped = true;
      kick.current = () => {};
      touch.current = () => {};
      poller.stop();
    };
  }, [api, code, receive]);

  /** An action with this player's seat; false if the server said no (the reason is in `error`). */
  const act = useCallback(
    async (body: Record<string, unknown>): Promise<boolean> => {
      setBusy(true);
      setError(null);
      const sentAt = Date.now();
      try {
        const out = await post<BattleView>(api, { ...body, token: token.current, since: lines.current.length });
        if (out.ok) {
          receive(out.data, sentAt);
          touch.current();
          return true;
        }
        // A rejected choice comes back with the battle as it now stands.
        if (out.data.view) receive(out.data.view, sentAt);
        setError(out.data.error ?? `Request failed (${out.status})`);
        if (out.status === 409) kick.current();
        return false;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [api, receive]
  );

  const choose = useCallback((rqid: number, choice: string) => act({ action: "choose", rqid, choice }), [act]);
  /** Showdown's /timer on (and /timer off, for a player who asked for it). */
  const startTimer = useCallback((on = true) => act({ action: "timer", on }), [act]);
  /** Cancel: take back the choice you sent (only while the opponent is still choosing). */
  const undo = useCallback((rqid: number) => act({ action: "undo", rqid }), [act]);

  /** A chat message: never blocks play (no busy state); a refusal comes back as its message. */
  const chat = useCallback(
    async (text: string): Promise<string | null> => {
      const sentAt = Date.now();
      try {
        const out = await post<BattleView>(api, { action: "chat", text, token: token.current, since: lines.current.length });
        if (!out.ok) return out.data.error ?? `Request failed (${out.status})`;
        receive(out.data, sentAt);
        touch.current();
        return null;
      } catch {
        return "Couldn't send that. Check your connection.";
      }
    },
    [api, receive]
  );

  async function join(name: string, team?: string) {
    unlockAudio();
    setBusy(true);
    setError(null);
    const sentAt = Date.now();
    try {
      const rankedId = (await ensureBattleId()) ?? undefined;
      const out = await post<BattleSeatResponse>(api, { action: "join", name, team, rankedId });
      if (!out.ok) throw new Error(out.data.error ?? `Request failed (${out.status})`);
      saveBattleSeat(code, out.data.token);
      token.current = out.data.token;
      if (!progress?.name) setTrainerName(name);
      receive(out.data.view, sentAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't join the battle.");
    } finally {
      setBusy(false);
    }
  }

  /** Takes a seat in the rematch; its code, or null if that failed. */
  async function rematch(): Promise<string | null> {
    unlockAudio();
    setBusy(true);
    setError(null);
    try {
      const out = await post<BattleSeatResponse>(api, { action: "rematch", token: token.current });
      if (!out.ok) throw new Error(out.data.error ?? `Request failed (${out.status})`);
      saveBattleSeat(out.data.code, out.data.token);
      return out.data.code;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start a rematch.");
      setBusy(false);
      return null;
    }
  }

  return { view, log, offset, gone, offline, error, setError, busy, act, choose, startTimer, undo, chat, join, rematch };
}

export type BattleHandle = ReturnType<typeof useBattle>;
