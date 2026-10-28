import { RANKED_TIERS, type RankedTierId } from "./ranked";
import { artUrl } from "./pokemon/art";

/**
 * Profile pictures: any Pokémon (shiny once you have played a while) in a
 * frame earned by playing or by ranked tiers, or a picture of their own
 * once a moderator has approved it. Shared by the server, which checks
 * every choice against what the account has unlocked, and the pages.
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

/** What everyone sees: the Pokémon, or the trainer's approved picture (its id) in the same frame. */
export interface PublicAvatar extends Avatar {
  picture?: string;
}

/** What the account has earned: how much it has played (an activity level from its synced play, never shown) and its best ranked tier. */
export interface AvatarUnlocks {
  level: number;
  tier: RankedTierId | null;
}

/** Activity level from synced play (the old XP curve, kept so nobody loses an unlock). */
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

/** How to unlock a frame. */
export function frameHint(frame: AvatarFrame): string {
  const f = AVATAR_FRAMES.find((x) => x.id === frame)!;
  if ("level" in f) return `Keep playing to earn the ${f.name} frame`;
  if ("tier" in f) return `Reach ${f.name} in ranked Pokédle or the battle ladder`;
  return "";
}

export const SHINY_HINT = "Keep playing to unlock shiny Pokémon";

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

/** An uploaded picture's id: random, URL-safe. */
export const PICTURE_ID_RE = /^[A-Za-z0-9_-]{16,32}$/;

/** An uploaded picture's image (64 or 256 px). */
export const pictureSrc = (id: string, large = false) => `/api/avatar/img/${id}?s=${large ? 256 : 64}`;

/** The image to show: the approved picture, else the Pokémon's artwork. */
export function avatarSrc(a: PublicAvatar, large = false): string {
  if (a.picture && PICTURE_ID_RE.test(a.picture)) return pictureSrc(a.picture, large);
  return artUrl(a.pokemonId, large ? 256 : 96, a.shiny);
}

/** Avatars by lower-cased trainer name, for views that list names (only accounts are in it). */
export type AvatarMap = Record<string, PublicAvatar>;

// ---------------------------------------------------------------------------
// Uploaded pictures
// ---------------------------------------------------------------------------

export const PICTURE_MAX_BYTES = 2 * 1024 * 1024;
export const PICTURE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const PICTURES_PER_DAY = 5;
export const PICTURE_STRIKE_LIMIT = 3;

export type PictureStatus = "pending" | "approved" | "rejected" | "deleted";

/** The trainer's own avatar settings, as GET /api/avatar returns them. */
export interface AvatarSettings {
  /** Choices can be saved (false before the migration: everyone shows their default). */
  available: boolean;
  avatar: Avatar;
  /** Show "My picture" (once one is approved) instead of the Pokémon. */
  usePicture: boolean;
  unlocks: AvatarUnlocks;
  pictures: {
    /** Uploading is open here (false: "opening soon"). */
    open: boolean;
    /** The approved picture, and the one waiting for review. */
    approved: string | null;
    pending: { id: string; at: number } | null;
    /** Uploads left today. */
    left: number;
    /** Why this trainer can't upload right now (strikes, a ban or a mute), or null. */
    blocked: string | null;
  };
}

/** A picture waiting for review, as moderators see it. */
export interface PendingPicture {
  id: string;
  username: string;
  at: number;
}
