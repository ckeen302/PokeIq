import "server-only";
import { verifyToken } from "./crypto";
import type { ShareCard } from "@/lib/session-types";

export function readShareCard(token: string): ShareCard | null {
  let raw: string;
  try {
    raw = decodeURIComponent(token);
  } catch {
    return null; // malformed %-escape: treat as an invalid link (404), not a crash
  }
  return verifyToken<ShareCard>("share", raw);
}
