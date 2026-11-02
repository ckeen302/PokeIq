import { SIZE_ITEMS } from "@/lib/sizes/data";
import { toRow } from "@/lib/sizes/types";

/**
 * GET /api/sizes: every figure /pokedex/sizes can show (1,025 Pokémon, their
 * Mega, Gigantamax, regional and Eternamax forms, and the real-world
 * references) as compact rows. Built once at build time and served static;
 * the 3D page fetches it when it starts, so the HTML only carries the list.
 */
export const dynamic = "force-static";

export function GET() {
  return Response.json(SIZE_ITEMS.map(toRow), {
    headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" },
  });
}
