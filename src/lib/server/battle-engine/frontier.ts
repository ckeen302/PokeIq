import "server-only";
import { Dex, Teams, TeamValidator } from "pokemon-showdown";
import { randomId, signToken, verifyToken } from "../crypto";
import { claimOnce } from "../replay-guard";
import { fail, type PvpFailure } from "../duel-core";
import {
  afterBattle,
  frontierCpuLevel,
  frontierKey,
  frontierStage,
  isBoss,
  swapTeam,
  type FactoryStyle,
  type FrontierBattleInfo,
  type FrontierKey,
  type FrontierMode,
  type FrontierMon,
  type FrontierRunView,
} from "@/lib/battle/frontier";
import type { PlayFormatId } from "@/lib/battle/play";
import { factoryTeam, pickFactoryTier, prepareTeamFor, TOWER_FORMAT, towerTeam, tycoonTeam } from "./teams";
import { createRunBattle, readBattleToken } from "./service";
import { loadBattleMeta } from "./store";
import { recordFrontierBest } from "../frontier-store";

/**
 * Battle Factory and Battle Tower runs. A run's state (the player's team,
 * the streak, the Factory's tier and, after a win, the beaten team on offer)
 * travels as a signed token, so a streak can only grow by winning a battle
 * the server ran. Each streak step can start one battle only (a single-use
 * claim), so a lost battle can't be retried from the old token.
 */

type Set = ReturnType<typeof Teams.generate>[number];

export interface FrontierRun {
  v: 1;
  id: string;
  mode: FrontierMode;
  style?: FactoryStyle;
  tier?: string;
  name: string;
  /** The player's team, packed. */
  team: string;
  streak: number;
  over: boolean;
  /** After a Factory win: the beaten team, packed, to swap one in. */
  offer?: string;
}

const TOKEN_KIND = "frontier";
export const signRun = (run: FrontierRun) => signToken(TOKEN_KIND, run);
export function readRun(token: unknown): FrontierRun | null {
  const run = verifyToken<FrontierRun>(TOKEN_KIND, token);
  return run && run.v === 1 && typeof run.team === "string" && Number.isInteger(run.streak) ? run : null;
}

/** The battle format each kind of run plays (its Showdown id is in service.ts). */
export function runFormat(mode: FrontierMode, style?: FactoryStyle): PlayFormatId {
  return mode === "factory" ? (style === "bss" ? "bssfactory" : "factory") : ("tower" as PlayFormatId);
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function mon(set: Set): FrontierMon {
  const out: FrontierMon = { species: set.species, item: set.item ?? "", ability: set.ability ?? "", moves: [...set.moves], level: set.level || 100 };
  if (set.teraType) out.teraType = set.teraType;
  return out;
}

const unpack = (packed: string): Set[] => (Teams.unpack(packed) ?? []) as Set[];

export function runView(run: FrontierRun): FrontierRunView {
  const { round, battle } = frontierStage(run.streak);
  const view: FrontierRunView = {
    token: signRun(run),
    mode: run.mode,
    key: frontierKey(run.mode, run.style),
    name: run.name,
    streak: run.streak,
    over: run.over,
    team: unpack(run.team).map(mon),
    next: { round, battle, boss: isBoss(run.mode, run.streak), level: frontierCpuLevel(run.mode, run.streak) },
  };
  if (run.style) view.style = run.style;
  if (run.tier) view.tier = run.tier;
  if (run.offer) view.offer = unpack(run.offer).map(mon);
  return view;
}

export function battleInfo(run: FrontierRun): FrontierBattleInfo {
  const { round, battle } = frontierStage(run.streak);
  const info: FrontierBattleInfo = { mode: run.mode, key: frontierKey(run.mode, run.style), streak: run.streak, round, battle, boss: isBoss(run.mode, run.streak) };
  if (run.style) info.style = run.style;
  if (run.tier) info.tier = run.tier;
  return info;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

type Out<T> = ({ ok: true } & T) | PvpFailure;

/** A new Factory run: a rental team for a tier drawn the way Showdown draws it. */
export function startFactoryRun(name: string, style: FactoryStyle): Out<{ run: FrontierRunView }> {
  const tier = style === "bss" ? undefined : pickFactoryTier();
  const team = Teams.pack(factoryTeam(style, tier ?? "OU"));
  const run: FrontierRun = { v: 1, id: randomId(), mode: "factory", style, name, team, streak: 0, over: false };
  if (tier) run.tier = tier;
  return { ok: true, run: runView(run) };
}

/** A new Tower run with the player's team, checked by Showdown for the Tower's format (Flat Rules). */
export function startTowerRun(name: string, text: string): Out<{ run: FrontierRunView }> {
  const checked = prepareTeamFor(TOWER_FORMAT, text);
  if (!checked.ok) return fail(400, checked.errors.join(" "));
  if (checked.size < 3) return fail(400, "Bring at least three Pokémon: you pick three to battle.");
  const run: FrontierRun = { v: 1, id: randomId(), mode: "tower", name, team: checked.packed, streak: 0, over: false };
  return { ok: true, run: runView(run) };
}

/** The computer's team for the next battle of a run. */
type FoeTeamMaker = (run: FrontierRun) => string;

const foeMakers: Record<FrontierMode, FoeTeamMaker> = {
  factory: (run) => Teams.pack(factoryTeam(run.style ?? "open", run.tier ?? "OU")),
  tower: (run) => Teams.pack(isBoss("tower", run.streak) ? tycoonTeam() : towerTeam()),
};

/** Starts the run's next battle (once per streak step). */
export async function nextRunBattle(token: unknown): Promise<Out<{ code: string; token: string; href: string }>> {
  const run = readRun(token);
  if (!run) return fail(400, "That run isn't valid any more. Start a new one.");
  if (run.over) return fail(409, "This run is over. Start a new one.");
  const maker = foeMakers[run.mode];
  if (!(await claimOnce(`frontier:${run.id}:${run.streak}`))) return fail(409, "This battle of your run has already started. Open it from where you left off, or start a new run.");
  const level = frontierCpuLevel(run.mode, run.streak);
  const made = await createRunBattle({
    name: run.name,
    format: runFormat(run.mode, run.style),
    level,
    team: run.team,
    foe: maker({ ...run, offer: undefined }),
    foeName: isBoss(run.mode, run.streak) ? "Tower Tycoon" : undefined,
    frontier: { info: battleInfo(run), run: { ...run, offer: undefined } },
  });
  if (!made.ok) return made;
  return { ok: true, code: made.code, token: made.token, href: `/battle/play/${made.code}` };
}

/**
 * After a run's battle: on a win the streak grows (and the Factory offers
 * the beaten team); a loss ends the run. Either way the best streak is
 * kept for a signed-in trainer. Can be asked again (a reload): same answer.
 */
export async function runResult(code: string, seatToken: unknown, userId: string | null): Promise<Out<{ won: boolean; run: FrontierRunView; best: number | null }>> {
  const seat = readBattleToken(seatToken, code);
  if (!seat) return fail(403, "That isn't your battle.");
  const lite = await loadBattleMeta(code, null);
  if (!lite) return fail(404, "This battle has ended or never existed.");
  const meta = lite.meta;
  if (!meta.frontier || meta.seats[0]?.id !== seat.playerId) return fail(403, "That isn't your run's battle.");
  if (meta.status !== "finished" || !meta.end) return fail(409, "The battle isn't over yet.");
  const before = meta.frontier.run;
  const won = meta.end.winner === 0;
  const after = afterBattle(before.streak, won);
  const run: FrontierRun = { ...before, streak: after.streak, over: after.over };
  if (won && before.mode === "factory") run.offer = meta.seats[1]?.team;
  const best = userId ? await recordFrontierBest(userId, frontierKey(before.mode, before.style), run.streak) : null;
  return { ok: true, won, run: runView(run), best };
}

/** The Factory's trade after a win: your `give`th Pokémon for the beaten team's `take`th (or keep your team: give -1). */
export function swapRun(token: unknown, give: number, take: number): Out<{ run: FrontierRunView }> {
  const run = readRun(token);
  if (!run) return fail(400, "That run isn't valid any more. Start a new one.");
  if (run.over || !run.offer) return fail(409, "There's nothing to swap right now.");
  if (give < 0) return { ok: true, run: runView({ ...run, offer: undefined }) };
  const swapped = swapTeam(unpack(run.team), unpack(run.offer), give, take, {
    itemClause: run.style === "bss",
    base: (s) => Dex.species.get(s).baseSpecies,
  });
  if (!swapped.ok) return fail(400, swapped.error);
  // The rules still hold for the new team (Showdown's own validator for the format).
  const formatid = run.style === "bss" ? "gen9bssfactory" : "gen9customgame@@@Standard";
  const problems = TeamValidator.get(formatid).validateTeam(structuredClone(swapped.team));
  if (problems?.length) return fail(400, problems.slice(0, 3).join(" "));
  return { ok: true, run: runView({ ...run, team: Teams.pack(swapped.team), offer: undefined }) };
}

export type { FrontierKey };
