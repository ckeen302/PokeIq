import { GEO_SHOTS_DIRECT, GEO_SHOT_ROUTE_ID_RE, geoStorageUrl } from "@/lib/geo-storage";

/**
 * GET /api/geo/shot/:id — a PokéGuessr screenshot. Ids are random, so the URL
 * says nothing about the location. Images live in the media store
 * (src/lib/geo-storage: Supabase Storage unless NEXT_PUBLIC_MEDIA_BASE says
 * otherwise; old ones too, so a game started before an update keeps its
 * pictures); the CDN caches them for a year.
 *
 * While rounds load their pictures through here (the default, see
 * GEO_SHOTS_DIRECT), an edge function streams the picture through with only
 * its type and length, so none of the store's own headers (its upload time
 * among them) reach the player. Once rounds load straight from the store,
 * this only redirects there, for links and games from before.
 */
export const runtime = "edge";

const NOT_FOUND = () => Response.json({ error: "Not found" }, { status: 404 });
const YEAR = "public, max-age=31536000, s-maxage=31536000, immutable";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!GEO_SHOT_ROUTE_ID_RE.test(id)) return NOT_FOUND();
  if (GEO_SHOTS_DIRECT) return new Response(null, { status: 308, headers: { Location: geoStorageUrl(id), "Cache-Control": YEAR } });
  try {
    const upstream = await fetch(geoStorageUrl(id), { signal: AbortSignal.timeout(10_000) });
    if (!upstream.ok || !upstream.body) return NOT_FOUND();
    const length = upstream.headers.get("content-length");
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "image/webp",
        ...(length ? { "Content-Length": length } : {}),
        "Cache-Control": YEAR,
      },
    });
  } catch {
    return Response.json({ error: "Upstream error" }, { status: 502 });
  }
}
