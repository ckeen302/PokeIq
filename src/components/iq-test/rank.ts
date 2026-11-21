/** The knowledge rating's titles (src/lib/rating.ts iqTitle) as keys of iq-test-play's "ranks". */
const RANK_KEYS = {
  "Pokémon Professor": "professor",
  Champion: "champion",
  "Elite Four": "elite",
  "Gym Leader": "gym",
  "Ace Trainer": "ace",
  Trainer: "trainer",
  Youngster: "youngster",
} as const;

export type RankKey = (typeof RANK_KEYS)[keyof typeof RANK_KEYS];

export function rankKey(title: string): RankKey {
  return RANK_KEYS[title as keyof typeof RANK_KEYS] ?? "trainer";
}
