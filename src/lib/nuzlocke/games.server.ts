import "server-only";
import type { NuzGame } from "./model";
import { NUZ_GAMES, loadGame, type NuzGameInfo } from "./games";
import { buildView } from "./view.server";
import type { GameSummary, GameView } from "./view";

/** The tracker's games for the pages (server only): the list, and each game made ready for the screens, built once. */

/** Bump when buildView's output changes shape or meaning. */
const VIEW_VERSION = 1;

const views = new Map<string, Promise<{ game: NuzGame; view: GameView } | null>>();

export function gameAndView(id: string): Promise<{ game: NuzGame; view: GameView } | null> {
  let p = views.get(id);
  if (!p) {
    // Data that won't build (a species the Pokédex doesn't have yet…) counts as no data, never a broken page.
    p = loadGame(id).then((game) => (game ? { game, view: buildView(game) } : null)).catch(() => null);
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

/**
 * The games NUZ_GAMES lists whose data loads: the only ones the pages offer. A game listed before its data lands (or
 * whose data won't build) is left out: no tile, no page (a 404), and a run of it says its game isn't available.
 */
export async function availableGames(): Promise<NuzGameInfo[]> {
  const ok = await Promise.all(NUZ_GAMES.map((g) => gameAndView(g.id).then((x) => !!x, () => false)));
  return NUZ_GAMES.filter((_, i) => ok[i]);
}

export async function gameSummaries(): Promise<GameSummary[]> {
  return Promise.all(
    (await availableGames()).map(async (g) => {
      const full = await loadGame(g.id);
      return { id: g.id, name: g.name, gen: g.gen, region: g.region, versions: g.versions, data: fingerprint(`${VIEW_VERSION}:${JSON.stringify(full)}`) };
    })
  );
}

/** The ids of the games the pages are built for. */
export const gameIds = async (): Promise<string[]> => (await availableGames()).map((g) => g.id);
