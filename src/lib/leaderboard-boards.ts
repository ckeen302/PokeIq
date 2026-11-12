/**
 * Every board a bare /leaderboard?board=<id> link serves from a page cached
 * for a few seconds (src/app/leaderboard/board/[board], rewritten in
 * next.config.ts). Kept free of imports: next.config.ts reads it.
 */
export const LEADERBOARD_BOARDS = ["daily", "iq", "geo", "geo-ranked", "pokedle", "connections", "connections-ranked", "battle"] as const;
