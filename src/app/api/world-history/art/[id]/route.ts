import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { FIGURE_ARTS } from "@/lib/world-history/data";
import { bleedEdges } from "@/lib/world-history/bleed";
import { homeRenderUrl } from "@/lib/pokemon/art";

/**
 * GET /api/world-history/art/:id?s=512: the Pokémon HOME render (PokéAPI's
 * sprites) of a figure in The History of the Pokémon World, as WebP at 256
 * or 512 px. Only the figures the chapters show are served. The alpha edge
 * is kept at full quality (the figures are cut out by it) and the edge
 * colours are bled outwards so filtering never darkens it. Same-origin
 * (WebGL textures need CORS) and immutable, so each size is transcoded once
 * per edge, not per visitor.
 */

export const runtime = "nodejs";

const SIZES = new Set([256, 512]);
const KNOWN = new Set(FIGURE_ARTS.map(String));
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
      let img = sharp(Buffer.from(await res.arrayBuffer())).ensureAlpha();
      if (size !== 512) img = img.resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } });
      const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
      bleedEdges(data, info.width, info.height);
      body = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).webp({ quality: size === 512 ? 90 : 84, alphaQuality: 100, effort: 4 }).toBuffer();
    } catch (err) {
      console.error("[api/world-history/art]", id, err instanceof Error ? err.message : err);
      return NextResponse.json({ error: "Render unavailable" }, { status: 502 });
    }
    if (cache.size > 120) cache.delete(cache.keys().next().value!);
    cache.set(key, body);
  }
  return new NextResponse(new Uint8Array(body), {
    headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable" },
  });
}
