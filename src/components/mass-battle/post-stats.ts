/** Pure pieces of the post-battle stats (the worker and the panel use them; tests check them). */

/**
 * The MVP: the unit with the most KOs on the winning side (anyone's in a draw), ties to the most damage; with no KOs
 * there, the one that dealt the most. −1 if nobody did anything.
 */
export function pickMvp(side: ArrayLike<number>, kos: ArrayLike<number>, dealt: ArrayLike<number>, winner: number): number {
  const counts = (i: number) => winner === 2 || side[i] === winner;
  let mvp = -1;
  for (let i = 0; i < side.length; i++) {
    if (!counts(i) || kos[i] <= 0) continue;
    if (mvp < 0 || kos[i] > kos[mvp] || (kos[i] === kos[mvp] && dealt[i] > dealt[mvp])) mvp = i;
  }
  if (mvp < 0) for (let i = 0; i < side.length; i++) if (counts(i) && dealt[i] > 0 && (mvp < 0 || dealt[i] > dealt[mvp])) mvp = i;
  return mvp;
}

/** The MVP's name: its species, and its side's name after it only when that says something more ("Pikachu (Kanto starters)"). */
export const mvpName = (species: string, side: string) => (side && side !== species ? `${species} (${side})` : species);
