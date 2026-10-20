import "server-only";
import { isCleanName } from "@/lib/name-filter";
import { CHAT_BURST, CHAT_GAP_MS, CHAT_KEPT, CHAT_MAX, CHAT_WINDOW_MS, type ChatLine } from "@/lib/chat";

/**
 * The server's side of chat: every message is cleaned (control characters
 * out, whitespace collapsed), refused if it carries a link, and has its
 * swears and slurs masked with ••• by the same filter as trainer names. A
 * message that's mostly masked is refused outright. Pure: the caller stores
 * the lines on its battle or duel.
 */

export const MASK = "•••";

export type ChatCheck = { ok: true; text: string; masked: boolean } | { ok: false; error: string };

/** Top-level domains worth refusing on sight (with any other ".xx" two-letter country code). */
const TLDS =
  "com|net|org|info|biz|io|gg|co|me|tv|xyz|app|dev|ly|link|site|online|club|live|fun|top|vip|shop|store|website|space|tech|click|pw|xxx|porn|sex|gay|chat|social|fyi|lol|wtf|edu|gov|mobi|name|pro|page|blog|cloud|stream|games|game|email|today|world|life|one|ninja|zone|icu|buzz|cam|bio";
/** "site.com", "site . com", "site(dot)com", "site dot com", "bit.ly/x", an IP, an e-mail address, "http", "www". */
const LINK_RES = [
  /https?|ftp:|:\/\/|www\s*\.|\bwww\b/i,
  new RegExp(`[a-z0-9-](?:\\.|\\s*[([{]\\s*dot\\s*[)\\]}]\\s*|\\s+dot\\s+)(?:${TLDS})(?![a-z])`, "i"),
  /[a-z0-9-]\s*\.\s*(?:com|net|org|xyz|ru)(?![a-z])/i,
  /[a-z0-9-]\.[a-z]{2}(?:\/|$)/i,
  /\b\d{1,3}(?:\s*\.\s*\d{1,3}){3}\b/,
  /\S@\S+\.\S/,
  /discord\s*\.?\s*(?:gg|com|app)|t\.me\/|\.onion\b/i,
];

/** Pokémon and words that look like a short domain ("Mr.Mime", "e.g.") stay allowed. */
const NOT_LINKS = /\b(?:mr|mrs|ms|dr|st|jr|vs|no|lv|lvl|hp|pp|atk|def|spa|spd|spe|e\.g|i\.e)\.\s*[a-z]{2}\b/gi;

export function looksLikeLink(text: string): boolean {
  const plain = text.normalize("NFKC").replace(/[。．｡]/g, ".").replace(NOT_LINKS, " ");
  return LINK_RES.some((re) => re.test(plain));
}

/** Control and invisible format characters out, at most two combining marks in a row, whitespace collapsed. */
export function tidyChat(raw: string): string {
  return raw
    .replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/(\p{M}{2})\p{M}+/gu, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Longest run of words checked together for a term split across them ("s h i t"). */
const MAX_SPAN = 16;

/**
 * Masks every word, or run of words, the name filter finds a swear or slur
 * in. `dirty` is the share of the message's letters masked.
 */
export function maskChat(text: string): { text: string; masked: boolean; dirty: number; clean: boolean } {
  if (isCleanName(text)) return { text, masked: false, dirty: 0, clean: true };
  const parts = text.split(/(\s+)/);
  const words = parts.map((p, i) => ({ p, i })).filter(({ p }) => p && !/^\s+$/.test(p));
  const hit = new Set<number>();
  for (const w of words) if (!isCleanName(w.p)) hit.add(w.i);

  const current = () => parts.map((p, i) => (hit.has(i) ? MASK : p)).join("");
  // Terms split across words: mask the shortest run of words that still reads as one.
  for (let guard = 0; guard < words.length && !isCleanName(current()); guard++) {
    let found: number[] | null = null;
    for (let span = 2; span <= Math.min(MAX_SPAN, words.length) && !found; span++) {
      for (let start = 0; start + span <= words.length; start++) {
        const run = words.slice(start, start + span);
        if (run.every((w) => hit.has(w.i))) continue;
        if (!isCleanName(run.map((w) => w.p).join(" "))) {
          found = run.map((w) => w.i);
          break;
        }
      }
    }
    if (!found) break;
    for (const i of found) hit.add(i);
  }

  const out = current();
  const letters = (s: string) => (s.match(/[\p{L}\p{N}]/gu) ?? []).length;
  const total = letters(text) || 1;
  const maskedLetters = words.filter((w) => hit.has(w.i)).reduce((sum, w) => sum + letters(w.p), 0);
  return { text: out, masked: hit.size > 0, dirty: maskedLetters / total, clean: isCleanName(out) };
}

/** A message as it will be stored, or why it can't be sent. */
export function checkChat(raw: unknown): ChatCheck {
  if (typeof raw !== "string") return { ok: false, error: "Type a message first." };
  const text = tidyChat(raw.slice(0, CHAT_MAX * 4));
  if (!text) return { ok: false, error: "Type a message first." };
  if (text.length > CHAT_MAX) return { ok: false, error: `Keep it under ${CHAT_MAX} characters.` };
  if (looksLikeLink(text)) return { ok: false, error: "Links can't be sent in chat." };
  const masked = maskChat(text);
  if (!masked.clean || masked.dirty > 0.5) return { ok: false, error: "Keep it friendly: that message wasn't sent." };
  return { ok: true, text: masked.text, masked: masked.masked };
}

/** Why `seat` can't send a message at `now` (too many, too fast), or null if it can. */
export function chatBlocked(lines: readonly ChatLine[], seat: number, now: number): string | null {
  const mine = lines.filter((l) => l.seat === seat);
  const last = mine[mine.length - 1];
  if (last && now - last.at < CHAT_GAP_MS) return "One message a second, please.";
  if (mine.filter((l) => now - l.at < CHAT_WINDOW_MS).length >= CHAT_BURST) return "You're sending messages too fast. Wait a few seconds.";
  return null;
}

/** `lines` with one more on the end, keeping the last CHAT_KEPT. */
export function addChatLine(lines: readonly ChatLine[] | undefined, line: Omit<ChatLine, "n">): ChatLine[] {
  const list = lines ?? [];
  const n = (list[list.length - 1]?.n ?? 0) + 1;
  return [...list, { n, ...line }].slice(-CHAT_KEPT);
}

/** A line from the game itself: "Blue joined", "GG!". */
export const systemLine = (lines: readonly ChatLine[] | undefined, text: string, at: number) => addChatLine(lines, { at, seat: null, text });

export type ChatPost = { ok: true; chat: ChatLine[] } | { ok: false; status: number; error: string };

/** A seated trainer's message, checked, rate-limited and added. */
export function postChat(lines: readonly ChatLine[] | undefined, seat: number, name: string, raw: unknown, now: number): ChatPost {
  if (seat < 0) return { ok: false, status: 403, error: "Only the trainers in this match can chat." };
  const blocked = chatBlocked(lines ?? [], seat, now);
  if (blocked) return { ok: false, status: 429, error: blocked };
  const checked = checkChat(raw);
  if (!checked.ok) return { ok: false, status: 400, error: checked.error };
  return { ok: true, chat: addChatLine(lines, { at: now, seat, name, text: checked.text }) };
}

/** The body field for a message, before checkChat looks at it properly. */
export const CHAT_BODY_MAX = CHAT_MAX * 4;
