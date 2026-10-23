"use client";

import { useSyncExternalStore } from "react";
import { saveSeat } from "./duel-seat";
import { loadBattleSeat, saveBattleSeat } from "./battle/seat";
import { ensureBattleId } from "./battle/replay-client";
import type { ModuleId } from "@/engines/types";
import type { TournamentMatchNote } from "./tournaments";
import type { ActivityKind, ChallengeAnswer, ChallengeKind, ChallengeView, FriendsResponse, HeartbeatResponse } from "./community";

/**
 * The browser side of friends: the friends panel's data, what the
 * heartbeat brought (requests, challenges, answers), and challenging a
 * friend through each game's own invite flow (open the battle or duel as
 * usual, then send the friend its code).
 */

export type FriendsTab = "friends" | "requests" | "add";

interface CommunityState {
  open: boolean;
  tab: FriendsTab;
  /** The friends list (null until first loaded). */
  list: FriendsResponse | null;
  loading: boolean;
  error: string | null;
  /** Friends are off on this server (no store, or the migration isn't applied yet). */
  off: boolean;
  requests: number;
  challenges: ChallengeView[];
  answers: ChallengeAnswer[];
  /** Tournament matches ready to play. */
  matches: TournamentMatchNote[];
}

let state: CommunityState = { open: false, tab: "friends", list: null, loading: false, error: null, off: false, requests: 0, challenges: [], answers: [], matches: [] };
const listeners = new Set<() => void>();
/** Challenges and answers already shown and closed (the next heartbeat may still carry them). */
const dismissed = new Set<string>();

function set(next: Partial<CommunityState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function useCommunity(): CommunityState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state
  );
}

async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export function openFriends(tab: FriendsTab = state.tab) {
  set({ open: true, tab });
  void refreshFriends();
}

export const closeFriends = () => set({ open: false });
export const setFriendsTab = (tab: FriendsTab) => set({ tab });

export async function refreshFriends(): Promise<void> {
  set({ loading: true });
  try {
    const list = await api<FriendsResponse>("/api/friends");
    set({ list, loading: false, error: null, off: !list.available, requests: list.incoming?.length ?? state.requests });
  } catch (err) {
    set({ loading: false, error: err instanceof Error ? err.message : "Couldn't load your friends." });
  }
}

/** A friends action (request, accept, decline, remove, block, unblock, appear-offline); refreshes the list. */
export async function friendAction(body: Record<string, unknown>): Promise<{ status?: string }> {
  const out = await api<{ status?: string; available?: boolean }>("/api/friends", body);
  if (out.available === false) {
    set({ off: true });
    throw new Error("Friends open soon.");
  }
  void refreshFriends();
  return out;
}

/** One heartbeat. Returns false when friends are off here or the trainer isn't signed in (stop beating). */
export async function beat(activity: { kind: ActivityKind; code?: string; room?: string }): Promise<boolean> {
  try {
    const res = await fetch("/api/presence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(activity) });
    if (res.status === 401) return false;
    if (!res.ok) return true;
    const out = (await res.json()) as HeartbeatResponse;
    if (!out.available) {
      set({ off: true });
      return false;
    }
    set({
      requests: out.requests,
      challenges: out.challenges.filter((c) => !dismissed.has(c.id)),
      matches: (out.matches ?? []).filter((m) => !dismissed.has(m.code)),
      // Answers are delivered once: keep the ones not yet closed.
      answers: [...state.answers, ...out.answers.filter((a) => !dismissed.has(a.id) && !state.answers.some((b) => b.id === a.id))],
    });
    return true;
  } catch {
    return true;
  }
}

export function dismissNote(id: string) {
  dismissed.add(id);
  set({ challenges: state.challenges.filter((c) => c.id !== id), answers: state.answers.filter((a) => a.id !== id), matches: state.matches.filter((m) => m.code !== id) });
}

/** Accepts (returns the invite page to go to) or declines a friend's challenge. */
export async function answerChallenge(id: string, accept: boolean): Promise<string | null> {
  dismissNote(id);
  const out = await api<{ href?: string }>("/api/friends/challenge", { action: accept ? "accept" : "decline", id });
  return out.href ?? null;
}

// ---------------------------------------------------------------------------
// Challenging a friend
// ---------------------------------------------------------------------------

export type ChallengeChoice =
  | { kind: "battle"; code: string }
  | { kind: "pokedle" }
  | { kind: "quiz"; module: ModuleId }
  | { kind: "guessr"; region?: string }
  | { kind: "connections" }
  | { kind: "pikadoku" };

/** Sends a friend the code of a game you already opened. */
export async function sendChallenge(to: string, kind: ChallengeKind, code: string, token: string): Promise<void> {
  await api("/api/friends/challenge", { action: "send", to, kind, code, token });
}

/** Challenges `to` to a battle you just opened (its seat is saved on this device). */
export async function challengeToBattle(to: string, code: string): Promise<void> {
  const token = loadBattleSeat(code);
  if (!token) throw new Error("Open the battle first.");
  await sendChallenge(to, "battle", code, token);
}

/** Opens a live battle with an invite link (as "Battle a friend" does), challenges `to` to it, and returns its page. */
export async function challengeToLiveBattle(to: string, name: string, format = "gen9randombattle"): Promise<string> {
  const rankedId = (await ensureBattleId()) ?? undefined;
  const seat = await api<{ code: string; token: string }>("/api/battle", { mode: "pvp", name, format, rankedId });
  saveBattleSeat(seat.code, seat.token);
  await sendChallenge(to, "battle", seat.code, seat.token);
  return `/battle/live/${seat.code}`;
}

/** Opens a duel through its usual invite flow, challenges `to` to it, and returns its lobby. */
export async function challengeToDuel(to: string, name: string, choice: Exclude<ChallengeChoice, { kind: "battle" }>): Promise<string> {
  const { endpoint, body, href } =
    choice.kind === "guessr"
      ? { endpoint: "/api/geo/duel", body: { name, region: choice.region ?? "world" }, href: (c: string) => `/guessr/duel/${c}` }
      : choice.kind === "pokedle"
        ? { endpoint: "/api/duel", body: { kind: "pokedle", name }, href: (c: string) => `/pokedle/duel/${c}` }
        : choice.kind === "pikadoku"
          ? { endpoint: "/api/duel", body: { kind: "pikadoku", name }, href: (c: string) => `/pikadoku/duel/${c}` }
          : choice.kind === "connections"
          ? { endpoint: "/api/duel", body: { kind: "connections", name }, href: (c: string) => `/connections/duel/${c}` }
          : { endpoint: "/api/duel", body: { kind: "quiz", name, module: choice.module, difficulty: "medium" }, href: (c: string) => `/quiz/duel/${c}` };
  const seat = await api<{ code: string; token: string }>(endpoint, body);
  saveSeat(seat.code, seat.token);
  await sendChallenge(to, choice.kind, seat.code, seat.token);
  return href(seat.code);
}

/** "Play now" on a tournament match: keeps the seat on this device and returns the battle's page. */
export function openTournamentMatch(note: { code: string; token: string }): string {
  saveBattleSeat(note.code, note.token);
  dismissNote(note.code);
  return `/battle/live/${note.code}`;
}
