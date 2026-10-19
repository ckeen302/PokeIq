"use client";

import { useEffect, useRef, useState } from "react";
import { isValidDailyDate } from "@/lib/daily";
import { dlePlayerId } from "@/lib/dle-player";
import type { DleHint } from "@/lib/dle-types";
import {
  shareCommunity,
  standingOf,
  withYou,
  type DleDaySummary,
  type DlePersonal,
  type DleResultResponse,
  type DleShareCommunity,
  type DleStanding,
  type DleStatsResponse,
} from "@/lib/dle-community";

/**
 * How everyone did on today's Pokédle, once this trainer has finished it:
 * sends the finished game (the server plays it again and keeps the first
 * result of the day) and fetches the day's totals, in parallel. The totals
 * are cached by the CDN for everyone; your own place comes back from the
 * result, and your percentile is worked out here from the totals.
 *
 * One request per game however many components ask (the panel, the share
 * button). Practice, the archive and anything before the end never ask.
 * Without community stats on the server it stays "off" and nothing shows.
 */

export interface PokedleCommunityData {
  /** The day's totals, your result included. */
  summary: DleDaySummary;
  you: DlePersonal;
  standing: DleStanding | null;
  /** For the share text ("Top 18% of 4,213 trainers"), once enough trainers have finished. */
  community?: DleShareCommunity;
}

export type PokedleCommunityState = { status: "idle" | "loading" | "off" } | { status: "ready"; data: PokedleCommunityData };

/** The finished daily, as Pokedle hands it over. */
export interface PokedleCommunityGame {
  date: string;
  /** The guesses that counted, in order. */
  guessIds: number[];
  /** Played in hard mode (the server checks it). */
  hard: boolean;
  hints: DleHint[];
}

const loads = new Map<string, Promise<PokedleCommunityData | null>>();

async function json<T>(request: Promise<Response>): Promise<T | null> {
  try {
    const res = await request;
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

async function load({ date, guessIds, hard, hints }: PokedleCommunityGame): Promise<PokedleCommunityData | null> {
  const [result, stats] = await Promise.all([
    json<DleResultResponse>(
      fetch("/api/pokedle/result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, player: dlePlayerId(), guesses: guessIds, hard, hints }),
      })
    ),
    json<DleStatsResponse>(fetch(`/api/pokedle/stats?date=${encodeURIComponent(date)}`)),
  ]);
  if (!result?.available || !stats?.available) return null;
  const totals: DleDaySummary = { date: stats.date, players: stats.players, solved: stats.solved, dist: stats.dist, failed: stats.failed, openers: stats.openers };
  const summary = withYou(totals, result.you);
  return { summary, you: result.you, standing: standingOf(summary, result.you), community: shareCommunity(summary, result.you) };
}

export function usePokedleCommunity(game: PokedleCommunityGame | null | undefined): PokedleCommunityState {
  // Only a finished daily that still counts: today's (or yesterday's / tomorrow's somewhere).
  const key = game && game.guessIds.length > 0 && isValidDailyDate(game.date) ? `${game.date}|${game.guessIds.join(",")}` : null;
  const [state, setState] = useState<{ key: string; data: PokedleCommunityData | null } | null>(null);
  const gameRef = useRef(game);
  gameRef.current = game;

  useEffect(() => {
    const g = gameRef.current;
    if (!key || !g) return;
    let live = true;
    let pending = loads.get(key);
    if (!pending) {
      // The first request for a game goes with its options: the first result of the day is the one kept.
      pending = load(g);
      loads.set(key, pending);
    }
    void pending.then((data) => {
      if (live) setState({ key, data });
    });
    return () => {
      live = false;
    };
  }, [key]);

  if (!key) return { status: "idle" };
  if (state?.key !== key) return { status: "loading" };
  return state.data ? { status: "ready", data: state.data } : { status: "off" };
}
