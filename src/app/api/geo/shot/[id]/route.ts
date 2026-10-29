import { GEO_SHOT_ROUTE_ID_RE, GEO_STORAGE_BASE } from "@/lib/geo-storage";

/**
 * GET /api/geo/shot/:id — a PokéGuessr screenshot. Ids are random, so the URL
 * says nothing about the location. Images live in Supabase Storage (old ones
 * too, so a game started before an update keeps its pictures); the CDN caches
 * them for a year.
 *
 * An edge function that streams the picture through without loading the
 * game's data (Storage serves it uncached, so the CDN copy is what makes
 * repeat views free): a first view costs one quick hop, with no cold start.
 */
export const runtime = "edge";

const NOT_FOUND = () => Response.json({ error: "Not found" }, { status: 404 });

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!GEO_SHOT_ROUTE_ID_RE.test(id)) return NOT_FOUND();
  try {
    const upstream = await fetch(`${GEO_STORAGE_BASE}/${id}.webp`, { signal: AbortSignal.timeout(10_000) });
    if (!upstream.ok || !upstream.body) return NOT_FOUND();
    const length = upstream.headers.get("content-length");
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "image/webp",
        ...(length ? { "Content-Length": length } : {}),
        "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
      },
    });
  } catch {
    return Response.json({ error: "Upstream error" }, { status: 502 });
  }
}
