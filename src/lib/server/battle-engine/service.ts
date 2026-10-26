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
} from "@/lib/battle/play";
import { PVP_AWAY_MS } from "@/lib/pvp-types";
import { SIDES, SIM_VERSION, SimReplayError, SimSession, newSeed, seatOfSide, sideOf, type SideID } from "./engine";
import { chooseCpu, seededRandom } from "./cpu";
import { randomChoice } from "./choices";
import { cpuTeam, factoryTeam, pickFactoryTier, prepareTeam, seatTeam } from "./teams";
import { checkRules, customCpuTeam, prepareCustomTeam } from "./custom";
import { Dex, Teams } from "pokemon-showdown";
import { customName, customTimer, type CustomRules } from "@/lib/battle/custom-rules";
import {
  insertBattle,
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
 * As with duels, nothing runs on a timer: every poll or action catches the
 * battle up. A player whose clock ran out gets an explicit choice played
 * for them (two in a row, or an empty bank, loses); a player who stopped
 * polling forfeits. Every change is read-modify-compare-and-swap on the
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
/** The computer never needs more than a couple of choices in a row; a cap keeps a bug from spinning. */
const MAX_CPU_STEPS = 8;
const CPU_SEAT_ID = "cpu";

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
  return t && t.d === code && typeof t.p === "string" ? { playerId: t.p, seat: t.s === 1 ? 1 : 0 } : null;
}

const seatIndex = (meta: BattleMeta, playerId: string | null) => (playerId ? meta.seats.findIndex((s) => s.id === playerId) : -1);
const channelOf = (seat: number): BattleChannel => (seat === 0 ? "p1" : "p2");

/**
 * The one channel a viewer may read: a seated player's own, and for anyone
 * else watching a live battle the spectator channel (what Showdown's
 * spectators see: no request, no hidden set, HP in percent). Nothing for a
 * visitor to a battle against the computer.
 */
export function channelFor(meta: Pick<BattleMeta, "kind">, seat: number): BattleChannel | null {
  if (seat === 0 || seat === 1) return channelOf(seat);
  return meta.kind === "pvp" ? "spectator" : null;
}

const viewerLog = (rec: BattleRecord, seat: number) => {
  const channel = channelFor(rec.meta, seat);
  return channel ? rec.logs[channel] : [];
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
  private sim: { session: SimSession; before: [object | null, object | null] } | null = null;
  /** Why the battle is about to end, when a forfeit, timeout or disconnect ends it. */
  reason: BattleEndReason | null = null;

  constructor(rec: BattleRecord) {
    this.rec = structuredClone(rec);
    this.before = JSON.stringify(rec.meta);
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
    if (this.logsChanged.size) patch.logs = Object.fromEntries([...this.logsChanged].map((ch) => [ch, this.rec.logs[ch]]));
    return patch;
  }

  /** The simulator, restored once per request; null if the battle can't be restored (it then ends as no contest). */
  session(now: number): SimSession | null {
    if (this.sim) return this.sim.session;
    if (!this.rec.state) return null;
    try {
      const session = SimSession.restore({ simVersion: this.meta.simVersion, state: this.rec.state, inputLog: this.rec.inputLog, chosen: this.meta.chosen });
      this.sim = { session, before: [session.requestObject("p1"), session.requestObject("p2")] };
      return session;
    } catch (err) {
      console.error(`[battle] ${this.meta.code} couldn't be restored:`, err instanceof SimReplayError ? err.message : err);
      endBattle(this.meta, "nocontest", null, now);
      return null;
    }
  }

  /** A line for everyone's log that isn't the simulator's (Showdown's |inactive| timer messages). */
  note(line: string) {
    for (const channel of ["p1", "p2", "spectator"] as const) {
      this.rec.logs[channel].push(line);
      this.meta.lines[channel] = this.rec.logs[channel].length;
      this.logsChanged.add(channel);
    }
  }

  /** A battle that's just starting. */
  begin(session: SimSession) {
    this.sim = { session, before: [null, null] };
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
    const res = session.result();
    this.rec.state = res.state;
    this.rec.inputLog = res.inputLog;
    this.stateChanged = true;
    meta.simVersion = res.simVersion;
    meta.turn = res.turn;
    meta.chosen = res.chosen ?? {};
    for (const channel of ["p1", "p2", "spectator"] as const) {
      if (!res.lines[channel].length) continue;
      this.rec.logs[channel].push(...res.lines[channel]);
      meta.lines[channel] = this.rec.logs[channel].length;
      this.logsChanged.add(channel);
    }
    const started: number[] = [];
    SIDES.forEach((side, seat) => {
      const pending = session.pending(side);
      const object = session.requestObject(side);
      // Compared by content in a fixed key order: the stored copy comes back from jsonb with its keys reordered.
      const fresh = object !== this.sim!.before[seat] || canonicalJson(pending) !== canonicalJson(meta.requests[seat]);
      this.sim!.before[seat] = object;
      if (!fresh) return;
      const wasPending = meta.requests[seat] !== null;
      meta.rqid[seat] += 1;
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
      endBattle(meta, this.reason ?? "normal", res.winner ? seatOfSide(res.winner) : null, now);
    }
  }
}

function endBattle(meta: BattleMeta, reason: BattleEndReason, winner: 0 | 1 | null, at: number) {
  meta.status = "finished";
  meta.end = { reason, winner, at };
  meta.requests = [null, null];
  for (const clock of meta.clocks ?? []) {
    clock.startedAt = null;
    clock.deadline = null;
  }
  if (meta.kind === "pvp") meta.chat = systemLine(meta.chat, "GG!", at);
}

// ---------------------------------------------------------------------------
// The clocks
// ---------------------------------------------------------------------------

type Timer = BattleTimer;

const showdownTimers = new Map<string, BattleTimer>();

/** A battle's turn timer: its ruleset's (null: no timer), else Showdown's timer for the Showdown format it plays (the VGC Timer where the format has it). */
export function timerOf(meta: Pick<BattleMeta, "format" | "rules"> & { formatid?: string }): Timer | null {
  if (meta.rules) return customTimer(meta.rules);
  const gameType = PLAY_FORMAT_INFO[meta.format].gameType;
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
function topUp(meta: BattleMeta, clocks: [SideClock, SideClock], timer: Timer, freshCount: number, pendingCount: number) {
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
  if (meta.kind !== "pvp" || meta.status !== "playing") return false;
  if (meta.seats.some((s) => now - s.seenAt > BATTLE_AWAY_MS)) return true;
  return (meta.clocks ?? []).some((c) => c.deadline !== null && c.deadline <= now);
}

/**
 * Applies everything due by `now`: a player who's gone forfeits; a clock that
 * ran out plays an explicit choice for that player, or loses the battle.
 */
function catchUp(work: Work, now: number) {
  const meta = work.meta;
  for (let step = 0; step < 6 && meta.kind === "pvp" && meta.status === "playing"; step++) {
    // Gone the longest first.
    const gone = meta.seats
      .map((s, seat) => ({ seat, at: s.seenAt + BATTLE_AWAY_MS }))
      .filter((g) => g.at < now)
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
    // Both players out of time together: Showdown calls it a tie.
    const other = meta.clocks![1 - seat];
    if (meta.timeoutLoses && !timer?.autoChoose && other.deadline !== null && other.deadline <= now) {
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
      const doubles = PLAY_FORMAT_INFO[meta.format].gameType === "doubles";
      const rand = seededRandom(`${meta.seed}:timer:${session.battle.inputLog.length}`);
      let choice = chooseCpu(session.battle, session.battle[side], "easy", rand);
      if (!session.choose(side, choice).ok) {
        choice = randomChoice(request, doubles, rand);
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
  if (!work.meta.end) endBattle(work.meta, "timeout", null, now);
  return true;
}

/** `seat` loses (forfeit, timeout, disconnect). */
function forceLose(work: Work, seat: number, reason: BattleEndReason, now: number): boolean {
  const session = work.session(now);
  if (!session) return false;
  work.reason = reason;
  session.lose(sideOf(seat));
  work.absorb(now);
  // The simulator always ends a battle on a forced loss; make sure of it.
  if (!work.meta.end) endBattle(work.meta, reason, seat === 0 ? 1 : 0, now);
  return true;
}

// ---------------------------------------------------------------------------
// The computer's turns
// ---------------------------------------------------------------------------

/** Lets the computer (p2) answer every request it has, explicitly. */
function playCpu(work: Work, session: SimSession) {
  const meta = work.meta;
  if (meta.kind !== "cpu" || !meta.cpu) return;
  const doubles = PLAY_FORMAT_INFO[meta.format].gameType === "doubles";
  let failures = 0;
  for (let i = 0; i < MAX_CPU_STEPS && !session.ended; i++) {
    // Re-read every time: a rejected choice can update the request (a move turned out to be disabled).
    const request = session.pending("p2");
    if (!request) return;
    const rand = seededRandom(`${meta.seed}:cpu:${session.battle.inputLog.length}:${failures}`);
    const choice = failures === 0 ? chooseCpu(session.battle, session.battle.p2, meta.cpu.level, rand) : randomChoice(request, doubles, rand);
    if (session.choose("p2", choice).ok) {
      failures = 0;
      continue;
    }
    if (++failures < 3) continue;
    // A computer that can't move would stall the battle: it concedes.
    console.error(`[battle] ${meta.code}: the computer had no legal choice`);
    work.reason = "forfeit";
    session.lose("p2");
    return;
  }
}

// ---------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------

function blankRecord(meta: BattleMeta): BattleRecord {
  return { meta, state: null, inputLog: [], logs: { p1: [], p2: [], spectator: [] } };
}

function newMeta(code: string, kind: BattleMeta["kind"], format: PlayFormatId, seats: BattleSeat[], now: number): BattleMeta {
  return {
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
}

/** Both seats are filled (and ready): the simulator starts the battle. */
function start(work: Work, now: number) {
  const meta = work.meta;
  let teams: string[];
  if ((meta.format === "factory" || meta.format === "bssfactory") && meta.seats.some((s) => !s.team)) {
    // Live Factory: both rental teams from the same tier.
    const style = meta.format === "bssfactory" ? "bss" : "open";
    if (style === "open") meta.factoryTier = pickFactoryTier();
    teams = meta.seats.map((s) => s.team ?? Teams.pack(factoryTeam(style, meta.factoryTier ?? "OU")));
  } else {
    teams = meta.seats.map((s) => (s.id === CPU_SEAT_ID ? s.team! : seatTeam(meta.format, s.team)));
  }
  const session = SimSession.create({
    formatid: meta.formatid ?? SHOWDOWN_FORMAT[meta.format] ?? meta.format,
    seed: meta.seed,
    p1: { name: meta.seats[0].name, team: teams[0] },
    p2: { name: meta.seats[1].name, team: teams[1] },
  });
  work.begin(session);
  meta.status = "playing";
  meta.startedAt = now;
  const timer = timerOf(meta);
  if (meta.kind === "pvp" && timer && !meta.timerOff) meta.clocks = [newClock(timer), newClock(timer)];
  playCpu(work, session);
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
  let foeTeam: string;
  try {
    foeTeam = custom.custom ? customCpuTeam(custom.custom.rules) : cpuTeam(opts.format);
  } catch (err) {
    return fail(400, err instanceof Error ? err.message : "Couldn't build the computer's team.");
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = newBattleCode();
    const me: BattleSeat = { id: randomId(), name: opts.name, ready: true, seenAt: now, team: team.packed, ...(opts.player ? { player: opts.player } : {}) };
    const cpu: BattleSeat = { id: CPU_SEAT_ID, name: cpuName(opts.name), ready: true, seenAt: now, team: foeTeam };
    const meta = newMeta(code, "cpu", opts.format, [me, cpu], now);
    applyCustom(meta, custom.custom);
    meta.cpu = { level: opts.level };
    const work = new Work(blankRecord(meta));
    start(work, now);
    if (!(await insertBattle(work.rec))) continue;
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
    const rec = blankRecord(newMeta(code, "pvp", opts.format, [me], now));
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
  /** Ranked: the rating they queued with. */
  rating?: { rating: number; games: number };
}

export async function createMatchedBattle(
  format: PlayFormatId,
  players: [MatchedPlayer, MatchedPlayer],
  now = Date.now(),
  opts: { ranked?: boolean; tournament?: { id: string; graceMs: number } } = {}
): Promise<{ code: string; ids: [string, string]; seenAt: number } | null> {
  // A tournament match waits longer for a trainer to turn up: they're told by a toast, not sitting in a queue.
  const seenAt = now + (opts.tournament?.graceMs ?? 0);
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = newBattleCode();
    const seats = players.map((p) => {
      const seat: BattleSeat = { id: randomId(), name: p.name, ready: true, seenAt, team: p.team };
      if (p.player) seat.player = p.player;
      if (opts.ranked && p.rating) seat.rating = { rating: p.rating.rating, games: p.rating.games };
      return seat;
    }) as [BattleSeat, BattleSeat];
    const work = new Work(blankRecord(newMeta(code, "pvp", format, seats, now)));
    // Matchmade battles are open to spectators, like Showdown's ladder.
    work.meta.public = true;
    if (opts.ranked) work.meta.ranked = true;
    if (opts.tournament) work.meta.tournament = opts.tournament.id;
    work.meta.chat = systemLine(undefined, `${opts.tournament ? "Tournament match" : "Matched"}: ${seats[0].name} vs ${seats[1].name}. Good luck!`, now);
    start(work, now);
    if (await insertBattle(work.rec)) return { code, ids: [seats[0].id, seats[1].id], seenAt };
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
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const loaded = await loadBattle(code);
    if (!loaded) return fail(404, "This battle has ended or never existed.");
    const now = Date.now();
    const work = new Work(loaded.rec);
    const out = change(work, now);
    if (!out.ok) return out;
    if (!work.changed) return { ...out, rec: work.rec, now, rev: loaded.version };
    if (await saveBattle(code, loaded.version, work.patch())) return { ...out, rec: work.rec, now, rev: loaded.version + 1 };
  }
  return fail(503, "The battle is busy. Try again.");
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
        return { ok: true, view: battleView(meta, playerId, lite.log, since, now, lite.version + 1) };
      }
      return { ok: true, view: battleView(lite.meta, playerId, lite.log, since, now, lite.version) };
    }
    if (!touch(meta, playerId, now)) return { ok: true, view: battleView(meta, playerId, lite.log, since, now, lite.version) };
    if (await saveBattle(code, lite.version, { meta })) return { ok: true, view: battleView(meta, playerId, lite.log, since, now, lite.version + 1) };
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
    const here = meta.seats.filter((s) => now - s.seenAt <= PVP_AWAY_MS);
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
      if (meta.seats.length >= 2) return fail(409, "This battle is full.");
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
        if (meta.seats.length === 2 && meta.seats.every((s) => s.ready)) start(work, now);
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
        else if (meta.status === "playing") forceLose(work, seat, "forfeit", now);
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
  const view = battleView(out.rec.meta, me, seat >= 0 ? out.rec.logs[channelOf(seat)] : [], joined ? 0 : since, out.now, out.rev);
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
    meta.clocks = [newClock(timer), newClock(timer)];
    work.note(`|inactive|Battle timer is ON: inactive players will automatically lose when time's up. (requested by ${name})`);
    const pending = meta.requests.map((r, s: number) => (r ? s : -1)).filter((s) => s >= 0);
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
  const side: SideID = sideOf(seat);
  const result = session.choose(side, choice);
  if (result.ok) playCpu(work, session);
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
  const side: SideID = sideOf(seat);
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
      const seats = old.seats.map((s) => ({ id: s.id, name: s.name, ready: false, seenAt: now, team: s.team, ...(s.player ? { player: s.player } : {}) }));
      const fresh = newMeta(newBattleCode(), "pvp", old.format, seats, now);
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
      if (meta.seats.length >= 2) return fail(409, "The rematch is full.");
      meta.seats.push({ id: me.id, name: me.name, ready: false, seenAt: now, team: me.team, ...(me.player ? { player: me.player } : {}) });
      seat = meta.seats.length - 1;
    }
    meta.seats[seat].seenAt = now;
    meta.seats[seat].ready = true;
    if (meta.seats.length === 2 && meta.seats.every((s) => s.ready)) start(work, now);
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
  const you = seat === 0 || seat === 1 ? seat : null;
  // `log` is the viewer's own channel (channelFor): a spectator's is the spectator channel; a visitor to a computer battle has none.
  const visible = channelFor(meta, seat) ? log : [];
  const total = visible.length;
  const from = since >= 0 && since <= total ? since : 0;
  const request = you !== null && meta.requests[you] ? { rqid: meta.rqid[you], data: meta.requests[you]! } : null;
  const view: BattleView = {
    code: meta.code,
    kind: meta.kind,
    format: meta.format,
    status: meta.status,
    now,
    rev,
    you,
    players: meta.seats.map((s) => ({
      name: s.name,
      ready: s.ready,
      quiet: meta.kind === "pvp" && meta.status !== "finished" && now - s.seenAt > (meta.status === "lobby" ? 10_000 : BATTLE_QUIET_MS),
      hasTeam: PLAY_FORMAT_INFO[meta.format].random || !!s.team,
      ...(meta.ranked && s.rating ? { rating: s.rating.rating, games: s.rating.games } : {}),
    })),
    turn: meta.turn,
    log: { from, total, lines: visible.slice(from) },
    request,
    waiting: you !== null && meta.status === "playing" && !request,
  };
  // Chosen, and the opponent hasn't: the choice can still be taken back (live battles; the computer answers at once).
  if (you !== null && !request && meta.kind === "pvp" && meta.status === "playing" && meta.chosen?.[you === 0 ? "p1" : "p2"]) view.cancel = { rqid: meta.rqid[you] };
  if (meta.cpu) view.cpu = { level: meta.cpu.level };
  if (meta.clocks && you !== null) {
    const clock = (c: SideClock) => ({ bank: c.bank, deadline: c.deadline, startedAt: c.startedAt });
    view.clocks = { you: clock(meta.clocks[you]), foe: clock(meta.clocks[1 - you]) };
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

