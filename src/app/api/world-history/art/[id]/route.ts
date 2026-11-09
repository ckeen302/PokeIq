import { NextRequest } from "next/server";
import { FILM_ART_IDS } from "@/lib/server/figure-art-ids";
import { figureArtRedirect } from "@/lib/server/figure-art-route";

/**
 * GET /api/world-history/art/:id?s=512: a film figure's Pokémon HOME render
 * (The History of the Pokémon World, The Story of Pokémon), 256 or 512 px.
 * The pictures are static files now (public/race/art, made by
 * scripts/figure-art.ts, src/lib/server/figure-art): this redirects there.
 */

export const runtime = "nodejs";

export function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return figureArtRedirect(request, context, FILM_ART_IDS);
}
