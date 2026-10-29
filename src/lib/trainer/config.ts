import { RANKED_TIERS, type RankedTierId } from "../ranked";
import { AVATAR_MAX_ID, shinyUnlocked, type AvatarUnlocks } from "../avatar";

/**
 * 3D trainer avatars: a chibi trainer built from presets (no free text),
 * with a partner Pokémon at their side. The config is small JSON kept on
 * the account (migration 0047: profiles.trainer), checked on the server
 * against what the account has unlocked (badges and ranked tiers), and
 * drawn by <Avatar3D> (live 3D) or <TrainerPortrait> (a small SVG bust for
 * names in lists). Shared by the server and the pages.
 */

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/** What it takes to unlock an item: a number of badges, or a ranked tier. Nothing: free. */
export interface Unlock {
  badges?: number;
  tier?: RankedTierId;
}

export interface Preset<Id extends string = string> extends Unlock {
  id: Id;
  name: string;
}

export interface Swatch<Id extends string = string> extends Preset<Id> {
  hex: string;
}

export const BODIES = [
  { id: "sturdy", name: "Sturdy" },
  { id: "slim", name: "Slim" },
] as const satisfies readonly Preset[];

export const SKINS = [
  { id: "s1", name: "Porcelain", hex: "#ffe3cf" },
  { id: "s2", name: "Light", hex: "#f6cfa8" },
  { id: "s3", name: "Warm", hex: "#e6ad84" },
  { id: "s4", name: "Tan", hex: "#c98c60" },
  { id: "s5", name: "Brown", hex: "#9b643f" },
  { id: "s6", name: "Deep", hex: "#6a4229" },
] as const satisfies readonly Swatch[];

export const EYES = [
  { id: "round", name: "Bright" },
  { id: "happy", name: "Happy" },
  { id: "focused", name: "Focused" },
] as const satisfies readonly Preset[];

export const HAIRS = [
  { id: "short", name: "Short" },
  { id: "spiky", name: "Spiky" },
  { id: "swept", name: "Swept" },
  { id: "buzz", name: "Buzz" },
  { id: "bob", name: "Bob" },
  { id: "ponytail", name: "Ponytail" },
  { id: "long", name: "Long" },
  { id: "buns", name: "Buns" },
  { id: "curly", name: "Curly" },
] as const satisfies readonly Preset[];

export const HAIR_COLORS = [
  { id: "black", name: "Black", hex: "#25202a" },
  { id: "espresso", name: "Espresso", hex: "#4a2e22" },
  { id: "brown", name: "Brown", hex: "#7b4a2b" },
  { id: "auburn", name: "Auburn", hex: "#a5432a" },
  { id: "ginger", name: "Ginger", hex: "#de7a33" },
  { id: "blonde", name: "Blonde", hex: "#ecc76d" },
  { id: "platinum", name: "Platinum", hex: "#f1e8d2" },
  { id: "silver", name: "Silver", hex: "#b9bfca" },
  { id: "blue", name: "Blue", hex: "#3d6fd8" },
  { id: "teal", name: "Teal", hex: "#26a59a" },
  { id: "green", name: "Green", hex: "#4caf6b" },
  { id: "pink", name: "Pink", hex: "#f07cb2" },
  { id: "purple", name: "Purple", hex: "#8657d6" },
  { id: "red", name: "Red", hex: "#d43b3b" },
] as const satisfies readonly Swatch[];

/** Clothing colours (hats, tops, bottoms, shoes, packs). */
export const COLORS = [
  { id: "red", name: "Red", hex: "#e23d3f" },
  { id: "orange", name: "Orange", hex: "#f28b26" },
  { id: "yellow", name: "Yellow", hex: "#f6c624" },
  { id: "lime", name: "Lime", hex: "#93c94a" },
  { id: "green", name: "Green", hex: "#2f9e5c" },
  { id: "teal", name: "Teal", hex: "#1ea5a0" },
  { id: "sky", name: "Sky", hex: "#3fa9ea" },
  { id: "blue", name: "Blue", hex: "#2f5fd0" },
  { id: "navy", name: "Navy", hex: "#27375f" },
  { id: "purple", name: "Purple", hex: "#7b50c9" },
  { id: "pink", name: "Pink", hex: "#ef6fa7" },
  { id: "white", name: "White", hex: "#f3f3ef" },
  { id: "grey", name: "Grey", hex: "#8b919b" },
  { id: "charcoal", name: "Charcoal", hex: "#363940" },
  { id: "black", name: "Black", hex: "#1d1e22" },
  { id: "brown", name: "Brown", hex: "#8a5a3b" },
  { id: "khaki", name: "Khaki", hex: "#c9b182" },
  { id: "gold", name: "Gold", hex: "#e9b526", badges: 12 },
  { id: "master", name: "Master", hex: "#8e3fd6", tier: "master" },
] as const satisfies readonly Swatch[];

export const HATS = [
  { id: "none", name: "No hat" },
  { id: "cap", name: "Cap" },
  { id: "backcap", name: "Backwards cap" },
  { id: "beanie", name: "Beanie" },
  { id: "bucket", name: "Bucket hat" },
  { id: "visor", name: "Visor" },
  { id: "safari", name: "Safari hat", badges: 5 },
  { id: "ace", name: "Ace cap", tier: "great" },
  { id: "champion", name: "Champion cap", tier: "master" },
] as const satisfies readonly Preset[];

export const TOPS = [
  { id: "tee", name: "Tee" },
  { id: "jacket", name: "Jacket" },
  { id: "hoodie", name: "Hoodie" },
  { id: "vest", name: "Vest" },
  { id: "track", name: "Track jacket", badges: 3 },
  { id: "coat", name: "Long coat", tier: "ultra" },
] as const satisfies readonly Preset[];

export const BOTTOMS = [
  { id: "shorts", name: "Shorts" },
  { id: "pants", name: "Pants" },
  { id: "joggers", name: "Joggers" },
  { id: "skirt", name: "Skirt" },
] as const satisfies readonly Preset[];

export const SHOES = [
  { id: "sneakers", name: "Sneakers" },
  { id: "hightops", name: "High-tops" },
  { id: "boots", name: "Boots" },
] as const satisfies readonly Preset[];

export const GLOVES = [
  { id: "none", name: "No gloves" },
  { id: "fingerless", name: "Fingerless" },
  { id: "full", name: "Gloves" },
] as const satisfies readonly Preset[];

export const PACKS = [
  { id: "none", name: "No bag" },
  { id: "classic", name: "Backpack" },
  { id: "satchel", name: "Satchel" },
  { id: "explorer", name: "Explorer pack", badges: 8 },
] as const satisfies readonly Preset[];

export const BALLS = [
  { id: "poke", name: "Poké Ball" },
  { id: "great", name: "Great Ball", tier: "great" },
  { id: "ultra", name: "Ultra Ball", tier: "ultra" },
  { id: "master", name: "Master Ball", tier: "master" },
] as const satisfies readonly Preset[];

type Ids<T extends readonly { id: string }[]> = T[number]["id"];
export type BodyId = Ids<typeof BODIES>;
export type SkinId = Ids<typeof SKINS>;
export type EyesId = Ids<typeof EYES>;
export type HairId = Ids<typeof HAIRS>;
export type HairColorId = Ids<typeof HAIR_COLORS>;
export type ColorId = Ids<typeof COLORS>;
export type HatId = Ids<typeof HATS>;
export type TopId = Ids<typeof TOPS>;
export type BottomsId = Ids<typeof BOTTOMS>;
export type ShoesId = Ids<typeof SHOES>;
export type GlovesId = Ids<typeof GLOVES>;
export type PackId = Ids<typeof PACKS>;
export type BallId = Ids<typeof BALLS>;

/** A trainer: every field is a preset id (or the partner's National Dex number). */
export interface TrainerConfig {
  v: 1;
  body: BodyId;
  skin: SkinId;
  eyes: EyesId;
  hair: HairId;
  hairColor: HairColorId;
  hat: HatId;
  hatColor: ColorId;
  top: TopId;
  topColor: ColorId;
  /** The second clothing colour: the shirt under a jacket, stripes, gloves and trims. */
  accent: ColorId;
  bottoms: BottomsId;
  bottomsColor: ColorId;
  shoes: ShoesId;
  shoesColor: ColorId;
  gloves: GlovesId;
  pack: PackId;
  packColor: ColorId;
  ball: BallId;
  /** The partner Pokémon at their side (1–1025). */
  partner: number;
  /** Shiny partner (only once shiny avatars are unlocked). */
  shiny: boolean;
}

/** Poses <Avatar3D> can play. */
export type TrainerPose = "idle" | "wave" | "fight";
/** Which way the trainer turns: towards the viewer, or three-quarters to one side (duel screens). */
export type TrainerFacing = "front" | "left" | "right";

/** Each field's presets: the creator's sections and the server's checks read this. */
export const TRAINER_FIELDS = {
  body: BODIES,
  skin: SKINS,
  eyes: EYES,
  hair: HAIRS,
  hairColor: HAIR_COLORS,
  hat: HATS,
  hatColor: COLORS,
  top: TOPS,
  topColor: COLORS,
  accent: COLORS,
  bottoms: BOTTOMS,
  bottomsColor: COLORS,
  shoes: SHOES,
  shoesColor: COLORS,
  gloves: GLOVES,
  pack: PACKS,
  packColor: COLORS,
  ball: BALLS,
} as const satisfies Record<Exclude<keyof TrainerConfig, "v" | "partner" | "shiny">, readonly Preset[]>;

export type TrainerField = keyof typeof TRAINER_FIELDS;
export const TRAINER_FIELD_KEYS = Object.keys(TRAINER_FIELDS) as TrainerField[];

const byId = <T extends readonly Preset[]>(list: T, id: string): T[number] | undefined => list.find((p) => p.id === id);

/** A swatch's hex colour (falls back to the list's first). */
export function hexOf(list: readonly Swatch[], id: string): string {
  return (byId(list, id) as Swatch | undefined)?.hex ?? list[0].hex;
}

export const colorHex = (id: ColorId) => hexOf(COLORS, id);
export const hairHex = (id: HairColorId) => hexOf(HAIR_COLORS, id);
export const skinHex = (id: SkinId) => hexOf(SKINS, id);

// ---------------------------------------------------------------------------
// Unlocks
// ---------------------------------------------------------------------------

const tierRank = (tier: RankedTierId | null | undefined) => (tier ? RANKED_TIERS.findIndex((t) => t.id === tier) : -1);

export function unlocked(item: Preset, u: AvatarUnlocks): boolean {
  if (item.badges !== undefined && (u.badges ?? 0) < item.badges) return false;
  if (item.tier !== undefined && tierRank(u.tier) < tierRank(item.tier)) return false;
  return true;
}

/** How to unlock an item, for the lock's tooltip. */
export function unlockHint(item: Preset): string {
  if (item.badges !== undefined) return `Earn ${item.badges} badges`;
  if (item.tier !== undefined) return `Reach ${RANKED_TIERS.find((t) => t.id === item.tier)!.name} in a ranked mode`;
  return "";
}

// ---------------------------------------------------------------------------
// Parsing and checking
// ---------------------------------------------------------------------------

/** A well-formed trainer (any items, locked or not), or null. Unknown keys are dropped. */
export function parseTrainer(raw: unknown): TrainerConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return null;
  const out: Record<string, unknown> = { v: 1 };
  for (const key of TRAINER_FIELD_KEYS) {
    const value = r[key];
    if (typeof value !== "string" || !byId(TRAINER_FIELDS[key], value)) return null;
    out[key] = value;
  }
  const partner = r.partner;
  if (typeof partner !== "number" || !Number.isInteger(partner) || partner < 1 || partner > AVATAR_MAX_ID) return null;
  if (typeof r.shiny !== "boolean") return null;
  out.partner = partner;
  out.shiny = r.shiny;
  return out as unknown as TrainerConfig;
}

/** The items in this trainer the account hasn't unlocked yet (field and preset). */
export function lockedItems(t: TrainerConfig, u: AvatarUnlocks): { field: TrainerField; item: Preset }[] {
  const out: { field: TrainerField; item: Preset }[] = [];
  for (const key of TRAINER_FIELD_KEYS) {
    const item = byId(TRAINER_FIELDS[key], t[key]) as Preset;
    if (!unlocked(item, u)) out.push({ field: key, item });
  }
  return out;
}

/** A trainer's choices, checked against what the account has unlocked. */
export function checkTrainer(raw: unknown, u: AvatarUnlocks): { ok: true; trainer: TrainerConfig } | { ok: false; error: string } {
  const t = parseTrainer(raw);
  if (!t) return { ok: false, error: "That trainer isn't one the creator can make." };
  if (t.shiny && !shinyUnlocked(u)) return { ok: false, error: "Keep playing to unlock shiny Pokémon." };
  const locked = lockedItems(t, u)[0];
  if (locked) return { ok: false, error: `${locked.item.name} is locked: ${unlockHint(locked.item).toLowerCase()}.` };
  return { ok: true, trainer: t };
}

// ---------------------------------------------------------------------------
// Starting points
// ---------------------------------------------------------------------------

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (const ch of text.toLowerCase()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const free = <T extends readonly Preset[]>(list: T): T[number][] => list.filter((p) => p.badges === undefined && p.tier === undefined);

/** A trainer picked from a seed (a name): the same seed always gets the same free-item trainer. */
export function seededTrainer(seed: string, partner = 25, shiny = false): TrainerConfig {
  let h = hash(seed) || 1;
  const pick = <T extends readonly Preset[]>(list: T): T[number]["id"] => {
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    h = (h ^ (h >>> 12)) >>> 0;
    const options = free(list);
    return options[h % options.length].id;
  };
  const clothing = ["red", "blue", "navy", "teal", "green", "orange", "purple", "charcoal", "sky", "pink", "yellow", "white", "black"] as const;
  const colour = () => clothing[(h = (Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0)) % clothing.length];
  return {
    v: 1,
    body: pick(BODIES),
    skin: pick(SKINS),
    eyes: pick(EYES),
    hair: pick(HAIRS),
    hairColor: pick(HAIR_COLORS),
    hat: pick(HATS),
    hatColor: colour(),
    top: pick(TOPS),
    topColor: colour(),
    accent: colour(),
    bottoms: pick(BOTTOMS),
    bottomsColor: (["navy", "charcoal", "black", "khaki", "blue", "brown"] as const)[h % 6],
    shoes: pick(SHOES),
    shoesColor: colour(),
    gloves: pick(GLOVES),
    pack: pick(PACKS),
    packColor: colour(),
    ball: "poke",
    partner,
    shiny,
  };
}

/** The creator's first trainer: a classic look with the account's avatar Pokémon as partner. */
export function starterTrainer(partner = 25, shiny = false): TrainerConfig {
  return {
    v: 1,
    body: "sturdy",
    skin: "s2",
    eyes: "round",
    hair: "spiky",
    hairColor: "black",
    hat: "cap",
    hatColor: "red",
    top: "jacket",
    topColor: "blue",
    accent: "white",
    bottoms: "pants",
    bottomsColor: "navy",
    shoes: "sneakers",
    shoesColor: "red",
    gloves: "fingerless",
    pack: "classic",
    packColor: "green",
    ball: "poke",
    partner,
    shiny,
  };
}
