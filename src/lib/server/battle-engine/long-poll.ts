import "server-only";
import type { PvpFailure } from "../duel-core";
import { battleSeenDigest } from "@/lib/battle/live";
import type { BattleView } from "@/lib/battle/play";
import { pollBattle } from "./service";
import { battleVersion } from "./store";

/**
 * The long poll: GET /api/battle/:code?since=N&wait=1&seen=D holds its
 * answer until the battle moves on from what the page last showed, so the
 * opponent's move reaches a waiting trainer within about LONG_POLL_STEP_MS
 * of being saved, without a request every half second. It answers at once
 * when there is already something new (lines past `since`, or a view whose
 * digest isn't the page's `seen`), and otherwise:
 *
 *   - checks the battle's version every LONG_POLL_STEP_MS (one tiny read);
 *     when it moved, polls for real and answers if anything visible changed
 *     (a heartbeat moves the version without changing anything to see);
 *   - polls for real every LONG_POLL_TOUCH_MS anyway, so the waiting
 *     trainer keeps counting as here (and anything due is caught up);
 *   - gives up after LONG_POLL_MAX_MS, or just after a clock deadline, and
 *     answers with the latest view: the page simply asks again.
 *
 * A fallback for when Realtime's push (lib/battle/live.ts) isn't set up.
 * The route's maxDuration (30 s) leaves room for the 20 s wait.
 */

export const LONG_POLL_MAX_MS = 20_000;
export const LONG_POLL_STEP_MS = 250;
export const LONG_POLL_TOUCH_MS = 5_000;
/** Answer this long after a clock deadline passes, so the page's next poll catches it up. */
const DEADLINE_SLACK_MS = 250;

type Outcome = { ok: true; view: BattleView } | PvpFailure;

export interface LongPollOptions {
  maxMs?: number;
  stepMs?: number;
  touchMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Whether a view is worth waiting on: a live battle in its lobby or under way. */
const waitable = (view: BattleView) => view.kind === "pvp" && (view.status === "lobby" || view.status === "playing");

/** The soonest clock deadline still ahead (server time), if any. */
function soonestDeadline(view: BattleView): number {
  const at = [view.clocks?.you.deadline, view.clocks?.foe.deadline, ...(view.clocks?.seats ?? []).map((c) => c?.deadline)];
  return Math.min(...at.filter((d): d is number => typeof d === "number" && d > view.now));
}

export async function longPollBattle(
  code: string,
  token: unknown,
  since: number,
  viewer: string | null,
  seen: string | null,
  { maxMs = LONG_POLL_MAX_MS, stepMs = LONG_POLL_STEP_MS, touchMs = LONG_POLL_TOUCH_MS }: LongPollOptions = {}
): Promise<Outcome> {
  const started = Date.now();
  let out = await pollBattle(code, token, since, viewer);
  if (!out.ok) return out;
  const moved = (view: BattleView) => view.log.total > since || !waitable(view) || (seen !== null && battleSeenDigest(view) !== seen);
  if (moved(out.view)) return out;
  // From here on, compare against what this request first saw (the page's own `seen` matched it).
  seen = battleSeenDigest(out.view);
  const until = Math.min(started + Math.min(maxMs, LONG_POLL_MAX_MS), soonestDeadline(out.view) + DEADLINE_SLACK_MS);
  let rev = out.view.rev;
  let polled = Date.now();
  while (Date.now() + stepMs < until) {
    await sleep(stepMs);
    const version = await battleVersion(code);
    // Gone: the poll below says so properly.
    if (version !== null && version === rev && Date.now() - polled < touchMs) continue;
    out = await pollBattle(code, token, since, viewer);
    polled = Date.now();
    if (!out.ok || moved(out.view)) return out;
    rev = out.view.rev;
  }
  return out;
}
