import { NextRequest } from "next/server";
import { RACE_ART_IDS } from "@/lib/server/figure-art-ids";
import { figureArtRedirect } from "@/lib/server/figure-art-route";

/**
 * GET /api/race/home/:id?s=512: a race runner's Pokémon HOME render, 256 or
 * 512 px. The pictures are static files now (public/race/art, made by
 * scripts/figure-art.ts, src/lib/server/figure-art): this redirects there.
 */

export const runtime = "nodejs";

export function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return figureArtRedirect(request, context, RACE_ART_IDS);
}
