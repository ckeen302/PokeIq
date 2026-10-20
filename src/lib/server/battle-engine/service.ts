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
import { cpuTeam, prepareTeam, seatTeam } from "./teams";
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
      else if (!(pending.update && wasPending && clock.deadline !== null)) startClock(clock, now, !!pending.teamPreview, meta.format);
    });
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

const timerOf = (format: PlayFormatId) => BATTLE_TIMER[PLAY_FORMAT_INFO[format].gameType];

export function newClock(format: PlayFormatId): SideClock {
  return { bank: timerOf(format).bank, startedAt: null, deadline: null, preview: false, timeouts: 0 };
}

/** A new request: the bank grows a little and this turn's deadline is set (team preview has its own limit). */
export function startClock(clock: SideClock, now: number, preview: boolean, format: PlayFormatId) {
  const timer = timerOf(format);
  clock.startedAt = now;
  clock.preview = preview;
  if (preview) {
    clock.deadline = now + BATTLE_TIMER.preview;
    return;
  }
  clock.bank = Math.min(timer.bank, clock.bank + timer.perTurn);
  clock.deadline = now + Math.min(clock.bank, timer.cap);
}

/** A choice is in: the time it took comes out of the bank. */
export function stopClock(clock: SideClock, now: number) {
  if (clock.startedAt !== null && !clock.preview) clock.bank = Math.max(0, clock.bank - Math.max(0, now - clock.startedAt));
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
    if (!clock.preview) clock.bank = Math.max(0, clock.bank - (clock.deadline! - clock.startedAt!));
    clock.timeouts += 1;
    clock.startedAt = null;
    clock.deadline = null;
    if (clock.timeouts >= BATTLE_TIMEOUTS_TO_LOSE || (clock.bank <= 0 && !clock.preview)) {
      if (!forceLose(work, seat, "timeout", now)) return;
      continue;
    }
    // Out of time this turn: the timer plays a sensible, explicit choice.
    const session = work.session(now);
    if (!session) return;
    const side = sideOf(seat);
    const request = session.pending(side);
    if (request) {
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
  const teams = meta.seats.map((s) => (s.id === CPU_SEAT_ID ? s.team! : seatTeam(meta.format, s.team)));
  const session = SimSession.create({
    formatid: meta.format,
    seed: meta.seed,
    p1: { name: meta.seats[0].name, team: teams[0] },
    p2: { name: meta.seats[1].name, team: teams[1] },
  });
  work.begin(session);
  meta.status = "playing";
  if (meta.kind === "pvp") meta.clocks = [newClock(meta.format), newClock(meta.format)];
  playCpu(work, session);
  work.absorb(now);
}

/** A team for a seat in a bring-your-own format (none needed for random formats). */
export function checkTeam(format: PlayFormatId, team: string | undefined): Outcome<{ packed?: string }> {
  if (PLAY_FORMAT_INFO[format].random) return { ok: true };
  if (!team?.trim()) return fail(400, `${PLAY_FORMAT_INFO[format].name} needs a team: paste one in Showdown's export format.`);
  const checked = prepareTeam(format, team);
  return checked.ok ? { ok: true, packed: checked.packed } : fail(400, checked.errors.join(" "));
}

/** The computer's name, never the same as the player's (the simulator tells sides apart by name). */
const cpuName = (player: string) => (player.toLowerCase() === "cpu" ? "Computer" : "CPU");

export async function createCpuBattle(opts: { name: string; format: PlayFormatId; level: CpuLevel; team?: string }, now = Date.now()) {
  const team = checkTeam(opts.format, opts.team);
  if (!team.ok) return team;
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = newBattleCode();
    const me: BattleSeat = { id: randomId(), name: opts.name, ready: true, seenAt: now, team: team.packed };
    const cpu: BattleSeat = { id: CPU_SEAT_ID, name: cpuName(opts.name), ready: true, seenAt: now, team: cpuTeam(opts.format) };
    const meta = newMeta(code, "cpu", opts.format, [me, cpu], now);
    meta.cpu = { level: opts.level };
    const work = new Work(blankRecord(meta));
    start(work, now);
    if (!(await insertBattle(work.rec))) continue;
    return { ok: true as const, code, token: battleToken(code, me.id, 0), view: battleView(work.rec.meta, me.id, work.rec.logs.p1, 0, now, 0) };
  }
  return fail(503, "Couldn't start a battle. Try again.");
}

export async function createLiveBattle(opts: { name: string; format: PlayFormatId; team?: string }, now = Date.now()) {
  const team = checkTeam(opts.format, opts.team);
  if (!team.ok) return team;
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = newBattleCode();
    const me: BattleSeat = { id: randomId(), name: opts.name, ready: false, seenAt: now, team: team.packed };
    const rec = blankRecord(newMeta(code, "pvp", opts.format, [me], now));
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
export async function createMatchedBattle(
  format: PlayFormatId,
  players: [{ name: string; team?: string }, { name: string; team?: string }],
  now = Date.now()
): Promise<{ code: string; ids: [string, string] } | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = newBattleCode();
    const seats = players.map((p) => ({ id: randomId(), name: p.name, ready: true, seenAt: now, team: p.team })) as [BattleSeat, BattleSeat];
    const work = new Work(blankRecord(newMeta(code, "pvp", format, seats, now)));
    work.meta.chat = systemLine(undefined, `Matched: ${seats[0].name} vs ${seats[1].name}. Good luck!`, now);
    start(work, now);
    if (await insertBattle(work.rec)) return { code, ids: [seats[0].id, seats[1].id] };
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
export async function pollBattle(code: string, token: unknown, since: number): Promise<Outcome<{ view: BattleView }>> {
  const seatToken = readBattleToken(token, code);
  const playerId = seatToken?.playerId ?? null;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    let lite = await loadBattleMeta(code, seatToken ? channelOf(seatToken.seat) : null);
    if (!lite) return fail(404, "This battle has ended or never existed.");
    const seat = seatIndex(lite.meta, playerId);
    if (seat >= 0 && seatToken && seat !== seatToken.seat) {
      lite = await loadBattleMeta(code, channelOf(seat));
      if (!lite) return fail(404, "This battle has ended or never existed.");
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
      return { ok: true, view: battleView(out.rec.meta, playerId, s >= 0 ? out.rec.logs[channelOf(s)] : [], since, out.now, out.rev) };
    }
    const meta = structuredClone(lite.meta);
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
  | { action: "join"; name: string; team?: string }
  | { action: "ready"; ready: boolean }
  | { action: "team"; team: string }
  | { action: "choose"; rqid: number; choice: string }
  | { action: "forfeit" };

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
    const team = checkTeam(lite.meta.format, body.team);
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
      meta.seats.push({ id: joined, name: body.name, ready: false, seenAt: now, team: packed });
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
    }
  });
  if (!out.ok) return out;
  const me = joined ?? playerId!;
  const seat = seatIndex(out.rec.meta, me);
  const view = battleView(out.rec.meta, me, seat >= 0 ? out.rec.logs[channelOf(seat)] : [], joined ? 0 : since, out.now, out.rev);
  return { ok: true, view, playerId: me, rejected: out.rejected };
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
      const fresh = newMeta(newBattleCode(), "pvp", old.format, old.seats.map((s) => ({ id: s.id, name: s.name, ready: false, seenAt: now, team: s.team })), now);
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
      meta.seats.push({ id: me.id, name: me.name, ready: false, seenAt: now, team: me.team });
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
    view: battleView(out.rec.meta, playerId, seat >= 0 ? out.rec.logs[channelOf(seat)] : [], 0, out.now, out.rev),
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
  const total = you === null ? 0 : log.length;
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
    })),
    turn: meta.turn,
    log: { from, total, lines: you === null ? [] : log.slice(from) },
    request,
    waiting: you !== null && meta.status === "playing" && !request,
  };
  if (meta.cpu) view.cpu = { level: meta.cpu.level };
  if (meta.clocks && you !== null) {
    const clock = (c: SideClock) => ({ bank: c.bank, deadline: c.deadline });
    view.clocks = { you: clock(meta.clocks[you]), foe: clock(meta.clocks[1 - you]) };
  }
  if (meta.end) view.end = meta.end;
  if (meta.rematch) view.rematch = meta.rematch;
  if (meta.kind === "pvp" && meta.chat?.length) view.chat = meta.chat;
  return view;
}

