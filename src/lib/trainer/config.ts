import { RANKED_TIERS, type RankedTierId } from "../ranked";
import { AVATAR_MAX_ID, shinyUnlocked, type AvatarUnlocks } from "../avatar";

/**
 * 3D trainer avatars: a chibi trainer built from presets (no free text).
 * The config is small JSON kept on the account (migration 0047:
 * profiles.trainer, at most 1 KB), checked on the server against what the
 * account has unlocked (badges and ranked tiers), and drawn by <Avatar3D>
 * (live 3D) or <TrainerPortrait> (a small SVG bust for names in lists).
 * Shared by the server and the pages.
 *
 * Versions: v1 configs (the first creator) still load. Every field added
 * since then has a default worked out from the v1 fields (see `upgrade`),
 * so an old trainer looks the same and saves back as v2.
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

/** Eye shapes. */
export const EYES = [
  { id: "round", name: "Bright" },
  { id: "happy", name: "Closed" },
  { id: "focused", name: "Focused" },
  { id: "sharp", name: "Sharp" },
  { id: "lashes", name: "Lashes" },
  { id: "squint", name: "Squint" },
] as const satisfies readonly Preset[];

export const EYE_COLORS = [
  { id: "dark", name: "Dark", hex: "#2a1c18" },
  { id: "brown", name: "Brown", hex: "#6b3f24" },
  { id: "amber", name: "Amber", hex: "#c98a1e" },
  { id: "blue", name: "Blue", hex: "#3566b8" },
  { id: "ice", name: "Ice", hex: "#6aa4c8" },
  { id: "teal", name: "Teal", hex: "#1f9a94" },
  { id: "green", name: "Green", hex: "#3f8a45" },
  { id: "grey", name: "Grey", hex: "#5d6573" },
  { id: "violet", name: "Violet", hex: "#7046b0" },
  { id: "red", name: "Red", hex: "#b52f36" },
] as const satisfies readonly Swatch[];

/** Expressions: brows, lids and mouth. */
export const EXPRESSIONS = [
  { id: "happy", name: "Happy" },
  { id: "determined", name: "Determined" },
  { id: "smug", name: "Smug" },
  { id: "calm", name: "Calm" },
  { id: "sleepy", name: "Sleepy" },
  { id: "surprised", name: "Surprised" },
] as const satisfies readonly Preset[];

export const HAIRS = [
  { id: "short", name: "Short" },
  { id: "spiky", name: "Spiky" },
  { id: "spikyup", name: "Upswept" },
  { id: "swept", name: "Swept" },
  { id: "quiff", name: "Swept back" },
  { id: "buzz", name: "Buzz" },
  { id: "bob", name: "Bob" },
  { id: "ponytail", name: "Ponytail" },
  { id: "sidetail", name: "Side tail" },
  { id: "twintails", name: "Twin tails" },
  { id: "long", name: "Long" },
  { id: "flowing", name: "Flowing" },
  { id: "volume", name: "Big sweep" },
  { id: "buns", name: "Buns" },
  { id: "curly", name: "Curly" },
] as const satisfies readonly Preset[];

/** The fringe: "auto" is the style's own. */
export const BANGS = [
  { id: "auto", name: "Style's own" },
  { id: "tufts", name: "Tufts" },
  { id: "blunt", name: "Blunt" },
  { id: "side", name: "Side sweep" },
  { id: "parted", name: "Parted" },
  { id: "spiky", name: "Spiky" },
  { id: "open", name: "None" },
] as const satisfies readonly Preset[];

export const HAIR_COLORS = [
  { id: "black", name: "Black", hex: "#25202a" },
  { id: "navy", name: "Midnight", hex: "#2c3352" },
  { id: "espresso", name: "Espresso", hex: "#4a2e22" },
  { id: "brown", name: "Brown", hex: "#7b4a2b" },
  { id: "chestnut", name: "Chestnut", hex: "#93481f" },
  { id: "auburn", name: "Auburn", hex: "#a5432a" },
  { id: "ginger", name: "Ginger", hex: "#de7a33" },
  { id: "orange", name: "Orange", hex: "#f2742a" },
  { id: "honey", name: "Honey", hex: "#d6b27c" },
  { id: "blonde", name: "Blonde", hex: "#ecc76d" },
  { id: "platinum", name: "Platinum", hex: "#f1e8d2" },
  { id: "ash", name: "Ash grey", hex: "#b3aa94" },
  { id: "silver", name: "Silver", hex: "#b9bfca" },
  { id: "ice", name: "Ice blue", hex: "#a8d4de" },
  { id: "blue", name: "Blue", hex: "#3d6fd8" },
  { id: "teal", name: "Teal", hex: "#26a59a" },
  { id: "mint", name: "Mint", hex: "#a5c993" },
  { id: "green", name: "Green", hex: "#4caf6b" },
  { id: "pink", name: "Pink", hex: "#f07cb2" },
  { id: "magenta", name: "Magenta", hex: "#a3192f" },
  { id: "violet", name: "Violet", hex: "#6a5ea8" },
  { id: "purple", name: "Purple", hex: "#8657d6" },
  { id: "red", name: "Red", hex: "#d43b3b" },
] as const satisfies readonly Swatch[];

/** Clothing colours (hats, tops, bottoms, shoes, bags, capes, trims). */
export const COLORS = [
  { id: "red", name: "Red", hex: "#e23d3f" },
  { id: "cherry", name: "Cherry", hex: "#c8505e" },
  { id: "crimson", name: "Crimson", hex: "#9c2233" },
  { id: "orange", name: "Orange", hex: "#f28b26" },
  { id: "yellow", name: "Yellow", hex: "#f6c624" },
  { id: "mustard", name: "Mustard", hex: "#d9a93a" },
  { id: "lime", name: "Lime", hex: "#93c94a" },
  { id: "olive", name: "Olive", hex: "#6c9450" },
  { id: "green", name: "Green", hex: "#2f9e5c" },
  { id: "forest", name: "Forest", hex: "#1f4a3c" },
  { id: "teal", name: "Teal", hex: "#1ea5a0" },
  { id: "sky", name: "Sky", hex: "#3fa9ea" },
  { id: "denim", name: "Denim", hex: "#86aedb" },
  { id: "blue", name: "Blue", hex: "#2f5fd0" },
  { id: "navy", name: "Navy", hex: "#27375f" },
  { id: "violet", name: "Violet", hex: "#6c5fa3" },
  { id: "purple", name: "Purple", hex: "#7b50c9" },
  { id: "pink", name: "Pink", hex: "#ef6fa7" },
  { id: "rose", name: "Rose", hex: "#eea3a6" },
  { id: "white", name: "White", hex: "#f3f3ef" },
  { id: "grey", name: "Grey", hex: "#8b919b" },
  { id: "charcoal", name: "Charcoal", hex: "#363940" },
  { id: "black", name: "Black", hex: "#1d1e22" },
  { id: "brown", name: "Brown", hex: "#8a5a3b" },
  { id: "camel", name: "Camel", hex: "#d9a35b" },
  { id: "khaki", name: "Khaki", hex: "#c9b182" },
  { id: "gold", name: "Gold", hex: "#e9b526", badges: 12 },
  { id: "master", name: "Master", hex: "#8e3fd6", tier: "master" },
] as const satisfies readonly Swatch[];

export const HATS = [
  { id: "none", name: "No hat" },
  { id: "cap", name: "Cap" },
  { id: "league", name: "League cap" },
  { id: "ballcap", name: "Poké Ball cap" },
  { id: "twotone", name: "Two-tone cap" },
  { id: "crown", name: "Crown cap" },
  { id: "backcap", name: "Backwards cap" },
  { id: "beanie", name: "Beanie" },
  { id: "beret", name: "Beret" },
  { id: "sunhat", name: "Sun hat" },
  { id: "bucket", name: "Bucket hat" },
  { id: "visor", name: "Visor" },
  { id: "headband", name: "Headband" },
  { id: "safari", name: "Safari hat", badges: 5 },
  { id: "ace", name: "Ace cap", tier: "great" },
  { id: "champion", name: "Champion cap", tier: "master" },
] as const satisfies readonly Preset[];

export const TOPS = [
  { id: "tee", name: "Tee" },
  { id: "longtee", name: "Long tee" },
  { id: "tank", name: "Sleeveless" },
  { id: "croptop", name: "Crop top" },
  { id: "shirt", name: "Shirt" },
  { id: "jacket", name: "Jacket" },
  { id: "hoodie", name: "Hoodie" },
  { id: "vest", name: "Vest" },
  { id: "suit", name: "Suit jacket" },
  { id: "uniform", name: "Uniform" },
  { id: "labcoat", name: "Lab coat" },
  { id: "longcoat", name: "Long coat" },
  { id: "dress", name: "Dress" },
  { id: "track", name: "Track jacket", badges: 3 },
  { id: "coat", name: "Ace coat", tier: "ultra" },
] as const satisfies readonly Preset[];

/** What a tee, uniform or cape shows on it (in the top's trim colour). */
export const EMBLEMS = [
  { id: "none", name: "None" },
  { id: "badge", name: "Badge" },
  { id: "ball", name: "Poké Ball" },
  { id: "star", name: "Star" },
  { id: "bolt", name: "Bolt" },
  { id: "flame", name: "Flame" },
  { id: "drop", name: "Drop" },
  { id: "leaf", name: "Leaf" },
  { id: "letter", name: "Letter R" },
] as const satisfies readonly Preset[];

export const BOTTOMS = [
  { id: "shorts", name: "Shorts" },
  { id: "pants", name: "Pants" },
  { id: "flared", name: "Flared" },
  { id: "joggers", name: "Joggers" },
  { id: "skirt", name: "Skirt" },
  { id: "suspenders", name: "Suspenders" },
  { id: "overalls", name: "Overalls" },
] as const satisfies readonly Preset[];

/** Socks and tights (in the bottoms' trim colour). */
export const LEGWEAR = [
  { id: "none", name: "None" },
  { id: "socks", name: "Socks" },
  { id: "knee", name: "Knee socks" },
  { id: "thigh", name: "Thigh-highs" },
  { id: "tights", name: "Tights" },
] as const satisfies readonly Preset[];

export const SHOES = [
  { id: "sneakers", name: "Sneakers" },
  { id: "hightops", name: "High-tops" },
  { id: "boots", name: "Boots" },
  { id: "tallboots", name: "Tall boots" },
  { id: "formal", name: "Dress shoes" },
] as const satisfies readonly Preset[];

export const GLOVES = [
  { id: "none", name: "No gloves" },
  { id: "fingerless", name: "Fingerless" },
  { id: "full", name: "Gloves" },
  { id: "long", name: "Long gloves" },
] as const satisfies readonly Preset[];

export const PACKS = [
  { id: "none", name: "No bag" },
  { id: "classic", name: "Backpack" },
  { id: "satchel", name: "Satchel" },
  { id: "shoulder", name: "Shoulder bag" },
  { id: "pouch", name: "Belt pouch" },
  { id: "explorer", name: "Explorer pack", badges: 8 },
] as const satisfies readonly Preset[];

export const CAPES = [
  { id: "none", name: "No cape" },
  { id: "short", name: "Short cape" },
  { id: "long", name: "Long cape" },
  { id: "collar", name: "High collar" },
  { id: "royal", name: "Royal cape" },
] as const satisfies readonly Preset[];

export const EYEWEAR = [
  { id: "none", name: "None" },
  { id: "glasses", name: "Glasses" },
  { id: "round", name: "Round glasses" },
  { id: "sunglasses", name: "Sunglasses" },
] as const satisfies readonly Preset[];

export const NECKWEAR = [
  { id: "none", name: "None" },
  { id: "scarf", name: "Scarf" },
  { id: "pendant", name: "Pendant" },
  { id: "cravat", name: "Cravat" },
  { id: "tie", name: "Tie" },
  { id: "choker", name: "Choker" },
] as const satisfies readonly Preset[];

export const WRISTWEAR = [
  { id: "none", name: "None" },
  { id: "bands", name: "Wristbands" },
  { id: "bracelets", name: "Bracelets" },
  { id: "watch", name: "Watch" },
] as const satisfies readonly Preset[];

export const HAIR_ACCESSORIES = [
  { id: "none", name: "None" },
  { id: "clips", name: "Hair clips" },
  { id: "ornaments", name: "Ornaments" },
  { id: "ribbons", name: "Ribbon tufts" },
  { id: "bow", name: "Bow" },
  { id: "flower", name: "Flower" },
] as const satisfies readonly Preset[];

export const EARRINGS = [
  { id: "none", name: "None" },
  { id: "studs", name: "Studs" },
  { id: "drops", name: "Drops" },
  { id: "hoops", name: "Hoops" },
] as const satisfies readonly Preset[];

export const BALLS = [
  { id: "poke", name: "Poké Ball" },
  { id: "great", name: "Great Ball", tier: "great" },
  { id: "ultra", name: "Ultra Ball", tier: "ultra" },
  { id: "master", name: "Master Ball", tier: "master" },
] as const satisfies readonly Preset[];

/**
 * Backdrops behind the trainer (creator and profile): CSS only, no images.
 * `sky` is the top of the gradient, `ground` the floor, `glow` a soft light.
 */
export interface Stage extends Preset {
  sky: string;
  ground: string;
  glow: string;
  /** Gym floor lines, or stars. */
  pattern?: "gym" | "stars" | "rays";
}

export const STAGES = [
  { id: "plain", name: "Plain", sky: "transparent", ground: "transparent", glow: "transparent" },
  { id: "kanto", name: "Kanto", sky: "#9fd3f2", ground: "#7fbf6a", glow: "#fff4c2" },
  { id: "johto", name: "Johto", sky: "#f3c38c", ground: "#b98a52", glow: "#ffe2a8" },
  { id: "hoenn", name: "Hoenn", sky: "#6fd0e0", ground: "#e8d39a", glow: "#e9fbff" },
  { id: "sinnoh", name: "Sinnoh", sky: "#b9c8ef", ground: "#e9eef8", glow: "#ffffff" },
  { id: "unova", name: "Unova", sky: "#8a97b8", ground: "#5c6378", glow: "#ffd98a" },
  { id: "kalos", name: "Kalos", sky: "#f6b8c8", ground: "#c9a7d9", glow: "#fff0f4" },
  { id: "alola", name: "Alola", sky: "#ffb27a", ground: "#f2dba1", glow: "#fff1b8" },
  { id: "galar", name: "Galar", sky: "#7b8fc9", ground: "#4f8a5a", glow: "#e9e3ff" },
  { id: "paldea", name: "Paldea", sky: "#f2b45c", ground: "#c46f4a", glow: "#fff0c9" },
  { id: "gym", name: "Gym", sky: "#3a4256", ground: "#c9b48a", glow: "#fff6d6", pattern: "gym" },
  { id: "stadium", name: "Stadium", sky: "#1e2b4a", ground: "#3f7a4a", glow: "#d6ecff", pattern: "rays", badges: 5 },
  { id: "hall", name: "Champion hall", sky: "#3b1f4f", ground: "#c9a54a", glow: "#ffe08a", pattern: "rays", badges: 10 },
  { id: "space", name: "Starfield", sky: "#0e1030", ground: "#2a2560", glow: "#a9b6ff", pattern: "stars", badges: 20 },
] as const satisfies readonly Stage[];

type Ids<T extends readonly { id: string }[]> = T[number]["id"];
export type BodyId = Ids<typeof BODIES>;
export type SkinId = Ids<typeof SKINS>;
export type EyesId = Ids<typeof EYES>;
export type EyeColorId = Ids<typeof EYE_COLORS>;
export type ExpressionId = Ids<typeof EXPRESSIONS>;
export type HairId = Ids<typeof HAIRS>;
export type BangsId = Ids<typeof BANGS>;
export type HairColorId = Ids<typeof HAIR_COLORS>;
export type ColorId = Ids<typeof COLORS>;
export type HatId = Ids<typeof HATS>;
export type TopId = Ids<typeof TOPS>;
export type EmblemId = Ids<typeof EMBLEMS>;
export type BottomsId = Ids<typeof BOTTOMS>;
export type LegwearId = Ids<typeof LEGWEAR>;
export type ShoesId = Ids<typeof SHOES>;
export type GlovesId = Ids<typeof GLOVES>;
export type PackId = Ids<typeof PACKS>;
export type CapeId = Ids<typeof CAPES>;
export type EyewearId = Ids<typeof EYEWEAR>;
export type NeckId = Ids<typeof NECKWEAR>;
export type WristId = Ids<typeof WRISTWEAR>;
export type HairAccId = Ids<typeof HAIR_ACCESSORIES>;
export type EarsId = Ids<typeof EARRINGS>;
export type BallId = Ids<typeof BALLS>;
export type StageId = Ids<typeof STAGES>;

/** A trainer: every field is a preset id (or the partner's National Dex number, or a flag). */
export interface TrainerConfig {
  v: 2;
  body: BodyId;
  skin: SkinId;
  eyes: EyesId;
  eyeColor: EyeColorId;
  expr: ExpressionId;
  hair: HairId;
  bangs: BangsId;
  hairColor: HairColorId;
  hat: HatId;
  hatColor: ColorId;
  hatTrim: ColorId;
  top: TopId;
  topColor: ColorId;
  /** Collars, cuffs, lapels, piping and the emblem. */
  topTrim: ColorId;
  /** The second clothing colour: the shirt under a jacket or coat, and stripes. */
  accent: ColorId;
  /** Jackets and coats done up. */
  closed: boolean;
  emblem: EmblemId;
  bottoms: BottomsId;
  bottomsColor: ColorId;
  /** Suspenders, stripes, socks and tights. */
  bottomsTrim: ColorId;
  legwear: LegwearId;
  shoes: ShoesId;
  shoesColor: ColorId;
  /** Soles, laces and toe caps. */
  shoesTrim: ColorId;
  gloves: GlovesId;
  glovesColor: ColorId;
  pack: PackId;
  packColor: ColorId;
  packTrim: ColorId;
  cape: CapeId;
  capeColor: ColorId;
  /** The cape's lining (or fur trim on a royal cape). */
  capeTrim: ColorId;
  eyewear: EyewearId;
  neck: NeckId;
  wrist: WristId;
  hairAcc: HairAccId;
  ears: EarsId;
  /** Accessories: frames, scarves, pendants, bands, clips and earrings. */
  accColor: ColorId;
  ball: BallId;
  stage: StageId;
  /** The partner Pokémon (1–1025; its sprite is not shown next to the 3D trainer). */
  partner: number;
  /** Shiny partner (only once shiny avatars are unlocked). */
  shiny: boolean;
}

/** Poses <Avatar3D> can play. */
export type TrainerPose = "idle" | "wave" | "fight" | "throw" | "victory" | "think";
export const TRAINER_POSES: readonly TrainerPose[] = ["idle", "wave", "fight", "throw", "victory", "think"];
/** Which way the trainer turns: towards the viewer, or three-quarters to one side (duel screens). */
export type TrainerFacing = "front" | "left" | "right";

/** Each field's presets: the creator's sections and the server's checks read this. */
export const TRAINER_FIELDS = {
  body: BODIES,
  skin: SKINS,
  eyes: EYES,
  eyeColor: EYE_COLORS,
  expr: EXPRESSIONS,
  hair: HAIRS,
  bangs: BANGS,
  hairColor: HAIR_COLORS,
  hat: HATS,
  hatColor: COLORS,
  hatTrim: COLORS,
  top: TOPS,
  topColor: COLORS,
  topTrim: COLORS,
  accent: COLORS,
  emblem: EMBLEMS,
  bottoms: BOTTOMS,
  bottomsColor: COLORS,
  bottomsTrim: COLORS,
  legwear: LEGWEAR,
  shoes: SHOES,
  shoesColor: COLORS,
  shoesTrim: COLORS,
  gloves: GLOVES,
  glovesColor: COLORS,
  pack: PACKS,
  packColor: COLORS,
  packTrim: COLORS,
  cape: CAPES,
  capeColor: COLORS,
  capeTrim: COLORS,
  eyewear: EYEWEAR,
  neck: NECKWEAR,
  wrist: WRISTWEAR,
  hairAcc: HAIR_ACCESSORIES,
  ears: EARRINGS,
  accColor: COLORS,
  ball: BALLS,
  stage: STAGES,
} as const satisfies Record<Exclude<keyof TrainerConfig, "v" | "partner" | "shiny" | "closed">, readonly Preset[]>;

export type TrainerField = keyof typeof TRAINER_FIELDS;
export const TRAINER_FIELD_KEYS = Object.keys(TRAINER_FIELDS) as TrainerField[];

/** The fields the first creator (v1) saved; everything else has a default (see `upgrade`). */
export const V1_FIELDS = ["body", "skin", "eyes", "hair", "hairColor", "hat", "hatColor", "top", "topColor", "accent", "bottoms", "bottomsColor", "shoes", "shoesColor", "gloves", "pack", "packColor", "ball"] as const satisfies readonly TrainerField[];
type V1Field = (typeof V1_FIELDS)[number];

const byId = <T extends readonly Preset[]>(list: T, id: string): T[number] | undefined => list.find((p) => p.id === id);

/** A swatch's hex colour (falls back to the list's first). */
export function hexOf(list: readonly Swatch[], id: string): string {
  return (byId(list, id) as Swatch | undefined)?.hex ?? list[0].hex;
}

export const colorHex = (id: ColorId) => hexOf(COLORS, id);
export const hairHex = (id: HairColorId) => hexOf(HAIR_COLORS, id);
export const skinHex = (id: SkinId) => hexOf(SKINS, id);
export const eyeHex = (id: EyeColorId) => hexOf(EYE_COLORS, id);
export const stageOf = (id: StageId): Stage => (byId(STAGES, id) as Stage | undefined) ?? STAGES[0];

/** The hair style's own fringe, for bangs "auto". */
export const HAIR_BANGS: Record<HairId, Exclude<BangsId, "auto">> = {
  short: "tufts",
  spiky: "spiky",
  spikyup: "open",
  swept: "side",
  quiff: "open",
  buzz: "open",
  bob: "blunt",
  ponytail: "tufts",
  sidetail: "tufts",
  twintails: "blunt",
  long: "tufts",
  flowing: "parted",
  volume: "parted",
  buns: "tufts",
  curly: "tufts",
};

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
// Parsing, versions and checking
// ---------------------------------------------------------------------------

/**
 * The fields added in v2, worked out from the v1 ones so an old trainer
 * keeps its look: trims follow the old accent colour, the tee keeps its
 * small badge, the expression follows the old eye style.
 */
export function upgrade(v1: Pick<TrainerConfig, V1Field>): Omit<TrainerConfig, V1Field | "v" | "partner" | "shiny"> {
  return {
    eyeColor: "dark",
    expr: v1.eyes === "focused" ? "determined" : "happy",
    bangs: "auto",
    hatTrim: v1.accent,
    topTrim: v1.accent,
    closed: false,
    emblem: "badge",
    bottomsTrim: v1.bottomsColor,
    legwear: "none",
    shoesTrim: "white",
    glovesColor: v1.accent,
    packTrim: v1.packColor,
    cape: "none",
    capeColor: "red",
    capeTrim: "black",
    eyewear: "none",
    neck: "none",
    wrist: "none",
    hairAcc: "none",
    ears: "none",
    accColor: v1.accent,
    stage: "plain",
  };
}

/**
 * A well-formed trainer (any items, locked or not), or null. Unknown keys
 * are dropped. v1 trainers come back as v2 with the defaults from
 * `upgrade`; a v2 field that is missing gets its default too, but one that
 * is there must be a real preset.
 */
export function parseTrainer(raw: unknown): TrainerConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 && r.v !== 2) return null;
  const base: Record<string, unknown> = {};
  for (const key of V1_FIELDS) {
    const value = r[key];
    if (typeof value !== "string" || !byId(TRAINER_FIELDS[key], value)) return null;
    base[key] = value;
  }
  const defaults = upgrade(base as Pick<TrainerConfig, V1Field>);
  const out: Record<string, unknown> = { v: 2 };
  for (const key of TRAINER_FIELD_KEYS) {
    if (key in base) {
      out[key] = base[key];
      continue;
    }
    const value = r.v === 1 ? undefined : r[key];
    if (value === undefined) out[key] = defaults[key as keyof typeof defaults];
    else if (typeof value !== "string" || !byId(TRAINER_FIELDS[key], value)) return null;
    else out[key] = value;
  }
  if (r.v === 2 && r.closed !== undefined && typeof r.closed !== "boolean") return null;
  out.closed = r.v === 2 && typeof r.closed === "boolean" ? r.closed : defaults.closed;
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
  const next = () => {
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    h = (h ^ (h >>> 12)) >>> 0;
    return h;
  };
  const pick = <T extends readonly Preset[]>(list: T): T[number]["id"] => {
    const options = free(list);
    return options[next() % options.length].id;
  };
  const one = <T extends string>(options: readonly T[]): T => options[next() % options.length];
  const clothing = ["red", "blue", "navy", "teal", "green", "orange", "purple", "charcoal", "sky", "pink", "yellow", "white", "black"] as const;
  const colour = () => one(clothing);
  const accent = colour();
  return {
    v: 2,
    body: pick(BODIES),
    skin: pick(SKINS),
    eyes: one(["round", "focused", "lashes", "sharp"] as const),
    eyeColor: pick(EYE_COLORS),
    expr: one(["happy", "determined", "smug", "calm"] as const),
    hair: pick(HAIRS),
    bangs: "auto",
    hairColor: pick(HAIR_COLORS),
    hat: one(["none", "cap", "league", "ballcap", "backcap", "beanie", "beret", "bucket", "visor", "headband"] as const),
    hatColor: colour(),
    hatTrim: colour(),
    top: one(["tee", "longtee", "jacket", "hoodie", "vest", "tank", "shirt"] as const),
    topColor: colour(),
    topTrim: accent,
    accent,
    closed: next() % 3 === 0,
    emblem: one(["none", "badge", "ball", "star", "bolt"] as const),
    bottoms: one(["shorts", "pants", "joggers", "skirt"] as const),
    bottomsColor: one(["navy", "charcoal", "black", "khaki", "blue", "brown", "denim"] as const),
    bottomsTrim: "white",
    legwear: one(["none", "none", "socks", "knee"] as const),
    shoes: one(["sneakers", "hightops", "boots"] as const),
    shoesColor: colour(),
    shoesTrim: "white",
    gloves: one(["none", "fingerless", "full"] as const),
    glovesColor: colour(),
    pack: one(["none", "classic", "satchel", "shoulder"] as const),
    packColor: colour(),
    packTrim: colour(),
    cape: "none",
    capeColor: "red",
    capeTrim: "black",
    eyewear: one(["none", "none", "none", "glasses"] as const),
    neck: one(["none", "none", "scarf", "pendant"] as const),
    wrist: one(["none", "bands"] as const),
    hairAcc: "none",
    ears: "none",
    accColor: colour(),
    ball: "poke",
    stage: "plain",
    partner,
    shiny,
  };
}

/** The first creator's classic look (cap, open jacket, backpack), as v2. */
export function starterTrainer(partner = 25, shiny = false): TrainerConfig {
  const v1 = {
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
  } as const;
  return { v: 2, ...v1, ...upgrade(v1), partner, shiny };
}

/**
 * A generous estimate of the bytes Postgres needs for a trainer as jsonb
 * (the column allows 1024): a header, 8 bytes of entries per key and
 * value, and the strings themselves. Tests keep every trainer under it.
 */
export function jsonbBytes(t: TrainerConfig): number {
  let n = 8;
  for (const [k, v] of Object.entries(t)) n += 8 + k.length + (typeof v === "string" ? v.length : typeof v === "number" ? 12 : 0);
  return n;
}
