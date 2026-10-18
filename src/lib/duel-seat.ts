/**
 * Your seat in a duel: the player token the server handed you, kept per duel
 * in localStorage so a reload (or reopening the link) puts you back in it.
 * Storage can throw (Safari "Block all cookies", sandboxed iframes): fall
 * back to memory for the session.
 */

const KEY = (code: string) => `pokeiq:duel:${code}`;
const fallback = new Map<string, string>();

export function loadSeat(code: string): string | null {
  try {
    return window.localStorage.getItem(KEY(code)) ?? fallback.get(code) ?? null;
  } catch {
    return fallback.get(code) ?? null;
  }
}

export function saveSeat(code: string, token: string): void {
  fallback.set(code, token);
  try {
    window.localStorage.setItem(KEY(code), token);
  } catch {
    // keep the in-memory copy
  }
}
