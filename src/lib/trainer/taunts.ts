import type { AvatarUnlocks } from "../avatar";
import { lowerFirst, unlockHint, unlocked, type Unlock } from "./config";

/**
 * Post-game taunts: dances and emotes a 3D trainer plays on the duel result
 * screen, for both players to see. Preset moves only (no text), each
 * keyframed in code on the trainer rig (components/trainer3d/moves.ts). A
 * few are free; the rest are earned with badges, ranked wins, ranked
 * streaks and ranked tiers. Shared by the server (which checks every one
 * sent) and the pages.
 */

export interface Taunt extends Unlock {
  id: string;
  name: string;
  kind: "dance" | "emote";
  /** How long one play lasts (seconds). */
  secs: number;
}

export const TAUNTS = [
  // Dances
  { id: "dab", name: "Dab", kind: "dance", secs: 3.2 },
  { id: "robot", name: "Robot", kind: "dance", secs: 4 },
  { id: "shuffle", name: "Shuffle", kind: "dance", secs: 4, wins: 3 },
  { id: "sprinkler", name: "Sprinkler", kind: "dance", secs: 4, badges: 3 },
  { id: "swingfloss", name: "Swing Floss", kind: "dance", secs: 4, streak: 3 },
  { id: "fireshot", name: "Fire Shot", kind: "dance", secs: 4, streak: 5 },
  { id: "moonwalk", name: "Moonwalk", kind: "dance", secs: 4.4, tier: "great" },
  { id: "hypejump", name: "Hype Jump", kind: "dance", secs: 3.6, tier: "ultra" },
  { id: "heeltap", name: "Heel Tap", kind: "dance", secs: 4.8, tier: "master" },
  // Emotes
  { id: "ggwave", name: "GG Wave", kind: "emote", secs: 2.6 },
  { id: "salute", name: "Salute", kind: "emote", secs: 2.4 },
  { id: "slowclap", name: "Slow Clap", kind: "emote", secs: 3.2 },
  { id: "facepalm", name: "Facepalm", kind: "emote", secs: 2.6, badges: 1 },
  { id: "flex", name: "Flex", kind: "emote", secs: 2.6, wins: 1 },
  { id: "balltoss", name: "Ball Toss", kind: "emote", secs: 2.8, badges: 5 },
  { id: "tooeasy", name: "Too Easy", kind: "emote", secs: 2.6, wins: 10 },
  { id: "ballspin", name: "Ball Spin", kind: "emote", secs: 3, wins: 25 },
] as const satisfies readonly Taunt[];

export type TauntId = (typeof TAUNTS)[number]["id"];
export const TAUNT_IDS = TAUNTS.map((t) => t.id) as [TauntId, ...TauntId[]];
const BY_ID = new Map<string, Taunt>(TAUNTS.map((t) => [t.id, t]));

export const tauntOf = (id: string): Taunt | undefined => BY_ID.get(id);
export const isTaunt = (id: string): id is TauntId => BY_ID.has(id);
export const tauntFree = (t: Taunt) => t.badges === undefined && t.tier === undefined && t.wins === undefined && t.streak === undefined;

/** A trainer may start a taunt at most this often (the server holds them to it too). */
export const TAUNT_GAP_MS = 3_000;

/**
 * Why this account (null: a guest) can't play `id`, or null if it can.
 * Guests get the free ones.
 */
export function tauntBlocked(id: string, u: AvatarUnlocks | null): string | null {
  const t = tauntOf(id);
  if (!t) return "That isn't a move.";
  if (tauntFree(t)) return null;
  if (!u) return `Sign in and ${lowerFirst(unlockHint(t))} to unlock ${t.name}.`;
  return unlocked(t, u) ? null : `${t.name} is locked: ${lowerFirst(unlockHint(t))}.`;
}
