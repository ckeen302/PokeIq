/**
 * Your seat in a battle: the token the server handed you, kept per battle in
 * localStorage so a reload (or reopening the link) puts you back in it.
 * Storage can throw (Safari "Block all cookies", sandboxed iframes): fall
 * back to memory for the session.
 */

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
