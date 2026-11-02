import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { RACE_ENTRANTS } from "@/lib/race/data";
import { homeRenderUrl } from "@/lib/pokemon/art";

/**
 * GET /api/race/home/:id?s=512: a Pokémon HOME render (PokéAPI's sprites)
 * as WebP for the runners on /pokedex/race, at 256 or 512 px, for every
 * Pokémon and form the race can field. The alpha edge is kept at full
 * quality because the figures are cut out by it, and the edge colours are
 * bled outwards so filtering never darkens it. Same-origin (WebGL
 * textures need CORS) and immutable, so each size is transcoded once per
 * edge, not per visitor.
 */

export const runtime = "nodejs";

const SIZES = new Set([256, 512]);

/**
 * Bleeds the figure's edge colours out into the transparent pixels around
 * it (a few rings of dilation), so the GPU's filtering and mip-maps never
 * mix the cut-out edge with the render's invisible (often black) background.
 */
function bleed(px: Buffer, w: number, h: number, rings = 6) {
  const known = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) known[i] = px[i * 4 + 3] > 8 ? 1 : 0;
  for (let ring = 0; ring < rings; ring++) {
    const add: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (known[i]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const j = yy * w + xx;
            if (known[j] !== 1 && !(known[j] === 2)) continue;
            r += px[j * 4]; g += px[j * 4 + 1]; b += px[j * 4 + 2]; n++;
          }
        }
        if (n) add.push(i, r / n, g / n, b / n);
      }
    }
    if (!add.length) break;
    for (let k = 0; k < add.length; k += 4) {
      const i = add[k];
      px[i * 4] = add[k + 1]; px[i * 4 + 1] = add[k + 2]; px[i * 4 + 2] = add[k + 3];
      known[i] = 2;
    }
  }
}
const KNOWN = new Set(RACE_ENTRANTS.map((e) => String(e.art)));
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
      bleed(data, info.width, info.height);
      body = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).webp({ quality: size === 512 ? 90 : 84, alphaQuality: 100, effort: 4 }).toBuffer();
    } catch (err) {
      console.error("[api/race/home]", id, err instanceof Error ? err.message : err);
      return NextResponse.json({ error: "Render unavailable" }, { status: 502 });
    }
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
    cache.set(key, body);
  }
  return new NextResponse(new Uint8Array(body), {
    headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable" },
  });
}
