import { NextRequest, NextResponse } from "next/server";
import { getPokemon } from "@/lib/pokemon/pokedex";
import { officialArtworkUrl, transcodeArt } from "@/lib/server/art-transcode";
import { BOARD_ART_SIZE, boardArtUrl, hasBoardArt } from "@/lib/pokemon/art";

/**
 * GET /api/art/:id?s=160&shiny=1 — resized WebP official artwork for the
 * Pokédex (public data, unlike quiz media). Responses are immutable and
 * CDN-cacheable, so each size is transcoded once per edge, not per visitor:
 * a 1,025-card grid ships ~8 KB thumbnails instead of 100+ KB PNGs.
 *
 * Every species' 160px picture is also a static file (public/art/160, see
 * scripts/board-art.ts), which the CDN serves without waking this route:
 * pages ask for it directly at 96 and 160 px, and this redirects old links there.
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
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // A species' small sizes are the static 160 px file (artUrl sends pages straight there; this is for old links).
  if (!shiny && size <= BOARD_ART_SIZE && hasBoardArt(id)) {
    const res = NextResponse.redirect(new URL(boardArtUrl(id), request.url), 308);
    res.headers.set("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable");
    return res;
  }

  const key = `${id}:${size}:${shiny ? 1 : 0}`;
  let body = cache.get(key);
  if (!body) {
    try {
      const res = await fetch(officialArtworkUrl(id, shiny), { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return NextResponse.json({ error: "Artwork unavailable" }, { status: res.status === 404 ? 404 : 502 });
      body = await transcodeArt(Buffer.from(await res.arrayBuffer()), size);
    } catch (err) {
      // Upstream timeout / network error or a corrupt image.
      console.error("[api/art]", id, err instanceof Error ? err.message : err);
      return NextResponse.json({ error: "Artwork unavailable" }, { status: 502 });
    }
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
