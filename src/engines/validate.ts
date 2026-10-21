import { z } from "zod";
import type { Question } from "./types";

/**
 * Self-verification gate.
 *
 * Questions are computed, not authored, so a logic bug could produce an
 * unanswerable one. Every candidate passes this schema before it can be
 * served; failures are dropped (deterministically, so the server re-derives
 * the same sequence when grading) and logged.
 */

const mediaSchema = z.object({
  kind: z.enum(["silhouette", "silhouette-zoom", "artwork", "cry"]),
  pokemonId: z.number().int().positive(),
});

export const questionSchema = z
  .object({
    itemKey: z.string().min(3),
    module: z.enum(["whos-that", "cry", "dex", "types", "higher-lower", "games", "anime"]),
    prompt: z.string().min(8),
    detail: z.string().optional(),
    media: mediaSchema.optional(),
    cards: z.array(z.object({ pokemonId: z.number().int().positive(), label: z.string() })).optional(),
    options: z.array(z.string().min(1)).min(2).max(6),
    answer: z.string().min(1),
    explanation: z.string().optional(),
    source: z.string().url().optional(),
    revealMedia: mediaSchema.optional(),
    rating: z.number().min(400).max(2400),
  })
  .superRefine((q, ctx) => {
    if (!q.options.includes(q.answer)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `answer "${q.answer}" not in options` });
    }
    if (new Set(q.options).size !== q.options.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate options" });
    }
  });

export function isValidQuestion(q: Question): boolean {
  const result = questionSchema.safeParse(q);
  if (!result.success) {
    console.warn(
      `[engine:${q.module}] dropped invalid question ${q.itemKey}:`,
      result.error.issues.map((i) => i.message).join("; ")
    );
  }
  return result.success;
}
