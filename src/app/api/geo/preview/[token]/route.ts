import { NextRequest, NextResponse } from "next/server";
import { GEO_PREVIEW_RE, previewShot, shotSource } from "@/lib/server/geo";

/**
 * GET /api/geo/preview/:name — a PokéGuessr screenshot shown outside a game
 * (the Atlas, the map picker, the how-to demo). The name is an HMAC of the
 * screenshot's id, resolved here, so a round's image URL (/api/geo/shot/:id)
 * can't be matched to a place through any public page. Cached for a year.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const id = GEO_PREVIEW_RE.test(token) ? previewShot(token) : null;
  if (!id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const upstream = await fetch(shotSource(id), { signal: AbortSignal.timeout(10_000) });
    if (!upstream.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return new NextResponse(await upstream.arrayBuffer(), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Upstream error" }, { status: 502 });
  }
}
