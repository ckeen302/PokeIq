import { RACE_ENTRANTS } from "@/lib/race/data";
import { toRow } from "@/lib/race/types";

/**
 * GET /api/race: every runner /pokedex/race can field (the 1,025 Pokémon
 * and the forms with their own base stats) as compact rows: stats, size,
 * shape, gait and render box. Built once at build time and served static;
 * the 3D page fetches it when it starts.
 */
export const dynamic = "force-static";

export function GET() {
  return Response.json(RACE_ENTRANTS.map(toRow), {
    headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" },
  });
}
