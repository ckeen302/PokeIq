import { C, LIVE_CARD_HEADERS, OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";
import { ogT, type OgT } from "@/lib/og/i18n";
import { REPLAY_ID_RE, replayMatchup, replayResult, type ReplaySummary } from "@/lib/battle/replay";
import { replayStore } from "@/lib/server/battle-engine/replays";

/** A replay's preview card: the format, the two trainers and how it ended. */

export const runtime = "nodejs";
export const alt = "A Pokémon battle replay on PokéIQ";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/** replayResult's line in the card's language (the same cases, the players' names as they are). */
function localResult(r: ReplaySummary, t: OgT): string {
  if (t.locale === "en") return replayResult(r);
  const p = r.players;
  if (p.length === 4) {
    const names = (seats: number[]) => seats.map((s) => p[s] ?? "?").join(" & ");
    if (r.gameType === "multi" || (r.winners?.length === 2 && r.gameType !== "freeforall")) {
      if (r.winner === null) return t("replay.result.drew", { a: names([0, 2]), b: names([1, 3]) });
      const won = r.winner % 2;
      return t("replay.result.beat", { winner: names([won, won + 2]), loser: names([1 - won, 3 - won]) });
    }
    if (r.winner === null) return t("replay.result.noWinner", { players: p.join(", ") });
    return t("replay.result.wonFfa", { winner: p[r.winner] });
  }
  if (r.winner === null) return t("replay.result.drew", { a: p[0], b: p[1] });
  return t("replay.result.beat", { winner: p[r.winner], loser: p[1 - r.winner] });
}

export default async function Image(props: { params: Promise<{ id: string }> }) {
  const t = await ogT(props);
  const { id } = await props.params;
  const replay = REPLAY_ID_RE.test(id) ? await replayStore()?.get(id).catch(() => null) : null;
  if (!replay) {
    return ogCard({ eyebrow: t("replay.fallback.eyebrow"), title: [t("replay.fallback.title1"), [t("replay.fallback.title2"), C.pink]], accent: C.pink, footer: t("replay.fallback.footer"), t });
  }
  const shown = replay.elos ?? replay.ratings;
  const chips = [t("replay.turns", { n: replay.turns }), replay.ranked ? t("replay.ranked") : null, shown ? t("replay.ratings", { a: shown[0], b: shown[1] }) : null].filter((c): c is string => !!c);
  const matchup = replayMatchup(replay);
  return ogCard(
    {
      eyebrow: t("replay.eyebrow", { format: replay.formatName }),
      title: [matchup.a, [matchup.joiner === "vs" ? t("replay.vs") : t("replay.and"), C.muted], [matchup.b, C.pink]],
      titleSize: 72,
      subtitle: t("replay.subtitle", { result: localResult(replay, t), how: replay.reason === "forfeit" || replay.reason === "timeout" ? replay.reason : "other" }),
      accent: C.cyan,
      chips,
      t,
    },
    LIVE_CARD_HEADERS
  );
}
