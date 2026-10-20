import "server-only";
import { randomInt } from "node:crypto";
import { BATTLE_AWAY_MS, PLAY_FORMAT_INFO } from "@/lib/battle/play";
import { isLadderFormat } from "@/lib/battle/ladder";
import {
  MAX_PLAYERS,
  MAX_RR_PLAYERS,
  MIN_PLAYERS,
  NO_SHOW_MS,
  OFFICIAL_FORMAT,
  OFFICIAL_SIGNUP_MIN,
  type BestOf,
  type TournamentFormat,
  type TournamentMatchNote,
  type TournamentStyle,
  type TournamentSummary,
  type TournamentView,
  tournamentTitle,
} from "@/lib/tournaments";
import type { PublicUser } from "../accounts";
import { randomId } from "../crypto";
import { battleKey } from "../battle-engine/identity";
import { battleToken, checkTeam, createMatchedBattle, pollBattle } from "../battle-engine/service";
import { deleteBattle, loadBattleMeta } from "../battle-engine/store";
import { settleBattle } from "../battle-engine/settle";
import { applyGame, attachGame, cancelTournament, claimMatches, closeSignups, disqualify, finishIfEnded, playerMatch, tournamentView, type GameOutcome } from "./core";
import { tournamentStore, type TourRecord, type TournamentStore } from "./store";

/**
 * Tournaments on serverless: nothing runs on a timer. Every read of a
 * tournament (its page polling, a player's heartbeat, the lobby for
 * sign-ups that should have closed) "ticks" it: finished battles are read
 * and applied, sign-ups close on time, and newly available matches are
 * claimed and get their battle, both players seated. Every write is a
 * compare-and-swap on the tournament's version, retried from a fresh read;
 * a battle is attached to its match only by the server that claimed it
 * (a loser of that race deletes its battle), so racing ticks can't start
 * a match twice or count a game twice.
 */

export type Fail = { ok: false; status: number; error: string };
export type Result<T = object> = ({ ok: true } & T) | Fail;
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });
/** Just whether it worked (not the record). */
const bare = async (out: Promise<Result<{ rec: TourRecord }>>): Promise<Result> => {
  const r = await out;
  return r.ok ? { ok: true } : r;
};

export const TOURNAMENT_ID_RE = /^[a-z0-9-]{8,24}$/;
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const newId = () => Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
const MAX_TRIES = 5;
/** Ticks of one tournament on one instance at most this often (battles are read only then). */
const TICK_GAP_MS = 2_500;
/** How long a seat waits for its trainer, on top of the battle's own 80 s disconnect timer: 3 minutes in all. */
const GRACE_MS = NO_SHOW_MS - BATTLE_AWAY_MS;

export class NoTournaments extends Error {}

function store(): TournamentStore {
  const s = tournamentStore();
  if (!s) throw new NoTournaments("Tournaments aren't available on this server.");
  return s;
}

/** Read, change, compare-and-swap; on a clash start again from a fresh read. */
async function update<T extends object>(id: string, change: (rec: TourRecord, now: number) => Result<T>): Promise<Result<T & { rec: TourRecord; version: number }>> {
  const s = store();
  for (let i = 0; i < MAX_TRIES; i++) {
    const row = await s.get(id);
    if (!row) return fail(404, "That tournament doesn't exist.");
    const before = JSON.stringify(row.rec);
    const now = Date.now();
    const out = change(row.rec, now);
    if (!out.ok) return out;
    if (JSON.stringify(row.rec) === before) return { ...out, rec: row.rec, version: row.version };
    if (await s.save(row.rec, row.version)) return { ...out, rec: row.rec, version: row.version + 1 };
  }
  return fail(503, "The tournament is busy. Try again.");
}

// ---------------------------------------------------------------------------
// Creating, joining, leaving
// ---------------------------------------------------------------------------

export interface CreateOptions {
  format: TournamentFormat;
  style: TournamentStyle;
  maxPlayers: number;
  signupMinutes: number;
  bestOf: BestOf;
}

function blank(id: string, opts: CreateOptions, host: PublicUser | null, now: number, signupEndsAt: number): TourRecord {
  return {
    v: 1,
    id,
    format: opts.format,
    style: opts.style,
    bestOf: opts.bestOf,
    maxPlayers: opts.maxPlayers,
    official: !host,
    host: host?.id ?? null,
    hostName: host?.username ?? null,
    status: "signup",
    createdAt: now,
    signupEndsAt,
    players: [],
    matches: [],
    // Every player is signed in, so a laddered format is rated.
    rated: isLadderFormat(opts.format),
  };
}

export async function createTournament(host: PublicUser, opts: CreateOptions, now = Date.now()): Promise<Result<{ id: string }>> {
  if (opts.maxPlayers < MIN_PLAYERS || opts.maxPlayers > MAX_PLAYERS) return fail(400, `Pick ${MIN_PLAYERS} to ${MAX_PLAYERS} players.`);
  if (opts.style === "rr" && opts.maxPlayers > MAX_RR_PLAYERS) return fail(400, `Round robin takes at most ${MAX_RR_PLAYERS} players.`);
  const s = store();
  const mine = (await s.list("active", 100)).filter((r) => r.rec.host === host.id);
  if (mine.length) return fail(409, "You already have a tournament going. Finish or cancel it first.");
  for (let i = 0; i < 4; i++) {
    const id = newId();
    if (await s.insert(blank(id, opts, host, now, now + opts.signupMinutes * 60_000))) return { ok: true, id };
  }
  return fail(503, "Couldn't open a tournament. Try again.");
}

/** The official hourly Random Battle tournament taking sign-ups now: this hour's until :10, then the next hour's. Created on first sight. */
export async function ensureOfficial(now = Date.now()): Promise<void> {
  const hour = 3_600_000;
  let slot = Math.floor(now / hour) * hour;
  if (now >= slot + OFFICIAL_SIGNUP_MIN * 60_000) slot += hour;
  const d = new Date(slot);
  const id = `hourly-${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}${String(d.getUTCHours()).padStart(2, "0")}`;
  if (officialSeen.has(id)) return;
  const s = store();
  if (!(await s.get(id))) await s.insert(blank(id, { format: OFFICIAL_FORMAT, style: "elim", maxPlayers: MAX_PLAYERS, signupMinutes: 0, bestOf: 1 }, null, now, slot + OFFICIAL_SIGNUP_MIN * 60_000));
  officialSeen.add(id);
}
const officialSeen = new Set<string>();

export async function joinTournament(id: string, user: PublicUser, team?: string): Promise<Result> {
  const s = store();
  const row = await s.get(id);
  if (!row) return fail(404, "That tournament doesn't exist.");
  const checked = checkTeam(row.rec.format, team);
  if (!checked.ok) return fail(checked.status, checked.error);
  return bare(update(id, (rec, now) => {
    if (rec.status !== "signup" || now >= rec.signupEndsAt) return fail(409, "Sign-ups are closed.");
    const me = rec.players.find((p) => p.id === user.id);
    if (me) {
      if (checked.packed) me.team = checked.packed;
      return { ok: true };
    }
    if (rec.players.length >= rec.maxPlayers) return fail(409, "This tournament is full.");
    rec.players.push({ id: user.id, name: user.username, key: battleKey(`u:${user.id}`), ...(checked.packed ? { team: checked.packed } : {}), joinedAt: now, score: 0, wins: 0, losses: 0, games: 0 });
    // Full: sign-ups close at once.
    if (rec.players.length >= rec.maxPlayers) closeSignups(rec, now);
    return { ok: true };
  }));
}

export function leaveTournament(id: string, user: PublicUser): Promise<Result> {
  return bare(update(id, (rec) => {
    if (rec.status !== "signup") return fail(409, "The tournament has started: you can forfeit your match instead.");
    rec.players = rec.players.filter((p) => p.id !== user.id);
    return { ok: true };
  }));
}

/** The host closes sign-ups early (two trainers at least), or cancels before it ends. */
export function hostAction(id: string, user: PublicUser, action: "start" | "cancel"): Promise<Result> {
  return bare(update(id, (rec, now) => {
    if (rec.host !== user.id) return fail(403, "Only the host can do that.");
    if (action === "cancel") {
      if (rec.status === "finished" || rec.status === "cancelled") return fail(409, "It's already over.");
      cancelTournament(rec, "Cancelled by the host.", now);
      return { ok: true };
    }
    if (rec.status !== "signup") return fail(409, "It has already started.");
    if (rec.players.length < 2) return fail(409, "Wait for at least two trainers.");
    closeSignups(rec, now);
    return { ok: true };
  }));
}

// ---------------------------------------------------------------------------
// Moderators
// ---------------------------------------------------------------------------

export function adminCancel(id: string, reason: string): Promise<Result> {
  return bare(update(id, (rec, now) => {
    if (rec.status === "finished" || rec.status === "cancelled") return fail(409, "It's already over.");
    cancelTournament(rec, reason || "Cancelled by a moderator.", now);
    return { ok: true };
  }));
}

export function adminDisqualify(id: string, name: string): Promise<Result> {
  return bare(update(id, (rec, now) => {
    const p = rec.players.findIndex((x) => x.name.toLowerCase() === name.toLowerCase());
    if (p < 0) return fail(404, "No such player in this tournament.");
    disqualify(rec, p);
    finishIfEnded(rec, now);
    return { ok: true };
  }));
}

// ---------------------------------------------------------------------------
// Advancing
// ---------------------------------------------------------------------------

const lastTick = new Map<string, number>();

/** What each match's current battle says (finished battles only); pokes battles whose players may have never turned up. */
async function readGames(rec: TourRecord, now: number): Promise<Map<string, GameOutcome & { code: string }>> {
  const out = new Map<string, GameOutcome & { code: string }>();
  await Promise.all(
    rec.matches.map(async (m) => {
      if (m.done || !m.current) return;
      const code = m.current.code;
      let lite = await loadBattleMeta(code, null).catch(() => undefined);
      if (lite === undefined) return;
      if (!lite) {
        // The battle is gone (it can't have been played): the game is replayed.
        out.set(m.id, { code, winner: null, arrived: [true, true] });
        return;
      }
      if (lite.meta.status !== "finished" && now >= m.current.createdAt + NO_SHOW_MS) {
        // A spectator's poll catches the battle up: a trainer who never came is out of time by now.
        await pollBattle(code, null, 0, null).catch(() => undefined);
        lite = await loadBattleMeta(code, null).catch(() => null);
        if (!lite) return;
      }
      if (lite.meta.status !== "finished" || !lite.meta.end) return;
      if (!lite.meta.settled) await settleBattle(code).catch((err) => console.error("[tournament] settling failed:", err));
      const seats = lite.meta.seats;
      out.set(m.id, { code, winner: lite.meta.end.winner, arrived: [seats[0]?.arrived !== undefined, seats[1]?.arrived !== undefined] });
    })
  );
  return out;
}

/** Creates the battle for each match this server claimed, and attaches it (or deletes it, if the claim was lost). */
async function startClaimed(id: string, by: string, claimed: string[]): Promise<void> {
  for (const matchId of claimed) {
    const row = await store().get(id);
    const rec = row?.rec;
    const m = rec?.matches.find((x) => x.id === matchId);
    if (!rec || !m || m.claim?.by !== by) continue;
    const [pa, pb] = [rec.players[m.a], rec.players[m.b]];
    const now = Date.now();
    const opened = await createMatchedBattle(
      rec.format,
      [
        { name: pa.name, team: pa.team, player: pa.key },
        { name: pb.name, team: pb.team, player: pb.key },
      ],
      now,
      { ranked: rec.rated, tournament: { id, graceMs: GRACE_MS } }
    ).catch((err) => {
      console.error("[tournament] couldn't create a battle:", err);
      return null;
    });
    if (!opened) continue;
    const attached = await update(id, (r) => (attachGame(r, matchId, by, { code: opened.code, ids: opened.ids, createdAt: now }) ? { ok: true } : fail(409, "lost")));
    if (!attached.ok) await deleteBattle(opened.code).catch(() => undefined);
  }
}

/**
 * Brings a tournament up to date (see above). Cheap when nothing is due:
 * battles are read at most every few seconds per instance, and nothing is
 * written unless something changed.
 */
export async function tickTournament(id: string, force = false): Promise<{ rec: TourRecord; version: number } | null> {
  const s = store();
  let row = await s.get(id);
  if (!row) return null;
  const now = Date.now();
  const due = row.rec.status === "signup" ? now >= row.rec.signupEndsAt : row.rec.status === "running";
  if (!due || (!force && now - (lastTick.get(id) ?? 0) < TICK_GAP_MS)) return row;
  lastTick.set(id, now);
  if (lastTick.size > 2000) lastTick.clear();

  const games = row.rec.status === "running" ? await readGames(row.rec, now) : new Map<string, GameOutcome & { code: string }>();
  const by = randomId();
  let claimed: string[] = [];
  const out = await update(id, (rec, at) => {
    if (rec.status === "signup" && at >= rec.signupEndsAt) closeSignups(rec, at);
    for (const [matchId, game] of games) {
      // Only the game that was read: a fresher record may have moved on.
      if (rec.matches.find((x) => x.id === matchId)?.current?.code === game.code) applyGame(rec, matchId, game);
    }
    finishIfEnded(rec, at);
    claimed = claimMatches(rec, at, by);
    return { ok: true };
  });
  if (!out.ok) return row;
  row = { rec: out.rec, version: out.version };
  if (claimed.length) {
    await startClaimed(id, by, claimed);
    row = (await s.get(id)) ?? row;
  }
  return row;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The tournament page: brought up to date, with the viewer's own match and seat token. */
export async function viewTournament(id: string, viewer: PublicUser | null): Promise<TournamentView | null> {
  const row = await tickTournament(id);
  if (!row) return null;
  const view = tournamentView(row.rec, row.version, Date.now());
  if (viewer) {
    const mine = playerMatch(row.rec, viewer.id);
    const against = mine ? row.rec.players[mine.seat === 0 ? mine.m.b : mine.m.a].name : "";
    view.you = {
      joined: row.rec.players.some((p) => p.id === viewer.id),
      host: row.rec.host === viewer.id,
      match: mine ? { code: mine.m.current!.code, token: battleToken(mine.m.current!.code, mine.m.current!.ids[mine.seat], mine.seat), against } : null,
    };
  }
  return view;
}

const summary = (rec: TourRecord): TournamentSummary => ({
  id: rec.id,
  title: tournamentTitle(rec.format, rec.official ? null : rec.hostName),
  formatName: PLAY_FORMAT_INFO[rec.format].name,
  style: rec.style,
  bestOf: rec.bestOf,
  official: rec.official,
  status: rec.status,
  players: rec.players.length,
  maxPlayers: rec.maxPlayers,
  signupEndsAt: rec.signupEndsAt,
  winner: rec.results?.[0]?.[0] !== undefined ? rec.players[rec.results[0][0]]?.name ?? null : null,
  endedAt: rec.endedAt ?? null,
});

/** The lobby: open and running tournaments (sign-ups past their time are closed first), and the latest finished. */
export async function listTournaments(now = Date.now()): Promise<{ active: TournamentSummary[]; history: TournamentSummary[] }> {
  await ensureOfficial(now);
  const s = store();
  const [active, history] = await Promise.all([s.list("active", 50), s.list("finished", 20)]);
  const due = active.filter((r) => r.rec.status === "signup" && now >= r.rec.signupEndsAt).slice(0, 5);
  const ticked = new Map((await Promise.all(due.map((r) => tickTournament(r.rec.id)))).filter((r) => !!r).map((r) => [r!.rec.id, r!]));
  const fresh = active.map((r) => ticked.get(r.rec.id) ?? r);
  return {
    active: fresh.filter((r) => r.rec.status === "signup" || r.rec.status === "running").map((r) => summary(r.rec)),
    history: [...fresh.filter((r) => r.rec.status === "finished" || r.rec.status === "cancelled"), ...history].map((r) => summary(r.rec)).slice(0, 20),
  };
}

/** "Your match is ready" for the heartbeat: the trainer's waiting matches (their tournaments ticked on the way). */
export async function matchNotes(userId: string): Promise<TournamentMatchNote[]> {
  const s = tournamentStore();
  if (!s) return [];
  const notes: TournamentMatchNote[] = [];
  for (const r of await s.running(userId)) {
    const row = (await tickTournament(r.rec.id)) ?? r;
    const mine = playerMatch(row.rec, userId);
    if (!mine) continue;
    const g = mine.m.current!;
    notes.push({
      tournament: row.rec.id,
      title: tournamentTitle(row.rec.format, row.rec.official ? null : row.rec.hostName),
      code: g.code,
      token: battleToken(g.code, g.ids[mine.seat], mine.seat),
      against: row.rec.players[mine.seat === 0 ? mine.m.b : mine.m.a].name,
    });
  }
  return notes;
}
