import "server-only";
import { verifyToken } from "./crypto";
import type { ShareCard } from "@/lib/session-types";

export function readShareCard(token: string): ShareCard | null {
  return verifyToken<ShareCard>("share", decodeURIComponent(token));
}
