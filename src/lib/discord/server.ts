import "server-only";
import { z } from "zod";
import { SITE_URL } from "@/lib/site";
import { duelNameSchema } from "@/lib/server/duel-core";
import { duelsEnabled, insertDuel, newDuelCode, pvpStore } from "@/lib/server/duel-store";
import { WORLD_REGION } from "@/lib/geo-types";
import { syncHiddenShots } from "@/lib/server/geo-reports";
import { fetchBoard } from "@/lib/server/leaderboard";
import { fetchGeoBoard } from "@/lib/server/geo-leaderboard";
import { connBoardStore } from "@/lib/server/connections-board";
import { pdkStore } from "@/lib/server/pikadoku-board";
import { PINK, VIOLET, GAME_LABELS, duelEmbed, duelName, errorEmbed, todayUtc, type DuelGame, type Embed } from "./commands";

export const gameSchema = z.enum(["pokedle", "connections", "pikadoku", "guessr", "quiz"]);

/**
 * A game's duel creator, loaded on use: the game engines are heavy, and
 * Discord gives an interaction's first reply 3 seconds, cold start included.
 * Duels are only created after that reply (the route's after()).
 */
async function duelCreator(game: DuelGame) {
  switch (game) {
    case "guessr":
      return { kind: "guessr", fn: (await import("@/lib/server/duel")).createDuel } as const;
    case "pokedle":
      return { kind: "pvp", fn: (await import("@/lib/server/pokedle-duel")).createPokedleDuel } as const;
    case "quiz": {
      const { createQuizDuel } = await import("@/lib/server/quiz-duel");
      return { kind: "pvp", fn: (name: string, code: string, now: number) => createQuizDuel("mixed", "medium", name, code, now) } as const;
    }
    case "pikadoku":
      return { kind: "pvp", fn: (await import("@/lib/server/pikadoku-duel")).createPikadokuDuel } as const;
    default:
      return { kind: "pvp", fn: (await import("@/lib/server/connections-duel")).createConnectionsDuel } as const;
  }
}

/** Opens a casual duel through the server-side creators (no HTTP self-call) and returns the join embed. */
export async function createDuelEmbed(game: DuelGame, displayName: string | undefined): Promise<Embed> {
  if (!duelsEnabled()) return errorEmbed("Duels aren't enabled on this server yet.");
  const parsed = duelNameSchema.safeParse(duelName(displayName));
  const name = parsed.success ? parsed.data : "Trainer";
  try {
    if (game === "guessr") await syncHiddenShots();
    const create = await duelCreator(game);
    for (let attempt = 0; attempt < 4; attempt++) {
      const now = Date.now();
      const code = newDuelCode();
      if (create.kind === "guessr") {
        const { duel } = create.fn(WORLD_REGION, name, code, now);
        if (!(await insertDuel(duel))) continue;
      } else {
        const { duel } = create.fn(name, code, now);
        if (!(await pvpStore.insert(duel))) continue;
      }
      return duelEmbed(game, code);
    }
  } catch (err) {
    console.error("[discord] duel create failed:", err);
  }
  return errorEmbed("Couldn't open a duel. Try again.");
}

const medal = (i: number) => ["🥇", "🥈", "🥉"][i] ?? `${i + 1}.`;
const fmtMs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export async function leaderboardEmbed(game: DuelGame, now = new Date()): Promise<Embed> {
  const date = todayUtc(now);
  const lines: string[] = [];
  try {
    if (game === "quiz") {
      (await fetchBoard({ kind: "daily", date }, 10))?.forEach((r, i) => lines.push(`${medal(i)} ${r.player_name} · ${r.score} pts (${r.correct}/${r.total})`));
    } else if (game === "guessr") {
      (await fetchGeoBoard({ daily: date }, 10))?.forEach((r, i) => lines.push(`${medal(i)} ${r.player_name} · ${r.score} pts · ${fmtMs(r.duration_ms)}`));
    } else if (game === "connections") {
      (await connBoardStore()?.top(date, 10))?.forEach((r, i) => lines.push(`${medal(i)} ${r.name} · ${r.mistakes} mistakes · ${fmtMs(r.ms)}`));
    } else if (game === "pikadoku") {
      (await pdkStore()?.board(date, "normal"))?.slice(0, 10).forEach((r, i) => lines.push(`${medal(i)} ${r.name} · ${r.solved} solved · ${fmtMs(r.ms)}`));
    }
  } catch (err) {
    console.error("[discord] leaderboard failed:", err);
  }
  return {
    title: `${GAME_LABELS[game]} leaderboard`,
    description: lines.length ? lines.join("\n") : game === "pokedle" ? "Pokédle has no leaderboard." : "No scores yet.",
    url: `${SITE_URL}/leaderboard`,
    color: lines.length ? PINK : VIOLET,
    footer: { text: date },
  };
}
