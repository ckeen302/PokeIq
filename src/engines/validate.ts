/**
 * Self-verification gate. Every generated question passes through this Zod
 * schema before it can be served — a logic bug in an engine produces a
 * dropped-and-logged question, never a broken one shipped to a player.
 */
import { z } from "zod";
import type { QuizQuestion } from "./types";

const ALLOWED_IMAGE_HOSTS = new Set(["raw.githubusercontent.com"]);

export const quizQuestionSchema = z
  .object({
    question: z.string().trim().min(10).max(400),
    options: z.array(z.string().trim().min(1).max(120)).min(2).max(4),
    correctAnswer: z.string().trim().min(1),
    explanation: z.string().trim().min(5).max(600),
    imageUrl: z.string().url().optional(),
    imageHint: z.enum(["normal", "silhouette", "pixelated"]).optional(),
    optionImages: z.record(z.string(), z.string().url()).optional(),
    difficulty: z.enum(["easy", "medium", "hard"]),
  })
  .superRefine((q, ctx) => {
    if (!q.options.includes(q.correctAnswer)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `correctAnswer "${q.correctAnswer}" is not among the options`,
        path: ["correctAnswer"],
      });
    }
    const normalized = q.options.map((o) => o.toLowerCase());
    if (new Set(normalized).size !== normalized.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate options: ${q.options.join(" | ")}`,
        path: ["options"],
      });
    }
    const checkImageHost = (url: string, path: (string | number)[]) => {
      try {
        const { protocol, hostname } = new URL(url);
        if (protocol !== "https:" || !ALLOWED_IMAGE_HOSTS.has(hostname)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `image host not allowed: ${hostname}`,
            path,
          });
        }
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "image is not a valid URL",
          path,
        });
      }
    };
    if (q.imageUrl) checkImageHost(q.imageUrl, ["imageUrl"]);
    if (q.optionImages) {
      for (const [option, url] of Object.entries(q.optionImages)) {
        if (!q.options.includes(option)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `optionImages key "${option}" is not an option`,
            path: ["optionImages", option],
          });
        }
        checkImageHost(url, ["optionImages", option]);
      }
    }
  });

export interface ValidationResult {
  ok: boolean;
  question?: QuizQuestion;
  issues?: string[];
}

export function validateQuestion(candidate: unknown): ValidationResult {
  const parsed = quizQuestionSchema.safeParse(candidate);
  if (parsed.success) {
    return { ok: true, question: parsed.data as QuizQuestion };
  }
  return {
    ok: false,
    issues: parsed.error.issues.map(
      (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
    ),
  };
}
