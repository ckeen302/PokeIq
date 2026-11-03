/**
 * Which way each runner's HOME render faces. Most face left; these were
 * checked one by one against the renders (the popular set the parts audit
 * covers, scripts/race-parts.ts --top, plus Pidgeot) and face right, head
 * on the right. Every other render, and any that face the camera, count as
 * facing left. The runner is mirrored so its head leads.
 *
 * Keyed by the render's id (Entrant.art: the species, or the form's id).
 */
export const RIGHT_FACING_ART: ReadonlySet<number> = new Set([
  2, 18, 28, 31, 38, 53, 64, 123, 146, 147, 148, 155, 156, 181, 197, 200, 211, 250, 282, 330, 383, 471, 483, 488, 493, 496, 498, 617, 630, 640,
  643, 644, 705, 706, 724, 728, 729, 750, 791, 823, 888, 1002, 1003, 1007, 10022, 10104, 10188,
]);

/** −1 if the render faces left, 1 if right. */
export const artFacing = (art: number): -1 | 1 => (RIGHT_FACING_ART.has(art) ? 1 : -1);
