"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DuelStatus } from "@/lib/duel-types";
import { loadSeat, saveSeat } from "@/lib/duel-seat";
import { setTrainerName, useProgress } from "@/lib/progress";
import { unlockAudio } from "@/lib/sound";

/**
 * A duel's state as this trainer may see it, kept fresh: polls the server
 * (every second in play, slower in the lobby and after the end, for a
 * rematch), sends the trainer's actions with their seat token, and keeps a
 * clock on the server's time, corrected for this device's.
 */

const POLL_MS: Record<DuelStatus, number> = { lobby: 2000, playing: 1000, finished: 3000 };

/** The fields every duel view has. */
interface ViewLike {
  rev: number;
  now: number;
  status: DuelStatus;
}

interface SeatLike<V> {
  code: string;
  token: string;
  view: V;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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

/** `api`: the duel's endpoint, e.g. /api/duel/<code>. */
export function useDuel<V extends ViewLike>(api: string, code: string) {
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
  const status = useRef<DuelStatus | null>(null);
  const now = useClock() + offset;

  const receive = useCallback((next: V, sentAt: number) => {
    // A slow response from before the latest change.
    if (next.rev < rev.current) return;
    rev.current = next.rev;
    status.current = next.status;
    if (next.status === "playing") setSawPlay(true);
    setOffset(next.now - (sentAt + Date.now()) / 2);
    setView(next);
  }, []);

  useEffect(() => {
    token.current = loadSeat(code);
    let stopped = false;
    let timer = 0;
    async function poll() {
      const sentAt = Date.now();
      try {
        const res = await fetch(api, { cache: "no-store", headers: token.current ? { "x-duel-token": token.current } : undefined });
        const data = await res.json().catch(() => ({}));
        if (res.status === 404) {
          setGone((data as { error?: string }).error ?? "This duel has ended or never existed.");
          return;
        }
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        if (!stopped) {
          receive(data as V, sentAt);
          setOffline(false);
        }
      } catch {
        if (!stopped) setOffline(true);
      }
      if (!stopped) timer = window.setTimeout(poll, status.current ? POLL_MS[status.current] : 1000);
    }
    void poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [api, code, receive]);

  /** Sends an action with this trainer's seat; false if the server said no (the message is in `error`). */
  async function act(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    const sentAt = Date.now();
    try {
      receive(await post<V>(api, { ...body, token: token.current }), sentAt);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
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
      receive(seat.view, sentAt);
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

  return { view, now, gone, offline, error, setError, busy, sawPlay, act, join, rematch };
}
