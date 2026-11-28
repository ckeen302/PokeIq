/**
 * The team's weaknesses and resistances, type by type, from the generation's own type chart (GameView.chart, built
 * from Pokémon Showdown's data for that generation) and each member's typing in that generation. By type only:
 * abilities (Levitate, Thick Fat…) and moves aren't counted. Pure, so the tests check it against real cases.
 */

export type Chart = Record<string, Record<string, number>>;

/** An attacking type's multiplier against a typing (dual types multiply, as the games do). */
export function multiplier(chart: Chart, attacking: string, defending: readonly string[]): number {
  return defending.reduce((x, d) => x * (chart[attacking]?.[d] ?? 1), 1);
}

export interface TypeMatchup {
  type: string;
  /** Members it hits for ×2 or more. */
  weak: number;
  /** Of those, the ones it hits for ×4. */
  x4: number;
  /** Members that take ×½ or less from it, immune ones included. */
  resist: number;
  /** Of those, the immune ones. */
  immune: number;
  /** Each member's multiplier, in the team's order. */
  each: number[];
}

/** Every type of the generation against the team (each member a list of its types). */
export function teamMatchups(members: readonly (readonly string[])[], types: readonly string[], chart: Chart): TypeMatchup[] {
  return types.map((type) => {
    const each = members.map((m) => multiplier(chart, type, m));
    return {
      type,
      each,
      weak: each.filter((x) => x >= 2).length,
      x4: each.filter((x) => x >= 4).length,
      resist: each.filter((x) => x <= 0.5).length,
      immune: each.filter((x) => x === 0).length,
    };
  });
}

/**
 * What the team panel shows: the types it's weak to (most members first) and those it resists (most first), and its
 * gaps: types that hit at least two members hard and that no member resists.
 */
export function matchupSummary(lines: readonly TypeMatchup[]): { weak: TypeMatchup[]; resist: TypeMatchup[]; gaps: TypeMatchup[] } {
  const weak = lines.filter((l) => l.weak > 0).sort((a, b) => b.weak - a.weak || b.x4 - a.x4 || a.resist - b.resist);
  const resist = lines.filter((l) => l.resist > 0).sort((a, b) => b.resist - a.resist || b.immune - a.immune || a.weak - b.weak);
  const gaps = weak.filter((l) => l.weak >= 2 && l.resist === 0);
  return { weak, resist, gaps };
}
