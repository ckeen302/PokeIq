import "server-only";
import { z } from "zod";
import { MAX_GEN_WHOAMI, WHOAMI_ABILITIES, WHOAMI_MAX_BID, WHOAMI_ROUNDS } from "@/lib/whoami";

/** Request shapes for Who Am I? (practice, duels and matchmaking). */

const gen = z.number().int().min(1).max(MAX_GEN_WHOAMI);
export const whoamiSettingsSchema = z.object({ from: gen, to: gen, casual: z.boolean() });
export const whoamiAbilitySchema = z.enum(WHOAMI_ABILITIES);
export const whoamiQuestionSchema = z.string().min(3).max(60);
const round = z.number().int().min(0).max(WHOAMI_ROUNDS);

export const whoamiMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("settings"), settings: whoamiSettingsSchema }),
  z.object({ type: z.literal("pick"), ability: whoamiAbilitySchema }),
  z.object({ type: z.literal("ask"), round, q: whoamiQuestionSchema }),
  z.object({ type: z.literal("guess"), round, pokemon: z.number().int().positive().max(100_000) }),
  z.object({ type: z.literal("bid"), round, amount: z.number().int().min(0).max(WHOAMI_MAX_BID) }),
  z.object({ type: z.literal("ability"), round }),
]);
