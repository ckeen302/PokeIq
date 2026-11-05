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
 * (sandstorm, poison, burns); PROTECT a hit Protect stopped; BLAST the user
 * fainting by its own move (Explosion, Self-Destruct, Memento, Final Gambit:
 * actor = target, the move's slot); ALLY a hit on the user's own side
 * (Earthquake next to a partner).
 */
export const EV = { CRIT: 1, KO: 2, MISS: 4, SUPER: 8, RESIST: 16, SPREAD: 32, IMMUNE: 64, RECOIL: 128, RESIDUAL: 256, PROTECT: 512, BLAST: 1024, ALLY: 2048 } as const;
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
 * - SKIP: it lost its turn (value: NOTE_SKIP: asleep, frozen, flinched, fully paralysed, hurt in confusion, loafing
 *   around with Truant).
 * - ITEM: its item did something or went (value: NOTE_ITEM).
 * - FORM: an ability changed its form or type (value: the form, see formsOf in damage.ts): Aegislash's Blade Forme,
 *   Wishiwashi's School Form, Minior's Core, Eiscue's Noice Face, a Protean or Libero type change, a Trace copy.
 * - MOVE: it used a move that hits nobody (value: the move slot): a boost, healing, Protect, a screen, charging up.
 * - FIELD: the field changed (unit: who did it, or −1; value: FIELD_NOTE code × 16 + the weather or terrain code,
 *   see WEATHER_CODES and TERRAIN_CODES in damage.ts; for screens, the side × 16 + 1 Reflect, 2 Light Screen, 3 Aurora Veil).
 * - ABILITY: an ability acted as it came in (value: ABILITY_NOTE): Intimidate, Trace, Download, Neutralizing Gas, Pressure.
 * - PP: it ran out of PP and Struggles (value: 0).
 */
export const NOTE = { STATUS: 1, CURE: 2, HEAL: 3, CHIP: 4, BOOST: 5, SKIP: 6, ITEM: 7, FORM: 8, MOVE: 9, FIELD: 10, ABILITY: 11, PP: 12 } as const;
export const FIELD_NOTE = { weather: 1, terrain: 2, screen: 3, screenEnd: 4 } as const;
export const ABILITY_NOTE = { intimidate: 1, trace: 2, download: 3, gas: 4, pressure: 5, weather: 6, terrain: 7 } as const;
export const NOTE_INTS = 4;
export const NOTE_SKIP = { sleep: 1, frozen: 2, flinch: 3, paralysed: 4, confused: 5, loafing: 6, recharge: 7, failed: 8 } as const;
/** STATUS and CURE notes with this value are confusion (not a major status). */
export const NOTE_CONFUSION = 9;
export const NOTE_ITEM = { sitrus: 1, lum: 2, disguise: 3, sash: 4, weaknessPolicy: 5, balloon: 6, knockedOff: 7 } as const;
