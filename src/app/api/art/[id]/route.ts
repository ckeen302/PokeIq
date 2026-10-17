import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { getPokemon } from "@/lib/pokemon/pokedex";

/**
 * GET /api/art/:id?s=160&shiny=1 — resized WebP official artwork for the
 * Pokédex (public data, unlike quiz media). Responses are immutable and
 * CDN-cacheable, so each size is transcoded once per edge, not per visitor:
 * a 1,025-card grid ships ~8 KB thumbnails instead of 100+ KB PNGs.
 */

export const runtime = "nodejs";

const SIZES = new Set([96, 160, 256, 400]);
const cache = new Map<string, Buffer>();

function isKnownId(id: number): boolean {
  // Species 1–1025, plus alternate forms (PokéAPI uses 10001+ for varieties).
  return Boolean(getPokemon(id)) || (id > 10000 && id < 10400);
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const id = Number((await context.params).id);
  const size = Number(request.nextUrl.searchParams.get("s") ?? 256);
  const shiny = request.nextUrl.searchParams.get("shiny") === "1";
  if (!Number.isInteger(id) || !isKnownId(id) || !SIZES.has(size)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const key = `${id}:${size}:${shiny ? 1 : 0}`;
  let body = cache.get(key);
  if (!body) {
    const src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${shiny ? "shiny/" : ""}${id}.png`;
    const res = await fetch(src, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return new NextResponse("Artwork unavailable", { status: res.status === 404 ? 404 : 502 });
    body = await sharp(Buffer.from(await res.arrayBuffer()))
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 82 })
      .toBuffer();
    if (cache.size > 600) cache.delete(cache.keys().next().value!);
    cache.set(key, body);
  }

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
    },
  });
}
