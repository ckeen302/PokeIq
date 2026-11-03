import { buildLearnsets } from "@/lib/mass-battle/roster-data";

/**
 * GET /api/mass-battle/learnsets: every move each Pokémon (and battle form)
 * can legally learn that the Mass Battle can play, as indices into the
 * roster's move list (Showdown's learnsets, the newest generation each
 * appears in, pre-evolutions included). Built at build time and served
 * static; the setup panel fetches it when a set is opened for editing.
 */
export const dynamic = "force-static";

export function GET() {
  return Response.json(buildLearnsets(), {
    headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" },
  });
}
