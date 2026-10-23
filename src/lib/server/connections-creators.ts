import "server-only";
import { CREATOR_NAME_RE, type ConnPotdResponse, type CreatorPage } from "@/lib/connections/social";
import { CustomOffError, customStore, summaryOf, type CustomStore, type StoredCustom } from "./connections-custom";
import { orOff, socialStore, type SocialStore } from "./connections-social";

/**
 * Creator boosts: the Puzzle of the Day, creator pages and the "Featured
 * creator" status. Summaries only (title, creator, votes): never a puzzle's
 * groups or tiles.
 */

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
/** How many days back a community puzzle can be and still be picked. */
export const POTD_WINDOW_MS = WEEK_MS;
/** A puzzle isn't picked again within this many days of its last pick. */
const POTD_NO_REPEAT = 14;

const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const net = (p: Pick<StoredCustom, "up" | "down">) => p.up - p.down;

/** The best-voted puzzle from `candidates` (net votes above zero) that wasn't picked lately; null if none. Pure, for tests. */
export function pickPotd(candidates: readonly StoredCustom[], recentIds: ReadonlySet<string>): StoredCustom | null {
  return (
    [...candidates]
      .filter((p) => net(p) > 0 && !recentIds.has(p.id))
      .sort((a, b) => net(b) - net(a) || Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null
  );
}

/**
 * Today's Puzzle of the Day: the top-voted community puzzle of the last
 * week that hasn't been picked in the last two weeks. The pick is stored on
 * first request so it holds all day (without the table it is simply
 * computed again). No pick when nothing has votes.
 */
export async function puzzleOfTheDay(
  now = Date.now(),
  custom: CustomStore | null = customStore(),
  social: SocialStore | null = socialStore()
): Promise<ConnPotdResponse> {
  if (!custom) return { available: false, puzzle: null };
  const date = utcDate(now);
  try {
    const stored = await orOff((s) => s.getPotd(date), null, social);
    if (stored) {
      const p = await custom.get(stored.id);
      return { available: true, puzzle: p ? summaryOf(p) : null };
    }
    const recent = new Set(await orOff((s) => s.recentPotdIds(POTD_NO_REPEAT), [] as string[], social));
    const pick = pickPotd(await custom.list("top", 25, now - POTD_WINDOW_MS), recent);
    if (!pick) return { available: true, puzzle: null };
    await orOff((s) => s.setPotd(date, { id: pick.id, creatorKey: pick.creatorKey }), undefined, social);
    // If two requests raced, the stored pick wins.
    const kept = await orOff((s) => s.getPotd(date), null, social);
    const winner = kept && kept.id !== pick.id ? await custom.get(kept.id) : pick;
    return { available: true, puzzle: winner ? summaryOf(winner) : null };
  } catch (err) {
    if (err instanceof CustomOffError) return { available: false, puzzle: null };
    throw err;
  }
}

/**
 * Whether one of this creator's puzzles is the week's featured puzzle, is
 * today's Puzzle of the Day, or ever was one: the "Featured creator" badge.
 */
export async function isFeaturedCreator(
  creatorKey: string,
  now = Date.now(),
  custom: CustomStore | null = customStore(),
  social: SocialStore | null = socialStore()
): Promise<boolean> {
  if (!custom) return false;
  try {
    if (await orOff((s) => s.wasPotd(creatorKey), false, social)) return true;
    const [best] = await custom.list("top", 1, now - WEEK_MS);
    if (best && net(best) > 0 && best.creatorKey === creatorKey) return true;
    const today = await orOff((s) => s.getPotd(utcDate(now)), null, social);
    return today?.creatorKey === creatorKey;
  } catch (err) {
    if (err instanceof CustomOffError) return false;
    throw err;
  }
}

/** A creator's page: their puzzles and total votes. Null for a bad name, no puzzles, or the creator store being off. */
export async function creatorPage(name: string, custom: CustomStore | null = customStore()): Promise<CreatorPage | null> {
  const clean = name.trim();
  if (!custom || !CREATOR_NAME_RE.test(clean)) return null;
  try {
    const puzzles = await custom.byCreatorName(clean, 100);
    if (!puzzles.length) return null;
    return {
      name: summaryOf(puzzles[0]).creator ?? clean,
      puzzles: puzzles.map(summaryOf),
      votes: puzzles.reduce((n, p) => n + p.up, 0),
      score: puzzles.reduce((n, p) => n + net(p), 0),
    };
  } catch (err) {
    if (err instanceof CustomOffError) return null;
    throw err;
  }
}
