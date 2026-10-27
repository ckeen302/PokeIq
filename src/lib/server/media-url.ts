import "server-only";
import type { MediaRef } from "@/engines/types";
import { encryptJson } from "./crypto";

/**
 * Encrypted /api/media URL for a question's secret media (silhouette, cry).
 * Kept apart from ./session so routes that only need a media link (Pokédle,
 * its duels) don't load every quiz engine at cold start.
 */
const MEDIA_TTL_MS = 30 * 60 * 1000;

export function mediaUrl(ref: MediaRef): string {
  return `/api/media/${encryptJson({ k: ref.kind, id: ref.pokemonId, x: Date.now() + MEDIA_TTL_MS })}`;
}
