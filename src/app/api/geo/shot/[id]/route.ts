import { NextRequest, NextResponse } from "next/server";
import { shotSource } from "@/lib/server/geo";

/**
 * GET /api/geo/shot/:id — a PokéGuessr screenshot. Ids are random, so the URL
 * says nothing about the location. Images live in Supabase Storage; this
 * route only serves known ids and lets the CDN cache them for a year.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const source = /^[A-Za-z0-9_-]{8,24}$/.test(id) ? shotSource(id) : null;
  if (!source) return new NextResponse("Not found", { status: 404 });
  try {
    const upstream = await fetch(source, { signal: AbortSignal.timeout(10_000) });
    if (!upstream.ok) return new NextResponse("Not found", { status: 404 });
    return new NextResponse(await upstream.arrayBuffer(), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("Upstream error", { status: 502 });
  }
}
