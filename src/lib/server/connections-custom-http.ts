import "server-only";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { CUSTOM_GROUP_NAME_MAX, CUSTOM_TITLE_MAX } from "@/lib/connections/custom";
import { sessionTokenHash, userFromRequest } from "./auth";
import { duelNameSchema } from "./duel-core";

/** Shared by the community-puzzle routes. */

export const NO_STORE = { "Cache-Control": "no-store" };

export const PLAYER = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, "Bad player id.");

/** The shapes the creator sends. Length and name rules are checked in full by validateCustom. */
export const inputSchema = z.object({
  title: z.string().max(CUSTOM_TITLE_MAX + 20).optional(),
  groups: z
    .array(
      z.object({
        name: z.string().max(CUSTOM_GROUP_NAME_MAX + 20),
        level: z.number().int().min(0).max(3),
        members: z.array(z.number().int().positive().max(100_000)).max(8),
      })
    )
    .max(8),
  name: duelNameSchema.optional(),
  player: PLAYER.optional(),
});

/** Who is asking: a signed-in trainer counts as their account, everywhere; otherwise the browser's id. */
export async function whoIs(request: NextRequest, player: string | undefined): Promise<{ identity: string; username: string | null } | null> {
  if (sessionTokenHash(request)) {
    try {
      const user = await userFromRequest(request);
      if (user) return { identity: `u:${user.id}`, username: user.username };
    } catch {
      // Treated as signed out.
    }
  }
  return player ? { identity: `d:${player}`, username: null } : null;
}
