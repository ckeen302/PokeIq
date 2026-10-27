/**
 * Your seat in a battle: the token the server handed you, kept per battle in
 * localStorage so a reload (or reopening the link) puts you back in it.
 * Storage can throw (Safari "Block all cookies", sandboxed iframes): fall
 * back to memory for the session.
 */

import type { BattleView } from "./play";

const KEY = (code: string) => `pokeiq:battle:${code}`;
const fallback = new Map<string, string>();

export function loadBattleSeat(code: string): string | null {
  try {
    return window.localStorage.getItem(KEY(code)) ?? fallback.get(code) ?? null;
  } catch {
    return fallback.get(code) ?? null;
  }
}

export function saveBattleSeat(code: string, token: string): void {
  fallback.set(code, token);
  try {
    window.localStorage.setItem(KEY(code), token);
  } catch {
    // keep the in-memory copy
  }
}

/**
 * The view the server answered when this tab started or joined a battle,
 * kept for the battle page (sessionStorage, one tab) so it draws the battle
 * the moment it opens instead of after its first poll; `sentAt` is when the
 * request went out, for the clock.
 */
const SEED_KEY = (code: string) => `pokeiq:battle:seed:${code}`;

export function saveBattleSeed(code: string, view: BattleView, sentAt: number): void {
  try {
    window.sessionStorage.setItem(SEED_KEY(code), JSON.stringify({ view, sentAt }));
  } catch {
    // The page polls instead.
  }
}

/** The seed for `code`, once: taken out of storage so a reload polls afresh. */
export function takeBattleSeed(code: string): { view: BattleView; sentAt: number } | null {
  try {
    const raw = window.sessionStorage.getItem(SEED_KEY(code));
    if (!raw) return null;
    window.sessionStorage.removeItem(SEED_KEY(code));
    const seed = JSON.parse(raw) as { view?: BattleView; sentAt?: number };
    return seed.view && typeof seed.sentAt === "number" && seed.view.log?.from === 0 ? { view: seed.view, sentAt: seed.sentAt } : null;
  } catch {
    return null;
  }
}
