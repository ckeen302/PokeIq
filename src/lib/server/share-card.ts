import "server-only";
import { verifyToken } from "./crypto";
import type { ShareCard } from "@/lib/session-types";
import { optionalName } from "@/lib/name-filter";

export function readShareCard(token: string): ShareCard | null {
  let raw: string;
  try {
    raw = decodeURIComponent(token);
  } catch {
    return null; // malformed %-escape: treat as an invalid link (404), not a crash
  }
  const card = verifyToken<ShareCard>("share", raw);
  // Links signed before names were checked: shown without the name.
  return card && { ...card, n: optionalName(card.n) };
}
