/**
 * A battle action the server answered "busy" (503: its compare-and-swap lost
 * to other writes six times running) is sent again on its own, after a short
 * jittered pause, before the player sees an error. The choice quotes its
 * request counter (`rqid`), so a resend can never play a move twice: if the
 * first one landed after all, the server turns the copy away.
 */

/** The pauses before each resend (each one ±50% at random). */
export const BUSY_RETRY_DELAYS_MS = [150, 400, 900] as const;

export interface Sent {
  status: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Sends with `send`, resending on a 503 up to BUSY_RETRY_DELAYS_MS.length times; the last answer comes back whatever it is. */
export async function sendRetryingBusy<T extends Sent>(
  send: () => Promise<T>,
  { delays = BUSY_RETRY_DELAYS_MS, wait = sleep, random = Math.random }: { delays?: readonly number[]; wait?: (ms: number) => Promise<void>; random?: () => number } = {}
): Promise<T> {
  let out = await send();
  for (const delay of delays) {
    if (out.status !== 503) return out;
    await wait(Math.round(delay * (0.5 + random())));
    out = await send();
  }
  return out;
}

/**
 * What to tell the trainer when a battle request never reached the server.
 * A browser's own words for that ("Failed to fetch", "Load failed",
 * "NetworkError when attempting to fetch resource.") say nothing useful, so
 * they are replaced; anything else (the server's own message) is kept.
 */
export function sendFailureText(err: unknown, fallback = "Something went wrong."): string {
  const text = err instanceof Error ? err.message : "";
  if (err instanceof TypeError || /failed to fetch|load failed|networkerror|network request failed/i.test(text)) return "Couldn't reach the battle. Check your connection: your choice wasn't sent, so pick it again.";
  return text || fallback;
}

/** The speed a battle plays at before the trainer picks one: 1x, and 2x on a phone, where a turn at 1x is a long wait with a thumb hovering. */
export const defaultBattleSpeed = (phone: boolean): 1 | 2 => (phone ? 2 : 1);
