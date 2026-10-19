import { NextRequest, NextResponse } from "next/server";
import { shotSource } from "@/lib/server/geo";

/**
 * GET /api/geo/shot/:id — a PokéGuessr screenshot. Ids are random, so the URL
 * says nothing about the location. Images live in Supabase Storage (old ones
 * too, so a game started before an update keeps its pictures); the CDN caches
 * them for a year.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{8,24}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const source = shotSource(id);
  try {
    const upstream = await fetch(source, { signal: AbortSignal.timeout(10_000) });
    if (!upstream.ok) return new NextResponse("Not found", { status: 404 });
    return new NextResponse(await upstream.arrayBuffer(), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("Upstream error", { status: 502 });
  }
}
