import { NextRequest, NextResponse } from "next/server";
import ART from "@/data/sizes-art.json";
import { homeRenderUrl } from "@/lib/pokemon/art";
import { HOME_SIZES, transcodeHome, type HomeSize } from "@/lib/server/sizes-art";

/**
 * GET /api/sizes/home/:id?s=512: a Pokémon HOME render (PokéAPI's sprites)
 * as WebP for the 3D figures on /pokedex/sizes, at 128, 256 or 512 px. The
 * alpha edge is kept lossless-quality because the figures are cut out by it.
 * Same-origin (WebGL textures need CORS) and immutable, so each size is
 * transcoded once per edge, not per visitor. The scene itself loads the
 * same pictures as static files (public/sizes/art, scripts/sizes-art.ts).
 */

export const runtime = "nodejs";

const SIZES = new Set<number>(HOME_SIZES);
const KNOWN = new Set(Object.keys(ART));
const cache = new Map<string, Buffer>();

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const raw = (await context.params).id;
  const size = Number(request.nextUrl.searchParams.get("s") ?? 512);
  if (!KNOWN.has(raw) || !SIZES.has(size)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const id = Number(raw);
  const key = `${id}:${size}`;
  let body = cache.get(key);
  if (!body) {
    try {
      const res = await fetch(homeRenderUrl(id), { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return NextResponse.json({ error: "Render unavailable" }, { status: res.status === 404 ? 404 : 502 });
      body = await transcodeHome(Buffer.from(await res.arrayBuffer()), size as HomeSize);
    } catch (err) {
      console.error("[api/sizes/home]", id, err instanceof Error ? err.message : err);
      return NextResponse.json({ error: "Render unavailable" }, { status: 502 });
    }
    if (cache.size > 400) cache.delete(cache.keys().next().value!);
    cache.set(key, body);
  }
  return new NextResponse(new Uint8Array(body), {
    headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable" },
  });
}
