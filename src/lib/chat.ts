/**
 * Player chat in live battles and duels (lobby and results only), shared by
 * the server, which checks and stores every message (server/chat.ts), and the
 * page, which shows them as plain text.
 */

/** A message is 1 to this many characters, after trimming. */
export const CHAT_MAX = 200;
/** Messages kept per battle or duel: older ones drop off. */
export const CHAT_KEPT = 50;
/** A trainer may send a message at most this often, and at most CHAT_BURST in any CHAT_WINDOW_MS. */
export const CHAT_GAP_MS = 1_000;
export const CHAT_BURST = 5;
export const CHAT_WINDOW_MS = 10_000;

export interface ChatLine {
  /** Counts up with every line in the battle or duel. */
  n: number;
  /** Server time. */
  at: number;
  /** The sender's seat, or null for a line from the game ("Blue joined", "GG!"). */
  seat: number | null;
  /** The sender's name (absent on the game's lines). */
  name?: string;
  text: string;
}

/** "Report" on a message: what goes to POST /api/report, with the battle or duel's code and the message. */
export function chatReport(line: ChatLine, code: string, game: string, page: string) {
  return {
    kind: "feedback" as const,
    message: `Chat report (${game} ${code}): ${line.name ?? "?"} said "${line.text}"`,
    page,
    extra: { chat: { code, game, n: line.n, at: line.at, seat: line.seat, name: line.name, text: line.text } },
  };
}

/** A chat that's been busy lately keeps polling brisk, so replies don't wait on a slow poll. */
export const CHAT_BRISK_MS = 60_000;
export const chatBusy = (chat: readonly ChatLine[] | undefined, serverNow: number) =>
  !!chat?.length && serverNow - chat[chat.length - 1].at < CHAT_BRISK_MS;
