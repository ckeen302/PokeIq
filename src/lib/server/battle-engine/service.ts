import "server-only";
import { canonicalJson } from "@/lib/server/canonical-json";
import { randomInt } from "node:crypto";
import { randomId, signToken, verifyToken } from "../crypto";
import { fail, type PvpFailure } from "../duel-core";
import { postChat, systemLine } from "../chat";
import {
  BATTLE_AWAY_MS,
  PLAY_FORMAT_INFO,
  BATTLE_QUIET_MS,
  BATTLE_TIMEOUTS_TO_LOSE,
  BATTLE_TIMER,
  showdownTimer,
  turnTopUp,
  type BattleTimer,
  type BattleEndReason,
  type PlayFormatId,
  type BattleRequest,
  type BattleView,
  type CpuLevel,
  type GameType,
  isGameType,
  playerCount as playersFor,
  teamOf,
} from "@/lib/battle/play";
import { PVP_AWAY_MS } from "@/lib/pvp-types";
import { SIM_VERSION, SimReplayError, SimSession, newSeed, seatOfSide, sideOf, type PlayerSide } from "./engine";
import { chooseCpu, seededRandom } from "./cpu";
import { randomChoice } from "./choices";
import { cpuTeam, factoryTeam, pickFactoryTier, prepareTeam, seatTeam } from "./teams";
import { checkRules, customCpuTeam, prepareCustomTeam } from "./custom";
import { Dex, Teams } from "pokemon-showdown";
import { customName, customTimer, type CustomRules } from "@/lib/battle/custom-rules";
import {
  ALL_CHANNELS,
  insertBattle,
  jsonbOrder,
  loadBattle,
  loadBattleMeta,
  saveBattle,
  type BattleChannel,
  type BattleMeta,
  type BattlePatch,
  type BattleRecord,
  type BattleSeat,
  type SideClock,
} from "./store";

/**
 * A battle's whole life: creating it (against the computer, or a live
 * invite with a lobby), each poll, each choice, the clocks, presence,
 * forfeits and rematches.
 *
 * Every poll or action catches the battle up, and so does the tick
 * (/api/battle/tick, once a minute from the database's scheduler) for live
 * battles nobody is polling. A player whose clock ran out gets an explicit
 * choice played for them (two in a row, or an empty bank, loses); a player
 * who stopped polling forfeits. Every change is read-modify-compare-and-swap on the
 * battle's row, retried from a fresh read on a clash.
 *
 * A player's choice must quote the request counter (`rqid`) of the request
 * it answers, so a double-click or a replayed packet can't play a move twice.
 */

export type Outcome<T> = ({ ok: true } & T) | PvpFailure;

const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const newBattleCode = () => Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");

/** Heartbeats move `seenAt` on in steps this big, so polling doesn't write every second. */
const SEEN_STEP_MS = 5_000;
const MAX_TRIES = 6;
/**
 * Between compare-and-swap retries, a random pause of up to this much per
 * attempt so far: two requests that clashed don't clash again in lockstep.
 */
const CAS_JITTER_MS = 25;
/**
 * The computer plays inside the human's own request (its answer comes back
 * with the choice). Past this much time in one request it stops, and the
 * next poll (or tick) plays the rest: `overdue` sees the computer's open
 * request. It always gets at least one choice per request, so it never
 * stalls.
 */
export const CPU_REQUEST_BUDGET_MS = 1_500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** The computer never needs more than a couple of choices in a row; a cap keeps a bug from spinning. */
const MAX_CPU_STEPS = 8;
/** With no trainer left to answer (a Free-For-All whose last trainer is out), the computers play the battle out: at most this many choices a request. */
const MAX_CPU_ONLY_STEPS = 480;
const CPU_SEAT_ID = "cpu";

/** A seat the computer plays: the opponent in a battle against the computer, or a four-player room's filled seat. */
export const isCpuSeat = (seat: Pick<BattleSeat, "id" | "cpu"> | undefined) => !!seat && (seat.cpu === true || seat.id === CPU_SEAT_ID);

const gameTypes = new Map<string, GameType>();

/** The Showdown format id a battle plays. */
const showdownIdOf = (meta: Pick<BattleMeta, "format" | "formatid">) => meta.formatid ?? SHOWDOWN_FORMAT[meta.format] ?? meta.format;

/** A battle's game type: stored once it starts; before that, the Showdown format's own (custom rules on one of Showdown's formats included). */
export function gameTypeOf(meta: Pick<BattleMeta, "format" | "formatid" | "gameType">): GameType {
  if (meta.gameType) return meta.gameType;
  const id = showdownIdOf(meta);
  let type = gameTypes.get(id);
  if (!type) {
    try {
      const raw = Dex.formats.get(id, true).gameType;
      type = isGameType(raw) ? raw : PLAY_FORMAT_INFO[meta.format].gameType;
    } catch {
      type = PLAY_FORMAT_INFO[meta.format].gameType;
    }
    gameTypes.set(id, type);
  }
  return type;
}

/** Trainers a battle seats: four in Free-For-All and Multi Battles. */
export const seatsFor = (meta: Pick<BattleMeta, "format" | "formatid" | "gameType" | "playerCount">) => meta.playerCount ?? playersFor(gameTypeOf(meta));

/** A Free-For-All seat whose trainer is already out. */
const isOut = (meta: BattleMeta, seat: number) => !!meta.out?.some((o) => o.seat === seat);

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

/** A player's secret: their seat in one battle, signed so nobody can act for anyone else. */
export function battleToken(code: string, playerId: string, seat: number): string {
  return signToken("battle", { d: code, p: playerId, s: seat });
}

/** The player (and the seat they last had, a hint for which channel to read) a token is for. */
export function readBattleToken(token: unknown, code: string): { playerId: string; seat: number } | null {
  const t = verifyToken<{ d: string; p: string; s: number }>("battle", token);
  return t && t.d === code && typeof t.p === "string" ? { playerId: t.p, seat: t.s === 1 || t.s === 2 || t.s === 3 ? t.s : 0 } : null;
}

const seatIndex = (meta: BattleMeta, playerId: string | null) => (playerId ? meta.seats.findIndex((s) => s.id === playerId && !isCpuSeat(s)) : -1);
const channelOf = (seat: number): BattleChannel => sideOf(seat);

/**
 * The one channel a viewer may read: a seated player's own, and for anyone
 * else watching a live battle the spectator channel (what Showdown's
 * spectators see: no request, no hidden set, HP in percent). Nothing for a
 * visitor to a battle against the computer.
 */
export function channelFor(meta: Pick<BattleMeta, "kind">, seat: number): BattleChannel | null {
  if (seat >= 0 && seat <= 3) return channelOf(seat);
  return meta.kind === "pvp" ? "spectator" : null;
}

const viewerLog = (rec: BattleRecord, seat: number) => {
  const channel = channelFor(rec.meta, seat);
  return channel ? (rec.logs[channel] ?? []) : [];
};

// ---------------------------------------------------------------------------
// Spectators
// ---------------------------------------------------------------------------

/** A spectator's anonymous id (made up by their browser; it only counts heads). */
export const VIEWER_RE = /^[A-Za-z0-9_-]{8,32}$/;
/** A spectator not heard from in this long has gone. */
export const WATCHER_TTL_MS = 30_000;
/** A spectator's poll refreshes their mark at most this often, to spare writes. */
const WATCH_STEP_MS = 12_000;
const WATCHERS_MAX = 200;

/** Spectators watching now. */
export const spectatorCount = (meta: Pick<BattleMeta, "watchers">, now: number) =>
  Object.values(meta.watchers ?? {}).filter((at) => now - at <= WATCHER_TTL_MS).length;

/** Marks a spectator as watching (and forgets those who left). True if `meta` changed. */
export function touchWatcher(meta: BattleMeta, viewer: string | null, now: number): boolean {
  if (!viewer || !VIEWER_RE.test(viewer) || meta.kind !== "pvp" || meta.status !== "playing") return false;
  const seen = meta.watchers?.[viewer];
  if (seen !== undefined && now - seen < WATCH_STEP_MS) return false;
  const live = Object.entries(meta.watchers ?? {}).filter(([id, at]) => id !== viewer && now - at <= WATCHER_TTL_MS);
  meta.watchers = Object.fromEntries([...live.slice(-(WATCHERS_MAX - 1)), [viewer, now]]);
  return true;
}

// ---------------------------------------------------------------------------
// Working on a battle
// ---------------------------------------------------------------------------

/** One request's changes to a battle, and the simulator if it was needed. */
class Work {
  rec: BattleRecord;
  private readonly before: string;
  private stateChanged = false;
  private readonly logsChanged = new Set<BattleChannel>();
  private sim: { session: SimSession; before: (object | null)[] } | null = null;
  /** Why the battle is about to end, when a forfeit, timeout or disconnect ends it. */
  reason: BattleEndReason | null = null;
  /** When the request working on this battle began (performance.now()), for the computer's time budget. */
  readonly startedAt: number;
  /** Choices the computer has made in this request. */
  cpuSteps = 0;

  constructor(rec: BattleRecord, startedAt = performance.now()) {
    this.rec = structuredClone(rec);
    this.before = JSON.stringify(rec.meta);
    this.startedAt = startedAt;
  }

  get meta() {
    return this.rec.meta;
  }

  get changed() {
    return this.stateChanged || this.logsChanged.size > 0 || JSON.stringify(this.rec.meta) !== this.before;
  }

  patch(): BattlePatch {
    const patch: BattlePatch = { meta: this.rec.meta };
    if (this.stateChanged) {
      patch.state = this.rec.state;
      patch.inputLog = this.rec.inputLog;
    }
    if (this.logsChanged.size) {
      // p3's channel is stored with p1's and p4's with p2's (store.ts): a change to either writes both.
      const changed = new Set(this.logsChanged);
      for (const [a, b] of [["p1", "p3"], ["p2", "p4"]] as const) {
        if (!this.rec.logs[b]) continue;
        if (changed.has(a) || changed.has(b)) changed.add(a).add(b);
      }
      patch.logs = Object.fromEntries([...changed].map((ch) => [ch, this.rec.logs[ch] ?? []]));
    }
    return patch;
  }

  /** The simulator, restored once per request; null if the battle can't be restored (it then ends as no contest). */
  session(now: number): SimSession | null {
    if (this.sim) return this.sim.session;
    if (!this.rec.state) return null;
    try {
      const session = SimSession.restore({ simVersion: this.meta.simVersion, state: this.rec.state, inputLog: this.rec.inputLog, chosen: this.meta.chosen });
      this.sim = { session, before: session.sides.map((side) => session.requestObject(side)) };
      return session;
    } catch (err) {
      console.error(`[battle] ${this.meta.code} couldn't be restored:`, err instanceof SimReplayError ? err.message : err);
      endBattle(this.meta, "nocontest", [], now);
      return null;
    }
  }

  /** A line for everyone's log that isn't the simulator's (Showdown's |inactive| timer messages). */
  note(line: string) {
    for (const channel of ALL_CHANNELS) {
      const log = this.rec.logs[channel];
      if (!log) continue;
      log.push(line);
      this.meta.lines[channel] = log.length;
      this.logsChanged.add(channel);
    }
  }

  /** A battle that's just starting. */
  begin(session: SimSession) {
    this.sim = { session, before: session.sides.map(() => null) };
  }

  /**
   * Takes in what the simulator did: the snapshot, each channel's new lines,
   * each side's request (a new one gets a new counter and a fresh clock) and
   * the result.
   */
  absorb(now: number) {
    if (!this.sim) return;
    const { session } = this.sim;
    const meta = this.meta;
    // The computer answers whatever it's been asked (every seat it plays) before the turn's lines are taken in.
    playCpu(this, session);
    const res = session.result();
    this.rec.state = res.state;
    this.rec.inputLog = res.inputLog;
    this.stateChanged = true;
    meta.simVersion = res.simVersion;
    meta.turn = res.turn;
    meta.chosen = res.chosen ?? {};
    for (const channel of ["spectator", ...session.sides] as const) {
      const lines = res.lines[channel];
      if (!lines?.length) continue;
      const log = (this.rec.logs[channel] ??= []);
      log.push(...lines);
      meta.lines[channel] = log.length;
      this.logsChanged.add(channel);
    }
    // A Free-For-All's trainers as they're knocked out (a forfeit counts), in order.
    if (gameTypeOf(meta) === "freeforall") {
      for (const side of session.out()) {
        const seat = seatOfSide(side);
        if (!isOut(meta, seat)) meta.out = [...(meta.out ?? []), { seat, turn: res.turn }];
      }
    }
    const started: number[] = [];
    session.sides.forEach((side, seat) => {
      const pending = session.pending(side);
      const object = session.requestObject(side);
      // Compared by content in a fixed key order: the stored copy comes back from jsonb with its keys reordered.
      const fresh = object !== this.sim!.before[seat] || canonicalJson(pending) !== canonicalJson(meta.requests[seat]);
      this.sim!.before[seat] = object;
      if (!fresh) return;
      const wasPending = (meta.requests[seat] ?? null) !== null;
      meta.rqid[seat] = (meta.rqid[seat] ?? 0) + 1;
      meta.requests[seat] = pending ? (JSON.parse(JSON.stringify(pending)) as BattleRequest) : null;
      const clock = meta.clocks?.[seat];
      if (!clock) return;
      if (!pending) stopClock(clock, now);
      // The simulator updated the same request (a move turned out to be disabled): the clock keeps running.
      else if (!(pending.update && wasPending && clock.deadline !== null)) started.push(seat);
    });
    if (started.length && meta.clocks) {
      const timer = timerOf(meta);
      if (timer) {
        topUp(meta, meta.clocks, timer, started.length, meta.requests.filter(Boolean).length);
        for (const seat of started) startClock(meta.clocks[seat], now, !!meta.requests[seat]?.teamPreview, timer, !!meta.timerFirst);
        for (const seat of started) {
          const left = Math.ceil((meta.clocks[seat].deadline! - now) / 1000);
          // Showdown: "Red has 25 seconds left this turn." when a request comes in with 30 s or less.
          if (left <= 30 && left * 1000 < (timer.refill ?? timer.bank)) this.note(`|inactive|${meta.seats[seat].name} has ${left} seconds left this turn.`);
        }
      }
    }
    if (res.ended && !meta.end) {
      endBattle(meta, this.reason ?? "normal", res.winners.map(seatOfSide), now);
    }
  }
}

/**
 * The end of a battle: who won (`winners`, every winning seat: both
 * partners in a Multi Battle; none for a tie or no contest) and, in a
 * Free-For-All, the final standings (the winner, then the trainers knocked
 * out, latest first).
 */
function endBattle(meta: BattleMeta, reason: BattleEndReason, winners: number[], at: number) {
  meta.status = "finished";
  const four = seatsFor(meta) === 4;
  meta.end = { reason, winner: winners.length ? Math.min(...winners) : null, at };
  if (four) meta.end.winners = [...winners].sort((a, b) => a - b);
  if (gameTypeOf(meta) === "freeforall") {
    const out = (meta.out ?? []).map((o) => o.seat);
    const rest = meta.seats.map((_, i) => i).filter((i) => !winners.includes(i) && !out.includes(i));
    meta.end.standings = [...winners, ...rest, ...[...out].reverse()].filter((s, i, all) => all.indexOf(s) === i);
  }
  meta.requests = meta.requests.map(() => null);
  for (const clock of meta.clocks ?? []) {
    clock.startedAt = null;
    clock.deadline = null;
  }
  if (meta.kind === "pvp") meta.chat = systemLine(meta.chat, "GG!", at);
}

/** Everyone who isn't `seat`'s side: the winners when `seat` loses a two-trainer battle, or (a Multi Battle) when its team does. */
function winnersAgainst(meta: BattleMeta, seat: number): number[] {
  const type = gameTypeOf(meta);
  return meta.seats.map((_, i) => i).filter((i) => teamOf(type, i) !== teamOf(type, seat));
}

// ---------------------------------------------------------------------------
// The clocks
// ---------------------------------------------------------------------------

type Timer = BattleTimer;

const showdownTimers = new Map<string, BattleTimer>();

/** A battle's turn timer: its ruleset's (null: no timer), else Showdown's timer for the Showdown format it plays (the VGC Timer where the format has it). */
export function timerOf(meta: Pick<BattleMeta, "format" | "rules"> & { formatid?: string; gameType?: GameType }): Timer | null {
  if (meta.rules) return customTimer(meta.rules);
  const gameType = gameTypeOf(meta);
  const id = meta.formatid ?? SHOWDOWN_FORMAT[meta.format] ?? meta.format;
  let timer = showdownTimers.get(id);
  if (!timer) {
    try {
      const rule = Dex.formats.getRuleTable(Dex.formats.get(id, true)).timer?.[0] ?? null;
      timer = showdownTimer(gameType, rule as Parameters<typeof showdownTimer>[1]);
    } catch {
      timer = BATTLE_TIMER[gameType];
    }
    showdownTimers.set(id, timer);
  }
  return timer;
}

export function newClock(timer: Timer): SideClock {
  return { bank: timer.bank, startedAt: null, deadline: null, preview: false, timeouts: 0 };
}

/**
 * Showdown's top-ups when requests come in: a new turn adds the turn's time
 * to every bank (never past the starting time); a request in the middle of
 * a turn for one player (a switch after a KO, U-turn) adds up to 5 s to
 * every bank. The first request after the timer starts adds nothing.
 */
function topUp(meta: BattleMeta, clocks: SideClock[], timer: Timer, freshCount: number, pendingCount: number) {
  if (meta.timerTurn === undefined) {
    meta.timerTurn = meta.turn;
    meta.timerFirst = true;
    return;
  }
  if (meta.turn > meta.timerTurn) {
    meta.timerTurn = meta.turn;
    meta.timerFirst = false;
    const add = turnTopUp(timer, meta.turn);
    for (const c of clocks) c.bank = Math.min(c.bank + add, timer.refill ?? timer.bank);
    return;
  }
  if (freshCount === 1 && pendingCount <= 1) {
    meta.timerFirst = false;
    const add = Math.min(timer.perTurn, 5_000);
    for (const c of clocks) c.bank += add;
  }
}

/** A new request: this turn's deadline, at most the turn cap (the first request's cap on the battle's first) and never past the bank. */
export function startClock(clock: SideClock, now: number, preview: boolean, timer: Timer | null, first = false) {
  if (!timer) return;
  clock.startedAt = now;
  clock.preview = preview;
  const cap = first ? (timer.firstCap ?? timer.cap) : timer.cap;
  clock.deadline = now + Math.max(0, Math.min(clock.bank, cap));
}

/** A choice is in: the time it took comes out of the bank. */
export function stopClock(clock: SideClock, now: number) {
  if (clock.startedAt !== null) clock.bank = Math.max(0, clock.bank - Math.max(0, now - clock.startedAt));
  if (clock.startedAt !== null) clock.timeouts = 0;
  clock.startedAt = null;
  clock.deadline = null;
  clock.preview = false;
}

/** Whether a live battle has a clock run out or a player gone, so a poll must catch it up. */
function overdue(meta: BattleMeta, now: number): boolean {
  if (meta.status !== "playing") return false;
  // The computer still owes a choice (its seats answer at once, unless a long run of them was cut short).
  if (meta.seats.some((s, i) => isCpuSeat(s) && meta.requests[i])) return true;
  if (meta.kind !== "pvp") return false;
  if (meta.seats.some((s, i) => !isCpuSeat(s) && !isOut(meta, i) && now - s.seenAt > BATTLE_AWAY_MS)) return true;
  return (meta.clocks ?? []).some((c) => c.deadline !== null && c.deadline <= now);
}

/**
 * Applies everything due by `now`: a player who's gone forfeits; a clock that
 * ran out plays an explicit choice for that player, or loses the battle.
 */
function catchUp(work: Work, now: number) {
  const meta = work.meta;
  // The computer's owed choices first (a long run of them cut short by the step cap).
  if (meta.status === "playing" && meta.seats.some((s, i) => isCpuSeat(s) && meta.requests[i])) {
    const session = work.session(now);
    if (session) work.absorb(now);
  }
  for (let step = 0; step < 6 && meta.kind === "pvp" && meta.status === "playing"; step++) {
    // Gone the longest first (the computer never goes, and a Free-For-All trainer who's out has nothing left to lose).
    const gone = meta.seats
      .map((s, seat) => ({ seat, at: s.seenAt + BATTLE_AWAY_MS, cpu: isCpuSeat(s) }))
      .filter((g) => !g.cpu && !isOut(meta, g.seat) && g.at < now)
      .sort((a, b) => a.at - b.at)[0];
    if (gone) {
      if (!forceLose(work, gone.seat, "left", now)) return;
      continue;
    }
    const late = (meta.clocks ?? [])
      .map((clock, seat) => ({ clock, seat }))
      .filter(({ clock }) => clock.deadline !== null && clock.deadline <= now)
      .sort((a, b) => a.clock.deadline! - b.clock.deadline!)[0];
    if (!late) return;
    const { clock, seat } = late;
    const timer = timerOf(meta);
    // Both players out of time together: Showdown calls it a tie (two-trainer battles; with four, each trainer out of time loses alone).
    const other = meta.clocks!.length === 2 ? meta.clocks![1 - seat] : null;
    if (meta.timeoutLoses && !timer?.autoChoose && other && other.deadline !== null && other.deadline <= now) {
      work.note("|-message|All players are inactive.");
      if (!forceTie(work, now)) return;
      continue;
    }
    clock.bank = Math.max(0, clock.bank - (clock.deadline! - clock.startedAt!));
    clock.timeouts += 1;
    clock.startedAt = null;
    clock.deadline = null;
    // Showdown's rules: out of time loses, except under the VGC Timer, which makes a default choice while there's time in the bank.
    // Ours, with "lose on timeout" off: the timer plays a move for you, and a second timeout in a row (or an empty bank) loses.
    const strict = meta.timeoutLoses;
    if (strict ? !(timer?.autoChoose && clock.bank > 0) : clock.timeouts >= BATTLE_TIMEOUTS_TO_LOSE || clock.bank <= 0) {
      work.note(`|-message|${meta.seats[seat].name} lost due to inactivity.`);
      if (!forceLose(work, seat, "timeout", now)) return;
      continue;
    }
    // Out of time this turn: the timer plays a sensible, explicit choice.
    const session = work.session(now);
    if (!session) return;
    const side = sideOf(seat);
    const request = session.pending(side);
    if (request && strict) {
      // Showdown's VGC Timer: ">p1 default".
      if (!session.choose(side, "default").ok) {
        if (!forceLose(work, seat, "timeout", now)) return;
        continue;
      }
    } else if (request) {
      const geometry = gameTypeOf(meta);
      const rand = seededRandom(`${meta.seed}:timer:${session.battle.inputLog.length}`);
      let choice = chooseCpu(session.battle, session.side(side)!, "easy", rand);
      if (!session.choose(side, choice).ok) {
        choice = randomChoice(request, geometry, rand);
        if (!session.choose(side, choice).ok) {
          if (!forceLose(work, seat, "timeout", now)) return;
          continue;
        }
      }
    }
    work.absorb(now);
  }
}

/** Nobody wins (Showdown's tie when every player has run out of time). */
function forceTie(work: Work, now: number): boolean {
  const session = work.session(now);
  if (!session) return false;
  work.reason = "timeout";
  session.tie();
  work.absorb(now);
  if (!work.meta.end) endBattle(work.meta, "timeout", [], now);
  return true;
}

/**
 * `seat` loses (forfeit, timeout, disconnect). In a Free-For-All only that
 * trainer is out and the others battle on (the last one standing wins); in
 * a Multi Battle their team loses.
 */
function forceLose(work: Work, seat: number, reason: BattleEndReason, now: number): boolean {
  const session = work.session(now);
  if (!session) return false;
  const ffa = gameTypeOf(work.meta) === "freeforall";
  // A Free-For-All goes on without them: everyone's log says why they're out (a timeout already has its own line).
  if (ffa && reason !== "timeout") work.note(`|-message|${work.meta.seats[seat]?.name ?? "A trainer"} forfeited.`);
  // How the battle ends if this loss ends it (a Free-For-All's last two: the other one wins).
  work.reason = reason;
  session.lose(sideOf(seat));
  if (ffa && !session.ended) {
    // Out, but the battle goes on: the reason belongs to the battle's end, whoever brings it.
    work.reason = null;
  }
  work.absorb(now);
  // The simulator always ends a two-trainer (or Multi) battle on a forced loss; make sure of it.
  if (!work.meta.end && !ffa) endBattle(work.meta, reason, winnersAgainst(work.meta, seat), now);
  return true;
}

// ---------------------------------------------------------------------------
// The computer's turns
// ---------------------------------------------------------------------------

/**
 * Lets the computer answer every request it has on every seat it plays,
 * explicitly. With no trainer left who could still answer anything (a
 * Free-For-All whose trainers are all out), it plays the battle out.
 */
function playCpu(work: Work, session: SimSession) {
  const meta = work.meta;
  const cpus = meta.seats.map((s, i) => (isCpuSeat(s) ? i : -1)).filter((i) => i >= 0);
  if (!cpus.length || session.ended) return;
  const level = meta.cpu?.level ?? "normal";
  const geometry = gameTypeOf(meta);
  const humansLeft = meta.seats.some((s, i) => !isCpuSeat(s) && (session.side(sideOf(i))?.pokemonLeft ?? 0) > 0);
  const limit = humansLeft ? MAX_CPU_STEPS * cpus.length : MAX_CPU_ONLY_STEPS;
  const failures = new Map<number, number>();
  for (let i = 0; i < limit && !session.ended; i++) {
    // Re-read every time: a rejected choice can update the request (a move turned out to be disabled).
    const seat = cpus.find((c) => session.pending(sideOf(c)));
    if (seat === undefined) return;
    // Out of time for this request: the human's answer goes back now, and the next poll plays on.
    if (work.cpuSteps > 0 && performance.now() - work.startedAt > CPU_REQUEST_BUDGET_MS) return;
    work.cpuSteps++;
    const side = sideOf(seat);
    const request = session.pending(side)!;
    const failed = failures.get(seat) ?? 0;
    const rand = seededRandom(`${meta.seed}:cpu${seat === 1 ? "" : seat}:${session.battle.inputLog.length}:${failed}`);
    const choice = failed === 0 ? chooseCpu(session.battle, session.side(side)!, level, rand) : randomChoice(request, geometry, rand);
    if (session.choose(side, choice).ok) {
      failures.set(seat, 0);
      continue;
    }
    if (failed + 1 < 3) {
      failures.set(seat, failed + 1);
      continue;
    }
    // A computer that can't move would stall the battle: it concedes.
    console.error(`[battle] ${meta.code}: the computer (${side}) had no legal choice`);
    if (geometry !== "freeforall") work.reason = "forfeit";
    session.lose(side);
    failures.set(seat, 0);
  }
}

// ---------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------

function blankRecord(meta: BattleMeta): BattleRecord {
  const rec: BattleRecord = { meta, state: null, inputLog: [], logs: { p1: [], p2: [], spectator: [] } };
  if (seatsFor(meta) === 4) Object.assign(rec.logs, { p3: [], p4: [] });
  return rec;
}

function newMeta(code: string, kind: BattleMeta["kind"], format: PlayFormatId, seats: BattleSeat[], now: number, formatid?: string): BattleMeta {
  const meta: BattleMeta = {
    v: 1,
    code,
    kind,
    format,
    status: "lobby",
    simVersion: SIM_VERSION,
    seed: newSeed(),
    createdAt: now,
    seats,
    turn: 0,
    rqid: [0, 0],
    requests: [null, null],
    lines: { p1: 0, p2: 0, spectator: 0 },
  };
  if (formatid) meta.formatid = formatid;
  shape(meta);
  return meta;
}

/** Records the battle's game type, and gives a four-player battle its four sides' counters. */
function shape(meta: BattleMeta) {
  const type = gameTypeOf({ format: meta.format, formatid: meta.formatid });
  if (type === "singles" || type === "doubles") return;
  meta.gameType = type;
  const n = playersFor(type);
  meta.playerCount = n;
  meta.rqid = Array.from({ length: n }, (_, i) => meta.rqid[i] ?? 0);
  meta.requests = Array.from({ length: n }, (_, i) => meta.requests[i] ?? null);
  if (n === 4) meta.lines = { ...meta.lines, p3: meta.lines.p3 ?? 0, p4: meta.lines.p4 ?? 0 };
}

/** Every seat is filled (and ready): the simulator starts the battle. */
function start(work: Work, now: number) {
  const meta = work.meta;
  let teams: string[];
  if ((meta.format === "factory" || meta.format === "bssfactory") && meta.seats.some((s) => !s.team)) {
    // Live Factory: both rental teams from the same tier.
    const style = meta.format === "bssfactory" ? "bss" : "open";
    if (style === "open") meta.factoryTier = pickFactoryTier();
    teams = meta.seats.map((s) => s.team ?? Teams.pack(factoryTeam(style, meta.factoryTier ?? "OU")));
  } else {
    teams = meta.seats.map((s) => (isCpuSeat(s) ? s.team! : seatTeam(meta.format, s.team)));
  }
  const session = SimSession.create({
    formatid: showdownIdOf(meta),
    seed: meta.seed,
    players: meta.seats.map((s, i) => ({ name: s.name, team: teams[i] })),
  });
  work.begin(session);
  meta.status = "playing";
  meta.startedAt = now;
  const timer = timerOf(meta);
  if (meta.kind === "pvp" && timer && !meta.timerOff) meta.clocks = meta.seats.map(() => newClock(timer));
  work.absorb(now);
}

/** A team for a seat in a bring-your-own format (none needed for random formats); custom rules check it against the ruleset. */
export function checkTeam(format: PlayFormatId, team: string | undefined, rules?: CustomRules): Outcome<{ packed?: string }> {
  if (PLAY_FORMAT_INFO[format].random) return { ok: true };
  if (!team?.trim()) return fail(400, `${PLAY_FORMAT_INFO[format].name} needs a team: paste one in Showdown's export format.`);
  if (format === "custom" && !rules) return fail(400, "Custom battles need a ruleset.");
  const checked = rules ? prepareCustomTeam(rules, team) : prepareTeam(format, team);
  return checked.ok ? { ok: true, packed: checked.packed } : fail(400, checked.errors.join(" "));
}

/**
 * Showdown's own format for each of our formats that isn't one of its ids.
 * The Battle Factory plays "[Gen 9] Battle Factory"'s rules (Standard) with
 * the rental teams brought in; the BSS Factory and the Tower play Showdown's
 * formats as they are (Flat Rules).
 */
export const SHOWDOWN_FORMAT: Partial<Record<PlayFormatId, string>> = {
  factory: "gen9customgame@@@Standard,!! Max Team Size = 6,!! Max Move Count = 4,!! Max Level = 100",
  bssfactory: "gen9bssfactory",
  tower: "gen9bssregi",
};

/** The computer's name, never the same as the player's (the simulator tells sides apart by name). */
const cpuName = (player: string) => (player.toLowerCase() === "cpu" ? "Computer" : "CPU");

/** Names for the computer's seats in a four-player battle, none of them a trainer's (the simulator tells sides apart by name). */
function cpuNames(taken: string[], count: number): string[] {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  const out: string[] = [];
  for (let n = 1; out.length < count && n < 99; n++) {
    const name = n === 1 ? "CPU" : `CPU ${n}`;
    if (!used.has(name.toLowerCase())) {
      out.push(name);
      used.add(name.toLowerCase());
    }
  }
  return out;
}

/** A computer seat for a four-player battle, with its team. */
function cpuSeat(name: string, team: string, now: number): BattleSeat {
  return { id: `cpu-${randomId()}`, name, ready: true, seenAt: now, team, cpu: true };
}

/** The computer's team for `format` (custom rules: legal under them). */
function cpuTeamFor(format: PlayFormatId, rules: CustomRules | undefined): string {
  return rules ? customCpuTeam(rules) : cpuTeam(format);
}

/** Custom rules checked by Showdown's format parser: the ruleset and its format id, or the parser's reasons. */
function customFormat(format: PlayFormatId, raw: unknown): Outcome<{ custom?: { rules: CustomRules; formatid: string } }> {
  if (format !== "custom") return { ok: true };
  const checked = checkRules(raw);
  return checked.ok ? { ok: true, custom: { rules: checked.rules, formatid: checked.formatid } } : fail(400, `These rules don't work together: ${checked.errors.join(" ")}`);
}

function applyCustom(meta: BattleMeta, custom: { rules: CustomRules; formatid: string } | undefined) {
  if (!custom) return;
  meta.rules = custom.rules;
  meta.formatid = custom.formatid;
}

export async function createCpuBattle(opts: { name: string; format: PlayFormatId; level: CpuLevel; team?: string; rules?: unknown; player?: string }, now = Date.now()) {
  const custom = customFormat(opts.format, opts.rules);
  if (!custom.ok) return custom;
  const team = checkTeam(opts.format, opts.team, custom.custom?.rules);
  if (!team.ok) return team;
  // A four-player format: the computer plays the other three seats (in a Multi Battle, your partner too).
  const seats = playersFor(gameTypeOf({ format: opts.format, formatid: custom.custom?.formatid }));
  let foeTeams: string[];
  try {
    foeTeams = Array.from({ length: seats - 1 }, () => cpuTeamFor(opts.format, custom.custom?.rules));
  } catch (err) {
    return fail(400, err instanceof Error ? err.message : "Couldn't build the computer's team.");
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = newBattleCode();
    const me: BattleSeat = { id: randomId(), name: opts.name, ready: true, seenAt: now, team: team.packed, ...(opts.player ? { player: opts.player } : {}) };
    const cpus =
      seats === 4
        ? cpuNames([opts.name], 3).map((name, i) => cpuSeat(name, foeTeams[i], now))
        : [{ id: CPU_SEAT_ID, name: cpuName(opts.name), ready: true, seenAt: now, team: foeTeams[0] } satisfies BattleSeat];
    const meta = newMeta(code, "cpu", opts.format, [me, ...cpus], now, custom.custom?.formatid);
    applyCustom(meta, custom.custom);
    meta.cpu = { level: opts.level };
    const work = new Work(blankRecord(meta));
    start(work, now);
    if (!(await insertBattle(work.rec))) continue;
    remember(code, work.rec, 0);
    return { ok: true as const, code, token: battleToken(code, me.id, 0), view: battleView(work.rec.meta, me.id, work.rec.logs.p1, 0, now, 0) };
  }
  return fail(503, "Couldn't start a battle. Try again.");
}

/**
 * A Battle Frontier battle against the computer: both teams come from the
 * run (already checked when the run started, or generated by the server).
 */
export async function createRunBattle(
  opts: { name: string; format: PlayFormatId; level: CpuLevel; team: string; foe: string; foeName?: string; frontier: NonNullable<BattleMeta["frontier"]> },
  now = Date.now()
) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = newBattleCode();
    const me: BattleSeat = { id: randomId(), name: opts.name, ready: true, seenAt: now, team: opts.team };
    const foeName = opts.foeName && opts.foeName.toLowerCase() !== opts.name.toLowerCase() ? opts.foeName : cpuName(opts.name);
    const cpu: BattleSeat = { id: CPU_SEAT_ID, name: foeName, ready: true, seenAt: now, team: opts.foe };
    const meta = newMeta(code, "cpu", opts.format, [me, cpu], now);
    meta.cpu = { level: opts.level };
    meta.frontier = opts.frontier;
    const work = new Work(blankRecord(meta));
    start(work, now);
    if (!(await insertBattle(work.rec))) continue;
    remember(code, work.rec, 0);
    return { ok: true as const, code, token: battleToken(code, me.id, 0) };
  }
  return fail(503, "Couldn't start a battle. Try again.");
}

/**
 * A friend battle with an invite link. Private unless the host lets anyone
 * watch (then it's listed in the Watch lobby); `timer: false` starts it with
 * the turn timer off, for either player to start; `timeoutLoses`: running
 * out the clock once loses at once (Showdown's rule), instead of the timer
 * playing a move and a second timeout losing.
 */
export async function createLiveBattle(
  opts: { name: string; format: PlayFormatId; team?: string; rules?: unknown; public?: boolean; hidden?: boolean; timer?: boolean; timeoutLoses?: boolean; player?: string },
  now = Date.now()
) {
  const custom = customFormat(opts.format, opts.rules);
  if (!custom.ok) return custom;
  const team = checkTeam(opts.format, opts.team, custom.custom?.rules);
  if (!team.ok) return team;
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = newBattleCode();
    const me: BattleSeat = { id: randomId(), name: opts.name, ready: false, seenAt: now, team: team.packed };
    if (opts.player) me.player = opts.player;
    const rec = blankRecord(newMeta(code, "pvp", opts.format, [me], now, custom.custom?.formatid));
    applyCustom(rec.meta, custom.custom);
    if (opts.hidden) rec.meta.hidden = true;
    else if (opts.public) rec.meta.public = true;
    if (opts.timer === false) rec.meta.timerOff = true;
    if (opts.timeoutLoses) rec.meta.timeoutLoses = true;
    if (!(await insertBattle(rec))) continue;
    return { ok: true as const, code, token: battleToken(code, me.id, 0), view: battleView(rec.meta, me.id, [], 0, now, 0) };
  }
  return fail(503, "Couldn't open a battle. Try again.");
}

/**
 * A live battle for two trainers matchmaking paired: both seated and ready,
 * so it's under way at once (no lobby). Teams, in bring-your-own formats,
 * were checked before either joined the queue. Seat 0 is the trainer who
 * was waiting. Null if no code was free.
 */
export interface MatchedPlayer {
  name: string;
  team?: string;
  /** Ladder key (server-side only). */
  player?: string;
  /** Ranked: the rating they queued with (Glicko-2, with their Elo). */
  rating?: { rating: number; games: number; elo?: number };
}

export async function createMatchedBattle(
  format: PlayFormatId,
  players: [MatchedPlayer, MatchedPlayer],
  now = Date.now(),
  opts: { ranked?: boolean; tournament?: { id: string; graceMs: number } } = {}
): Promise<{ code: string; ids: [string, string]; seenAt: number } | null> {
  // A tournament match waits longer for a trainer to turn up: they're told by a toast, not sitting in a queue.
  const seenAt = now + (opts.tournament?.graceMs ?? 0);
  // A four-player format: the two trainers matched face each other (opposite teams in a Multi Battle), and the computer fills the other two seats.
  const four = playersFor(gameTypeOf({ format })) === 4;
  let cpuTeams: string[] = [];
  if (four) {
    try {
      cpuTeams = [cpuTeam(format), cpuTeam(format)];
    } catch (err) {
      console.error("[battle] couldn't build the computer's teams:", err);
      return null;
    }
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = newBattleCode();
    const humans = players.map((p) => {
      const seat: BattleSeat = { id: randomId(), name: p.name, ready: true, seenAt, team: p.team };
      if (p.player) seat.player = p.player;
      if (opts.ranked && p.rating) seat.rating = { rating: p.rating.rating, games: p.rating.games, ...(p.rating.elo !== undefined ? { elo: p.rating.elo } : {}) };
      return seat;
    });
    const seats = four ? [...humans, ...cpuNames(humans.map((h) => h.name), 2).map((name, i) => cpuSeat(name, cpuTeams[i], now))] : humans;
    const work = new Work(blankRecord(newMeta(code, "pvp", format, seats, now)));
    if (four) work.meta.cpu = { level: "normal" };
    // Matchmade battles are open to spectators, like Showdown's ladder.
    work.meta.public = true;
    if (opts.ranked && !four) work.meta.ranked = true;
    if (opts.tournament) work.meta.tournament = opts.tournament.id;
    work.meta.chat = systemLine(
      undefined,
      four
        ? `Matched: ${seats[0].name} and ${seats[1].name}, with the computer in the other two seats. Good luck!`
        : `${opts.tournament ? "Tournament match" : "Matched"}: ${seats[0].name} vs ${seats[1].name}. Good luck!`,
      now
    );
    start(work, now);
    if (await insertBattle(work.rec)) return { code, ids: [humans[0].id, humans[1].id], seenAt };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reading and changing
// ---------------------------------------------------------------------------

/**
 * Read, change, compare-and-swap, and on a clash start over from a fresh
 * read. `change` gets a working copy and the time; the copy is saved if it
 * changed (even when `change` reports a rejected choice, since the simulator
 * may have learned something). Exported for tests.
 */
export async function updateBattle<T extends object>(
  code: string,
  change: (work: Work, now: number) => Outcome<T>
): Promise<Outcome<T & { rec: BattleRecord; now: number; rev: number }>> {
  const startedAt = performance.now();
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    if (attempt > 0) await sleep(Math.random() * CAS_JITTER_MS * attempt);
    const loaded = (attempt === 0 && recalled(code)) || (await loadBattle(code));
    if (!loaded) return fail(404, "This battle has ended or never existed.");
    const now = Date.now();
    const work = new Work(loaded.rec, startedAt);
    const out = change(work, now);
    if (!out.ok) return out;
    if (!work.changed) return { ...out, rec: work.rec, now, rev: loaded.version };
    if (await saveBattle(code, loaded.version, work.patch())) {
      remember(code, work.rec, loaded.version + 1);
      return { ...out, rec: work.rec, now, rev: loaded.version + 1 };
    }
    // Someone else saved first (or this copy was stale): start over from the store.
    recent.delete(code);
  }
  return fail(503, "The battle is busy. Try again.");
}

/**
 * The record as this server instance last saved it, by code. The next change
 * that lands here (most of a battle's turns do) starts from it instead of
 * reading the store; the compare-and-swap in saveBattle catches a copy that
 * another instance has moved past, and the read happens then. Kept as JSON
 * with the store's key order, as the in-memory store does, so a recalled
 * record is exactly what a read would give.
 */
const recent = new Map<string, { json: string; version: number; at: number }>();
const RECENT_MS = 10 * 60_000;
const RECENT_MAX = 100;

function remember(code: string, rec: BattleRecord, version: number) {
  recent.delete(code);
  if (recent.size >= RECENT_MAX) recent.delete(recent.keys().next().value as string);
  recent.set(code, { json: JSON.stringify({ ...rec, meta: jsonbOrder(rec.meta) }), version, at: Date.now() });
}

/** A poll's light save (meta only) keeps the remembered record current, so the next turn can still start from it. */
function rememberMeta(code: string, version: number, meta: BattleMeta) {
  const kept = recent.get(code);
  if (!kept || kept.version !== version) return;
  const rec = JSON.parse(kept.json) as BattleRecord;
  remember(code, { ...rec, meta }, version + 1);
}

function recalled(code: string): { rec: BattleRecord; version: number } | null {
  const kept = recent.get(code);
  if (!kept) return null;
  if (Date.now() - kept.at > RECENT_MS) {
    recent.delete(code);
    return null;
  }
  return { rec: JSON.parse(kept.json) as BattleRecord, version: kept.version };
}

/** Tests: forget every remembered record, so a test starts from the store. */
export function forgetRecentBattles() {
  recent.clear();
}

/**
 * The tick's catch-up for one battle: whatever is due by now (a clock out, a
 * trainer gone, the computer owing a choice) is played, through the same
 * compare-and-swap as a poll, without marking anyone as here. Nothing due:
 * nothing is written.
 */
export async function catchUpBattle(code: string): Promise<Outcome<{ rec: BattleRecord; now: number; rev: number }>> {
  // From the store, not this instance's remembered copy: the tick finds a battle by its stored next_deadline, and a copy that
  // another instance moved past might show nothing due, which would end the catch-up without the compare-and-swap ever noticing.
  recent.delete(code);
  return updateBattle(code, (work, now) => {
    if (overdue(work.meta, now)) catchUp(work, now);
    return { ok: true };
  });
}

/** A poll: marks the player as here, catches the battle up and returns their view from line `since`. */
export async function pollBattle(code: string, token: unknown, since: number, viewer: string | null = null): Promise<Outcome<{ view: BattleView }>> {
  const seatToken = readBattleToken(token, code);
  const playerId = seatToken?.playerId ?? null;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    // A guess at the channel (the seat in the token, else the spectators'), checked against the seats below.
    const guess: BattleChannel = seatToken ? channelOf(seatToken.seat) : "spectator";
    let lite = await loadBattleMeta(code, guess);
    if (!lite) return fail(404, "This battle has ended or never existed.");
    const seat = seatIndex(lite.meta, playerId);
    if (seat < 0 && lite.meta.hidden && lite.meta.status !== "finished") return fail(403, "This battle doesn't allow spectators.");
    const channel = channelFor(lite.meta, seat);
    if (channel !== guess) {
      lite = await loadBattleMeta(code, channel);
      if (!lite) return fail(404, "This battle has ended or never existed.");
      // The seats changed in between: start over, so a channel only ever reaches its own viewer.
      if (seatIndex(lite.meta, playerId) !== seat) continue;
    }
    const now = Date.now();
    if (overdue(lite.meta, now)) {
      // Something is due that needs the simulator: the full path.
      const out = await updateBattle(code, (work, at) => {
        touch(work.meta, playerId, at);
        catchUp(work, at);
        return { ok: true };
      });
      if (!out.ok) return out;
      const s = seatIndex(out.rec.meta, playerId);
      return { ok: true, view: battleView(out.rec.meta, playerId, viewerLog(out.rec, s), since, out.now, out.rev) };
    }
    const meta = structuredClone(lite.meta);
    if (seat < 0) {
      // A spectator: counted with one try (a clash waits for their next poll), never blocking the players.
      if (touchWatcher(meta, viewer, now) && (await saveBattle(code, lite.version, { meta }))) {
        rememberMeta(code, lite.version, meta);
        return { ok: true, view: battleView(meta, playerId, lite.log, since, now, lite.version + 1) };
      }
      return { ok: true, view: battleView(lite.meta, playerId, lite.log, since, now, lite.version) };
    }
    if (!touch(meta, playerId, now)) return { ok: true, view: battleView(meta, playerId, lite.log, since, now, lite.version) };
    if (await saveBattle(code, lite.version, { meta })) {
      rememberMeta(code, lite.version, meta);
      return { ok: true, view: battleView(meta, playerId, lite.log, since, now, lite.version + 1) };
    }
  }
  return fail(503, "The battle is busy. Try again.");
}

/**
 * A chat message from a seated player in a live battle (checked and masked in
 * chat.ts). Only the battle's meta changes, so it's a light compare-and-swap
 * like a poll's; the answer is the player's view from line `since`.
 */
export async function chatBattle(code: string, playerId: string, text: string, since: number): Promise<Outcome<{ view: BattleView }>> {
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const lite = await loadBattleMeta(code, null);
    if (!lite) return fail(404, "This battle has ended or never existed.");
    const seat = seatIndex(lite.meta, playerId);
    if (seat < 0) return fail(403, "Only the trainers in this battle can chat.");
    if (lite.meta.kind !== "pvp") return fail(400, "There's no one to chat with here.");
    if (lite.meta.rematch) return fail(409, "The chat moved to the rematch: press Rematch to keep chatting.");
    const now = Date.now();
    const meta = structuredClone(lite.meta);
    const out = postChat(meta.chat, seat, meta.seats[seat].name, text, now);
    if (!out.ok) return out;
    meta.chat = out.chat;
    touch(meta, playerId, now);
    if (await saveBattle(code, lite.version, { meta })) {
      rememberMeta(code, lite.version, meta);
      const mine = await loadBattleMeta(code, channelOf(seat));
      return { ok: true, view: battleView(meta, playerId, mine?.log ?? [], since, now, lite.version + 1) };
    }
  }
  return fail(503, "The battle is busy. Try again.");
}

/** Marks a player as here, and drops players who left a lobby. True if anything changed. */
function touch(meta: BattleMeta, playerId: string | null, now: number): boolean {
  let changed = false;
  const seat = meta.seats.find((s) => s.id === playerId);
  // A tournament records that the trainer turned up for their match.
  // (Seen a moment later than a trainer who never came, so if both go quiet the no-show loses first.)
  if (seat && meta.tournament && seat.arrived === undefined && meta.status !== "finished") {
    seat.arrived = now;
    seat.seenAt = Math.max(seat.seenAt + 1, now);
    changed = true;
  }
  // After the end nobody can time out, and the computer's battles don't track presence.
  if (seat && meta.status !== "finished" && meta.kind === "pvp" && now - seat.seenAt >= SEEN_STEP_MS) {
    seat.seenAt = now;
    changed = true;
  }
  if (meta.status === "lobby") {
    const here = meta.seats.filter((s) => isCpuSeat(s) || now - s.seenAt <= PVP_AWAY_MS);
    if (here.length < meta.seats.length) {
      meta.seats = here;
      changed = true;
    }
  }
  return changed;
}

export type BattleAction =
  | { action: "join"; name: string; team?: string; player?: string }
  | { action: "ready"; ready: boolean }
  /** A four-player room's host: the computer takes every empty seat, and the battle starts once the trainers are ready. */
  | { action: "fill"; level?: CpuLevel }
  | { action: "team"; team: string }
  | { action: "choose"; rqid: number; choice: string }
  | { action: "forfeit" }
  | { action: "timer"; on?: boolean }
  | { action: "undo"; rqid: number };

/** An action by a player. `join` has no seat yet; everything else needs `playerId`. */
export async function actOnBattle(
  code: string,
  playerId: string | null,
  body: BattleAction,
  since: number
): Promise<Outcome<{ view: BattleView; playerId: string; rejected?: string }>> {
  // Teams are validated once, outside the compare-and-swap loop.
  let packed: string | undefined;
  if ((body.action === "join" && body.team !== undefined) || body.action === "team") {
    const lite = await loadBattleMeta(code, null);
    if (!lite) return fail(404, "This battle has ended or never existed.");
    const team = checkTeam(lite.meta.format, body.team, lite.meta.rules);
    if (!team.ok) return team;
    packed = team.packed;
  }

  let joined: string | null = null;
  const out = await updateBattle<{ rejected?: string }>(code, (work, now) => {
    const meta = work.meta;
    touch(meta, playerId, now);
    catchUp(work, now);

    if (body.action === "join") {
      if (meta.kind !== "pvp" || meta.status !== "lobby") return fail(409, "This battle has already started.");
      if (meta.seats.length >= seatsFor(meta)) return fail(409, "This battle is full.");
      if (meta.seats.some((s) => s.name.toLowerCase() === body.name.toLowerCase())) return fail(409, `${body.name} is already in this battle. Pick another name.`);
      if (!PLAY_FORMAT_INFO[meta.format].random && !packed) return fail(400, `${PLAY_FORMAT_INFO[meta.format].name} needs a team: paste one in Showdown's export format.`);
      joined = randomId();
      meta.seats.push({ id: joined, name: body.name, ready: false, seenAt: now, team: packed, ...(body.player ? { player: body.player } : {}) });
      meta.chat = systemLine(meta.chat, `${body.name} joined`, now);
      return { ok: true };
    }

    const seat = seatIndex(meta, playerId);
    if (seat < 0) return fail(403, "You're not in this battle.");
    switch (body.action) {
      case "ready": {
        if (meta.status !== "lobby") return fail(409, "The battle has already started.");
        if (body.ready && !PLAY_FORMAT_INFO[meta.format].random && !meta.seats[seat].team) return fail(400, "Bring a team first.");
        meta.seats[seat].ready = body.ready;
        if (meta.seats.length === seatsFor(meta) && meta.seats.every((s) => s.ready)) start(work, now);
        return { ok: true };
      }
      case "fill": {
        if (meta.status !== "lobby") return fail(409, "The battle has already started.");
        if (seatsFor(meta) !== 4) return fail(400, "Only four-player battles have seats for the computer.");
        if (seat !== 0) return fail(403, "Only the trainer who opened the battle can fill the seats.");
        const empty = seatsFor(meta) - meta.seats.length;
        if (empty <= 0) return fail(409, "Every seat is taken.");
        let teams: string[];
        try {
          teams = Array.from({ length: empty }, () => cpuTeamFor(meta.format, meta.rules));
        } catch (err) {
          return fail(400, err instanceof Error ? err.message : "Couldn't build the computer's team.");
        }
        const names = cpuNames(meta.seats.map((s) => s.name), empty);
        meta.seats.push(...names.map((name, i) => cpuSeat(name, teams[i], now)));
        meta.cpu = { level: body.level ?? meta.cpu?.level ?? "normal" };
        meta.chat = systemLine(meta.chat, empty === 1 ? `${names[0]} (the computer) took the last seat` : `The computer took ${empty} seats: ${names.join(", ")}`, now);
        if (!PLAY_FORMAT_INFO[meta.format].random && !meta.seats[0].team) meta.seats[0].ready = false;
        else meta.seats[0].ready = true;
        if (meta.seats.every((s) => s.ready)) start(work, now);
        return { ok: true };
      }
      case "team": {
        if (meta.status !== "lobby") return fail(409, "The battle has already started.");
        meta.seats[seat].team = packed;
        meta.seats[seat].ready = false;
        return { ok: true };
      }
      case "forfeit": {
        if (meta.status === "lobby") meta.seats.splice(seat, 1);
        else if (meta.status === "playing" && !isOut(meta, seat)) forceLose(work, seat, "forfeit", now);
        return { ok: true };
      }
      case "choose":
        return choose(work, seat, body.rqid, body.choice, now);
      case "timer":
        return setTimer(work, seat, body.on !== false, now);
      case "undo":
        return undoChoice(work, seat, body.rqid, now);
    }
  });
  if (!out.ok) return out;
  const me = joined ?? playerId!;
  const seat = seatIndex(out.rec.meta, me);
  const view = battleView(out.rec.meta, me, seat >= 0 ? (out.rec.logs[channelOf(seat)] ?? []) : [], joined ? 0 : since, out.now, out.rev);
  return { ok: true, view, playerId: me, rejected: out.rejected };
}

/** Showdown won't let a player turn the timer back on this soon after turning it off. */
const TIMER_COOLDOWN_MS = 20_000;

/**
 * Showdown's /timer on and /timer off. A battle can start with the timer on
 * (the host's setting: it then stays on) or off, for either player to ask
 * for it. Asking turns it on for both ("Battle timer is ON..."); a second
 * ask is noted; only the players who asked can turn it off again, and it
 * stays on while anyone still wants it.
 */
function setTimer(work: Work, seat: number, on: boolean, now: number): Outcome<{ rejected?: string }> {
  const meta = work.meta;
  if (meta.kind !== "pvp" || meta.status !== "playing") return fail(409, "The timer only runs while a live battle is under way.");
  const timer = timerOf(meta);
  if (!timer) return { ok: true };
  const name = meta.seats[seat].name;
  const requesters = meta.timerRequesters ?? [];
  if (on) {
    if (requesters.includes(seat)) return { ok: true };
    if (!meta.timerOff) {
      if (requesters.length) {
        meta.timerRequesters = [...requesters, seat];
        work.note(`|inactive|${name} also wants the timer to be on.`);
      }
      return { ok: true };
    }
    const off = meta.timerOffBy;
    if (off && off.seat === seat && now - off.at < TIMER_COOLDOWN_MS) {
      return { ok: true, rejected: `The timer can't be re-enabled so soon after disabling it (${Math.ceil((off.at + TIMER_COOLDOWN_MS - now) / 1000)} seconds remaining).` };
    }
    meta.timerOff = false;
    meta.timerRequesters = [seat];
    meta.timerTurn = undefined;
    meta.timerFirst = undefined;
    meta.clocks = meta.seats.map(() => newClock(timer));
    work.note(`|inactive|Battle timer is ON: inactive players will automatically lose when time's up. (requested by ${name})`);
    const pending = meta.requests.map((r, s: number) => (r && !isCpuSeat(meta.seats[s]) ? s : -1)).filter((s) => s >= 0);
    if (pending.length) topUp(meta, meta.clocks, timer, pending.length, pending.length);
    for (const s of pending) startClock(meta.clocks[s], now, !!meta.requests[s]!.teamPreview, timer, !!meta.timerFirst);
    return { ok: true };
  }
  if (meta.timerOff || !requesters.includes(seat)) return { ok: true, rejected: "Only a player who asked for the timer can turn it off." };
  const rest = requesters.filter((s) => s !== seat);
  meta.timerRequesters = rest;
  meta.timerOffBy = { seat, at: now };
  if (rest.length) {
    work.note(`|inactive|${name} no longer wants the timer on, but the timer is staying on because ${rest.map((s: number) => meta.seats[s].name).join(", ")} still does.`);
    return { ok: true };
  }
  meta.timerOff = true;
  delete meta.clocks;
  work.note("|inactiveoff|Battle timer is now OFF.");
  return { ok: true };
}

function choose(work: Work, seat: number, rqid: number, choice: string, now: number): Outcome<{ rejected?: string }> {
  const meta = work.meta;
  if (meta.status === "lobby") return fail(409, "The battle hasn't started yet.");
  if (meta.status === "finished") return fail(409, "The battle is over.");
  if (!meta.requests[seat]) return fail(409, "Nothing to choose right now: waiting for your opponent.");
  if (rqid !== meta.rqid[seat]) return fail(409, "That choice is out of date. The battle has moved on.");
  const session = work.session(now);
  if (!session) return fail(409, "This battle couldn't continue.");
  const side: PlayerSide = sideOf(seat);
  const result = session.choose(side, choice);
  // The computer's seats answer in absorb.
  work.absorb(now);
  return result.ok ? { ok: true } : { ok: true, rejected: result.error };
}

/**
 * Cancel: takes back a choice the opponent hasn't answered yet (Showdown's
 * /undo). `rqid` is the request the choice answered, so a cancel that
 * arrives after the turn has moved on is refused. The clock picks up where
 * it stopped: no fresh turn allowance for cancelling.
 */
function undoChoice(work: Work, seat: number, rqid: number, now: number): Outcome<{ rejected?: string }> {
  const meta = work.meta;
  if (meta.kind !== "pvp" || meta.status !== "playing") return fail(409, "There's nothing to cancel.");
  const side: PlayerSide = sideOf(seat);
  if (meta.requests[seat] || !meta.chosen?.[side]) return fail(409, "There's nothing to cancel.");
  if (rqid !== meta.rqid[seat]) return fail(409, "Too late to cancel: the next turn has already started.");
  const clock = meta.clocks?.[seat];
  const bank = clock?.bank;
  const session = work.session(now);
  if (!session) return fail(409, "This battle couldn't continue.");
  const result = session.undo(side);
  work.absorb(now);
  const timer = timerOf(meta);
  if (clock && bank !== undefined && timer && meta.requests[seat] && !clock.preview) {
    clock.bank = bank;
    clock.startedAt = now;
    clock.deadline = now + Math.min(bank, timer.cap);
  }
  return result.ok ? { ok: true } : { ok: true, rejected: result.error };
}

/**
 * "Don't allow spectators" for a matched battle, from either trainer: it
 * leaves the Watch lobby, nobody can spectate it while it's played, and
 * its replay is kept unlisted.
 */
export async function hideBattle(code: string, playerId: string): Promise<Outcome<object>> {
  const out = await updateBattle(code, (work) => {
    if (seatIndex(work.meta, playerId) < 0) return fail(403, "You're not in this battle.");
    work.meta.hidden = true;
    work.meta.public = false;
    return { ok: true };
  });
  return out.ok ? { ok: true } : out;
}

/** Pressing Rematch after a live battle: the first player opens it, both take their seats in it, ready. */
export async function rematchBattle(code: string, playerId: string): Promise<Outcome<{ code: string; token: string; view: BattleView }>> {
  const loaded = await loadBattleMeta(code, null);
  if (!loaded) return fail(404, "This battle has ended or never existed.");
  const old = loaded.meta;
  const mySeat = seatIndex(old, playerId);
  if (mySeat < 0) return fail(403, "You're not in this battle.");
  if (old.kind !== "pvp") return fail(400, "Start a new battle against the computer instead.");
  if (old.status !== "finished") return fail(409, "The battle isn't over yet.");

  let next = old.rematch;
  if (!next) {
    let opened: string | null = null;
    for (let attempt = 0; attempt < 4 && !opened; attempt++) {
      const now = Date.now();
      // The computer's seats come along, ready (with fresh teams in random formats).
      const seats = old.seats.map((s) =>
        isCpuSeat(s)
          ? { ...s, ready: true, seenAt: now, team: PLAY_FORMAT_INFO[old.format].random && !old.rules ? cpuTeam(old.format) : s.team }
          : { id: s.id, name: s.name, ready: false, seenAt: now, team: s.team, ...(s.player ? { player: s.player } : {}) }
      );
      const fresh = newMeta(newBattleCode(), "pvp", old.format, seats, now, old.formatid);
      if (old.cpu) fresh.cpu = old.cpu;
      if (old.rules && old.formatid) applyCustom(fresh, { rules: old.rules, formatid: old.formatid });
      // A rematch is a friendly (never ranked), listed for watching if the first battle was.
      if (old.public) fresh.public = true;
      if (old.hidden) fresh.hidden = true;
      if (old.timerOff) fresh.timerOff = true;
      if (old.timeoutLoses) fresh.timeoutLoses = true;
      // The chat carries on into the rematch.
      if (old.chat?.length) fresh.chat = old.chat;
      if (await insertBattle(blankRecord(fresh))) opened = fresh.code;
    }
    if (!opened) return fail(503, "Couldn't open a rematch. Try again.");
    const linked = await updateBattle(code, (work) => {
      if (!work.meta.rematch) work.meta.rematch = opened!;
      return { ok: true };
    });
    if (!linked.ok) return linked;
    next = linked.rec.meta.rematch!;
  }

  const me = old.seats[mySeat];
  const out = await updateBattle(next, (work, now) => {
    const meta = work.meta;
    touch(meta, playerId, now);
    let seat = seatIndex(meta, playerId);
    if (meta.status !== "lobby") return seat >= 0 ? { ok: true } : fail(409, "The rematch has already started.");
    if (seat < 0) {
      if (meta.seats.length >= seatsFor(meta)) return fail(409, "The rematch is full.");
      // Everyone takes the seat they had (the computer's seats are already in theirs).
      const at = Math.min(mySeat, meta.seats.length);
      meta.seats.splice(at, 0, { id: me.id, name: me.name, ready: false, seenAt: now, team: me.team, ...(me.player ? { player: me.player } : {}) });
      seat = at;
    }
    meta.seats[seat].seenAt = now;
    meta.seats[seat].ready = true;
    if (meta.seats.length === seatsFor(meta) && meta.seats.every((s) => s.ready)) start(work, now);
    return { ok: true };
  });
  if (!out.ok) return out;
  const seat = seatIndex(out.rec.meta, playerId);
  return {
    ok: true,
    code: next,
    token: battleToken(next, playerId, Math.max(0, seat)),
    view: battleView(out.rec.meta, playerId, viewerLog(out.rec, seat), 0, out.now, out.rev),
  };
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/**
 * What one player (or a visitor: null) may see: their own channel from line
 * `since`, their own request, both clocks. Never the state, the input log,
 * the seed, the other channel or anyone's team.
 */
export function battleView(meta: BattleMeta, playerId: string | null, log: string[], since: number, now: number, rev: number): BattleView {
  const seat = seatIndex(meta, playerId);
  const you = seat >= 0 && seat <= 3 ? seat : null;
  // `log` is the viewer's own channel (channelFor): a spectator's is the spectator channel; a visitor to a computer battle has none.
  const visible = channelFor(meta, seat) ? log : [];
  const total = visible.length;
  const from = since >= 0 && since <= total ? since : 0;
  const request = you !== null && meta.requests[you] ? { rqid: meta.rqid[you], data: meta.requests[you]! } : null;
  const gameType = gameTypeOf(meta);
  const view: BattleView = {
    code: meta.code,
    kind: meta.kind,
    format: meta.format,
    status: meta.status,
    now,
    rev,
    you,
    gameType,
    players: meta.seats.map((s, i) => {
      const cpu = isCpuSeat(s);
      const out = meta.out?.find((o) => o.seat === i);
      return {
        name: s.name,
        ready: s.ready,
        quiet: !cpu && meta.kind === "pvp" && meta.status !== "finished" && now - s.seenAt > (meta.status === "lobby" ? 10_000 : BATTLE_QUIET_MS),
        hasTeam: PLAY_FORMAT_INFO[meta.format].random || !!s.team,
        ...(cpu && seatsFor(meta) === 4 ? { cpu: true } : {}),
        ...(out ? { out: out.turn } : {}),
        ...(meta.ranked && s.rating ? { rating: s.rating.rating, games: s.rating.games, ...(s.rating.elo !== undefined ? { elo: s.rating.elo } : {}) } : {}),
      };
    }),
    turn: meta.turn,
    log: { from, total, lines: visible.slice(from) },
    request,
    waiting: you !== null && meta.status === "playing" && !request,
  };
  // Chosen, and the opponent hasn't: the choice can still be taken back (live battles; the computer answers at once).
  if (you !== null && !request && meta.kind === "pvp" && meta.status === "playing" && meta.chosen?.[sideOf(you)]) view.cancel = { rqid: meta.rqid[you] };
  if (meta.cpu) view.cpu = { level: meta.cpu.level };
  if (meta.clocks && you !== null) {
    const clock = (c: SideClock) => ({ bank: c.bank, deadline: c.deadline, startedAt: c.startedAt });
    // "Foe": the opponent in a two-trainer battle; with four, the trainer (not the computer) whose choice is due soonest.
    const others = meta.clocks.map((c, i) => ({ c, i })).filter(({ i }) => i !== you && !isCpuSeat(meta.seats[i]));
    const foe = others.length === 1 ? others[0] : (others.filter(({ c }) => c.deadline !== null).sort((a, b) => a.c.deadline! - b.c.deadline!)[0] ?? others[0]);
    view.clocks = { you: clock(meta.clocks[you]), foe: clock((foe ?? { c: meta.clocks[1 - Math.min(1, you)] }).c) };
    if (meta.clocks.length === 4) view.clocks.seats = meta.clocks.map((c, i) => (isCpuSeat(meta.seats[i]) ? null : clock(c)));
  }
  if (meta.end) view.end = meta.end;
  if (meta.rematch) view.rematch = meta.rematch;
  if (meta.kind === "pvp" && meta.chat?.length) view.chat = meta.chat;
  if (meta.rules) {
    view.rules = meta.rules;
    view.formatName = customName(meta.rules);
  }
  if (meta.kind === "pvp") {
    view.timer = meta.timerOff ? null : timerOf(meta);
    if (meta.timeoutLoses) view.timeoutLoses = true;
    if (meta.timerOff && meta.status === "playing" && timerOf(meta)) view.timerStartable = true;
    if (!meta.timerOff && you !== null && meta.status === "playing" && meta.timerRequesters?.includes(you)) view.timerStoppable = true;
    view.spectators = spectatorCount(meta, now);
    if (meta.public) view.public = true;
    if (meta.ranked) view.ranked = true;
    if (meta.tournament) view.tournament = meta.tournament;
    if (meta.settled) {
      view.settled = true;
      if (meta.settled.ratings) view.ratings = meta.settled.ratings;
    }
  }
  if (meta.replay) view.replay = meta.replay;
  if (meta.startedAt) view.startedAt = meta.startedAt;
  if (meta.frontier) view.frontier = meta.frontier.info;
  if (meta.factoryTier) view.formatName = `${PLAY_FORMAT_INFO[meta.format].name} · ${meta.factoryTier}`;
  else if (meta.frontier?.info.tier) view.formatName = `${PLAY_FORMAT_INFO[meta.format].name} · ${meta.frontier.info.tier}`;
  return view;
}

