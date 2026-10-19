import "server-only";
import { randomInt } from "node:crypto";
import { getServiceSupabase } from "@/lib/supabase";
import { DUEL_CODE_RE } from "@/lib/duel-types";
import type { Duel } from "./duel";
import type { PvpDuel } from "./duels";

/**
 * Where duels live while they're played: one row per duel in Supabase
 * (RLS-locked, service role only, since a duel holds pins, guesses and
 * secrets the opponent mustn't see yet). PokéGuessr duels have their own
 * table (`geo_duels`); every other kind shares `duels`. Every write is a
 * compare-and-swap on the row's version, so two trainers acting at the same
 * moment never overwrite each other: the loser re-reads and tries again.
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

type StoreFailure = { ok: false; status: number; error: string };

function remote() {
  return process.env.POKEIQ_LOCAL_ACCOUNTS === "1" ? null : getServiceSupabase();
}

export function duelsEnabled(): boolean {
  return remote() !== null || process.env.NODE_ENV !== "production" || process.env.POKEIQ_LOCAL_ACCOUNTS === "1";
}

export function newDuelCode(): string {
  return Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

export interface StoredDuel<D = Duel> {
  duel: D;
  version: number;
}

interface MemoryRow {
  /** Stored as JSON, so no caller ever holds a live reference to it. */
  json: string;
  version: number;
  expires: number;
}

const globalStore = globalThis as unknown as { __pokeiqDuelTables?: Map<string, Map<string, MemoryRow>> };
function memory(table: string): Map<string, MemoryRow> {
  const tables = (globalStore.__pokeiqDuelTables ??= new Map());
  let rows = tables.get(table);
  if (!rows) tables.set(table, (rows = new Map()));
  return rows;
}

/**
 * One table of duels. `columns` adds a row's extra columns on insert (the
 * shared table records each duel's kind).
 */
function duelTable<D extends { code: string }>(table: string, label: string, columns: (duel: D) => Record<string, unknown> = () => ({})) {
  async function load(code: string): Promise<StoredDuel<D> | null> {
    const sb = remote();
    if (sb) {
      const { data, error } = await sb
        .from(table)
        .select("state, version, expires_at")
        .eq("code", code)
        .maybeSingle<{ state: D; version: number; expires_at: string }>();
      if (error) throw new Error(error.message);
      if (!data || Date.parse(data.expires_at) <= Date.now()) return null;
      return { duel: data.state, version: data.version };
    }
    const row = memory(table).get(code);
    if (!row || row.expires <= Date.now()) return null;
    return { duel: JSON.parse(row.json) as D, version: row.version };
  }

  /** A duel for its page and preview card: null if there's no such duel, undefined if the store couldn't say. */
  async function peek(code: string): Promise<D | null | undefined> {
    if (!DUEL_CODE_RE.test(code)) return null;
    try {
      return (await load(code))?.duel ?? null;
    } catch (err) {
      console.error(`[${label}] read failed:`, err);
      return undefined;
    }
  }

  /** False if the code is taken. */
  async function insert(duel: D): Promise<boolean> {
    const expires = Date.now() + TTL_MS;
    const sb = remote();
    if (sb) {
      // Opportunistic cleanup keeps the table small without a cron job.
      await sb.from(table).delete().lt("expires_at", new Date().toISOString());
      const { error } = await sb
        .from(table)
        .insert({ ...columns(duel), code: duel.code, version: 0, state: duel, expires_at: new Date(expires).toISOString() });
      if (error?.code === "23505") return false;
      if (error) throw new Error(error.message);
      return true;
    }
    const rows = memory(table);
    for (const [code, row] of rows) if (row.expires <= Date.now()) rows.delete(code);
    if (rows.has(duel.code)) return false;
    rows.set(duel.code, { json: JSON.stringify(duel), version: 0, expires });
    return true;
  }

  /** Compare-and-swap: writes only if the stored version is still `version`. False if someone got there first. */
  async function save(duel: D, version: number): Promise<boolean> {
    const expires = Date.now() + TTL_MS;
    const sb = remote();
    if (sb) {
      const { data, error } = await sb
        .from(table)
        .update({ state: duel, version: version + 1, updated_at: new Date().toISOString(), expires_at: new Date(expires).toISOString() })
        .eq("code", duel.code)
        .eq("version", version)
        .select("code");
      if (error) throw new Error(error.message);
      return (data ?? []).length === 1;
    }
    const rows = memory(table);
    const row = rows.get(duel.code);
    if (!row || row.version !== version) return false;
    rows.set(duel.code, { json: JSON.stringify(duel), version: version + 1, expires });
    return true;
  }

  async function remove(code: string): Promise<void> {
    const sb = remote();
    if (sb) {
      await sb.from(table).delete().eq("code", code);
      return;
    }
    memory(table).delete(code);
  }

  /**
   * Read, change, compare-and-swap, and on a clash start over from a fresh
   * read. `change` gets the stored duel and the time; it returns the new duel
   * (saved only if it differs) or a failure. The result carries the time used
   * and the version the duel is now at.
   */
  async function update<T extends { ok: true; duel: D }>(
    code: string,
    change: (duel: D, now: number) => T | StoreFailure
  ): Promise<(T & { now: number; rev: number }) | StoreFailure> {
    for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
      const stored = await load(code);
      if (!stored) return { ok: false, status: 404, error: "This duel has ended or never existed." };
      const now = Date.now();
      const out = change(stored.duel, now);
      if (!out.ok) return out;
      if (JSON.stringify(out.duel) === JSON.stringify(stored.duel)) return { ...out, now, rev: stored.version };
      if (await save(out.duel, stored.version)) return { ...out, now, rev: stored.version + 1 };
    }
    return { ok: false, status: 503, error: "The duel is busy. Try again." };
  }

  return { load, peek, insert, save, remove, update };
}

// PokéGuessr duels.
const geo = duelTable<Duel>("geo_duels", "geo-duel");
export const loadDuel = geo.load;
export const peekDuel = geo.peek;
export const insertDuel = geo.insert;
export const saveDuel = geo.save;
export const deleteDuel = geo.remove;
export const updateDuel = geo.update;

/** Every other kind of duel (Pokédle, quizzes): one shared table. */
export const pvpStore = duelTable<PvpDuel>("duels", "duel", (duel) => ({ kind: duel.kind }));
