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
