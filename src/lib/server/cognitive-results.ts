import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import { MAX_RAW } from "@/lib/cognitive/plan";
import { COG_SECTIONS, type CogSection } from "@/lib/cognitive/types";

/**
 * Anonymous Cognitive PokéIQ results (migration 0044, `cognitive_results`):
 * the four raw section scores and the composite of every finished test, no
 * name, account or device, so the seeded norms (src/data/cognitive-norms.json)
 * can be re-fitted on real trainers later.
 *
 * Fails open: without Supabase, or until the table exists, nothing is
 * logged and scoring carries on from the seeded norms. With
 * POKEIQ_LOCAL_ACCOUNTS=1 (tests, the local E2E run) rows live in memory.
 */

export interface CognitiveRow {
  fluid: number;
  memory: number;
  speed: number;
  spatial: number;
  composite: number;
  /** Which version of the test and norms produced it. */
  version: number;
}

export interface CognitiveStore {
  insert(row: CognitiveRow): Promise<void>;
  count(): Promise<number>;
}

class Unavailable extends Error {}

const globalStore = globalThis as unknown as { __pokeiqCognitiveResults?: CognitiveRow[] };
const mem = () => (globalStore.__pokeiqCognitiveResults ??= []);
export function clearMemoryCognitiveResults() {
  globalStore.__pokeiqCognitiveResults = [];
}

export function memoryCognitiveStore(): CognitiveStore {
  return {
    async insert(row) {
      mem().push(row);
    },
    async count() {
      return mem().length;
    },
  };
}

const MISSING = new Set(["42P01", "PGRST205", "PGRST204", "42703"]);
let warnedAt = 0;
function check(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  if (MISSING.has(error.code ?? "") || /does not exist|schema cache/i.test(error.message ?? "")) {
    if (Date.now() - warnedAt > 10 * 60_000) console.warn("[cognitive-results] off until migration 0044_cognitive_results.sql is applied:", error.message);
    warnedAt = Date.now();
    throw new Unavailable(error.message);
  }
  throw new Error(error.message);
}

type Sb = NonNullable<ReturnType<typeof getServiceSupabase>>;
export function supabaseCognitiveStore(sb: Sb): CognitiveStore {
  return {
    async insert(row) {
      const { error } = await sb.from("cognitive_results").insert({
        fluid_raw: row.fluid,
        memory_raw: row.memory,
        speed_raw: row.speed,
        spatial_raw: row.spatial,
        composite: row.composite,
        version: row.version,
      });
      check(error);
    },
    async count() {
      const { count, error } = await sb.from("cognitive_results").select("id", { count: "exact", head: true });
      check(error);
      return count ?? 0;
    },
  };
}

export function cognitiveStore(): CognitiveStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memoryCognitiveStore();
  const sb = getServiceSupabase();
  if (sb) return supabaseCognitiveStore(sb);
  return process.env.NODE_ENV !== "production" ? memoryCognitiveStore() : null;
}

/** A well-formed row from an untrusted body, or null. */
export function cognitiveRowOf(body: unknown): CognitiveRow | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const row = {} as Record<CogSection, number>;
  for (const k of COG_SECTIONS) {
    const v = o[k];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAX_RAW[k]) return null;
    row[k] = v;
  }
  const composite = o.composite;
  if (typeof composite !== "number" || !Number.isInteger(composite) || composite < 40 || composite > 160) return null;
  return { ...row, composite, version: 1 };
}

/** Logs a finished test. Never throws: a database problem can't stop a result page. Returns whether it was stored. */
export async function logCognitiveResult(row: CognitiveRow, store = cognitiveStore()): Promise<boolean> {
  if (!store) return false;
  try {
    await store.insert(row);
    return true;
  } catch (err) {
    if (!(err instanceof Unavailable)) console.error("[cognitive-results] not logged:", err);
    return false;
  }
}
