import "server-only";
import { dailyNumber } from "@/lib/daily";
import { geoWeeklyNumber, isGeoWeek } from "@/lib/geo-weekly";
import { DUEL_CODE_RE, DUEL_HP } from "@/lib/duel-types";
import { GEO_MAX_ROUND_SCORE, WORLD_REGION, type GeoResult } from "@/lib/geo-types";
import { GEO_ERA_NAMES } from "@/lib/geo-families";
import { GEO_DIFFICULTY_NAMES } from "@/lib/geo-difficulty";
import { publicName } from "@/lib/name-filter";
import { verifyToken } from "./crypto";
import { peekDuel } from "./duel-store";
import { duelView } from "./duel";
import { geoRegions } from "./geo";
import { readStreakResult } from "./geo-streak";

/**
 * A shared PokéGuessr result (/guessr/r/<token>): a finished game, daily or
 * streak carried in its signed result token, a region streak in its own, or
 * a finished duel by its code. Everything shown comes from the signed token
 * or the stored duel, never from the link's own text, so a card can't be
 * forged; nothing here names a place.
 */

export interface GeoShareView {
  kind: "game" | "daily" | "streak" | "region-streak" | "duel";
  /** "PokéGuessr · Daily #42", "PokéGuessr Duel". */
  eyebrow: string;
  /** "18,240", "7 in a row", "Red wins". */
  headline: string;
  detail: string;
  /** The map played: its picture for the preview card, and a small one for the page (the world map is 760 KB). */
  map: { id: string; name: string; src: string; thumb: string };
  /** A game's round scores (a streak: 1 per place named, 0 for the miss). */
  rounds: number[];
  total: number;
  max: number;
  chips: string[];
  /** A duel: both trainers with their HP at the end and their round scores. */
  players?: { name: string; hp: number; scores: number[]; winner: boolean }[];
  playHref: string;
  playLabel: string;
  /** For the page's <title>. */
  title: string;
}

const fmt = (n: number) => n.toLocaleString("en-US");
const mapOf = (id: string) => {
  const r = geoRegions().find((x) => x.id === id);
  return r ? { id: r.id, name: r.id === WORLD_REGION ? "World" : r.name, src: r.map.src, thumb: r.map.src === "/geo/maps/world.webp" ? "/geo/maps/world-thumb.webp" : r.map.src } : null;
};

function gameView(result: GeoResult): GeoShareView | null {
  const map = mapOf(result.spec.region);
  if (!map) return null;
  const { spec } = result;
  const rounds = result.rounds.map((r) => r.score);
  if (spec.kind === "streak") {
    const streak = rounds.filter((s) => s > 0).length;
    return {
      kind: "streak",
      eyebrow: `PokéGuessr · ${map.name} streak`,
      headline: `${streak} in a row`,
      detail: `${streak} place${streak === 1 ? "" : "s"} named in a row from in-game screenshots, then a miss.`,
      map,
      rounds,
      total: streak,
      max: streak,
      chips: [map.name, "Streak", ...(spec.era ? [GEO_ERA_NAMES[spec.era]] : [])],
      playHref: `/guessr?region=${map.id}`,
      playLabel: "Play PokéGuessr",
      title: `${streak} in a row in PokéGuessr ${map.name} streak`,
    };
  }
  const total = result.score;
  const max = rounds.length * GEO_MAX_ROUND_SCORE;
  const daily = spec.daily ? dailyNumber(spec.daily) : undefined;
  const weekly = spec.weekly && isGeoWeek(spec.weekly) ? geoWeeklyNumber(spec.weekly) : undefined;
  const eyebrow = daily !== undefined ? `PokéGuessr · Daily #${daily}` : weekly !== undefined ? `PokéGuessr · Weekly #${weekly}` : `PokéGuessr · ${map.name}`;
  const chips = [
    map.name,
    daily !== undefined ? `Daily #${daily}` : weekly !== undefined ? `Weekly #${weekly}` : `${rounds.length} rounds`,
    ...(spec.era ? [GEO_ERA_NAMES[spec.era]] : []),
    ...(spec.difficulty ? [GEO_DIFFICULTY_NAMES[spec.difficulty]] : []),
    ...(result.bonus ? [`+${fmt(result.bonus)} game bonus`] : []),
  ];
  return {
    kind: daily !== undefined ? "daily" : "game",
    eyebrow,
    headline: fmt(total),
    detail: `${fmt(total)} of ${fmt(max)} points over ${rounds.length} places in ${map.name === "World" ? "the Pokémon world" : map.name}.`,
    map,
    rounds,
    total,
    max,
    chips,
    playHref: daily !== undefined || weekly !== undefined ? "/guessr" : `/guessr?region=${map.id}`,
    playLabel: daily !== undefined ? "Play today's daily" : weekly !== undefined ? "Play this week's challenge" : "Play PokéGuessr",
    title: `${fmt(total)} points in ${eyebrow.replace("PokéGuessr · ", "PokéGuessr ")}`,
  };
}

async function duelShareView(code: string): Promise<GeoShareView | null> {
  const duel = await peekDuel(code).catch(() => null);
  if (!duel || duel.status !== "finished") return null;
  const view = duelView(duel, null, Date.now(), 0);
  const map = mapOf(view.region);
  if (!map || !view.end) return null;
  const names = view.players.map((p) => publicName(p.name, "Trainer"));
  const players = names.map((name, seat) => ({
    name,
    hp: view.hp[seat] ?? 0,
    scores: view.revealed.map((r) => r.guesses[seat]?.score ?? 0),
    winner: view.end?.winner === seat,
  }));
  const winner = view.end.winner;
  const race = view.mode === "race";
  const headline = winner === null ? "Draw" : `${names[winner]} wins`;
  return {
    kind: "duel",
    eyebrow: `PokéGuessr · ${race ? "Points race" : "Duel"} · ${map.name}`,
    headline,
    detail:
      winner === null
        ? `${names[0]} and ${names[1]} drew after ${view.revealed.length} rounds.`
        : race
          ? `${names[winner]} beat ${names[1 - winner]} ${fmt(view.totals?.[winner] ?? 0)} to ${fmt(view.totals?.[1 - winner] ?? 0)} over ${view.revealed.length} rounds.`
          : `${names[winner]} beat ${names[1 - winner]} with ${fmt(view.hp[winner] ?? 0)} of ${fmt(DUEL_HP)} HP left after ${view.revealed.length} rounds.`,
    map,
    rounds: players[0]?.scores ?? [],
    total: view.revealed.length,
    max: view.maxRounds,
    chips: [map.name, race ? "Points race" : "HP duel", ...(view.turbo ? ["Turbo"] : []), ...(view.ranked ? ["Ranked"] : [])],
    players,
    playHref: "/guessr",
    playLabel: "Start a duel",
    title: `${headline}: a PokéGuessr duel in ${map.name}`,
  };
}

/** The view for a result token (a signed game result, a signed region streak, or "duel:<code>"). */
export async function readGeoShare(token: string): Promise<GeoShareView | null> {
  if (token.startsWith("duel:")) {
    const code = token.slice(5);
    return DUEL_CODE_RE.test(code) ? duelShareView(code) : null;
  }
  const result = verifyToken<GeoResult>("geo-result", token);
  if (result && result.spec && Array.isArray(result.rounds)) return gameView(result);
  const streak = readStreakResult(token);
  if (!streak) return null;
  const map = mapOf(WORLD_REGION);
  if (!map) return null;
  return {
    kind: "region-streak",
    eyebrow: "PokéGuessr · Region Streak",
    headline: `${streak.streak} in a row`,
    detail: `${streak.streak} region${streak.streak === 1 ? "" : "s"} named in a row from one screenshot each, then a miss.`,
    map,
    rounds: [...Array.from({ length: streak.streak }, () => 1), 0],
    total: streak.streak,
    max: streak.streak,
    chips: ["Region Streak", "World"],
    playHref: "/guessr/streak",
    playLabel: "Play Region Streak",
    title: `${streak.streak} in a row in PokéGuessr Region Streak`,
  };
}
