import seeded from "@/data/cognitive-norms.json";
import type { Norms } from "./scoring";

/**
 * The shipped norms (src/data/cognitive-norms.json, written by
 * scripts/cognitive-norms.ts). Scoring always works from these; the
 * anonymous results logged by /api/iq-test/result are there so they can be
 * re-fitted on real trainers later.
 */
export const NORMS: Norms = seeded as Norms;
