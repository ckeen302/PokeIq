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
  kind: z.enum(["silhouette", "silhouette-zoom", "artwork", "cry", "zoom-reveal"]),
  pokemonId: z.number().int().positive(),
  step: z.number().int().min(1).max(6).optional(),
  crop: z.number().int().min(0).optional(),
});

export const questionSchema = z
  .object({
    itemKey: z.string().min(3),
    module: z.enum(["whos-that", "cry", "dex", "types", "higher-lower", "games", "anime", "competitive", "shiny", "zoom-reveal", "whose-team"]),
    prompt: z.string().min(8),
    detail: z.string().optional(),
    media: mediaSchema.optional(),
    cards: z.array(z.object({ pokemonId: z.number().int().positive(), label: z.string() })).optional(),
    optionImages: z.boolean().optional(),
    // Typed trainer names autocomplete over every name the mode knows; the counts are checked below.
    options: z.array(z.string().min(1)).max(500),
    answer: z.string().min(1),
    explanation: z.string().optional(),
    source: z.string().url().optional(),
    revealMedia: mediaSchema.optional(),
    rating: z.number().min(400).max(2400),
    input: z.enum(["name", "type"]).optional(),
    reveal: z.number().int().min(1).optional(),
  })
  .superRefine((q, ctx) => {
    // Typed-name questions have no options at all; every other kind has 2–6.
    if (q.input === "name" ? q.options.length !== 0 : q.options.length < 2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${q.options.length} options` });
    }
    if (q.input !== "name" && !q.options.includes(q.answer)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `answer "${q.answer}" not in options` });
    }
    if (q.input !== "type" && q.options.length > 6) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "more than 6 options to pick from" });
    }
    if (q.reveal !== undefined && q.reveal > (q.cards?.length ?? 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "reveals more cards than there are" });
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
