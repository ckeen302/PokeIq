/**
 * This browser's anonymous Pokédle id: a random string kept in localStorage
 * so the community stats count each trainer once a day. It identifies
 * nothing else (the server stores only an HMAC of it). Storage can throw
 * (Safari "Block all cookies", sandboxed iframes): then it lasts the session.
 */

const KEY = "pokeiq:dle-player";
const VALID = /^[A-Za-z0-9_-]{16,64}$/;
let fallback: string | null = null;

function newId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function dlePlayerId(): string {
  try {
    const kept = window.localStorage.getItem(KEY);
    if (kept && VALID.test(kept)) return kept;
    fallback ??= newId();
    window.localStorage.setItem(KEY, fallback);
    return fallback;
  } catch {
    return (fallback ??= newId());
  }
}
