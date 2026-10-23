/**
 * Themed practice packs, client-safe: which packs there are and how a pack
 * rides in a practice seed ("kanto-x7k2abcd", "kanto-hard-x7k2abcd"), so the
 * server rebuilds the same puzzle for every guess check. The Pokémon each
 * pack allows are in ./packs (server data).
 */

export const CONN_PACKS = ["kanto", "gen9", "competitive"] as const;
export type ConnPack = (typeof CONN_PACKS)[number];

export const PACK_INFO: Record<ConnPack, { name: string; blurb: string }> = {
  kanto: { name: "Kanto", blurb: "Only the original 151." },
  gen9: { name: "Gen 9", blurb: "Only Paldea's Pokémon." },
  competitive: { name: "Competitive", blurb: "Only Pokémon seen in Smogon's Gen 9 OU." },
};

export const isConnPack = (s: unknown): s is ConnPack => CONN_PACKS.includes(s as ConnPack);

/** Splits a practice seed into its pack and difficulty. */
export function parsePracticeSeed(seed: string): { pack?: ConnPack; difficulty?: "easy" | "hard" } {
  const m = /^(?:(kanto|gen9|competitive)-)?(?:(easy|normal|hard)-)?[a-z0-9]{4,24}$/.exec(seed);
  const difficulty = m?.[2] === "easy" || m?.[2] === "hard" ? m[2] : undefined;
  return { ...(m?.[1] && { pack: m[1] as ConnPack }), ...(difficulty && { difficulty }) };
}
