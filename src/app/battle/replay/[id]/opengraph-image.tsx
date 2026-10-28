import { C, LIVE_CARD_HEADERS, OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";
import { REPLAY_ID_RE, replayResult } from "@/lib/battle/replay";
import { replayStore } from "@/lib/server/battle-engine/replays";

/** A replay's preview card: the format, the two trainers and how it ended. */

export const runtime = "nodejs";
export const alt = "A Pokémon battle replay on PokéIQ";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const replay = REPLAY_ID_RE.test(id) ? await replayStore()?.get(id).catch(() => null) : null;
  if (!replay) {
    return ogCard({ eyebrow: "Battle replay", title: ["Pokémon", ["battle replay", C.pink]], accent: C.pink, footer: "Pokémon Showdown's engine · watch it turn by turn →" });
  }
  const shown = replay.elos ?? replay.ratings;
  const chips = [`${replay.turns} turns`, replay.ranked ? "Ranked" : null, shown ? `${shown[0]} vs ${shown[1]}` : null].filter((c): c is string => !!c);
  return ogCard(
    {
      eyebrow: `Replay · ${replay.formatName}`,
      title: [replay.players[0], ["vs", C.muted], [replay.players[1], C.pink]],
      titleSize: 72,
      subtitle: `${replayResult(replay)}${replay.reason === "forfeit" ? " by forfeit" : replay.reason === "timeout" ? " on time" : ""}.`,
      accent: C.cyan,
      chips,
    },
    LIVE_CARD_HEADERS
  );
}
