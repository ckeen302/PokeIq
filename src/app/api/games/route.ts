import { athleteRows } from "@/lib/games/data";

/**
 * GET /api/games: every athlete the PokéIQ Games can field (the Race's
 * entrants plus each one's egg-group and ability traits) as compact rows.
 * Built once at build time and served static; the 3D page fetches it when
 * it starts.
 */
export const dynamic = "force-static";

export function GET() {
  return Response.json(athleteRows(), {
    headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" },
  });
}
