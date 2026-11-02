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
/** Event flags (one hit, or a miss, per record). */
export const EV = { CRIT: 1, KO: 2, MISS: 4, SUPER: 8, RESIST: 16, SPREAD: 32, IMMUNE: 64, RECOIL: 128 } as const;
/** Ints per event: actor, target, move slot, damage, flags, action id. */
export const EVENT_INTS = 6;
