import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { decryptJson } from "@/lib/server/crypto";
import { artworkUrl, cryUrl, getPokemon } from "@/lib/pokemon/pokedex";
import { hashString } from "@/lib/rng";
import { ZOOM_PADDING, pickZoomWindow } from "@/lib/server/zoom";
import type { MediaKind } from "@/engines/types";

/**
 * GET /api/media/:token — opaque question media.
 *
 * The token is AES-GCM encrypted {kind, id, expiry}, so the URL reveals
 * nothing. Silhouettes are rendered here with sharp (alpha channel kept,
 * colour discarded), meaning the full artwork never reaches the browser
 * before the answer is graded — no "open image in new tab" cheating.
 */

export const runtime = "nodejs";

interface MediaToken {
  k: MediaKind;
  id: number;
  x: number;
}

interface Rendered {
  body: Buffer;
  type: string;
}

const cache = new Map<string, Rendered>();
const CACHE_LIMIT = 400;

async function fetchUpstream(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`upstream ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function silhouette(art: Buffer): Promise<ReturnType<typeof sharp>> {
  const { width = 475, height = 475 } = await sharp(art).metadata();
  const alpha = await sharp(art).ensureAlpha().extractChannel(3).png().toBuffer();
  const black = await sharp({
    create: { width, height, channels: 3, background: { r: 15, g: 23, b: 42 } },
  })
    .joinChannel(alpha)
    .png()
    .toBuffer();
  return sharp(black);
}

async function render(kind: MediaKind, id: number): Promise<Rendered> {
  if (kind === "cry") {
    return { body: await fetchUpstream(cryUrl(id)), type: "audio/ogg" };
  }
  const art = await fetchUpstream(artworkUrl(id));
  if (kind === "artwork") {
    return { body: await sharp(art).resize(400).webp({ quality: 82 }).toBuffer(), type: "image/webp" };
  }

  let img = await silhouette(art);
  if (kind === "silhouette-zoom") {
    // Zoom onto the most outline-rich part of the trimmed silhouette, so the
    // crop always shows recognisable shape (never a solid black square).
    const trimmed = await img.trim().png().toBuffer({ resolveWithObject: true });
    const pad = Math.round(Math.max(trimmed.info.width, trimmed.info.height) * ZOOM_PADDING);
    const padded = await sharp(trimmed.data)
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer({ resolveWithObject: true });
    const alpha = await sharp(padded.data).extractChannel(3).raw().toBuffer();
    const crop = pickZoomWindow(new Uint8Array(alpha), padded.info.width, padded.info.height, hashString(`zoom:${id}`));
    img = sharp(padded.data).extract(crop);
  }
  return { body: await img.resize(400, 400, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 85 }).toBuffer(), type: "image/webp" };
}

export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const media = decryptJson<MediaToken>(token);
  if (!media || !getPokemon(media.id)) return new NextResponse("Not found", { status: 404 });
  if (media.x < Date.now()) return new NextResponse("Expired", { status: 410 });

  const key = `${media.k}:${media.id}`;
  try {
    let rendered = cache.get(key);
    if (!rendered) {
      rendered = await render(media.k, media.id);
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
      cache.set(key, rendered);
    }
    return new NextResponse(new Uint8Array(rendered.body), {
      headers: {
        "Content-Type": rendered.type,
        "Cache-Control": "private, max-age=1800, immutable",
        "Content-Length": String(rendered.body.length),
      },
    });
  } catch (err) {
    console.error("[api/media]", err);
    return new NextResponse("Upstream media unavailable", { status: 502 });
  }
}
