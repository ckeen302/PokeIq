import { huntSquare } from "./score";

/**
 * The Daily Hunt's share text, like the other dailies':
 *   Pokémon Hunt #1 · 17,420
 *   🟩🟩🟨🟥🟩
 *   playpokeiq.com/pokeguessr/hunt
 */
export function huntShareText(daily: number, total: number, rounds: readonly number[], host = "playpokeiq.com"): string {
  return [`Pokémon Hunt #${daily} · ${total.toLocaleString("en-US")}`, rounds.map(huntSquare).join(""), `${host}/pokeguessr/hunt`].join("\n");
}
