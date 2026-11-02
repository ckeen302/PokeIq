import { buildRoster } from "@/lib/mass-battle/roster-data";

/**
 * GET /api/mass-battle/roster: every Pokémon the Mass Battle can field, with
 * its real stats and its set (random-battle set or level-up moves), and the
 * moves' rules. Built once at build time from the repo's data and served
 * static; the page fetches it when a battle is set up.
 */
export const dynamic = "force-static";

export function GET() {
  return Response.json(buildRoster(), {
    headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" },
  });
}
