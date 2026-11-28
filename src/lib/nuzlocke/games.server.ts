import "server-only";
import type { NuzGame } from "./model";
import { NUZ_GAMES, loadGame } from "./source";
import { buildView } from "./view.server";
import type { GameSummary, GameView } from "./view";

/** The tracker's games for the pages (server only): the list, and each game made ready for the screens, built once. */

/** Bump when buildView's output changes shape or meaning. */
const VIEW_VERSION = 1;

const views = new Map<string, Promise<{ game: NuzGame; view: GameView } | null>>();

export function gameAndView(id: string): Promise<{ game: NuzGame; view: GameView } | null> {
  let p = views.get(id);
  if (!p) {
    p = loadGame(id).then((game) => (game ? { game, view: buildView(game) } : null));
    p.catch(() => views.delete(id));
    views.set(id, p);
  }
  return p;
}

export const gameView = (id: string): Promise<GameView | null> => gameAndView(id).then((x) => x?.view ?? null);

/** FNV-1a, base 36: a short fingerprint of a game's data. */
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export async function gameSummaries(): Promise<GameSummary[]> {
  return Promise.all(
    NUZ_GAMES.map(async (g) => {
      const full = await loadGame(g.id);
      return { id: g.id, name: g.name, gen: g.gen, region: g.region, versions: g.versions, data: fingerprint(`${VIEW_VERSION}:${JSON.stringify(full)}`) };
    })
  );
}

export const GAME_IDS = (): string[] => NUZ_GAMES.map((g) => g.id);
