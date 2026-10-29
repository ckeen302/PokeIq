"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadSeat, saveSeat } from "@/lib/duel-seat";
import { setTrainerName, useProgress } from "@/lib/progress";
import { duelHiddenDelay, duelPollDelay, fingerprint, startPoller, type DuelPace } from "@/lib/polling";
import { unlockAudio } from "@/lib/sound";
import { rankedId } from "@/lib/ranked-client";

/**
 * A duel's state as this trainer may see it, kept fresh: polls the server,
 * sends the trainer's actions with their seat token, and keeps a clock on
 * the server's time, corrected for this device's.
 *
 * Polling (lib/polling): every second while a round is being played, slower
 * around it with a poll right after each deadline, slower still in a lobby
 * waiting for a challenger and after the end (for a rematch). A hidden tab
 * only sends a heartbeat while its trainer is seated, so they aren't counted
 * as gone, and catches up at once when it's shown again.
 *
 * A duel whose changes are pushed to the page (PokéGuessr over Realtime)
 * calls `refresh(rev)` as each push arrives, which polls at once unless the
 * page already has that revision, and `setLive(true)` while the channel is
 * up, which eases the polls off to a slow safety net.
 */

/** After a 429, polls slow to at least this for a while. */
const THROTTLED_MS = 5_000;

interface SeatLike<V> {
  code: string;
  token: string;
  view: V;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  // The browser's signed ranked id, when it has one: PokéGuessr keeps the duel in this trainer's history (/guessr/history).
  const id = rankedId();
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(id ? { "x-ranked-id": id } : {}) }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

/** Device time, ticking four times a second. */
export function useClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/**
 * `api`: the duel's endpoint, e.g. /api/duel/<code>. `wakeAt`: a server time
 * worth a poll right on time (a quiz question appearing), besides the
 * rounds' own start, end and next-round times.
 */
export function useDuel<V extends DuelPace>(api: string, code: string, wakeAt?: (view: V) => number | undefined) {
  const progress = useProgress();
  const [view, setView] = useState<V | null>(null);
  const [offset, setOffset] = useState(0);
  const [gone, setGone] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Seen the duel in play here (not just its result after a reload).
  const [sawPlay, setSawPlay] = useState(false);
  const token = useRef<string | null>(null);
  const rev = useRef(-1);
  const current = useRef<V | null>(null);
  /** Polls in a row that found nothing new. */
  const quiet = useRef(0);
  const lastSeen = useRef("");
  const throttledUntil = useRef(0);
  const touch = useRef<() => void>(() => {});
  const kick = useRef<() => void>(() => {});
  /** Changes are being pushed to the page, so polls can ease off. */
  const live = useRef(false);
  const wakeRef = useRef(wakeAt);
  wakeRef.current = wakeAt;
  /** `offset`, for timers that shouldn't restart each time it moves a little. */
  const skew = useRef(0);
  const now = useClock() + offset;

  const receive = useCallback((next: V, sentAt: number) => {
    // A slow response from before the latest change.
    if (next.rev < rev.current) return;
    // Heartbeats move `rev` on without changing anything to see.
    const seen = fingerprint(next);
    quiet.current = seen === lastSeen.current ? quiet.current + 1 : 0;
    lastSeen.current = seen;
    rev.current = next.rev;
    current.current = next;
    if (next.status === "playing") setSawPlay(true);
    skew.current = next.now - (sentAt + Date.now()) / 2;
    setOffset(skew.current);
    setView(next);
  }, []);

  useEffect(() => {
    token.current = loadSeat(code);
    let stopped = false;
    const poller = startPoller({
      async poll() {
        const sentAt = Date.now();
        try {
          const res = await fetch(api, { cache: "no-store", headers: token.current ? { "x-duel-token": token.current } : undefined });
          const data = await res.json().catch(() => ({}));
          if (stopped) return;
          if (res.status === 404) {
            setGone((data as { error?: string }).error ?? "This duel has ended or never existed.");
            stopped = true;
          } else if (res.status === 429) {
            throttledUntil.current = Date.now() + 30_000;
          } else if (!res.ok) throw new Error(`Request failed (${res.status})`);
          else {
            receive(data as V, sentAt);
            setOffline(false);
          }
        } catch {
          if (!stopped) setOffline(true);
        }
      },
      delay() {
        if (stopped) return null;
        const view = current.current;
        const wake = view && wakeRef.current ? wakeRef.current(view) : undefined;
        const wait = duelPollDelay(view, quiet.current, Date.now() + skew.current, wake, live.current);
        return wait !== null && Date.now() < throttledUntil.current ? Math.max(wait, THROTTLED_MS) : wait;
      },
      hiddenDelay: () => (stopped ? null : duelHiddenDelay(current.current)),
    });
    touch.current = poller.touch;
    kick.current = poller.kick;
    return () => {
      stopped = true;
      touch.current = () => {};
      kick.current = () => {};
      poller.stop();
    };
  }, [api, code, receive]);

  /** Polls now (a push said the duel changed): skipped if the page already has revision `rev`. */
  const refresh = useCallback((at?: number) => {
    if (at !== undefined && at <= rev.current) return;
    kick.current();
  }, []);

  /** Whether changes are being pushed to the page: while they are, polls ease off (lib/polling). */
  const setLive = useCallback((on: boolean) => {
    live.current = on;
  }, []);

  /** A response to an action: as good as a poll, so the next poll waits its turn. */
  const settle = useCallback(
    (next: V, sentAt: number) => {
      receive(next, sentAt);
      touch.current();
    },
    [receive]
  );

  /** Sends an action with this trainer's seat; false if the server said no (the message is in `error`). */
  async function act(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    const sentAt = Date.now();
    try {
      settle(await post<V>(api, { ...body, token: token.current }), sentAt);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** A side action (a reaction) that never blocks play: no busy state; a refusal comes back as its message. */
  async function send(body: Record<string, unknown>): Promise<string | null> {
    const sentAt = Date.now();
    try {
      settle(await post<V>(api, { ...body, token: token.current }), sentAt);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Something went wrong.";
    }
  }

  async function join(name: string) {
    unlockAudio();
    setBusy(true);
    setError(null);
    const sentAt = Date.now();
    try {
      const seat = await post<SeatLike<V>>(api, { action: "join", name });
      saveSeat(code, seat.token);
      token.current = seat.token;
      if (!progress?.name) setTrainerName(name);
      settle(seat.view, sentAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't join the duel.");
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
      const seat = await post<SeatLike<V>>(api, { action: "rematch", token: token.current });
      saveSeat(seat.code, seat.token);
      return seat.code;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start a rematch.");
      setBusy(false);
      return null;
    }
  }

  return { view, now, gone, offline, error, setError, busy, sawPlay, act, send, join, rematch, refresh, setLive };
}
