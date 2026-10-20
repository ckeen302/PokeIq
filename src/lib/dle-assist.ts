/**
 * Pokédle's Pokédex assist: how much the Pokédex beside the board does for
 * you, picked before the first guess and fixed for the rest of the game.
 * The less it does, the more a solve is worth (the multiplier applies to a
 * solo game's points, after hints). Shared by the server and the browser.
 *
 * - Off: no Pokédex at all.
 * - Notebook (the default): it greys out what the generation and type
 *   clues rule out; you cross the rest off by hand.
 * - Field Guide: it also shows each Pokémon's stage and colour, and filters
 *   by them.
 * - Full Pokédex: it also knows height and weight, filters by ranges, and a
 *   clue clicked on the board becomes a filter.
 *
 * The Pokédex API only sends the attributes a level shows (dexColumns), so
 * a lighter level never has the hidden ones in the browser.
 */

export const DLE_ASSISTS = ["off", "notebook", "field", "full"] as const;
export type DleAssist = (typeof DLE_ASSISTS)[number];
export const DLE_DEFAULT_ASSIST: DleAssist = "notebook";

export interface DleAssistInfo {
  label: string;
  /** One line for the setting. */
  blurb: string;
  /** A solo game's points are multiplied by this. */
  multiplier: number;
  /** The share text's marker. */
  emoji: string;
}

/**
 * Multipliers tuned with the Pokédex simulator: a fan's expected points per
 * game (avg guesses / solved) are about 448 Off (4.6 / 70%), 610 Notebook
 * (4.5 / 94%), 690 Field Guide (4.0 / 99%) and 793 Full (3.1 / 100%), and a
 * sharp fan's 633 / 703 / 735 / 793. Off pays for the sharp fan (×1.25 puts
 * it ahead of the Notebook) without paying for guessing blind; the Field
 * Guide and Full Pokédex land just under the Notebook for a fan.
 */
export const DLE_ASSIST_INFO: Record<DleAssist, DleAssistInfo> = {
  off: { label: "Off", blurb: "No Pokédex: every clue is yours to work out.", multiplier: 1.25, emoji: "🧠" },
  notebook: { label: "Notebook", blurb: "Greys out what the gen and type clues rule out; you cross off the rest.", multiplier: 1, emoji: "📓" },
  field: { label: "Field Guide", blurb: "Also shows each Pokémon's stage and color, and filters by them.", multiplier: 0.85, emoji: "🔎" },
  full: { label: "Full Pokédex", blurb: "Also filters by height and weight; click a clue to add it as a filter.", multiplier: 0.7, emoji: "📚" },
};

export const isDleAssist = (v: unknown): v is DleAssist => typeof v === "string" && (DLE_ASSISTS as readonly string[]).includes(v);

/** A level from anything (an old record, a query string): the default when it isn't one. */
export const dleAssistOf = (v: unknown): DleAssist => (isDleAssist(v) ? v : DLE_DEFAULT_ASSIST);

/** "×1.25", "×0.7". */
export const multiplierText = (assist: DleAssist) => `×${DLE_ASSIST_INFO[assist].multiplier}`;

/** Points at a level: `points` (after hints) times the level's multiplier, rounded. */
export const withAssist = (points: number, assist: DleAssist) => Math.round(points * DLE_ASSIST_INFO[assist].multiplier);

/**
 * What the Pokédex sends at each level, after [id, name, gen, type1, type2]:
 * nothing more for the Notebook, stage and colour for the Field Guide, and
 * height and weight too for the Full Pokédex. Off has no Pokédex.
 */
export const DEX_EXTRA_COLUMNS = {
  off: null,
  notebook: [],
  field: ["stage", "color"],
  full: ["stage", "color", "height", "weight"],
} as const satisfies Record<DleAssist, readonly string[] | null>;

/** Which levels a ranked duel allows: one, so everyone on the ladder plays alike. */
export const DLE_RANKED_ASSIST: DleAssist = "notebook";
