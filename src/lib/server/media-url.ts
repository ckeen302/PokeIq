import "server-only";
import type { MediaKind, MediaRef } from "@/engines/types";
import { decryptJson, openBlock, sealBlock } from "./crypto";

/**
 * Opaque /api/media URLs for a question's secret media (silhouette, cry,
 * Zoom Reveal crop). Kept apart from ./session so routes that only need a
 * media link (Pokédle, its duels) don't load every quiz engine at cold start.
 *
 * A token is one AES block holding {window, kind, id, step, crop} plus a fixed
 * check pattern. It is the same for every player within a 6-hour window, so
 * Vercel's CDN can cache each image once per window instead of every view
 * going through the function. It still reveals neither the Pokédex number
 * nor the kind: without the server secret a token is 16 random-looking bytes,
 * and the key changes nothing about what a player could already learn, since
 * the image bytes for a Pokémon were always identical. A new window gives
 * every image new URLs, so a table of URLs seen in one window is useless in
 * the next.
 */

export const MEDIA_WINDOW_MS = 6 * 60 * 60 * 1000;
const PURPOSE = "media-url-v2";
const MAGIC = 0xa7;
const KINDS: MediaKind[] = ["silhouette", "silhouette-zoom", "artwork", "cry", "zoom-reveal"];

export interface MediaTarget {
  kind: MediaKind;
  id: number;
  /** Zoom Reveal step (1..6) and start crop; 1 and 0 for other kinds. */
  step: number;
  crop: number;
}

const windowOf = (now: number) => Math.floor(now / MEDIA_WINDOW_MS);

export function mediaToken(ref: MediaRef, now = Date.now()): string {
  const zoom = ref.kind === "zoom-reveal";
  const block = Buffer.alloc(16);
  block[0] = MAGIC;
  block.writeUInt32BE(windowOf(now), 1);
  block[5] = KINDS.indexOf(ref.kind);
  block.writeUInt16BE(ref.pokemonId, 6);
  block[8] = zoom ? (ref.step ?? 1) : 1;
  block.writeUInt16BE(zoom ? (ref.crop ?? 0) : 0, 9);
  // bytes 11..15 stay zero: with the magic byte, 48 bits a forgery must hit.
  return sealBlock(block, PURPOSE);
}

export function mediaUrl(ref: MediaRef): string {
  return `/api/media/${mediaToken(ref)}`;
}

/** Legacy per-request tokens (AES-GCM JSON), still accepted for games already in progress. */
interface LegacyToken {
  k: MediaKind;
  id: number;
  x: number;
  s?: number;
  c?: number;
}

/**
 * The media a token names, "expired" for a token from an old window, or null
 * for anything that isn't a token we issued. A token is good for its own
 * window and the next one, so a question asked just before a window ends
 * still loads.
 */
export function readMediaToken(token: string, now = Date.now()): MediaTarget | "expired" | null {
  const block = openBlock(token, PURPOSE);
  if (block) {
    if (block[0] !== MAGIC || !block.subarray(11).equals(Buffer.alloc(5))) return null;
    const kind = KINDS[block[5]];
    if (!kind) return null;
    const age = windowOf(now) - block.readUInt32BE(1);
    if (age < -1) return null;
    if (age > 1) return "expired";
    return { kind, id: block.readUInt16BE(6), step: block[8], crop: block.readUInt16BE(9) };
  }
  const legacy = decryptJson<LegacyToken>(token);
  if (!legacy || typeof legacy.id !== "number" || !KINDS.includes(legacy.k)) return null;
  if (legacy.x < now) return "expired";
  return { kind: legacy.k, id: legacy.id, step: legacy.s ?? 1, crop: legacy.c ?? 0 };
}
