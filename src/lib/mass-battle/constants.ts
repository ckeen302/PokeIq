/**
 * The battle's fixed numbers, with no imports, so the page can read them
 * without loading the simulation (the damage calculator runs only in the
 * battle workers).
 */

export const TICK_HZ = 20;
export const DT = 1 / TICK_HZ;
/** A round lasts three seconds: everyone acts once. */
export const ROUND_TICKS = 60;
/** Contact moves: the bodies (nearly) touching. */
export const CONTACT_REACH = 0.6;
/** Everything else reaches this far past the bodies. */
export const RANGED_REACH = 6;
/** Spread moves hit foes this far from the user's body. */
export const SPREAD_REACH = 3;
/** A battle still going after this long is a draw. */
export const MAX_SECONDS = 180;

/**
 * Hit events, one per target of each move use (and one for a Pokémon that
 * faints outside a hit). Flags: a critical hit, a KO, a miss, super
 * effective or resisted, part of a spread move, no effect at all; RECOIL
 * marks HP the Pokémon lost by itself (recoil, Life Orb, Rough Skin,
 * Rocky Helmet: actor = target, slot −1), RESIDUAL the end of a round
 * (sandstorm, poison, burns).
 */
export const EV = { CRIT: 1, KO: 2, MISS: 4, SUPER: 8, RESIST: 16, SPREAD: 32, IMMUNE: 64, RECOIL: 128, RESIDUAL: 256 } as const;
/** Ints per event: actor, target, move slot, damage, flags, action id. */
export const EVENT_INTS = 6;

/**
 * Notes: everything else that happens to a unit, for damage numbers and
 * status icons. Ints per note: unit, kind, value, source (the unit that
 * caused it, or −1).
 *
 * - STATUS: it got a status condition (value: STATUS code, see types.ts; NOTE_CONFUSION for confusion).
 * - CURE: it lost one (value: the STATUS code it had, or NOTE_CONFUSION).
 * - HEAL: HP back (value: HP), from drain, Leftovers, Grassy Terrain, a berry…
 * - CHIP: HP lost outside a hit (value: HP): recoil, Life Orb, sandstorm, poison, burns, Rough Skin, Rocky Helmet.
 * - BOOST: a stat stage changed (value: stat × 16 + change + 8; stats 0–6 are Attack, Defense, Sp. Atk, Sp. Def,
 *   Speed, accuracy, evasion).
 * - SKIP: it lost its turn (value: NOTE_SKIP: asleep, frozen, flinched, fully paralysed).
 * - ITEM: its item did something or went (value: NOTE_ITEM).
 */
export const NOTE = { STATUS: 1, CURE: 2, HEAL: 3, CHIP: 4, BOOST: 5, SKIP: 6, ITEM: 7 } as const;
export const NOTE_INTS = 4;
export const NOTE_SKIP = { sleep: 1, frozen: 2, flinch: 3, paralysed: 4, confused: 5 } as const;
/** STATUS and CURE notes with this value are confusion (not a major status). */
export const NOTE_CONFUSION = 9;
export const NOTE_ITEM = { sitrus: 1, lum: 2, disguise: 3, sash: 4, weaknessPolicy: 5, balloon: 6, knockedOff: 7 } as const;
