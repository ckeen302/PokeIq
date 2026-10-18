import "server-only";
import { randomInt } from "node:crypto";
import { getServiceSupabase } from "@/lib/supabase";
import { DUEL_CODE_RE } from "@/lib/duel-types";
import type { Duel, DuelFailure } from "./duel";

/**
 * Where duels live while they're played: one row per duel in Supabase
 * (RLS-locked, service role only, since a duel holds pins the opponent mustn't
 * see yet). Every write is a compare-and-swap on the row's version, so two
 * trainers acting at the same moment never overwrite each other: the loser
 * re-reads and tries again.
 *
 * Without Supabase (or with POKEIQ_LOCAL_ACCOUNTS=1, as for accounts) duels
 * live in memory, which is right for one server process: local development
 * and the E2E test. Production without Supabase has no duels, since serverless
 * instances don't share memory.
 */

/** A duel is kept this long after its last change. */
const TTL_MS = 3 * 60 * 60 * 1000;
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const MAX_TRIES = 6;

function remote() {
  return process.env.POKEIQ_LOCAL_ACCOUNTS === "1" ? null : getServiceSupabase();
}

export function duelsEnabled(): boolean {
  return remote() !== null || process.env.NODE_ENV !== "production" || process.env.POKEIQ_LOCAL_ACCOUNTS === "1";
}

export function newDuelCode(): string {
  return Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

export interface StoredDuel {
  duel: Duel;
  version: number;
}

// ---------------------------------------------------------------------------
// Memory backend
// ---------------------------------------------------------------------------

interface MemoryRow {
  /** Stored as JSON, so no caller ever holds a live reference to it. */
  json: string;
  version: number;
  expires: number;
}

const globalStore = globalThis as unknown as { __pokeiqDuels?: Map<string, MemoryRow> };
const memory = () => (globalStore.__pokeiqDuels ??= new Map<string, MemoryRow>());

// ---------------------------------------------------------------------------
// Reads and writes
// ---------------------------------------------------------------------------

export async function loadDuel(code: string): Promise<StoredDuel | null> {
  const sb = remote();
  if (sb) {
    const { data, error } = await sb
      .from("geo_duels")
      .select("state, version, expires_at")
      .eq("code", code)
      .maybeSingle<{ state: Duel; version: number; expires_at: string }>();
    if (error) throw new Error(error.message);
    if (!data || Date.parse(data.expires_at) <= Date.now()) return null;
    return { duel: data.state, version: data.version };
  }
  const row = memory().get(code);
  if (!row || row.expires <= Date.now()) return null;
  return { duel: JSON.parse(row.json) as Duel, version: row.version };
}

/** A duel for its page and preview card: null if there's no such duel, undefined if the store couldn't say. */
export async function peekDuel(code: string): Promise<Duel | null | undefined> {
  if (!DUEL_CODE_RE.test(code)) return null;
  try {
    return (await loadDuel(code))?.duel ?? null;
  } catch (err) {
    console.error("[geo-duel] read failed:", err);
    return undefined;
  }
}

/** False if the code is taken. */
export async function insertDuel(duel: Duel): Promise<boolean> {
  const expires = Date.now() + TTL_MS;
  const sb = remote();
  if (sb) {
    // Opportunistic cleanup keeps the table small without a cron job.
    await sb.from("geo_duels").delete().lt("expires_at", new Date().toISOString());
    const { error } = await sb
      .from("geo_duels")
      .insert({ code: duel.code, version: 0, state: duel, expires_at: new Date(expires).toISOString() });
    if (error?.code === "23505") return false;
    if (error) throw new Error(error.message);
    return true;
  }
  const rows = memory();
  for (const [code, row] of rows) if (row.expires <= Date.now()) rows.delete(code);
  if (rows.has(duel.code)) return false;
  rows.set(duel.code, { json: JSON.stringify(duel), version: 0, expires });
  return true;
}

/** Compare-and-swap: writes only if the stored version is still `version`. False if someone got there first. */
export async function saveDuel(duel: Duel, version: number): Promise<boolean> {
  const expires = Date.now() + TTL_MS;
  const sb = remote();
  if (sb) {
    const { data, error } = await sb
      .from("geo_duels")
      .update({ state: duel, version: version + 1, updated_at: new Date().toISOString(), expires_at: new Date(expires).toISOString() })
      .eq("code", duel.code)
      .eq("version", version)
      .select("code");
    if (error) throw new Error(error.message);
    return (data ?? []).length === 1;
  }
  const row = memory().get(duel.code);
  if (!row || row.version !== version) return false;
  memory().set(duel.code, { json: JSON.stringify(duel), version: version + 1, expires });
  return true;
}

export async function deleteDuel(code: string): Promise<void> {
  const sb = remote();
  if (sb) {
    await sb.from("geo_duels").delete().eq("code", code);
    return;
  }
  memory().delete(code);
}

/**
 * Read, change, compare-and-swap, and on a clash start over from a fresh
 * read. `change` gets the stored duel and the time; it returns the new duel
 * (saved only if it differs) or a failure. The result carries the time used
 * and the version the duel is now at.
 */
export async function updateDuel<T extends { ok: true; duel: Duel }>(
  code: string,
  change: (duel: Duel, now: number) => T | DuelFailure
): Promise<(T & { now: number; rev: number }) | DuelFailure> {
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const stored = await loadDuel(code);
    if (!stored) return { ok: false, status: 404, error: "This duel has ended or never existed." };
    const now = Date.now();
    const out = change(stored.duel, now);
    if (!out.ok) return out;
    if (JSON.stringify(out.duel) === JSON.stringify(stored.duel)) return { ...out, now, rev: stored.version };
    if (await saveDuel(out.duel, stored.version)) return { ...out, now, rev: stored.version + 1 };
  }
  return { ok: false, status: 503, error: "The duel is busy. Try again." };
}
