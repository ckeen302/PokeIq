import { buildRoster } from "@/lib/tier-list/roster.server";

/** GET /tools/tier-list/roster.json: every Pokémon and form the Tier List Maker offers, built when the site builds. */
export const dynamic = "force-static";

export function GET() {
  return Response.json(buildRoster(), { headers: { "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" } });
}
