import "server-only";
import { PLAY_FORMAT_INFO } from "@/lib/battle/play";
import { customName } from "@/lib/battle/custom-rules";
import { MODULE_INFO } from "@/lib/modes";
import { activityLabel, type ChallengeKind, type FriendActivity } from "@/lib/community";
import { readPvpToken } from "./duel-core";
import { readDuelToken } from "./duel";
import { loadDuel, pvpStore } from "./duel-store";
import { readBattleToken } from "./battle-engine/service";
import { loadBattleMeta, type BattleMeta } from "./battle-engine/store";
import { battleKey } from "./battle-engine/identity";

/**
 * Where friends meet the games: a challenge names a battle or duel its
 * sender opened (checked here against their seat token), "Add friend" after
 * a game proves the trainer sat in it, and "now playing" names a battle only
 * when the trainer really is in it, offering a Watch link only when anyone
 * may watch it.
 */

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

const battleFormatName = (meta: BattleMeta) => (meta.rules ? customName(meta.rules) : (PLAY_FORMAT_INFO[meta.format]?.name ?? "Battle"));

/** "[Gen 9] OU" -> "Gen 9 OU battle"; "[Gen 9] Random Battle" stays "Gen 9 Random Battle". */
export function battlePhrase(formatName: string): string {
  const name = formatName.replace(/^\[([^\]]+)\]\s*/, "$1 ").trim();
  return /battle$/i.test(name) ? name : `${name} battle`;
}

/** A seat in a game: whose seat the token is, and the ids of everyone seated. */
export async function seatIn(kind: ChallengeKind, code: string, token: unknown): Promise<{ me: string; players: string[]; lobby: boolean; label: string } | null> {
  if (kind === "battle") {
    const seat = readBattleToken(token, code);
    if (!seat) return null;
    const lite = await loadBattleMeta(code, null);
    if (!lite || lite.meta.kind !== "pvp") return null;
    const players = lite.meta.seats.map((s) => s.id);
    if (!players.includes(seat.playerId)) return null;
    return { me: seat.playerId, players, lobby: lite.meta.status === "lobby", label: battlePhrase(battleFormatName(lite.meta)) };
  }
  if (kind === "guessr") {
    const me = readDuelToken(token, code);
    const stored = me ? await loadDuel(code) : null;
    if (!me || !stored) return null;
    const players = stored.duel.players.map((p) => p.id);
    if (!players.includes(me)) return null;
    const region = stored.duel.region;
    return { me, players, lobby: stored.duel.status === "lobby", label: `PokéGuessr duel · ${region.charAt(0).toUpperCase()}${region.slice(1)}` };
  }
  const me = readPvpToken(token, code);
  const stored = me ? await pvpStore.load(code) : null;
  if (!me || !stored || stored.duel.kind !== kind) return null;
  const players = stored.duel.players.map((p) => p.id);
  if (!players.includes(me)) return null;
  const label = stored.duel.kind === "quiz" ? `Quiz duel · ${MODULE_INFO[stored.duel.module]?.title ?? "Quiz"}` : "Pokédle duel";
  return { me, players, lobby: stored.duel.status === "lobby", label };
}

/** A game a trainer may challenge a friend to: theirs, still in its lobby, with a seat free. */
export async function challengeGame(kind: ChallengeKind, code: string, token: unknown): Promise<{ ok: true; label: string } | Fail> {
  const seat = await seatIn(kind, code, token);
  if (!seat) return fail(404, "Open the battle or duel first.");
  if (!seat.lobby || seat.players.length >= 2) return fail(409, "That game has already started.");
  return { ok: true, label: seat.label };
}

/** The key an encounter is stored under: one seat in one game. */
export const encounterKey = (kind: ChallengeKind, code: string, playerId: string) => `${kind}:${code}:${playerId}`.slice(0, 80);

/**
 * "Now playing" for a battle: its format, if this account is seated in it,
 * and its code to watch only if it's a public battle under way.
 */
export async function battleActivity(code: string, userId: string): Promise<FriendActivity> {
  const plain: FriendActivity = { kind: "battle", label: activityLabel("battle") };
  try {
    const lite = await loadBattleMeta(code, null);
    if (!lite) return plain;
    const key = battleKey(`u:${userId}`);
    if (!lite.meta.seats.some((s) => s.player === key)) return plain;
    const meta = lite.meta;
    const label = meta.kind === "cpu" ? `Battling the computer · ${battlePhrase(battleFormatName(meta))}` : `In a ${battlePhrase(battleFormatName(meta))}`;
    return meta.kind === "pvp" && meta.public === true && meta.status === "playing" ? { kind: "battle", label, watch: meta.code } : { kind: "battle", label };
  } catch {
    return plain;
  }
}
