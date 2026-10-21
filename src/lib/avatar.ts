import { RANKED_TIERS, type RankedTierId } from "./ranked";
import { artUrl } from "./pokemon/art";

/**
 * Profile pictures: any Pokémon (shiny from trainer level 10) in a frame
 * earned by level milestones or ranked tiers. Shared by the server, which
 * checks every choice against what the account has unlocked, and the pages.
 */

export const AVATAR_MAX_ID = 1025;
export const SHINY_LEVEL = 10;

export const AVATAR_FRAMES = [
  { id: "none", name: "No frame" },
  { id: "lv5", name: "Bronze", level: 5 },
  { id: "lv15", name: "Silver", level: 15 },
  { id: "lv30", name: "Gold", level: 30 },
  { id: "lv50", name: "Champion", level: 50 },
  { id: "great", name: "Great Ball", tier: "great" },
  { id: "ultra", name: "Ultra Ball", tier: "ultra" },
  { id: "master", name: "Master Ball", tier: "master" },
] as const satisfies readonly { id: string; name: string; level?: number; tier?: RankedTierId }[];
export type AvatarFrame = (typeof AVATAR_FRAMES)[number]["id"];
const FRAME_IDS = new Set<string>(AVATAR_FRAMES.map((f) => f.id));

/** What a trainer picks. */
export interface Avatar {
  pokemonId: number;
  shiny: boolean;
  frame: AvatarFrame;
}

/** What everyone sees. */
export type PublicAvatar = Avatar;

/** What the account has earned: its trainer level and best ranked tier (Pokédle or the battle ladder). */
export interface AvatarUnlocks {
  level: number;
  tier: RankedTierId | null;
}

/** Trainer level from XP: the same curve as levelInfo in lib/progress (which is client-only). */
export const levelFromXp = (xp: number) => Math.floor(Math.sqrt(Math.max(0, xp) / 50)) + 1;

const tierRank = (tier: RankedTierId | null) => (tier ? RANKED_TIERS.findIndex((t) => t.id === tier) : -1);

/** The best tier these ratings reach (Poké Ball counts as none). */
export function bestTier(ratings: readonly number[]): RankedTierId | null {
  const top = Math.max(-Infinity, ...ratings);
  const t = [...RANKED_TIERS].reverse().find((x) => top >= x.from);
  return t && t.id !== "poke" ? t.id : null;
}

export const shinyUnlocked = (u: AvatarUnlocks) => u.level >= SHINY_LEVEL;

export function frameUnlocked(frame: AvatarFrame, u: AvatarUnlocks): boolean {
  const f = AVATAR_FRAMES.find((x) => x.id === frame);
  if (!f) return false;
  if ("level" in f) return u.level >= f.level;
  if ("tier" in f) return tierRank(u.tier) >= tierRank(f.tier);
  return true;
}

/** How to unlock a frame ("Reach trainer level 15"). */
export function frameHint(frame: AvatarFrame): string {
  const f = AVATAR_FRAMES.find((x) => x.id === frame)!;
  if ("level" in f) return `Reach trainer level ${f.level}`;
  if ("tier" in f) return `Reach ${f.name} in ranked Pokédle or the battle ladder`;
  return "";
}

export const SHINY_HINT = `Reach trainer level ${SHINY_LEVEL}`;

/** A well-formed avatar (any frame), or null. */
export function parseAvatar(raw: unknown): Avatar | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = r.pokemonId;
  if (typeof id !== "number" || !Number.isInteger(id) || id < 1 || id > AVATAR_MAX_ID) return null;
  if (typeof r.shiny !== "boolean" || typeof r.frame !== "string" || !FRAME_IDS.has(r.frame)) return null;
  return { pokemonId: id, shiny: r.shiny, frame: r.frame as AvatarFrame };
}

/** A trainer's choice, checked against what they've unlocked. */
export function checkAvatar(raw: unknown, u: AvatarUnlocks): { ok: true; avatar: Avatar } | { ok: false; error: string } {
  const a = parseAvatar(raw);
  if (!a) return { ok: false, error: `Pick a Pokémon from #1 to #${AVATAR_MAX_ID}.` };
  if (a.shiny && !shinyUnlocked(u)) return { ok: false, error: `Shiny avatars unlock at trainer level ${SHINY_LEVEL}.` };
  if (!frameUnlocked(a.frame, u)) return { ok: false, error: `That frame is locked: ${frameHint(a.frame).toLowerCase()}.` };
  return { ok: true, avatar: a };
}

/** A new account's avatar: a Pokémon picked by its name (the same name always gets the same one). */
export function defaultAvatar(username: string): Avatar {
  let h = 0x811c9dc5;
  for (const ch of username.toLowerCase()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return { pokemonId: (h % AVATAR_MAX_ID) + 1, shiny: false, frame: "none" };
}

/** The image to show. */
export function avatarSrc(a: PublicAvatar, large = false): string {
  return artUrl(a.pokemonId, large ? 256 : 96, a.shiny);
}

/** Avatars by lower-cased trainer name, for views that list names (only accounts are in it). */
export type AvatarMap = Record<string, PublicAvatar>;

/** The trainer's own avatar settings, as GET /api/avatar returns them. */
export interface AvatarSettings {
  /** Choices can be saved (false before the migration: everyone shows their default). */
  available: boolean;
  avatar: Avatar;
  unlocks: AvatarUnlocks;
}
