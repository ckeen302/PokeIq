/**
 * Corrections for evolution requirements PokéAPI describes poorly: newer
 * methods it files under a bare "other" trigger, evolutions it lists with no
 * method at all, and item / place names that lose their punctuation when
 * built from slugs. Shared by the ingest script and the runtime loader so a
 * re-ingest and the committed data agree.
 */

const OVERRIDES: Record<number, string[]> = {
  809: ["Feed 400 Meltan Candy in Pokémon GO"], // Melmetal
  923: ["Walk 1,000 steps in Let's Go mode, then level up"], // Pawmot
  925: ["Level 25"], // Maushold
  947: ["Walk 1,000 steps in Let's Go mode, then level up"], // Brambleghast
  954: ["Walk 1,000 steps in Let's Go mode, then level up"], // Rabsca
  964: ["Level 38 while in a Union Circle with another player"], // Palafin
  979: ["Use Rage Fist 20 times, then level up"], // Annihilape
  983: ["Defeat 3 Bisharp holding a Leader's Crest, then level up"], // Kingambit
  1000: ["Level up with 999 Gimmighoul Coins in the bag"], // Gholdengo
  1011: ["Use Syrupy Apple"], // Dipplin
  1013: ["Use Unremarkable Teacup or Masterpiece Teacup"], // Sinistcha
  1018: ["Use Metal Alloy"], // Archaludon
  1019: ["Level up knowing Dragon Cheer"], // Hydrapple
  738: ["Level up in a special magnetic field (Vast Poni Canyon or Blush Mountain)", "Use Thunder Stone"], // Vikavolt
};

/** Slug-built names that need their apostrophe or full stop back. */
const PUNCTUATION: [RegExp, string][] = [
  [/\bKings Rock\b/g, "King's Rock"],
  [/\bLeaders Crest\b/g, "Leader's Crest"],
  [/\bMt Coronet\b/g, "Mt. Coronet"],
];

export function fixEvolutionConditions(id: number, conditions: readonly string[]): string[] {
  if (OVERRIDES[id]) return OVERRIDES[id];
  // A bare "Level up" beside location-specific ones (Magnezone, Probopass) is
  // PokéAPI's placeholder for "in a special place", not "any level-up".
  const hasPlace = conditions.some((c) => c.startsWith("Level up at "));
  return conditions
    .filter((c) => c !== "Other" && !(hasPlace && c === "Level up"))
    .map((c) => PUNCTUATION.reduce((text, [re, fixed]) => text.replace(re, fixed), c));
}
