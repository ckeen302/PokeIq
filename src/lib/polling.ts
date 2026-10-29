import type { DuelStatus } from "./duel-types";
import type { BattleView } from "./battle/play";
import { chatBusy, type ChatLine } from "./chat";

/**
 * Polling that spares the server (each poll is a function invocation): a tab
 * nobody is looking at stops polling, or only sends a slow heartbeat where
 * the server must keep hearing from a trainer, and polls at once when it's
 * looked at again; quiet states back off; and a poll lands right after a
 * known deadline, since the server only moves a timed phase on when it's
 * polled. Shared by duels and live battles; each has its pace below.
 */

/**
 * A hidden tab's heartbeat. Duels and battles count a trainer as away after
 * 10 s without a word (and drop them from the lobby, or forfeit them, after
 * 30 s), so a trainer who switches tabs to send the invite link stays put.
 */
export const HEARTBEAT_MS = 8_000;
/** Polls never come closer together than this, whatever the deadlines say. */
const MIN_GAP_MS = 250;
/** How long after a deadline to poll, so the server's clock has passed it too. */
const DEADLINE_SLACK_MS = 60;

export const pageHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

/** A view without its clock and revision, to tell whether a poll found anything new. */
export const fingerprint = (view: object) => JSON.stringify({ ...view, now: 0, rev: 0 });

/** `base` growing by half for each poll that found nothing new, up to `max`. */
export const backoff = (base: number, max: number, quietPolls: number) => Math.min(max, Math.round(base * 1.5 ** quietPolls));

/**
 * The wait before the next poll: `base`, or less to land just after the
 * soonest of `deadlines` still ahead (server times; `serverNow` is the
 * server's clock now).
 */
export function untilNext(base: number, serverNow: number, deadlines: (number | null | undefined)[]): number {
  let wait = base;
  for (const at of deadlines) {
    if (typeof at === "number" && at > serverNow) wait = Math.min(wait, at - serverNow + DEADLINE_SLACK_MS);
  }
  return Math.max(MIN_GAP_MS, wait);
}

export interface PollerOptions {
  /** One poll. Handles its own errors. */
  poll: () => Promise<void>;
  /** Milliseconds to the next poll while the tab is visible; null: none until kicked or shown again. */
  delay: () => number | null;
  /** Milliseconds between polls while the tab is hidden; null (the default): none until it's shown again. */
  hiddenDelay?: () => number | null;
}

export interface Poller {
  /** Poll now (after the poll under way, if any). Ignored while the tab is hidden. */
  kick(): void;
  /** Fresh state came another way (an action's response): count it as a poll. */
  touch(): void;
  stop(): void;
}

/** Polls at once, then as `delay` and `hiddenDelay` say, one poll at a time. */
export function startPoller({ poll, delay, hiddenDelay = () => null }: PollerOptions): Poller {
  let stopped = false;
  let running = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** When the latest poll ended. */
  let last = 0;

  function schedule() {
    clearTimeout(timer);
    timer = undefined;
    if (stopped || running) return;
    const hidden = pageHidden();
    const wait = hidden ? hiddenDelay() : delay();
    if (wait === null) return;
    // A heartbeat counts from the last poll, so hiding the tab doesn't put it off.
    const at = hidden ? last + wait : Date.now() + wait;
    timer = setTimeout(() => void run(), Math.max(0, at - Date.now()));
  }

  async function run() {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    clearTimeout(timer);
    running = true;
    try {
      await poll();
    } catch {
      // poll() reports its own failures; the next one tries again.
    }
    running = false;
    last = Date.now();
    if (stopped) return;
    if (again) {
      again = false;
      void run();
    } else schedule();
  }

  function onVisibility() {
    if (stopped) return;
    // Back in view: catch up at once (unless a poll just ran). Out of view: slow down now.
    if (!pageHidden() && Date.now() - last > MIN_GAP_MS) void run();
    else schedule();
  }

  document.addEventListener("visibilitychange", onVisibility);
  void run();

  return {
    kick() {
      if (!pageHidden()) void run();
    },
    touch() {
      last = Date.now();
      schedule();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}

// ---------------------------------------------------------------------------
// The pace of each game
// ---------------------------------------------------------------------------

/** A finished duel or battle stops polling this long after its end: any rematch is long settled. */
const FINISHED_POLL_MS = 10 * 60_000;

interface Timed {
  startsAt: number;
  endsAt: number;
}

/** What the pace of a duel depends on: fields every duel view has, and the timed ones some have. */
export interface DuelPace {
  rev: number;
  now: number;
  status: DuelStatus;
  you?: number | null;
  players?: unknown[];
  end?: { at: number };
  round?: Timed;
  question?: Timed;
  next?: { at: number };
  chat?: ChatLine[];
}

/** A lobby or a finished match whose chat is busy polls every 2 s (and keeps polling), so replies come through quickly. */
const CHAT_POLL_MS = 2000;
/** While the duel's live channel is up (changes are pushed), polls are only a safety net: this far apart in play. */
export const LIVE_POLL_MS = 3000;

/**
 * Duels (PokéGuessr, Pokédle, quizzes), while the tab is visible: every
 * second while a round is being played; every 2 s around it (the countdown,
 * the reveal), with a poll right after each deadline so the next round shows
 * on time; a lobby waiting for a challenger slows from 2 s to 5 s, and a
 * finished duel (watching for a rematch) from 4 s to 15 s, then stops.
 * `serverNow`: the server's clock now; `wake`: one more deadline worth a poll.
 * `live`: the duel's changes are pushed to this page (PokéGuessr over
 * Realtime), so polls ease off to 3 s; the deadline polls stay, since the
 * server only moves a timed phase on when it's asked.
 */
export function duelPollDelay(view: DuelPace | null, quietPolls: number, serverNow: number, wake?: number, live = false): number | null {
  if (!view) return 1000;
  if (view.status !== "playing" && chatBusy(view.chat, serverNow)) return live ? LIVE_POLL_MS : CHAT_POLL_MS;
  if (view.status === "finished") {
    if (view.end && serverNow - view.end.at > FINISHED_POLL_MS) return null;
    return backoff(live ? 6000 : 4000, 15_000, quietPolls);
  }
  if (view.status === "lobby") {
    // Both seats taken: either may press Ready, and play starts 3 s after the second does.
    if (live) return backoff(LIVE_POLL_MS, 8000, quietPolls);
    return (view.players?.length ?? 0) >= 2 ? 2000 : backoff(2000, 5000, quietPolls);
  }
  const round = view.round ?? view.question;
  const deadlines = [round?.startsAt, round?.endsAt, view.next?.at, wake];
  if (view.you === null || view.you === undefined) return untilNext(backoff(3000, 10_000, quietPolls), serverNow, deadlines);
  if (live) return untilNext(LIVE_POLL_MS, serverNow, deadlines);
  const playing = round !== undefined && round.startsAt <= serverNow && serverNow < round.endsAt;
  return untilNext(playing ? 1000 : 2000, serverNow, deadlines);
}

/** Duels, while the tab is hidden: a heartbeat for a trainer seated in a lobby or a duel under way, nothing otherwise. */
export function duelHiddenDelay(view: DuelPace | null): number | null {
  return view && view.you !== null && view.you !== undefined && view.status !== "finished" ? HEARTBEAT_MS : null;
}

/**
 * Battles, while the tab is visible. Against the computer every choice comes
 * back with its result, so polling is only a safety net. Live: every second
 * while waiting on the opponent, every 2 s while it's your move (nothing
 * happens until you choose), with a poll right after either clock runs out;
 * the lobby and the end as for duels.
 */
export function battlePollDelay(view: BattleView | null, quietPolls: number, serverNow: number): number | null {
  if (!view) return 1000;
  if (view.kind === "cpu") return view.status === "finished" ? null : 5000;
  if (view.status !== "playing" && chatBusy(view.chat, serverNow)) return CHAT_POLL_MS;
  if (view.status === "finished") {
    if (view.end && serverNow - view.end.at > FINISHED_POLL_MS) return null;
    return backoff(4000, 15_000, quietPolls);
  }
  if (view.status === "lobby") return view.players.length >= 2 ? 2000 : backoff(2000, 5000, quietPolls);
  const deadlines = [view.clocks?.you.deadline, view.clocks?.foe.deadline];
  // Spectators follow the battle closely, easing off while nothing happens.
  if (view.you === null) return untilNext(backoff(1500, 4000, quietPolls), serverNow, deadlines);
  const yourMove = view.request !== null && !view.waiting;
  return untilNext(yourMove ? 2000 : 1000, serverNow, deadlines);
}

/** Battles, while the tab is hidden: a heartbeat for a player seated in a live battle not yet over, nothing otherwise. */
export function battleHiddenDelay(view: BattleView | null): number | null {
  return view && view.kind === "pvp" && view.you !== null && view.status !== "finished" ? HEARTBEAT_MS : null;
}
